import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MailBody,
  MailFolder,
  MailFolderUnread,
  MailItem,
} from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Modal } from '../../../components/Modal';
import { Pagination } from '../../../components/Pagination';
import { RefreshButton } from '../../../components/RefreshButton';
import { Segment } from '../../../components/Segment';
import { mailTime, senderName } from '../lib/format';
import { AuthCodePanel } from './AuthCodePanel';

/** 한 페이지 메일 건수 */
const PAGE_SIZE = 30;

/**
 * 리더 모달의 탭 — 폴더 두 개 + '인증코드'.
 * 인증코드는 폴더가 아니므로 `MailFolder` 에 섞지 않는다(목록 조회 파라미터가 오염된다).
 */
type Tab = MailFolder | 'authcode';

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
 * 메일 리더 모달 — 목록(받은편지함·스팸 세그먼트 전환)은 항상 전체폭(배치 유지),
 * 메일을 선택하면 본문(sandbox iframe) 패널이 오른쪽에서 슬라이드로 떠오른다. [×]로 패널만 닫힌다.
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
  const [tab, setTab] = useState<Tab>('inbox');
  const [folder, setFolder] = useState<MailFolder>('inbox');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  // 폴더별 안읽음 수 — 탭을 전환하기 전에 어느 편지함에 안읽은 메일이 있는지 알리는 용도
  const [unread, setUnread] = useState<MailFolderUnread>({ inbox: 0, spam: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [body, setBody] = useState<BodyState>({ kind: 'idle' });
  // 패널 표시 여부 — 닫을 때 body 를 남겨둬야 슬라이드아웃 중 내용이 사라지지 않는다
  const [viewOpen, setViewOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  // 요청 순번 — 페이지를 빠르게 넘길 때 뒤늦게 도착한 이전 응답을 버린다
  const reqSeq = useRef(0);
  // 본문 요청 순번 — 목록에서 메일을 연달아 클릭할 때 이전 본문이 뒤늦게 덮어쓰는 것을 막는다
  const bodySeq = useRef(0);

  const loadList = useCallback(async (f: MailFolder, p: number) => {
    const seq = reqSeq.current + 1;
    reqSeq.current = seq;
    setLoading(true);
    const res = await window.oneApp.mail.getInbox({
      folder: f,
      page: p,
      pageSize: PAGE_SIZE,
    });
    if (seq !== reqSeq.current) return; // 더 최신 요청이 진행 중 — 이 응답은 버림
    if (res.ok && res.items) {
      setItems(res.items);
      setTotal(res.total ?? res.items.length);
      // 폴더별 안읽음은 목록과 같은 응답에 실려 온다(추가 왕복 없음)
      if (res.folderUnread) setUnread(res.folderUnread);
      setListError('');
    } else {
      setListError(res.error ?? '메일을 불러오지 못했습니다.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadList(folder, page);
  }, [loadList, folder, page]);

  // 폴더 전환 — 이전 폴더 목록·열린 본문을 비우고 1페이지부터 새로 불러온다
  const changeFolder = (f: MailFolder) => {
    if (f === folder) return;
    setFolder(f);
    setPage(1);
    setItems([]);
    setTotal(0);
    setSelected(null);
    setViewOpen(false);
  };

  /**
   * 탭 전환 — '인증코드' 는 폴더가 아니라서 목록 조회를 건드리지 않는다.
   * 폴더 탭으로 돌아오면 이미 불러온 목록이 그대로 보인다(불필요한 재조회 없음).
   */
  const changeTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    // 어느 탭으로 가든 떠 있는 본문 패널은 닫는다
    setSelected(null);
    setViewOpen(false);
    if (next !== 'authcode') changeFolder(next);
  };

  // 페이지 이동 — 목록 스크롤을 맨 위로 되돌리고 열린 본문은 닫는다
  const changePage = (p: number) => {
    setPage(p);
    setItems([]);
    setSelected(null);
    setViewOpen(false);
    listRef.current?.scrollTo({ top: 0 });
  };

  const openMail = async (item: MailItem) => {
    const seq = bodySeq.current + 1;
    bodySeq.current = seq;
    setSelected(item.muid);
    setViewOpen(true);
    setBody({ kind: 'loading', muid: item.muid });
    const wasUnread = !item.seen;
    const res = await window.oneApp.mail.getBody(item.muid, wasUnread);
    // 늦게 온 응답이 방금 연 다른 메일의 본문을 덮어쓰지 않게 한다.
    // ⚠️ 읽음 처리는 세대와 무관하게 반영한다 — 서버는 이미 읽음으로 바꿨으므로
    //    여기서 건너뛰면 목록·뱃지만 안읽음으로 남아 어긋난다.
    const fresh = seq === bodySeq.current;
    if (res.ok && res.body) {
      if (fresh) setBody({ kind: 'ok', body: res.body });
      if (wasUnread) {
        // 로컬 목록·세그먼트 뱃지·사이드바 뱃지를 즉시 읽음으로 반영
        setItems((prev) =>
          prev.map((m) => (m.muid === item.muid ? { ...m, seen: true } : m)),
        );
        setUnread((prev) => ({
          ...prev,
          [folder]: Math.max(0, prev[folder] - 1),
        }));
        onRead(item.muid);
      }
    } else if (fresh) {
      setBody({ kind: 'error', message: res.error ?? '본문을 불러오지 못했습니다.' });
    }
  };

  const openInBrowser = (url: string) => {
    void window.oneApp.openExternal(url);
  };

  // 본문 패널 닫기 — body 는 유지한 채 슬라이드아웃 (목록 배치는 애초에 안 바뀐다)
  const closeView = () => {
    setSelected(null);
    setViewOpen(false);
  };

  /** 세그먼트 라벨 — 안읽은 메일이 있는 폴더에만 개수 뱃지를 붙인다(세 자리는 99+ 로 클램프) */
  const folderLabel = (f: MailFolder, text: string) => {
    const n = unread[f];
    return (
      <>
        {text}
        {n > 0 && (
          <span className="mail-modal__seg-count" title={`안읽은 메일 ${n}통`}>
            {n > 99 ? '99+' : n}
          </span>
        )}
      </>
    );
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
        {/* 메일 목록 — 항상 전체폭 (본문 패널이 위로 떠오른다) */}
        <div className="mail-modal__list">
          <div className="mail-modal__list-head">
            <Segment<Tab>
              options={[
                { value: 'inbox', label: folderLabel('inbox', '받은편지함') },
                { value: 'spam', label: folderLabel('spam', '스팸메일함') },
                { value: 'authcode', label: '인증코드' },
              ]}
              value={tab}
              onChange={changeTab}
            />
            {/* 인증코드 탭은 목록이 없다 — 새로고침 버튼도 함께 감춘다 */}
            {tab !== 'authcode' && (
              <RefreshButton
                size={13}
                spinning={loading}
                onClick={() => void loadList(folder, page)}
                title="목록 새로고침"
              />
            )}
          </div>

          {tab === 'authcode' ? (
            <AuthCodePanel />
          ) : (
            <>
              {listError && <Banner variant="danger">{listError}</Banner>}

              {loading && items.length === 0 ? (
                <p className="hint">불러오는 중...</p>
              ) : items.length === 0 && !listError ? (
                <div className="empty-state">
                  <span className="empty-state__icon">
                    <Icon name="mail" size={20} />
                  </span>
                  <p>
                    {folder === 'spam'
                      ? '스팸 메일이 없습니다.'
                      : '받은 메일이 없습니다.'}
                  </p>
                </div>
              ) : (
                <ul className="mail-list" ref={listRef}>
                  {items.map((m) => (
                    <li key={m.muid}>
                      <button
                        type="button"
                        className={
                          'mail-list__item' +
                          (m.muid === selected
                            ? ' mail-list__item--active'
                            : '') +
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
                              <Icon
                                name="paperclip"
                                size={11}
                                className="mail-list__clip"
                              />
                            )}
                            {m.subject}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* 과거 메일 — 서버 페이징(폴더 전체 건수 기준) */}
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onChange={changePage}
                disabled={loading}
              />
            </>
          )}
        </div>

        {/* 본문 패널 — 오른쪽에서 슬라이드 인 (닫힘 애니메이션을 위해 항상 마운트) */}
        <div
          className={
            'mail-modal__view' + (viewOpen ? ' mail-modal__view--open' : '')
          }
          aria-hidden={!viewOpen}
        >
          <button
            type="button"
            className="icon-btn mail-modal__view-close"
            title="목록으로"
            onClick={closeView}
          >
            <Icon name="x" size={14} />
          </button>
          {body.kind === 'idle' ? null : body.kind === 'loading' ? (
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
