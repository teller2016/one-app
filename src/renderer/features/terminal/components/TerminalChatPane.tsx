// pane 위에 얹는 채팅 보기 — xterm 은 그 아래 그대로 살아 있다(attach·크기·스크롤백 유지, 숨기기만).
// 데이터는 useTerminalChat(IPC), 화면은 폰과 공용 ChatView.
import { memo, useCallback, useState } from 'react';
import type { ChatCommand } from '../../../../shared/terminal-protocol';
import { setChatView } from '../lib/chatViews';
import { useTerminalChat } from '../lib/useTerminalChat';
import { ChatView } from './ChatView';

export const TerminalChatPane = memo(function TerminalChatPane({
  sessionId: id,
  busy,
  findSignal,
}: {
  sessionId: string;
  /** 세션이 작업 중 — 끝에 진행 표시, 입력창에 [중단] */
  busy: boolean;
  /** ⌘F — 바뀔 때마다 채팅 검색 줄을 연다(TerminalView 가 채팅 보기일 때 올린다) */
  findSignal: number;
}) {
  const chat = useTerminalChat(id);
  const [commands, setCommands] = useState<ChatCommand[] | null>(null);
  const onSend = useCallback((text: string) => window.oneApp.terminal.chat.send(id, text), [id]);
  const onKey = useCallback((data: string) => window.oneApp.terminal.write(id, data), [id]);
  const onShowTerminal = useCallback(() => setChatView(id, 'term'), [id]);
  // `/` 를 처음 칠 때 한 번 받는다(main 이 30초 캐시) — 실패하면 빈 목록(자동완성만 안 뜬다)
  const onRequestCommands = useCallback(() => {
    setCommands([]);
    void window.oneApp.terminal.chat
      .commands(id)
      .then(setCommands)
      .catch(() => setCommands([]));
  }, [id]);
  return (
    <div className="terminal__chat">
      <ChatView
        items={chat.items}
        loaded={chat.loaded}
        unavailable={chat.unavailable}
        fresh={chat.fresh}
        prompt={chat.prompt}
        busy={busy}
        status={chat.status}
        commands={commands}
        onRequestCommands={onRequestCommands}
        findSignal={findSignal}
        onSend={onSend}
        onKey={onKey}
        onShowTerminal={onShowTerminal}
        enterToSend
      />
    </div>
  );
});
