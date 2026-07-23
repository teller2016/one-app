import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 마크다운 뷰어 — 리포트류 문서를 앱 톤으로 렌더링 (스타일은 _markdown.scss 의 .md).
 * raw HTML 은 react-markdown 기본값대로 무시되어 안전하고(XSS),
 * 링크는 앱 내 네비게이션 대신 기본 브라우저로 연다.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
