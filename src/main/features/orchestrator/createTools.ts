// 루트 세션 MCP 도구 — 만들기(2단계, 2026-10-22): start_ticket · open_session · create_worktree.
//
// 기획 결정: 만들기는 **늘 원앱 승인 창**을 거친다(여러 티켓은 한 창에 항목으로 묶고 항목별로 뺄 수 있다, 고를 수 있는 것은 스택·계정뿐).
// 새 세션은 회사(FEMC) 저장소만·femc 로 통일 · 이미 그 티켓의 세션이 있으면 만들지 않는다(그 세션에 지시 — send_to_session).
// 어디서 열지는 ticketPlan.ts(순수 판정), 워크트리는 femc-wt.sh(worktreeSetup.ts), femc 명령은 Jira [작업]과 같은 것(jira prepareJiraWork·femcCommand).
// 승인 뒤 워크트리 준비까지 기다렸다 결과를 돌려준다(사용자 결정 — 2분이 넘으면 Claude Code 가 백그라운드 작업으로 돌린다).
// 만든 세션은 작업 원장에 올려 끝나면 4줄 보고 한 바퀴가 그대로 돈다(tasks.ts).
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { JiraWorkAccount, JiraWorkSkill, TerminalWorkspace } from '../../../shared/types';
import { femcStacks, registeredFemcStack } from '../../lib/femc';
import { sendToast } from '../notify/notify';
import { femcCommand, listWorkAccounts, prepareJiraWork, resolveSkill, validateAddedTicket } from '../jira';
import { findProjectsByJiraKey, listProjects } from '../projects/store';
import { createSession, femcStackFor, listSessions, terminalOverview } from '../terminal';
import { listBranches, listWorktrees, listWorktreesBrief } from '../workspaces/git';
import { listWorkspaces } from '../workspaces/store';
import { askApproval, DECLINED } from './approve';
import { MAX_INSTRUCTION_CHARS, sanitizeInstruction, ticketKeyOf } from './guard';
import { addTask } from './tasks';
import { branchTicketKey, pickPlace, type TicketPlace } from './ticketPlan';
import { excludedIds, fail, json } from './toolKit';
import { setupWorktree, worktreePathFor } from './worktreeSetup';

const MAX_TICKETS = 5;
const SKILLS = ['auto', 'run-ticket', 'qa', 'dev', 'bugfix', 'none'] as const;
const ACCOUNTS = ['personal', 'team'] as const;
/** git 브랜치 이름으로 받을 것 — 셸·경로로 새지 않게 좁게 */
const BRANCH_RE = /^(?!.*\.\.)(?!\/)(?!.*\/$)[\w.\-/]{1,100}$/;

const samePath = (a: string, b: string) => path.resolve(a) === path.resolve(b);
const isInside = (parent: string, child: string) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** 그 경로(또는 아래)에 떠 있는 세션 수 — 루트·독 셸은 세지 않는다 */
function sessionsAt(p: string): number {
  const excluded = excludedIds();
  return listSessions().filter((s) => !excluded.has(s.id) && isInside(p, s.cwd)).length;
}

/**
 * Jira 프로젝트 키(SSB)에 걸린 워크스페이스 — ① 프로젝트 레지스트리의 저장소 경로와 워크스페이스 경로가 같은 것(Jira [작업] 모달과 같은 규칙)
 * ② 없으면 그 키 접두어(`SSB-`)의 브랜치가 워크트리로 올라가 있는 회사 저장소. ⚠️ 레지스트리의 Jira 키가 실제 티켓 키와
 * 다를 수 있다(2026-10-22 실측: 레지스트리 BBJ · 티켓 SSB-…) — 그때도 그 티켓들을 작업해 온 저장소를 후보로 낸다.
 */
async function workspacesForProjectKey(projectKey: string): Promise<TerminalWorkspace[]> {
  const paths = findProjectsByJiraKey(projectKey).map((p) => p.localPath);
  const byRegistry = listWorkspaces().filter((w) => paths.some((p) => samePath(p, w.repoPath)));
  if (byRegistry.length) return byRegistry;
  const out: TerminalWorkspace[] = [];
  for (const ws of listWorkspaces()) {
    if (!isCompanyWorkspace(ws)) continue;
    const list = await listWorktreesBrief(ws.repoPath, { cached: true }).catch(() => []);
    if (list.some((w) => branchTicketKey(w.branch)?.startsWith(`${projectKey}-`))) out.push(ws);
  }
  return out;
}

/** 그 워크스페이스에 걸린 Jira 프로젝트 키 */
export function jiraKeysOf(ws: TerminalWorkspace): string[] {
  return listProjects()
    .filter((p) => p.jiraProjectKey && samePath(p.localPath, ws.repoPath))
    .map((p) => p.jiraProjectKey);
}

/** 회사(FEMC) 저장소인가 — femc 에 등록돼 있거나 Jira 키가 걸려 있다. 새 세션은 여기서만 연다(기획 결정) */
export const isCompanyWorkspace = (ws: TerminalWorkspace) => !!registeredFemcStack(ws.repoPath) || jiraKeysOf(ws).length > 0;

const placeText = (ws: TerminalWorkspace, place: TicketPlace): string => {
  switch (place.kind) {
    case 'existing':
      return place.main ? `주 체크아웃 (${place.branch})` : `기존 워크트리 ${path.basename(place.path)} (${place.branch})`;
    case 'main':
      return `주 체크아웃 (${place.branch ?? 'detached'}) — 브랜치는 워커가 딴다`;
    case 'new':
      return `새 워크트리 ${path.basename(worktreePathFor(ws.name, place.branch))} ← ${place.fromBranch ? '기존' : '새'} 브랜치 ${place.branch}`;
  }
};

const skillText = (skill: JiraWorkSkill, issueType: string): string => {
  if (skill === 'none') return '스킬 없이 티켓만 넘김';
  const cmd = resolveSkill(skill, issueType);
  return skill === 'auto' ? `${cmd} (자동 — 유형 ${issueType || '?'})` : `${cmd}`;
};

/** 계정 선택지 — 프로필이 둘 이상일 때만 묻는다 */
function accountChoice(preset: JiraWorkAccount | undefined) {
  const accounts = listWorkAccounts();
  if (accounts.length < 2) return null;
  return {
    id: 'account',
    label: 'claude 계정',
    options: accounts.map((a) => ({ value: a.id, label: `${a.label}${a.email ? ` · ${a.email}` : ''}` })),
    value: preset ?? 'personal',
  };
}

const stackOptions = () => femcStacks().map((s) => ({ value: s, label: s }));

/** 새 워크트리가 필요하면 만든다 — 만든(또는 쓰기로 한) 위치를 돌려준다 */
async function ensurePlace(
  ws: TerminalWorkspace,
  place: TicketPlace,
): Promise<{ ok: true; cwd: string; branch: string | null; created: boolean; warnings: string[] } | { ok: false; error: string }> {
  if (place.kind === 'existing') return { ok: true, cwd: place.path, branch: place.branch, created: false, warnings: [] };
  if (place.kind === 'main') return { ok: true, cwd: place.path, branch: place.branch, created: false, warnings: [] };
  const res = await setupWorktree({ repoPath: ws.repoPath, workspaceName: ws.name, branch: place.branch });
  if (!res.ok) return { ok: false, error: `워크트리를 만들지 못했습니다: ${res.error}` };
  return { ok: true, cwd: res.path, branch: place.branch, created: true, warnings: res.warnings };
}

type TicketInput = { key: string; skill?: JiraWorkSkill; note?: string; workspace_id?: string };

type TicketPlan = {
  key: string;
  summary: string;
  issueType: string;
  ws: TerminalWorkspace;
  place: TicketPlace;
  skill: JiraWorkSkill;
  note?: string;
  /** 아는 스택 — 모르면 승인 창에서 고른다 */
  stack: string | null;
};

/** 티켓 하나의 계획 — 못 세우면 이유(루트가 사용자에게 전한다) */
async function planTicket(t: TicketInput): Promise<{ plan: TicketPlan } | { refused: { key: string; reason: string; candidates?: unknown } }> {
  const info = await validateAddedTicket(t.key);
  if (!info.ok || !info.key) return { refused: { key: t.key, reason: info.error ?? '티켓을 찾지 못했습니다.' } };
  const key = info.key;

  const live = (await terminalOverview()).find((it) => ticketKeyOf(it) === key);
  if (live) {
    return {
      refused: {
        key,
        reason: `이미 이 티켓의 세션이 있습니다(탭 '${live.tabTitle}', id ${live.id}) — 새로 만들지 말고 send_to_session 으로 지시하세요.`,
      },
    };
  }

  let ws: TerminalWorkspace | undefined;
  if (t.workspace_id) {
    ws = listWorkspaces().find((w) => w.id === t.workspace_id);
    if (!ws) return { refused: { key, reason: '그런 워크스페이스가 없습니다 — list_workspaces 의 id 를 쓰세요.' } };
  } else {
    const candidates = await workspacesForProjectKey(key.split('-')[0]);
    if (candidates.length === 0) {
      return {
        refused: {
          key,
          reason: `Jira 키 ${key.split('-')[0]} 에 연결된 워크스페이스가 없습니다 — 사용자에게 어느 저장소인지 묻고 workspace_id 로 지정하세요.`,
        },
      };
    }
    if (candidates.length > 1) {
      return {
        refused: {
          key,
          reason: '이 Jira 키를 쓰는 저장소가 여럿입니다 — 사용자에게 고르게 하고 workspace_id 로 다시 부르세요.',
          candidates: candidates.map((w) => ({ workspace_id: w.id, name: w.name })),
        },
      };
    }
    ws = candidates[0];
  }
  if (!isCompanyWorkspace(ws)) {
    return { refused: { key, reason: `'${ws.name}' 은 회사(FEMC) 저장소가 아닙니다 — 루트는 FEMC 저장소에서만 새 세션을 엽니다.` } };
  }

  const [worktrees, branches] = await Promise.all([
    listWorktrees(ws.repoPath).catch(() => []),
    listBranches(ws.repoPath).catch(() => ({ ok: false, locals: [], remotes: [] })),
  ]);
  const place = pickPlace({
    key,
    issueType: info.issueType ?? '',
    worktrees: worktrees.filter((w) => !w.missing && !w.plain),
    branches: [...branches.locals, ...branches.remotes],
    sessionsAt,
  });
  const where = place.kind === 'new' ? worktreePathFor(ws.name, place.branch) : place.path;
  // 아직 없는 새 워크트리는 그 저장소(주 체크아웃) 기준으로 스택을 본다
  const stack = await femcStackFor(place.kind === 'new' ? ws.repoPath : where);
  return {
    plan: {
      key,
      summary: info.summary ?? '',
      issueType: info.issueType ?? '',
      ws,
      place,
      skill: t.skill ?? 'auto',
      note: t.note?.trim() || undefined,
      stack,
    },
  };
}

export function registerCreateTools(server: McpServer): void {
  server.registerTool(
    'start_ticket',
    {
      title: '티켓 세션 열기',
      description:
        'Jira 티켓의 femc 세션을 새로 연다(여러 티켓은 한 번에 — 승인 창 하나에 묶인다). 원앱이 티켓마다 계획을 세운다: ' +
        '저장소 = Jira 키에 걸린 워크스페이스(여럿이면 거부 + candidates — 사용자에게 묻고 workspace_id 로 다시), ' +
        '위치 = 그 티켓 브랜치의 워크트리 → 브랜치만 있으면 그 브랜치로 새 워크트리 → 주 체크아웃이 비어 있으면 거기 → 아니면 새 워크트리(버그 계열 fix/키, 그 외 feature/키), ' +
        '스킬 = skill(말 안 했으면 auto — 버그 계열 /bugfix, 그 외 /dev · "그냥 작업해"면 none). ' +
        '이미 그 티켓의 세션이 있으면 거부한다 — 그 세션에 send_to_session 으로 지시할 것. 사용자가 승인 창에서 항목을 빼거나 스택·계정을 고른다. ' +
        '만든 세션은 작업 원장에 올라가 끝나면 4줄 보고가 온다. 워크트리 준비(node_modules 등)까지 기다려 결과를 준다.',
      inputSchema: {
        tickets: z
          .array(
            z.object({
              key: z.string().min(1).describe('티켓 키 또는 Jira 주소(예: SSB-137)'),
              skill: z.enum(SKILLS).optional().describe('사용자가 말한 스킬 — 없으면 auto'),
              note: z.string().max(4000).optional().describe('사용자가 덧붙인 지시(부가 설명)'),
              workspace_id: z.string().optional().describe('저장소를 사용자가 골랐을 때 — list_workspaces 의 id'),
            }),
          )
          .min(1)
          .max(MAX_TICKETS),
        account: z.enum(ACCOUNTS).optional().describe('claude 계정 — 기본 personal'),
      },
    },
    async ({ tickets, account }, extra) => {
      const plans: TicketPlan[] = [];
      const refused: { key: string; reason: string; candidates?: unknown }[] = [];
      for (const t of tickets) {
        const r = await planTicket(t);
        if ('plan' in r) plans.push(r.plan);
        else refused.push(r.refused);
      }
      if (plans.length === 0) return json({ ok: false, started: [], refused });

      const acct = accountChoice(account);
      const outcome = await askApproval(
        {
          title: `티켓 세션 열기 (${plans.length}건)`,
          fields: [],
          items: plans.map((p) => ({
            id: p.key,
            title: `${p.key} — ${p.summary}`,
            lines: [
              `저장소: ${p.ws.name}`,
              `위치: ${placeText(p.ws, p.place)}`,
              `스킬: ${skillText(p.skill, p.issueType)}`,
              ...(p.stack ? [`스택: ${p.stack}`] : []),
              ...(p.note ? [`부가 설명: ${p.note}`] : []),
            ],
            checked: true,
          })),
          choices: [
            ...(acct ? [acct] : []),
            ...plans
              .filter((p) => !p.stack)
              .map((p) => ({ id: `stack:${p.key}`, label: `${p.key} 스택`, options: stackOptions(), value: null, itemId: p.key })),
          ],
          note: refused.length ? `제외: ${refused.map((r) => `${r.key} — ${r.reason}`).join(' / ')}` : undefined,
        },
        extra.signal,
      );
      if (outcome.decision !== 'approved') return fail(DECLINED[outcome.decision]);
      const kept = new Set(outcome.picks?.items ?? plans.map((p) => p.key));
      const chosenAccount = (outcome.picks?.choices.account as JiraWorkAccount | undefined) ?? account ?? 'personal';

      const started = [];
      for (const p of plans) {
        if (!kept.has(p.key)) {
          started.push({ key: p.key, ok: false, skipped: '사용자가 승인 창에서 뺐습니다.' });
          continue;
        }
        const placed = await ensurePlace(p.ws, p.place);
        if (!placed.ok) {
          started.push({ key: p.key, ok: false, error: placed.error });
          continue;
        }
        const stack = outcome.picks?.choices[`stack:${p.key}`] ?? p.stack;
        const prep = await prepareJiraWork({ key: p.key, skill: p.skill, note: p.note, account: chosenAccount, cwd: placed.cwd, stack: stack ?? undefined });
        if (!prep.ok || !prep.command) {
          started.push({ key: p.key, ok: false, error: prep.error ?? '티켓을 준비하지 못했습니다.' });
          continue;
        }
        const info = createSession({ cwd: placed.cwd, agentId: 'femc', command: prep.command, title: p.key });
        const task = addTask({
          sessionId: info.id,
          ticketKey: p.key,
          repo: p.ws.name,
          branch: placed.branch,
          tab: p.key,
          instruction: prep.prompt ?? p.key,
          report: true,
          claude: null,
        });
        sendToast({
          title: `루트가 ${p.key} 세션을 열었습니다`,
          message: `${p.ws.name} · ${path.basename(placed.cwd)}${placed.created ? ' (새 워크트리)' : ''}`,
          variant: 'info',
          terminalSession: { sessionId: info.id, cwd: info.cwd },
          actionLabel: '보기',
          dedupeKey: `root-start:${info.id}`,
        });
        started.push({
          key: p.key,
          ok: true,
          session_id: info.id,
          task_id: task.id,
          cwd: placed.cwd,
          branch: placed.branch,
          worktree: placed.created ? 'created' : p.place.kind === 'existing' ? 'existing' : 'main',
          stack: prep.stack ?? null,
          warnings: placed.warnings.length ? placed.warnings : undefined,
        });
      }
      return json({ ok: started.some((s) => s.ok), started, refused });
    },
  );

  server.registerTool(
    'open_session',
    {
      title: '새 세션 열기(티켓 아님)',
      description:
        '티켓이 아닌 지시로 새 femc 세션을 연다 — 회사(FEMC) 저장소만. 위치: cwd(그 워크스페이스의 기존 워크트리 경로) · ' +
        'new_branch(그 브랜치의 워크트리 — 없으면 femc-wt.sh 로 만든다) · 둘 다 없으면 주 체크아웃. 승인 창을 거친다. ' +
        'instruction 이 femc 의 첫 메시지가 된다(스킬을 말했으면 `/스킬 …` 형태로). 끝나면 4줄 보고가 온다(report=false 면 생략).',
      inputSchema: {
        workspace_id: z.string().min(1).describe('list_workspaces 의 id'),
        instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS).describe('첫 지시 — 사용자가 말한 그대로'),
        cwd: z.string().optional().describe('기존 워크트리 경로 — list_workspaces 의 worktrees[].path'),
        new_branch: z.string().optional().describe('새 워크트리의 브랜치 이름 — 사용자가 말했을 때만'),
        base: z.string().optional().describe('새 브랜치의 분기점 — 말이 없으면 FEMC 기본'),
        title: z.string().max(40).optional().describe('탭 이름 — 없으면 지시 앞머리'),
        account: z.enum(ACCOUNTS).optional(),
        report: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      const ws = listWorkspaces().find((w) => w.id === args.workspace_id);
      if (!ws) return fail('그런 워크스페이스가 없습니다 — list_workspaces 의 id 를 쓰세요.');
      if (!isCompanyWorkspace(ws)) return fail(`'${ws.name}' 은 회사(FEMC) 저장소가 아닙니다 — 루트는 FEMC 저장소에서만 새 세션을 엽니다.`);
      const instruction = sanitizeInstruction(args.instruction).trim();
      if (!instruction) return fail('지시가 비었습니다.');
      if (args.new_branch && !BRANCH_RE.test(args.new_branch)) return fail('브랜치 이름이 올바르지 않습니다.');
      if (args.base && !BRANCH_RE.test(args.base)) return fail('분기점 브랜치 이름이 올바르지 않습니다.');

      const worktrees = (await listWorktrees(ws.repoPath).catch(() => [])).filter((w) => !w.missing && !w.plain);
      let place: TicketPlace;
      if (args.cwd) {
        const wt = worktrees.find((w) => samePath(w.path, args.cwd as string));
        if (!wt) return fail('그 워크스페이스의 워크트리 경로가 아닙니다 — list_workspaces 의 worktrees[].path 를 쓰세요.');
        place = { kind: 'existing', path: wt.path, branch: wt.branch ?? 'detached', main: wt.isMain };
      } else if (args.new_branch) {
        const wt = worktrees.find((w) => w.branch === args.new_branch);
        place = wt ? { kind: 'existing', path: wt.path, branch: args.new_branch, main: wt.isMain } : { kind: 'new', branch: args.new_branch, fromBranch: false };
      } else {
        const main = worktrees.find((w) => w.isMain);
        if (!main) return fail('주 체크아웃을 찾지 못했습니다.');
        place = { kind: 'existing', path: main.path, branch: main.branch ?? 'detached', main: true };
      }
      const where = place.kind === 'new' ? ws.repoPath : place.path;
      const known = await femcStackFor(where);
      const acct = accountChoice(args.account);
      const head = instruction.replace(/\s+/g, ' ');
      const title = args.title?.trim() || (head.length > 20 ? `${head.slice(0, 20)}…` : head);
      const outcome = await askApproval(
        {
          title: '새 세션 열기',
          fields: [
            { label: '저장소', value: ws.name },
            { label: '위치', value: placeText(ws, place) + (place.kind === 'new' && args.base ? ` (분기점 ${args.base})` : '') },
            { label: '지시', value: instruction },
            ...(known ? [{ label: '스택', value: known }] : []),
          ],
          choices: [...(acct ? [acct] : []), ...(known ? [] : [{ id: 'stack', label: '스택', options: stackOptions(), value: null }])],
        },
        extra.signal,
      );
      if (outcome.decision !== 'approved') return fail(DECLINED[outcome.decision]);

      let cwd: string;
      let created = false;
      let warnings: string[] = [];
      if (place.kind === 'new') {
        const res = await setupWorktree({ repoPath: ws.repoPath, workspaceName: ws.name, branch: place.branch, base: args.base });
        if (!res.ok) return fail(`워크트리를 만들지 못했습니다: ${res.error}`);
        cwd = res.path;
        created = true;
        warnings = res.warnings;
      } else {
        cwd = place.path;
      }
      const stack = outcome.picks?.choices.stack ?? known;
      const account = (outcome.picks?.choices.account as JiraWorkAccount | undefined) ?? args.account ?? 'personal';
      const info = createSession({ cwd, agentId: 'femc', command: femcCommand({ prompt: instruction, account, stack }), title });
      const task = addTask({
        sessionId: info.id,
        repo: ws.name,
        branch: place.branch,
        tab: title,
        instruction,
        report: args.report !== false,
        claude: null,
      });
      sendToast({
        title: '루트가 새 세션을 열었습니다',
        message: `${ws.name} · ${path.basename(cwd)}${created ? ' (새 워크트리)' : ''}`,
        variant: 'info',
        terminalSession: { sessionId: info.id, cwd: info.cwd },
        actionLabel: '보기',
        dedupeKey: `root-open:${info.id}`,
      });
      return json({ ok: true, session_id: info.id, task_id: task.id, cwd, branch: place.branch, worktree: created ? 'created' : 'existing', stack: stack ?? null, warnings: warnings.length ? warnings : undefined });
    },
  );

  server.registerTool(
    'create_worktree',
    {
      title: '워크트리 만들기',
      description:
        '워크트리를 만들고 메인 체크아웃과 같은 상태로 맞춘다(femc-worktree 스킬의 femc-wt.sh — .env·.claude·node_modules·폴더 신뢰·MCP). ' +
        '브랜치가 로컬·원격에 있으면 그것을, 없으면 base(없으면 FEMC 기본 분기점)에서 새로 딴다. 그 브랜치의 워크트리가 이미 있으면 만들지 않고 그 경로를 준다. ' +
        '승인 창을 거친다. 세션은 열지 않는다(필요하면 open_session·start_ticket).',
      inputSchema: {
        workspace_id: z.string().min(1).describe('list_workspaces 의 id'),
        branch: z.string().min(1).describe('브랜치 이름 — 사용자가 말한 그대로(예: feature/SSB-137)'),
        base: z.string().optional().describe('새 브랜치의 분기점'),
      },
    },
    async ({ workspace_id, branch, base }, extra) => {
      const ws = listWorkspaces().find((w) => w.id === workspace_id);
      if (!ws) return fail('그런 워크스페이스가 없습니다 — list_workspaces 의 id 를 쓰세요.');
      if (!BRANCH_RE.test(branch)) return fail('브랜치 이름이 올바르지 않습니다.');
      if (base && !BRANCH_RE.test(base)) return fail('분기점 브랜치 이름이 올바르지 않습니다.');
      const worktrees = await listWorktrees(ws.repoPath).catch(() => []);
      const existing = worktrees.find((w) => !w.missing && w.branch === branch);
      if (existing) return json({ ok: true, created: false, path: existing.path, note: '그 브랜치의 워크트리가 이미 있습니다.' });
      const target = worktreePathFor(ws.name, branch);
      const outcome = await askApproval(
        {
          title: '워크트리 만들기',
          fields: [
            { label: '저장소', value: ws.name },
            { label: '브랜치', value: branch + (base ? ` (분기점 ${base})` : '') },
            { label: '위치', value: target },
            ...(branchTicketKey(branch) ? [{ label: '티켓', value: branchTicketKey(branch) as string }] : []),
          ],
        },
        extra.signal,
      );
      if (outcome.decision !== 'approved') return fail(DECLINED[outcome.decision]);
      const res = await setupWorktree({ repoPath: ws.repoPath, workspaceName: ws.name, branch, base });
      if (!res.ok) return fail(`워크트리를 만들지 못했습니다: ${res.error}\n${res.output}`);
      sendToast({ title: '루트가 워크트리를 만들었습니다', message: `${ws.name} · ${path.basename(res.path)}`, variant: 'info', dedupeKey: `root-wt:${res.path}` });
      return json({ ok: true, created: true, path: res.path, branch, warnings: res.warnings.length ? res.warnings : undefined });
    },
  );
}
