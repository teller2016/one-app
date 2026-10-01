// 채팅 보기 항목 병합 — 데스크톱 pane(useTerminalChat)·폰(controller) 공용 순수 함수 (테스트: mobile-app/terminal/logic.test.ts)
import type { ChatItem, ChatToolResult } from '../../../../shared/terminal-protocol';

/** 들고 있는 채팅 항목 상한 — 오래 켜 둬도 DOM 이 무거워지지 않게 앞에서 버린다 */
export const CHAT_MAX_ITEMS = 400;

/**
 * 채팅 항목 합치기 — 새 항목을 뒤에 붙이고, 도구 결과는 toolId 가 같은 항목에 단다.
 * 결과가 항목보다 먼저 올 수는 없지만(기록 순서) 상한으로 잘려 나간 항목의 결과는 버린다.
 * 같은 key 가 다시 오면(재구독 직후 경합) 새 것으로 바꾼다. 무변화면 **원본 참조**를 돌려준다.
 */
export function mergeChat(prev: ChatItem[], add: ChatItem[], results: ChatToolResult[]): ChatItem[] {
  if (!add.length && !results.length) return prev;
  let next = prev;
  if (add.length) {
    const keys = new Set(add.map((i) => i.key));
    next = [...prev.filter((i) => !keys.has(i.key)), ...add];
    if (next.length > CHAT_MAX_ITEMS) next = next.slice(-CHAT_MAX_ITEMS);
  }
  if (results.length) {
    const byTool = new Map(results.map((r) => [r.toolId, r]));
    let changed = false;
    const withResults = next.map((i) => {
      if (i.kind !== 'tool' && i.kind !== 'ask') return i;
      const r = byTool.get(i.toolId);
      if (!r) return i;
      changed = true;
      return { ...i, result: r };
    });
    if (changed) next = withResults;
  }
  return next;
}
