// preload 가 노출한 window.oneApp 타입 — 본체 `src/renderer/types/global.d.ts` 의 **부분집합**.
//
// 일부러 전체를 가져오지 않는다. 본체 컴포넌트를 이 앱에서 import 하면 tsc 가 그 파일까지
// 검사하므로, 여기 없는 채널을 부르는 컴포넌트를 들여오면 **빌드 전에** 잡힌다(런타임에
// undefined 호출로 터지는 대신). 새 채널을 쓰게 되면 preload 와 이 파일을 함께 늘린다.
import type {
  ApprovalProgress,
  AppSettingsView,
  ExpendDefaults,
  ExpendInput,
  ExpendResult,
  JiraProjectsResult,
  JiraReportPrefs,
  JiraReportQuery,
  JiraReportResult,
  OvertimeDefaults,
  OvertimeSubmitInput,
  OvertimeSubmitResult,
  SaveSettingsInput,
  ThemePref,
  VacationDefaults,
  VacationInput,
  VacationResult,
  VacationStatus,
} from '@one/shared/types';
// 이 앱만의 타입 — 본체에는 없는 기능이라 lite 의 shared 에 둔다
import type { UpdateInfo, UpdateInstallResult, UpdateProgress } from '../../shared/update';

declare global {
  interface Window {
    oneApp: {
      settings: {
        get: () => Promise<AppSettingsView>;
        set: (input: SaveSettingsInput) => Promise<AppSettingsView>;
        setTheme: (theme: ThemePref) => Promise<AppSettingsView>;
      };
      approval: {
        getOvertimeDefaults: () => Promise<OvertimeDefaults>;
        getExpendDefaults: () => Promise<ExpendDefaults>;
        getVacationDefaults: () => Promise<VacationDefaults>;
        submitOvertime: (input: OvertimeSubmitInput) => Promise<OvertimeSubmitResult>;
        runExpend: (input: ExpendInput) => Promise<ExpendResult>;
        submitVacation: (input: VacationInput) => Promise<VacationResult>;
        vacationStatus: () => Promise<{
          ok: boolean;
          status?: VacationStatus;
          error?: string;
        }>;
        openEaBox: () => Promise<{ ok: boolean; error?: string }>;
        onProgress: (cb: (progress: ApprovalProgress) => void) => () => void;
      };
      jira: {
        report: {
          projects: (force?: boolean) => Promise<JiraProjectsResult>;
          search: (query: JiraReportQuery) => Promise<JiraReportResult>;
          getPrefs: () => Promise<JiraReportPrefs>;
          savePrefs: (prefs: Partial<JiraReportPrefs>) => Promise<JiraReportPrefs>;
        };
      };
      update: {
        check: () => Promise<UpdateInfo>;
        install: () => Promise<UpdateInstallResult>;
        openFolder: (folder: string) => Promise<{ ok: boolean }>;
        onProgress: (cb: (progress: UpdateProgress) => void) => () => void;
      };
      openExternal: (url: string) => Promise<{ ok: boolean }>;
    };
  }
}

export {};
