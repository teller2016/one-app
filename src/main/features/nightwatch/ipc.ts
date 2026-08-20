import { app, ipcMain } from "electron";
import type {
  NightwatchAnalyzeOpts,
  NightwatchConfig,
} from "../../../shared/types";
import {
  analyzeTicket,
  cleanupOnQuit,
  clearHiddenCandidates,
  deleteTicket,
  getNightwatchStatus,
  hideCandidate,
  listCandidates,
  readMissionLog,
  readNightwatchLog,
  readNightwatchPrompt,
  readNightwatchReport,
  stopMission,
  sweepInterruptedTickets,
} from "./engine";
import {
  refreshNightwatchSchedule,
  startNightwatchScheduler,
  stopNightwatchScheduler,
} from "./scheduler";
import { saveNightwatchConfig } from "./store";

/** Nightwatch(Jira 버그 티켓 헤드리스 분석) 관련 IPC 핸들러 등록 */
export function registerNightwatchIpc() {
  // 이전 세션에서 중단된 in_progress 항목 정리 + 종료 시 실행 중 미션 회수
  sweepInterruptedTickets();
  app.on("will-quit", () => {
    stopNightwatchScheduler();
    cleanupOnQuit();
  });
  // 자동 순회는 ready 이후에 붙인다 — 부팅 경로에서 Jira REST·claude 탐지를 타므로
  // 창이 뜨기 전에 돌리지 않는다(첫 확인은 인터벌 첫 tick, 즉 5분 뒤).
  void app.whenReady().then(() => startNightwatchScheduler());

  ipcMain.handle("nightwatch:status", () => getNightwatchStatus());
  ipcMain.handle(
    "nightwatch:config:save",
    (_e, config: Partial<NightwatchConfig>) => {
      saveNightwatchConfig(config);
      // 자동 순회 토글을 재시작 없이 반영한다 (방금 켰다면 즉시 한 번 확인)
      refreshNightwatchSchedule({ immediate: true });
      return getNightwatchStatus();
    }
  );
  ipcMain.handle("nightwatch:candidates", () => listCandidates());
  ipcMain.handle("nightwatch:hide", (_e, key: string) =>
    hideCandidate(String(key))
  );
  ipcMain.handle("nightwatch:hidden:clear", () => clearHiddenCandidates());
  ipcMain.handle(
    "nightwatch:analyze",
    (_e, key: string, repoId: string, opts?: NightwatchAnalyzeOpts) =>
      analyzeTicket(String(key), String(repoId), opts)
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
