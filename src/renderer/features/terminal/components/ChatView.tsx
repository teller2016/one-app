// 채팅 보기 — 터미널 세션 안 claude 의 대화 기록(jsonl)을 말풍선으로 보여준다. 데스크톱 pane·폰 터미널 탭 공용.
// ⚠️ 여기서 window.oneApp 을 부르지 말 것 — 폰 번들에도 들어가는 순수 화면이다(데이터는 호출부가 댄다:
//    데스크톱 = useTerminalChat → IPC, 폰 = controller → WS — 둘 다 main chat.ts).
//
// 입력은 둘로 갈린다(2026-10-01 사용자 결정):
//   폰       — 이 화면의 입력창(composer). 서버가 붙여넣기·Enter 로 PTY 에 넣는다(소프트 키보드로 터미널 입력은 고역).
//   데스크톱 — `composer={false}`: 읽기만 하고, 입력은 아래로 드러난 **진짜 터미널**이 맡는다(TerminalView ·
//             lib/claudeLiveRegion). 입력을 흉내 내던 시절 Enter 씹힘·Esc 지연·이미지 칩 같은 문제가 줄줄이 났다 —
//             진짜 터미널이면 이미지·`/`·`@`·↑·Esc·선택지가 전부 claude 그대로다.
//
// ⚠️ 대화 기록에는 claude 의 **TUI 상호작용**이 남지 않는다 — 특히 AskUserQuestion 질문은 답하기 전까지 기록에
//    없다(2026-10-01 실측). 그래서 claude 가 답을 기다리는 동안은 서버가 **터미널 화면에서 읽은 번호 선택 화면**
//    (`prompt`)을 보내고, 여기서 버튼으로 그린다 — 버튼 = 그 번호 키. 숫자 키는 그 선택지를 고르고 다음 질문으로
//    넘어가며, 화면이 바뀌면 다음 prompt 가 온다(여러 질문 → 검토 화면 '1. Submit answers' 까지 같은 카드로).
//    직접 답은 'Type something.' 번호 → 글 → Enter. 화면을 못 읽으면 선택지 없는 prompt — 터미널 안내만.
//
// 읽기 개선(2026-10-01):
//   읽기 — 본문 760 단(CSS) · 연속 도구 호출 묶기 · Edit diff 색 · 내 메시지 시각 · 답변/코드 복사
//          위로 올려 읽는 중 '새 답변' · ⌘F 검색(데스크톱 — findSignal)
//   진행 — 할 일(TodoWrite) 고정 패널 · 서브에이전트(Agent) 호출은 묶지 않고 따로
//   입력창(폰) — `/` 명령·`@` 파일 자동완성 · 작업 중 상태 줄(화면에서 읽음) · [중단] · 선택지 버튼
//          쓰던 글은 세션별로 기억한다(lib/chatDrafts — 보기를 바꿔도 남게, persistKey)
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { Markdown } from '../../../components/Markdown';
import { useCopy } from '../../../lib/useCopy';
import type { ChatCommand, ChatItem, ChatPrompt, ChatQueued } from '../../../../shared/terminal-protocol';
import { getChatDraft, setChatDraft } from '../lib/chatDrafts';

type AskItem = Extract<ChatItem, { kind: 'ask' }>;
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

/** 바닥에서 이만큼 안이면 '바닥에 붙어 있다' — 새 말풍선이 오면 따라 내려간다 */
const STICK_PX = 80;
/** 직접 답 — 'Type something.' 으로 옮긴 뒤 글을 넣기까지의 틈(선택 이동이 먼저 처리되게) */
const FREE_TEXT_DELAY_MS = 120;
/** 이만큼 이상 이어진 도구 호출은 한 줄로 묶는다 */
const TOOL_GROUP_MIN = 2;
/**
 * 중단(Esc) 뒤 claude 입력란 비우기까지의 틈 — claude 는 중단하면 방금 보낸 글을 **입력란에 되돌려 놓는다**.
 * 채팅 보기에선 그 입력란이 안 보여 다음 메시지가 그 뒤에 이어 붙었다(2026-10-01 재현). 되돌아온 뒤 Ctrl+U 로 비운다
 */
const STOP_CLEAR_DELAY_MS = 800;
/**
 * 중단을 누른 뒤 '작업 중' 을 숨겨 두는 최대 시간 — 세션 상태(busy)는 출력이 2.5초 멈춰야 내려가서 중단 직후에도
 * 몇 초 '작업 중…' 이 남았다. 그 사이 [중단]을 거듭 누르게 되고, claude 에서 **Esc 두 번은 되감기(rewind)
 * 메뉴**라 보이지 않는 메뉴가 열렸다(2026-10-01 사용자 신고). 누르는 즉시 숨기고, 이 시간 안의 거듭 누름은 삼킨다.
 * busy 가 내려가면 바로 풀리고, 끝내 안 내려가면(멈추지 않았다) 이 시간 뒤 다시 보인다
 */
const STOP_HOLD_MS = 6000;
/** `/` 자동완성 목록에 보일 최대 수 */
const COMMAND_LIMIT = 8;

const isAgentTool = (t: ToolItem) => t.name === 'Agent' || t.name === 'Task';

/** 대기열 기본값 — 렌더마다 새 배열이면 따라 내리기 effect 가 매번 돈다 */
const NO_QUEUED: ChatQueued[] = [];

/** 최신 TodoWrite 의 할 일 — 상세가 '[x] …' · '[~] …' · '[ ] …' 줄이다(main transcript.ts describeTool) */
type Todo = { text: string; state: 'done' | 'doing' | 'todo' };
function latestTodos(items: ChatItem[]): Todo[] {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it.kind !== 'tool' || it.name !== 'TodoWrite') continue;
    return (it.detail ?? '').split('\n').flatMap((l) => {
      const m = /^\[(x|~| )\] (.*)$/.exec(l);
      return m ? [{ text: m[2], state: m[1] === 'x' ? 'done' : m[1] === '~' ? 'doing' : 'todo' } as Todo] : [];
    });
  }
  return [];
}

/** `@` 파일 후보 — 파일 이름이 질의로 시작 > 이름에 포함 > 경로에 포함 */
function matchFiles(files: string[], q: string): string[] {
  const a: string[] = [];
  const b: string[] = [];
  const c: string[] = [];
  for (const f of files) {
    const lf = f.toLowerCase();
    const base = lf.slice(lf.lastIndexOf('/') + 1);
    if (base.startsWith(q)) a.push(f);
    else if (base.includes(q)) b.push(f);
    else if (lf.includes(q)) c.push(f);
    if (a.length >= COMMAND_LIMIT) break;
  }
  return [...a, ...b, ...c].slice(0, COMMAND_LIMIT);
}

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
    // 서브에이전트 호출은 묶지 않는다 — 오래 걸리고 결과가 중요해 한 줄로 따로 보인다
    if (it.kind === 'tool' && !isAgentTool(it)) run.push(it);
    else {
      flush();
      out.push({ kind: 'item', item: it });
    }
  }
  flush();
  return out;
}

/**
 * 입력창 높이를 내용에 맞춘다(폰 입력창).
 * ⚠️ 숨은 채(display:none — 다른 탭에 있는 동안 쓰던 글 복원·재마운트) 재면 scrollHeight 가 0 이라 높이가 `0px` 로 박히고,
 *    min-height(40, border-box)가 테두리 몫만큼 모자라 **입력창에 2px 스크롤**이 생겼다(2026-10-01 사용자 신고, 재현). 숨었으면 건너뛰고
 *    보이게 될 때(ResizeObserver) 다시 잰다.
 * ⚠️ 스크롤은 max-height 를 넘을 때만 — 줄높이가 소수(1.35 × 16 = 21.6)라 기기에 따라 1px 남짓 넘쳐 스크롤 막대가 보일 수 있다.
 */
function fitInput(el: HTMLTextAreaElement | null) {
  if (!el || !el.clientWidth) return;
  el.style.height = 'auto';
  // scrollHeight 는 테두리를 뺀 값이다 — border-box 라 테두리만큼 더해야 넘치지 않는다
  const full = el.scrollHeight + el.offsetHeight - el.clientHeight;
  const max = parseFloat(getComputedStyle(el).maxHeight);
  el.style.height = `${full}px`;
  el.style.overflowY = full > max ? 'auto' : 'hidden';
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
  queued = NO_QUEUED,
  commands = null,
  onRequestCommands,
  files = null,
  onRequestFiles,
  persistKey,
  findSignal = 0,
  composer = true,
  onReturnFocus,
  onSend,
  onKey,
  onShowTerminal,
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
  /**
   * claude 가 일하는 중에 보내 **아직 안 읽힌** 내 메시지(대기열) — 맨 아래 회색 말풍선 '대기 중'.
   * 읽히면 대기열에서 빠지고 보통 말풍선으로 온다(2026-10-02 사용자 요청 — 둘째 메시지가 늦게 떴다)
   */
  queued?: ChatQueued[];
  /** `/` 자동완성 목록 — null 이면 아직 안 받았다(입력창에서 / 를 치면 onRequestCommands) */
  commands?: ChatCommand[] | null;
  onRequestCommands?: () => void;
  /** `@` 파일 자동완성 목록 — null 이면 아직 안 받았다(@ 를 치면 onRequestFiles) */
  files?: string[] | null;
  onRequestFiles?: () => void;
  /** 쓰던 글을 기억할 열쇠(세션 id) — 보기를 바꿨다 돌아와도 남는다 */
  persistKey?: string;
  /** 바뀔 때마다 검색 줄을 연다(데스크톱 ⌘F — 0 은 무시) */
  findSignal?: number;
  /**
   * 입력창·선택지 카드·작업 중 줄을 그린다(폰). false 면 읽기만 — 입력은 아래의 진짜 터미널이 맡고(데스크톱),
   * 대기 중 선택 화면·스피너도 거기 그대로 보이므로 여기서 다시 그리지 않는다
   */
  composer?: boolean;
  /** 검색 줄을 닫을 때 키보드를 돌려줄 곳 — 입력창이 없을 때(데스크톱 = 터미널) */
  onReturnFocus?: () => void;
  /** 입력창이 있을 때만 쓴다(composer) */
  onSend?: (text: string) => void;
  onKey?: (data: string) => void;
  onShowTerminal: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const [draft, setDraft] = useState(() => getChatDraft(persistKey));
  // 중단을 눌렀다 — 세션 상태가 따라 내려오기 전에 '작업 중' 을 먼저 숨긴다(STOP_HOLD_MS)
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);
  useEffect(() => {
    if (!stopping) return;
    const t = window.setTimeout(() => setStopping(false), STOP_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [stopping]);
  const working = busy && !stopping;
  // 화면 밖에 기억 — 보기를 터미널로 바꾸면 이 컴포넌트는 사라진다
  useEffect(() => setChatDraft(persistKey, draft), [persistKey, draft]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 선택 화면이 떠 있는데 직접 입력 자리가 없으면(검토·권한 화면) 입력창 글이 갈 곳이 없다
  const promptBlocksInput = !!prompt && !prompt.freeText;
  const blocks = useMemo(() => toBlocks(items), [items]);
  const sendKey = (data: string) => onKey?.(data);

  // 자동완성 — `/명령`(입력 전체가 '/이름' 일 때) · `@파일`(커서 앞 낱말이 '@…' 일 때).
  // Esc 로 닫으면 글이 바뀔 때까지 다시 열지 않는다
  const [caret, setCaret] = useState(0);
  const [pickIdx, setPickIdx] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const slash = /^\/(\S*)$/.exec(draft);
  const cmdQuery = slash ? slash[1].toLowerCase() : null;
  const at = slash ? null : /(^|\s)@([^\s@]*)$/.exec(draft.slice(0, caret));
  const fileQuery = at ? at[2].toLowerCase() : null;
  const cmdMatches = useMemo(() => {
    if (cmdQuery === null || !commands) return [];
    const starts = commands.filter((c) => c.name.toLowerCase().startsWith(cmdQuery));
    const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(cmdQuery) && c.name.toLowerCase().includes(cmdQuery));
    return [...starts, ...contains].slice(0, COMMAND_LIMIT);
  }, [cmdQuery, commands]);
  const fileMatches = useMemo(
    () => (fileQuery === null || !files ? [] : matchFiles(files, fileQuery)),
    [fileQuery, files],
  );
  const pickMode: 'cmd' | 'file' | null =
    dismissed === draft ? null : cmdMatches.length ? 'cmd' : fileMatches.length ? 'file' : null;
  const pickCount = pickMode === 'cmd' ? cmdMatches.length : pickMode === 'file' ? fileMatches.length : 0;
  useEffect(() => {
    if (cmdQuery !== null && commands === null) onRequestCommands?.();
  }, [cmdQuery, commands, onRequestCommands]);
  useEffect(() => {
    if (fileQuery !== null && files === null) onRequestFiles?.();
  }, [fileQuery, files, onRequestFiles]);
  useEffect(() => setPickIdx(0), [cmdQuery, fileQuery]);

  // 할 일(TodoWrite) — 남은 일이 있을 때만 채팅 위에 고정한다
  const todos = useMemo(() => latestTodos(items), [items]);
  const showTodos = todos.some((t) => t.state !== 'done');

  // 새 항목이 오면 바닥에 붙어 있을 때만 따라 내려간다(위로 올려 읽는 중이면 '새 답변' 표시)
  const lastCount = useRef(items.length);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    else if (items.length > lastCount.current) setHasNew(true);
    lastCount.current = items.length;
  }, [items, busy, prompt, status, queued]);

  // 목록 높이가 줄어도 바닥에 붙어 있었으면 마지막 내용을 계속 보인다 — 폰 키보드가 올라오면(셸이 `--mo-vh` 로
  // 줄어든다) 스크롤 위치는 그대로라 마지막 말풍선이 키보드 뒤로 밀려 내려갔다(2026-10-02 사용자 요청).
  // 데스크톱도 아래 칸(터미널)이 커질 때 같다. 높이가 줄어도 scroll 이벤트는 안 뜨므로 크기로 본다
  const unavailableNow = !!unavailable;
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let h = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight === h) return;
      h = el.clientHeight;
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [unavailableNow]);

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
  useEffect(() => fitInput(inputRef.current), [draft]);
  // 숨어 있다 보이게 됐을 때·폭이 바뀌었을 때(회전 — 줄바꿈이 달라진다)도 다시 맞춘다
  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return; // 높이 변화는 fitInput 자신이 만든 것
      width = el.clientWidth;
      fitInput(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [composer]);

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
    if (composer) inputRef.current?.focus();
    else onReturnFocus?.();
  };

  const send = () => {
    const text = draft.trim();
    if (!text || promptBlocksInput || !onSend) return;
    if (prompt?.freeText) {
      // 질문에 직접 답한다 — 'Type something.' 으로 옮겨 글을 넣는다(그냥 쓰면 선택 화면이 글을 버린다)
      sendKey(String(prompt.freeText));
      window.setTimeout(() => onSend(text), FREE_TEXT_DELAY_MS);
    } else {
      onSend(text);
    }
    setDraft('');
    setStopping(false); // 새 일을 맡겼다 — '작업 중' 을 다시 보인다
    stickRef.current = true; // 보낸 사람은 답을 보려 한다
  };

  /** claude 중단 — Esc, 그리고 되돌아온 글을 비운다(위 STOP_CLEAR_DELAY_MS). 중단 처리 중의 거듭 누름은 무시 */
  const stop = () => {
    if (stopping) return;
    setStopping(true);
    sendKey('\x1b');
    window.setTimeout(() => sendKey('\x15'), STOP_CLEAR_DELAY_MS);
  };

  const applyCommand = (c: ChatCommand) => {
    setDraft(`/${c.name} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** '@질의' 를 '@경로 ' 로 바꾸고 커서를 그 뒤로 */
  const applyFile = (path: string) => {
    if (!at) return;
    const start = caret - at[2].length - 1;
    const insert = `@${path} `;
    setDraft(draft.slice(0, start) + insert + draft.slice(caret));
    const pos = start + insert.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  const applyPick = (i: number) => {
    if (pickMode === 'cmd') applyCommand(cmdMatches[i] ?? cmdMatches[0]);
    else if (pickMode === 'file') applyFile(fileMatches[i] ?? fileMatches[0]);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⚠️ 한글 조합 중 키는 IME 몫이다 — Enter 는 글자 확정, 방향키는 조합 이동
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // 자동완성(`/`·`@`)이 떠 있으면 ↑↓·Enter·Tab·Esc 는 목록 조작
    if (pickMode) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPickIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + pickCount) % pickCount);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applyPick(pickIdx);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(draft);
      }
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

      {showTodos && <TodoPanel todos={todos} />}

      <div className="term-chat__body">
        <div ref={listRef} className="term-chat__list" onScroll={onScroll}>
          {!loaded && <div className="term-chat__note">대화를 불러오는 중…</div>}
          {loaded && !items.length && !fresh && <div className="term-chat__note">아직 대화가 없습니다.</div>}
          {loaded && !items.length && fresh && !composer && (
            // 첫 메시지 전(데스크톱) — 입력 자리는 아래 터미널이다. 폴더 신뢰 같은 확인 화면도 거기 그대로 보인다
            <div className="term-chat__fresh">
              <span>새 대화입니다. 아래 터미널에서 첫 메시지를 보내세요.</span>
            </div>
          )}
          {loaded && !items.length && fresh && composer && !prompt && (
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
          {queued.map((q) => (
            <div key={q.key} className="term-chat__row term-chat__row--me term-chat__row--queued">
              <span className="term-chat__time">대기 중</span>
              <div className="term-chat__bubble term-chat__bubble--me term-chat__bubble--queued">
                {q.images ? <span className="term-chat__img-tag">이미지 {q.images}장</span> : null}
                {q.text}
              </div>
            </div>
          ))}
          {composer &&
            (prompt ? (
              <PromptCard prompt={prompt} onKey={sendKey} onShowTerminal={onShowTerminal} />
            ) : (
              working && (
                <div className="term-chat__typing" role="status">
                  <span className="spinner spinner--xs" aria-hidden="true" />
                  <span className="term-chat__typing-text">{status ?? '작업 중…'}</span>
                </div>
              )
            ))}
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

      {composer && (
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
            {pickMode && (
              <ul className="term-chat__cmds" role="listbox" aria-label={pickMode === 'cmd' ? '명령' : '파일'}>
                {pickMode === 'cmd'
                  ? cmdMatches.map((c, i) => (
                      <li key={c.name}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={i === pickIdx}
                          className={'term-chat__cmd' + (i === pickIdx ? ' term-chat__cmd--on' : '')}
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
                    ))
                  : fileMatches.map((f, i) => {
                      const cut = f.lastIndexOf('/') + 1;
                      return (
                        <li key={f}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={i === pickIdx}
                            className={'term-chat__cmd' + (i === pickIdx ? ' term-chat__cmd--on' : '')}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              applyFile(f);
                            }}
                          >
                            <span className="term-chat__cmd-name">{f.slice(cut)}</span>
                            <span className="term-chat__cmd-desc">{f.slice(0, cut)}</span>
                          </button>
                        </li>
                      );
                    })}
              </ul>
            )}
            <textarea
              ref={inputRef}
              className="term-chat__input"
              rows={1}
              value={draft}
              disabled={promptBlocksInput}
              placeholder={
                promptBlocksInput ? '위 선택지에서 고르세요' : prompt ? '직접 답하기' : 'claude 에게 메시지 · / 명령'
              }
              aria-label="메시지"
              onChange={(e) => {
                setDraft(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onKeyDown={onInputKey}
            />
            {working && !prompt && !draft.trim() ? (
              // 작업 중이면 [중단] = Esc — 터미널에서 Esc 를 누르는 것과 같다
              <button
                type="button"
                className="term-chat__send term-chat__send--stop"
                aria-label="중단 (Esc)"
                onClick={stop}
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
      )}
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
        <Markdown copyCode answer>{text}</Markdown>
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
    <div
      className={`term-chat__tool term-chat__tool--${state}${nested ? ' term-chat__tool--nested' : ''}${
        isAgentTool(item) ? ' term-chat__tool--agent' : ''
      }`}
    >
      <button
        type="button"
        className="term-chat__tool-head"
        aria-expanded={hasMore ? open : undefined}
        disabled={!hasMore}
        onClick={() => setOpen((v) => !v)}
      >
        {isAgentTool(item) && state === 'run' ? (
          <span className="spinner spinner--xs" aria-hidden="true" />
        ) : (
          <span className="term-chat__tool-dot" aria-hidden="true" />
        )}
        <span className="term-chat__tool-name">{isAgentTool(item) ? '에이전트' : item.name}</span>
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
  onKey,
  onShowTerminal,
}: {
  prompt: ChatPrompt;
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
            {/* 직접 답 자리 아래 줄은 키 안내다(플랜 승인 'shift+tab to approve with this feedback') — 폰엔 맞지 않다 */}
            {o.description && o.n !== prompt.freeText && <span className="term-chat__opt-desc">{o.description}</span>}
          </button>
        ))}
      </div>
      <div className="term-chat__ask-foot">
        <button type="button" className="term-chat__ask-term" onClick={onShowTerminal}>
          <Icon name="terminal" size={12} />
          터미널에서 보기
        </button>
      </div>
    </div>
  );
}

/** 할 일 고정 패널 — 채팅 위 한 줄 '할 일 3/7 · 지금: …', 누르면 목록. 남은 일이 없으면 부모가 감춘다 */
function TodoPanel({ todos }: { todos: Todo[] }) {
  const [open, setOpen] = useState(false);
  const done = todos.filter((t) => t.state === 'done').length;
  const now = todos.find((t) => t.state === 'doing') ?? todos.find((t) => t.state === 'todo');
  return (
    <div className="term-chat__todos">
      <button type="button" className="term-chat__todos-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="term-chat__todos-count">
          할 일 {done}/{todos.length}
        </span>
        <span className="term-chat__todos-bar" aria-hidden="true">
          <i style={{ width: `${(done / todos.length) * 100}%` }} />
        </span>
        {now && <span className="term-chat__todos-now">{now.text}</span>}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      {open && (
        <ul className="term-chat__todos-list">
          {todos.map((t, i) => (
            <li key={i} className={`term-chat__todo term-chat__todo--${t.state}`}>
              <span className="term-chat__todo-mark" aria-hidden="true">
                {t.state === 'done' ? <Icon name="check" size={12} /> : t.state === 'doing' ? <span className="spinner spinner--xs" /> : null}
              </span>
              {t.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
