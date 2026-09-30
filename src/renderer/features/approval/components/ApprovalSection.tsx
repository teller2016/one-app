import { useEffect, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon, type IconName } from '../../../components/Icon';
import { Tooltip } from '../../../components/Tooltip';
import { TopbarSlot, useHasTopbar } from '../../../components/TopbarSlot';
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
    desc: '연장근무내역서를 채워 둡니다. 확인 후 [상신]은 직접.',
  },
  {
    kind: 'vacation',
    icon: 'calendar',
    title: '휴가신청서',
    desc: '연차·반차·시차 — 전자결재 창까지 준비합니다. [상신]은 직접.',
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
  // 앱 탑바가 있으면(본체) 경로·뒤로가기는 탑바가 맡는다. 없으면(One App Lite·폰 셸) 폼 머리에
  // [목록으로] 버튼과 제목을 직접 그린다 — Lite 엔 탑바 뒤로가기가 없어 이게 유일한 복귀 경로다.
  const hasTopbar = useHasTopbar();

  if (!active) {
    return (
      <div className="approval approval--home">
        <div className="approval__col approval__col--home">
          <div className="approval__intro">
            <h1 className="approval__h1">결재</h1>
            <p className="approval__lead">
              어떤 결재를 올릴까요? 계정은 환경설정의 비즈박스 계정을 씁니다.
            </p>
          </div>
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
              variant="plain"
              loading={opening}
              onClick={() => void openEaBox()}
            >
              <Icon name="clipboard-list" size={14} />
              전자결재 상신함 열기
            </Button>
          </div>
          <Banner variant="info">
            작성은 앱이 대신하지만 <strong>결재(승인)는 언제나 직접</strong>{' '}
            하셔야 합니다. 자동화 창이 뜨면 작업이 끝날 때까지 건드리지 마세요.
          </Banner>
        </div>
      </div>
    );
  }

  return (
    <div className="approval approval--form">
      {/* 경로 셋째 단(결재 / 휴가신청서)과 종류 설명 — 탑바가 없으면 아래 폼 머리가 대신한다 */}
      {hasTopbar && (
        <TopbarSlot
          crumb={active.title}
          right={<span className="approval-topbar-hint">{active.desc}</span>}
        />
      )}
      <div className="approval__col">
        {hasTopbar === false && (
          <div className="approval__head">
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
            <h1 className="approval__h1">{active.title}</h1>
            <span className="approval__head-desc">{active.desc}</span>
          </div>
        )}
        {kind === 'overtime' && <OvertimeForm />}
        {kind === 'vacation' && <VacationForm />}
        {kind === 'expend' && <ExpendForm />}
      </div>
    </div>
  );
}
