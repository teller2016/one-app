// 루트 세션 저장 — MCP 토큰(설정, 개발·설치본 공유)과 루트 세션 id(런타임, 인스턴스별).
import crypto from 'node:crypto';
import { IS_DEV_INSTANCE, runtimeFile } from '../../lib/devInstance';
import { decryptSecret, encryptSecret, readUserJson, writeUserJson } from '../../lib/store';

const FILE = 'orchestrator.json';
/** 루트 세션 id — tmux 소켓이 인스턴스마다 다르니 런타임 파일로 가른다 */
const ROOT_FILE = runtimeFile('orchestrator-root.json');

/** MCP 서버 포트 — 개발 인스턴스와 설치본이 동시에 떠도 겹치지 않게 (보류 중인 비서 서버 18420/18421 과도 다르게) */
export const ORCH_PORT = IS_DEV_INSTANCE ? 18431 : 18430;
/** Claude Code 에 보이는 MCP 서버 이름 — 도구 이름이 `mcp__<이름>__<도구>` 가 된다 */
export const ORCH_SERVER_NAME = IS_DEV_INSTANCE ? 'oneapp-dev' : 'oneapp';
/** 루트 claude 의 세션 이름(`--name`) — 워커가 SendMessage 로 보고할 주소 */
export const ROOT_NAME = IS_DEV_INSTANCE ? 'root-dev' : 'root';
/** userData 아래 루트 폴더 — 지침서(CLAUDE.md)·mcp.json 이 여기 있다 */
export const ROOT_DIR_NAME = IS_DEV_INSTANCE ? 'root-dev' : 'root';

type Saved = { tokenEnc?: string };

let tokenCache: string | null = null;

/**
 * MCP Bearer 토큰 — 없으면 만든다(32바이트).
 * 키체인을 못 읽으면 null — 저장된 값이 있는데 지금 못 읽는 것이라 **새로 발급하지 않는다**(main-process 규칙).
 * ⚠️ 기동 경로에서 부르지 말 것 — 서버 시작은 whenSecretsReady() 뒤다(ipc.ts).
 */
export function getOrCreateToken(): string | null {
  if (tokenCache) return tokenCache;
  const saved = readUserJson<Saved>(FILE, {});
  if (saved.tokenEnc) {
    tokenCache = decryptSecret(saved.tokenEnc);
    return tokenCache;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  writeUserJson(FILE, { ...saved, tokenEnc: encryptSecret(token) }); // 키체인을 못 쓰면 던진다
  tokenCache = token;
  return token;
}

let rootIdCache: string | null | undefined;

export function getRootSessionId(): string | null {
  if (rootIdCache === undefined) rootIdCache = readUserJson<{ sessionId?: string }>(ROOT_FILE, {}).sessionId ?? null;
  return rootIdCache;
}

export function setRootSessionId(id: string): void {
  rootIdCache = id;
  writeUserJson(ROOT_FILE, { sessionId: id });
}
