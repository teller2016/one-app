import { useCallback, useEffect, useState } from 'react';
import type { MailBody, MailItem } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Modal } from '../../../components/Modal';
import { RefreshButton } from '../../../components/RefreshButton';
import { mailTime, senderName } from '../lib/format';

/** 본문 조회 상태 — 선택한 메일의 로딩/성공/실패 */
type BodyState =
  | { kind: 'idle' }
  | { kind: 'loading'; muid: number }
  | { kind: 'ok'; body: MailBody }
  | { kind: 'error'; message: string };

/** 메일 HTML 을 sandbox iframe 으로 안전하게 감싼다 (스크립트 차단 + 흰 배경 고정) */
function bodyDoc(html: string, webUrl: string): string {
  // 상대경로 링크가 그룹웨어 호스트로 풀리도록 base href 지정 — 링크는 항상 새 창(target=_blank)으로
  // 나가고, main 의 setWindowOpenHandler 가 이를 받아 기본 브라우저로 연다
  let baseHref = '';
  try {
    baseHref = new URL(webUrl).origin + '/';
  } catch {
    /* webUrl 이 비정상이면 base 없이 렌더 */
  }
  return `<!doctype html><html><head><meta charset="utf-8"><base ${baseHref ? `href="${baseHref}" ` : ''}target="_blank"><style>
    html,body{margin:0;padding:14px;background:#fff;color:#1a1a1a;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.6;word-break:break-word;}
    img{max-width:100%;height:auto;} a{color:#2563eb;} table{max-width:100%;}
  </style></head><body>${html}</body></html>`;
}

/**
 * 메일 리더 모달 — 왼쪽 받은편지함 목록 + 오른쪽 본문(sandbox iframe).
 * 열릴 때 받은편지함을 새로 불러오고, 안읽은 메일을 열면 읽음 처리 후 onRead 로 알린다.
 */
export function MailModal({
  onClose,
  onRead,
}: {
  onClose: () => void;
  /** 안읽은 메일을 열어 읽음 처리됐을 때 (사이드바 뱃지 즉시 갱신용) */
  onRead: (muid: number) => void;
}) {
  const [items, setItems] = useState<MailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [body, setBody] = useState<BodyState>({ kind: 'idle' });

  const loadInbox = useCallback(async () => {
    setLoading(true);
    const res = await window.oneApp.mail.getInbox(30);
    if (res.ok && res.items) {
      setItems(res.items);
      setListError('');
    } else {
      setListError(res.error ?? '메일을 불러오지 못했습니다.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const openMail = async (item: MailItem) => {
    setSelected(item.muid);
    setBody({ kind: 'loading', muid: item.muid });
    const unread = !item.seen;
    const res = await window.oneApp.mail.getBody(item.muid, unread);
    if (res.ok && res.body) {
      setBody({ kind: 'ok', body: res.body });
      if (unread) {
        // 로컬 목록·사이드바 뱃지를 즉시 읽음으로 반영
        setItems((prev) =>
          prev.map((m) => (m.muid === item.muid ? { ...m, seen: true } : m)),
        );
        onRead(item.muid);
      }
    } else {
      setBody({ kind: 'error', message: res.error ?? '본문을 불러오지 못했습니다.' });
    }
  };

  const openInBrowser = (url: string) => {
    void window.oneApp.openExternal(url);
  };

  return (
    <Modal
      title={
        <span className="mail-modal__title">
          <Icon name="mail" size={16} />
          메일
        </span>
      }
      onClose={onClose}
      wide
    >
      <div className="mail-modal">
        {/* 왼쪽 — 받은편지함 목록 */}
        <div className="mail-modal__list">
          <div className="mail-modal__list-head">
            <span className="mail-modal__list-title">받은편지함</span>
            <RefreshButton
              size={13}
              spinning={loading}
              onClick={() => void loadInbox()}
              title="목록 새로고침"
            />
          </div>

          {listError && <Banner variant="danger">{listError}</Banner>}

          {loading && items.length === 0 ? (
            <p className="hint">불러오는 중...</p>
          ) : items.length === 0 && !listError ? (
            <div className="empty-state">
              <span className="empty-state__icon">
                <Icon name="mail" size={20} />
              </span>
              <p>받은 메일이 없습니다.</p>
            </div>
          ) : (
            <ul className="mail-list">
              {items.map((m) => (
                <li key={m.muid}>
                  <button
                    type="button"
                    className={
                      'mail-list__item' +
                      (m.muid === selected ? ' mail-list__item--active' : '') +
                      (m.seen ? '' : ' mail-list__item--unread')
                    }
                    onClick={() => void openMail(m)}
                  >
                    <span className="mail-list__dot" aria-hidden="true" />
                    <span className="mail-list__main">
                      <span className="mail-list__top">
                        <span className="mail-list__from">
                          {senderName(m.from)}
                        </span>
                        <span className="mail-list__time">
                          {mailTime(m.date)}
                        </span>
                      </span>
                      <span className="mail-list__subject">
                        {m.hasAttach && (
                          <Icon name="paperclip" size={11} className="mail-list__clip" />
                        )}
                        {m.subject}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 오른쪽 — 본문 */}
        <div className="mail-modal__view">
          {body.kind === 'idle' ? (
            <div className="empty-state mail-modal__placeholder">
              <span className="empty-state__icon">
                <Icon name="mail" size={20} />
              </span>
              <p>메일을 선택하면 본문이 표시됩니다.</p>
            </div>
          ) : body.kind === 'loading' ? (
            <div className="mail-modal__placeholder">
              <span className="spinner" />
              <p className="hint">본문 불러오는 중...</p>
            </div>
          ) : body.kind === 'error' ? (
            <Banner variant="danger">{body.message}</Banner>
          ) : (
            <div className="mail-view">
              <div className="mail-view__head">
                <h4 className="mail-view__subject">{body.body.subject}</h4>
                <div className="mail-view__meta">
                  <span className="mail-view__from">
                    {senderName(body.body.from)}
                  </span>
                  {body.body.date && (
                    <span className="mail-view__date">{body.body.date}</span>
                  )}
                </div>
                <div className="mail-view__actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openInBrowser(body.body.webUrl)}
                  >
                    <Icon name="arrow-up-right" size={13} />
                    그룹웨어에서 열기
                  </Button>
                </div>
              </div>
              {/* 스크립트는 계속 차단하고 링크 클릭(팝업)만 허용 — 실제 창 생성은
                  main 의 setWindowOpenHandler 가 가로채 기본 브라우저로 연다 */}
              <iframe
                className="mail-view__frame"
                title="메일 본문"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={bodyDoc(body.body.html, body.body.webUrl)}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
