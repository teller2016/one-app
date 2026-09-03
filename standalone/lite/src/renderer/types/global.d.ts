// preload 가 노출한 window.oneApp 타입 — 본체 `src/renderer/types/global.d.ts` 의 **부분집합**.
//
// 일부러 전체를 가져오지 않는다. 본체 컴포넌트를 이 앱에서 import 하면 tsc 가 그 파일까지
// 검사하므로, 여기 없는 채널을 부르는 컴포넌트를 들여오면 **빌드 전에** 잡힌다(런타임에
// undefined 호출로 터지는 대신).
//
// 본체와 공용인 브리지는 본체 `preload/bridges/*` 의 인터페이스를 그대로 쓴다 — preload 구현이
// 같은 인터페이스로 타입되므로 이 선언과 실제 노출이 어긋날 수 없다. 새 채널은 그쪽 슬라이스에.
import type { ApprovalBridge } from '@one/preload/bridges/approval';
import type { JiraReportBridge } from '@one/preload/bridges/jiraReport';
import type { SettingsBridge } from '@one/preload/bridges/settings';
// 이 앱만의 타입 — 본체에는 없는 기능이라 lite 의 shared 에 둔다
import type { UpdateInfo, UpdateInstallResult, UpdateProgress } from '../../shared/update';

declare global {
  interface Window {
    oneApp: {
      settings: SettingsBridge;
      approval: ApprovalBridge;
      jira: {
        report: JiraReportBridge;
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
