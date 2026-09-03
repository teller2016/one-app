// 터미널 워크스페이스·프리셋 저장 — 비밀 없음, 평문 JSON(userData/terminal-workspaces.json).
// 터미널 섹션 LNB(워크스페이스 → 워크트리 트리) 전용 목록으로,
// 프로젝트 레지스트리(projects.json)와는 의도적으로 분리한다(사용자 결정 2026-08-06).
// 프리셋은 Superset 의 terminal_presets 와 같은 모델(전역 목록 + workspaceIds 스코프).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  TerminalPreset,
  TerminalWorkspace,
  WorkspaceSaveInput,
} from '../../../shared/types';
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

/** 존재하는 디렉터리인가 — 없거나 파일이면 false */
function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
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

/** 프리셋 행 보정 — 이름·명령 없는 행 제거, 스코프·노출 필드 검증 */
function sanitizePresets(raw: unknown): TerminalPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: TerminalPreset[] = [];
  for (const row of raw as Partial<TerminalPreset>[]) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    const command = typeof row?.command === 'string' ? row.command.trim() : '';
    if (!name || !command) continue;
    out.push({
      id: typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
      name,
      command,
      workspaceIds: Array.isArray(row.workspaceIds)
        ? row.workspaceIds.filter((v): v is string => typeof v === 'string')
        : undefined,
      pinned: typeof row.pinned === 'boolean' ? row.pinned : undefined,
    });
  }
  return out;
}

// 한 파일에 두 목록 — 어느 한쪽을 쓸 때 다른 쪽이 지워지지 않게 항상 함께 읽어 쓴다
function readFile(): { workspaces: TerminalWorkspace[]; presets: TerminalPreset[] } {
  const parsed = readUserJson<{ workspaces?: unknown; presets?: unknown }>(FILE, {});
  return {
    workspaces: sanitize(parsed.workspaces),
    presets: sanitizePresets(parsed.presets),
  };
}

function readStored(): TerminalWorkspace[] {
  return readFile().workspaces;
}

const writeStored = (workspaces: TerminalWorkspace[]) => {
  writeUserJson(FILE, { workspaces, presets: readFile().presets });
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
  if (!next.repoPath) throw new Error('폴더 경로는 필수입니다.');
  // 실제 존재하는 폴더만 — LNB 에 죽은 항목이 쌓이는 것을 막는다. git 저장소 여부는
  // 가리지 않는다(일반 폴더도 워크스페이스 — 조회 때 git.ts 가 단일 항목으로 합성한다)
  if (!isDirectory(next.repoPath)) {
    throw new Error('폴더가 없습니다 — 존재하는 폴더를 선택하세요.');
  }
  // 같은 폴더 중복 등록 방지 — 이름만 바꾸고 싶으면 기존 항목을 수정한다
  const dup = workspaces.find(
    (w) => w.id !== next.id && normalizePath(w.repoPath) === next.repoPath
  );
  if (dup) throw new Error(`이미 등록된 폴더입니다: ${dup.name}`);

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

// ── 프리셋 CRUD — 편집 모달이 전체 목록을 통째로 저장한다 ──

export function listPresets(): TerminalPreset[] {
  return readFile().presets;
}

export function savePresets(presets: TerminalPreset[]): TerminalPreset[] {
  const next = sanitizePresets(presets);
  writeUserJson(FILE, { workspaces: readStored(), presets: next });
  broadcast('workspaces:presets-changed', next);
  return next;
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
