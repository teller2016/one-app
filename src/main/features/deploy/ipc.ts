import { ipcMain } from 'electron';
import {
  listProjects,
  saveProject,
  deleteProject,
  getProjectCredentials,
} from './store';
import { notify } from '../notify/notify';
import { isDeployNotifyEnabled } from '../settings/store';
import {
  triggerBuild,
  watchBuild,
  fetchLastStatus,
  fetchBuildDetail,
  fetchBuildHistory,
  fetchConsoleTail,
  stopBuild,
  JenkinsAuth,
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
  ipcMain.handle('deploy:projects:get', async () => listProjects());

  ipcMain.handle(
    'deploy:projects:save',
    async (_e, input: SaveDeployProjectInput) => saveProject(input),
  );

  ipcMain.handle('deploy:projects:delete', async (_e, id: string) =>
    deleteProject(id),
  );

  // 프로젝트의 배포 대상별 최근 빌드 상태 조회 (화면 진입/새로고침 시)
  ipcMain.handle('deploy:status:fetch', async (_e, projectId: string) => {
    const cred = getProjectCredentials(projectId);
    if (!cred) return {};
    const auth: JenkinsAuth = {
      baseUrl: cred.jenkinsUrl,
      username: cred.username,
      secret: cred.secret,
    };
    const entries = await Promise.all(
      cred.targets.map(
        async (t) => [t.id, await fetchLastStatus(auth, t.jobPath)] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<string, DeployStatus>;
  });

  // 빌드 상세(커밋 내역·시작자·revision) 조회. buildNumber 없으면 최근 빌드
  ipcMain.handle(
    'deploy:build:detail',
    async (
      _e,
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
  ipcMain.handle(
    'deploy:history:fetch',
    async (_e, projectId: string, targetId: string): Promise<DeployHistoryResult> => {
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
  ipcMain.handle(
    'deploy:log:fetch',
    async (
      _e,
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

  // 진행 중 빌드 중지
  ipcMain.handle(
    'deploy:stop',
    async (
      _e,
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

  // 배포 트리거 — 이후 진행 상태는 deploy:status 이벤트로 전달
  ipcMain.handle(
    'deploy:trigger',
    async (
      event,
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
      const sender = event.sender;
      // 알림 라벨용 프로젝트 이름 (대상 이름은 target.name)
      const projectName =
        listProjects().find((p) => p.id === projectId)?.name ?? '';
      const label = `${projectName ? `${projectName} · ` : ''}${target.name}`;
      let notified = false;

      const push = (status: DeployStatus) => {
        // 창이 살아있으면 상태 이벤트 전달 (창이 닫혀 있어도 알림은 아래에서 처리)
        if (!sender.isDestroyed()) {
          const evt: DeployStatusEvent = { projectId, targetId, status };
          sender.send('deploy:status', evt);
        }
        // 완료(성공/실패/오류) 시 알림(알럿) — 대상당 한 번만
        if (
          !notified &&
          (status.state === 'success' ||
            status.state === 'failure' ||
            status.state === 'error') &&
          isDeployNotifyEnabled()
        ) {
          notified = true;
          if (status.state === 'success') {
            void notify({
              title: '✅ 배포 성공',
              body: `${label} 배포가 완료됐습니다.`,
              section: 'deploy',
            });
          } else if (status.state === 'failure') {
            void notify({
              title: '❌ 배포 실패',
              body: `${label} — ${status.result ?? '실패'}`,
              section: 'deploy',
            });
          } else {
            void notify({
              title: '⚠️ 배포 오류',
              body: `${label} — ${status.error ?? '상태 추적 오류'}`,
              section: 'deploy',
            });
          }
        }
      };

      try {
        const { queueUrl } = await triggerBuild(auth, target.jobPath);
        inFlight.add(key);
        // 완료까지 기다리지 않고 즉시 반환 — 진행/완료는 이벤트로 전달
        watchBuild(auth, target.jobPath, queueUrl, push).finally(() =>
          inFlight.delete(key),
        );
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
