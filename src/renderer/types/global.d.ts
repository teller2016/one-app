// preload 에서 contextBridge 로 노출한 window.oneApp 타입 선언
import type {
  ScheduleRunPayload,
  ScheduleRunResult,
  ScheduleOutputChunk,
  ScheduleDoneInfo,
  AppSettingsView,
  SaveSettingsInput,
  DeployProjectView,
  SaveDeployProjectInput,
  DeployStatus,
  DeployStatusEvent,
  DeployTriggerResult,
  DeployBuildDetailResult,
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
        trigger: (
          projectId: string,
          targetId: string,
        ) => Promise<DeployTriggerResult>;
        getBuildDetail: (
          projectId: string,
          targetId: string,
          buildNumber?: number,
        ) => Promise<DeployBuildDetailResult>;
        onStatus: (cb: (evt: DeployStatusEvent) => void) => () => void;
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
      testNotification: () => Promise<{ ok: boolean }>;
      openExternal: (url: string) => Promise<{ ok: boolean }>;
      onNavigate: (cb: (section: string) => void) => () => void;
    };
  }
}
