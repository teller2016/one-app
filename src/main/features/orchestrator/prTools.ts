// 루트 세션 MCP 도구 — PR(3b, 2026-10-22): list_prs · open_pr_create · open_pr_merge.
//
// 기획 결정: 만들기·머지는 기존 PR 화면에서 사용자가 누른다 — 루트는 새 PR 모달을 채워 열거나(open_pr_create) 그 PR 을 골라 상세 패널을
// 띄우기(open_pr_merge)까지만. 주요 브랜치(main 등)로 가는 머지는 기존 확인창의 브랜치 이름 입력을 그대로 거친다.
// 조회는 PR 기능의 공유 채널(handleShared — 폰과 같은 함수·60초 캐시)을 그대로 부른다.
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ownerRepoFromUrl, type PrAllBranchesResult, type PrListResult, type PrsConfig } from '../../../shared/types';
import { giteaJson } from '../../lib/gitea';
import { callShared } from '../../lib/moIpc';
import { listProjects } from '../projects/store';
import { getGiteaConfig } from '../settings/store';
import { listWorkspaces } from '../workspaces/store';
import { sendOpenRequest } from './openRequest';
import { fail, iso, json, READ } from './toolKit';

const METHODS = ['merge', 'squash', 'rebase'] as const;

/** 프로젝트 레지스트리의 Gitea 저장소 — PR 섹션의 저장소 탭과 같은 목록(생성은 여기만 된다) */
function registryRepos(): { repo: string; name: string }[] {
  const seen = new Set<string>();
  return listProjects().flatMap((p) => {
    if (p.remoteKind !== 'gitea') return [];
    const repo = ownerRepoFromUrl(p.remoteUrl);
    if (!repo || seen.has(repo)) return [];
    seen.add(repo);
    return [{ repo, name: p.name }];
  });
}

/**
 * "owner/repo" · 프로젝트 이름 · **워크스페이스 이름**(FO-BBJ — 루트가 list_workspaces 로 부르는 이름, 대소문자 무시) → owner/repo.
 * 워크스페이스는 저장소 경로가 같은 레지스트리 프로젝트의 Gitea 주소로 잇는다.
 */
function resolveRepo(ref: string): string | null {
  const t = ref.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(t)) return t;
  const low = t.toLowerCase();
  const hit = registryRepos().find((r) => r.name.toLowerCase() === low);
  if (hit) return hit.repo;
  const ws = listWorkspaces().find((w) => w.name.toLowerCase() === low);
  if (!ws) return null;
  const proj = listProjects().find((p) => p.remoteKind === 'gitea' && path.resolve(p.localPath) === path.resolve(ws.repoPath));
  return proj ? ownerRepoFromUrl(proj.remoteUrl) : null;
}

/** 내 Gitea 아이디 — 토큰 주인(`/api/v1/user`). 주소·토큰이 바뀌면 다시 묻는다 */
let me: { key: string; login: string | null } | null = null;
async function myLogin(): Promise<string | null> {
  const gitea = getGiteaConfig();
  if (!gitea?.token) return null;
  const key = `${gitea.url}|${gitea.token.slice(-6)}`;
  if (me?.key === key) return me.login;
  try {
    const user = await giteaJson<{ login?: string }>(`${gitea.url.replace(/\/+$/, '')}/api/v1/user`, gitea.token, { label: 'Gitea 사용자' });
    me = { key, login: user.login ?? null };
  } catch {
    me = { key, login: null };
  }
  return me.login;
}

async function openPrs(force: boolean): Promise<PrListResult> {
  return (await callShared('prs:fetch', [{ force }])) as PrListResult;
}

export function registerPrTools(server: McpServer): void {
  server.registerTool(
    'list_prs',
    {
      title: '열린 PR 목록',
      description:
        'Gitea 의 열린 PR — repo·number·title·author·mine(내가 올린 것)·head→base·approvals(승인 수)·mergeable(충돌 없음)·url. ' +
        'repo 는 owner/repo 또는 프로젝트 이름. 머지·생성 전에 상태를 볼 때.',
      inputSchema: {
        repo: z.string().optional().describe('owner/repo · 프로젝트 이름 · 워크스페이스 이름(FO-BBJ) — 없으면 전부'),
        mine: z.boolean().optional().describe('내가 올린 PR 만'),
        refresh: z.boolean().optional().describe('캐시(60초) 없이 다시'),
      },
      annotations: READ,
    },
    async ({ repo, mine, refresh }) => {
      const want = repo ? resolveRepo(repo) : null;
      if (repo && !want) return fail(`그런 저장소가 없습니다 — owner/repo 또는 프로젝트 이름(${registryRepos().map((r) => r.name).join(', ')})`);
      const res = await openPrs(refresh === true);
      if (!res.configured) return fail('환경설정에 Gitea 주소가 없습니다.');
      if (!res.ok) return fail(res.error ?? 'PR 목록을 가져오지 못했습니다.');
      const login = await myLogin();
      const prs = (res.prs ?? [])
        .filter((p) => !want || p.repo === want)
        .map((p) => ({ ...p, mine: !!login && p.author === login }))
        .filter((p) => !mine || p.mine)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return json({
        my_login: login,
        count: prs.length,
        prs: prs.map((p) => ({
          repo: p.repo,
          number: p.number,
          title: p.title,
          author: p.author,
          mine: p.mine,
          head: p.head ?? null,
          base: p.base ?? null,
          approvals: p.approvals ?? null,
          mergeable: p.mergeable ?? null,
          created_at: iso(p.createdAt),
          url: p.url,
        })),
      });
    },
  );

  server.registerTool(
    'open_pr_create',
    {
      title: '새 PR 모달 열기',
      description:
        '원앱 PR 섹션의 새 PR 모달을 그 저장소로 채워 연다 — **PR 을 만들지는 않는다**(사용자가 [PR 생성]). head 는 원격에 push 된 브랜치여야 한다' +
        '(워커가 push 했는지 먼저 확인). base·title·body 를 비우면 평소처럼 최근 대상·커밋 초안으로 채워진다. repo 는 프로젝트에 등록된 저장소만.',
      inputSchema: {
        repo: z.string().min(1).describe('owner/repo · 프로젝트 이름 · 워크스페이스 이름(FO-BBJ)'),
        head: z.string().min(1).describe('원본 브랜치(예: feature/SSB-137)'),
        base: z.string().optional().describe('대상 브랜치 — 사용자가 말했을 때만'),
        title: z.string().max(200).optional(),
        body: z.string().max(8000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ repo, head, base, title, body }) => {
      const r = resolveRepo(repo);
      const reg = registryRepos().find((x) => x.repo === r);
      if (!r || !reg) {
        return fail(`프로젝트에 등록된 Gitea 저장소만 PR 을 만들 수 있습니다 — 있는 것: ${registryRepos().map((x) => `${x.name}(${x.repo})`).join(', ') || '없음'}`);
      }
      const branches = (await callShared('prs:all-branches', [r])) as PrAllBranchesResult;
      if (branches.ok) {
        const names = new Set(branches.names ?? []);
        if (!names.has(head)) return fail(`원격(${reg.name})에 '${head}' 브랜치가 없습니다 — 워커가 push 했는지 먼저 확인하세요.`);
        if (base && !names.has(base)) return fail(`원격(${reg.name})에 대상 브랜치 '${base}' 가 없습니다.`);
      }
      if (!sendOpenRequest({ kind: 'pr-create', repo: r, head, base, title, body })) return fail('앱 창이 없어 모달을 띄우지 못했습니다.');
      return json({
        ok: true,
        opened: 'pr_create',
        repo: r,
        head,
        base: base ?? '(최근 대상·기본 브랜치)',
        note: '새 PR 모달을 채워 띄웠습니다 — 사용자가 커밋·제목을 확인하고 [PR 생성]을 눌러야 만들어집니다.',
      });
    },
  );

  server.registerTool(
    'open_pr_merge',
    {
      title: 'PR 머지 확인 창 띄우기',
      description:
        '원앱 PR 섹션에서 그 PR 을 골라 상세 패널(커밋·충돌·머지 방식)을 띄우고, 머지할 수 있으면 [머지] 확인 창까지 띄운다 — **머지하지는 않는다**' +
        '(사용자가 확인 창의 [머지]. 주요 브랜치로 가면 이름 입력 확인도). 충돌이면 확인 창 없이 패널만. method 를 주면 머지 방식을 미리 골라 둔다.',
      inputSchema: {
        repo: z.string().min(1).describe('owner/repo · 프로젝트 이름 · 워크스페이스 이름(FO-BBJ)'),
        number: z.number().int().positive().describe('PR 번호'),
        method: z.enum(METHODS).optional().describe('merge·squash·rebase — 사용자가 말했을 때만'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ repo, number, method }) => {
      const r = resolveRepo(repo);
      if (!r) return fail('그런 저장소가 없습니다 — owner/repo 또는 프로젝트 이름.');
      const res = await openPrs(false);
      if (!res.ok) return fail(res.error ?? 'PR 목록을 가져오지 못했습니다.');
      const pr = (res.prs ?? []).find((p) => p.repo === r && p.number === number);
      if (!pr) return fail(`${r} 에 열린 PR #${number} 가 없습니다 — list_prs 로 확인하세요.`);
      const cfg = (await callShared('prs:config:get', [])) as PrsConfig;
      const org = r.split('/')[0];
      if (!sendOpenRequest({ kind: 'pr-merge', repo: r, number, method })) return fail('앱 창이 없어 화면을 띄우지 못했습니다.');
      return json({
        ok: true,
        opened: 'pr_merge',
        repo: r,
        number,
        title: pr.title,
        head: pr.head ?? null,
        base: pr.base ?? null,
        mergeable: pr.mergeable ?? null,
        approvals: pr.approvals ?? null,
        note:
          (cfg.excludedOrgs.includes(org) ? `⚠️ PR 탭에서 '${org}' 조직을 숨겨 둬서 상세가 안 보일 수 있습니다. ` : '') +
          (pr.mergeable === false
            ? '충돌이 있어 상세 패널만 띄웠습니다(확인 창 없음) — 충돌을 먼저 풀어야 합니다.'
            : '그 PR 의 머지 확인 창을 띄웠습니다 — 사용자가 확인 창의 [머지]를 눌러야 머지됩니다.'),
      });
    },
  );
}
