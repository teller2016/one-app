// 데스크톱 채팅 보기 데이터 — 이 세션의 claude 대화 기록을 IPC 로 구독한다(main chat.ts, 폰 WS 와 같은 구독).
// pane 이 채팅 보기로 떠 있는 동안만 연다(언마운트 = 구독 해제).
import { useEffect, useState } from 'react';
import type { ChatItem, ChatPrompt, ChatQueued } from '../../../../shared/terminal-protocol';
import { mergeChat } from './chat';

export type TerminalChatState = {
  items: ChatItem[];
  loaded: boolean;
  unavailable: string | null;
  fresh: boolean;
  prompt: ChatPrompt | null;
  /** 작업 중 상태 줄(화면에서 읽음) — 없으면 '작업 중…' */
  status: string | null;
  /** 아직 안 읽힌(대기열의) 내 메시지 — 회색 말풍선 */
  queued: ChatQueued[];
};

const EMPTY: TerminalChatState = {
  items: [],
  loaded: false,
  unavailable: null,
  fresh: false,
  prompt: null,
  status: null,
  queued: [],
};

export function useTerminalChat(id: string): TerminalChatState {
  const [state, setState] = useState<TerminalChatState>(EMPTY);

  useEffect(() => {
    const api = window.oneApp.terminal.chat;
    setState(EMPTY);
    const off = api.onMessage((msg) => {
      if (msg.id !== id) return; // 같은 창의 다른 pane 몫
      setState((prev) => {
        switch (msg.type) {
          case 'chat':
            return {
              ...prev,
              items: mergeChat(msg.reset ? [] : prev.items, msg.items, msg.results),
              loaded: true,
              unavailable: null,
              fresh: msg.reset ? !!msg.fresh : prev.fresh,
              // 대기열은 '있을 때만 통째로' 온다 — 없으면 그대로(스냅샷이면 비운다)
              queued: msg.queued ?? (msg.reset ? [] : prev.queued),
            };
          case 'chat-unavailable':
            return { ...EMPTY, loaded: true, unavailable: msg.reason };
          case 'chat-prompt':
            return { ...prev, prompt: msg.prompt };
          case 'chat-status':
            return { ...prev, status: msg.text };
          default:
            return prev;
        }
      });
    });
    api.open(id);
    return () => {
      off();
      api.close(id);
    };
  }, [id]);

  return state;
}
