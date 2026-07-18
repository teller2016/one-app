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
  theme: ThemePref; // 테마 (기본 system)
};

export type SaveSettingsInput = {
  bizboxId: string;
  password?: string; // 빈 값이면 기존 비밀번호 유지
  notifyDeploy?: boolean; // 미지정이면 기존 유지
  jiraUrl?: string; // 미지정이면 기존 유지
  jiraEmail?: string; // 미지정이면 기존 유지
  jiraToken?: string; // 빈 값이면 기존 유지
  giteaUrl?: string; // 미지정이면 기존 유지
  giteaToken?: string; // 빈 값이면 기존 유지
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
  priority: string | null;
  updatedAt: string; // ISO
  url: string; // 브라우저로 열 이슈 링크
};

export type JiraListResult = {
  ok: boolean;
  configured: boolean; // 주소·이메일·토큰이 모두 설정됐는지
  issues?: JiraIssue[];
  error?: string;
};

export type JiraActionResult = { ok: boolean; error?: string };

/** 이슈에서 지금 실행 가능한 상태 전환 하나 (name = 목적지 상태 이름) */
export type JiraTransition = { id: string; name: string };

export type JiraTransitionsResult = {
  ok: boolean;
  transitions?: JiraTransition[];
  error?: string;
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
};

export type PrListResult = {
  ok: boolean;
  configured: boolean; // Gitea 주소가 설정돼 있는지
  prs?: PrItem[];
  error?: string;
};

/** PR 탭 설정 — 조직 제외 필터(목록·알림 공용) + 빠른 PR 저장소 목록 */
export type PrsConfig = {
  excludedOrgs: string[];
  repos: string[]; // "owner/repo" — 빠른 PR(생성)에 쓸 즐겨찾기 저장소
};

/** 원격 브랜치 요약 (빠른 PR 후보) */
export type PrBranch = {
  name: string;
  committedAt?: number; // 마지막 커밋 시각 (epoch ms)
  lastMessage?: string; // 마지막 커밋 제목
};

export type PrBranchesResult = {
  ok: boolean;
  branches?: PrBranch[];
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

/** 머지 전 상태 — mergeable(컨플릭트 없음) 여부 */
export type PrMergeInfoResult = {
  ok: boolean;
  mergeable?: boolean;
  title?: string;
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

export type MirrorStatus = {
  installed: boolean; // scrcpy 바이너리 존재 여부 (Homebrew)
  running: MirrorMode | null; // 실행 중인 모드 (한 번에 하나만)
  device: string | null; // USB 로 연결된 기기 모델명 (없으면 null)
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

// ── Nightwatch (야간 무인 버그 분석 — one-app 내장 엔진) ──
export type NightwatchTicket = {
  key: string;
  status: string; // in_progress | analyzed | failed | violation_edited …
  classification?: string | null; // fixable | analysis-only | skip
  confidence?: number | null;
  summary?: string | null;
  startedAt?: string;
  finishedAt?: string;
  durationMin?: number | null;
  report?: boolean; // 분석 리포트 파일 존재 여부
  error?: string | null;
};

// 폼 친화적으로 평평하게 유지 — 저장은 userData/nightwatch/config.json
export type NightwatchConfig = {
  enabled: boolean; // 감시 on/off (스케줄러 게이트)
  scopePath: string; // 분석 대상 저장소 절대 경로
  jql: string; // 티켓 선별 정책 전체
  windowStart: string; // "21:00"
  windowEnd: string; // "07:00"
  weekendAllDay: boolean;
  idleMinutes: number; // 자리 비움 판정 (분)
  maxTicketsPerNight: number;
  claudeConfigDir: string; // 야간 실행 Claude 계정 (~/.claude | ~/.claude-team)
  timeoutMinutes: number; // 티켓당 미션 타임아웃
};

export type NightwatchStatus = {
  jiraConfigured: boolean; // 환경설정 → 연동의 Jira 주소·이메일·토큰 완비 여부
  workspaceReady: boolean; // 전용 워크스페이스(worktree + node_modules) 준비 여부
  claudeFound: boolean; // claude 바이너리 탐지 여부
  cycleRunning: boolean; // 지금 미션 실행 중 여부
  currentTicket?: string; // 실행 중인 티켓 키
  lastCycleAt?: string; // 마지막 사이클 시각 (ISO)
  inWindow: boolean; // 지금이 감시 시간창 안인지
  startedTonight: number; // 이번 밤 창에서 시작한 티켓 수
  jiraBaseUrl?: string; // 티켓 키 클릭 시 브라우저 링크용
  config: NightwatchConfig;
  tickets: NightwatchTicket[];
};

export type NightwatchCommandResult = { ok: boolean; output: string };
export type NightwatchTextResult = {
  ok: boolean;
  content?: string;
  error?: string;
};
