// MO 채팅 보기 — 터미널 세션 안 claude 의 대화 기록(jsonl)을 말풍선으로 보여준다.
// 데이터는 controller(→ 서버 chat.ts)가 대고, 여기는 그린다. 입력은 서버가 붙여넣기·Enter 로 PTY 에 넣는다.
//
// ⚠️ 대화 기록에는 claude 의 **TUI 상호작용**이 남지 않는다 — 특히 AskUserQuestion 질문은 답하기 전까지 기록에
//    없다(2026-10-01 실측). 그래서 claude 가 답을 기다리는 동안은 서버가 **터미널 화면에서 읽은 번호 선택 화면**
//    (`prompt`)을 보내고, 여기서 버튼으로 그린다 — 버튼 = 그 번호 키. 숫자 키는 그 선택지를 고르고 다음 질문으로
//    넘어가며, 화면이 바뀌면 다음 prompt 가 온다(여러 질문 → 검토 화면 '1. Submit answers' 까지 같은 카드로).
//    직접 답은 'Type something.' 번호 → 글 → Enter. 화면을 못 읽으면 선택지 없는 prompt — 터미널 안내만.
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../renderer/components/Icon';
import { Markdown } from '../../renderer/components/Markdown';
import type { ChatItem, ChatPrompt } from '../../shared/terminal-protocol';

type AskItem = Extract<ChatItem, { kind: 'ask' }>;
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

/** 바닥에서 이만큼 안이면 '바닥에 붙어 있다' — 새 말풍선이 오면 따라 내려간다 */
const STICK_PX = 80;
/** 직접 답 — 'Type something.' 으로 옮긴 뒤 글을 넣기까지의 틈(선택 이동이 먼저 처리되게) */
const FREE_TEXT_DELAY_MS = 120;

export function MoChatView({
  items,
  loaded,
  unavailable,
  fresh,
  prompt,
  busy,
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
  onSend: (text: string) => void;
  onKey: (data: string) => void;
  onShowTerminal: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 선택 화면이 떠 있는데 직접 입력 자리가 없으면(검토·권한 화면) 입력창 글이 갈 곳이 없다
  const promptBlocksInput = !!prompt && !prompt.freeText;

  // 새 항목이 오면 바닥에 붙어 있을 때만 따라 내려간다(위로 올려 읽는 중이면 그대로)
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [items, busy, prompt]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    stickRef.current = bottom;
    if (bottom !== atBottom) setAtBottom(bottom);
  };

  const toBottom = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = true;
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
    stickRef.current = true; // 보낸 사람은 답을 보려 한다
  };

  if (unavailable) {
    return (
      <div className="mochat mochat--empty">
        <span className="moterm__empty-icon" aria-hidden="true">
          <Icon name="terminal" size={20} />
        </span>
        <span className="moterm__empty-title">채팅으로 볼 수 없는 세션입니다</span>
        <span className="moterm__empty-hint">{unavailable}</span>
        <button type="button" className="moterm__btn moterm__btn--primary moterm__btn--lg" onClick={onShowTerminal}>
          <Icon name="terminal" size={16} />
          터미널로 보기
        </button>
      </div>
    );
  }

  return (
    <div className="mochat">
      <div className="mochat__body">
        <div ref={listRef} className="mochat__list" onScroll={onScroll}>
          {!loaded && <div className="mochat__note">대화를 불러오는 중…</div>}
          {loaded && !items.length && !fresh && <div className="mochat__note">아직 대화가 없습니다.</div>}
          {loaded && !items.length && fresh && !prompt && (
            // 첫 메시지 전 — 폴더 신뢰 확인 같은 TUI 화면도 이 상태라 구분할 수 없어 안내를 함께 둔다
            <div className="mochat__fresh">
              <span>새 대화입니다. 아래 입력창으로 첫 메시지를 보내세요.</span>
              <span className="mochat__fresh-hint">터미널에 확인 화면(폴더 신뢰 등)이 떠 있으면 먼저 답해야 합니다.</span>
              <button type="button" className="moterm__btn moterm__btn--ghost" onClick={onShowTerminal}>
                <Icon name="terminal" size={14} />
                터미널 확인
              </button>
            </div>
          )}
          {items.map((it) => (
            <ChatRow key={it.key} item={it} />
          ))}
          {prompt ? (
            <PromptCard prompt={prompt} onKey={onKey} onShowTerminal={onShowTerminal} />
          ) : (
            busy && (
              <div className="mochat__typing" role="status">
                <span className="spinner spinner--xs" aria-hidden="true" />
                작업 중…
              </div>
            )
          )}
        </div>

        {!atBottom && (
          <button type="button" className="moterm__to-bottom" onClick={toBottom}>
            <Icon name="arrow-down-to-line" size={14} />
            맨 아래로
          </button>
        )}
      </div>

      <form
        className="mochat__composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          className="mochat__input"
          rows={1}
          value={draft}
          disabled={promptBlocksInput}
          placeholder={promptBlocksInput ? '위 선택지에서 고르세요' : prompt ? '직접 답하기' : 'claude 에게 메시지'}
          aria-label="메시지"
          onChange={(e) => setDraft(e.target.value)}
        />
        {busy && !prompt && !draft.trim() ? (
          // 작업 중이면 Esc = claude 중단 — 터미널에서 Esc 를 누르는 것과 같다
          <button
            type="button"
            className="mochat__send mochat__send--stop"
            aria-label="중단 (Esc)"
            onClick={() => onKey('\x1b')}
          >
            <span className="mochat__stop-mark" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            className="mochat__send"
            aria-label="보내기"
            disabled={!draft.trim() || promptBlocksInput}
          >
            <Icon name="arrow-up-right" size={18} />
          </button>
        )}
      </form>
    </div>
  );
}

// ── 항목 ──

const ChatRow = memo(function ChatRow({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="mochat__row mochat__row--me">
          <div className="mochat__bubble mochat__bubble--me">
            {item.images ? <span className="mochat__img-tag">이미지 {item.images}장</span> : null}
            {item.text}
          </div>
        </div>
      );
    case 'notice':
      return <div className="mochat__notice">{item.text}</div>;
    case 'command':
      return (
        <div className="mochat__row mochat__row--me">
          <span className="mochat__command">{item.text}</span>
        </div>
      );
    case 'assistant':
      return (
        <div className="mochat__row">
          <div className="mochat__bubble mochat__bubble--ai">
            <Markdown>{item.text}</Markdown>
          </div>
        </div>
      );
    case 'tool':
      return <ToolRow item={item} />;
    case 'ask':
      return <AskRecord item={item} />;
  }
});

/** 도구 호출 — 한 줄 요약, 누르면 입력 상세·결과를 펼친다 */
function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const state = !item.result ? 'run' : item.result.isError ? 'err' : 'ok';
  const hasMore = !!(item.detail || item.result?.text);
  return (
    <div className={`mochat__tool mochat__tool--${state}`}>
      <button
        type="button"
        className="mochat__tool-head"
        aria-expanded={hasMore ? open : undefined}
        disabled={!hasMore}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mochat__tool-dot" aria-hidden="true" />
        <span className="mochat__tool-name">{item.name}</span>
        <span className="mochat__tool-sum">{item.summary}</span>
        {hasMore && <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />}
      </button>
      {open && (
        <div className="mochat__tool-body">
          {item.detail && <pre className="mochat__pre">{item.detail}</pre>}
          {item.result?.text && (
            <pre className={`mochat__pre mochat__pre--out${item.result.isError ? ' mochat__pre--err' : ''}`}>
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
    <div className="mochat__ask mochat__ask--done">
      {answers.length
        ? answers.map(([q, a], i) => (
            <div key={i} className="mochat__ask-pair">
              <span className="mochat__ask-q">{q}</span>
              <span className="mochat__ask-answer">→ {a}</span>
            </div>
          ))
        : item.questions.map((q, i) => (
            <div key={i} className="mochat__ask-q">
              {q.question}
            </div>
          ))}
      {!answers.length && item.result?.text && <div className="mochat__ask-answer">{item.result.text}</div>}
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
      <div className="mochat__ask">
        <div className="mochat__ask-q">claude 가 터미널에서 답을 기다립니다</div>
        <button type="button" className="mochat__opt mochat__opt--primary" onClick={onShowTerminal}>
          터미널로 보기
        </button>
      </div>
    );
  }
  return (
    <div className="mochat__ask">
      {prompt.header && <span className="mochat__ask-step mochat__ask-step--on">{prompt.header}</span>}
      {prompt.question && <div className="mochat__ask-q">{prompt.question}</div>}
      <div className="mochat__ask-opts">
        {prompt.options.map((o) => (
          <button
            key={o.n}
            type="button"
            className={`mochat__opt${o.n === prompt.freeText ? ' mochat__opt--free' : ''}`}
            // 직접 답 자리는 버튼이 아니라 입력창으로 — 눌러도 커서만 옮겨 두고 글은 입력창에서
            onClick={() => (o.n === prompt.freeText ? undefined : onKey(String(o.n)))}
            disabled={o.n === prompt.freeText}
          >
            <span className="mochat__opt-label">
              {o.n}. {o.n === prompt.freeText ? '직접 답하기 — 아래 입력창' : o.label}
            </span>
            {o.description && <span className="mochat__opt-desc">{o.description}</span>}
          </button>
        ))}
      </div>
      <button type="button" className="mochat__ask-term" onClick={onShowTerminal}>
        <Icon name="terminal" size={12} />
        터미널에서 보기
      </button>
    </div>
  );
}
