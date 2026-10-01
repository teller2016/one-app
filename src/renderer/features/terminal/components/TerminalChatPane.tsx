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
  insertSignal,
}: {
  sessionId: string;
  /** 세션이 작업 중 — 끝에 진행 표시, 입력창에 [중단] */
  busy: boolean;
  /** ⌘F — 바뀔 때마다 채팅 검색 줄을 연다(TerminalView 가 채팅 보기일 때 올린다) */
  findSignal: number;
  /** 파일 끌어다 놓기 — 이미지는 첨부 칩, 나머지는 경로를 입력창에 */
  insertSignal: { text: string; images?: string[]; n: number } | null;
}) {
  const chat = useTerminalChat(id);
  const [commands, setCommands] = useState<ChatCommand[] | null>(null);
  const [files, setFiles] = useState<string[] | null>(null);
  const onSend = useCallback((text: string, images: string[]) => window.oneApp.terminal.chat.send(id, text, images), [id]);
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
  // `@` 를 처음 칠 때 한 번 — 저장소 파일 목록(main 30초 캐시)
  const onRequestFiles = useCallback(() => {
    setFiles([]);
    void window.oneApp.terminal.chat
      .files(id)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [id]);
  // 이미지 ⌘V — main 이 임시 폴더에 저장하고 경로를 준다. 보낼 때 그 경로를 claude 에 한 장씩 붙여넣는다
  const onPasteImage = useCallback(
    async (file: File) =>
      window.oneApp.terminal.chat.saveImage(new Uint8Array(await file.arrayBuffer()), file.type).catch(() => null),
    [],
  );
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
        files={files}
        onRequestFiles={onRequestFiles}
        onPasteImage={onPasteImage}
        insertSignal={insertSignal}
        persistKey={id}
        findSignal={findSignal}
        onSend={onSend}
        onKey={onKey}
        onShowTerminal={onShowTerminal}
        enterToSend
      />
    </div>
  );
});
