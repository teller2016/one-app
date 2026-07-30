import { Icon, type IconName } from '../components/Icon';
import type { DraftKind } from '../../shared/types';

const KINDS: {
  kind: DraftKind;
  icon: IconName;
  title: string;
  desc: string;
}[] = [
  {
    kind: 'overtime',
    icon: 'clock',
    title: '야근 결재',
    desc: '연장근무내역서를 작성해 바로 상신합니다.',
  },
  {
    kind: 'expend',
    icon: 'calendar',
    title: '지출결의서(개인)',
    desc: '주차요금·석식대 항목을 채워 둡니다. 첨부·상신은 직접.',
  },
];

/** 시작 화면 — 어떤 결재를 올릴지 고른다 */
export function PickKind({ onPick }: { onPick: (kind: DraftKind) => void }) {
  return (
    <div className="pick">
      <p className="pick__lead">어떤 결재를 올릴까요?</p>
      {KINDS.map((k) => (
        <button
          type="button"
          key={k.kind}
          className="pick__card"
          onClick={() => onPick(k.kind)}
        >
          <span className="pick__icon">
            <Icon name={k.icon} size={20} />
          </span>
          <span className="pick__body">
            <span className="pick__title">{k.title}</span>
            <span className="pick__desc">{k.desc}</span>
          </span>
          <span className="pick__chev">
            <Icon name="chevron-right" size={16} />
          </span>
        </button>
      ))}
    </div>
  );
}
