// pane 위에 얹는 채팅 보기 — xterm 은 그 아래 그대로 살아 있다(attach·크기·스크롤백 유지, 숨기기만).
// 데이터는 useTerminalChat(IPC), 화면은 폰과 공용 ChatView.
import { memo, useCallback } from 'react';
import { setChatView } from '../lib/chatViews';
import { useTerminalChat } from '../lib/useTerminalChat';
import { ChatView } from './ChatView';

export const TerminalChatPane = memo(function TerminalChatPane({
  sessionId: id,
  busy,
}: {
  sessionId: string;
  /** 세션이 작업 중 — 끝에 진행 표시, 입력창에 [중단] */
  busy: boolean;
}) {
  const chat = useTerminalChat(id);
  const onSend = useCallback((text: string) => window.oneApp.terminal.chat.send(id, text), [id]);
  const onKey = useCallback((data: string) => window.oneApp.terminal.write(id, data), [id]);
  const onShowTerminal = useCallback(() => setChatView(id, 'term'), [id]);
  return (
    <div className="terminal__chat">
      <ChatView
        items={chat.items}
        loaded={chat.loaded}
        unavailable={chat.unavailable}
        fresh={chat.fresh}
        prompt={chat.prompt}
        busy={busy}
        onSend={onSend}
        onKey={onKey}
        onShowTerminal={onShowTerminal}
        enterToSend
      />
    </div>
  );
});
