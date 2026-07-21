import { app, ipcMain } from "electron";
import type { NightwatchConfig } from "../../../shared/types";
import {
  analyzeTicket,
  cleanupOnQuit,
  deleteTicket,
  getNightwatchStatus,
  listCandidates,
  readMissionLog,
  readNightwatchLog,
  readNightwatchPrompt,
  readNightwatchReport,
  stopMission,
  sweepInterruptedTickets,
} from "./engine";
import { saveNightwatchConfig } from "./store";

/** Nightwatch(Jira 버그 티켓 헤드리스 분석) 관련 IPC 핸들러 등록 */
export function registerNightwatchIpc() {
  // 이전 세션에서 중단된 in_progress 항목 정리 + 종료 시 실행 중 미션 회수
  sweepInterruptedTickets();
  app.on("will-quit", () => cleanupOnQuit());

  ipcMain.handle("nightwatch:status", () => getNightwatchStatus());
  ipcMain.handle(
    "nightwatch:config:save",
    (_e, config: Partial<NightwatchConfig>) => {
      saveNightwatchConfig(config);
      return getNightwatchStatus();
    }
  );
  ipcMain.handle("nightwatch:candidates", () => listCandidates());
  ipcMain.handle("nightwatch:analyze", (_e, key: string, repoId: string) =>
    analyzeTicket(String(key), String(repoId))
  );
  ipcMain.handle("nightwatch:stop", () => stopMission());
  ipcMain.handle("nightwatch:delete", (_e, key: string) =>
    deleteTicket(String(key))
  );
  ipcMain.handle("nightwatch:report", (_e, key: string) =>
    readNightwatchReport(key)
  );
  ipcMain.handle("nightwatch:prompt", (_e, key: string) =>
    readNightwatchPrompt(String(key))
  );
  ipcMain.handle("nightwatch:mission-log", (_e, key: string) =>
    readMissionLog(String(key))
  );
  ipcMain.handle("nightwatch:log", () => readNightwatchLog());
}
