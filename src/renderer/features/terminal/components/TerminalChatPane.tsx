// pane 위에 얹는 채팅 보기 — **위쪽만** 덮는다. 아래로는 진짜 터미널(xterm)의 claude 입력 부분이 드러난다
// (입력 상자·작업 중 줄·질문/권한 대화상자 — 높이는 TerminalView 가 화면에서 재서 strip 으로 준다).
// 채팅은 읽기 전용(ChatView composer=false) — 입력은 터미널이 그대로 받는다. 데이터는 useTerminalChat(IPC).
// xterm 은 크기 그대로 아래에 살아 있다(attach·PTY 크기·스크롤백 유지 — PTY 를 줄이면 폰·전체 터미널까지 작아진다).
import { memo, useCallback, type CSSProperties } from 'react';
import { Icon } from '../../../components/Icon';
import { setChatView } from '../lib/chatViews';
import { useTerminalChat } from '../lib/useTerminalChat';
import { ChatView } from './ChatView';

export const TerminalChatPane = memo(function TerminalChatPane({
  sessionId: id,
  busy,
  findSignal,
  strip,
  remote,
  onFocusTerminal,
}: {
  sessionId: string;
  /** 세션이 작업 중 — 새 말풍선 따라 내리기 판정용 */
  busy: boolean;
  /** ⌘F — 바뀔 때마다 채팅 검색 줄을 연다(TerminalView 가 채팅 보기일 때 올린다) */
  findSignal: number;
  /** 아래로 드러낼 터미널 높이(px) — null 이면 아직 못 쟀다(CSS 기본값) */
  strip: number | null;
  /** 폰이 터미널 크기를 쥐고 있다(보는 쪽 우선) — 아래 칸이 좁거나 잘린 이유를 한 줄로 알린다 */
  remote: { cols: number; rows: number } | null;
  /** 키보드를 터미널로 — 채팅을 눌러도 이어서 바로 칠 수 있게 */
  onFocusTerminal: () => void;
}) {
  const chat = useTerminalChat(id);
  const onShowTerminal = useCallback(() => setChatView(id, 'term'), [id]);
  // claude 가 아닌 세션은 안내가 pane 전체를 덮는다 — 아래 터미널을 잴 claude 화면이 없다
  const split = !chat.unavailable;
  return (
    <div
      className={'terminal__chat' + (split ? ' terminal__chat--split' : '')}
      style={split && strip !== null ? ({ '--term-chat-strip': `${strip}px` } as CSSProperties) : undefined}
      // 채팅을 눌러도 키보드는 터미널로 — 단 글자를 끌어 고른 중(복사하려는 것)이거나 검색 줄이면 두고
      onMouseUp={(e) => {
        if (!window.getSelection()?.isCollapsed) return;
        if ((e.target as Element).closest('input, textarea')) return;
        onFocusTerminal();
      }}
    >
      <ChatView
        items={chat.items}
        loaded={chat.loaded}
        unavailable={chat.unavailable}
        fresh={chat.fresh}
        prompt={chat.prompt}
        queued={chat.queued}
        busy={busy}
        findSignal={findSignal}
        composer={false}
        onReturnFocus={onFocusTerminal}
        onShowTerminal={onShowTerminal}
      />
      {split && remote && (
        <div className="terminal__chat-remote" role="status">
          <Icon name="smartphone" size={14} />
          <span>
            폰에서 터미널로 보는 중 ({remote.cols}×{remote.rows}) — 폰을 내려놓으면 입력 칸이 돌아옵니다
          </span>
        </div>
      )}
    </div>
  );
});
