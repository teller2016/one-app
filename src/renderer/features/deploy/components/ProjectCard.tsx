import type { DeployProjectView, DeployStatus } from '../../../../shared/types';
import { statusKey, isBusy } from '../lib/format';
import { StatusBadge } from './StatusBadge';
import { BuildDetailPanel, DetailState } from './BuildDetailPanel';

type Props = {
  project: DeployProjectView;
  statuses: Record<string, DeployStatus>;
  details: Record<string, DetailState>;
  refreshing: boolean;
  onDeploy: (targetId: string) => void;
  onToggleDetail: (targetId: string) => void;
  onRefresh: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** 프로젝트 카드 — 배포 대상별 배포 버튼·상태·커밋 내역 */
export function ProjectCard({
  project: p,
  statuses,
  details,
  refreshing,
  onDeploy,
  onToggleDetail,
  onRefresh,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div className="deploy__card">
      <div className="deploy__card-head">
        <div>
          <span className="deploy__project-name">{p.name}</span>
          <span className="deploy__project-url">{p.jenkinsUrl}</span>
        </div>
        <div className="deploy__card-actions">
          <button
            type="button"
            className={
              refreshing
                ? 'deploy__refresh deploy__refresh--spinning'
                : 'deploy__refresh'
            }
            onClick={onRefresh}
            disabled={!p.hasSecret || refreshing}
            title="이 프로젝트의 빌드 상태 새로고침"
            aria-label="새로고침"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          <button type="button" className="btn btn--ghost" onClick={onEdit}>
            편집
          </button>
          <button type="button" className="btn btn--danger" onClick={onDelete}>
            삭제
          </button>
        </div>
      </div>

      {!p.hasSecret && (
        <p className="sched__banner">
          ⚠️ 젠킨스 계정이 저장되지 않았습니다. [편집]에서 API 토큰을
          입력하세요.
        </p>
      )}

      {p.targets.map((t) => {
        const key = statusKey(p.id, t.id);
        const status = statuses[key];
        const detail = details[key];
        return (
          <div key={t.id}>
            <div className="deploy__target">
              <span className="deploy__target-name">{t.name}</span>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onDeploy(t.id)}
                disabled={!p.hasSecret || isBusy(status)}
              >
                배포
              </button>
              <StatusBadge status={status} />
              <button
                type="button"
                className="deploy__detail-toggle"
                onClick={() => onToggleDetail(t.id)}
                disabled={!p.hasSecret}
              >
                커밋 내역 {detail?.open ? '▾' : '▸'}
              </button>
            </div>
            {detail?.open && <BuildDetailPanel state={detail} />}
          </div>
        );
      })}
    </div>
  );
}
