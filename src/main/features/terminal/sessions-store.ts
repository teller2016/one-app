// 영속 세션 메타 sidecar — userData/terminal-sessions.json (평문 — 비밀 없음).
// tmux 세션 이름(oneapp-<id>)만으론 에이전트·프로젝트·제목을 알 수 없어서,
// 생성 시 여기 기록해 두고 앱 재시작 복원 때 tmux list-sessions 결과와 대조한다.
// 항목 제거는 tmux 세션이 실제로 죽었을 때만 — 앱 종료(detach)는 유지한다.
import type { TerminalAgentId } from '../../../shared/types';
import { readUserJson, writeUserJson } from '../../lib/store';

const FILE = 'terminal-sessions.json';

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

/** 크기만 갱신 — 리사이즈마다 불리므로 변화 없으면 쓰지 않는다 */
export function updatePersistedSize(id: string, cols: number, rows: number): void {
  const all = read();
  const meta = all[id];
  if (!meta || (meta.cols === cols && meta.rows === rows)) return;
  writeUserJson(FILE, { ...all, [id]: { ...meta, cols, rows } });
}
