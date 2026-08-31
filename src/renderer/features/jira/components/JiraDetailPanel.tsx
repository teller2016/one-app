import { useEffect, useRef, useState } from 'react';
import type { JiraIssueDetail } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { errMsg } from '../../../lib/errMsg';
import { useBackClose } from '../../../lib/useBackClose';
import { useThemeMode } from '../../../lib/theme';
import { isDone } from '../lib/issue';

/** 상세 조회 상태 — 선택한 이슈의 로딩/성공/실패 */
type DetailState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; detail: JiraIssueDetail }
  | { kind: 'error'; message: string };

/** iframe 문서에 끼워 넣는 텍스트(작성자·시각) 이스케이프 */
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * 본문+댓글을 sandbox iframe 문서로 감싼다 (메일 리더와 동일 문법 — 스크립트 차단).
 * 상대경로 링크·이미지가 Jira 호스트로 풀리도록 base href 지정, 링크는 항상 새 창으로
 * 나가고 main 의 setWindowOpenHandler 가 기본 브라우저로 연다.
 * srcdoc 은 앱 CSS 변수를 상속받지 못해 테마 팔레트를 인라인한다 (_base.scss 토큰 근사값).
 */
function detailDoc(detail: JiraIssueDetail, dark: boolean): string {
  let baseHref = '';
  try {
    baseHref = new URL(detail.url).origin + '/';
  } catch {
    /* url 이 비정상이면 base 없이 렌더 */
  }
  const c = dark
    ? {
        bg: '#1c1c1e',
        text: '#e6e6e8',
        muted: '#98989e',
        link: '#6ea8fe',
        border: '#3a3a3c',
        soft: '#2c2c2e',
        card: '#232326',
      }
    : {
        bg: '#ffffff',
        text: '#1a1a1a',
        muted: '#8a8a8a',
        link: '#2563eb',
        border: '#e2e2e5',
        soft: '#f5f5f6',
        card: '#f7f7f8',
      };
  const comments = detail.comments
    .map(
      (cm) => `<section class="cmt">
        <div class="cmt-head"><b>${esc(cm.author)}</b>${
          cm.created ? `<span>${esc(cm.created)}</span>` : ''
        }</div>
        <div>${cm.html}</div>
      </section>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><base ${baseHref ? `href="${baseHref}" ` : ''}target="_blank"><style>
    :root{color-scheme:${dark ? 'dark' : 'light'};}
    html,body{margin:0;padding:14px;background:${c.bg};color:${c.text};
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.6;word-break:break-word;}
    img{max-width:100%;height:auto;} a{color:${c.link};}
    table{border-collapse:collapse;max-width:100%;}
    th,td{border:1px solid ${c.border};padding:4px 8px;}
    pre{background:${c.soft};border-radius:6px;padding:10px;overflow:auto;}
    code{background:${c.soft};border-radius:4px;padding:1px 4px;}
    blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid ${c.border};color:${c.muted};}
    .empty{color:${c.muted};}
    .cmts-title{margin:26px 0 10px;padding-top:16px;border-top:1px solid ${c.border};
      font-size:11px;font-weight:700;color:${c.muted};text-transform:uppercase;letter-spacing:.05em;}
    .cmt{background:${c.card};border:1px solid ${c.border};border-radius:8px;
      padding:10px 12px;margin:0 0 10px;}
    .cmt-head{display:flex;gap:8px;align-items:baseline;font-size:12px;
      padding-bottom:6px;margin-bottom:8px;border-bottom:1px solid ${c.border};}
    .cmt-head span{color:${c.muted};font-weight:400;}
  </style></head><body>
    ${detail.descriptionHtml || '<p class="empty">본문이 없습니다.</p>'}
    ${detail.comments.length ? `<div class="cmts-title">댓글 ${detail.comments.length}</div>${comments}` : ''}
  </body></html>`;
}

/** 상태 → 뱃지 색 (목록 IssueRow 와 동일 규칙) */
const badgeVariant = (d: JiraIssueDetail) =>
  isDone(d) ? ('ok' as const) : d.statusCategory === 'indeterminate' ? ('busy' as const) : ('idle' as const);

/**
 * 이슈 상세 패널 — 목록 배치는 그대로 두고 오른쪽에서 슬라이드로 떠오른다.
 * 닫힘 애니메이션을 위해 항상 마운트하고, 닫는 동안 내용은 유지한다.
 * 열 때마다 새로 조회 (상태·댓글이 바뀌었을 수 있음).
 */
export function JiraDetailPanel({
  issueKey,
  open,
  onClose,
  onStartWork,
}: {
  issueKey: string | null;
  open: boolean;
  onClose: () => void;
  /** 티켓 내용을 확인한 자리에서 바로 작업 시작 (위치 선택 모달로) */
  onStartWork: (detail: JiraIssueDetail) => void;
}) {
  const [state, setState] = useState<DetailState>({ kind: 'idle' });
  const panelRef = useRef<HTMLElement>(null);
  // 테마가 바뀌면 srcDoc 팔레트도 함께 재생성된다
  const dark = useThemeMode() === 'dark';

  // 폰 뒤로가기로 닫힌다 — ⚠️ 이 패널은 Modal 이 아니라 슬라이드 패널이라 공용 Modal 의
  // 처리가 닿지 않는다. 안 걸어두면 상세를 연 채 뒤로가기를 누르는 순간 앱이 닫힌다
  // (2026-08-08 사용자 지적).
  useBackClose(onClose, open);

  useEffect(() => {
    if (!open || !issueKey) return;
    let stale = false; // 다른 이슈로 갈아탄 뒤 늦게 도착한 응답 무시
    setState({ kind: 'loading' });
    void window.oneApp.jira
      .getDetail(issueKey)
      .then((res) => {
        if (stale) return;
        if (res.ok && res.detail) setState({ kind: 'ok', detail: res.detail });
        else
          setState({
            kind: 'error',
            message: res.error ?? '이슈를 불러오지 못했습니다.',
          });
      })
      .catch((err) => {
        // invoke 거부(핸들러 미등록·폰 WS 끊김)도 잡는다 — 안 잡으면 스피너가 영영 남는다
        if (!stale)
          setState({
            kind: 'error',
            message: errMsg(err, '이슈를 불러오지 못했습니다.'),
          });
      });
    return () => {
      stale = true;
    };
  }, [issueKey, open]);

  // 닫힌 뒤에는 본문을 내려놓는다 — 안 그러면 마지막 이슈의 iframe(본문 HTML + 인라인 이미지)이
  // Jira 섹션이 살아 있는 내내 DOM 에 남는다(2026-08-27 메모리 감사). 슬라이드아웃(--dur-2 =
  // 0.18s)이 끝난 뒤 비워야 닫히는 도중 내용이 사라지는 깜빡임이 없다.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setState({ kind: 'idle' }), 220);
    return () => clearTimeout(t);
  }, [open]);

  // Escape 로 닫기 (열려 있을 때만)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 패널 밖 클릭으로 닫기 — 여는 클릭은 리스너 등록(effect) 전에 끝나 안전하고,
  // 다른 이슈 제목 클릭은 전환 동작이라 예외. iframe 안 클릭은 부모로 안 올라온다.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (panelRef.current?.contains(t)) return;
      if (t.closest('.jira__title')) return;
      onClose();
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [open, onClose]);

  const openBrowser = (url: string) => {
    void window.oneApp.openExternal(url);
  };

  return (
    <aside
      ref={panelRef}
      className={'jira-view' + (open ? ' jira-view--open' : '')}
      aria-hidden={!open}
    >
      <button
        type="button"
        className="icon-btn jira-view__close"
        title="닫기 (Esc)"
        onClick={onClose}
      >
        <Icon name="x" size={14} />
      </button>

      {state.kind === 'idle' ? null : state.kind === 'loading' ? (
        <div className="jira-view__placeholder">
          <span className="spinner" />
          <p className="hint">이슈 불러오는 중...</p>
        </div>
      ) : state.kind === 'error' ? (
        <Banner variant="danger">{state.message}</Banner>
      ) : (
        <div className="jira-view__body">
          <div className="jira-view__head">
            <div className="jira-view__top">
              <button
                type="button"
                className="jira-view__key"
                onClick={() => openBrowser(state.detail.url)}
                title={`${state.detail.key} — 브라우저에서 열기`}
              >
                {state.detail.key}
              </button>
              <Badge variant={badgeVariant(state.detail)}>
                {state.detail.status}
              </Badge>
            </div>
            <h4 className="jira-view__summary">{state.detail.summary}</h4>
            <div className="jira-view__meta">
              {state.detail.issueType && <span>{state.detail.issueType}</span>}
              {state.detail.priority && (
                <span>우선순위 {state.detail.priority}</span>
              )}
              {state.detail.reporter && <span>보고자 {state.detail.reporter}</span>}
              {state.detail.updated && (
                <span>업데이트 {state.detail.updated}</span>
              )}
            </div>
            <div className="jira-view__actions">
              <Button size="sm" onClick={() => onStartWork(state.detail)}>
                <Icon name="play" size={13} />
                작업 시작
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openBrowser(state.detail.url)}
              >
                <Icon name="arrow-up-right" size={13} />
                브라우저에서 열기
              </Button>
            </div>
          </div>
          {/* 스크립트는 계속 차단하고 링크 클릭(팝업)만 허용 — 실제 창 생성은
              main 의 setWindowOpenHandler 가 가로채 기본 브라우저로 연다 */}
          <iframe
            className="jira-view__frame"
            title="이슈 본문"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={detailDoc(state.detail, dark)}
          />
        </div>
      )}
    </aside>
  );
}
