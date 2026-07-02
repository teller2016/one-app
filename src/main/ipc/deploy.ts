import { ipcMain } from 'electron';
import {
  listProjects,
  saveProject,
  deleteProject,
  getProjectCredentials,
} from '../deploy/store';
import {
  triggerBuild,
  watchBuild,
  fetchLastStatus,
  fetchBuildDetail,
  JenkinsAuth,
} from '../deploy/jenkins';
import type {
  SaveDeployProjectInput,
  DeployStatus,
  DeployStatusEvent,
  DeployTriggerResult,
  DeployBuildDetailResult,
} from '../../shared/types';

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
      const push = (status: DeployStatus) => {
        if (sender.isDestroyed()) return;
        const evt: DeployStatusEvent = { projectId, targetId, status };
        sender.send('deploy:status', evt);
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
