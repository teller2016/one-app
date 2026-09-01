// preload: 렌더러에 안전하게 노출할 API를 contextBridge 로 등록한다.
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import type {
  AppToastPayload,
  ScheduleNotionRecordPayload,
  ScheduleRunPayload,
  ScheduleStartConfig,
  ScheduleWorklog,
  SaveSettingsInput,
  ThemePref,
  SaveDeployProjectInput,
  DeployStatusEvent,
  SaveVpnSettingsInput,
  VpnStatus,
  WeeklyProgress,
  ReminderConfig,
  AttendanceInfo,
  PrsConfig,
  PrCreateInput,
  PrMergeMethod,
  Project,
  SaveProjectInput,
  ApplinkInput,
  JiraWorkPrepareInput,
  MirrorMode,
  MailListQuery,
  ChangesTarget,
  ChangesDiffFile,
  ChangesDiffScope,
  ChangesMode,
  TerminalCreateInput,
  TerminalDragState,
  TerminalNotifyLevel,
  TerminalPopoutOpenInput,
  TerminalPreset,
  TerminalSessionInfo,
  TerminalWindowInfo,
  TerminalWorkspace,
  WorkspaceSaveInput,
  WorktreeAddInput,
  NightwatchAnalyzeOpts,
  NightwatchConfig,
  ApprovalProgress,
  ExpendInput,
  OvertimeSubmitInput,
  VacationInput,
} from "../shared/types";
import { contextBridge, ipcRenderer, webUtils } from "electron";

// 고빈도 채널 멀티플렉서 — 세션 pane 수만큼 구독되는 채널(terminal:data 등)에
// ipcRenderer 리스너를 채널당 1개만 걸고 콜백 Set 으로 fan-out 한다.
// 없으면 세션 N개일 때 chunk 1건당 IPC 콜백이 N회 돌고, 11개부터는
// MaxListenersExceededWarning 이 뜬다(2026-08-07 성능 감사).
function makeMux<T>(channel: string) {
  const subs = new Set<(ev: T) => void>();
  let bound = false;
  return (cb: (ev: T) => void): (() => void) => {
    subs.add(cb);
    if (!bound) {
      bound = true;
      ipcRenderer.on(channel, (_e, ev: T) => {
        for (const fn of subs) fn(ev);
      });
    }
    return () => {
      subs.delete(cb);
    };
  };
}

contextBridge.exposeInMainWorld("oneApp", {
  schedule: {
    // 매크로 실행 (앱 내부에서 puppeteer 직접 실행)
    run: (payload: ScheduleRunPayload) =>
      ipcRenderer.invoke("schedule:run", payload),
    // 실행 중지 (자동화 브라우저 닫기)
    cancel: () => ipcRenderer.invoke("schedule:cancel"),
    // 노션 기록 — [노션용 복사] 텍스트를 노션 날짜 페이지에 직접 쓴다
    notionRecord: (payload: ScheduleNotionRecordPayload) =>
      ipcRenderer.invoke("schedule:notion:record", payload),
    // 작업 기록·시작 시각 조회/저장 (userData/worklog.json — 강제 종료에도 유지)
    getWorklog: () => ipcRenderer.invoke("schedule:worklog:get"),
    setWorklog: (worklog: ScheduleWorklog) =>
      ipcRenderer.invoke("schedule:worklog:set", worklog),
    // 요일별 기준 시작 시각 (재택/출근) — 등록 전 확인용, 환경설정에서 관리
    getStartConfig: () => ipcRenderer.invoke("schedule:start-config:get"),
    setStartConfig: (config: ScheduleStartConfig) =>
      ipcRenderer.invoke("schedule:start-config:set", config),
    // 실행 로그(stdout/stderr/info) 구독. 해제 함수를 반환한다.
    onOutput: (cb: (chunk: { stream: string; data: string }) => void) => {
      const listener = (_e: unknown, chunk: { stream: string; data: string }) =>
        cb(chunk);
      ipcRenderer.on("schedule:output", listener);
      return () => ipcRenderer.removeListener("schedule:output", listener);
    },
    // 프로세스 종료 이벤트 구독. 해제 함수를 반환한다.
    onDone: (cb: (info: { code: number | null }) => void) => {
      const listener = (_e: unknown, info: { code: number | null }) => cb(info);
      ipcRenderer.on("schedule:done", listener);
      return () => ipcRenderer.removeListener("schedule:done", listener);
    },
  },
  settings: {
    // 현재 설정 조회 (비밀번호 값은 오지 않고 설정 여부만)
    get: () => ipcRenderer.invoke("settings:get"),
    // 설정 저장 (비밀번호는 암호화되어 저장)
    set: (input: SaveSettingsInput) =>
      ipcRenderer.invoke("settings:set", input),
    // 테마만 즉시 저장 (다음 실행의 창 배경색 결정에 main 이 읽음)
    setTheme: (theme: ThemePref) =>
      ipcRenderer.invoke("settings:theme:set", theme),
  },
  deploy: {
    // 프로젝트 목록 조회 (토큰/비밀번호 값은 오지 않음)
    getProjects: () => ipcRenderer.invoke("deploy:projects:get"),
    // 프로젝트 추가/수정 (토큰은 암호화되어 저장). 최신 목록 반환
    saveProject: (input: SaveDeployProjectInput) =>
      ipcRenderer.invoke("deploy:projects:save", input),
    // 프로젝트 삭제. 최신 목록 반환
    deleteProject: (id: string) =>
      ipcRenderer.invoke("deploy:projects:delete", id),
    // 배포 대상별 최근 빌드 상태 조회 (targetId → status)
    // force=true 는 주기 조회 — main 의 짧은 캐시를 우회한다
    fetchStatuses: (projectId: string, force?: boolean) =>
      ipcRenderer.invoke("deploy:status:fetch", projectId, force),
    // 프로젝트(젠킨스 서버) 단위 현황(실행 중 + 대기) 조회
    fetchActivity: (projectId: string) =>
      ipcRenderer.invoke("deploy:activity:fetch", projectId),
    // 배포 실행 — 이후 진행 상태는 onStatus 로 전달됨
    trigger: (projectId: string, targetId: string) =>
      ipcRenderer.invoke("deploy:trigger", projectId, targetId),
    // 빌드 상세(커밋 내역 등) 조회. buildNumber 없으면 최근 빌드
    getBuildDetail: (
      projectId: string,
      targetId: string,
      buildNumber?: number
    ) =>
      ipcRenderer.invoke(
        "deploy:build:detail",
        projectId,
        targetId,
        buildNumber
      ),
    // 최근 빌드 이력 목록 조회
    getHistory: (projectId: string, targetId: string) =>
      ipcRenderer.invoke("deploy:history:fetch", projectId, targetId),
    // 콘솔 로그 tail 조회
    getLog: (projectId: string, targetId: string, buildNumber: number) =>
      ipcRenderer.invoke("deploy:log:fetch", projectId, targetId, buildNumber),
    // 진행 중 빌드 중지
    stopBuild: (projectId: string, targetId: string, buildNumber: number) =>
      ipcRenderer.invoke("deploy:stop", projectId, targetId, buildNumber),
    // 배포 미리보기 — 마지막 빌드 이후 저장소에 쌓인 커밋 (Gitea 비교)
    getPreview: (projectId: string, targetId: string) =>
      ipcRenderer.invoke("deploy:preview", projectId, targetId),
    // 배포 상태 이벤트 구독. 해제 함수를 반환한다.
    onStatus: (cb: (evt: DeployStatusEvent) => void) => {
      const listener = (_e: unknown, evt: DeployStatusEvent) => cb(evt);
      ipcRenderer.on("deploy:status", listener);
      return () => ipcRenderer.removeListener("deploy:status", listener);
    },
  },
  mail: {
    // 안읽은 메일 수만 (위젯 폴링용 경량 — 목록 없이 개수만)
    getUnreadCount: () => ipcRenderer.invoke("mail:unread-count"),
    // 메일 목록 — 안읽은 수 + 폴더(받은편지함·스팸)의 요청 페이지 (미설정이면 configured:false)
    getInbox: (query?: MailListQuery) =>
      ipcRenderer.invoke("mail:inbox", query),
    // 본문 조회 — unread=true 면 열 때 그룹웨어에서도 읽음 처리
    getBody: (muid: number, unread: boolean) =>
      ipcRenderer.invoke("mail:body", muid, unread),
    // 브라우저로 비즈박스 메일함 바로 열기
    openWeb: () => ipcRenderer.invoke("mail:open-web"),

    // 팀 공용 계정 인증코드(피그마) — 계정 등록·비밀 정보를 다루므로 폰에는 열지 않는다
    authCodeAccounts: () => ipcRenderer.invoke("mail:authcode:accounts"),
    saveAuthCodeAccount: (loginId: string, password: string) =>
      ipcRenderer.invoke("mail:authcode:save-account", loginId, password),
    removeAuthCodeAccount: (loginId: string) =>
      ipcRenderer.invoke("mail:authcode:remove-account", loginId),
    getAuthCode: (loginId: string) =>
      ipcRenderer.invoke("mail:authcode:fetch", loginId),
  },
  jira: {
    // 내게 할당된 미해결 이슈 목록 (미설정이면 configured:false)
    // force=true 는 수동 새로고침·전환 직후 — main 의 TTL 캐시를 우회한다
    list: (force?: boolean) => ipcRenderer.invoke("jira:list", force),
    // 이슈 상세 — 본문·댓글 HTML (앱 내 패널 표시용)
    getDetail: (key: string) => ipcRenderer.invoke("jira:detail", key),
    // 이 이슈에서 지금 가능한 상태 전환 목록 (이슈별·프로젝트별로 다름)
    getTransitions: (key: string) =>
      ipcRenderer.invoke("jira:transitions", key),
    // 상태 전환 실행
    transition: (key: string, id: string) =>
      ipcRenderer.invoke("jira:transition", key, id),
    // 해결/완료 계열 전환 자동 선택 실행 (PR 머지 직후용)
    resolve: (key: string) => ipcRenderer.invoke("jira:resolve", key),
    // 진행 계열 전환 자동 선택 실행 (작업 시작 직후용)
    startProgress: (key: string) => ipcRenderer.invoke("jira:start-progress", key),
    // 주간 활동 — 기간(YYYY-MM-DD)에 내가 작업한 티켓 + 관여도(해결/진행/연관) + 내 변경 이력
    activity: (start: string, end: string, force?: boolean) =>
      ipcRenderer.invoke("jira:activity", start, end, force),
    // 직접 추가한 티켓 (담당이 아닌데 작업해야 하는 이슈) — 목록은 jira:list 에 병합돼 온다
    added: {
      list: () => ipcRenderer.invoke("jira:added:list"),
      // 추가 전 확인 — 주소·키에서 이슈를 찾아 제목·상태를 돌려준다
      validate: (input: string) => ipcRenderer.invoke("jira:added:validate", input),
      add: (input: string) => ipcRenderer.invoke("jira:added:add", input),
      remove: (key: string) => ipcRenderer.invoke("jira:added:remove", key),
    },
    // 작업 시작 준비 — 티켓 본문·첨부를 내려받고 femc 실행 명령을 돌려준다.
    // ⚠️ 반환된 command 는 이미 셸 인용이 끝난 문자열이다. 가공하지 말고 그대로
    // terminal.create({ command }) 에 넘길 것.
    prepareWork: (input: JiraWorkPrepareInput) =>
      ipcRenderer.invoke("jira:prepare-work", input),
    // 세션을 띄울 Claude 계정 후보 (Personal/Team — 로그인 이메일 포함)
    workAccounts: () => ipcRenderer.invoke("jira:work-accounts"),
  },
  mirror: {
    // scrcpy 설치·실행 여부 + USB 기기 조회
    getStatus: () => ipcRenderer.invoke("mirror:status"),
    // 시작 — mirror(화면 미러링) / control(화면 없이 키보드·마우스 제어)
    start: (mode: MirrorMode) => ipcRenderer.invoke("mirror:start", mode),
    // 미러링 종료 (SIGTERM)
    stop: () => ipcRenderer.invoke("mirror:stop"),
    // 프로세스 시작/종료(미러 창 닫힘 포함) 알림 — 위젯이 상태 재조회
    onChanged: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on("mirror:changed", listener);
      return () => ipcRenderer.removeListener("mirror:changed", listener);
    },
  },
  vpn: {
    // VPN 설정 조회 (시크릿 값은 오지 않고 설정 여부만)
    getSettings: () => ipcRenderer.invoke("vpn:settings:get"),
    // VPN 설정 저장 (시크릿은 암호화되어 저장)
    saveSettings: (input: SaveVpnSettingsInput) =>
      ipcRenderer.invoke("vpn:settings:save", input),
    // .ovpn 설정 파일 선택 다이얼로그
    pickOvpn: () => ipcRenderer.invoke("vpn:pick-ovpn"),
    // 연결 — 진행/완료 상태는 onStatus 로도 전달됨. manualOtp 없으면 시크릿으로 자동 생성
    connect: (manualOtp?: string) =>
      ipcRenderer.invoke("vpn:connect", manualOtp),
    // 연결 해제
    disconnect: () => ipcRenderer.invoke("vpn:disconnect"),
    // 현재 상태 조회
    getStatus: () => ipcRenderer.invoke("vpn:status:get"),
    // 상태 이벤트 구독. 해제 함수를 반환한다.
    onStatus: (cb: (status: VpnStatus) => void) => {
      const listener = (_e: unknown, status: VpnStatus) => cb(status);
      ipcRenderer.on("vpn:status", listener);
      return () => ipcRenderer.removeListener("vpn:status", listener);
    },
  },
  attendance: {
    // 현재 출퇴근 시각 조회 (headless 브라우저로 그룹웨어 확인 — 수 초 소요)
    // force=true 는 수동 새로고침 — main 의 조회 캐시를 우회한다
    fetch: (force?: boolean) => ipcRenderer.invoke("attendance:fetch", force),
    // 출근/퇴근 찍기
    stamp: (action: "come" | "leave") =>
      ipcRenderer.invoke("attendance:stamp", action),
    // 출퇴근 리마인더 설정 조회/저장 (요일별 출근·퇴근 알림 시각)
    getReminders: () => ipcRenderer.invoke("reminders:get"),
    setReminders: (config: ReminderConfig) =>
      ipcRenderer.invoke("reminders:set", config),
    // 메인 프로세스(리마인더 알럿)에서 찍었을 때의 근태 변경 구독. 해제 함수를 반환한다.
    onChanged: (cb: (info: AttendanceInfo) => void) => {
      const listener = (_e: unknown, info: AttendanceInfo) => cb(info);
      ipcRenderer.on("attendance:changed", listener);
      return () => ipcRenderer.removeListener("attendance:changed", listener);
    },
    // 리마인더 알럿에서 찍는 동안('come'/'leave') 위젯을 '처리중'으로, 끝나면(null) 해제. 해제 함수 반환.
    onStamping: (cb: (action: "come" | "leave" | null) => void) => {
      const listener = (_e: unknown, action: "come" | "leave" | null) =>
        cb(action);
      ipcRenderer.on("attendance:stamping", listener);
      return () => ipcRenderer.removeListener("attendance:stamping", listener);
    },
  },
  // 결재 — 야근(연장근무내역서) · 지출결의서(개인) · 휴가신청서
  approval: {
    // 입력 기본값 조회 (마지막 작성 값)
    getOvertimeDefaults: () => ipcRenderer.invoke("approval:overtime:defaults"),
    getExpendDefaults: () => ipcRenderer.invoke("approval:expend:defaults"),
    getVacationDefaults: () => ipcRenderer.invoke("approval:vacation:defaults"),
    // 연장근무내역서 작성·상신 (자동화 창 — 수십 초 소요)
    submitOvertime: (input: OvertimeSubmitInput) =>
      ipcRenderer.invoke("approval:overtime:submit", input),
    // 지출결의서 항목 작성 (상신은 사용자가 열린 창에서 직접)
    runExpend: (input: ExpendInput) =>
      ipcRenderer.invoke("approval:expend:run", input),
    // 휴가신청서 작성 + 내역추가 + 결재상신
    submitVacation: (input: VacationInput) =>
      ipcRenderer.invoke("approval:vacation:submit", input),
    // 연차 현황 조회 (총·사용·잔여)
    vacationStatus: () => ipcRenderer.invoke("approval:vacation:status"),
    // 전자결재 상신함 창 열기 (작성 창과 별개 — 세션 주입으로 로그인 화면 없음)
    openEaBox: () => ipcRenderer.invoke("approval:open-ea-box"),
    // 진행 단계 구독 (양식 열기 → 작성 → 상신). 해제 함수를 반환한다.
    onProgress: (cb: (progress: ApprovalProgress) => void) => {
      const listener = (_e: unknown, progress: ApprovalProgress) =>
        cb(progress);
      ipcRenderer.on("approval:progress", listener);
      return () => ipcRenderer.removeListener("approval:progress", listener);
    },
  },
  weekly: {
    // 개인별 주간 일정 수집 (headless 브라우저 — 수십 초 소요). 0=이번주, -1=지난주 / monWeek: 월~일 기준
    fetch: (weekOffset: number, monWeek?: boolean) =>
      ipcRenderer.invoke("weekly:fetch", weekOffset, monWeek),
    // 수집 진행 단계 구독. 해제 함수를 반환한다.
    onProgress: (cb: (progress: WeeklyProgress) => void) => {
      const listener = (_e: unknown, progress: WeeklyProgress) => cb(progress);
      ipcRenderer.on("weekly:progress", listener);
      return () => ipcRenderer.removeListener("weekly:progress", listener);
    },
  },
  projects: {
    // 등록된 프로젝트 목록 (프로젝트 레지스트리 — 비밀 없음)
    list: () => ipcRenderer.invoke("projects:get"),
    // 추가/수정. 최신 목록을 반환한다
    save: (input: SaveProjectInput) => ipcRenderer.invoke("projects:save", input),
    // 삭제. 최신 목록을 반환한다
    delete: (id: string) => ipcRenderer.invoke("projects:delete", id),
    // 로컬 경로 폴더 선택 다이얼로그
    pickDir: () => ipcRenderer.invoke("projects:pick-dir"),
    // 목록 변경 브로드캐스트 구독 (다른 경로의 저장 반영). 해제 함수를 반환한다.
    onChanged: (cb: (projects: Project[]) => void) => {
      const listener = (_e: unknown, projects: Project[]) => cb(projects);
      ipcRenderer.on("projects:changed", listener);
      return () => ipcRenderer.removeListener("projects:changed", listener);
    },
  },
  prs: {
    // 열린 PR 목록 조회 (Gitea — 주소 미설정이면 configured:false)
    // light=true 는 개수만 필요한 홈 카드용 — PR별 리뷰 조회(N+1)를 생략한다
    fetch: (opts?: { light?: boolean; force?: boolean }) =>
      ipcRenderer.invoke("prs:fetch", opts),
    // 설정(조직 필터 + 빠른 PR 저장소) 조회/저장
    getConfig: () => ipcRenderer.invoke("prs:config:get"),
    setConfig: (config: PrsConfig) =>
      ipcRenderer.invoke("prs:config:set", config),
    // 저장소의 최근 브랜치 목록 (빠른 PR 후보)
    getBranches: (repo: string) => ipcRenderer.invoke("prs:branches", repo),
    // PR 대상(base) 후보 — 기본·보호·관례 주요 브랜치
    getBaseBranches: (repo: string) =>
      ipcRenderer.invoke("prs:base-branches", repo),
    // 전체 브랜치 이름 (base 검색용)
    getAllBranches: (repo: string) =>
      ipcRenderer.invoke("prs:all-branches", repo),
    // base 대비 head 커밋 목록 (PR 제목/본문 자동 생성용)
    getBranchCommits: (repo: string, base: string, head: string) =>
      ipcRenderer.invoke("prs:branch-commits", repo, base, head),
    // PR 생성 (Gitea 토큰 필요)
    create: (input: PrCreateInput) => ipcRenderer.invoke("prs:create", input),
    // 머지 전 상태 확인 (컨플릭트 여부)
    getMergeInfo: (repo: string, number: number) =>
      ipcRenderer.invoke("prs:merge-info", repo, number),
    // 저장소 열린 PR 의 충돌 여부만 (1요청) — 머지 직후 재검사 창에서 짧게 폴링
    getMergeables: (repo: string) =>
      ipcRenderer.invoke("prs:mergeables", repo),
    // PR 머지 (Gitea 토큰 필요)
    merge: (repo: string, number: number, method: PrMergeMethod) =>
      ipcRenderer.invoke("prs:merge", repo, number, method),
  },
  applink: {
    // API 키 저장 여부 / 저장 (키는 메인에서 암호화 보관)
    getKeyStatus: () => ipcRenderer.invoke("applink:key:status"),
    setKey: (key: string) => ipcRenderer.invoke("applink:key:set", key),
    // 딥링크 생성
    create: (input: ApplinkInput) =>
      ipcRenderer.invoke("applink:create", input),
  },
  nightwatch: {
    // 설정·워크스페이스·실행 상태·티켓 원장 종합 조회
    getStatus: () => ipcRenderer.invoke("nightwatch:status"),
    // 설정 저장 (부분 갱신)
    saveConfig: (config: Partial<NightwatchConfig>) =>
      ipcRenderer.invoke("nightwatch:config:save", config),
    // 내 미해결 이슈 후보 목록 (숨김 제외, 저장소 기본 선택 추천 포함)
    listCandidates: () => ipcRenderer.invoke("nightwatch:candidates"),
    // 분석 불필요 티켓 숨김 / 전체 해제
    hideCandidate: (key: string) => ipcRenderer.invoke("nightwatch:hide", key),
    clearHidden: () => ipcRenderer.invoke("nightwatch:hidden:clear"),
    // 티켓 1건을 선택한 저장소에서 분석 — 완료까지 promise 가 유지된다 (수 분~타임아웃)
    analyze: (key: string, repoId: string, opts?: NightwatchAnalyzeOpts) =>
      ipcRenderer.invoke("nightwatch:analyze", key, repoId, opts),
    // 실행 중 분석 중지 (SIGTERM)
    stop: () => ipcRenderer.invoke("nightwatch:stop"),
    // 처리한 티켓 삭제 — 원장 기록 + 리포트·프롬프트·로그·첨부 파일
    deleteTicket: (key: string) => ipcRenderer.invoke("nightwatch:delete", key),
    // 티켓 분석 리포트(md) 읽기
    getReport: (key: string) => ipcRenderer.invoke("nightwatch:report", key),
    // 작업 프롬프트(md) 읽기 — 아침에 Claude Code 에 붙여넣을 작업 지시문
    getPrompt: (key: string) => ipcRenderer.invoke("nightwatch:prompt", key),
    // 미션 진행 로그 tail (실행 중 라이브 표시 + 사후 확인)
    getMissionLog: (key: string) =>
      ipcRenderer.invoke("nightwatch:mission-log", key),
    // 실행 로그 tail
    getLog: () => ipcRenderer.invoke("nightwatch:log"),
  },
  changes: {
    // 워킹트리 상태 — 브랜치·ahead/behind·변경 파일 목록
    // (projectId / sessionId / workspaceId+worktreePath 로 대상 지정)
    // mode='branch' 면 베이스 브랜치(main) 분기점 대비 목록
    status: (target: ChangesTarget, mode?: ChangesMode) =>
      ipcRenderer.invoke("changes:status", target, mode),
    // 파일 하나의 unified diff — scope 로 분기점 대비·특정 커밋의 변경 지정.
    // knownHash 를 주면 내용이 그대로일 때 본문 없이 { unchanged: true } 만 온다(폴링용)
    diff: (
      target: ChangesTarget,
      file: ChangesDiffFile,
      scope?: ChangesDiffScope,
      knownHash?: string
    ) => ipcRenderer.invoke("changes:diff", target, file, scope, knownHash),
    // 최근 커밋 목록 (미푸시 여부 포함)
    log: (target: ChangesTarget) => ipcRenderer.invoke("changes:log", target),
    // 커밋 한 건의 변경 파일 목록
    commitFiles: (target: ChangesTarget, hash: string) =>
      ipcRenderer.invoke("changes:commit-files", target, hash),
    // 전체 일괄 커밋 (git add -A + commit)
    commit: (target: ChangesTarget, message: string) =>
      ipcRenderer.invoke("changes:commit", target, message),
    // git push (upstream 없으면 -u origin HEAD 로 원격 브랜치 생성)
    push: (target: ChangesTarget) => ipcRenderer.invoke("changes:push", target),
  },
  // 터미널 워크스페이스 — LNB(워크스페이스 → 워크트리 트리) 데이터. 전부 데스크톱 전용
  workspaces: {
    list: () => ipcRenderer.invoke("workspaces:list"),
    // 추가/수정 — 저장 전에 main 이 git 저장소인지 검증한다. 최신 목록 반환
    save: (input: WorkspaceSaveInput) =>
      ipcRenderer.invoke("workspaces:save", input),
    // 삭제 (저장소·워크트리 파일은 건드리지 않음). 최신 목록 반환
    delete: (id: string) => ipcRenderer.invoke("workspaces:delete", id),
    // LNB 드래그 순서 저장. 최신 목록 반환
    reorder: (ids: string[]) => ipcRenderer.invoke("workspaces:reorder", ids),
    // 저장소 폴더를 Finder 로 열기
    reveal: (id: string) => ipcRenderer.invoke("workspaces:reveal", id),
    // 워크트리를 열 IDE(Antigravity) 설치 여부 — 버튼 노출 판단
    editorInfo: () => ipcRenderer.invoke("workspaces:editor-info"),
    // 워크트리 폴더를 IDE 로 열기 — main 이 워크트리 목록과 대조한다
    openEditor: (id: string, worktreePath: string) =>
      ipcRenderer.invoke("workspaces:open-editor", id, worktreePath),
    // 폴더 선택 다이얼로그 — 워크스페이스 등록·워크트리 위치 선택 공용
    pickDir: (title?: string) => ipcRenderer.invoke("workspaces:pick-dir", title),
    // 워크트리 목록 + 워크트리별 미커밋 변경량 (+N −M).
    // detail=false 면 경량(경로·브랜치만 — 워크트리마다 도는 git status·diff 를 건너뛴다)
    worktrees: (id: string, detail?: boolean) =>
      ipcRenderer.invoke("workspaces:worktrees", id, detail),
    // 워크트리 생성 — 부모 폴더·폴더명·브랜치(신규/기존)
    addWorktree: (input: WorktreeAddInput) =>
      ipcRenderer.invoke("workspaces:worktree-add", input),
    // 워크트리 제거 — dirty 면 force 필요 (호출부가 확인 후 지정)
    removeWorktree: (id: string, worktreePath: string, force?: boolean) =>
      ipcRenderer.invoke("workspaces:worktree-remove", id, worktreePath, force),
    // 브랜치 목록 (로컬 + 원격) — 워크트리 생성 모달의 베이스 선택용
    branches: (id: string) => ipcRenderer.invoke("workspaces:branches", id),
    // 프리셋 (프리셋 바 칩 — 전역 + 워크스페이스 스코프)
    presets: {
      get: () => ipcRenderer.invoke("workspaces:presets:get"),
      // 편집 모달이 전체 목록을 통째로 저장. 최신 목록 반환
      save: (presets: TerminalPreset[]) =>
        ipcRenderer.invoke("workspaces:presets:save", presets),
      onChanged: (cb: (presets: TerminalPreset[]) => void) => {
        const listener = (_e: unknown, presets: TerminalPreset[]) => cb(presets);
        ipcRenderer.on("workspaces:presets-changed", listener);
        return () =>
          ipcRenderer.removeListener("workspaces:presets-changed", listener);
      },
    },
    // 목록 변경 브로드캐스트 구독. 해제 함수를 반환한다.
    onChanged: (cb: (workspaces: TerminalWorkspace[]) => void) => {
      const listener = (_e: unknown, workspaces: TerminalWorkspace[]) =>
        cb(workspaces);
      ipcRenderer.on("workspaces:changed", listener);
      return () => ipcRenderer.removeListener("workspaces:changed", listener);
    },
  },
  terminal: {
    // 세션 목록 조회
    list: () => ipcRenderer.invoke("terminal:list"),
    // 새 세션 생성 (cwd 미지정 시 홈)
    create: (opts?: TerminalCreateInput) =>
      ipcRenderer.invoke("terminal:create", opts),
    // 세션 attach — 링버퍼 replay 반환 + PTY 크기를 내 크기로 (last-attach-wins)
    attach: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke("terminal:attach", id, cols, rows),
    // 세션 detach — pane 언마운트 시 호출해 안 보는 세션의 출력 방송을 멈춘다
    detach: (id: string) => ipcRenderer.send("terminal:detach", id),
    // 세션 이름 변경 (tmux 백엔드면 재시작 후에도 유지)
    rename: (id: string, title: string) =>
      ipcRenderer.invoke("terminal:rename", id, title),
    // 세션 종료 (프로세스 kill)
    kill: (id: string) => ipcRenderer.invoke("terminal:kill", id),
    // 세션 위치(cwd)를 Finder 로 열기 — 경로가 아니라 세션 id 로 지시한다
    revealCwd: (id: string) => ipcRenderer.invoke("terminal:reveal-cwd", id),
    // 에이전트 후보 목록 (로그인 셸 PATH 기준 설치 감지 포함)
    agents: () => ipcRenderer.invoke("terminal:agents"),
    // 백엔드 정보 — tmux(영속) 가용 여부 (미설치 힌트 표시용)
    backend: () => ipcRenderer.invoke("terminal:backend"),
    // 입력대기 알림 강도 (badge/sound/alert — 뱃지는 항상)
    notifyLevel: {
      get: () => ipcRenderer.invoke("terminal:notify-level:get"),
      set: (level: TerminalNotifyLevel) =>
        ipcRenderer.invoke("terminal:notify-level:set", level),
    },
    // 키 입력·리사이즈 — fire-and-forget (invoke 왕복 비용 제거)
    write: (id: string, data: string) =>
      ipcRenderer.send("terminal:write", id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send("terminal:resize", id, cols, rows),
    // 휠 스크롤 위임 (tmux 백엔드 전용) — 양수 = 위로. 반환값으로 [맨 아래로] 를 켠다
    scroll: (id: string, lines: number) =>
      ipcRenderer.invoke("terminal:scroll", id, lines),
    // 맨 아래로 = tmux copy-mode 종료
    scrollToBottom: (id: string) =>
      ipcRenderer.invoke("terminal:scroll-bottom", id),
    // 세션 출력 구독 (16ms 배칭, seq 는 attach replay 와의 중복 제거 기준).
    // 멀티플렉서 경유 — pane 수만큼 ipcRenderer 리스너가 늘지 않는다. 해제 함수를 반환한다.
    onData: makeMux<{ id: string; data: string; seq: number }>("terminal:data"),
    // 세션 종료 이벤트 구독. 해제 함수를 반환한다.
    onExit: (cb: (ev: { id: string; exitCode: number }) => void) => {
      const listener = (_e: unknown, ev: { id: string; exitCode: number }) =>
        cb(ev);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
    // 세션 목록·상태 변경 구독 — payload 로 전체 목록을 실어 재조회가 필요 없다.
    // payload 가 없으면(구버전 main 과의 개발 중 어긋남) undefined 그대로 전달 —
    // 빈 목록(마지막 세션 종료)과 구분해야 하므로 여기서 [] 로 뭉개지 않는다.
    // 해제 함수를 반환한다.
    onSessions: (cb: (sessions?: TerminalSessionInfo[]) => void) => {
      const listener = (_e: unknown, sessions?: TerminalSessionInfo[]) =>
        cb(sessions);
      ipcRenderer.on("terminal:sessions", listener);
      return () => ipcRenderer.removeListener("terminal:sessions", listener);
    },
    // PTY 크기 변경 구독 — 다른 클라이언트(MO)가 리사이즈하면 내 xterm 도 따라간다
    onResized: makeMux<{ id: string; cols: number; rows: number }>(
      "terminal:resized"
    ),
    // MO(모바일) 접속 서버 — 상태·토글(저장 겸)·토큰 재발급
    server: {
      status: () => ipcRenderer.invoke("terminal:server:status"),
      setEnabled: (enabled: boolean) =>
        ipcRenderer.invoke("terminal:server:set", enabled),
      regenToken: () => ipcRenderer.invoke("terminal:server:regen-token"),
      onChanged: (cb: () => void) => {
        const listener = () => cb();
        ipcRenderer.on("terminal:server:changed", listener);
        return () =>
          ipcRenderer.removeListener("terminal:server:changed", listener);
      },
    },
    // 팝아웃 창 — 세션↔창 배정의 정본은 main(features/terminal/windows.ts)
    windows: {
      list: () => ipcRenderer.invoke("terminal:windows:list"),
      // 창 밖 드롭 — 그 좌표에 팝아웃 창 생성 (좌표가 다른 앱 창 위면 no-op)
      open: (input: TerminalPopoutOpenInput) =>
        ipcRenderer.invoke("terminal:windows:open", input),
      focus: (id: string) => ipcRenderer.invoke("terminal:windows:focus", id),
      // 세션이 배정된 팝아웃 창 포커스 — 자리표시자 탭·토스트 [이동] 공용
      focusSession: (sessionId: string) =>
        ipcRenderer.invoke("terminal:windows:focus-session", sessionId),
      // 배정 변경 (to: 'main' | popoutId) — 크로스 윈도우 드롭·되돌리기 버튼 공용
      moveSession: (sessionId: string, to: string) =>
        ipcRenderer.invoke("terminal:windows:move-session", { sessionId, to }),
      // 되돌린 세션을 메인 창에서 열게 한다 — 메인 창이 다른 워크트리를 보고 있으면
      // 되돌린 세션이 화면에 안 나타나므로, 창 포커스 + 그 세션으로 이동까지 시킨다
      revealInMain: (sessionId: string) =>
        ipcRenderer.invoke("terminal:windows:reveal-in-main", sessionId),
      // 팝아웃 부팅 1회 — 배정 세션 + (그룹째 분리 시) 최초 분할 트리
      init: (id: string) => ipcRenderer.invoke("terminal:windows:init", id),
      // 배정 변경 구독 — payload 로 전체 목록 (terminal:sessions 관례). 해제 함수 반환
      onChanged: (cb: (windows: TerminalWindowInfo[]) => void) => {
        const listener = (_e: unknown, windows: TerminalWindowInfo[]) =>
          cb(windows);
        ipcRenderer.on("terminal:windows", listener);
        return () => ipcRenderer.removeListener("terminal:windows", listener);
      },
      // 팝아웃 렌더러의 화면 세션 보고 — 알림 게이트·창 타이틀 (fire-and-forget)
      reportVisible: (windowId: string, ids: string[]) =>
        ipcRenderer.send("terminal:windows:visible", { windowId, ids }),
      // 창 간 드래그 중계 — dragstart 에 상태를, dragend 에 null 을 보낸다
      drag: (state: TerminalDragState) =>
        ipcRenderer.send("terminal:drag", state),
      // 드래그 상태 미러 구독 — 소스가 아닌 창이 드롭 존을 켜는 신호. 해제 함수 반환
      onDragState: (cb: (state: TerminalDragState) => void) => {
        const listener = (_e: unknown, state: TerminalDragState) => cb(state);
        ipcRenderer.on("terminal:dragState", listener);
        return () => ipcRenderer.removeListener("terminal:dragState", listener);
      },
    },
    // 세션 위치 라벨 ("워크스페이스 · 워크트리") — 팝아웃 헤더 표시용
    locationLabel: (sessionId: string) =>
      ipcRenderer.invoke("terminal:location-label", sessionId),
    // 팝아웃에서 되돌린 세션을 이 창(메인)에서 열라는 신호. 해제 함수를 반환한다.
    onReveal: (cb: (req: { sessionId: string; cwd: string }) => void) => {
      const listener = (_e: unknown, req: { sessionId: string; cwd: string }) =>
        cb(req);
      ipcRenderer.on("terminal:reveal", listener);
      return () => ipcRenderer.removeListener("terminal:reveal", listener);
    },
  },
  // 로그인 시 자동 시작 조회/설정 (OS 로그인 아이템)
  getAutostart: () => ipcRenderer.invoke("app:autostart:get"),
  setAutostart: (enabled: boolean) =>
    ipcRenderer.invoke("app:autostart:set", enabled),
  // 알림 미리보기 — 샘플 데스크톱 알림을 즉시 띄운다 (권한 확인·모양 확인용)
  testNotification: () => ipcRenderer.invoke("notify:test"),
  // 기본 브라우저로 링크 열기 (http/https 만 허용)
  openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  // 드래그 앤 드롭된 File 객체의 실제 경로 — 렌더러에서는 File.path 를 읽을 수 없고
  // (Electron 32 에서 제거) webUtils 는 preload 에서만 접근 가능하다.
  // File 을 contextBridge 함수 인자로 넘기는 것이 공식 문서의 패턴이다.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // 우측 아래 토스트 알림 구독 (main 의 notifyToast — 창이 포커스일 때 알럿 대신)
  onToast: (cb: (payload: AppToastPayload) => void) => {
    const listener = (_e: unknown, payload: AppToastPayload) => cb(payload);
    ipcRenderer.on("app:toast", listener);
    return () => ipcRenderer.removeListener("app:toast", listener);
  },
  // 떠 있는 토스트 회수 신호 — 팝아웃 창이 그 세션을 화면에 올리면 main 이 보낸다
  onToastDismiss: (cb: (dedupeKey: string) => void) => {
    const listener = (_e: unknown, dedupeKey: string) => cb(dedupeKey);
    ipcRenderer.on("app:toast:dismiss", listener);
    return () => ipcRenderer.removeListener("app:toast:dismiss", listener);
  },
  // 알림 클릭 등으로 특정 섹션으로 이동하라는 신호 구독. 해제 함수를 반환한다.
  onNavigate: (cb: (section: string) => void) => {
    const listener = (_e: unknown, section: string) => cb(section);
    ipcRenderer.on("app:navigate", listener);
    return () => ipcRenderer.removeListener("app:navigate", listener);
  },
  // 트랙패드 스와이프·마우스 보조 버튼(메인에서 중계)의 탭 히스토리 이동 신호 구독
  onHistoryNav: (cb: (dir: "back" | "forward") => void) => {
    const listener = (_e: unknown, dir: "back" | "forward") => cb(dir);
    ipcRenderer.on("app:history", listener);
    return () => ipcRenderer.removeListener("app:history", listener);
  },
});
