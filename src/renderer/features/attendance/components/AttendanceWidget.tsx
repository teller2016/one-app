import { useEffect, useState } from 'react';
import type { AttendanceInfo } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { RefreshButton } from '../../../components/RefreshButton';

type Busy = 'fetch' | 'come' | 'leave' | null;

/** 사이드바 하단 출퇴근 위젯 — 항상 표시되며 원클릭으로 출근/퇴근을 찍는다. */
export function AttendanceWidget() {
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
  }, []);

  const stamp = async (action: 'come' | 'leave') => {
    const label = action === 'come' ? '출근' : '퇴근';
    if (!window.confirm(`지금 ${label} 찍을까요?`)) return;
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

  return (
    <div className="attend">
      <div className="attend__head">
        <span className="attend__title">🏢 근태</span>
        <RefreshButton
          size={11}
          spinning={busy === 'fetch'}
          onClick={refresh}
          disabled={busy !== null}
          title="출퇴근 시각 새로고침"
        />
      </div>

      <div className="attend__row">
        <span className="attend__label">출근</span>
        <span className="attend__time">
          {busy === 'fetch' && !info ? '…' : (info?.comeTime ?? '--:--')}
        </span>
      </div>
      <div className="attend__row">
        <span className="attend__label">퇴근</span>
        <span className="attend__time">
          {busy === 'fetch' && !info ? '…' : (info?.leaveTime ?? '--:--')}
        </span>
      </div>

      {nextAction && (
        <Button
          variant="primary"
          className="attend__btn"
          onClick={() => stamp(nextAction)}
          disabled={busy !== null}
        >
          {busy === 'come' || busy === 'leave'
            ? '처리중...'
            : nextAction === 'come'
              ? '출근하기'
              : '퇴근하기'}
        </Button>
      )}
      {info && !nextAction && (
        <p className="attend__done">✓ 오늘 출퇴근 완료</p>
      )}
      {error && <p className="attend__error">{error}</p>}
    </div>
  );
}
