import { useEffect, useState } from 'react';
import type { AttendanceInfo } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { useConfirm } from '../../../components/ConfirmDialog';

type Busy = 'fetch' | 'come' | 'leave' | null;

/** 사이드바 하단 출퇴근 위젯 — 항상 표시되며 원클릭으로 출근/퇴근을 찍는다. */
export function AttendanceWidget() {
  const confirm = useConfirm();
  const [info, setInfo] = useState<AttendanceInfo | null>(null);
  const [busy, setBusy] = useState<Busy>('fetch');
  const [error, setError] = useState('');

  const refresh = async () => {
    setBusy('fetch');
    setError('');
    const res = await window.oneApp.attendance.fetch();
    if (res.ok && res.info) setInfo(res.info);
    else setError(res.error ?? '조회 실패');
    setBusy(null);
  };

  useEffect(() => {
    void refresh();
    // 리마인더 알럿의 '지금 찍기'로 찍었을 때 메인이 보내주는 변경 이벤트 → 즉시 반영
    const offChanged = window.oneApp.attendance.onChanged((next) => {
      setInfo(next);
      setError('');
    });
    // 알럿에서 찍는 동안엔 위젯도 앱에서 누른 것처럼 '처리중' 비활성 상태로 동기화
    const offStamping = window.oneApp.attendance.onStamping((action) => {
      setBusy(action);
      if (action) setError('');
    });
    return () => {
      offChanged();
      offStamping();
    };
  }, []);

  const stamp = async (action: 'come' | 'leave') => {
    const label = action === 'come' ? '출근' : '퇴근';
    const ok = await confirm({
      title: `지금 ${label} 찍을까요?`,
      message: '그룹웨어 근태에 바로 기록됩니다.',
      confirmLabel: `${label} 찍기`,
    });
    if (!ok) return;
    setBusy(action);
    setError('');
    const res = await window.oneApp.attendance.stamp(action);
    if (res.ok && res.info) setInfo(res.info);
    else setError(res.error ?? `${label} 처리 실패`);
    setBusy(null);
  };

  // 다음에 할 행동: 출근 전이면 출근, 출근만 했으면 퇴근, 둘 다면 없음
  const nextAction: 'come' | 'leave' | null = !info
    ? null
    : !info.comeTime
      ? 'come'
      : !info.leaveTime
        ? 'leave'
        : null;

  // 한 줄 요약 문구 — 다음 행동에 맞춰 필요한 시각만 보여준다
  const summary =
    busy === 'fetch' && !info ? (
      '근태 확인 중…'
    ) : !info ? (
      '근태 · —'
    ) : nextAction === 'come' ? (
      '근태 · 출근 전'
    ) : nextAction === 'leave' ? (
      <>
        출근 <span className="sbw__time">{info.comeTime}</span>
      </>
    ) : (
      <>
        <span className="sbw__time">{info.comeTime}</span>
        {' → '}
        <span className="sbw__time">{info.leaveTime}</span>
      </>
    );

  return (
    <div className="sbw">
      {/* 한 줄: 아이콘 · 요약(다음 행동 기준) · 우측 액션 (새로고침 + 출근/퇴근) */}
      <div className="sbw__row">
        <span className="sbw__icon">
          <Icon name="building" size={12} />
        </span>
        <span className="sbw__label">
          <span className="sbw__text">{summary}</span>
          {info && !nextAction && (
            <span className="sbw__ok" title="오늘 출퇴근 완료">
              <Icon name="check" size={12} />
            </span>
          )}
        </span>
        <span className="sbw__actions">
          <RefreshButton
            size={12}
            spinning={busy === 'fetch'}
            onClick={refresh}
            disabled={busy !== null}
            title="출퇴근 시각 새로고침"
          />
          {nextAction && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => stamp(nextAction)}
              disabled={busy !== null}
              loading={busy === 'come' || busy === 'leave'}
            >
              {nextAction === 'come' ? '출근' : '퇴근'}
            </Button>
          )}
        </span>
      </div>

      {error && <p className="sbw__error">{error}</p>}
    </div>
  );
}
