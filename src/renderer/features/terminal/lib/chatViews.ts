// 세션별 보기(터미널 / 채팅) — 탭의 작은 토글이 바꾸고 pane 이 따른다. 기본은 터미널(사용자 결정 2026-10-01).
// UI 상태라 localStorage 로 충분하다(잃어도 터미널로 돌아갈 뿐). 같은 창 안의 여러 구독자(탭·pane)가
// 한 저장소를 보도록 useSyncExternalStore 로 묶는다. ⚠️ 팝아웃 창과는 공유하지 않는다(각 창의 메모리 사본).
import { useSyncExternalStore } from 'react';

export type ChatViewMode = 'term' | 'chat';

const KEY = 'terminal:chatViews';

const read = (): Record<string, ChatViewMode> => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, ChatViewMode>) : {};
  } catch {
    return {};
  }
};

let views = read();
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** 이 세션의 보기 */
export const useChatView = (id: string): ChatViewMode =>
  useSyncExternalStore(subscribe, () => views[id] ?? 'term');

/** 지금 보기 — 훅 밖(단축키 핸들러)에서 읽을 때 */
export const getChatView = (id: string): ChatViewMode => views[id] ?? 'term';

/** 터미널 ↔ 채팅 뒤집기 — 탭 토글·⌘E 공용 */
export const toggleChatView = (id: string) => setChatView(id, getChatView(id) === 'chat' ? 'term' : 'chat');

/** 보기 바꾸기 — 터미널로 돌아가면 항목을 지운다(기본값이라 기억할 필요가 없다) */
export function setChatView(id: string, mode: ChatViewMode) {
  const next = { ...views };
  if (mode === 'term') delete next[id];
  else next[id] = mode;
  views = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장 실패 — 이번 실행 동안만 유지된다
  }
  listeners.forEach((fn) => fn());
}

/** 종료된 세션의 항목 정리 — 세션 목록이 갱신될 때 */
export function pruneChatViews(liveIds: string[]) {
  const live = new Set(liveIds);
  if (Object.keys(views).every((id) => live.has(id))) return;
  views = Object.fromEntries(Object.entries(views).filter(([id]) => live.has(id)));
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    // 무시
  }
  listeners.forEach((fn) => fn());
}
