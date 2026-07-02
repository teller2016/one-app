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
    };
  }
}
