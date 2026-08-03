// 근태 탭 — 데스크톱의 사이드바 위젯을 그대로 카드로 승격한다.
// `.sbw` 는 220px 폭 전제로 만들어져 있어 폰 화면에 이미 적합하다(폭만 늘어난다).
import { AttendanceWidget } from '../../renderer/features/attendance';

export function MoAttendanceView() {
  return (
    <div className="mo-view">
      <div className="mo-card">
        <AttendanceWidget />
      </div>
    </div>
  );
}
