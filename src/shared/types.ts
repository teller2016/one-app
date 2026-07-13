// 프로세스(main / preload / renderer) 간 공용 타입

export type ScheduleDateOption = {
  type: 'today' | 'yesterday' | 'date';
  date?: string;
};

export type ScheduleRunPayload = {
  scheduleText: string;
  startTime: string;
  dateOption: ScheduleDateOption;
  testMode: boolean;
};

export type ScheduleRunResult = {
  ok: boolean;
  error?: string;
  code?: number | null;
};

export type ScheduleOutputChunk = { stream: string; data: string };

export type ScheduleDoneInfo = { code: number | null };

// ── 환경설정 ──
export type AppSettingsView = {
  bizboxId: string;
  hasPassword: boolean;
  notifyDeploy: boolean; // 배포 완료/실패 데스크톱 알림 on/off
};

export type SaveSettingsInput = {
  bizboxId: string;
  password?: string; // 빈 값이면 기존 비밀번호 유지
  notifyDeploy?: boolean; // 미지정이면 기존 유지
};

// ── 배포 (젠킨스) ──

/** 프로젝트 안의 배포 대상 하나 (예: 스토어, 어드민) */
export type DeployTarget = {
  id: string;
  name: string; // 표시명 (예: 스토어)
  jobPath: string; // 젠킨스 잡 이름. 폴더 안이면 "폴더/잡" 형태
};

/** 렌더러에 보내는 프로젝트 정보 — 토큰/비밀번호 값은 포함하지 않음 */
export type DeployProjectView = {
  id: string;
  name: string;
  jenkinsUrl: string;
  username: string;
  hasSecret: boolean; // API 토큰/비밀번호 저장 여부
  targets: DeployTarget[];
};

export type SaveDeployProjectInput = {
  id?: string; // 없으면 신규 생성
  name: string;
  jenkinsUrl: string;
  username: string;
  secret?: string; // API 토큰 또는 비밀번호. 빈 값이면 기존 유지
  targets: { id?: string; name: string; jobPath: string }[];
};

export type DeployState =
  | 'idle' // 빌드 이력 없음
  | 'queued' // 젠킨스 큐 대기
  | 'building'
  | 'success'
  | 'failure' // FAILURE/ABORTED/UNSTABLE 등
  | 'error'; // 요청/통신 오류

export type DeployStatus = {
  state: DeployState;
  buildNumber?: number;
  buildUrl?: string;
  result?: string; // 젠킨스 result 원문 (SUCCESS/FAILURE/ABORTED ...)
  error?: string;
  finishedAt?: number; // epoch ms
  startedAt?: number; // 빌드 시작 시각 (building 일 때 — 진행률 계산용)
  estimatedMs?: number; // 예상 소요 시간 (building 일 때, 젠킨스 estimatedDuration)
};

/** 메인 → 렌더러로 보내는 배포 상태 이벤트 */
export type DeployStatusEvent = {
  projectId: string;
  targetId: string;
  status: DeployStatus;
};

export type DeployTriggerResult = { ok: boolean; error?: string };

/** 빌드에 포함된 커밋 하나 */
export type DeployCommit = {
  id: string; // 커밋 해시
  message: string; // 제목+본문 전체
  author: string;
  timestamp?: number; // epoch ms
};

/** 빌드 상세 — 커밋 내역 표시용 */
export type DeployBuildDetail = {
  number: number;
  building: boolean;
  result: string | null;
  timestamp?: number; // 빌드 시작 시각 (epoch ms)
  duration?: number; // 소요 시간 (ms)
  startedBy?: string; // 시작한 사용자
  revision?: string; // git SHA
  branch?: string; // 예: refs/remotes/origin/develop
  repoUrl?: string;
  commits: DeployCommit[];
};

export type DeployBuildDetailResult = {
  ok: boolean;
  detail?: DeployBuildDetail;
  error?: string;
};

/** 빌드 이력 한 건 (목록용 요약) */
export type DeployBuildSummary = {
  number: number;
  building: boolean;
  result: string | null; // SUCCESS/FAILURE/ABORTED … (빌드중이면 null)
  timestamp?: number; // 시작 시각 (epoch ms)
  duration?: number; // 소요 (ms)
  startedBy?: string; // 시작한 사용자 (또는 트리거 설명)
};

export type DeployHistoryResult = {
  ok: boolean;
  builds?: DeployBuildSummary[];
  error?: string;
};

/** 콘솔 로그 tail 조회 결과 */
export type DeployLogResult = {
  ok: boolean;
  text?: string;
  truncated?: boolean; // 앞부분이 잘렸는지 (마지막 일부만 가져옴)
  error?: string;
};

export type DeployStopResult = { ok: boolean; error?: string };

// ── VPN (OpenVPN) ──
export type VpnState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type VpnStatus = {
  state: VpnState;
  detail?: string; // 진행 단계 설명 (인증 중, IP 할당 중 …)
  vpnIp?: string; // 터널 IP (연결됨일 때)
  since?: number; // 연결 시각 (epoch ms)
  error?: string;
};

/** 렌더러에 보내는 VPN 설정 — 시크릿 값은 포함하지 않음 */
export type VpnSettingsView = {
  username: string;
  hasTotpSecret: boolean;
  ovpnPath: string;
  openvpnInstalled: boolean; // openvpn CLI 설치 여부
};

export type SaveVpnSettingsInput = {
  username: string;
  totpSecret?: string; // 빈 값이면 기존 유지
  ovpnPath: string;
};

export type VpnSaveResult = {
  ok: boolean;
  error?: string;
  settings?: VpnSettingsView;
};

export type VpnActionResult = { ok: boolean; error?: string };

// ── 주간보고 (FE챕터 개인별 주간 분석) ──

/** 그룹웨어 개인별 주간 화면에서 수집한 일정 한 건 (엑셀 payload 원본) */
export type WeeklyRawRow = {
  day: string; // 일자 — 예: "06.29 (월)"
  time: string; // 시간 — 예: "08:30 ~ 11:30"
  title: string; // 일정명 — 예: "[뉴발] QA 이슈 대응"
  createName: string; // 등록자
  userList: string; // 일정대상자 (여러 명이면 이름이 나열됨)
};

export type WeeklyPeriod = { start: string; end: string }; // "YYYY-MM-DD"

export type WeeklyFetchResult = {
  ok: boolean;
  rows?: WeeklyRawRow[];
  period?: WeeklyPeriod;
  error?: string;
};

/** 수집 진행 단계 (메인 → 렌더러 이벤트) */
export type WeeklyProgress = { step: string };

// ── 출퇴근 (근태) ──
export type AttendanceInfo = {
  comeTime: string | null; // "09:37" — 아직 안 찍었으면 null
  leaveTime: string | null;
  date: string; // "2026.07.02"
  checkedAt: number; // 조회 시각 (epoch ms)
};

export type AttendanceResult = {
  ok: boolean;
  info?: AttendanceInfo;
  error?: string;
};

// 출퇴근 리마인더 — 요일별로 출근/퇴근 알림 시각을 따로 설정
export type ReminderSlot = {
  enabled: boolean;
  time: string; // "HH:MM"
};

export type DayReminderConfig = {
  day: number; // 1=월 … 5=금 (JS Date.getDay: 0=일)
  come: ReminderSlot; // 출근 리마인더
  leave: ReminderSlot; // 퇴근 리마인더
};

// 안 찍었으면 N분마다 재알림 (반복 알림)
export type ReminderRepeat = {
  enabled: boolean;
  minutes: number; // 반복 간격(분) — 1~120
};

export type ReminderConfig = {
  days: DayReminderConfig[];
  repeat: ReminderRepeat;
};
