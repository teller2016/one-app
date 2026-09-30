import { type ProjectSummary } from '../lib/report';

/**
 * 프로젝트 칩 목록 — 구분(프로젝트)별 T/OT 시간·MM 을 분리 표시, 클릭 시 전체 MM 계산에서 제외/포함 토글.
 * 제외 상태는 프로젝트명 기준 전역(모든 사원 공통)이다.
 * 컨테이너는 공용 .chip(버튼) — 접근성(키보드 토글) 확보.
 */
export function ProjectChips({
  summaryData,
  excluded,
  onToggle,
}: {
  summaryData: ProjectSummary[];
  excluded: Set<string>;
  onToggle: (project: string) => void;
}) {
  // 목업 MM 칩 — 이름 500 + "T 22h (0.13)"(모노 11.5, 라벨·MM 흐리게) + OT 가 있으면 주의색 "· OT 3h (0.02)".
  // 포함/제외 모양은 공용 .chip(--excluded = 점선·흐림·취소선)
  return (
    <div className="weekly-chips">
      {summaryData.map((it) => {
        const isExcluded = excluded.has(it.name);
        const hasT = it.T > 0 || it.OT === 0; // T가 있거나, T·OT 둘 다 0이면 T 0 으로 표시
        return (
          <button
            type="button"
            key={it.name}
            className={'chip weekly-chip' + (isExcluded ? ' chip--excluded' : '')}
            title={isExcluded ? 'MM 제외됨 (클릭하여 포함)' : 'MM 포함됨 (클릭하여 제외)'}
            aria-pressed={!isExcluded}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(it.name);
            }}
          >
            <span className="weekly-chip__nm">{it.name}</span>
            {hasT && (
              <span className="weekly-chip__seg">
                <span className="weekly-chip__dim">T</span> {it.T}h{' '}
                <span className="weekly-chip__dim">({it.TMM})</span>
              </span>
            )}
            {it.OT > 0 && (
              <span className="weekly-chip__seg weekly-chip__seg--ot">
                <span className="weekly-chip__dim">{hasT ? '· OT' : 'OT'}</span> {it.OT}h{' '}
                <span className="weekly-chip__dim">({it.OTMM})</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
