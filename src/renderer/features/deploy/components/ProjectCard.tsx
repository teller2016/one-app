import type { DeployProjectView, DeployStatus } from '../../../../shared/types';
import { statusKey, isBusy, jenkinsJobUrl } from '../lib/format';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { DeployLink } from './DeployLink';
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

/**
 * 프로젝트 카드 — 목업 Deploy.dc.html 의 .panel: 머리(이름·PROD·젠킨스 URL + [현황][↻][편집][삭제])
 * 아래로 배포 대상 행(이름 · [배포] · 상태 · 시각 · [커밋 내역 ›], 빌드중이면 진행바 + [중지]).
 * 커밋 내역은 모달로 연다.
 */
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
        <div className="deploy__card-titles">
          <div className="deploy__card-name-row">
            <span className="deploy__project-name">{p.name}</span>
            {p.production && (
              // 목업 b-warn 점 없음 — 공용 busy 가 경고색(warning) 면이다
              <Badge
                variant="busy"
                dot={false}
                title="운영 프로젝트 — 배포 시 강한 확인"
              >
                PROD
              </Badge>
            )}
          </div>
          <DeployLink
            mono
            external
            className="deploy__project-url"
            onClick={() => void window.oneApp.openExternal(p.jenkinsUrl)}
            title="젠킨스 열기"
          >
            {/* 좁은 카드에서 주소가 길면 말줄임 — 글자를 따로 감싸야 아이콘은 남는다 */}
            <span className="deploy__ellipsis">{p.jenkinsUrl}</span>
          </DeployLink>
        </div>
        <div className="deploy__card-actions">
          <Button
            size="xs"
            onClick={onOpenActivity}
            disabled={!p.hasSecret}
            title="이 젠킨스 서버의 실행 중·대기 빌드 보기"
          >
            <Icon name="clock" size={12} />
            현황
          </Button>
          <Button
            size="xs"
            icon
            onClick={onRefresh}
            disabled={!p.hasSecret || refreshing}
            title="이 프로젝트의 빌드 상태 새로고침"
            aria-label="이 프로젝트의 빌드 상태 새로고침"
          >
            <Icon
              name="refresh"
              size={12}
              className={refreshing ? 'deploy__spin' : undefined}
            />
          </Button>
          <Button size="xs" onClick={onEdit}>
            편집
          </Button>
          <Button size="xs" variant="danger" onClick={onDelete}>
            삭제
          </Button>
        </div>
      </div>

      {!p.hasSecret && (
        <div className="deploy__card-banner">
          <Banner>
            젠킨스 계정이 저장되지 않았습니다. [편집]에서 API 토큰을 입력하세요.
          </Banner>
        </div>
      )}

      {p.targets.map((t) => {
        const key = statusKey(p.id, t.id);
        const status = statuses[key];
        const building = status?.state === 'building';
        return (
          <div key={t.id} className="deploy__target">
            {/* 1줄: 대상명 · 배포 · 상태 · 시각 · 커밋 내역 (항상 동일) */}
            <div className="deploy__target-row">
              <button
                type="button"
                className="deploy__target-name"
                onClick={() =>
                  void window.oneApp.openExternal(
                    jenkinsJobUrl(p.jenkinsUrl, t.jobPath),
                  )
                }
                title={`젠킨스 잡 페이지 열기 — ${t.jobPath}`}
              >
                {t.name}
              </button>
              <Button
                size="xs"
                variant="primary"
                onClick={() => onDeploy(t.id)}
                disabled={!p.hasSecret || isBusy(status)}
              >
                배포
              </Button>
              <StatusBadge status={status} />
              <Button
                size="xs"
                className="deploy__detail-toggle"
                onClick={() => onOpenDetail(t.id)}
                disabled={!p.hasSecret}
                title="빌드 이력·커밋 내역·콘솔 로그 보기"
              >
                커밋 내역
                <Icon name="chevron-right" size={12} />
              </Button>
            </div>

            {/* 2줄(빌드중일 때만): 진행바(가변 폭) + 경과 + 중지 */}
            {building && status && (
              <div className="deploy__target-sub">
                <BuildProgress status={status} />
                {status.buildNumber != null && (
                  <Button
                    size="xs"
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
