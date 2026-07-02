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
};

export type SaveSettingsInput = {
  bizboxId: string;
  password?: string; // 빈 값이면 기존 비밀번호 유지
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
