// 채팅 보기 — 터미널 세션 안 claude 의 대화 기록(jsonl)을 말풍선으로 보여준다. 데스크톱 pane·폰 터미널 탭 공용.
// ⚠️ 여기서 window.oneApp 을 부르지 말 것 — 폰 번들에도 들어가는 순수 화면이다(데이터는 호출부가 댄다:
//    데스크톱 = useTerminalChat → IPC, 폰 = controller → WS — 둘 다 main chat.ts).
// 입력은 서버가 붙여넣기·Enter 로 PTY 에 넣는다.
//
// ⚠️ 대화 기록에는 claude 의 **TUI 상호작용**이 남지 않는다 — 특히 AskUserQuestion 질문은 답하기 전까지 기록에
//    없다(2026-10-01 실측). 그래서 claude 가 답을 기다리는 동안은 서버가 **터미널 화면에서 읽은 번호 선택 화면**
//    (`prompt`)을 보내고, 여기서 버튼으로 그린다 — 버튼 = 그 번호 키. 숫자 키는 그 선택지를 고르고 다음 질문으로
//    넘어가며, 화면이 바뀌면 다음 prompt 가 온다(여러 질문 → 검토 화면 '1. Submit answers' 까지 같은 카드로).
//    직접 답은 'Type something.' 번호 → 글 → Enter. 화면을 못 읽으면 선택지 없는 prompt — 터미널 안내만.
//
// 읽기·조작 개선(2026-10-01 사용자 선택 A·B·C 전부):
//   읽기 — 본문 760 단(CSS) · 연속 도구 호출 묶기 · Edit diff 색 · 내 메시지 시각
//   조작 — Esc 중단 · 숫자 키 선택지 · ↑↓ 이전 입력 · 답변/코드 복사 · 위로 올려 읽는 중 '새 답변'
//   더   — `/` 명령 자동완성 · 작업 중 상태 줄(화면에서 읽음) · ⌘F 검색(데스크톱 — findSignal)
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { Markdown } from '../../../components/Markdown';
import { useCopy } from '../../../lib/useCopy';
import type { ChatCommand, ChatItem, ChatPrompt } from '../../../../shared/terminal-protocol';

type AskItem = Extract<ChatItem, { kind: 'ask' }>;
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

/** 바닥에서 이만큼 안이면 '바닥에 붙어 있다' — 새 말풍선이 오면 따라 내려간다 */
const STICK_PX = 80;
/** 직접 답 — 'Type something.' 으로 옮긴 뒤 글을 넣기까지의 틈(선택 이동이 먼저 처리되게) */
const FREE_TEXT_DELAY_MS = 120;
/** 이만큼 이상 이어진 도구 호출은 한 줄로 묶는다 */
const TOOL_GROUP_MIN = 2;
/** `/` 자동완성 목록에 보일 최대 수 */
const COMMAND_LIMIT = 8;

/** 렌더 단위 — 말풍선 하나 또는 연속된 도구 호출 묶음 */
type Block = { kind: 'item'; item: ChatItem } | { kind: 'tools'; key: string; tools: ToolItem[] };

function toBlocks(items: ChatItem[]): Block[] {
  const out: Block[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    if (run.length >= TOOL_GROUP_MIN) out.push({ kind: 'tools', key: run[0].key, tools: run });
    else run.forEach((t) => out.push({ kind: 'item', item: t }));
    run = [];
  };
  for (const it of items) {
    if (it.kind === 'tool') run.push(it);
    else {
      flush();
      out.push({ kind: 'item', item: it });
    }
  }
  flush();
  return out;
}

/** ISO → 'HH:MM' (오늘이 아니면 'M/D HH:MM') */
function clock(ts?: string): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

// ── 검색 — CSS Custom Highlight API 로 글자 단위 표시(DOM 을 건드리지 않는다) ──
const FIND_ALL = 'term-chat-find';
const FIND_ON = 'term-chat-find-on';

function findRanges(root: HTMLElement, query: string): Range[] {
  const q = query.toLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? '').toLowerCase();
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + q.length);
      ranges.push(r);
    }
  }
  return ranges;
}

const clearHighlights = () => {
  if (typeof CSS === 'undefined' || !CSS.highlights) return;
  CSS.highlights.delete(FIND_ALL);
  CSS.highlights.delete(FIND_ON);
};

export function ChatView({
  items,
  loaded,
  unavailable,
  fresh,
  prompt,
  busy,
  status = null,
  commands = null,
  onRequestCommands,
  findSignal = 0,
  onSend,
  onKey,
  onShowTerminal,
  enterToSend = false,
}: {
  items: ChatItem[];
  loaded: boolean;
  unavailable: string | null;
  /** claude 는 떠 있지만 대화 파일이 아직 없다(첫 메시지 전) */
  fresh: boolean;
  /** claude 가 터미널에서 답을 기다리는 선택 화면 */
  prompt: ChatPrompt | null;
  /** 세션이 작업 중 — 끝에 진행 표시, 입력창에 [중단] */
  busy: boolean;
  /** 작업 중 상태 줄(화면에서 읽음) — 없으면 '작업 중…' */
  status?: string | null;
  /** `/` 자동완성 목록 — null 이면 아직 안 받았다(입력창에서 / 를 치면 onRequestCommands) */
  commands?: ChatCommand[] | null;
  onRequestCommands?: () => void;
  /** 바뀔 때마다 검색 줄을 연다(데스크톱 ⌘F — 0 은 무시) */
  findSignal?: number;
  onSend: (text: string) => void;
  onKey: (data: string) => void;
  onShowTerminal: () => void;
  /**
   * Enter = 전송 · Shift+Enter = 줄바꿈 (데스크톱). 폰은 기본값 false — 소프트 키보드의 Enter 는 줄바꿈이 자연스럽고
   * 전송은 버튼으로 한다. ↑↓ 이전 입력·숫자 키 선택지·Esc 중단도 이 값이 켜졌을 때(=하드웨어 키보드)만 쓴다.
   */
  enterToSend?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 선택 화면이 떠 있는데 직접 입력 자리가 없으면(검토·권한 화면) 입력창 글이 갈 곳이 없다
  const promptBlocksInput = !!prompt && !prompt.freeText;
  const blocks = useMemo(() => toBlocks(items), [items]);

  // ↑↓ 이전 입력 — 내가 보낸 글(최근 것부터). -1 = 지금 쓰는 글
  const sent = useMemo(
    () => items.filter((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user').map((i) => i.text).reverse(),
    [items],
  );
  const histRef = useRef(-1);

  // `/` 자동완성 — '/이름' 까지(공백 전)일 때만 연다. Esc 로 닫으면 글이 바뀔 때까지 다시 열지 않는다
  const [cmdIdx, setCmdIdx] = useState(0);
  const [cmdDismissed, setCmdDismissed] = useState<string | null>(null);
  const slash = /^\/(\S*)$/.exec(draft);
  const cmdQuery = slash ? slash[1].toLowerCase() : null;
  const cmdMatches = useMemo(() => {
    if (cmdQuery === null || !commands) return [];
    const starts = commands.filter((c) => c.name.toLowerCase().startsWith(cmdQuery));
    const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(cmdQuery) && c.name.toLowerCase().includes(cmdQuery));
    return [...starts, ...contains].slice(0, COMMAND_LIMIT);
  }, [cmdQuery, commands]);
  const cmdOpen = cmdQuery !== null && cmdDismissed !== draft && cmdMatches.length > 0;
  useEffect(() => {
    if (cmdQuery !== null && commands === null) onRequestCommands?.();
  }, [cmdQuery, commands, onRequestCommands]);
  useEffect(() => setCmdIdx(0), [cmdQuery]);

  // 새 항목이 오면 바닥에 붙어 있을 때만 따라 내려간다(위로 올려 읽는 중이면 '새 답변' 표시)
  const lastCount = useRef(items.length);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    else if (items.length > lastCount.current) setHasNew(true);
    lastCount.current = items.length;
  }, [items, busy, prompt, status]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    stickRef.current = bottom;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom) setHasNew(false);
  };

  const toBottom = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = true;
    setHasNew(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // 입력창 높이 — 내용에 맞춰 늘리되 다섯 줄 남짓에서 멈춘다(CSS max-height)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight 는 테두리를 뺀 값이다 — border-box 라 테두리만큼 더해야 넘치지 않는다(안 더하면 늘 2px 스크롤)
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [draft]);

  // ── 검색 ──
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [findAt, setFindAt] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);
  const rangesRef = useRef<Range[]>([]);
  useEffect(() => {
    if (!findSignal) return;
    setFindOpen(true);
    // select() 만으로는 포커스가 오지 않는다(실측 — 글이 채팅 입력창으로 갔다). 먼저 focus
    requestAnimationFrame(() => {
      findRef.current?.focus();
      findRef.current?.select();
    });
  }, [findSignal]);
  // 검색어·대화가 바뀌면 일치를 다시 칠한다
  useEffect(() => {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const root = listRef.current;
    if (!findOpen || !findQ || !root) {
      clearHighlights();
      rangesRef.current = [];
      setFindCount(0);
      return;
    }
    const ranges = findRanges(root, findQ);
    rangesRef.current = ranges;
    setFindCount(ranges.length);
    CSS.highlights.set(FIND_ALL, new Highlight(...ranges));
  }, [findOpen, findQ, items]);
  // 현재 일치 — 강조 + 화면 안으로
  useEffect(() => {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const r = rangesRef.current[findAt];
    if (!findOpen || !r) {
      CSS.highlights.delete(FIND_ON);
      return;
    }
    CSS.highlights.set(FIND_ON, new Highlight(r));
    r.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  }, [findAt, findCount, findOpen]);
  useEffect(() => () => clearHighlights(), []);
  const stepFind = (back: boolean) => {
    if (!findCount) return;
    setFindAt((i) => (i + (back ? -1 : 1) + findCount) % findCount);
  };
  const closeFind = () => {
    setFindOpen(false);
    setFindQ('');
    setFindAt(0);
    inputRef.current?.focus();
  };

  const send = () => {
    const text = draft.trim();
    if (!text || promptBlocksInput) return;
    if (prompt?.freeText) {
      // 질문에 직접 답한다 — 'Type something.' 으로 옮겨 글을 넣는다(그냥 쓰면 선택 화면이 글을 버린다)
      onKey(String(prompt.freeText));
      window.setTimeout(() => onSend(text), FREE_TEXT_DELAY_MS);
    } else {
      onSend(text);
    }
    setDraft('');
    histRef.current = -1;
    stickRef.current = true; // 보낸 사람은 답을 보려 한다
  };

  const applyCommand = (c: ChatCommand) => {
    setDraft(`/${c.name} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⚠️ 한글 조합 중 키는 IME 몫이다 — Enter 는 글자 확정, 방향키는 조합 이동
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // `/` 자동완성이 떠 있으면 ↑↓·Enter·Tab·Esc 는 목록 조작
    if (cmdOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = cmdMatches.length;
        setCmdIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applyCommand(cmdMatches[cmdIdx] ?? cmdMatches[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCmdDismissed(draft);
        return;
      }
    }
    if (!enterToSend) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
      return;
    }
    // Esc = claude 중단(작업 중일 때) — 터미널에서 Esc 를 누르는 것과 같다
    if (e.key === 'Escape' && busy && !prompt) {
      e.preventDefault();
      onKey('\x1b');
      return;
    }
    // 숫자 키 = 선택지 고르기(입력창이 비어 있을 때만 — 글을 쓰는 중이면 그냥 숫자다)
    if (prompt?.options.length && !draft && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const n = Number(e.key);
      const opt = prompt.options.find((o) => o.n === n);
      if (opt && n !== prompt.freeText) {
        e.preventDefault();
        onKey(e.key);
      }
      return;
    }
    // ↑↓ 이전 입력 — 비어 있거나 이미 불러온 글을 보는 중일 때, 커서가 맨 앞이면
    const ta = e.currentTarget;
    if (e.key === 'ArrowUp' && (!draft || histRef.current >= 0) && ta.selectionStart === 0 && sent.length) {
      e.preventDefault();
      const next = Math.min(histRef.current + 1, sent.length - 1);
      histRef.current = next;
      setDraft(sent[next]);
      return;
    }
    if (e.key === 'ArrowDown' && histRef.current >= 0 && ta.selectionEnd === draft.length) {
      e.preventDefault();
      const next = histRef.current - 1;
      histRef.current = next;
      setDraft(next >= 0 ? sent[next] : '');
    }
  };

  if (unavailable) {
    return (
      <div className="term-chat term-chat--empty">
        <EmptyState icon="terminal" message="채팅으로 볼 수 없는 세션입니다" hint={unavailable} />
        <Button variant="primary" onClick={onShowTerminal}>
          <Icon name="terminal" size={14} />
          터미널로 보기
        </Button>
      </div>
    );
  }

  return (
    <div className="term-chat">
      {findOpen && (
        <div className="term-chat__find">
          <Icon name="search" size={14} />
          <input
            ref={findRef}
            className="term-chat__find-input"
            value={findQ}
            placeholder="대화에서 찾기"
            aria-label="대화에서 찾기"
            onChange={(e) => {
              setFindQ(e.target.value);
              setFindAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                stepFind(e.shiftKey);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeFind();
              }
            }}
          />
          <span className="term-chat__find-count">{findQ ? (findCount ? `${findAt + 1}/${findCount}` : '없음') : ''}</span>
          <button type="button" className="icon-btn" aria-label="이전 일치" onClick={() => stepFind(true)}>
            <Icon name="chevron-up" size={14} />
          </button>
          <button type="button" className="icon-btn" aria-label="다음 일치" onClick={() => stepFind(false)}>
            <Icon name="chevron-down" size={14} />
          </button>
          <button type="button" className="icon-btn" aria-label="검색 닫기" onClick={closeFind}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div className="term-chat__body">
        <div ref={listRef} className="term-chat__list" onScroll={onScroll}>
          {!loaded && <div className="term-chat__note">대화를 불러오는 중…</div>}
          {loaded && !items.length && !fresh && <div className="term-chat__note">아직 대화가 없습니다.</div>}
          {loaded && !items.length && fresh && !prompt && (
            // 첫 메시지 전 — 폴더 신뢰 확인 같은 TUI 화면도 이 상태라 구분할 수 없어 안내를 함께 둔다
            <div className="term-chat__fresh">
              <span>새 대화입니다. 아래 입력창으로 첫 메시지를 보내세요.</span>
              <span className="term-chat__fresh-hint">터미널에 확인 화면(폴더 신뢰 등)이 떠 있으면 먼저 답해야 합니다.</span>
              <Button size="sm" onClick={onShowTerminal}>
                <Icon name="terminal" size={14} />
                터미널 확인
              </Button>
            </div>
          )}
          {blocks.map((b) =>
            b.kind === 'tools' ? <ToolGroup key={b.key} tools={b.tools} /> : <ChatRow key={b.item.key} item={b.item} />,
          )}
          {prompt ? (
            <PromptCard prompt={prompt} keyHints={enterToSend} onKey={onKey} onShowTerminal={onShowTerminal} />
          ) : (
            busy && (
              <div className="term-chat__typing" role="status">
                <span className="spinner spinner--xs" aria-hidden="true" />
                <span className="term-chat__typing-text">{status ?? '작업 중…'}</span>
                {enterToSend && <span className="term-chat__typing-hint">Esc 로 중단</span>}
              </div>
            )
          )}
        </div>

        {!atBottom && (
          <button
            type="button"
            className={'term-chat__to-bottom' + (hasNew ? ' term-chat__to-bottom--new' : '')}
            onClick={toBottom}
          >
            <Icon name="arrow-down-to-line" size={14} />
            {hasNew ? '새 답변' : '맨 아래로'}
          </button>
        )}
      </div>

      <form
        className="term-chat__composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        // 입력 바의 빈 여백을 눌러도 입력창으로 — 입력창 테두리 바로 바깥을 누르는 일이 잦다
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="term-chat__composer-inner">
          {cmdOpen && (
            <ul className="term-chat__cmds" role="listbox" aria-label="명령">
              {cmdMatches.map((c, i) => (
                <li key={c.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === cmdIdx}
                    className={'term-chat__cmd' + (i === cmdIdx ? ' term-chat__cmd--on' : '')}
                    // 입력창 포커스를 잃지 않게 mousedown 에서 처리
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyCommand(c);
                    }}
                  >
                    <span className="term-chat__cmd-name">/{c.name}</span>
                    {c.description && <span className="term-chat__cmd-desc">{c.description}</span>}
                    {c.source !== 'builtin' && (
                      <span className="term-chat__cmd-src">{c.source === 'project' ? '프로젝트' : '내 계정'}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={inputRef}
            className="term-chat__input"
            rows={1}
            value={draft}
            disabled={promptBlocksInput}
            placeholder={
              promptBlocksInput
                ? enterToSend
                  ? '위 선택지에서 고르세요 (숫자 키)'
                  : '위 선택지에서 고르세요'
                : (prompt ? '직접 답하기' : 'claude 에게 메시지 · / 명령') +
                  (enterToSend ? ' (Enter 전송 · Shift+Enter 줄바꿈 · ↑ 이전 입력)' : '')
            }
            aria-label="메시지"
            onChange={(e) => {
              setDraft(e.target.value);
              histRef.current = -1;
            }}
            onKeyDown={onInputKey}
          />
          {busy && !prompt && !draft.trim() ? (
            // 작업 중이면 Esc = claude 중단 — 터미널에서 Esc 를 누르는 것과 같다
            <button
              type="button"
              className="term-chat__send term-chat__send--stop"
              aria-label="중단 (Esc)"
              onClick={() => onKey('\x1b')}
            >
              <span className="term-chat__stop-mark" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              className="term-chat__send"
              aria-label="보내기"
              disabled={!draft.trim() || promptBlocksInput}
            >
              <Icon name="arrow-up-right" size={18} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ── 항목 ──

const ChatRow = memo(function ChatRow({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user': {
      const time = clock(item.ts);
      return (
        <div className="term-chat__row term-chat__row--me">
          {time && <span className="term-chat__time">{time}</span>}
          <div className="term-chat__bubble term-chat__bubble--me">
            {item.images ? <span className="term-chat__img-tag">이미지 {item.images}장</span> : null}
            {item.text}
          </div>
        </div>
      );
    }
    case 'notice':
      return <div className="term-chat__notice">{item.text}</div>;
    case 'command':
      return (
        <div className="term-chat__row term-chat__row--me">
          <span className="term-chat__command">{item.text}</span>
        </div>
      );
    case 'assistant':
      return <AssistantBubble text={item.text} />;
    case 'tool':
      return <ToolRow item={item} />;
    case 'ask':
      return <AskRecord item={item} />;
  }
});

/** claude 답변 — 마크다운 + 마우스를 올리면 [복사](원문 마크다운) · 코드 블록마다 [복사] */
function AssistantBubble({ text }: { text: string }) {
  const copy = useCopy();
  return (
    <div className="term-chat__row">
      <div className="term-chat__bubble term-chat__bubble--ai">
        <Markdown copyCode>{text}</Markdown>
        <button
          type="button"
          className="term-chat__copy"
          aria-label="답변 복사"
          onClick={() => void copy(text, { success: '답변을 복사했습니다' })}
        >
          <Icon name="copy" size={12} />
        </button>
      </div>
    </div>
  );
}

/** 연속 도구 호출 묶음 — 접힌 채 '도구 N개 · Read 3 · Bash 2', 진행 중인 것만 아래에 펼쳐 둔다 */
function ToolGroup({ tools }: { tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const counts = new Map<string, number>();
  tools.forEach((t) => counts.set(t.name, (counts.get(t.name) ?? 0) + 1));
  const summary = [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} ${c}` : n)).join(' · ');
  const running = tools.filter((t) => !t.result);
  const failed = tools.some((t) => t.result?.isError);
  const state = running.length ? 'run' : failed ? 'err' : 'ok';
  return (
    <div className={`term-chat__tools term-chat__tools--${state}`}>
      <button type="button" className="term-chat__tools-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="term-chat__tool-dot" aria-hidden="true" />
        <span className="term-chat__tool-name">도구 {tools.length}개</span>
        <span className="term-chat__tool-sum">{summary}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      {(open ? tools : running).map((t) => (
        <ToolRow key={t.key} item={t} nested />
      ))}
    </div>
  );
}

/** Edit 상세 — '- ' 삭제 줄 빨강 · '+ ' 추가 줄 초록 */
function DiffBlock({ text }: { text: string }) {
  return (
    <pre className="term-chat__pre term-chat__pre--diff">
      {text.split('\n').map((l, i) => (
        <span key={i} className={l.startsWith('+ ') ? 'term-chat__add' : l.startsWith('- ') ? 'term-chat__del' : undefined}>
          {l}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

/** 도구 호출 — 한 줄 요약, 누르면 입력 상세·결과를 펼친다 */
function ToolRow({ item, nested = false }: { item: ToolItem; nested?: boolean }) {
  const [open, setOpen] = useState(false);
  const state = !item.result ? 'run' : item.result.isError ? 'err' : 'ok';
  const hasMore = !!(item.detail || item.result?.text);
  return (
    <div className={`term-chat__tool term-chat__tool--${state}${nested ? ' term-chat__tool--nested' : ''}`}>
      <button
        type="button"
        className="term-chat__tool-head"
        aria-expanded={hasMore ? open : undefined}
        disabled={!hasMore}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="term-chat__tool-dot" aria-hidden="true" />
        <span className="term-chat__tool-name">{item.name}</span>
        <span className="term-chat__tool-sum">{item.summary}</span>
        {hasMore && <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />}
      </button>
      {open && (
        <div className="term-chat__tool-body">
          {item.detail &&
            (item.name === 'Edit' ? <DiffBlock text={item.detail} /> : <pre className="term-chat__pre">{item.detail}</pre>)}
          {item.result?.text && (
            <pre className={`term-chat__pre term-chat__pre--out${item.result.isError ? ' term-chat__pre--err' : ''}`}>
              {item.result.text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 기록된 AskUserQuestion — 답한 뒤에야 기록에 오므로 대개 '질문 → 답' 이 함께 있다.
 * 답이 있으면 쌍만 보인다(질문을 따로 또 적으면 같은 문장이 두 번 보인다). 답하는 버튼은 PromptCard 가 맡는다.
 */
function AskRecord({ item }: { item: AskItem }) {
  const answers = item.result?.text ? answerPairs(item.result.text) : [];
  return (
    <div className="term-chat__ask term-chat__ask--done">
      {answers.length
        ? answers.map(([q, a], i) => (
            <div key={i} className="term-chat__ask-pair">
              <span className="term-chat__ask-q">{q}</span>
              <span className="term-chat__ask-answer">→ {a}</span>
            </div>
          ))
        : item.questions.map((q, i) => (
            <div key={i} className="term-chat__ask-q">
              {q.question}
            </div>
          ))}
      {!answers.length && item.result?.text && <div className="term-chat__ask-answer">{item.result.text}</div>}
    </div>
  );
}

/** 결과 문구 `"질문"="답"` 쌍만 — 앞뒤 안내문(영문)은 폰에서 군더더기다 */
function answerPairs(text: string): [string, string][] {
  return [...text.matchAll(/"([^"]+)"="([^"]*)"/g)].map((m) => [m[1], m[2]]);
}

/** claude 가 터미널에서 답을 기다리는 선택 화면 — 버튼 = 그 번호 키. 못 읽었으면 터미널 안내만 */
function PromptCard({
  prompt,
  keyHints,
  onKey,
  onShowTerminal,
}: {
  prompt: ChatPrompt;
  /** 하드웨어 키보드(데스크톱) — 숫자 키로 고를 수 있음을 알린다 */
  keyHints: boolean;
  onKey: (data: string) => void;
  onShowTerminal: () => void;
}) {
  if (!prompt.options.length) {
    return (
      <div className="term-chat__ask">
        <div className="term-chat__ask-q">claude 가 터미널에서 답을 기다립니다</div>
        <button type="button" className="term-chat__opt term-chat__opt--primary" onClick={onShowTerminal}>
          터미널로 보기
        </button>
      </div>
    );
  }
  return (
    <div className="term-chat__ask">
      {prompt.header && <span className="term-chat__ask-step term-chat__ask-step--on">{prompt.header}</span>}
      {prompt.question && <div className="term-chat__ask-q">{prompt.question}</div>}
      <div className="term-chat__ask-opts">
        {prompt.options.map((o) => (
          <button
            key={o.n}
            type="button"
            className={`term-chat__opt${o.n === prompt.freeText ? ' term-chat__opt--free' : ''}`}
            // 직접 답 자리는 버튼이 아니라 입력창으로 — 눌러도 커서만 옮겨 두고 글은 입력창에서
            onClick={() => (o.n === prompt.freeText ? undefined : onKey(String(o.n)))}
            disabled={o.n === prompt.freeText}
          >
            <span className="term-chat__opt-label">
              {o.n}. {o.n === prompt.freeText ? '직접 답하기 — 아래 입력창' : o.label}
            </span>
            {o.description && <span className="term-chat__opt-desc">{o.description}</span>}
          </button>
        ))}
      </div>
      <div className="term-chat__ask-foot">
        {keyHints && <span className="term-chat__ask-hint">숫자 키로 고르기 (입력창이 비어 있을 때)</span>}
        <button type="button" className="term-chat__ask-term" onClick={onShowTerminal}>
          <Icon name="terminal" size={12} />
          터미널에서 보기
        </button>
      </div>
    </div>
  );
}
