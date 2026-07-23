// 모든 렌더러 창에 이벤트 push — 상태 변화 브로드캐스트 공통 헬퍼
import { BrowserWindow } from 'electron';

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, ...args);
  }
}
