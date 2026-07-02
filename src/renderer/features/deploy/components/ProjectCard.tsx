import type { DeployProjectView, DeployStatus } from '../../../../shared/types';
import { statusKey, isBusy, jenkinsJobUrl } from '../lib/format';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { RefreshButton } from '../../../components/RefreshButton';
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
          <button
            type="button"
            className="deploy__project-url deploy__link"
            onClick={() => void window.oneApp.openExternal(p.jenkinsUrl)}
            title="젠킨스 열기"
          >
            {p.jenkinsUrl} ↗
          </button>
        </div>
        <div className="deploy__card-actions">
          <RefreshButton
            bordered
            size={14}
            spinning={refreshing}
            onClick={onRefresh}
            disabled={!p.hasSecret || refreshing}
            title="이 프로젝트의 빌드 상태 새로고침"
          />
          <Button onClick={onEdit}>편집</Button>
          <Button variant="danger" onClick={onDelete}>
            삭제
          </Button>
        </div>
      </div>

      {!p.hasSecret && (
        <Banner>
          ⚠️ 젠킨스 계정이 저장되지 않았습니다. [편집]에서 API 토큰을
          입력하세요.
        </Banner>
      )}

      {p.targets.map((t) => {
        const key = statusKey(p.id, t.id);
        const status = statuses[key];
        const detail = details[key];
        return (
          <div key={t.id}>
            <div className="deploy__target">
              <button
                type="button"
                className="deploy__target-name deploy__link"
                onClick={() =>
                  void window.oneApp.openExternal(
                    jenkinsJobUrl(p.jenkinsUrl, t.jobPath),
                  )
                }
                title={`젠킨스 잡 페이지 열기 — ${t.jobPath}`}
              >
                {t.name} ↗
              </button>
              <Button
                variant="primary"
                onClick={() => onDeploy(t.id)}
                disabled={!p.hasSecret || isBusy(status)}
              >
                배포
              </Button>
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
