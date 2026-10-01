// Dock 뱃지는 앱 전역에 하나뿐인 자원이라 여기서만 만든다.
// 지금 뱃지에 실리는 것은 터미널 입력대기 세션 수뿐이다 (0 이면 비운다 — 잔존 방지).
// 개발 인스턴스 구분은 아이콘의 'DEV' 밴드(main.ts)가 맡는다 — 뱃지에도 'DEV' 를 띄우면
// 같은 표식이 두 번 보여 2026-10-01 뺐다.
import { app } from 'electron';

let waitingCount = 0;

function apply(): void {
  app.dock?.setBadge(waitingCount > 0 ? String(waitingCount) : '');
}

/** 터미널 입력대기 세션 수 반영 */
export function setWaitingBadge(count: number): void {
  waitingCount = Math.max(0, count);
  apply();
}

/** 앱 시작 시 1회 — 이전 실행이 남긴 뱃지를 비운다 */
export const initDockBadge = apply;
