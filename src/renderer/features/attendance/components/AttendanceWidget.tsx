import { Suspense, lazy, useEffect, useState } from 'react';
import type { AttendanceInfo } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { SidebarWidget } from '../../../components/SidebarWidget';
import { StatusDot } from '../../../components/StatusDot';
import { useConfirm } from '../../../components/ConfirmDialog';
import { publishAttendance } from '../lib/shared';

// ⚠️ lazy — 사이드바 위젯은 앱이 뜨는 순간부터 상주하므로 정적 import 하면 결재 청크가
// 초기 번들에 그대로 딸려온다(App.tsx 의 ApprovalSection lazy 가 무의미해진다).
// 모달은 열 때만 필요하니 그때 받는다.
const OvertimeModal = lazy(() =>
  import('../../approval').then((m) => ({ default: m.OvertimeModal }))
);

type Busy = 'fetch' | 'come' | 'leave' | null;

/** 사이드바 하단 출퇴근 위젯 — 항상 표시되며 원클릭으로 출근/퇴근을 찍는다. */
export function AttendanceWidget() {
  const confirm = useConfirm();
  const [info, setInfo] = useState<AttendanceInfo | null>(null);
  const [busy, setBusy] = useState<Busy>('fetch');
  const [error, setError] = useState('');
  const [overtimeOpen, setOvertimeOpen] = useState(false);

  /**
   * 조회 — force 는 사용자가 새로고침을 눌렀을 때만.
   * 마운트 조회는 main 의 캐시를 그대로 쓴다(폰에서 탭을 오갈 때마다 헤드리스
   * 브라우저가 다시 뜨던 것을 막는다). 찍기·리마인더는 main 이 캐시를 버린다.
   */
  const refresh = async (force = false) => {
    setBusy('fetch');
    setError('');
    publishAttendance({ loading: true });
    const res = await window.oneApp.attendance.fetch(force);
    if (res.ok && res.info) {
      setInfo(res.info);
      publishAttendance({ info: res.info, error: '', loading: false });
    } else {
      setError(res.error ?? '조회 실패');
      publishAttendance({ error: res.error ?? '조회 실패', loading: false });
    }
    setBusy(null);
  };

  useEffect(() => {
    void refresh();
    // 리마인더 알럿의 '지금 찍기'로 찍었을 때 메인이 보내주는 변경 이벤트 → 즉시 반영
    const offChanged = window.oneApp.attendance.onChanged((next) => {
      setInfo(next);
      setError('');
      publishAttendance({ info: next, error: '', loading: false });
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
    if (res.ok && res.info) {
      setInfo(res.info);
      publishAttendance({ info: res.info, error: '', loading: false });
    } else {
      setError(res.error ?? `${label} 처리 실패`);
    }
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

  // 사이드바를 접으면 위 요약이 감춰지므로 툴팁이 상태를 대신한다 (근태는 상태점이 없다)
  const summaryTitle =
    busy === 'fetch' && !info
      ? '근태 확인 중'
      : !info
        ? '근태 — 조회 전'
        : nextAction === 'come'
          ? '근태 — 출근 전'
          : nextAction === 'leave'
            ? `근태 — 출근 ${info.comeTime}`
            : `근태 — ${info.comeTime} → ${info.leaveTime} (완료)`;

  const icon = <Icon name="building" size={12} />;
  // 출퇴근 완료 체크 — 근태는 상태점 없이 글자로 말하므로, 이것만은 축소 타일에도 남긴다
  const okMark =
    info && !nextAction ? (
      <span className="sbw__ok" title="오늘 출퇴근 완료">
        <Icon name="check" size={12} />
      </span>
    ) : null;

  return (
    // 축소 타일에는 조회 실패를 점으로 알린다 — 접힌 채로는 아래 에러 문구가 보이지 않는다
    <SidebarWidget
      icon={icon}
      dot={error ? <StatusDot status="fail" /> : okMark}
      tooltip={error ? `근태 — ${error}` : summaryTitle}
    >
      <div className="sbw" title={summaryTitle}>
        {/* 한 줄: 아이콘 · 요약(다음 행동 기준) · 우측 액션 (새로고침 + 출근/퇴근) */}
        <div className="sbw__row">
          <span className="sbw__icon">{icon}</span>
          <span className="sbw__label">
            <span className="sbw__text">{summary}</span>
            {okMark}
          </span>
          <span className="sbw__actions">
            {/* sbw__overtime — 폰(MO) 셸에서 숨기는 기준 클래스. 상신(쓰기) 흐름이라 폰 1단계 제외 */}
            <button
              type="button"
              className="icon-btn sbw__overtime"
              title="야근 결재 상신 (연장근무내역서)"
              aria-label="야근 결재 상신"
              onClick={() => setOvertimeOpen(true)}
            >
              <Icon name="moon" size={12} />
            </button>
            <RefreshButton
              size={12}
              spinning={busy === 'fetch'}
              onClick={() => void refresh(true)}
              disabled={busy !== null}
              title="출퇴근 시각 새로고침"
            />
          </span>
        </div>

        {/* 액션 줄 — 다음 행동이 있을 때만 (완료면 위젯은 1줄) */}
        {nextAction && (
          <div className="sbw__buttons">
            <Button
              variant="primary"
              size="sm"
              onClick={() => stamp(nextAction)}
              disabled={busy !== null}
              loading={busy === 'come' || busy === 'leave'}
            >
              {nextAction === 'come' ? '출근하기' : '퇴근하기'}
            </Button>
          </div>
        )}

        {error && <p className="sbw__error">{error}</p>}

        {/* 야근 결재 모달 — 연장근무내역서 작성·상신 (청크는 열 때 받는다) */}
        {overtimeOpen && (
          <Suspense fallback={null}>
            <OvertimeModal onClose={() => setOvertimeOpen(false)} />
          </Suspense>
        )}
      </div>
    </SidebarWidget>
  );
}
