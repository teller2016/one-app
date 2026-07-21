// preload: 렌더러에 안전하게 노출할 API를 contextBridge 로 등록한다.
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import type {
  ScheduleRunPayload,
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
  ApplinkInput,
  MirrorMode,
  NightwatchConfig,
} from "../shared/types";
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("oneApp", {
  schedule: {
    // 매크로 실행 (앱 내부에서 puppeteer 직접 실행)
    run: (payload: ScheduleRunPayload) =>
      ipcRenderer.invoke("schedule:run", payload),
    // 실행 중지 (자동화 브라우저 닫기)
    cancel: () => ipcRenderer.invoke("schedule:cancel"),
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
    fetchStatuses: (projectId: string) =>
      ipcRenderer.invoke("deploy:status:fetch", projectId),
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
  jira: {
    // 내게 할당된 미해결 이슈 목록 (미설정이면 configured:false)
    list: () => ipcRenderer.invoke("jira:list"),
    // 이 이슈에서 지금 가능한 상태 전환 목록 (이슈별·프로젝트별로 다름)
    getTransitions: (key: string) =>
      ipcRenderer.invoke("jira:transitions", key),
    // 상태 전환 실행
    transition: (key: string, id: string) =>
      ipcRenderer.invoke("jira:transition", key, id),
    // 해결/완료 계열 전환 자동 선택 실행 (PR 머지 직후용)
    resolve: (key: string) => ipcRenderer.invoke("jira:resolve", key),
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
    fetch: () => ipcRenderer.invoke("attendance:fetch"),
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
  weekly: {
    // 개인별 주간 일정 수집 (headless 브라우저 — 수십 초 소요). 0=이번주, -1=지난주
    fetch: (weekOffset: number) =>
      ipcRenderer.invoke("weekly:fetch", weekOffset),
    // 수집 진행 단계 구독. 해제 함수를 반환한다.
    onProgress: (cb: (progress: WeeklyProgress) => void) => {
      const listener = (_e: unknown, progress: WeeklyProgress) => cb(progress);
      ipcRenderer.on("weekly:progress", listener);
      return () => ipcRenderer.removeListener("weekly:progress", listener);
    },
  },
  prs: {
    // 열린 PR 목록 조회 (Gitea — 주소 미설정이면 configured:false)
    fetch: () => ipcRenderer.invoke("prs:fetch"),
    // 설정(조직 필터 + 빠른 PR 저장소) 조회/저장
    getConfig: () => ipcRenderer.invoke("prs:config:get"),
    setConfig: (config: PrsConfig) =>
      ipcRenderer.invoke("prs:config:set", config),
    // 저장소의 최근 브랜치 목록 (빠른 PR 후보)
    getBranches: (repo: string) => ipcRenderer.invoke("prs:branches", repo),
    // base 대비 head 커밋 목록 (PR 제목/본문 자동 생성용)
    getBranchCommits: (repo: string, base: string, head: string) =>
      ipcRenderer.invoke("prs:branch-commits", repo, base, head),
    // PR 생성 (Gitea 토큰 필요)
    create: (input: PrCreateInput) => ipcRenderer.invoke("prs:create", input),
    // 머지 전 상태 확인 (컨플릭트 여부)
    getMergeInfo: (repo: string, number: number) =>
      ipcRenderer.invoke("prs:merge-info", repo, number),
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
    analyze: (key: string, repoId: string) =>
      ipcRenderer.invoke("nightwatch:analyze", key, repoId),
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
  // 로그인 시 자동 시작 조회/설정 (OS 로그인 아이템)
  getAutostart: () => ipcRenderer.invoke("app:autostart:get"),
  setAutostart: (enabled: boolean) =>
    ipcRenderer.invoke("app:autostart:set", enabled),
  // 알림 미리보기 — 샘플 데스크톱 알림을 즉시 띄운다 (권한 확인·모양 확인용)
  testNotification: () => ipcRenderer.invoke("notify:test"),
  // 기본 브라우저로 링크 열기 (http/https 만 허용)
  openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  // 알림 클릭 등으로 특정 섹션으로 이동하라는 신호 구독. 해제 함수를 반환한다.
  onNavigate: (cb: (section: string) => void) => {
    const listener = (_e: unknown, section: string) => cb(section);
    ipcRenderer.on("app:navigate", listener);
    return () => ipcRenderer.removeListener("app:navigate", listener);
  },
});
