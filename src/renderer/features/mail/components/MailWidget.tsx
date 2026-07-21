import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { MailModal } from './MailModal';

/**
 * 사이드바 최상단 메일 진입점 — 안읽은 메일 수를 보여준다.
 *  · 아이콘 타일 클릭 → 브라우저로 비즈박스 메일함 열기
 *  · 제목/상태 클릭 → 앱 내 리더 모달 열기
 * 2분마다 자동 새로고침(Jira·PR 과 동일 주기). 계정 미설정이면 안내만 표시.
 */
export function MailWidget() {
  const [unread, setUnread] = useState<number | null>(null);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    const res = await window.oneApp.mail.getInbox(1);
    setConfigured(res.configured);
    if (res.ok) {
      setUnread(res.unreadCount);
      setError('');
    } else if (res.configured) {
      setError(res.error ?? '조회 실패');
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 120_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleRead = () => {
    setUnread((n) => (n && n > 0 ? n - 1 : 0));
  };

  const hasUnread = configured && unread != null && unread > 0;
  const status = !configured
    ? '계정 설정 필요'
    : busy && unread === null
      ? '확인 중…'
      : hasUnread
        ? `새 메일 ${unread}통`
        : '새 메일 없음';

  return (
    <div className="mail-nav">
      <div className="mail-nav__row">
        {/* 아이콘 타일 — 클릭 시 브라우저로 메일함 열기 */}
        <button
          type="button"
          className="mail-nav__tile"
          onClick={() => void window.oneApp.mail.openWeb()}
          disabled={!configured}
          title="비즈박스 메일함 열기 (브라우저)"
          aria-label="비즈박스 메일함 열기"
        >
          <Icon name="mail" size={18} />
          {hasUnread && <span className="mail-nav__dot" aria-hidden="true" />}
        </button>

        {/* 제목 + 상태 — 클릭 시 앱 내 리더 모달 */}
        <button
          type="button"
          className="mail-nav__main"
          onClick={() => setOpen(true)}
          disabled={!configured}
          title={configured ? '앱에서 메일 열기' : '환경설정에서 비즈박스 계정을 입력하세요'}
        >
          <span className="mail-nav__title">메일</span>
          <span
            className={
              'mail-nav__status' +
              (hasUnread ? ' mail-nav__status--accent' : '')
            }
          >
            {status}
          </span>
        </button>

        {/* 우측 — 새로고침 (안읽음 수는 상태 텍스트 + 타일 점으로 표시) */}
        <RefreshButton
          size={13}
          spinning={busy}
          onClick={() => void refresh()}
          disabled={!configured}
          title="안읽은 메일 새로고침"
        />
      </div>

      {error && <p className="mail-nav__error">{error}</p>}

      {open && <MailModal onClose={() => setOpen(false)} onRead={handleRead} />}
    </div>
  );
}
