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

export function Markdown({ children, copyCode = false }: { children: string; /** 코드 블록에 [복사] */ copyCode?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...(copyCode ? { pre: CodeBlock } : {}),
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
