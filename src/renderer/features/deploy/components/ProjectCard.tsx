import type { DeployProjectView, DeployStatus } from '../../../../shared/types';
import { statusKey, isBusy, jenkinsJobUrl } from '../lib/format';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { TextLink } from '../../../components/TextLink';
import { StatusBadge, BuildProgress } from './StatusBadge';

type Props = {
  project: DeployProjectView;
  statuses: Record<string, DeployStatus>;
  refreshing: boolean;
  onDeploy: (targetId: string) => void;
  onStop: (targetId: string, buildNumber: number) => void;
  onOpenDetail: (targetId: string) => void;
  onOpenActivity: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** 프로젝트 카드 — 배포 대상별 배포 버튼·상태·진행률. 커밋 내역은 모달로 연다 */
export function ProjectCard({
  project: p,
  statuses,
  refreshing,
  onDeploy,
  onStop,
  onOpenDetail,
  onOpenActivity,
  onRefresh,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div className="deploy__card">
      <div className="deploy__card-head">
        <div>
          <span className="deploy__project-name">{p.name}</span>
          {p.production && (
            <span className="deploy__prod-badge" title="운영 프로젝트 — 배포 시 강한 확인">
              PROD
            </span>
          )}
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
          <Button
            size="sm"
            onClick={onOpenActivity}
            disabled={!p.hasSecret}
            title="이 젠킨스 서버의 실행 중·대기 빌드 보기"
          >
            <Icon name="clock" size={13} />
            현황
          </Button>
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
        const building = status?.state === 'building';
        return (
          <div key={t.id} className="deploy__target">
            {/* 1줄: 대상명 · 배포 · 상태 · 커밋 내역 (항상 동일) */}
            <div className="deploy__target-row">
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
                onClick={() => onOpenDetail(t.id)}
                disabled={!p.hasSecret}
                title="빌드 이력·커밋 내역·콘솔 로그 보기"
              >
                커밋 내역
                <Icon name="chevron-right" size={12} />
              </Button>
            </div>

            {/* 2줄(빌드중일 때만): 진행바(가변 폭) + 중지 */}
            {building && status && (
              <div className="deploy__target-sub">
                <BuildProgress status={status} />
                {status.buildNumber != null && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onStop(t.id, status.buildNumber as number)}
                    title="진행 중인 빌드 중지"
                  >
                    중지
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
