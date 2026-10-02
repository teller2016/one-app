import { useRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCopy } from '../lib/useCopy';
import { Icon } from './Icon';

/**
 * 마크다운 뷰어 — 리포트류 문서를 앱 톤으로 렌더링 (스타일은 _markdown.scss 의 .md).
 * raw HTML 은 react-markdown 기본값대로 무시되어 안전하고(XSS),
 * 링크는 앱 내 네비게이션 대신 기본 브라우저로 연다.
 */
/** 코드 블록 + 오른쪽 위 [복사] — 마우스를 올리면 보인다(채팅 보기) */
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const copy = useCopy();
  return (
    <div className="md__code">
      <pre ref={ref}>{children}</pre>
      <button
        type="button"
        className="md__copy"
        aria-label="코드 복사"
        onClick={() => void copy(ref.current?.textContent ?? '', { success: '코드를 복사했습니다' })}
      >
        <Icon name="copy" size={12} />
      </button>
    </div>
  );
}

/** 🎯 로 시작하는 문단 = 결론 줄(답변 첫 줄 형식) → `md__lead` */
function AnswerParagraph({ children }: { children?: ReactNode }) {
  const first = Array.isArray(children) ? children[0] : children;
  const lead = typeof first === 'string' && first.trimStart().startsWith('🎯');
  return <p className={lead ? 'md__lead' : undefined}>{children}</p>;
}

/** 체크리스트 칸(`- [x]`) — 원시 체크박스 대신 동그라미 표식. 마크다운에서 input 은 이것뿐이다 */
function TaskMark({ checked }: { checked?: boolean }) {
  return (
    <span className={`md__check${checked ? ' md__check--on' : ''}`} role="img" aria-label={checked ? '완료' : '남음'}>
      {checked && <Icon name="check" size={10} />}
    </span>
  );
}

export function Markdown({
  children,
  copyCode = false,
  answer = false,
}: {
  children: string;
  /** 코드 블록에 [복사] */
  copyCode?: boolean;
  /** claude 답변 표시(채팅 보기) — 🎯 결론 줄 강조 · 체크리스트 동그라미. 모양은 _terminal-chat.scss */
  answer?: boolean;
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...(copyCode ? { pre: CodeBlock } : {}),
          ...(answer ? { p: AnswerParagraph, input: TaskMark } : {}),
          a: ({ href, children: label }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) void window.oneApp.openExternal(href);
              }}
            >
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
