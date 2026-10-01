import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { StatusBarItem } from '../../../components/StatusBar';
import { StatusDot } from '../../../components/StatusDot';
import { errMsg } from '../../../lib/errMsg';
import { usePolling } from '../../../lib/usePolling';
import { MailModal } from './MailModal';
import { useRegisterCommands } from '../../../lib/commands';

// 폴링 간격 — 비즈박스는 실시간 푸시가 없어 폴링이 유일. 창이 활성일 땐 30초,
// 백그라운드(가려짐·포커스 아웃)면 usePolling 이 6배(3분)로 늘린다.
const POLL_ACTIVE_MS = 30_000;

/**
 * 상태바 메일 항목 — 안읽은 메일 수를 보여주고, 누르면 앱 내 리더 모달을 바로 연다.
 * (브라우저로 메일함 열기·목록 새로고침은 모달 안에 있다)
 * 안읽은 수는 경량 count 폴링으로 갱신 — 활성 시 30초, 비활성 시 3분, 창 복귀 시 즉시.
 * 백그라운드 폴링은 조용히 갱신한다.
 */
export function MailWidget() {
  const [unread, setUnread] = useState<number | null>(null);
  const [configured, setConfigured] = useState(true);
  const [spinning, setSpinning] = useState(false); // 스피너 — 수동/초기 로드에서만
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  // 리더에서 읽음 처리한 누적 횟수 — 폴링 요청이 나간 뒤에 읽은 메일은 그 응답에 반영돼
  // 있지 않으므로, 응답값에서 "요청 중에 읽은 수"만큼 빼서 반영한다(안 빼면 읽기 전 값이
  // 방금 한 −1 을 되돌려 카운트가 남는다 — 2026-09-08 사용자 신고)
  const readsRef = useRef(0);

  // showSpinner=false 면 백그라운드 무음 갱신 (30초 폴링마다 스피너가 깜빡이지 않게)
  const load = useCallback(async (showSpinner: boolean): Promise<void> => {
    if (showSpinner) setSpinning(true);
    const readsBefore = readsRef.current;
    try {
      const res = await window.oneApp.mail.getUnreadCount();
      setConfigured(res.configured);
      if (res.ok) {
        const readDuring = readsRef.current - readsBefore;
        setUnread(Math.max(0, res.unreadCount - readDuring));
        setError('');
      } else if (res.configured) {
        setError(res.error ?? '조회 실패');
      }
    } catch (err) {
      // IPC 자체가 거부돼도(폰 WS 끊김 등) 스피너가 굳지 않게
      setError(errMsg(err, '조회 실패'));
    } finally {
      if (showSpinner) setSpinning(false);
    }
  }, []);

  // 적응형 폴링은 공용 usePolling 에 맡긴다 — 활성 30초/비활성 6배(3분) 비율이 원래 이 위젯에서
  // 승격된 것이라 주기는 같고, 여기에 **잠자기(다크웨이크 포함) 중 건너뛰기**가 더해진다.
  // 직접 굴리던 setTimeout 루프는 덮개를 닫은 뒤 다크웨이크마다 HTTP·재로그인까지 돌았다.
  useEffect(() => {
    void load(true); // 최초 1회는 스피너 표시
  }, [load]);
  const poll = useCallback((): void => {
    void load(false); // 폴링은 무음
  }, [load]);
  usePolling(poll, POLL_ACTIVE_MS, { immediate: false });

  const handleRead = () => {
    readsRef.current += 1;
    setUnread((n) => (n && n > 0 ? n - 1 : 0));
  };

  // 모달이 목록을 불러오며 서버에서 받은 카운트 — 캐시를 거치지 않은 최신값이라 그대로 맞춘다
  // (웹·폰에서 읽은 메일이 있어도 모달을 여는 순간 사이드바가 따라온다).
  // ⚠️ 모달의 목록 조회 콜백 의존성이라 반드시 안정된 참조여야 한다(useCallback)
  const handleCount = useCallback((n: number) => setUnread(n), []);

  const hasUnread = configured && unread != null && unread > 0;
  // 상태바 카운트 — 세 자리는 항목 폭을 늘리므로 클램프한다
  const unreadBadge =
    unread != null && unread > 99 ? '99+' : String(unread ?? 0);
  // 값이 한 번도 안 온 채 실패했으면 "새 메일 없음"이 아니라 실패라고 말한다
  // (조회에 성공한 뒤의 실패는 마지막 값을 유지하고 아래 오류 줄로만 알린다)
  const status = !configured
    ? '계정 설정 필요'
    : spinning && unread === null
      ? '확인 중…'
      : unread === null && error
        ? '조회 실패'
        : hasUnread
          ? `새 메일 ${unread}통`
          : '새 메일 없음';

  // ⌘P 팔레트 명령
  useRegisterCommands('mail', () =>
    configured
      ? [
          {
            id: 'mail-open',
            group: '명령',
            label: '메일 열기',
            hint: status,
            keywords: 'mail 비즈박스',
            icon: 'mail',
            run: () => setOpen(true),
          },
        ]
      : [],
  );

  return (
    <>
      <StatusBarItem
        icon={<Icon name="mail" size={12} />}
        // 값이 한 번도 안 온 채 실패하면 점으로 알린다 (성공 뒤 실패는 마지막 값 유지 — 툴팁에 사유)
        dot={unread === null && error ? <StatusDot status="fail" /> : undefined}
        label="메일"
        count={hasUnread ? unreadBadge : undefined}
        title={
          configured
            ? `메일 — ${status}${error && unread !== null ? ` (갱신 실패: ${error})` : ''}`
            : '메일 — 환경설정에서 비즈박스 계정을 입력하세요'
        }
        active={open}
        disabled={!configured}
        onClick={() => setOpen(true)}
      />

      {open && (
        <MailModal
          onClose={() => setOpen(false)}
          onRead={handleRead}
          onCount={handleCount}
        />
      )}
    </>
  );
}
