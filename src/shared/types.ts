// 프로세스(main / preload / renderer) 간 공용 타입

export type ScheduleDateOption = {
  type: "today" | "yesterday" | "date";
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

/** 하루 작업 기록 항목 — end 는 "HH:MM" (userData/worklog.json 에 저장) */
export type ScheduleWorkItem = { id: string; end: string; title: string };

/** 하루 시작 시각 기본값 — main 저장본 보정과 렌더러 초기값의 단일 소스 */
export const SCHEDULE_DEFAULT_START_TIME = "09:30";

/**
 * 작업 기록 저장 단위 — 항목 + 시작 시각 (userData/worklog.json).
 * 예전 저장본은 항목 배열만 담았으므로 읽을 때 이 형태로 승격한다.
 */
export type ScheduleWorklog = {
  items: ScheduleWorkItem[];
  startTime: string; // "HH:MM" — 타임라인 계산의 기준
};

/**
 * 일정 등록 — 요일별 기준 시작 시각 (userData/schedule-start.json).
 * 재택 요일이냐 아니냐로 기준 시각을 나누고, 등록 실행 시 시작 시각이
 * 기준과 다르면 확인 다이얼로그를 한 번 거친다 (오등록 방지).
 */
export type ScheduleStartConfig = {
  remoteDays: number[]; // 재택 요일 (1=월 … 5=금, JS Date.getDay 기준)
  remoteStart: string; // 재택 요일 시작 시각 "HH:MM"
  officeStart: string; // 출근 요일 시작 시각 "HH:MM"
};

/** 기준 시작 시각 기본값 — main 저장본 보정과 렌더러 초기값의 단일 소스 */
export const SCHEDULE_START_CONFIG_DEFAULT: ScheduleStartConfig = {
  remoteDays: [1, 5], // 월·금 재택
  remoteStart: "09:00",
  officeStart: SCHEDULE_DEFAULT_START_TIME,
};

/** 노션 기록 요청 — scheduleText 는 [노션용 복사]와 같은 "종료시간 일정명" 줄 텍스트 */
export type ScheduleNotionRecordPayload = {
  scheduleText: string;
  dateOption: ScheduleDateOption;
  force?: boolean; // 날짜 페이지에 이미 내용이 있어도 이어붙임 (렌더러 확인 후 재시도용)
};

export type ScheduleNotionRecordResult = {
  ok: boolean;
  /** no_config(연동 미설정) · has_content(이미 내용 있음 — force 재시도) · 그 외 사용자 표시용 메시지 */
  error?: string;
  url?: string; // 기록한 날짜 페이지 (notion.so 링크)
};

// ── 환경설정 ──
/** 테마 설정 — system 은 macOS 화면 모드를 따라간다 */
export type ThemePref = "system" | "light" | "dark";

export type AppSettingsView = {
  bizboxId: string;
  hasPassword: boolean;
  notifyDeploy: boolean; // 배포 완료/실패 데스크톱 알림 on/off
  jiraUrl: string; // Jira 베이스 URL (커밋 메시지의 이슈 키 링크화용, 빈 값이면 비활성)
  jiraEmail: string; // Jira 계정 이메일 (내 이슈 API 인증용, 빈 값이면 비활성)
  hasJiraToken: boolean; // Jira API 토큰 저장 여부 (내 이슈 조회용)
  giteaUrl: string; // Gitea 베이스 URL (커밋 링크·배포 미리보기용, 빈 값이면 비활성)
  hasGiteaToken: boolean; // Gitea 토큰 저장 여부 (비공개 저장소용, 선택)
  notionRootUrl: string; // 노션 투입시간 루트 페이지 URL (일정 노션 기록용, 빈 값이면 비활성)
  hasNotionToken: boolean; // 노션 개인 액세스 토큰 저장 여부
  /**
   * 결재 근무자 표의 '소속' 칸 문구 (예: 플랫폼서비스사업부문 FE). 빈 값이면 앱 기본값.
   * 단독 배포판(standalone/lite)을 다른 챕터 동료가 쓸 때 바꿔야 하는 값이다.
   */
  approvalDept: string;
  theme: ThemePref; // 테마 (기본 system)
  /**
   * 키체인(safeStorage) 암호화가 가능한가 — false 면 위 비밀들이 **평문 base64** 로 저장된다.
   * 정상 환경에선 항상 true 다. 환경설정 화면이 false 일 때만 경고 배너를 띄운다.
   */
  secureStorage: boolean;
};

export type SaveSettingsInput = {
  bizboxId: string;
  password?: string; // 빈 값이면 기존 비밀번호 유지
  approvalDept?: string; // 미지정이면 기존 유지
  notifyDeploy?: boolean; // 미지정이면 기존 유지
  jiraUrl?: string; // 미지정이면 기존 유지
  jiraEmail?: string; // 미지정이면 기존 유지
  jiraToken?: string; // 빈 값이면 기존 유지
  giteaUrl?: string; // 미지정이면 기존 유지
  giteaToken?: string; // 빈 값이면 기존 유지
  notionRootUrl?: string; // 미지정이면 기존 유지
  notionToken?: string; // 빈 값이면 기존 유지
};

// ── Jira (내 이슈) ──

export type JiraIssue = {
  key: string; // BBJ-1234
  projectKey: string; // BBJ (프로젝트 탭 필터 기준)
  summary: string;
  status: string; // 상태 이름 (해야 할 일·진행 중 …)
  statusCategory: "new" | "indeterminate" | "done"; // 뱃지 색 구분용
  issueType: string; // 작업·버그·하위 작업·sub-bug 등 (그룹핑 기준)
  parentKey: string | null; // 하위 작업이면 부모 이슈 키
  parentSummary: string | null; // 부모 이슈 제목 (상위 항목 칩 표시용)
  priority: string | null;
  updatedAt: string; // ISO
  url: string; // 브라우저로 열 이슈 링크
  /** 담당이 아닌데 직접 추가한 티켓 (핀) — 목록 맨 위 '직접 추가' 그룹으로 간다 */
  pinned?: boolean;
};

export type JiraListResult = {
  ok: boolean;
  configured: boolean; // 주소·이메일·토큰이 모두 설정됐는지
  issues?: JiraIssue[];
  error?: string;
  /** 직접 추가한 티켓 조회만 실패했을 때 — 담당 목록은 정상이다(부분 실패 안내용) */
  addedError?: string;
};

export type JiraActionResult = {
  ok: boolean;
  error?: string;
  /** 전환 성공 시 실제로 이동한 상태 이름 (resolveIssue 의 자동 선택 결과 표시용) */
  status?: string;
};

/**
 * 해결 상태 판별 (main·렌더러 공용 — 렌더러 쪽 진입점은 `features/jira` 의 `isDone`).
 * 카테고리가 done 이거나 이름이 해결·완료 계열이면 해결로 본다.
 * (이 팀 워크플로우는 '해결됨' 상태가 카테고리상 '진행 중'이라 이름 휴리스틱을 병행한다)
 */
export function isDoneStatus(status: string, statusCategory?: string): boolean {
  return (
    statusCategory === "done" || /해결|완료|resolved|done|closed/i.test(status)
  );
}

// ── 직접 추가한 티켓 (담당이 아닌데 내가 작업해야 하는 이슈) ──

/** 직접 추가한 티켓 하나 — 키만 저장하고 내용은 매 조회 때 Jira 에서 받는다 */
export type JiraAddedTicket = { key: string; addedAt: number };

/** 추가 전 확인 결과 — 존재·권한을 검사하고 무엇을 추가하는지 보여준다 */
export type JiraValidateResult = {
  ok: boolean;
  key?: string;
  summary?: string;
  issueType?: string;
  status?: string;
  reporter?: string;
  already?: boolean; // 이미 추가돼 있는 티켓
  error?: string;
};

/** 추가·제거 결과 — 갱신된 전체 목록을 함께 준다 */
export type JiraAddedResult = {
  ok: boolean;
  added?: JiraAddedTicket[];
  error?: string;
};

/** 이슈에서 지금 실행 가능한 상태 전환 하나 (name = 목적지 상태 이름) */
export type JiraTransition = { id: string; name: string };

export type JiraTransitionsResult = {
  ok: boolean;
  transitions?: JiraTransition[];
  error?: string;
};

/** 이슈 상세의 댓글 하나 — html 은 Jira 가 렌더한 본문 (main 에서 sanitize·이미지 인라인 완료) */
export type JiraComment = {
  author: string;
  created: string; // Jira 가 렌더한 표시용 문자열 (예: 2026-07-29 10:12)
  html: string;
};

/** 이슈 상세 — 앱 내 패널에서 본문·댓글을 바로 보기 위한 렌더 완료 데이터 */
export type JiraIssueDetail = {
  key: string;
  summary: string;
  status: string;
  statusCategory: "new" | "indeterminate" | "done"; // 뱃지 색 구분용 (목록과 동일)
  issueType: string;
  priority: string | null;
  reporter: string | null;
  assignee: string | null;
  created: string; // 렌더된 표시 문자열 (없으면 ISO)
  updated: string;
  descriptionHtml: string; // sanitize 된 HTML — 빈 값이면 본문 없음
  comments: JiraComment[];
  url: string; // 브라우저로 열 이슈 링크
};

export type JiraDetailResult = {
  ok: boolean;
  detail?: JiraIssueDetail;
  error?: string;
};

// ── Jira 주간 활동 (기간 기준 — 내가 그 주에 작업한 티켓) ──

/**
 * 그 기간에 내가 티켓에 얼마나 관여했는지 — 목록 아이콘·필터 기준.
 * - resolved: 내가 그 기간에 상태를 해결·완료 계열로 전환했다
 * - progressed: 내가 상태를 바꿨지만 완료까지는 아니다
 * - touched: 상태 전환 없이 담당·워크로그·필드 변경만 있다
 */
export type JiraEngagement = "resolved" | "progressed" | "touched";

/** 어느 조회 갈래에서 나온 티켓인지 (근거 표시·판정 폴백용) */
export type JiraActivitySource = "assignee" | "status" | "worklog";

/** 그 기간 안의 내 변경 한 건 (Jira changelog 항목) */
export type JiraActivityEvent = {
  at: string; // ISO
  field: string; // 표시용 필드명 (상태·담당자·우선순위 …)
  from: string | null;
  to: string | null;
};

/** 주간 활동 목록의 티켓 한 줄 — 내 이슈 목록과 같은 형태 + 관여도·이력 */
export type JiraActivityIssue = JiraIssue & {
  engagement: JiraEngagement;
  sources: JiraActivitySource[];
  /** 그 기간 안의 내 변경만, 시간순 (이력을 못 받았으면 빈 배열) */
  events: JiraActivityEvent[];
  /**
   * 이력을 못 받아온 티켓 — changelog 조회 실패·상한 초과.
   * 관여도가 검색 갈래에 기반한 추정이라는 표시다.
   */
  historyMissing?: boolean;
};

export type JiraActivityResult = {
  ok: boolean;
  configured: boolean; // 주소·이메일·토큰이 모두 설정됐는지
  range?: { start: string; end: string }; // YYYY-MM-DD (요청 그대로 — 표시 대조용)
  issues?: JiraActivityIssue[];
  error?: string;
  /** 일부 조회 갈래만 실패했을 때 안내 (본 목록은 유효 — 부분 성공) */
  warnings?: string[];
};

// ── Jira 티켓 보고 (프로젝트·기간으로 모아 한 번에 복사) ──

/** 기간을 어느 날짜 필드로 자를지 — 생성일 · 해결일 · 갱신일 */
export type JiraReportDateField = "created" | "resolved" | "updated";

/** 기간 지정 방식 — 월 하나 · 시작~끝 직접 · 기간 없음 */
export type JiraReportPeriod =
  | { mode: "month"; month: string } // "YYYY-MM"
  | { mode: "range"; start: string; end: string } // "YYYY-MM-DD", 양끝 포함
  | { mode: "all" };

/** 조회 조건 — main 이 JQL 로 바꿔 검색한다 (`shared/jira-report.ts` 의 buildReportJql) */
export type JiraReportQuery = {
  projectKeys: string[];
  period: JiraReportPeriod;
  dateField: JiraReportDateField;
  /** 고급 — 값이 있으면 위 조건을 무시하고 이 JQL 을 그대로 보낸다 */
  jql?: string;
};

/** 보고 목록의 티켓 한 줄 — 내 이슈 목록 형태 + 담당자·레이블·날짜 */
export type JiraReportIssue = JiraIssue & {
  assignee: string | null; // 표시명 (미배정이면 null)
  reporter: string | null;
  labels: string[];
  createdAt: string; // ISO
  resolvedAt: string | null; // ISO (미해결이면 null)
};

export type JiraReportResult = {
  ok: boolean;
  configured: boolean; // 주소·이메일·토큰이 모두 설정됐는지
  issues?: JiraReportIssue[];
  jql?: string; // 실제로 보낸 JQL (화면 확인·복사용)
  /** 조회 상한에 걸려 뒤가 잘렸다 — 기간을 좁히라고 안내한다 */
  truncated?: boolean;
  error?: string;
};

/** 프로젝트 선택지 — 키·이름만 */
export type JiraProjectOption = { key: string; name: string };

export type JiraProjectsResult = {
  ok: boolean;
  configured: boolean;
  projects?: JiraProjectOption[];
  error?: string;
};

/** 보고 화면의 저장되는 선택 — 달마다 같은 조건을 쓰므로 userData 에 남긴다 */
export type JiraReportPrefs = {
  /** 복사 한 줄 템플릿 — `{key}` `{summary}` 같은 자리표시자 (`\t` `\n` 이스케이프 허용) */
  template: string;
  projectKeys: string[];
  dateField: JiraReportDateField;
  periodMode: JiraReportPeriod["mode"];
};

// ── Jira 작업 시작 (티켓 맥락을 femc 세션으로 넘기기) ──

/**
 * 작업을 시작할 femc 스킬.
 * 'auto' = 이슈 타입으로 판정(버그 계열 → /bugfix, 그 외 → /dev), 'none' = 스킬 없이 일반 프롬프트.
 */
export type JiraWorkSkill = "auto" | "bugfix" | "dev" | "qa" | "none";

/**
 * femc 를 띄울 Claude 계정 — 원래 `~/.zshrc` 의 femc()/claude() 함수가 물어보던 선택이다.
 * 앱은 그 셸 함수를 우회(`command femc`)하므로 `CLAUDE_CONFIG_DIR` 을 직접 정해 넘긴다.
 */
export type JiraWorkAccount = "personal" | "team";

/** 계정 선택지 하나 — 로그인돼 있으면 이메일이 함께 온다 */
export type JiraWorkAccountInfo = {
  id: JiraWorkAccount;
  label: string; // Personal · Team
  dir: string; // CLAUDE_CONFIG_DIR 경로
  email?: string; // 그 프로필에 로그인된 계정 (없으면 미로그인)
};

export type JiraWorkPrepareInput = {
  key: string;
  skill: JiraWorkSkill;
  note?: string; // 모달의 '부가 설명' (선택)
  account?: JiraWorkAccount; // 기본 personal
};

/**
 * 작업 준비 결과 — 티켓 맥락을 디스크에 만들어 두고 **실행 명령·붙여넣기 문구**를 돌려준다.
 * ⚠️ 셸 인용은 main 이 끝낸 상태다. 렌더러는 `command` 를 가공하지 말고 그대로
 * `terminal.create({ command })` 에 넘길 것.
 */
export type JiraWorkPrepareResult = {
  ok: boolean;
  command?: string; // 새 세션용 — femc --add-dir <티켓폴더> "<프롬프트>"
  paste?: string; // 이미 떠 있는 femc 세션에 넣을 한 줄 프롬프트
  title?: string; // 세션 표시명 (티켓 키)
  dir?: string; // 티켓 맥락 폴더 (안내·디버깅용)
  attachments?: number; // 내려받은 첨부 수
  error?: string;
};

// ── 알림 토스트 (공통 인프라 — main → 렌더러 app:toast) ──

/** 우측 아래 토스트 알림 — 창이 포커스일 때 알럿 대신 표시 (notify.notifyToast) */
export type AppToastPayload = {
  title?: string; // 굵은 제목 줄 (없으면 message 한 줄짜리)
  message: string;
  variant?: 'ok' | 'fail' | 'info';
  sticky?: boolean; // true 면 자동으로 사라지지 않고 ✕ 로 직접 닫는다
  duration?: number; // 자동 소멸까지 ms (sticky 면 무시)
  section?: string; // 지정 시 [이동] 액션 버튼 — 클릭하면 해당 섹션으로 전환
  actionLabel?: string; // 액션 버튼 라벨 (기본 '이동')
  /** 지정 시 [이동]이 섹션 전환을 넘어 그 터미널 세션까지 포커스한다 (section 보다 우선) */
  terminalSession?: { sessionId: string; cwd: string };
  /** 같은 키의 기존 토스트를 교체한다 — 세션당 입력대기 토스트 1장 유지용 */
  dedupeKey?: string;
};

/**
 * 터미널 입력대기 토스트의 dedupeKey.
 * main(발신)과 렌더러(그 세션을 보면 닫기)가 **같은 키**를 써야 짝이 맞아서 여기 둔다 —
 * 양쪽에 문자열을 각각 적어 두면 한쪽만 바뀌었을 때 조용히 안 닫힌다.
 */
export const termWaitToastKey = (sessionId: string): string =>
  `term-wait:${sessionId}`;

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
  production: boolean; // 운영(PROD) 프로젝트 — 배포 시 강한 확인
  targets: DeployTarget[];
};

export type SaveDeployProjectInput = {
  id?: string; // 없으면 신규 생성
  name: string;
  jenkinsUrl: string;
  username: string;
  secret?: string; // API 토큰 또는 비밀번호. 빈 값이면 기존 유지
  production?: boolean;
  targets: { id?: string; name: string; jobPath: string }[];
};

export type DeployState =
  | "idle" // 빌드 이력 없음
  | "queued" // 젠킨스 큐 대기
  | "building"
  | "success"
  | "failure" // FAILURE/ABORTED/UNSTABLE 등
  | "error"; // 요청/통신 오류

export type DeployStatus = {
  state: DeployState;
  buildNumber?: number;
  buildUrl?: string;
  result?: string; // 젠킨스 result 원문 (SUCCESS/FAILURE/ABORTED ...)
  error?: string;
  finishedAt?: number; // epoch ms
  startedAt?: number; // 빌드 시작 시각 (building 일 때 — 진행률 계산용)
  estimatedMs?: number; // 예상 소요 시간 (building 일 때, 젠킨스 estimatedDuration)
  queueWhy?: string; // queued 일 때 — 젠킨스 대기 사유 (예: "Build #45 is already in progress")
  queuedSince?: number; // queued 일 때 — 대기 시작 시각 (epoch ms)
};

/** 메인 → 렌더러로 보내는 배포 상태 이벤트 */
export type DeployStatusEvent = {
  projectId: string;
  targetId: string;
  status: DeployStatus;
};

/** 젠킨스에서 지금 실행 중인 빌드 한 개 (실행자 점유) */
export type DeployRunningBuild = {
  name: string; // fullDisplayName (예: "projectA-store #45")
  number?: number;
  url?: string; // baseUrl 기준으로 재조립한 빌드 URL
  startedAt?: number; // epoch ms
  estimatedMs?: number; // 예상 소요 (젠킨스 estimatedDuration)
  node?: string; // 실행 노드(computer) 이름
};

/** 젠킨스 큐(대기)에 있는 항목 한 개 */
export type DeployQueueItem = {
  id: number;
  name: string; // task.name (잡 이름)
  why?: string; // 대기 사유
  since?: number; // inQueueSince (epoch ms)
  stuck?: boolean;
};

/** 젠킨스 전체 현황 — 실행 중 + 대기 */
export type DeployActivity = {
  running: DeployRunningBuild[];
  queued: DeployQueueItem[];
};

export type DeployActivityResult = {
  ok: boolean;
  activity?: DeployActivity;
  error?: string;
};

export type DeployTriggerResult = { ok: boolean; error?: string };

/** 빌드에 포함된 커밋 하나 */
export type DeployCommit = {
  id: string; // 커밋 해시
  message: string; // 제목+본문 전체
  author: string;
  timestamp?: number; // epoch ms
  /**
   * 머지 커밋(부모 2개 이상)인지 — PR 초안 제외·목록 흐림 표시에 쓴다.
   * 젠킨스 경로는 부모 정보가 없어 채우지 않는다(undefined = 알 수 없음).
   */
  isMerge?: boolean;
  /**
   * 다른 주요 브랜치에 이미 들어가 있는 커밋이면 그 브랜치명 (예: 'main').
   * PR 미리보기(compare) 경로만 채운다 — main 머지를 거친 브랜치를 develop 으로
   * PR 할 때 같은 커밋이 제목·본문에 또 나오는 것을 거르는 근거.
   */
  alreadyIn?: string;
};

/**
 * 머지 커밋 판별 (main·렌더러 공용) — `parents` 로 채워 준 `isMerge` 가 정본이고,
 * 값이 없는 경로(젠킨스 changeSet 등)에서만 메시지 패턴으로 보조 판정한다.
 */
export function isMergeCommit(c: Pick<DeployCommit, "message" | "isMerge">): boolean {
  return (
    c.isMerge ??
    /^Merge (branch|pull request|remote-tracking|commit)\b/i.test(
      c.message.split("\n")[0]?.trim() ?? "",
    )
  );
}

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

// ── PR 대시보드 (Gitea) ──

/** 열린 PR 한 건 */
export type PrItem = {
  repo: string; // owner/repo
  number: number;
  title: string;
  author: string;
  createdAt?: number; // epoch ms
  updatedAt?: number;
  url: string; // 브라우저로 열 PR 페이지
  approvals?: number; // 승인(APPROVED) 리뷰어 수 — 조회 실패 시 undefined
  head?: string; // 원본 브랜치 — 조회 실패 시 undefined (전역 검색 API 가 안 준다)
  base?: string; // 대상 브랜치 (어디로 머지되는지)
  mergeable?: boolean; // 컨플릭트 없이 머지 가능한지 — 저장소별 /pulls 에서 보강 (실패 시 undefined)
};

export type PrListResult = {
  ok: boolean;
  configured: boolean; // Gitea 주소가 설정돼 있는지
  prs?: PrItem[];
  error?: string;
};

/** PR 탭 설정 — 조직 제외 필터. 빠른 PR 저장소는 프로젝트 레지스트리에서 파생 */
export type PrsConfig = {
  excludedOrgs: string[];
  /** 저장소(owner/repo) → 마지막으로 PR 대상(base)으로 고른 브랜치 — 다음 PR 의 기본 선택값 */
  recentBases: Record<string, string>;
};

/**
 * 주요(장수) 브랜치 관례 순위 — 작을수록 상단, 해당 없으면 null.
 * base 후보 정렬과 head 후보 제외에 같은 기준을 쓴다(보호 설정이 없는 저장소 대비).
 */
export function mainBranchRank(name: string): number | null {
  const exact = ["main", "master", "develop", "development", "staging", "qa"];
  const i = exact.indexOf(name);
  if (i >= 0) return i;
  if (/^release([/-]|$)/.test(name)) return 10;
  if (/^hotfix([/-]|$)/.test(name)) return 11;
  return null;
}

/** 원격 브랜치 요약 (빠른 PR 후보) */
export type PrBranch = {
  name: string;
  committedAt?: number; // 마지막 커밋 시각 (epoch ms)
  lastMessage?: string; // 마지막 커밋 제목
  author?: string; // 마지막 커밋 작성자(계정명 우선) — Gitea 버전에 따라 없을 수 있다
};

export type PrBranchesResult = {
  ok: boolean;
  branches?: PrBranch[];
  error?: string;
};

/** PR 대상(base) 후보 브랜치 — 저장소 기본 + 보호 + 관례 주요 브랜치만 */
export type PrBaseBranch = {
  name: string;
  isDefault?: boolean; // Gitea 저장소가 선언한 default_branch
  protected?: boolean; // 보호 브랜치 — 선택 시 타이핑 확인을 요구한다
  committedAt?: number;
  lastMessage?: string;
};

export type PrBaseBranchesResult = {
  ok: boolean;
  branches?: PrBaseBranch[];
  defaultBranch?: string; // Gitea default_branch (조회 실패 시 undefined)
  error?: string;
};

/** 저장소의 전체 브랜치 이름 (base 검색용 — 이름 사전순) */
export type PrAllBranchesResult = {
  ok: boolean;
  names?: string[];
  error?: string;
};

/** 변경 파일 한 건 (PR 생성 미리보기용) */
export type PrChangedFile = {
  path: string;
  status: string; // added / modified / removed …
};

/** head 브랜치가 base 대비 갖고 있는 커밋·변경 요약 (PR 생성 미리보기용) */
export type PrCommitsResult = {
  ok: boolean;
  commits?: DeployCommit[];
  files?: PrChangedFile[]; // 커밋 전체에서 중복 제거한 변경 파일
  stats?: { additions: number; deletions: number }; // 커밋별 증감 합산 (근사치)
  error?: string;
};

export type PrCreateInput = {
  repo: string; // owner/repo
  head: string;
  base: string;
  title: string;
  body?: string;
};

export type PrCreateResult = {
  ok: boolean;
  number?: number;
  url?: string;
  error?: string;
};

/** 머지 전 상태 — mergeable(컨플릭트 없음) 여부 + 머지 방향 */
export type PrMergeInfoResult = {
  ok: boolean;
  mergeable?: boolean;
  title?: string;
  head?: string; // 원본 브랜치
  base?: string; // 대상 브랜치
  error?: string;
};

/**
 * 저장소 열린 PR 의 충돌 여부만 (PR 번호 → mergeable) — 머지 직후 재검사 창에서
 * 목록 전체 조회 대신 1요청으로 확인한다.
 */
export type PrMergeablesResult = {
  ok: boolean;
  mergeable?: Record<number, boolean>;
  error?: string;
};

export type PrMergeMethod = "merge" | "squash" | "rebase";

export type PrMergeResult = { ok: boolean; error?: string };

/** 배포 미리보기 — 마지막 빌드 이후 저장소에 새로 쌓인 커밋 (Gitea 비교) */
export type DeployPreviewResult = {
  ok: boolean;
  configured: boolean; // Gitea 주소가 설정돼 있는지 (false 면 미리보기 생략)
  commits?: DeployCommit[];
  totalCommits?: number;
  baseRevision?: string; // 비교 기준(마지막 빌드) 커밋
  branch?: string;
  compareUrl?: string; // Gitea 비교 페이지
  error?: string;
};

// ── 프로젝트 레지스트리 (중앙 관리 지점 — 배포·PR·Nightwatch 등이 참조) ──

/** 원격 저장소 종류 — 지금은 종류·주소 저장만, API 연동은 각 기능이 담당 */
export type ProjectRemoteKind = "gitea" | "bitbucket" | "other";

/** main sanitize 와 렌더러 Select options 의 단일 소스 */
export const PROJECT_REMOTE_KINDS: ProjectRemoteKind[] = [
  "gitea",
  "bitbucket",
  "other",
];

/**
 * 원격 주소에서 owner·repo 조각 추출 (https·ssh 모두, .git·쿼리·끝 슬래시 제거) — 실패 시 null.
 *
 * ⚠️ `new URL()` 로 파싱하지 말 것 — `git@host:owner/repo` 형태에서 던진다.
 * main·렌더러의 owner/repo 파싱 정본이다(예전엔 세 곳에 제각각 있었다).
 */
export function ownerRepoPartsFromUrl(
  url: string,
): { owner: string; repo: string } | null {
  const cleaned = url
    .trim()
    .split(/[?#]/)[0]
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  if (!cleaned) return null;
  // git@host:owner/repo 또는 http(s)://host/owner/repo — 마지막 두 세그먼트
  const m = cleaned.match(/[:/]([^:/]+)\/([^:/]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** 원격 주소에서 "owner/repo" 추출 — 실패 시 null */
export function ownerRepoFromUrl(url: string): string | null {
  const parts = ownerRepoPartsFromUrl(url);
  return parts ? `${parts.owner}/${parts.repo}` : null;
}

/** 등록된 프로젝트 하나 — 비밀 없음(토큰은 환경설정 담당), 평문 JSON 저장 */
export type Project = {
  id: string;
  name: string; // 표시명 (필수)
  localPath: string; // 로컬 저장소 절대 경로 (필수)
  remoteKind: ProjectRemoteKind; // remoteUrl 이 빈 값이면 의미 없음 (기본 gitea)
  remoteUrl: string; // 원격 저장소 주소 — 빈 값이면 원격 미설정
  defaultBranch: string; // 기본 브랜치 (예: develop) — 빈 값 허용
  jiraProjectKey: string; // Jira 프로젝트 키 (예: BBJ) — 빈 값 허용, 대문자 정규화
};

export type SaveProjectInput = {
  id?: string; // 없으면 신규 생성
  name: string;
  localPath: string;
  remoteKind?: ProjectRemoteKind;
  remoteUrl?: string;
  defaultBranch?: string;
  jiraProjectKey?: string;
};

// ── VPN (OpenVPN) ──
export type VpnState = "disconnected" | "connecting" | "connected" | "error";

export type VpnStatus = {
  state: VpnState;
  detail?: string; // 진행 단계 설명 (인증 중, IP 할당 중 …)
  vpnIp?: string; // 터널 IP (연결됨일 때)
  since?: number; // 연결 시각 (epoch ms)
  error?: string;
};

/** 렌더러에 보내는 VPN 설정 — 시크릿 값은 포함하지 않음 */
// ── 미러링 (scrcpy — 안드로이드 화면 미러·제어) ──

/** mirror = 화면 미러링(+폰 화면 끔) · control = 화면 없이 키보드·마우스로 폰 조작(uhid) */
export type MirrorMode = "mirror" | "control";

/**
 * adb 가 기기를 보긴 했지만 쓸 수 없는 상태.
 * 케이블이 빠진 것과 구분해 원인별 안내를 띄우기 위한 값 — 이게 없으면
 * 승인만 남은 상태도 'USB 기기 없음' 으로 보여 케이블·포트를 의심하게 된다.
 */
export type MirrorDeviceIssue = "unauthorized" | "offline" | "no-permission";

/** 기기 문제 상태별 표시 문구·해결 힌트 (main·렌더러 공용 — 문구 중복 정의 금지) */
export const MIRROR_DEVICE_ISSUE_TEXT: Record<
  MirrorDeviceIssue,
  { label: string; hint: string }
> = {
  unauthorized: {
    label: "USB 디버깅 승인 필요",
    hint: '폰 화면 잠금을 풀고 허용 팝업에서 "이 컴퓨터에서 항상 허용" 을 체크하세요. 팝업이 없으면 개발자 옵션 → USB 디버깅 승인 취소 후 재연결.',
  },
  offline: {
    label: "기기 오프라인",
    hint: "USB 케이블을 다시 꽂거나 폰을 재부팅하세요.",
  },
  "no-permission": {
    label: "USB 접근 권한 없음",
    hint: "adb 가 기기에 접근할 수 없습니다. 케이블을 다시 꽂아 보세요.",
  },
};

export type MirrorStatus = {
  installed: boolean; // scrcpy 바이너리 존재 여부 (Homebrew)
  running: MirrorMode | null; // 실행 중인 모드 (한 번에 하나만)
  device: string | null; // 바로 쓸 수 있는 기기 모델명 ('device' 상태만, 없으면 null)
  deviceIssue?: MirrorDeviceIssue; // 기기는 붙어 있으나 쓸 수 없는 이유
  error?: string; // 마지막 비정상 종료 사유
};

export type MirrorActionResult = { ok: boolean; error?: string };

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

// ── 딥링크 (applink.kr 디퍼드 딥링크 생성) ──
export type ApplinkInput = {
  canonicalUrl: string; // 딥링크 연결 대상 URL (필수, https)
  ogTitle?: string; // 공유 제목
  ogDescription?: string; // 공유 설명
  ogImageUrl?: string; // 공유 이미지 URL (https)
  desktopUrl?: string; // PC 웹브라우저 연결 대상 (옵션)
};

export type ApplinkResult = {
  ok: boolean;
  url?: string; // 생성된 단축 딥링크
  shortCode?: string;
  error?: string;
};

export type ApplinkKeyStatus = { hasKey: boolean };

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

// ── 결재 (그룹웨어 전자결재 자동 작성·상신) ──
// 야근 결재(연장근무내역서) · 지출결의서(개인) · 휴가신청서 세 가지를 '결재' 섹션이 다룬다.

/** 어떤 결재를 올릴지 — 결재 섹션의 시작 화면에서 고른다 */
export type ApprovalKind = 'overtime' | 'expend' | 'vacation';

/** 작업 진행 단계 (메인 → 렌더러 이벤트 — 폼의 진행 문구) */
export type ApprovalProgress = { step: string };

/** 입력 기본값 — 마지막으로 작성한 업무내용을 저장해 다음 입력에 미리 채운다 (시간은 매번 계산) */
export type OvertimeDefaults = {
  target: string; // 업무 대상 (예: A프로젝트)
  content: string; // 수행 내용
  reason: string; // 연장근무 사유
};

export type OvertimeSubmitInput = OvertimeDefaults & {
  date: string; // 연장근무일 "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
};

export type OvertimeSubmitResult = {
  ok: boolean;
  title?: string; // 작성된 문서 제목
  error?: string;
};

/** 상신 진행 단계 (호환용 별칭 — 야근 결재 모달이 쓰던 이름) */
export type OvertimeProgress = ApprovalProgress;

/** 지출결의서 — 석식대 한 줄 (연장근로 석식비) */
export type ExpendDinner = {
  date: string; // 증빙일자 "YYYY-MM-DD"
  amount: number; // 공급대가
};

export type ExpendInput = {
  /** 주차요금 대상 월 "YYYY-MM" — 적요의 'N월'·증빙일자(그 달 말일)에 쓰인다 */
  month: string;
  /** 주차요금 (주차권 매수) — 넣지 않으면 null */
  parking: { manCount: number; halfCount: number } | null;
  /** 석식대 (여러 건) */
  dinners: ExpendDinner[];
};

/** 지출결의서 기본값 — 주차권 매수는 매달 비슷하므로 저장해 재사용한다 */
export type ExpendDefaults = {
  manCount: number; // 만원권 매수
  halfCount: number; // 5천원권 매수
};

export type ExpendResult = {
  ok: boolean;
  added?: number; // 실제로 작성된 항목 수
  itemCount?: number; // 작성하려던 항목 수
  error?: string;
};

/** 휴가신청서 인수인계 한 줄 — "[프로젝트명]: [팀원1], [팀원2]" 로 문서에 들어간다 */
export type VacationHandover = {
  project: string;
  members: string; // 쉼표로 구분된 팀원 이름
};

/** 휴가신청서 기본값 — 매번 같은 값(비상연락망·인수인계)을 저장해 재사용한다 */
export type VacationDefaults = {
  emergencyContact: string; // 비상연락망 (본인 번호)
  handovers: VacationHandover[];
};

/** 휴가신청서 — 근태구분(연차·반차·시차 등) */
export type VacationInput = {
  attDivName: string; // 근태구분 문구 (화면 콤보의 attDivName 과 동일 — 예: 연차)
  fromDate: string; // 시작일자 "YYYY-MM-DD"
  toDate: string; // 종료일자 "YYYY-MM-DD"
  title: string; // 제목 (기본값은 렌더러가 만들어 미리 채운다)
  remark: string; // 비고 (빈 값 허용)
  /** 전자결재 본문의 '사유' 체크 항목 문구 (예: 휴식 · 여행 · 기타) */
  reason: string;
  /** 사유가 '기타' 일 때 괄호에 넣을 문구 */
  reasonEtc?: string;
  emergencyContact: string; // 본문 '비상연락망'
  handovers: VacationHandover[]; // 본문 '인수인계'
  /** 일정등록 캘린더 문구 조각 — 비우면 기본값(부재공유) */
  calendarText?: string;
  /** 시차·반차 사용 시간대 "HH:MM" — 제목의 (00:00~00:00) 표기 (표기 표준) */
  useStartTime?: string;
  useEndTime?: string;
  /** 대체휴가의 근거 휴일근무일 "YYYY-MM-DD" — 제목의 (휴일근무일: 00/00) 표기 */
  holidayWorkDate?: string;
};

export type VacationResult = {
  ok: boolean;
  title?: string; // 작성된 문서 제목
  dayCount?: string; // 화면이 계산한 신청일수
  useDayCount?: string; // 화면이 계산한 연차차감
  /** [결재상신] 이후 전자결재 문서 창까지 열려 내용이 채워졌는지 */
  eaReady?: boolean;
  /** 본문에서 자동으로 채우지 못한 항목 (사용자가 창에서 직접 채워야 한다) */
  missed?: string[];
  error?: string;
};

/** 휴가 현황 — 연차 잔여 + 제목 자동 생성에 쓰는 신청자 정보 */
export type VacationStatus = {
  total: string; // 총 연차일수
  used: string; // 사용일수
  rest: string; // 잔여연차
  progress: string; // 결재 진행 연차
  name: string; // 신청자 이름 (소속은 환경설정 '결재 소속' 에서 온다)
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

// ── Nightwatch (Jira 버그 티켓 헤드리스 분석 — 수동 실행 + 자동 순회) ──
export type NightwatchTicket = {
  key: string;
  status: string; // in_progress | analyzed | failed | violation_edited …
  title?: string | null; // 티켓 명칭 (Jira summary)
  summary?: string | null; // 분석 결과 한 줄 요약 (result.json)
  startedAt?: string;
  finishedAt?: string;
  durationMin?: number | null;
  costUsd?: number | null; // 미션 실제 비용 (stream result 이벤트)
  repo?: string | null; // 분석한 저장소 이름
  model?: string | null; // 미션에 지정한 모델 (없으면 CLI 기본)
  report?: boolean; // 분석 리포트 파일 존재 여부
  prompt?: boolean; // 작업 프롬프트 파일 존재 여부 (fixable 일 때 생성)
  error?: string | null;
};

/** 분석 실행 옵션 — [분석] 모달에서 선택. 비우면 기존 동작(CLI 기본 모델·노트 없음) */
export type NightwatchAnalyzeOpts = {
  model?: string | null; // claude CLI --model 별칭 (opus | sonnet | haiku)
  note?: string | null; // 미션 프롬프트에 첨부할 사용자 부가설명
};

/**
 * 자동 순회 설정 — 켜두면 스케줄러가 미처리 후보를 알아서 한 건씩 분석한다.
 * 시각 스케줄은 없다(토글이 곧 스위치): 켜져 있는 동안 주기적으로 후보를 확인하고,
 * 분석 이력이 있는 티켓은 후보에서 빠지므로 소진되면 조용히 대기한다.
 */
export type NightwatchAutoConfig = {
  enabled: boolean; // 자동 순회 on/off — 이 값만으로 스케줄러가 붙었다 떨어진다
  model: string | null; // 자동 분석 모델 (claude CLI --model 별칭, null 이면 CLI 기본)
  maxPerDay: number; // 하루 최대 자동 분석 건수 — 0 이면 무제한
  /**
   * 자동 순회가 고를 수 있는 저장소 id (프로젝트 레지스트리 기준) — **빈 배열이면 제한 없음**.
   * 3단 폴백 전체(학습값·claude 선택·Jira 키 일치)에 걸리는 게이트다. FE 담당인데 원인이
   * 서버에 있는 티켓이면 모델이 api 저장소를 고르는 게 합리적 판단이라, 후보 자체를 좁히지
   * 않으면 막을 수 없다. 수동 [분석]에는 적용하지 않는다(필요할 때 직접 고를 수 있어야 한다).
   */
  repoIds: string[];
};

// 폼 친화적으로 평평하게 유지 — 저장은 userData/nightwatch/config.json
// (분석 대상 저장소는 프로젝트 레지스트리(Project)를 참조 — 자체 목록 없음)
export type NightwatchConfig = {
  claudeConfigDir: string; // 분석 세션 Claude 계정 (~/.claude | ~/.claude-team)
  timeoutMinutes: number; // 티켓당 미션 타임아웃
  auto: NightwatchAutoConfig; // 자동 순회
};

// 분석 후보 티켓 — Jira 섹션과 같은 '내 미해결 이슈' + 직접 추가한 티켓 (숨김 처리한 티켓 제외)
export type NightwatchCandidate = {
  key: string;
  summary: string;
  issueType: string; // 버그 · 작업 · 하위 작업 …
  status: string; // 해야 할 일 · 진행 중 …
  priority: string | null;
  pinned?: boolean; // Jira 섹션에서 직접 추가한 티켓 (내 담당이 아닐 수 있다)
  resolved?: boolean; // 해결·완료 상태 — pinned 라서 후보에 남은 경우에만 true 가 된다
  processedStatus: string | null; // 원장에 이미 있으면 그 상태 (재분석 가능)
  suggestedRepoId: string | null; // 같은 프로젝트·말머리로 마지막에 고른 저장소 (학습형 기본값)
};

export type NightwatchCandidatesResult = {
  ok: boolean;
  candidates?: NightwatchCandidate[];
  hiddenCount?: number; // 숨김 처리로 목록에서 빠진 티켓 수
  error?: string;
};

/** 자동 순회 진행 현황 — 하루 단위로 리셋된다 (userData/nightwatch/auto-state.json) */
export type NightwatchAutoState = {
  date: string; // 로컬 날짜 키 (YYYY-MM-DD) — 바뀌면 count·skipped 리셋
  count: number; // 오늘 자동으로 시작한 분석 건수
  skipped: string[]; // 오늘 저장소를 정하지 못해 건너뛴 티켓 키 (하루 1회만 시도)
  lastCheckAt?: string; // 마지막 후보 확인 시각 (ISO)
  lastPick?: string | null; // 마지막 자동 선택 결과 요약 (UI 표시용)
  lastError?: string | null; // 마지막 확인 실패 사유 (Jira 조회 실패 등)
};

export type NightwatchStatus = {
  jiraConfigured: boolean; // 환경설정 → 연동의 Jira 주소·이메일·토큰 완비 여부
  claudeFound: boolean; // claude 바이너리 탐지 여부
  running: boolean; // 지금 분석 실행 중 여부
  currentTicket?: string; // 실행 중인 티켓 키
  queue: string[]; // 대기열 티켓 키 (실행 중일 때 추가된 순서)
  lastRunAt?: string; // 마지막 분석 시각 (ISO)
  jiraBaseUrl?: string; // 티켓 키 클릭 시 브라우저 링크용
  config: NightwatchConfig;
  auto: NightwatchAutoState; // 자동 순회 진행 현황
  autoRunning: boolean; // 스케줄러 타이머가 붙어 있는지 (설정 enabled 와 동기)
  tickets: NightwatchTicket[];
};

export type NightwatchCommandResult = { ok: boolean; output: string };
export type NightwatchTextResult = {
  ok: boolean;
  content?: string;
  error?: string;
};

// ── 메일 (비즈박스 그룹웨어) ──

/** 메일 목록 폴더 — 받은편지함 / 스팸메일함 */
export type MailFolder = 'inbox' | 'spam';

/** 메일 목록 조회 조건 — 폴더 + 페이지네이션 */
export type MailListQuery = {
  folder?: MailFolder; // 기본 inbox
  page?: number; // 1-based, 기본 1
  pageSize?: number; // 기본 30
};

/** 받은편지함 메일 한 건 (목록용 요약) */
export type MailItem = {
  muid: number; // 메일 고유 id (본문 조회 키)
  subject: string;
  from: string; // 발신자 (표시명 또는 주소)
  date: number; // 수신 시각 (epoch ms — 파싱 실패 시 0)
  seen: boolean; // 읽음 여부 (false = 안읽음)
  hasAttach: boolean; // 첨부 존재 여부
  size: number; // 바이트
};

/** 폴더별 안읽음 수 — 리더 모달 세그먼트에서 탭 전환 없이 안읽음 유무를 알리는 용도 */
export type MailFolderUnread = Record<MailFolder, number>;

/** 메일 목록 조회 결과 — 안읽은 수(뱃지) + 해당 페이지 목록 */
export type MailInboxResult = {
  ok: boolean;
  configured: boolean; // 비즈박스 계정(환경설정) 설정 여부
  unreadCount: number; // 안읽은 메일 총 수 (받은편지함 + 스팸, 보낸·임시·휴지통 제외)
  folderUnread?: MailFolderUnread; // 폴더별 안읽음 수 (getMailBoxCount 의 unseen — 추가 왕복 없음)
  items?: MailItem[];
  total?: number; // 폴더 전체 건수 (TotalRecordCount) — 페이지 수 계산용
  page?: number; // 이 응답의 페이지 (요청과 대조해 뒤늦은 응답 무시)
  error?: string;
};

/** 안읽은 수만 조회 (위젯 폴링용 경량 — 목록 없이 getMailBoxCount 만, 스팸 포함) */
export type MailUnreadCountResult = {
  ok: boolean;
  configured: boolean;
  unreadCount: number;
  error?: string;
};

/** 메일 본문 (readMail 메타 + readMailCont HTML) */
export type MailBody = {
  muid: number;
  subject: string;
  from: string;
  to: string;
  date: string; // 원문 일시 문자열 (decodeMime.date)
  html: string; // sanitize 된 본문 HTML (sandbox iframe 렌더용)
  webUrl: string; // 그룹웨어 메일 열기 링크
};

export type MailBodyResult = {
  ok: boolean;
  body?: MailBody;
  error?: string;
};

/**
 * 팀 공용 메일 계정 (피그마 인증코드 조회용) — 비밀번호는 main 에만 있고 렌더러로 오지 않는다.
 * 환경설정의 비즈박스 계정과는 별개다.
 */
export type AltMailAccount = {
  loginId: string;
};

/** 계정 등록·삭제 결과 (갱신된 목록을 함께 돌려준다) */
export type AltMailAccountsResult = {
  ok: boolean;
  accounts?: AltMailAccount[];
  error?: string;
};

/** 인증코드 조회 결과 */
export type AuthCodeResult = {
  ok: boolean;
  /** ⚠️ 문자열이다 — 코드가 0으로 시작할 수 있어(실측 `0432458`) 숫자로 다루면 깨진다 */
  code?: string;
  receivedAt?: number; // 메일 도착 시각 (epoch ms)
  subject?: string;
  /** 유효 시간(10분)을 넘긴 코드 — 값은 주되 UI 에서 만료 가능성을 알린다 */
  stale?: boolean;
  error?: string;
};

// ── 터미널 (앱 내 터미널 — 메인 프로세스가 PTY 소유, 데스크톱·MO 가 같은 세션 공유) ──

/** 세션에서 자동 실행하는 AI 에이전트 CLI — 'shell' 은 순수 셸(자동 실행 없음) */
export type TerminalAgentId =
  | 'shell'
  | 'claude'
  | 'femc'
  | 'codex'
  | 'gemini';

/** 에이전트 표시명 — main(알림 문구)·렌더러(목록)·MO 가 공용 */
export const TERMINAL_AGENT_NAMES: Record<TerminalAgentId, string> = {
  shell: '셸',
  claude: 'Claude Code',
  femc: 'FEMC',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
};

/**
 * 세션 상태 — main 의 출력/침묵 휴리스틱이 판정한다.
 * busy: 작업 중(스피너 포함) · waiting: 턴 종료 후 입력 대기(알림 대상) · idle: 그 외
 */
export type TerminalSessionStatus = 'busy' | 'waiting' | 'idle';

/** 에이전트 선택지 — installed 는 로그인 셸 PATH 기준 설치 감지 결과 */
export type TerminalAgentInfo = {
  id: TerminalAgentId;
  name: string;
  installed: boolean;
};

/** 입력대기 알림 강도 — 뱃지(사이드바·독)는 레벨 무관 항상 표시 */
export type TerminalNotifyLevel = 'badge' | 'sound' | 'alert';

/** 터미널 세션 요약 — 데스크톱 목록·모바일 세션 목록 공용 */
export type TerminalSessionInfo = {
  id: string;
  title: string; // 표시명 (프로젝트명 또는 cwd 마지막 폴더명)
  cwd: string; // 시작 작업 디렉터리
  cols: number; // 현재 PTY 크기
  rows: number;
  agentId: TerminalAgentId;
  projectId?: string; // 프로젝트 레지스트리 id (홈이면 없음)
  projectName?: string; // 표시용 — MO 가 재조회 없이 쓴다
  status: TerminalSessionStatus;
  /** busy 중에서도 **출력이 이어지는 것이 확인된** 상태 — 로딩 표시(LNB)의 조건.
   *  busy 는 리렌더 한 프레임에도 켜지므로(스크롤·타이핑) 그대로 쓰면 오탐이 된다.
   *  판정 규칙은 main 의 `pty.ts` 의 `WORKING_MIN_MS` 주석 참고. */
  working: boolean;
  createdAt: number;
};

// ── 터미널 팝아웃 창 — 세션↔창 배정의 정본은 main(windows.ts), 렌더러는 미러 ──

/** 팝아웃 창 요약 — `terminal:windows` 브로드캐스트 payload (전체 목록 탑재) */
export type TerminalWindowInfo = {
  id: string; // popoutId — 창·windowState·레이아웃 selKey(`win:<id>`)의 축
  sessionIds: string[];
};

/** 창 간 드래그 중계 — `terminal:dragState` 브로드캐스트. null = 드래그 없음 */
export type TerminalDragState = {
  sessionId: string;
  /** 'main' | popoutId — 수신 창이 자기가 소스인지 판정한다 */
  sourceWindowId: string;
  /** 그룹 통탭 드래그면 멤버 전원 (sessionId 포함) */
  groupIds?: string[];
} | null;

/** 팝아웃 창 열기 입력 — 창 밖 드롭이 부른다 */
export type TerminalPopoutOpenInput = {
  sessionIds: string[];
  /** 그룹째 분리 시 직렬화된 분할 트리(JSON) — 팝아웃 init 이 1회 소비한다 */
  layout?: string;
  /** dragend 의 screen 좌표 — 창을 그 자리에 띄운다 (없으면 중앙) */
  x?: number;
  y?: number;
};

/** 새 세션 생성 옵션 */
export type TerminalCreateInput = {
  cwd?: string; // 없으면 홈 디렉터리
  projectId?: string; // 있으면 프로젝트 레지스트리에서 cwd 해석 (cwd 보다 우선)
  agentId?: TerminalAgentId; // 기본 'shell'
  command?: string; // 셸이 뜬 뒤 자동 실행할 명령 — 지정 시 agentId 의 기본 명령 대신 사용 (프리셋)
  title?: string; // 세션 표시명 — 없으면 프로젝트명/폴더명 (프리셋은 프리셋 이름)
  cols?: number;
  rows?: number;
};

/** attach 결과 — 링버퍼 replay(스크롤백 복원용) + 현재 PTY 크기 */
export type TerminalAttachResult = {
  ok: boolean;
  replay?: string;
  seq?: number; // 이 값 이하의 라이브 출력 이벤트는 replay 에 이미 포함 (중복 제거 기준)
  alt?: boolean; // 세션이 대체 화면(TUI)이라 replay 를 생략함 — 클라이언트가 ?1049h 를 합성해 xterm 모델을 맞춘다
  cols?: number;
  rows?: number;
  error?: string;
};

/** MO(모바일) 접속 서버 상태 */
export type TerminalServerStatus = {
  running: boolean;
  port: number;
  urls: string[]; // 폰 앱 셸(`/`) 접속 URL 후보 — 토큰 포함 (QR/복사용)
  terminalUrls: string[]; // 터미널 페이지(`/terminal/`) 접속 URL 후보
  // TLS 없이 평문 HTTP 로 떴는가. 이때 서버는 Tailscale 주소에만 바인딩되지만(같은 Wi-Fi 노출 방지)
  // 전송이 암호화되지 않아 PWA 설치·클립보드 API 가 막힌다 — 접속 화면에서 안내한다
  insecure?: boolean;
  // Tailscale 이 연결되지 않아 시작을 거부했는가 — 기다리면 풀릴 수 있는 사유라
  // 자동 시작은 이 값을 보고 재시도한다(포트 충돌 등은 재시도하지 않는다)
  needsTailscale?: boolean;
  error?: string; // 포트 충돌·Tailscale 미연결 등 시작 실패 사유
};

// ── 터미널 워크스페이스 (터미널 섹션 전용 저장소 목록 — 프로젝트 레지스트리와 별개) ──

/**
 * 터미널 워크스페이스 — LNB 최상위 항목, 폴더 하나 (비밀 없음, 평문 JSON).
 * git 저장소면 그 워크트리들이 자식 항목이 되고, 일반 폴더면 그 폴더 하나가 유일한
 * 항목이다(`WorktreeInfo.plain`). 저장소인지는 저장하지 않고 조회 때마다 git 이 판정한다 —
 * 나중에 `git init` 해도 목록이 따라간다.
 */
export type TerminalWorkspace = {
  id: string;
  name: string; // 표시명 (기본: 폴더명)
  repoPath: string; // 폴더 절대 경로 (git 저장소면 주 워크트리 루트)
  color?: number; // 타일 색 — 차트 팔레트 인덱스(1..10). 없으면 이름 해시로 자동 배정
};

export type WorkspaceSaveInput = {
  id?: string; // 없으면 신규 생성
  name: string;
  repoPath: string;
  color?: number; // 1..10 — 없으면 기존 값 유지
};

/** 워크스페이스의 워크트리 하나 — `git worktree list` 결과 + 미커밋 변경량 */
export type WorktreeInfo = {
  path: string; // 워크트리 루트 절대 경로
  branch?: string; // 체크아웃 브랜치 (detached HEAD 면 없음)
  head?: string; // HEAD 축약 해시 (detached 표시용)
  isMain: boolean; // 원본 저장소(주 워크트리) 여부
  locked: boolean;
  missing: boolean; // 디렉터리가 사라진 워크트리 (prunable) — 조작 불가 표시용
  // git 저장소가 아닌 일반 폴더 워크스페이스 — main 이 합성한 단일 항목(경로 = 워크스페이스 폴더).
  // 브랜치·워크트리 추가·제거·변경사항이 없고, 세션 배치·위치 라벨·MO 트리는 그대로 동작한다
  plain?: boolean;
  dirty: boolean; // 미커밋 변경 존재 (untracked 포함)
  additions: number; // 미커밋 +줄 수 합계 (HEAD 대비 — untracked 는 안 잡힘)
  deletions: number;
};

/** 워크트리 생성 옵션 — 위치는 매번 직접 선택(부모 폴더 + 폴더명) */
export type WorktreeAddInput = {
  workspaceId: string;
  parentDir: string; // 워크트리를 만들 부모 폴더 (데스크톱 전용 채널 — 다이얼로그로 선택)
  dirName: string; // 만들 폴더 이름
  branch: string; // 체크아웃할(또는 새로 만들) 브랜치
  createBranch: boolean; // true 면 -b 로 새 브랜치 생성
  baseRef?: string; // 새 브랜치 시작점 (createBranch 일 때만 — 없으면 HEAD)
};

export type WorktreeActionResult = {
  ok: boolean;
  path?: string; // 생성된 워크트리 경로
  error?: string;
};

/**
 * 터미널 프리셋 — 프리셋 바(⚙ 옆 칩)에서 클릭 한 번으로 새 세션에 실행할 명령.
 * Superset 의 terminal_presets 와 같은 모델: 전역 목록 + 워크스페이스 스코프.
 */
export type TerminalPreset = {
  id: string;
  name: string; // 칩 표시명 (예: claude, FEMC, Run Dev)
  command: string; // 셸에 입력할 명령
  workspaceIds?: string[]; // 이 워크스페이스들에서만 노출 — 없으면 전역
  pinned?: boolean; // false 면 프리셋 바에서 숨김 (기본 노출 — Superset pinnedToBar)
};

/**
 * 프리셋 바·시트에 보일 프리셋 — 숨김(pinned:false) 제외 + 스코프 필터.
 * 전역(workspaceIds 없음)은 어디서나, 지정 프리셋은 그 워크스페이스에서만.
 * ⚠️ 데스크톱(renderer)과 MO(src/mobile) 가 **같은 판정을 써야** 두 화면의
 *    프리셋 목록이 갈라지지 않으므로 shared 에 둔다.
 */
export function presetsForWorkspace(
  presets: TerminalPreset[],
  wsId: string | null
): TerminalPreset[] {
  return presets.filter(
    (p) =>
      p.pinned !== false &&
      (!p.workspaceIds || (wsId !== null && p.workspaceIds.includes(wsId)))
  );
}

/**
 * 프리셋 명령의 실행 파일명 → 에이전트 id — 상태 휴리스틱(waiting 알림)이
 * 에이전트 세션 기준이라, claude 프리셋 등은 에이전트로 태깅해 생성한다.
 * 앞의 `VAR=값` 환경 지정(JAVA_HOME=… ./gradlew 류)은 건너뛴다.
 * ⚠️ presetsForWorkspace 와 같은 이유로 shared — 폰에서 실행한 프리셋도 데스크톱과
 *    똑같이 태깅돼야 입력 대기 알림이 붙는다.
 */
export function agentIdFromCommand(command: string): TerminalAgentId {
  const bin =
    command
      .trim()
      .split(/\s+/)
      .find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? '';
  const name = bin.split('/').pop() ?? '';
  const agents: TerminalAgentId[] = ['claude', 'femc', 'codex', 'gemini'];
  return agents.find((a) => a === name) ?? 'shell';
}

/**
 * 경로 마지막 폴더명 → 워크트리 표시명 (주 워크트리는 'local').
 * ⚠️ 렌더러 터미널 기능 안에 있던 것을 shared 로 옮겼다 — Jira '작업 시작' 모달이
 *    같은 이름을 보여주려고 `features/terminal` 배럴을 import 하면서 **폰 번들(MO)까지
 *    xterm 499KB 가 딸려 왔다**(2026-08-26 실측: MO 청크 858KB 중 566KB 가 죽은 무게).
 *    @xterm 패키지에 `sideEffects` 필드가 없어 rollup 이 버리지 못한다.
 */
export function worktreeName(wt: WorktreeInfo): string {
  if (wt.isMain) return 'local';
  const segs = wt.path.split('/').filter(Boolean);
  return segs[segs.length - 1] ?? wt.path;
}

/**
 * 워크트리의 참조 표기 — 브랜치명, detached 면 `detached @ 해시`, 일반 폴더 워크스페이스면
 * '일반 폴더', 아무것도 없으면 undefined. LNB 행의 브랜치 자리·Jira 작업 시작 모달·
 * 워크트리 제거 확인이 같은 텍스트를 쓴다(예전엔 `branch ?? head ?? ''` 를 각자 조립했다).
 */
export function worktreeRef(wt: WorktreeInfo): string | undefined {
  if (wt.plain) return '일반 폴더';
  if (wt.branch) return wt.branch;
  return wt.head ? `detached @ ${wt.head}` : undefined;
}

/** 위치 한 줄 표기 — "이름 · 참조"(LNB 툴팁·새 세션 모달). 참조가 없으면 이름만 */
export function worktreeLabel(wt: WorktreeInfo): string {
  const ref = worktreeRef(wt);
  return ref ? `${worktreeName(wt)} · ${ref}` : worktreeName(wt);
}

/** 베이스 브랜치 선택용 목록 — 로컬·원격 구분 (원격은 `origin/…` 그대로) */
export type WorkspaceBranches = {
  ok: boolean;
  current?: string; // 주 워크트리의 현재 브랜치
  locals: string[];
  remotes: string[];
  error?: string;
};

// ── 변경사항 (워킹트리 git 상태·diff·커밋·push — 터미널 우측 패널과 MO '변경' 탭 공용) ──

/**
 * 조회 대상 — ⚠️ 클라이언트는 경로를 직접 넘길 수 없다(MO 에 열리는 채널이라 임의
 * 디렉터리 차단). projectId(프로젝트 레지스트리) / sessionId(터미널 세션의 cwd) /
 * workspaceId+worktreePath(터미널 워크스페이스 — main 이 실제 워크트리인지 검증)로만
 * 지정하고 main 이 경로를 해석한다.
 */
export type ChangesTarget = {
  projectId?: string;
  sessionId?: string;
  workspaceId?: string; // 터미널 워크스페이스 id — worktreePath 없으면 주 워크트리
  worktreePath?: string; // 워크스페이스의 워크트리 경로 (workspaceId 필수, main 이 목록 대조 검증)
};

export type ChangedFileKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'conflict';

/** 워킹트리 변경 파일 한 건 (HEAD 대비 — 스테이징 여부 무관) */
export type ChangedFile = {
  path: string; // 저장소 상대 경로
  origPath?: string; // 이름 변경 전 경로 (renamed 만)
  kind: ChangedFileKind;
  untracked: boolean; // 아직 추적 안 되는 새 파일 (diff 조회 방식이 다르다)
  additions?: number; // numstat — untracked·바이너리·rename 은 없을 수 있음
  deletions?: number;
};

/** upstream 에 아직 안 올라간 커밋 (푸시 확인용 요약) */
export type ChangesCommit = { hash: string; subject: string };

/** 변경 비교 모드 — work: 워킹트리(HEAD 대비) · branch: 베이스 브랜치(main) 분기점 대비 */
export type ChangesMode = 'work' | 'branch';

export type ChangesStatus = {
  ok: boolean;
  repo: boolean; // git 저장소인가 (아니면 나머지 필드 없음)
  branch?: string;
  upstream?: string; // 없으면 아직 push 안 한 새 브랜치 (푸시는 -u 로)
  ahead?: number; // upstream 대비 안 푸시된 커밋 수
  behind?: number;
  baseBranch?: string; // 비교 가능한 베이스 브랜치(main/master) — 지금 그 브랜치에 있으면 없음
  files?: ChangedFile[]; // work: HEAD 대비 · branch: 분기점 대비(커밋된 것 + 워킹트리)
  unpushed?: ChangesCommit[]; // 최근 20개
  error?: string;
};

/** diff 조회 시 파일 지정 — ChangedFile 에서 필요한 것만 */
export type ChangesDiffFile = {
  path: string;
  origPath?: string;
  untracked?: boolean;
};

/** diff 기준 — 생략하면 워킹트리(HEAD 대비) */
export type ChangesDiffScope = {
  mode?: ChangesMode; // 'branch' 면 베이스 브랜치 분기점(merge-base) 대비
  commit?: string; // 있으면 그 커밋 한 건의 변경 (mode 는 무시)
  full?: boolean; // true 면 전체 파일 context — 사이드-바이-사이드 '변경 전/후 파일' 뷰용
};

/** 커밋 목록 한 건 (changes:log — 커밋 섹션) */
export type ChangesLogEntry = {
  hash: string;
  subject: string;
  date: number; // author date epoch 초 — 상대 시간 표시용
  unpushed: boolean; // upstream 에 아직 없는 커밋 (upstream 없으면 전부 true)
  isMerge: boolean; // 머지 커밋(부모 2개 이상) — 목록에서 흐리게 표시
};

export type ChangesLogResult = {
  ok: boolean;
  commits?: ChangesLogEntry[];
  error?: string;
};

/** 커밋 한 건의 변경 파일 목록 (changes:commit-files) */
export type ChangesCommitFilesResult = {
  ok: boolean;
  files?: ChangedFile[];
  error?: string;
};

export type ChangesDiffResult = {
  ok: boolean;
  diff?: string;
  binary?: boolean; // 바이너리 파일 — diff 본문 대신 안내 표시
  truncated?: boolean; // 표시 상한 초과로 잘림
  error?: string;
  /** diff 본문의 내용 해시 — 다음 조회에 `knownHash` 로 되돌려주면 증분 응답을 받는다 */
  hash?: string;
  /**
   * 보낸 `knownHash` 와 내용이 같아 **본문을 생략**했다는 표시.
   * 5초 폴링이 매번 최대 512KB 를 실어 나르던 것을 없앤다 — 이때 `diff` 는 비어 있으므로
   * 호출부는 화면에 이미 있는 내용을 그대로 두어야 한다(덮어쓰면 diff 가 사라진다).
   */
  unchanged?: boolean;
};

export type ChangesPushResult = {
  ok: boolean;
  output?: string; // git push 출력 tail (성공·실패 공통 — 사유 확인용)
  error?: string;
};

/** 전체 일괄 커밋(git add -A + commit) 결과 */
export type ChangesCommitResult = {
  ok: boolean;
  hash?: string; // 만들어진 커밋 축약 해시
  error?: string;
};
