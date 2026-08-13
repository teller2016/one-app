import { useEffect, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon, type IconName } from '../../../components/Icon';
import { SectionHeader } from '../../../components/SectionHeader';
import { Tooltip } from '../../../components/Tooltip';
import { setSectionBack } from '../../../lib/sectionBack';
import { useEaBox } from '../lib/useEaBox';
import { ExpendForm } from './ExpendForm';
import { OvertimeForm } from './OvertimeForm';
import { VacationForm } from './VacationForm';
import type { ApprovalKind } from '../../../../shared/types';

const KINDS: {
  kind: ApprovalKind;
  icon: IconName;
  title: string;
  desc: string;
}[] = [
  {
    kind: 'overtime',
    icon: 'clock',
    title: '야근 결재',
    desc: '연장근무내역서를 작성해 바로 상신합니다. 결재선은 본인.',
  },
  {
    kind: 'vacation',
    icon: 'calendar',
    title: '휴가신청서',
    desc: '연차·반차·시차를 신청합니다. 내역추가 후 결재상신까지.',
  },
  {
    kind: 'expend',
    icon: 'paperclip',
    title: '지출결의서(개인)',
    desc: '주차요금·석식대 항목을 채워 둡니다. 첨부·상신은 직접.',
  },
];

/**
 * 결재 — 그룹웨어 전자결재를 앱에서 작성해 올린다.
 * 종류를 고르면 그 폼으로 들어가고, 실제 작성은 숨긴 자동화 창이 대신한다.
 */
export function ApprovalSection() {
  const [kind, setKind] = useState<ApprovalKind | null>(null);
  // 완료 화면(DoneCard)과 같은 상신함 열기 — 작성 없이 진행 상태만 볼 때도 필요하다
  const { opening, openEaBox } = useEaBox();

  // 앱 뒤로가기(탑바·⌘[·마우스·스와이프)를 섹션 안에서 먼저 소비한다 —
  // 폼에 있을 때 뒤로 누르면 다른 섹션이 아니라 결재 목록으로 돌아간다
  useEffect(() => {
    if (!kind) return;
    setSectionBack(() => {
      setKind(null);
      return true;
    });
    return () => setSectionBack(null);
  }, [kind]);

  const active = KINDS.find((k) => k.kind === kind);

  if (!active) {
    return (
      // .section — 공통 컨테이너(좌우 여백·최대폭·가운데 정렬). 없으면 사이드바에 붙는다
      <div className="section approval">
        <SectionHeader
          icon={<Icon name="pencil" size={18} />}
          title="결재"
          sub="어떤 결재를 올릴까요? 계정은 환경설정의 비즈박스 계정을 씁니다."
        />
        <div className="approval-pick">
          {KINDS.map((k) => (
            <button
              type="button"
              key={k.kind}
              className="approval-pick__card"
              onClick={() => setKind(k.kind)}
            >
              <span className="approval-pick__icon">
                <Icon name={k.icon} size={20} />
              </span>
              <span className="approval-pick__body">
                <span className="approval-pick__title">{k.title}</span>
                <span className="approval-pick__desc">{k.desc}</span>
              </span>
              <span className="approval-pick__chev">
                <Icon name="chevron-right" size={16} />
              </span>
            </button>
          ))}
        </div>
        <div className="approval-eabox">
          <Button
            variant="ghost"
            loading={opening}
            onClick={() => void openEaBox()}
          >
            <Icon name="clipboard-list" size={16} />
            전자결재 상신함 열기
          </Button>
          <p className="approval-eabox__hint">
            이미 올린 문서의 진행 상태를 확인합니다.
          </p>
        </div>
        <Banner variant="info">
          작성은 앱이 대신하지만 <strong>결재(승인)는 언제나 직접</strong> 하셔야
          합니다. 자동화 창이 뜨면 작업이 끝날 때까지 건드리지 마세요.
        </Banner>
      </div>
    );
  }

  return (
    <div className="section approval">
      <SectionHeader
        icon={
          // 결재 종류 아이콘 앞에 공용 아이콘 버튼으로 '목록으로' 를 둔다
          <>
            <Tooltip label="결재 목록으로 (⌘[)">
              <button
                type="button"
                className="icon-btn"
                aria-label="결재 목록으로"
                onClick={() => setKind(null)}
              >
                <Icon name="chevron-left" size={16} />
              </button>
            </Tooltip>
            <Icon name={active.icon} size={18} />
          </>
        }
        title={active.title}
        sub={active.desc}
      />
      {kind === 'overtime' && <OvertimeForm />}
      {kind === 'vacation' && <VacationForm />}
      {kind === 'expend' && <ExpendForm />}
    </div>
  );
}
