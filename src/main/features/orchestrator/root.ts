// 루트 탭 — 루트 폴더(지침서·mcp.json) 준비, 폴더 신뢰 처리, 루트 claude 실행 명령, ⌘P '루트 세션 열기'.
//
// 1a 는 손으로 연다(이미 떠 있으면 그 탭으로). 재부팅 복원은 하지 않는다 — 도구를 막고 띄운 claude 는
// 그 제한 없이 되살아나므로 복원 기록 자체를 남기지 않는다(terminal/resumeCommand.ts isRevivable).
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OrchestratorOpenRootResult } from '../../../shared/types';
import { shQuote } from '../../lib/util';
import { createSession, listSessions } from '../terminal';
import { ROOT_GUIDE } from './rootGuide';
import { MCP_PATH, startOrchestratorServer } from './server';
import {
  getOrCreateToken,
  getRootSessionId,
  ORCH_PORT,
  ORCH_SERVER_NAME,
  ROOT_DIR_NAME,
  ROOT_NAME,
  setRootSessionId,
} from './store';

/** 루트 claude 의 계정 — Personal. `/run-ticket`·femc-worktree 가 개인 계정 스킬이다 */
const ROOT_CONFIG_DIR = path.join(os.homedir(), '.claude');

/** 루트가 쓸 수 있는 도구 — 원앱 MCP 전부 + 읽기 + 세션 간 메시지. 이것들은 매번 묻지 않는다 */
const ALLOWED_TOOLS = [`mcp__${ORCH_SERVER_NAME}`, 'ListAgents', 'SendMessage', 'Read', 'Grep', 'Glob'];
/** 지휘만 — 편집·셸·서브에이전트(그 안에서 편집할 수 있다)는 끈다 */
const DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Agent'];

const rootDir = () => path.join(app.getPath('userData'), ROOT_DIR_NAME);

/** 루트 폴더 — 지침서는 없을 때만(사용자가 고친 것을 덮지 않는다), mcp.json 은 매번(포트·토큰을 따라간다) */
function prepareRootDir(dir: string, token: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const guide = path.join(dir, 'CLAUDE.md');
  if (!fs.existsSync(guide)) fs.writeFileSync(guide, ROOT_GUIDE);
  const mcpFile = path.join(dir, 'mcp.json');
  const config = {
    mcpServers: {
      [ORCH_SERVER_NAME]: {
        type: 'http', // ⚠️ 없으면 stdio 로 읽혀 조용히 빠진다(공식 문서)
        url: `http://127.0.0.1:${ORCH_PORT}${MCP_PATH}`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
  // 토큰이 평문으로 들어가니 본인만 읽게 — mode 는 새로 만들 때만 먹어서 chmod 를 한 번 더
  fs.writeFileSync(mcpFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(mcpFile, 0o600);
  return mcpFile;
}

type ClaudeConfig = { projects?: Record<string, Record<string, unknown>> };

/**
 * 루트 폴더를 claude 가 신뢰한 폴더로 표시한다 — 처음 여는 폴더는 권한 확인을 건너뛰어도 신뢰 창이 뜬다(2026-10-21 실측).
 * femc-worktree(`femc-wt.sh`)와 같은 방식(`projects[<경로>].hasTrustDialogAccepted`)이다.
 * ⚠️ 이 파일은 떠 있는 claude 들이 수시로 다시 쓴다 — 이미 표시돼 있으면 건드리지 않고, 읽은 뒤 파일이 바뀌었으면
 *    덮지 않고 다시 읽는다. 실패해도 신뢰 창이 한 번 뜰 뿐이라 던지지 않는다.
 */
function ensureTrusted(dir: string): void {
  const file = path.join(ROOT_CONFIG_DIR, '.claude.json');
  const key = fs.realpathSync(dir);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let before: fs.Stats;
    let data: ClaudeConfig;
    try {
      before = fs.statSync(file);
      data = JSON.parse(fs.readFileSync(file, 'utf8')) as ClaudeConfig;
    } catch {
      return; // 파일이 없거나 쓰는 도중 — 신뢰 창이 한 번 뜬다
    }
    const entry = data.projects?.[key];
    if (entry?.hasTrustDialogAccepted === true) return;
    data.projects = { ...data.projects, [key]: { ...entry, hasTrustDialogAccepted: true } };
    const tmp = `${file}.oneapp-${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: before.mode });
    const now = fs.statSync(file);
    if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) {
      fs.rmSync(tmp, { force: true }); // 그 사이 다른 claude 가 썼다 — 덮지 않고 다시
      continue;
    }
    fs.renameSync(tmp, file);
    return;
  }
}

/** 루트 claude 실행 명령 — 계정 선택 셸 함수를 건너뛰고(`command claude`) 계정을 직접 지정한다 */
function rootCommand(mcpFile: string): string {
  return [
    `CLAUDE_CONFIG_DIR=${shQuote(ROOT_CONFIG_DIR)}`,
    'command claude',
    '--name',
    shQuote(ROOT_NAME),
    '--mcp-config',
    shQuote(mcpFile),
    // 워커가 SendMessage 로 보내는 보고를 승인 대기 없이 받는다(권한 확인을 건너뛰는 워커의 메시지도)
    '--settings',
    shQuote(JSON.stringify({ crossSessionInbound: 'accept' })),
    '--allowedTools',
    ...ALLOWED_TOOLS.map(shQuote),
    // ⚠️ 목록을 받는 플래그라 맨 뒤에 둔다 — 뒤에 무엇이 오든 도구 이름으로 먹는다
    '--disallowedTools',
    ...DISALLOWED_TOOLS.map(shQuote),
  ].join(' ');
}

/** ⌘P '루트 세션 열기' — 떠 있으면 그 세션, 없으면 새로 띄운다 */
export async function openRootSession(): Promise<OrchestratorOpenRootResult> {
  const liveId = getRootSessionId();
  const live = liveId ? listSessions().find((s) => s.id === liveId) : undefined;
  if (live) return { ok: true, sessionId: live.id, cwd: live.cwd, created: false };

  const st = await startOrchestratorServer();
  if (!st.running) return { ok: false, error: st.error ?? '루트 세션 서버를 시작하지 못했습니다.' };
  let token: string | null = null;
  try {
    token = getOrCreateToken();
  } catch {
    // 아래 안내
  }
  if (!token) return { ok: false, error: '키체인에서 토큰을 읽지 못했습니다. 키체인 잠금을 풀고 다시 시도해 주세요.' };

  const dir = rootDir();
  let mcpFile: string;
  try {
    mcpFile = prepareRootDir(dir, token);
  } catch (err) {
    return { ok: false, error: `루트 폴더를 준비하지 못했습니다: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    ensureTrusted(dir);
  } catch (err) {
    console.warn('[orchestrator] 폴더 신뢰 표시 실패 — 신뢰 창이 한 번 뜬다:', err);
  }
  const info = createSession({ cwd: dir, agentId: 'claude', command: rootCommand(mcpFile), title: '루트' });
  setRootSessionId(info.id);
  return { ok: true, sessionId: info.id, cwd: info.cwd, created: true };
}
