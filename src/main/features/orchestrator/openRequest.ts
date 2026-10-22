// 루트 세션 → 앱 화면: "이 기능의 확인 화면을 이 값으로 채워 열어 달라"(3단계, 2026-10-22).
//
// 기획 결정: 원앱 기능(배포·PR·결재·일정)은 **각 기능의 기존 확인 화면**에서 사용자가 실행한다 — 루트 도구는 값을 채워 그 화면을 띄우는 데까지만.
// 그래서 실행 경로·확인 절차(PROD 이름 입력 등)는 지금과 똑같다. 요청은 메인 창에만 보낸다(`broadcast` 는 폰까지 간다 — 폰에서 모달이 뜨면 안 된다).
// 렌더러는 앱 셸(`RootOpenRequests`)이 받아 각 기능의 공개 요청 함수(예: deploy `requestDeployConfirm`)로 넘긴다.
import { app } from 'electron';
import type { AppOpenRequest } from '../../../shared/types';
import { getNotifyWindow } from '../notify/notify';

/** 메인 창을 앞으로 — 다른 앱 뒤에 있어도 화면이 보이게 (notify 알럿과 같은 방식) */
export function bringMainWindowToFront(): void {
  const win = getNotifyWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  app.focus({ steal: true });
}

/** 기능 화면을 채워 연다 — 메인 창이 없으면(닫아 둠) false */
export function sendOpenRequest(req: AppOpenRequest): boolean {
  const win = getNotifyWindow();
  if (!win || win.isDestroyed()) return false;
  win.webContents.send('app:open-request', req);
  bringMainWindowToFront();
  return true;
}
