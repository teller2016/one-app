import { ipcMain } from "electron";
import type { NightwatchConfig } from "../../../shared/types";
import {
  getNightwatchStatus,
  initWorkspace,
  readNightwatchLog,
  readNightwatchReport,
  runCycleOnce,
  setNightwatchEnabled,
  testConnection,
} from "./engine";
import { saveNightwatchConfig } from "./store";

/** Nightwatch(야간 무인 버그 분석) 관련 IPC 핸들러 등록 */
export function registerNightwatchIpc() {
  ipcMain.handle("nightwatch:status", () => getNightwatchStatus());
  ipcMain.handle("nightwatch:enable", (_e, enabled: boolean) =>
    setNightwatchEnabled(!!enabled)
  );
  ipcMain.handle(
    "nightwatch:config:save",
    (_e, config: Partial<NightwatchConfig>) => {
      saveNightwatchConfig(config);
      return getNightwatchStatus();
    }
  );
  ipcMain.handle("nightwatch:test", () => testConnection());
  ipcMain.handle("nightwatch:workspace:init", () => initWorkspace());
  ipcMain.handle("nightwatch:cycle:now", () => runCycleOnce(true));
  ipcMain.handle("nightwatch:report", (_e, key: string) =>
    readNightwatchReport(key)
  );
  ipcMain.handle("nightwatch:log", () => readNightwatchLog());
}
