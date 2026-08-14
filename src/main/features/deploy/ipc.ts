import { broadcast } from '../../lib/broadcast';
import { handleShared } from '../../lib/moIpc';
import {
  listProjects,
  saveProject,
  deleteProject,
  getProjectCredentials,
} from './store';
import {
  parseOwnerRepo,
  normalizeBranch,
  fetchCompareCommits,
  compareWebUrl,
} from './gitea';
import { notifyToast } from '../notify/notify';
import { isDeployNotifyEnabled, getGiteaConfig } from '../settings/store';
import {
  triggerBuild,
  watchBuild,
  fetchLastStatus,
  fetchBuildDetail,
  fetchBuildHistory,
  fetchConsoleTail,
  stopBuild,
  fetchQueue,
  fetchRunningBuilds,
  jobKeyFromPath,
  JenkinsAuth,
  QueueEntry,
} from './jenkins';
import type {
  SaveDeployProjectInput,
  DeployStatus,
  DeployStatusEvent,
  DeployTriggerResult,
  DeployBuildDetailResult,
  DeployHistoryResult,
  DeployLogResult,
  DeployStopResult,
  DeployPreviewResult,
  DeployActivityResult,
  DeployRunningBuild,
  DeployQueueItem,
} from '../../../shared/types';

/** projectId·targetId 로 젠킨스 인증·잡 경로를 찾는다 (없으면 사용자용 오류 메시지) */
function resolveTarget(
  projectId: string,
  targetId: string,
): { auth: JenkinsAuth; jobPath: string } | { error: string } {
  const cred = getProjectCredentials(projectId);
  if (!cred)
    return {
      error: '젠킨스 계정 정보가 없습니다. 프로젝트를 편집해 계정을 저장하세요.',
    };
  const target = cred.targets.find((t) => t.id === targetId);
  if (!target) return { error: '배포 대상을 찾을 수 없습니다.' };
  return {
    auth: {
      baseUrl: cred.jenkinsUrl,
      username: cred.username,
      secret: cred.secret,
    },
    jobPath: target.jobPath,
  };
}

// 진행 중인 배포 (projectId:targetId) — 같은 대상 중복 트리거 방지
const inFlight = new Set<string>();

/** 배포(젠킨스) 관련 IPC 핸들러 등록 */
export function registerDeployIpc() {
  handleShared('deploy:projects:get', async () => listProjects());

  handleShared(
    'deploy:projects:save',
    async (input: SaveDeployProjectInput) => saveProject(input),
  );

  handleShared('deploy:projects:delete', async (id: string) =>
    deleteProject(id),
  );

  // 프로젝트의 배포 대상별 최근 빌드 상태 조회 (화면 진입/새로고침 시)
  handleShared('deploy:status:fetch', async (projectId: string) => {
    const cred = getProjectCredentials(projectId);
    if (!cred) return {};
    const auth: JenkinsAuth = {
      baseUrl: cred.jenkinsUrl,
      username: cred.username,
      secret: cred.secret,
    };
    // 대기열을 한 번 조회해 잡 키로 인덱싱 (실패해도 상태 조회는 계속)
    const queue = await fetchQueue(auth).catch((): QueueEntry[] => []);
    const queueByJob = new Map<string, QueueEntry>();
    for (const q of queue) if (!queueByJob.has(q.jobKey)) queueByJob.set(q.jobKey, q);

    const entries = await Promise.all(
      cred.targets.map(async (t) => {
        const last = await fetchLastStatus(auth, t.jobPath);
        // 이 잡이 대기열에 있으면 = 다른 빌드에 밀려 대기 중 → queued 로 덮어쓰기
        const q = queueByJob.get(jobKeyFromPath(t.jobPath));
        if (q) {
          const status: DeployStatus = {
            state: 'queued',
            buildNumber: last.buildNumber,
            queueWhy: q.why,
            queuedSince: q.since,
          };
          return [t.id, status] as const;
        }
        return [t.id, last] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<string, DeployStatus>;
  });

  // 프로젝트(젠킨스 서버) 단위 현황(실행 중 + 대기) — 카드별 현황 팝업용
  handleShared(
    'deploy:activity:fetch',
    async (projectId: string): Promise<DeployActivityResult> => {
      const cred = getProjectCredentials(projectId);
      if (!cred) return { ok: false, error: '젠킨스 계정 정보가 없습니다.' };
      const auth: JenkinsAuth = {
        baseUrl: cred.jenkinsUrl,
        username: cred.username,
        secret: cred.secret,
      };
      const [r, q] = await Promise.allSettled([
        fetchRunningBuilds(auth),
        fetchQueue(auth),
      ]);
      // 둘 다 실패하면 오류 반환
      if (r.status === 'rejected' && q.status === 'rejected')
        return { ok: false, error: (r.reason as Error).message };

      const running: DeployRunningBuild[] =
        r.status === 'fulfilled' ? r.value : [];
      const queued: DeployQueueItem[] =
        q.status === 'fulfilled'
          ? q.value.map((x) => ({
              id: x.id,
              name: x.name,
              why: x.why,
              since: x.since,
              stuck: x.stuck,
            }))
          : [];

      // 실행은 시작 오래된 순, 대기는 대기 오래된 순
      running.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
      queued.sort((a, b) => (a.since ?? 0) - (b.since ?? 0));
      return { ok: true, activity: { running, queued } };
    },
  );

  // 빌드 상세(커밋 내역·시작자·revision) 조회. buildNumber 없으면 최근 빌드
  handleShared(
    'deploy:build:detail',
    async (
      projectId: string,
      targetId: string,
      buildNumber?: number,
    ): Promise<DeployBuildDetailResult> => {
      const cred = getProjectCredentials(projectId);
      if (!cred) return { ok: false, error: '젠킨스 계정 정보가 없습니다.' };
      const target = cred.targets.find((t) => t.id === targetId);
      if (!target)
        return { ok: false, error: '배포 대상을 찾을 수 없습니다.' };
      try {
        const detail = await fetchBuildDetail(
          {
            baseUrl: cred.jenkinsUrl,
            username: cred.username,
            secret: cred.secret,
          },
          target.jobPath,
          buildNumber,
        );
        return { ok: true, detail };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 최근 빌드 이력 조회 (커밋 내역 패널 상단 목록)
  handleShared(
    'deploy:history:fetch',
    async (projectId: string, targetId: string): Promise<DeployHistoryResult> => {
      const r = resolveTarget(projectId, targetId);
      if ('error' in r) return { ok: false, error: r.error };
      try {
        return { ok: true, builds: await fetchBuildHistory(r.auth, r.jobPath) };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 콘솔 로그 tail 조회
  handleShared(
    'deploy:log:fetch',
    async (
      projectId: string,
      targetId: string,
      buildNumber: number,
    ): Promise<DeployLogResult> => {
      const r = resolveTarget(projectId, targetId);
      if ('error' in r) return { ok: false, error: r.error };
      try {
        const { text, truncated } = await fetchConsoleTail(
          r.auth,
          r.jobPath,
          buildNumber,
        );
        return { ok: true, text, truncated };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 배포 미리보기 — 마지막 빌드 revision 과 저장소 HEAD 를 비교해 이번에 나갈 커밋 목록
  handleShared(
    'deploy:preview',
    async (projectId: string, targetId: string): Promise<DeployPreviewResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: true, configured: false }; // 미설정 — 미리보기 생략

      const r = resolveTarget(projectId, targetId);
      if ('error' in r) return { ok: false, configured: true, error: r.error };
      try {
        // 마지막 빌드의 git 정보 (revision·branch·저장소)
        let last = await fetchBuildDetail(r.auth, r.jobPath);
        // ⚠️ lastBuild 는 진행 중이거나 SCM 체크아웃 전에 실패했을 수 있어 git 정보가 없다.
        //    미리보기의 기준은 어차피 "마지막으로 성공한 배포"이므로 그쪽으로 한 번 더 본다.
        if (!last.revision || !last.repoUrl) {
          try {
            const ok = await fetchBuildDetail(
              r.auth,
              r.jobPath,
              'lastSuccessfulBuild',
            );
            if (ok.revision && ok.repoUrl) last = ok;
          } catch {
            // 성공 빌드가 없으면 무시 — 아래 안내 메시지로 떨어진다
          }
        }
        if (!last.revision || !last.repoUrl) {
          const missing = [
            !last.revision && '커밋(revision)',
            !last.repoUrl && '저장소 주소',
          ]
            .filter(Boolean)
            .join('·');
          return {
            ok: false,
            configured: true,
            error:
              `마지막 빌드(#${last.number})에서 ${missing}를 찾을 수 없습니다 — ` +
              '젠킨스 잡이 Git plugin(checkout scm)으로 소스를 받는지 확인하세요.',
          };
        }
        const parsed = parseOwnerRepo(last.repoUrl);
        if (!parsed) {
          return {
            ok: false,
            configured: true,
            error: `저장소 주소를 해석할 수 없습니다: ${last.repoUrl}`,
          };
        }
        const branch = normalizeBranch(last.branch ?? 'develop');
        const { totalCommits, commits } = await fetchCompareCommits(
          gitea.url,
          gitea.token,
          parsed.owner,
          parsed.repo,
          last.revision,
          branch,
        );
        return {
          ok: true,
          configured: true,
          commits,
          totalCommits,
          baseRevision: last.revision,
          branch,
          compareUrl: compareWebUrl(
            gitea.url,
            parsed.owner,
            parsed.repo,
            last.revision,
            branch,
          ),
        };
      } catch (err) {
        return { ok: false, configured: true, error: (err as Error).message };
      }
    },
  );

  // 진행 중 빌드 중지
  handleShared(
    'deploy:stop',
    async (
      projectId: string,
      targetId: string,
      buildNumber: number,
    ): Promise<DeployStopResult> => {
      const r = resolveTarget(projectId, targetId);
      if ('error' in r) return { ok: false, error: r.error };
      try {
        await stopBuild(r.auth, r.jobPath, buildNumber);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 배포 트리거 — 이후 진행 상태는 deploy:status 이벤트(broadcast)로 전달
  handleShared(
    'deploy:trigger',
    async (
      projectId: string,
      targetId: string,
    ): Promise<DeployTriggerResult> => {
      const key = `${projectId}:${targetId}`;
      if (inFlight.has(key))
        return { ok: false, error: '이미 배포가 진행 중입니다.' };

      const cred = getProjectCredentials(projectId);
      if (!cred)
        return {
          ok: false,
          error:
            '젠킨스 계정 정보가 없습니다. 프로젝트를 편집해 계정을 저장하세요.',
        };
      const target = cred.targets.find((t) => t.id === targetId);
      if (!target)
        return { ok: false, error: '배포 대상을 찾을 수 없습니다.' };

      const auth: JenkinsAuth = {
        baseUrl: cred.jenkinsUrl,
        username: cred.username,
        secret: cred.secret,
      };
      // 알림 라벨용 프로젝트 이름 (대상 이름은 target.name)
      const projectName =
        listProjects().find((p) => p.id === projectId)?.name ?? '';
      const label = `${projectName ? `${projectName} · ` : ''}${target.name}`;
      let notified = false;

      const push = (status: DeployStatus) => {
        // 상태 이벤트를 전 클라이언트에 전달 — 창이 없으면 no-op 이고, MO(폰)도 받는다.
        // (예전에는 event.sender 로 호출한 렌더러에만 보냈는데, 그러면 WS 클라이언트에는
        //  sender 가 없어 폰이 배포 진행을 볼 수 없다. 창은 하나뿐이라 동작은 동일하다.)
        const evt: DeployStatusEvent = { projectId, targetId, status };
        broadcast('deploy:status', evt);
        // 완료(성공/실패/오류) 시 알림(알럿) — 대상당 한 번만
        if (
          !notified &&
          (status.state === 'success' ||
            status.state === 'failure' ||
            status.state === 'error') &&
          isDeployNotifyEnabled()
        ) {
          notified = true;
          // 창이 포커스면 우측 아래 토스트(작업 흐름 안 끊음), 백그라운드면 알럿 폴백.
          // 배포 알림은 성공·실패 모두 직접 닫을 때까지 남는다 — 놓치면 안 되는 결과다.
          if (status.state === 'success') {
            void notifyToast({
              title: '배포 성공',
              message: `${label} 배포가 완료됐습니다.`,
              variant: 'ok',
              sticky: true,
              section: 'deploy',
            });
          } else if (status.state === 'failure') {
            void notifyToast({
              title: '배포 실패',
              message: `${label} — ${status.result ?? '실패'}`,
              variant: 'fail',
              sticky: true,
              section: 'deploy',
            });
          } else {
            void notifyToast({
              title: '배포 오류',
              message: `${label} — ${status.error ?? '상태 추적 오류'}`,
              variant: 'fail',
              sticky: true,
              section: 'deploy',
            });
          }
        }
      };

      // 트리거 왕복(await) 전에 등록해야 그 사이 중복 클릭이 가드에 걸린다
      inFlight.add(key);
      try {
        const { queueUrl } = await triggerBuild(auth, target.jobPath);
        // 완료까지 기다리지 않고 즉시 반환 — 진행/완료는 이벤트로 전달
        watchBuild(auth, target.jobPath, queueUrl, push).finally(() =>
          inFlight.delete(key),
        );
        return { ok: true };
      } catch (err) {
        inFlight.delete(key);
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
