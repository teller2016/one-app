import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { MailModal } from './MailModal';

// 폴링 간격 — 비즈박스는 실시간 푸시가 없어 폴링이 유일. 창이 활성일 땐 촘촘히,
// 백그라운드(가려짐·포커스 아웃)면 느슨하게 돌려 낭비를 줄인다.
const POLL_ACTIVE_MS = 30_000;
const POLL_IDLE_MS = 180_000;

/**
 * 사이드바 최상단 메일 진입점 — 안읽은 메일 수를 보여준다.
 *  · 아이콘 타일 클릭 → 브라우저로 비즈박스 메일함 열기
 *  · 제목/상태 클릭 → 앱 내 리더 모달 열기
 * 안읽은 수는 경량 count 폴링으로 갱신 — 활성 시 30초, 비활성 시 3분, 창 복귀 시 즉시.
 * 백그라운드 폴링은 스피너 없이 조용히 갱신한다.
 */
export function MailWidget() {
  const [unread, setUnread] = useState<number | null>(null);
  const [configured, setConfigured] = useState(true);
  const [spinning, setSpinning] = useState(false); // 스피너 — 수동/초기 로드에서만
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  // showSpinner=false 면 백그라운드 무음 갱신 (30초 폴링마다 스피너가 깜빡이지 않게)
  const load = useCallback(async (showSpinner: boolean): Promise<void> => {
    if (showSpinner) setSpinning(true);
    const res = await window.oneApp.mail.getUnreadCount();
    setConfigured(res.configured);
    if (res.ok) {
      setUnread(res.unreadCount);
      setError('');
    } else if (res.configured) {
      setError(res.error ?? '조회 실패');
    }
    if (showSpinner) setSpinning(false);
  }, []);

  const refresh = useCallback((): void => {
    void load(true);
  }, [load]);

  // 포커스/가시성 인지 적응형 폴링
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const active = () =>
      document.visibilityState === 'visible' && document.hasFocus();

    const schedule = (): void => {
      if (stopped) return;
      timer = setTimeout(() => void tick(), active() ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    };
    const tick = async (): Promise<void> => {
      await load(false); // 폴링은 무음
      schedule();
    };

    void (async () => {
      await load(true); // 최초 1회는 스피너 표시
      schedule();
    })();

    // 창으로 돌아오면 즉시 한 번 갱신하고 촘촘한 주기로 리셋
    const onWake = () => {
      if (stopped || !active()) return;
      clearTimeout(timer);
      void load(false);
      schedule();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);

    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [load]);

  const handleRead = () => {
    setUnread((n) => (n && n > 0 ? n - 1 : 0));
  };

  const hasUnread = configured && unread != null && unread > 0;
  const status = !configured
    ? '계정 설정 필요'
    : spinning && unread === null
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
          spinning={spinning}
          onClick={refresh}
          disabled={!configured}
          title="안읽은 메일 새로고침"
        />
      </div>

      {error && <p className="mail-nav__error">{error}</p>}

      {open && <MailModal onClose={() => setOpen(false)} onRead={handleRead} />}
    </div>
  );
}
