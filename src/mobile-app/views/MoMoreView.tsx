// 더보기 탭 — 근태 카드(데스크톱 상태바 위젯 본체를 그대로 승격) + 배포·메일 진입 행.
// 목업: 캔버스 MO(폰) › MoMore. 근태 위젯은 상태바 밖이라 팝오버 없이 본체가 바로 그려진다.
import { Icon } from '../../renderer/components/Icon';
import type { IconName } from '../../renderer/components/Icon';
import { AttendanceWidget } from '../../renderer/features/attendance';

export type MoreScreen = 'deploy' | 'mail';

export function MoMoreView({
  unread,
  busyDeploys,
  onOpen,
}: {
  /** 안 읽은 메일 수 — 셸이 폴링해 탭바 배지와 같이 쓴다 */
  unread: number;
  /** 빌드 중·대기 배포 대상 수 (젠킨스 상태 이벤트 기준) */
  busyDeploys: number;
  onOpen: (screen: MoreScreen) => void;
}) {
  const rows: {
    id: MoreScreen;
    label: string;
    icon: IconName;
    meta: React.ReactNode;
  }[] = [
    {
      id: 'deploy',
      label: '배포',
      icon: 'rocket',
      meta:
        busyDeploys > 0 ? (
          <span className="mo-more__busy">
            <span className="mo-more__busy-dot" aria-hidden="true" />
            빌드 중 {busyDeploys}
          </span>
        ) : null,
    },
    {
      id: 'mail',
      label: '메일',
      icon: 'mail',
      meta:
        unread > 0 ? (
          <span
            className="mo-more__count"
            aria-label={`안 읽은 메일 ${unread}`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="mo-more">
      <section className="mo-more__att" aria-label="근태">
        <AttendanceWidget />
      </section>

      <nav className="mo-more__list" aria-label="다른 화면">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            className="mo-more__row"
            onClick={() => onOpen(r.id)}
          >
            <Icon name={r.icon} size={18} />
            <span className="mo-more__label">{r.label}</span>
            {r.meta}
            <Icon name="chevron-right" size={16} />
          </button>
        ))}
      </nav>
    </div>
  );
}
