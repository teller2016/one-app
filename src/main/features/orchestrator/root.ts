// 루트 탭 — 루트 폴더(지침서·mcp.json) 준비, 폴더 신뢰 처리, 루트 claude 실행 명령, 열기(⌘P·⌘0·LNB·자동 시작).
//
// 열 때마다 **지난 대화를 이어서**(`--resume <대화 id>`, 같은 도구 제한·MCP 플래그) 띄운다(1b-2 사용자 결정).
// 일반 재부팅 복원(terminal/resume.ts)은 플래그를 잇지 못해 도구 제한이 풀린 claude 로 살아나므로 루트는 거기서 빠지고
// (resumeCommand.ts isRevivable), 대신 rootLife.ts 가 앱 시작 때 이 함수로 다시 띄운다.
// claude 가 끝나면 종료 코드를 루트 폴더의 `.exit` 에 적고 탭을 닫는다 — 0 이면 사용자가 끈 것, 아니면 비정상 종료(rootLife.ts).
import { app } from 'electron';
import crypto from 'node:crypto';
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
  getRootConversation,
  getRootSessionId,
  ORCH_PORT,
  ORCH_SERVER_NAME,
  ROOT_DIR_NAME,
  ROOT_NAME,
  setRootOff,
  setRootSessionId,
} from './store';

/** 루트 claude 의 계정 — Personal. `/run-ticket`·femc-worktree 가 개인 계정 스킬이다 */
const ROOT_CONFIG_DIR = path.join(os.homedir(), '.claude');

/** 루트가 쓸 수 있는 도구 — 원앱 MCP 전부 + 읽기 + 세션 간 메시지. 이것들은 매번 묻지 않는다 */
const ALLOWED_TOOLS = [`mcp__${ORCH_SERVER_NAME}`, 'ListAgents', 'SendMessage', 'Read', 'Grep', 'Glob'];
/** 지휘만 — 편집·셸·서브에이전트(그 안에서 편집할 수 있다)는 끈다 */
const DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Agent'];

const rootDir = () => path.join(app.getPath('userData'), ROOT_DIR_NAME);

/** claude 가 끝날 때 종료 코드를 적는 파일 — 띄우기 직전에 지운다 */
export const rootExitFile = () => path.join(rootDir(), '.exit');

/** 지난번 루트 claude 의 종료 코드 — 없으면(아직 안 끝남·탭을 닫음·재부팅) null */
export function readRootExit(): string | null {
  try {
    return fs.readFileSync(rootExitFile(), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** 이어 띄울 대화가 아직 있는가 — 없는 id 로 --resume 하면 claude 가 곧바로 비정상 종료해 재시작 고리에 빠진다 */
function conversationExists(id: string): boolean {
  const projects = path.join(ROOT_CONFIG_DIR, 'projects');
  try {
    return fs.readdirSync(projects).some((d) => fs.existsSync(path.join(projects, d, `${id}.jsonl`)));
  } catch {
    return false;
  }
}

/** mcp.json 의 서버별 도구 호출 상한 — 승인 창 대기(3분)보다 길게 */
const MCP_CALL_TIMEOUT_MS = 10 * 60_000;

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * 지침서(CLAUDE.md) — 없으면 기본본을 쓰고, 있으면 **우리가 마지막으로 쓴 기본본 그대로일 때만** 새 기본본으로 바꾼다.
 * 사용자가 한 글자라도 고쳤으면(해시가 다르면) 그대로 둔다 — 기본본이 바뀌어도(도구 추가 등) 손대지 않은 폴더는 따라온다.
 * 마지막으로 쓴 기본본의 해시는 그 폴더의 `.guide-default.sha256`(dev·설치본 폴더가 각자).
 */
function syncGuide(dir: string): void {
  const guide = path.join(dir, 'CLAUDE.md');
  const stamp = path.join(dir, '.guide-default.sha256');
  const next = sha256(ROOT_GUIDE);
  let current: string | null = null;
  try {
    current = fs.readFileSync(guide, 'utf8');
  } catch {
    // 아직 없다 — 아래에서 쓴다
  }
  if (current !== null) {
    const cur = sha256(current);
    let last: string | null = null;
    try {
      last = fs.readFileSync(stamp, 'utf8').trim();
    } catch {
      // 기록 전 — 해시를 모르면 사용자가 고친 것으로 본다
    }
    if (cur === next) {
      if (last !== next) fs.writeFileSync(stamp, `${next}\n`);
      return;
    }
    if (cur !== last) return; // 사용자가 고쳤다 — 그대로 둔다
  }
  fs.writeFileSync(guide, ROOT_GUIDE);
  fs.writeFileSync(stamp, `${next}\n`);
}

/** 루트 폴더 — 지침서는 syncGuide(사용자가 고친 것은 덮지 않는다), mcp.json 은 매번(포트·토큰을 따라간다) */
function prepareRootDir(dir: string, token: string): string {
  fs.mkdirSync(dir, { recursive: true });
  syncGuide(dir);
  const mcpFile = path.join(dir, 'mcp.json');
  const config = {
    mcpServers: {
      [ORCH_SERVER_NAME]: {
        type: 'http', // ⚠️ 없으면 stdio 로 읽혀 조용히 빠진다(공식 문서)
        url: `http://127.0.0.1:${ORCH_PORT}${MCP_PATH}`,
        // 도구 호출 하나의 상한(ms) — 기본으론 HTTP 호출이 60초 안에 첫 바이트를 받아야 한다(공식 문서 mcp.md).
        // 무인 연쇄 가드의 승인 창이 최대 3분 기다리므로 넉넉히 올린다(approve.ts CONFIRM_TIMEOUT_MS)
        timeout: MCP_CALL_TIMEOUT_MS,
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

/**
 * 루트 claude 실행 명령 — 계정 선택 셸 함수를 건너뛰고(`command claude`) 계정을 직접 지정한다.
 * 끝나면 종료 코드를 `.exit` 에 적고 셸을 남기지 않는다(`exit` — 래퍼의 `exec <셸>` 까지 가지 않는다).
 */
function rootCommand(mcpFile: string, resumeId: string | null): string {
  const claude = [
    `CLAUDE_CONFIG_DIR=${shQuote(ROOT_CONFIG_DIR)}`,
    'command claude',
    '--name',
    shQuote(ROOT_NAME),
    ...(resumeId ? ['--resume', shQuote(resumeId)] : []),
    '--mcp-config',
    shQuote(mcpFile),
    // 루트에는 원앱 MCP 만 — 사용자 설정·프로젝트의 다른 MCP 서버(DB·브라우저 등)를 싣지 않는다
    '--strict-mcp-config',
    // 사용자 설정의 기본 권한 모드(auto 등)를 따르지 않는다 — 허용 목록 밖의 도구는 늘 묻게(choices 의 'manual' = 묻기, 2.1.307 --help)
    '--permission-mode',
    'manual',
    // 워커가 SendMessage 로 보내는 보고를 승인 대기 없이 받는다(권한 확인을 건너뛰는 워커의 메시지도)
    '--settings',
    shQuote(JSON.stringify({ crossSessionInbound: 'accept' })),
    '--allowedTools',
    ...ALLOWED_TOOLS.map(shQuote),
    // ⚠️ 목록을 받는 플래그라 맨 뒤에 둔다 — 뒤에 무엇이 오든 도구 이름으로 먹는다
    '--disallowedTools',
    ...DISALLOWED_TOOLS.map(shQuote),
  ].join(' ');
  return `${claude}; echo $? > ${shQuote(rootExitFile())}; exit`;
}

/** 루트 열기(⌘P·⌘0·LNB·자동 시작·비정상 종료 뒤) — 떠 있으면 그 세션, 없으면 지난 대화를 이어 띄운다 */
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
  const last = getRootConversation();
  const resumeId = last && conversationExists(last) ? last : null;
  fs.rmSync(rootExitFile(), { force: true }); // 지난 종료 코드 — 이번 실행의 것과 섞이지 않게
  const info = createSession({ cwd: dir, agentId: 'claude', command: rootCommand(mcpFile, resumeId), title: '루트' });
  setRootSessionId(info.id);
  setRootOff(false); // 다시 켰다 — 앱 시작 때 자동으로 띄우는 상태로
  return { ok: true, sessionId: info.id, cwd: info.cwd, created: true };
}
