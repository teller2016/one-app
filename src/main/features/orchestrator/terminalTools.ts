// 루트 세션 MCP 도구 — 터미널 탭·프리셋: list_terminals · list_workspaces · run_preset · close_session.
//
// "다른 워크트리의 run dev 를 끄고 지금 워크트리에서 run dev 켜 줘" 같은 지시용(2026-10-22 사용자 요청).
// 프리셋 실행은 프리셋 바와 **같은 인자**로 세션을 만든다(renderer TerminalSection runPreset — agentIdFromCommand·명령·이름).
// 실행·닫기 모두 승인 없이 바로 한다(사용자 결정 10-22) — 대신 토스트로 무엇을 했는지 알린다.
// 단 루트의 이번 턴이 워커 보고로 시작됐으면 승인 창을 거친다(approve.ts gateIfChained — 무인 연쇄 가드).
// 루트 자신·독 패널 셸은 닫지 않는다.
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { agentIdFromCommand, type TerminalPreset, type TerminalWorkspace, type WorktreeInfo } from '../../../shared/types';
import { sendToast } from '../notify/notify';
import {
  createSession,
  killSession,
  listSessions,
  placeOf,
  sessionCommands,
  sessionRootPid,
} from '../terminal';
import { listWorktreesBrief } from '../workspaces/git';
import { listPresets, listWorkspaces } from '../workspaces/store';
import { gateIfChained } from './approve';
import { isCompanyWorkspace, jiraKeysOf } from './createTools';
import { excludedIds, fail, json, NO_SESSION, READ, stateOf } from './toolKit';
import { getRootSessionId } from './store';

/** 그 워크스페이스에서 쓸 수 있는 프리셋 — 전역(workspaceIds 없음) + 그 워크스페이스 지정. 바에서 숨긴 것도 포함 */
const presetsOf = (wsId: string): TerminalPreset[] =>
  listPresets().filter((p) => !p.workspaceIds || p.workspaceIds.includes(wsId));

/**
 * 등록된 워크트리인가 — 루트가 넘긴 경로를 그대로 믿지 않는다(임의 폴더에서 명령 실행 방지).
 * 검증이라 지문 캐시가 아니라 git 에 직접 묻는다(listWorktreesBrief 기본값).
 */
async function resolveWorktree(cwd: string): Promise<{ ws: TerminalWorkspace; wt: WorktreeInfo } | null> {
  const want = path.resolve(cwd);
  for (const ws of listWorkspaces()) {
    const list = await listWorktreesBrief(ws.repoPath).catch(() => [] as WorktreeInfo[]);
    const wt = list.find((w) => !w.missing && path.resolve(w.path) === want);
    if (wt) return { ws, wt };
  }
  return null;
}

const placeLabel = (ws: string | null | undefined, branch: string | null | undefined, cwd: string) =>
  [ws ?? path.basename(cwd), branch].filter(Boolean).join(' · ');

export function registerTerminalTools(server: McpServer): void {
  server.registerTool(
    'list_terminals',
    {
      title: '터미널 탭 목록',
      description:
        '셸 탭까지 포함한 One App 터미널 탭 전부 — id·tab(탭 이름, 프리셋으로 연 탭이면 프리셋 이름)·agent(shell·claude·femc…)·' +
        'repo·branch·cwd·state·commands(그 탭 안에서 지금 돌고 있는 명령 — 예: "npm run dev", 셸만 있으면 빈 배열). ' +
        'run dev 같은 서버가 어느 워크트리에서 도는지 찾을 때 쓴다. 루트 자신과 독 패널 셸은 빠진다.',
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      const excluded = excludedIds();
      const sessions = listSessions().filter((s) => !excluded.has(s.id));
      const roots = new Map<string, number>();
      for (const s of sessions) {
        const pid = await sessionRootPid(s.id);
        if (pid) roots.set(s.id, pid);
      }
      const commands = await sessionCommands(roots);
      const trees = new Map<string, Promise<WorktreeInfo[]>>();
      const terminals = [];
      for (const s of sessions) {
        const place = await placeOf(s.cwd, trees);
        terminals.push({
          id: s.id,
          tab: s.title,
          agent: s.agentId,
          repo: place.workspace?.name ?? null,
          branch: place.branch,
          cwd: s.cwd,
          state: stateOf(s),
          commands: commands.get(s.id) ?? [],
        });
      }
      return json({ count: terminals.length, terminals });
    },
  );

  server.registerTool(
    'list_workspaces',
    {
      title: '워크스페이스·워크트리·프리셋',
      description:
        'One App 에 등록된 워크스페이스(저장소)와 워크트리(path·branch·sessions = 거기 떠 있는 탭 수), 그 워크스페이스에서 쓸 수 있는 터미널 프리셋' +
        '(id·name·command), jira_keys(걸린 Jira 프로젝트 키), company(회사 FEMC 저장소 — 새 세션은 여기서만). ' +
        'run_preset·open_session 의 cwd 는 여기 나온 worktrees[].path 여야 한다.',
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      const excluded = excludedIds();
      const sessions = listSessions().filter((s) => !excluded.has(s.id));
      const workspaces = [];
      for (const ws of listWorkspaces()) {
        const list = await listWorktreesBrief(ws.repoPath, { cached: true }).catch(() => [] as WorktreeInfo[]);
        workspaces.push({
          id: ws.id,
          name: ws.name,
          repo_path: ws.repoPath,
          hidden: ws.hidden === true,
          jira_keys: jiraKeysOf(ws),
          company: isCompanyWorkspace(ws),
          worktrees: list
            .filter((w) => !w.missing)
            .map((w) => ({
              path: w.path,
              branch: w.branch ?? null,
              main: w.isMain,
              sessions: sessions.filter((s) => s.cwd === w.path).length,
            })),
          presets: presetsOf(ws.id).map((p) => ({ id: p.id, name: p.name, command: p.command })),
        });
      }
      return json({ workspaces });
    },
  );

  server.registerTool(
    'run_preset',
    {
      title: '프리셋 실행',
      description:
        '워크트리에서 터미널 프리셋을 새 탭으로 실행한다 — 프리셋 바를 누른 것과 같다. preset 은 list_workspaces 의 프리셋 id 또는 이름, ' +
        'cwd 는 그 워크스페이스의 워크트리 path. 같은 서버가 다른 워크트리에서 돌고 있으면(포트 충돌) 먼저 list_terminals 로 찾아 close_session 으로 닫는다.',
      inputSchema: {
        preset: z.string().min(1).describe('프리셋 id 또는 이름(예: "Run Dev")'),
        cwd: z.string().min(1).describe('실행할 워크트리 경로 — list_workspaces 의 worktrees[].path'),
      },
    },
    async ({ preset, cwd }, extra) => {
      const target = await resolveWorktree(cwd);
      if (!target) return fail('등록된 워크트리 경로가 아닙니다 — list_workspaces 의 worktrees[].path 를 쓰세요.');
      const candidates = presetsOf(target.ws.id);
      const key = preset.trim().toLowerCase();
      const p = candidates.find((x) => x.id === preset) ?? candidates.find((x) => x.name.trim().toLowerCase() === key);
      if (!p) {
        const names = candidates.map((x) => x.name).join(', ') || '없음';
        return fail(`'${target.ws.name}' 에 '${preset}' 프리셋이 없습니다 — 쓸 수 있는 것: ${names}`);
      }
      const blocked = await gateIfChained(
        {
          title: '프리셋 실행',
          fields: [
            { label: '프리셋', value: `${p.name} — ${p.command}` },
            { label: '위치', value: placeLabel(target.ws.name, target.wt.branch, target.wt.path) },
          ],
        },
        extra.signal,
      );
      if (blocked) return fail(blocked);
      const agentId = agentIdFromCommand(p.command);
      const info = createSession({ cwd: target.wt.path, agentId, command: p.command, title: p.name });
      sendToast({
        title: '루트가 프리셋을 실행했습니다',
        message: `${p.name} · ${placeLabel(target.ws.name, target.wt.branch, target.wt.path)}`,
        variant: 'info',
        terminalSession: { sessionId: info.id, cwd: info.cwd },
        actionLabel: '보기',
        dedupeKey: `root-preset:${info.id}`,
      });
      return json({
        ok: true,
        session_id: info.id,
        tab: info.title,
        cwd: info.cwd,
        command: p.command,
        // 에이전트 프리셋은 사용자의 계정 선택 셸 함수를 거친다 — 프리셋 바와 같다(뜨면 사용자가 고른다)
        note: agentId !== 'shell' ? '에이전트 프리셋이라 계정 선택 화면이 먼저 뜰 수 있습니다.' : undefined,
      });
    },
  );

  server.registerTool(
    'close_session',
    {
      title: '터미널 탭 닫기',
      description:
        '터미널 탭을 닫는다(세션 종료 — 그 안에서 돌던 서버·claude 도 끝난다). 루트 자신과 독 패널 셸은 닫지 않는다. ' +
        '어느 탭인지 애매하면 닫기 전에 사용자에게 묻는다.',
      inputSchema: { session_id: z.string().min(1).describe('list_terminals·list_sessions 의 id') },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ session_id }, extra) => {
      const s = listSessions().find((x) => x.id === session_id);
      if (!s) return fail(NO_SESSION);
      if (session_id === getRootSessionId()) return fail('루트 세션 자신은 닫을 수 없습니다.');
      if (excludedIds().has(session_id)) return fail('독 패널의 개인 셸은 닫지 않습니다.');
      const place = await placeOf(s.cwd, new Map());
      const blocked = await gateIfChained(
        {
          title: '탭 닫기',
          fields: [{ label: '탭', value: `${s.title} — ${placeLabel(place.workspace?.name, place.branch, s.cwd)}` }],
          danger: true,
        },
        extra.signal,
      );
      if (blocked) return fail(blocked);
      // 승인을 기다리는 사이 사용자가 직접 닫았을 수 있다
      if (!listSessions().some((x) => x.id === session_id)) return fail(NO_SESSION);
      killSession(session_id);
      sendToast({
        title: '루트가 탭을 닫았습니다',
        message: `${s.title} · ${placeLabel(place.workspace?.name, place.branch, s.cwd)}`,
        variant: 'info',
        dedupeKey: `root-close:${session_id}`,
      });
      return json({ ok: true, closed: { id: s.id, tab: s.title, cwd: s.cwd } });
    },
  );
}
