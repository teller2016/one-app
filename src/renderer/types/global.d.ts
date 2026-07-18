// preload 에서 contextBridge 로 노출한 window.oneApp 타입 선언
import type {
  ScheduleRunPayload,
  ScheduleRunResult,
  ScheduleOutputChunk,
  ScheduleDoneInfo,
  AppSettingsView,
  SaveSettingsInput,
  ThemePref,
  MirrorStatus,
  MirrorMode,
  MirrorActionResult,
  JiraListResult,
  JiraActionResult,
  JiraTransition,
  JiraTransitionsResult,
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
  PrListResult,
  PrsConfig,
  PrBranchesResult,
  PrCommitsResult,
  PrCreateInput,
  PrCreateResult,
  PrMergeInfoResult,
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
  NightwatchConfig,
  NightwatchCommandResult,
  NightwatchTextResult,
} from '../../shared/types';

declare global {
  interface Window {
    oneApp: {
      schedule: {
        run: (payload: ScheduleRunPayload) => Promise<ScheduleRunResult>;
        cancel: () => Promise<{ ok: boolean }>;
        onOutput: (cb: (chunk: ScheduleOutputChunk) => void) => () => void;
        onDone: (cb: (info: ScheduleDoneInfo) => void) => () => void;
      };
      settings: {
        get: () => Promise<AppSettingsView>;
        set: (input: SaveSettingsInput) => Promise<AppSettingsView>;
        setTheme: (theme: ThemePref) => Promise<AppSettingsView>;
      };
      deploy: {
        getProjects: () => Promise<DeployProjectView[]>;
        saveProject: (
          input: SaveDeployProjectInput,
        ) => Promise<DeployProjectView[]>;
        deleteProject: (id: string) => Promise<DeployProjectView[]>;
        fetchStatuses: (
          projectId: string,
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
      jira: {
        list: () => Promise<JiraListResult>;
        getTransitions: (key: string) => Promise<JiraTransitionsResult>;
        transition: (key: string, id: string) => Promise<JiraActionResult>;
        resolve: (key: string) => Promise<JiraActionResult>;
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
        fetch: () => Promise<AttendanceResult>;
        stamp: (action: 'come' | 'leave') => Promise<AttendanceResult>;
        getReminders: () => Promise<ReminderConfig>;
        setReminders: (config: ReminderConfig) => Promise<ReminderConfig>;
        onChanged: (cb: (info: AttendanceInfo) => void) => () => void;
        onStamping: (
          cb: (action: 'come' | 'leave' | null) => void,
        ) => () => void;
      };
      weekly: {
        fetch: (weekOffset: number) => Promise<WeeklyFetchResult>;
        onProgress: (cb: (progress: WeeklyProgress) => void) => () => void;
      };
      prs: {
        fetch: () => Promise<PrListResult>;
        getConfig: () => Promise<PrsConfig>;
        setConfig: (config: PrsConfig) => Promise<PrsConfig>;
        getBranches: (repo: string) => Promise<PrBranchesResult>;
        getBranchCommits: (
          repo: string,
          base: string,
          head: string,
        ) => Promise<PrCommitsResult>;
        create: (input: PrCreateInput) => Promise<PrCreateResult>;
        getMergeInfo: (repo: string, number: number) => Promise<PrMergeInfoResult>;
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
        setEnabled: (enabled: boolean) => Promise<NightwatchStatus>;
        saveConfig: (
          config: Partial<NightwatchConfig>,
        ) => Promise<NightwatchStatus>;
        test: () => Promise<NightwatchCommandResult>;
        initWorkspace: () => Promise<NightwatchCommandResult>;
        cycleNow: () => Promise<NightwatchCommandResult>;
        getReport: (key: string) => Promise<NightwatchTextResult>;
        getLog: () => Promise<NightwatchTextResult>;
      };
      getAutostart: () => Promise<{ enabled: boolean }>;
      setAutostart: (enabled: boolean) => Promise<{ enabled: boolean }>;
      testNotification: () => Promise<{ ok: boolean }>;
      openExternal: (url: string) => Promise<{ ok: boolean }>;
      onNavigate: (cb: (section: string) => void) => () => void;
    };
  }
}
