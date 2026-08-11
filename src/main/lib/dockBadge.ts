// Dock 뱃지는 앱 전역에 하나뿐인 자원이라 여기서만 만든다.
// 지금 뱃지에 실리는 것은 두 가지이고, 각자 `app.dock.setBadge` 를 부르면 서로를 지운다:
//   1. 터미널 입력대기 세션 수 (0 이면 비운다 — 잔존 방지)
//   2. 개발 인스턴스 표식 'DEV' (빌드 앱과 Dock 에서 구분, devInstance.ts 참고)
import { app } from 'electron';
import { IS_DEV_INSTANCE } from './devInstance';

let waitingCount = 0;

function apply(): void {
  const num = waitingCount > 0 ? String(waitingCount) : '';
  // 개발 인스턴스는 대기 수가 없어도 'DEV' 를 남긴다 — 뱃지가 비면 구분 표식도 사라진다
  app.dock?.setBadge(IS_DEV_INSTANCE ? (num ? `DEV ${num}` : 'DEV') : num);
}

/** 터미널 입력대기 세션 수 반영 */
export function setWaitingBadge(count: number): void {
  waitingCount = Math.max(0, count);
  apply();
}

/** 앱 시작 시 1회 — 개발 인스턴스면 세션이 없어도 DEV 표식을 띄운다 */
export const initDockBadge = apply;
