// 영속 세션 메타 sidecar — userData/terminal-sessions.json (평문 — 비밀 없음).
// tmux 세션 이름(oneapp-<id>)만으론 에이전트·프로젝트·제목을 알 수 없어서,
// 생성 시 여기 기록해 두고 앱 재시작 복원 때 tmux list-sessions 결과와 대조한다.
// 항목 제거는 tmux 세션이 실제로 죽었을 때만 — 앱 종료(detach)는 유지한다.
import type { TerminalAgentId } from '../../../shared/types';
import { runtimeFile } from '../../lib/devInstance';
import { readUserJson, writeUserJson } from '../../lib/store';

// 개발 인스턴스는 별도 sidecar(terminal-sessions-dev.json) — tmux 소켓도 갈라져 있어
// 서로의 세션을 '죽은 세션'으로 오해해 목록에서 지우는 일이 없다
const FILE = runtimeFile('terminal-sessions.json');

export type PersistedSession = {
  id: string;
  title: string;
  cwd: string;
  agentId: TerminalAgentId;
  projectId?: string;
  projectName?: string;
  createdAt: number;
  cols?: number; // 마지막 PTY 크기 — 복원 attach 를 이 크기로 해 TUI 리플로우를 없앤다
  rows?: number;
};

type SessionsFile = Record<string, PersistedSession>; // key = 세션 id

const read = (): SessionsFile => readUserJson<SessionsFile>(FILE, {});

/** 저장된 영속 세션 전체 — 복원 시 tmux 생존 세션과 대조용 */
export function listPersisted(): PersistedSession[] {
  return Object.values(read());
}

export function savePersisted(meta: PersistedSession): void {
  writeUserJson(FILE, { ...read(), [meta.id]: meta });
}

export function removePersisted(id: string): void {
  pendingSizes.delete(id); // 죽은 세션의 크기를 되살려 쓰지 않는다
  const all = read();
  if (!(id in all)) return;
  delete all[id];
  writeUserJson(FILE, all);
}

/** 제목만 갱신 — 사용자가 붙인 이름은 재시작 복원 후에도 남아야 한다 */
export function updatePersistedTitle(id: string, title: string): void {
  const all = read();
  const meta = all[id];
  if (!meta || meta.title === title) return;
  writeUserJson(FILE, { ...all, [id]: { ...meta, title } });
}

// ── 크기 저장은 트레일링 디바운스 ──
// 창·패널 드래그 중 초당 수십 번 불리는데 writeUserJson 은 동기 쓰기(write+rename+stat)라
// 그대로 두면 메인 이벤트 루프(PTY flush·IPC 와 같은 루프)를 그만큼 막는다. 이 값은 복원
// attach 크기용이라 마지막 것만 남으면 충분하다.
const SIZE_SAVE_DELAY_MS = 1000;
const pendingSizes = new Map<string, { cols: number; rows: number }>();
let sizeTimer: NodeJS.Timeout | null = null;

/** 크기만 갱신 — 리사이즈마다 불리므로 모아 뒀다가 한 번에 쓴다(변화 없으면 안 쓴다) */
export function updatePersistedSize(id: string, cols: number, rows: number): void {
  pendingSizes.set(id, { cols, rows });
  if (!sizeTimer) sizeTimer = setTimeout(flushPersistedSizes, SIZE_SAVE_DELAY_MS);
}

/** 대기 중인 크기를 즉시 파일에 반영한다 — 앱 종료(disposeAll) 직전에도 부른다 */
export function flushPersistedSizes(): void {
  if (sizeTimer) {
    clearTimeout(sizeTimer);
    sizeTimer = null;
  }
  if (pendingSizes.size === 0) return;
  const all = read();
  let dirty = false;
  for (const [id, size] of pendingSizes) {
    const meta = all[id];
    if (!meta || (meta.cols === size.cols && meta.rows === size.rows)) continue;
    all[id] = { ...meta, cols: size.cols, rows: size.rows };
    dirty = true;
  }
  pendingSizes.clear();
  if (dirty) writeUserJson(FILE, all);
}
