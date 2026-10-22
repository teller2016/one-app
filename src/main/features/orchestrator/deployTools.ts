// 루트 세션 MCP 도구 — 배포(3a, 2026-10-22): list_deploy_targets · preview_deploy · open_deploy_confirm.
//
// 기획 결정: 실행은 기존 배포 확인 모달에서 사용자가 누른다 — 루트는 대상을 찾아 그 모달을 띄우는 데까지만(open_deploy_confirm).
// PROD 는 모달에서 대상 이름을 입력해야 하고, main 이 그 이름을 다시 대조한다(deploy:trigger) — 루트가 건너뛸 길이 없다.
// 조회는 배포 기능의 공유 채널(handleShared — 폰과 같은 함수)을 그대로 부른다(lib/moIpc callShared).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DeployPreviewResult, DeployProjectView, DeployStatus } from '../../../shared/types';
import { callShared } from '../../lib/moIpc';
import { sendOpenRequest } from './openRequest';
import { fail, json, READ } from './toolKit';

const COMMITS_SHOWN = 20;

const projects = async () => (await callShared('deploy:projects:get', [])) as DeployProjectView[];

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null);

/** id 또는 이름(대소문자 무시)으로 프로젝트·대상 찾기 */
async function resolve(projectRef: string, targetRef: string) {
  const list = await projects();
  const key = (s: string) => s.trim().toLowerCase();
  const p = list.find((x) => x.id === projectRef) ?? list.find((x) => key(x.name) === key(projectRef));
  if (!p) return { error: `그런 배포 프로젝트가 없습니다 — 있는 것: ${list.map((x) => x.name).join(', ') || '없음'}` } as const;
  const t = p.targets.find((x) => x.id === targetRef) ?? p.targets.find((x) => key(x.name) === key(targetRef));
  if (!t) return { error: `'${p.name}' 에 그런 대상이 없습니다 — 있는 것: ${p.targets.map((x) => x.name).join(', ')}` } as const;
  return { p, t } as const;
}

export function registerDeployTools(server: McpServer): void {
  server.registerTool(
    'list_deploy_targets',
    {
      title: '배포 대상·상태',
      description:
        '원앱 배포(젠킨스) 프로젝트와 대상별 최근 빌드 상태 — project(id·name·production=운영)·targets(id·name·state=idle/queued/building/success/failure…·' +
        'build_number·result·started_at·finished_at). "배포 어떻게 됐어?"에도 쓴다(refresh=true 면 캐시 없이 새로).',
      inputSchema: {
        project: z.string().optional().describe('프로젝트 id 또는 이름 — 없으면 전부'),
        refresh: z.boolean().optional().describe('캐시(30초) 없이 젠킨스에 다시 묻기'),
      },
      annotations: READ,
    },
    async ({ project, refresh }) => {
      const key = project?.trim().toLowerCase();
      const list = (await projects()).filter((p) => !key || p.id === project || p.name.toLowerCase() === key);
      if (!list.length) return fail('그런 배포 프로젝트가 없습니다.');
      const out = await Promise.all(
        list.map(async (p) => {
          let statuses: Record<string, DeployStatus> = {};
          let error: string | undefined;
          try {
            statuses = (await callShared('deploy:status:fetch', [p.id, refresh === true])) as Record<string, DeployStatus>;
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }
          return {
            id: p.id,
            name: p.name,
            production: p.production,
            error,
            targets: p.targets.map((t) => {
              const s = statuses[t.id];
              return {
                id: t.id,
                name: t.name,
                state: s?.state ?? 'unknown',
                build_number: s?.buildNumber ?? null,
                result: s?.result ?? null,
                started_at: iso(s?.startedAt),
                finished_at: iso(s?.finishedAt),
                queue_reason: s?.queueWhy ?? undefined,
                error: s?.error ?? undefined,
              };
            }),
          };
        }),
      );
      return json({ projects: out });
    },
  );

  server.registerTool(
    'preview_deploy',
    {
      title: '배포 미리보기',
      description: '그 대상에 이번에 나갈 커밋(마지막 빌드 이후) — 배포 확인 모달이 보여 주는 것과 같다. 최근 20개.',
      inputSchema: {
        project: z.string().min(1).describe('프로젝트 id 또는 이름'),
        target: z.string().min(1).describe('대상 id 또는 이름(예: 스토어)'),
      },
      annotations: READ,
    },
    async ({ project, target }) => {
      const r = await resolve(project, target);
      if ('error' in r) return fail(r.error as string);
      const res = (await callShared('deploy:preview', [r.p.id, r.t.id])) as DeployPreviewResult;
      if (!res.ok) return fail(res.error ?? '미리보기를 가져오지 못했습니다.');
      if (!res.configured) return json({ configured: false, note: 'Gitea 주소가 설정돼 있지 않아 미리보기가 없습니다.' });
      return json({
        project: r.p.name,
        target: r.t.name,
        branch: res.branch ?? null,
        total_commits: res.totalCommits ?? res.commits?.length ?? 0,
        commits: (res.commits ?? []).slice(0, COMMITS_SHOWN).map((c) => ({
          id: c.id.slice(0, 8),
          title: c.message.split('\n')[0],
          author: c.author,
          at: iso(c.timestamp),
        })),
        compare_url: res.compareUrl ?? null,
      });
    },
  );

  server.registerTool(
    'open_deploy_confirm',
    {
      title: '배포 확인 창 열기',
      description:
        '원앱 배포 섹션의 확인 모달(커밋 미리보기 포함)을 그 대상으로 띄운다 — **배포는 하지 않는다**. 실행은 사용자가 모달의 [배포]를 누른다' +
        '(운영 PROD 는 대상 이름을 입력해야 실행된다). 사용자에게 "확인 창을 띄웠다"고만 말하고 배포했다고 말하지 말 것.',
      inputSchema: {
        project: z.string().min(1).describe('프로젝트 id 또는 이름'),
        target: z.string().min(1).describe('대상 id 또는 이름'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ project, target }) => {
      const r = await resolve(project, target);
      if ('error' in r) return fail(r.error as string);
      if (!sendOpenRequest({ kind: 'deploy', projectId: r.p.id, targetId: r.t.id })) {
        return fail('앱 창이 없어 확인 창을 띄우지 못했습니다.');
      }
      return json({
        ok: true,
        opened: 'deploy_confirm',
        project: r.p.name,
        target: r.t.name,
        production: r.p.production,
        note: r.p.production
          ? '운영(PROD) 배포 확인 창을 띄웠습니다 — 사용자가 대상 이름을 입력하고 [배포]를 눌러야 실행됩니다.'
          : '배포 확인 창을 띄웠습니다 — 사용자가 [배포]를 눌러야 실행됩니다.',
      });
    },
  );
}
