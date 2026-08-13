// tmux 백엔드 여부 — 앱 수명 동안 바뀌지 않는 값이라 IPC 를 1회만 왕복하고 공유한다.
// pane 은 LRU 축출·섹션 이동으로 수시로 다시 마운트되고 새 세션 모달도 같은 값을 보므로,
// 각자 부르면 같은 답을 얻으려고 왕복만 반복하게 된다.

/** 조회 결과(진행 중 프로미스 포함) — null 이면 아직 한 번도 안 물어봤다 */
let cached: Promise<{ tmux: boolean }> | null = null;

export function terminalBackend(): Promise<{ tmux: boolean }> {
  // ?.() — dev HMR 로 구 preload(backend 없음) 위에서 렌더될 때 죽지 않게
  cached ??=
    window.oneApp?.terminal.backend?.() ?? Promise.resolve({ tmux: false });
  return cached;
}
