// 주간보고 가공 로직 — fe-schedule-extension(lib/*)의 계산 로직을 TypeScript 로 이식.
// 필드 매핑: 등록자→createName, 일정대상자→userList, 일자→day, 시간→time, 일정명→title
import type { WeeklyRawRow } from '../../../../shared/types';

/** 총 근무시간 → MM (8시간/일, 20.6일/월 기준, 소수점 2자리) */
export const calculateMM = (totalWorkTime: number): string =>
  Number(totalWorkTime / 8 / 20.6).toFixed(2);

/** 전체 MM 계산에서 기본 제외할 프로젝트 (칩 클릭으로 조정 가능) */
export const DEFAULT_MM_EXCLUDED = ['FE', '전사', '본부', '휴가', '연차', '시차'];

/** 하루 정규 근무시간(T) 기준 — 초과분은 OT */
const DAILY_STANDARD_HOURS = 8;
/** 금요일 정규 근무시간 — 2시간 조기퇴근 반영 */
const FRIDAY_STANDARD_HOURS = 6;

/** 주간 정규 근무시간 (월~목 8h × 4 + 금 6h = 38h) — T합계 기준·진행바용 */
export const WEEKLY_STANDARD_HOURS = DAILY_STANDARD_HOURS * 4 + FRIDAY_STANDARD_HOURS;

/** 해당 일자의 정규 근무시간 기준 (day 예: "06.29 (금)") */
const standardHoursOf = (day: string): number =>
  day.includes('(금)') ? FRIDAY_STANDARD_HOURS : DAILY_STANDARD_HOURS;

// 프로젝트별 [기본, 보조] 색 팔레트 (막대 T/OT · 도넛 · 태그에 공용)
const COLOR_PAIRS: [string, string][] = [
  ['#6366f1', '#4f46e5'], // 인디고
  ['#a1a1aa', '#71717a'], // 그레이 (다크 배경용으로 밝게 조정)
  ['#10b981', '#059669'], // 에메랄드
  ['#f59e0b', '#d97706'], // 앰버
  ['#ef4444', '#dc2626'], // 레드
  ['#06b6d4', '#0891b2'], // 시안
  ['#ec4899', '#db2777'], // 핑크
  ['#8b5cf6', '#7c3aed'], // 바이올렛
  ['#84cc16', '#65a30d'], // 라임
];

export const getColor = (index = 0, type: 0 | 1 = 0): string => {
  const i = index < 0 ? 0 : index;
  return COLOR_PAIRS[i % COLOR_PAIRS.length][type];
};

export type ProjectSummary = {
  name: string;
  T: number;
  OT: number;
  TMM: string;
  OTMM: string;
};

export type BarChartData = {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    stack: string;
    backgroundColor: string;
  }[];
};

export type RoundChartData = {
  labels: string[];
  datasets: { data: number[]; backgroundColor: string[] }[];
};

/** 프로젝트별 상세 일정명 (T/OT) */
export type ScheduleByProject = Record<string, { T: string[]; OT: string[] }>;

export type EmployeeReport = {
  barChartData: BarChartData;
  roundChartData: RoundChartData;
  summaryData: ProjectSummary[];
  summaryTotalData: { T: number; OT: number };
  scheduleData: ScheduleByProject;
};

export type WeeklyReport = {
  nameList: string[];
  projectList: string[];
  byName: Record<string, EmployeeReport>;
};

// ── 내부 집계 모델 ──────────────────────────────────────────────

/** 프로젝트별 T/OT 집계 (요일별) */
class Project {
  T: Record<string, number> = {};
  OT: Record<string, number> = {};
  TScheduleList: string[] = [];
  OTScheduleList: string[] = [];

  constructor(readonly name: string) {}

  addData(day: string, t: number, ot: number) {
    this.T[day] = (this.T[day] ?? 0) + t;
    this.OT[day] = (this.OT[day] ?? 0) + ot;
  }

  private sortedByDay(obj: Record<string, number>): [string, number][] {
    return Object.entries(obj).sort((a, b) => a[0].localeCompare(b[0]));
  }

  getSum(type: 'T' | 'OT'): number {
    const data = type === 'T' ? this.T : this.OT;
    return Object.values(data).reduce((sum, v) => sum + v, 0);
  }

  getMM(type: 'T' | 'OT'): string {
    return calculateMM(this.getSum(type));
  }

  /** 요일(일자) 오름차순 값 배열 */
  getValues(type: 'T' | 'OT'): number[] {
    return this.sortedByDay(type === 'T' ? this.T : this.OT).map(([, v]) => v);
  }

  /** 요일(일자) 라벨 배열 */
  getLabels(): string[] {
    return this.sortedByDay(this.T).map(([day]) => day);
  }

  /** [프로젝트명] 접두사 제거 + 중복 제거한 일정명 목록 */
  getScheduleList(type: 'T' | 'OT'): string[] {
    const list = type === 'T' ? this.TScheduleList : this.OTScheduleList;
    return [...new Set(list)].map((detail) => detail.replace(/\[.*?\]\s*/, ''));
  }
}

type ProjectMap = Record<string, Project>;

// ── 파싱 헬퍼 ──────────────────────────────────────────────────

/** 시간 정보 유효성 검사 (H:MM / HH:MM) */
const isValidTime = (time: string) =>
  /^([1-9]|[01][0-9]|2[0-3]):([0-5][0-9])$/.test(time);

/** "18:30" → 18.5 (30분 단위만 사용) */
const timeToNumber = (time: string): number => {
  const [hour, minute] = time.split(':');
  return minute === '00' ? Number(hour) : Number(hour) + 0.5;
};

/** 일정명에서 [프로젝트명] 추출 — 없으면 'NULL' */
const getProjectName = (scheduleDetail: string): string => {
  const match = scheduleDetail.match(/\[(.*?)\]/);
  return match ? match[1].replace(/\s/g, '') : 'NULL';
};

// ── 사원/프로젝트 목록 ─────────────────────────────────────────

// 입사 순서대로 정렬 (지정된 인원 우선, 나머지는 원래 순서)
const MANAGER_FIRST = ['전동엽', '김승우', '임지원', '전민주', '정수범'];

const managerOrder = (nameList: string[]): string[] => {
  const front = MANAGER_FIRST.filter((n) => nameList.includes(n));
  const back = nameList.filter((n) => !MANAGER_FIRST.includes(n));
  return [...front, ...back];
};

/** 등록자 === 일정대상자(본인 일정)인 행으로 사원 목록 구성 */
export const getNameList = (rows: WeeklyRawRow[]): string[] => {
  const nameSet = new Set<string>();
  rows.forEach((row) => {
    if (row.createName && row.createName === row.userList) {
      nameSet.add(row.createName);
    }
  });
  return managerOrder([...nameSet]);
};

/** 전체 프로젝트 목록 (등장 순서) */
export const getProjectList = (rows: WeeklyRawRow[]): string[] => {
  const projectSet = new Set<string>();
  rows.forEach((row) => projectSet.add(getProjectName(row.title)));
  return [...projectSet];
};

// ── 한 사람의 주간 데이터 가공 ─────────────────────────────────

/** name 이 일정대상자에 포함된 행을 프로젝트별 T/OT 로 집계 (하루 정규시간까지 T, 초과분 OT — 금요일 6시간·그 외 8시간) */
const filterWeekAll = (rows: WeeklyRawRow[], name: string): ProjectMap => {
  const result: ProjectMap = {};
  const daySet = new Set<string>();
  const dailySchedules: Record<
    string,
    { startTime: number; endTime: number; projectName: string; detail: string }[]
  > = {};

  rows.forEach((row) => {
    if (!row.userList || !row.userList.includes(name)) return;

    const day = row.day;
    daySet.add(day);
    const timeRange = row.time.trim();
    const start = timeRange.slice(0, 5).trim();
    const end = timeRange.slice(-5).trim();
    if (!isValidTime(start) || !isValidTime(end)) return; // 시간 형식이 아닌 데이터(종일 등)는 제외

    if (!dailySchedules[day]) dailySchedules[day] = [];
    dailySchedules[day].push({
      startTime: timeToNumber(start),
      endTime: timeToNumber(end),
      projectName: getProjectName(row.title),
      detail: row.title,
    });
  });

  // 날짜별로 T/OT 계산
  Object.keys(dailySchedules).forEach((day) => {
    const standard = standardHoursOf(day); // 금요일은 6시간, 그 외 8시간
    let totalWorkTime = 0;
    dailySchedules[day].forEach((schedule) => {
      const endTime = schedule.endTime === 0 ? 24 : schedule.endTime; // 00시까지 근무한 경우
      const workTime = endTime - schedule.startTime;

      let t = 0;
      let ot = 0;
      if (totalWorkTime >= standard) {
        ot = workTime;
      } else if (totalWorkTime + workTime > standard) {
        t = standard - totalWorkTime;
        ot = workTime - t;
      } else {
        t = workTime;
      }

      if (!result[schedule.projectName]) {
        result[schedule.projectName] = new Project(schedule.projectName);
      }
      const project = result[schedule.projectName];
      project.addData(day, t, ot);
      if (t !== 0) project.TScheduleList.push(schedule.detail);
      if (ot !== 0) project.OTScheduleList.push(schedule.detail);

      totalWorkTime += workTime;
    });
  });

  // 데이터 없는 요일에 0 채우기 (차트 라벨 정렬용)
  daySet.forEach((day) => {
    Object.values(result).forEach((project) => project.addData(day, 0, 0));
  });

  return result;
};

// ── 차트/요약 데이터 변환 ─────────────────────────────────────

/** 프로젝트명 기준 고정 색 인덱스 (카드·차트·태그 색 통일) */
const colorIndexOf = (projectName: string, fallback: number, projectList: string[]) => {
  const found = projectList.indexOf(projectName);
  return found < 0 ? fallback : found;
};

const toBarChartData = (data: ProjectMap, projectList: string[]): BarChartData => {
  const first = Object.values(data)[0];
  const labels = first ? first.getLabels() : [];
  const datasets: BarChartData['datasets'] = [];

  Object.values(data).forEach((project, index) => {
    const ci = colorIndexOf(project.name, index, projectList);
    if (project.getSum('T')) {
      datasets.push({
        label: `${project.name} T`,
        data: project.getValues('T'),
        stack: 'T',
        backgroundColor: getColor(ci, 0),
      });
    }
    if (project.getSum('OT')) {
      datasets.push({
        label: `${project.name} OT`,
        data: project.getValues('OT'),
        stack: 'OT',
        backgroundColor: getColor(ci, 1),
      });
    }
  });

  return { labels, datasets };
};

const toRoundChartData = (data: ProjectMap, projectList: string[]): RoundChartData => {
  const labels: string[] = [];
  const datasets: RoundChartData['datasets'] = [{ data: [], backgroundColor: [] }];

  Object.values(data).forEach((project, index) => {
    const ci = colorIndexOf(project.name, index, projectList);
    labels.push(project.name);
    datasets[0].data.push(project.getSum('T') + project.getSum('OT'));
    datasets[0].backgroundColor.push(getColor(ci, 0));
  });

  return { labels, datasets };
};

const toSummaryData = (data: ProjectMap): ProjectSummary[] =>
  Object.values(data)
    .map((project) => ({
      name: project.name,
      T: project.getSum('T'),
      OT: project.getSum('OT'),
      TMM: project.getMM('T'),
      OTMM: project.getMM('OT'),
    }))
    .sort((a, b) => b.T - a.T);

const toSummaryTotal = (data: ProjectMap): { T: number; OT: number } => {
  let totalT = 0;
  let totalOT = 0;
  Object.values(data).forEach((project) => {
    totalT += project.getSum('T');
    totalOT += project.getSum('OT');
  });
  return { T: totalT, OT: totalOT };
};

const toScheduleData = (data: ProjectMap): ScheduleByProject => {
  const result: ScheduleByProject = {};
  Object.values(data).forEach((project) => {
    result[project.name] = {
      T: project.getScheduleList('T'),
      OT: project.getScheduleList('OT'),
    };
  });
  return result;
};

// ── 전체 리포트 생성 ──────────────────────────────────────────

export function buildReport(rows: WeeklyRawRow[]): WeeklyReport {
  const nameList = getNameList(rows);
  const projectList = getProjectList(rows);
  const byName: Record<string, EmployeeReport> = {};

  nameList.forEach((name) => {
    const filtered = filterWeekAll(rows, name);
    byName[name] = {
      barChartData: toBarChartData(filtered, projectList),
      roundChartData: toRoundChartData(filtered, projectList),
      summaryData: toSummaryData(filtered),
      summaryTotalData: toSummaryTotal(filtered),
      scheduleData: toScheduleData(filtered),
    };
  });

  return { nameList, projectList, byName };
}

/** 제외 목록을 반영한 전체 MM — T/OT 분리 (칩 토글용) */
export const calcTotalMM = (
  summaryData: ProjectSummary[],
  excluded: Set<string>,
): { T: string; OT: string } => {
  let sumT = 0;
  let sumOT = 0;
  summaryData.forEach((it) => {
    if (!excluded.has(it.name)) {
      sumT += it.T;
      sumOT += it.OT;
    }
  });
  return { T: calculateMM(sumT), OT: calculateMM(sumOT) };
};
