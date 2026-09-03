// preload 에서 contextBridge 로 노출한 window.oneApp 타입 선언
import type { ApprovalBridge } from '../../preload/bridges/approval';
import type { JiraReportBridge } from '../../preload/bridges/jiraReport';
import type { SettingsBridge } from '../../preload/bridges/settings';
import type {
  AppToastPayload,
  ScheduleRunPayload,
  ScheduleRunResult,
  ScheduleOutputChunk,
  ScheduleDoneInfo,
  ScheduleNotionRecordPayload,
  ScheduleNotionRecordResult,
  ScheduleStartConfig,
  ScheduleWorklog,
  MirrorStatus,
  MirrorMode,
  MirrorActionResult,
  JiraListResult,
  JiraActionResult,
  JiraActivityResult,
  JiraDetailResult,
  JiraTransitionsResult,
  JiraAddedResult,
  JiraAddedTicket,
  JiraValidateResult,
  JiraWorkAccountInfo,
  JiraWorkPrepareInput,
  JiraWorkPrepareResult,
  DeployProjectView,
  SaveDeployProjectInput,
  DeployStatus,
  DeployStatusEvent,
  DeployTriggerResult,
  DeployBuildDetailResult,
  DeployHistoryResult,
  DeployLogResult,
  DeployStopResult,
  DeployPreviewResult,
  DeployActivityResult,
  Project,
  SaveProjectInput,
  PrListResult,
  PrsConfig,
  PrBranchesResult,
  PrBaseBranchesResult,
  PrAllBranchesResult,
  PrCommitsResult,
  PrCreateInput,
  PrCreateResult,
  PrMergeInfoResult,
  PrMergeablesResult,
  PrMergeMethod,
  PrMergeResult,
  ApplinkInput,
  ApplinkResult,
  ApplinkKeyStatus,
  AttendanceResult,
  AttendanceInfo,
  VpnSettingsView,
  SaveVpnSettingsInput,
  VpnSaveResult,
  VpnActionResult,
  VpnStatus,
  WeeklyFetchResult,
  WeeklyProgress,
  ReminderConfig,
  NightwatchStatus,
  NightwatchAnalyzeOpts,
  NightwatchConfig,
  NightwatchCandidatesResult,
  NightwatchCommandResult,
  NightwatchTextResult,
  MailListQuery,
  MailInboxResult,
  MailBodyResult,
  MailUnreadCountResult,
  AltMailAccount,
  AltMailAccountsResult,
  AuthCodeResult,
  ChangesTarget,
  ChangesDiffFile,
  ChangesDiffScope,
  ChangesMode,
  ChangesStatus,
  ChangesDiffResult,
  ChangesLogResult,
  ChangesCommitFilesResult,
  ChangesCommitResult,
  ChangesPushResult,
  TerminalPreset,
  TerminalWorkspace,
  WorkspaceSaveInput,
  WorkspaceBranches,
  WorktreeAddInput,
  WorktreeActionResult,
  WorktreeInfo,
  TerminalCreateInput,
  TerminalSessionInfo,
  TerminalAttachResult,
  TerminalServerStatus,
  TerminalAgentInfo,
  TerminalNotifyLevel,
  TerminalDragState,
  TerminalPopoutOpenInput,
  TerminalWindowInfo,
} from '../../shared/types';

declare global {
  interface Window {
    oneApp: {
      schedule: {
        run: (payload: ScheduleRunPayload) => Promise<ScheduleRunResult>;
        cancel: () => Promise<{ ok: boolean }>;
        notionRecord: (
          payload: ScheduleNotionRecordPayload,
        ) => Promise<ScheduleNotionRecordResult>;
        getWorklog: () => Promise<ScheduleWorklog>;
        setWorklog: (worklog: ScheduleWorklog) => Promise<{ ok: boolean }>;
        getStartConfig: () => Promise<ScheduleStartConfig>;
        setStartConfig: (
          config: ScheduleStartConfig,
        ) => Promise<ScheduleStartConfig>;
        onOutput: (cb: (chunk: ScheduleOutputChunk) => void) => () => void;
        onDone: (cb: (info: ScheduleDoneInfo) => void) => () => void;
      };
      // 단독 배포판과 공용인 브리지는 preload/bridges 의 인터페이스를 그대로 쓴다 —
      // preload 구현이 그 인터페이스로 타입되므로 여기와 preload 가 어긋날 수 없다
      settings: SettingsBridge;
      deploy: {
        getProjects: () => Promise<DeployProjectView[]>;
        saveProject: (
          input: SaveDeployProjectInput,
        ) => Promise<DeployProjectView[]>;
        deleteProject: (id: string) => Promise<DeployProjectView[]>;
        // force=true 는 주기 조회 — main 의 짧은 상태 캐시를 우회한다
        fetchStatuses: (
          projectId: string,
          force?: boolean,
        ) => Promise<Record<string, DeployStatus>>;
        fetchActivity: (projectId: string) => Promise<DeployActivityResult>;
        trigger: (
          projectId: string,
          targetId: string,
        ) => Promise<DeployTriggerResult>;
        getBuildDetail: (
          projectId: string,
          targetId: string,
          buildNumber?: number,
        ) => Promise<DeployBuildDetailResult>;
        getHistory: (
          projectId: string,
          targetId: string,
        ) => Promise<DeployHistoryResult>;
        getLog: (
          projectId: string,
          targetId: string,
          buildNumber: number,
        ) => Promise<DeployLogResult>;
        stopBuild: (
          projectId: string,
          targetId: string,
          buildNumber: number,
        ) => Promise<DeployStopResult>;
        getPreview: (
          projectId: string,
          targetId: string,
        ) => Promise<DeployPreviewResult>;
        onStatus: (cb: (evt: DeployStatusEvent) => void) => () => void;
      };
      mail: {
        getUnreadCount: () => Promise<MailUnreadCountResult>;
        getInbox: (query?: MailListQuery) => Promise<MailInboxResult>;
        getBody: (muid: number, unread: boolean) => Promise<MailBodyResult>;
        openWeb: () => Promise<{ ok: boolean }>;
        authCodeAccounts: () => Promise<AltMailAccount[]>;
        saveAuthCodeAccount: (
          loginId: string,
          password: string,
        ) => Promise<AltMailAccountsResult>;
        removeAuthCodeAccount: (
          loginId: string,
        ) => Promise<AltMailAccountsResult>;
        getAuthCode: (loginId: string) => Promise<AuthCodeResult>;
      };
      jira: {
        // force=true 는 수동 새로고침·전환 직후 — main 의 TTL 캐시 우회
        list: (force?: boolean) => Promise<JiraListResult>;
        getDetail: (key: string) => Promise<JiraDetailResult>;
        getTransitions: (key: string) => Promise<JiraTransitionsResult>;
        transition: (key: string, id: string) => Promise<JiraActionResult>;
        resolve: (key: string) => Promise<JiraActionResult>;
        /** 진행 계열 전환 자동 선택 실행 (작업 시작 직후용) */
        startProgress: (key: string) => Promise<JiraActionResult>;
        /** 기간(YYYY-MM-DD)에 내가 작업한 티켓 — 관여도·내 변경 이력 포함 */
        activity: (
          start: string,
          end: string,
          force?: boolean,
        ) => Promise<JiraActivityResult>;
        // 직접 추가한 티켓 — 목록 자체는 jira.list 결과에 pinned 로 병합돼 온다
        added: {
          list: () => Promise<JiraAddedTicket[]>;
          validate: (input: string) => Promise<JiraValidateResult>;
          add: (input: string) => Promise<JiraAddedResult>;
          remove: (key: string) => Promise<JiraAddedResult>;
        };
        // 작업 시작 준비 — 티켓 맥락 저장 + femc 실행 명령(셸 인용 완료) 반환
        prepareWork: (
          input: JiraWorkPrepareInput,
        ) => Promise<JiraWorkPrepareResult>;
        workAccounts: () => Promise<JiraWorkAccountInfo[]>;
        /** 티켓 보고 — 단독 배포판과 공용 (preload/bridges/jiraReport.ts) */
        report: JiraReportBridge;
      };
      mirror: {
        getStatus: () => Promise<MirrorStatus>;
        start: (mode: MirrorMode) => Promise<MirrorActionResult>;
        stop: () => Promise<MirrorActionResult>;
        onChanged: (cb: () => void) => () => void;
      };
      vpn: {
        getSettings: () => Promise<VpnSettingsView>;
        saveSettings: (input: SaveVpnSettingsInput) => Promise<VpnSaveResult>;
        pickOvpn: () => Promise<{ path?: string }>;
        connect: (manualOtp?: string) => Promise<VpnActionResult>;
        disconnect: () => Promise<VpnActionResult>;
        getStatus: () => Promise<VpnStatus>;
        onStatus: (cb: (status: VpnStatus) => void) => () => void;
      };
      attendance: {
        // force=true 는 수동 새로고침 — main 의 조회 캐시를 우회한다
        fetch: (force?: boolean) => Promise<AttendanceResult>;
        stamp: (action: 'come' | 'leave') => Promise<AttendanceResult>;
        getReminders: () => Promise<ReminderConfig>;
        setReminders: (config: ReminderConfig) => Promise<ReminderConfig>;
        onChanged: (cb: (info: AttendanceInfo) => void) => () => void;
        onStamping: (
          cb: (action: 'come' | 'leave' | null) => void,
        ) => () => void;
      };
      approval: ApprovalBridge;
      weekly: {
        fetch: (weekOffset: number, monWeek?: boolean) => Promise<WeeklyFetchResult>;
        onProgress: (cb: (progress: WeeklyProgress) => void) => () => void;
      };
      projects: {
        list: () => Promise<Project[]>;
        save: (input: SaveProjectInput) => Promise<Project[]>;
        delete: (id: string) => Promise<Project[]>;
        pickDir: () => Promise<{ path?: string }>;
        onChanged: (cb: (projects: Project[]) => void) => () => void;
      };
      prs: {
        // light=true 는 목록만 — 리뷰/브랜치 보강 생략(섹션의 1단계 로딩).
        // force=true 는 수동 새로고침 — main 의 목록 캐시를 우회한다.
        fetch: (opts?: {
          light?: boolean;
          force?: boolean;
        }) => Promise<PrListResult>;
        getConfig: () => Promise<PrsConfig>;
        setConfig: (config: PrsConfig) => Promise<PrsConfig>;
        getBranches: (repo: string) => Promise<PrBranchesResult>;
        getBaseBranches: (repo: string) => Promise<PrBaseBranchesResult>;
        getAllBranches: (repo: string) => Promise<PrAllBranchesResult>;
        getBranchCommits: (
          repo: string,
          base: string,
          head: string,
        ) => Promise<PrCommitsResult>;
        create: (input: PrCreateInput) => Promise<PrCreateResult>;
        getMergeInfo: (repo: string, number: number) => Promise<PrMergeInfoResult>;
        getMergeables: (repo: string) => Promise<PrMergeablesResult>;
        merge: (
          repo: string,
          number: number,
          method: PrMergeMethod,
        ) => Promise<PrMergeResult>;
      };
      applink: {
        getKeyStatus: () => Promise<ApplinkKeyStatus>;
        setKey: (key: string) => Promise<ApplinkKeyStatus>;
        create: (input: ApplinkInput) => Promise<ApplinkResult>;
      };
      nightwatch: {
        getStatus: () => Promise<NightwatchStatus>;
        saveConfig: (
          config: Partial<NightwatchConfig>,
        ) => Promise<NightwatchStatus>;
        listCandidates: () => Promise<NightwatchCandidatesResult>;
        hideCandidate: (key: string) => Promise<NightwatchCommandResult>;
        clearHidden: () => Promise<NightwatchCommandResult>;
        analyze: (
          key: string,
          repoId: string,
          opts?: NightwatchAnalyzeOpts,
        ) => Promise<NightwatchCommandResult>;
        stop: () => Promise<NightwatchCommandResult>;
        deleteTicket: (key: string) => Promise<NightwatchCommandResult>;
        getReport: (key: string) => Promise<NightwatchTextResult>;
        getPrompt: (key: string) => Promise<NightwatchTextResult>;
        getMissionLog: (key: string) => Promise<NightwatchTextResult>;
        getLog: () => Promise<NightwatchTextResult>;
      };
      changes: {
        status: (target: ChangesTarget, mode?: ChangesMode) => Promise<ChangesStatus>;
        diff: (
          target: ChangesTarget,
          file: ChangesDiffFile,
          scope?: ChangesDiffScope,
          /** 갖고 있는 diff 의 해시 — 내용이 같으면 본문 없이 unchanged 만 온다 */
          knownHash?: string,
        ) => Promise<ChangesDiffResult>;
        log: (target: ChangesTarget) => Promise<ChangesLogResult>;
        commitFiles: (
          target: ChangesTarget,
          hash: string,
        ) => Promise<ChangesCommitFilesResult>;
        commit: (
          target: ChangesTarget,
          message: string,
        ) => Promise<ChangesCommitResult>;
        push: (target: ChangesTarget) => Promise<ChangesPushResult>;
      };
      workspaces: {
        list: () => Promise<TerminalWorkspace[]>;
        save: (input: WorkspaceSaveInput) => Promise<TerminalWorkspace[]>;
        delete: (id: string) => Promise<TerminalWorkspace[]>;
        reorder: (ids: string[]) => Promise<TerminalWorkspace[]>;
        reveal: (id: string) => Promise<{ ok: boolean; error?: string }>;
        editorInfo: () => Promise<{ available: boolean; name: string }>;
        openEditor: (
          id: string,
          worktreePath: string,
        ) => Promise<{ ok: boolean; error?: string }>;
        pickDir: (title?: string) => Promise<{ path?: string }>;
        /** detail=false 면 경량 조회 — 경로·브랜치만(±변경량은 0, dirty 는 false) */
        worktrees: (id: string, detail?: boolean) => Promise<WorktreeInfo[]>;
        addWorktree: (input: WorktreeAddInput) => Promise<WorktreeActionResult>;
        removeWorktree: (
          id: string,
          worktreePath: string,
          force?: boolean,
        ) => Promise<WorktreeActionResult>;
        branches: (id: string) => Promise<WorkspaceBranches>;
        presets: {
          get: () => Promise<TerminalPreset[]>;
          save: (presets: TerminalPreset[]) => Promise<TerminalPreset[]>;
          onChanged: (cb: (presets: TerminalPreset[]) => void) => () => void;
        };
        onChanged: (cb: (workspaces: TerminalWorkspace[]) => void) => () => void;
      };
      terminal: {
        list: () => Promise<TerminalSessionInfo[]>;
        create: (opts?: TerminalCreateInput) => Promise<TerminalSessionInfo>;
        attach: (
          id: string,
          cols: number,
          rows: number,
        ) => Promise<TerminalAttachResult>;
        // ?. 옵셔널 — 구 preload(재시작 전)와의 개발 중 어긋남 대비
        detach?: (id: string) => void;
        rename: (id: string, title: string) => Promise<{ ok: boolean }>;
        revealCwd: (
          id: string,
        ) => Promise<{ ok: boolean; error?: string }>;
        // ?. 옵셔널 — 구 preload(재시작 전)와의 개발 중 어긋남 대비
        openEditor?: (id: string) => Promise<{ ok: boolean; error?: string }>;
        kill: (id: string) => Promise<{ ok: boolean }>;
        agents: () => Promise<TerminalAgentInfo[]>;
        backend: () => Promise<{ tmux: boolean }>;
        notifyLevel: {
          get: () => Promise<TerminalNotifyLevel>;
          set: (level: TerminalNotifyLevel) => Promise<TerminalNotifyLevel>;
        };
        write: (id: string, data: string) => void;
        resize: (id: string, cols: number, rows: number) => void;
        // ?. 옵셔널 — 구 preload(재시작 전)와의 개발 중 어긋남 대비 (detach 와 같은 이유)
        scroll?: (
          id: string,
          lines: number,
        ) => Promise<{ scrolledUp: boolean }>;
        scrollToBottom?: (id: string) => Promise<void>;
        onData: (
          cb: (ev: { id: string; data: string; seq: number }) => void,
        ) => () => void;
        onExit: (
          cb: (ev: { id: string; exitCode: number }) => void,
        ) => () => void;
        // payload 미탑재(구버전 main)면 undefined — 호출부가 list() 로 폴백한다
        onSessions: (
          cb: (sessions?: TerminalSessionInfo[]) => void,
        ) => () => void;
        onResized: (
          cb: (ev: { id: string; cols: number; rows: number }) => void,
        ) => () => void;
        server: {
          status: () => Promise<TerminalServerStatus>;
          setEnabled: (enabled: boolean) => Promise<TerminalServerStatus>;
          regenToken: () => Promise<TerminalServerStatus>;
          onChanged: (cb: () => void) => () => void;
        };
        // 팝아웃 창 — 세션↔창 배정은 main 이 소유, 렌더러는 미러.
        // ?. 옵셔널 — 구 preload(재시작 전)와의 개발 중 어긋남 대비
        windows?: {
          list: () => Promise<TerminalWindowInfo[]>;
          open: (
            input: TerminalPopoutOpenInput,
          ) => Promise<{ ok: boolean; id?: string; error?: string }>;
          focus: (id: string) => Promise<{ handled: boolean }>;
          focusSession: (sessionId: string) => Promise<{ handled: boolean }>;
          moveSession: (
            sessionId: string,
            to: string,
          ) => Promise<{ ok: boolean; error?: string }>;
          revealInMain: (sessionId: string) => Promise<{ handled: boolean }>;
          init: (
            id: string,
          ) => Promise<{ sessionIds: string[]; layout?: string; alwaysOnTop?: boolean }>;
          setAlwaysOnTop: (
            windowId: string,
            on: boolean,
          ) => Promise<{ ok: boolean; on?: boolean; error?: string }>;
          onChanged: (cb: (windows: TerminalWindowInfo[]) => void) => () => void;
          reportVisible: (windowId: string, ids: string[]) => void;
          drag: (state: TerminalDragState) => void;
          onDragState: (cb: (state: TerminalDragState) => void) => () => void;
        };
        locationLabel?: (sessionId: string) => Promise<string | null>;
        // ?. 옵셔널 — 구 preload(재시작 전)와의 개발 중 어긋남 대비
        onReveal?: (
          cb: (req: { sessionId: string; cwd: string }) => void,
        ) => () => void;
      };
      getAutostart: () => Promise<{ enabled: boolean }>;
      setAutostart: (enabled: boolean) => Promise<{ enabled: boolean }>;
      testNotification: () => Promise<{ ok: boolean }>;
      openExternal: (url: string) => Promise<{ ok: boolean }>;
      // 드롭된 File 의 실제 경로 (preload 의 webUtils.getPathForFile 경유).
      // ?. 옵셔널 — 구 preload(재시작 전)와의 개발 중 어긋남 대비
      getPathForFile?: (file: File) => string;
      onToast: (cb: (payload: AppToastPayload) => void) => () => void;
      // ?. 옵셔널 — 구 preload(재시작 전)와의 개발 중 어긋남 대비
      onToastDismiss?: (cb: (dedupeKey: string) => void) => () => void;
      onNavigate: (cb: (section: string) => void) => () => void;
      onHistoryNav: (cb: (dir: 'back' | 'forward') => void) => () => void;
    };
  }
}
