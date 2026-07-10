import type { DeployProjectView, DeployStatus } from '../../../../shared/types';
import { statusKey, isBusy, jenkinsJobUrl } from '../lib/format';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { TextLink } from '../../../components/TextLink';
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
          <TextLink
            small
            external
            className="deploy__project-url"
            onClick={() => void window.oneApp.openExternal(p.jenkinsUrl)}
            title="젠킨스 열기"
          >
            {p.jenkinsUrl}
          </TextLink>
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
          <Button size="sm" onClick={onEdit}>
            편집
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            삭제
          </Button>
        </div>
      </div>

      {!p.hasSecret && (
        <Banner>
          젠킨스 계정이 저장되지 않았습니다. [편집]에서 API 토큰을 입력하세요.
        </Banner>
      )}

      {p.targets.map((t) => {
        const key = statusKey(p.id, t.id);
        const status = statuses[key];
        const detail = details[key];
        return (
          <div key={t.id}>
            <div className="deploy__target">
              <TextLink
                className="deploy__target-name"
                onClick={() =>
                  void window.oneApp.openExternal(
                    jenkinsJobUrl(p.jenkinsUrl, t.jobPath),
                  )
                }
                title={`젠킨스 잡 페이지 열기 — ${t.jobPath}`}
              >
                {t.name}
              </TextLink>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onDeploy(t.id)}
                disabled={!p.hasSecret || isBusy(status)}
              >
                배포
              </Button>
              <StatusBadge status={status} />
              <Button
                size="sm"
                className="deploy__detail-toggle"
                onClick={() => onToggleDetail(t.id)}
                disabled={!p.hasSecret}
              >
                커밋 내역
                <Icon
                  name={detail?.open ? 'chevron-down' : 'chevron-right'}
                  size={12}
                />
              </Button>
            </div>
            {detail?.open && <BuildDetailPanel state={detail} />}
          </div>
        );
      })}
    </div>
  );
}
