// 터미널 워크스페이스 저장 — 비밀 없음, 평문 JSON(userData/terminal-workspaces.json).
// 터미널 섹션 LNB(워크스페이스 → 워크트리 트리) 전용 목록으로,
// 프로젝트 레지스트리(projects.json)와는 의도적으로 분리한다(사용자 결정 2026-08-06).
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { TerminalWorkspace, WorkspaceSaveInput } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import { readUserJson, writeUserJson } from '../../lib/store';

const FILE = 'terminal-workspaces.json';

/** `~/` 시작이면 홈으로 치환 후 절대 경로 정규화 + 끝 슬래시 제거 */
function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return '';
  const expanded = trimmed.startsWith('~/')
    ? path.join(os.homedir(), trimmed.slice(2))
    : trimmed;
  return path.resolve(expanded).replace(/\/+$/, '');
}

/** 차트 팔레트 인덱스(1..10) 검증 — 벗어나면 undefined(이름 해시 자동 배정) */
function sanitizeColor(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10
    ? v
    : undefined;
}

/** 파일에서 읽은 행을 방어적으로 보정 — 경로 없는 행 제거, 이름·id 보정 */
function sanitize(raw: unknown): TerminalWorkspace[] {
  if (!Array.isArray(raw)) return [];
  const out: TerminalWorkspace[] = [];
  for (const row of raw as Partial<TerminalWorkspace>[]) {
    const repoPath = typeof row?.repoPath === 'string' ? row.repoPath.trim() : '';
    if (!repoPath) continue;
    out.push({
      id: typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
      name:
        typeof row.name === 'string' && row.name.trim()
          ? row.name.trim()
          : path.basename(repoPath),
      repoPath,
      color: sanitizeColor(row.color),
    });
  }
  return out;
}

function readStored(): TerminalWorkspace[] {
  const parsed = readUserJson<{ workspaces?: unknown }>(FILE, {});
  return sanitize(parsed.workspaces);
}

const writeStored = (workspaces: TerminalWorkspace[]) => {
  writeUserJson(FILE, { workspaces });
  // 여러 창(메인·MO 앱 셸)이 같은 목록을 보므로 변경을 push 로 알린다
  broadcast('workspaces:changed', workspaces);
};

// ── CRUD (IPC 용 — save/delete 는 최신 목록 반환) ──

export function listWorkspaces(): TerminalWorkspace[] {
  return readStored();
}

export function getWorkspace(id: string): TerminalWorkspace | null {
  return readStored().find((w) => w.id === id) ?? null;
}

export function saveWorkspace(input: WorkspaceSaveInput): TerminalWorkspace[] {
  const workspaces = readStored();
  const existing = input.id ? workspaces.find((w) => w.id === input.id) : undefined;

  const next: TerminalWorkspace = {
    id: existing?.id ?? crypto.randomUUID(),
    name: input.name.trim() || path.basename(normalizePath(input.repoPath)),
    repoPath: normalizePath(input.repoPath),
    // 이름만 바꾸는 저장에서 색이 사라지지 않게 — 미지정이면 기존 값 유지
    color: sanitizeColor(input.color) ?? existing?.color,
  };
  if (!next.repoPath) throw new Error('저장소 경로는 필수입니다.');
  // 같은 저장소 중복 등록 방지 — 이름만 바꾸고 싶으면 기존 항목을 수정한다
  const dup = workspaces.find(
    (w) => w.id !== next.id && normalizePath(w.repoPath) === next.repoPath
  );
  if (dup) throw new Error(`이미 등록된 저장소입니다: ${dup.name}`);

  const idx = workspaces.findIndex((w) => w.id === next.id);
  if (idx >= 0) workspaces[idx] = next;
  else workspaces.push(next);
  writeStored(workspaces);
  return workspaces;
}

export function deleteWorkspace(id: string): TerminalWorkspace[] {
  const workspaces = readStored().filter((w) => w.id !== id);
  writeStored(workspaces);
  return workspaces;
}

/** LNB 드래그 순서 반영 — ids 순서대로 재배열, 빠진 항목은 기존 순서대로 뒤에 */
export function reorderWorkspaces(ids: string[]): TerminalWorkspace[] {
  const byId = new Map(readStored().map((w) => [w.id, w]));
  const next: TerminalWorkspace[] = [];
  for (const id of ids) {
    const w = byId.get(id);
    if (w) {
      next.push(w);
      byId.delete(id);
    }
  }
  next.push(...byId.values());
  writeStored(next);
  return next;
}
