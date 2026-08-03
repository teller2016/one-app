// 프로젝트 레지스트리 저장 — 비밀 없음, 평문 JSON(userData/projects.json).
// 배포·PR·Nightwatch 등 다른 기능이 조회 헬퍼로 참조하는 중앙 관리 지점.
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Project, SaveProjectInput } from '../../../shared/types';
import { PROJECT_REMOTE_KINDS, ownerRepoFromUrl } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import { readUserJson, writeUserJson } from '../../lib/store';

/** `~/` 시작이면 홈으로 치환 후 절대 경로 정규화 + 끝 슬래시 제거 */
function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return '';
  const expanded = trimmed.startsWith('~/')
    ? path.join(os.homedir(), trimmed.slice(2))
    : trimmed;
  return path.resolve(expanded).replace(/\/+$/, '');
}

/** 파일에서 읽은 행을 방어적으로 보정 — 경로 없는 행 제거, 이름·id 보정 */
function sanitize(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  const out: Project[] = [];
  for (const row of raw as Partial<Project>[]) {
    const localPath = typeof row?.localPath === 'string' ? row.localPath.trim() : '';
    if (!localPath) continue;
    out.push({
      id: typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
      name:
        typeof row.name === 'string' && row.name.trim()
          ? row.name.trim()
          : path.basename(localPath),
      localPath,
      remoteKind: PROJECT_REMOTE_KINDS.includes(row.remoteKind as never)
        ? (row.remoteKind as Project['remoteKind'])
        : 'gitea',
      remoteUrl: typeof row.remoteUrl === 'string' ? row.remoteUrl.trim() : '',
      defaultBranch:
        typeof row.defaultBranch === 'string' ? row.defaultBranch.trim() : '',
      jiraProjectKey:
        typeof row.jiraProjectKey === 'string'
          ? row.jiraProjectKey.trim().toUpperCase()
          : '',
    });
  }
  return out;
}

function readStored(): Project[] {
  const parsed = readUserJson<{ projects?: unknown }>('projects.json', {});
  return sanitize(parsed.projects);
}

const writeStored = (projects: Project[]) => {
  writeUserJson('projects.json', { projects });
  // 소비 기능(배포·PR 등)이 목록 캐시를 실시간 갱신하는 통로
  broadcast('projects:changed', projects);
};

// ── CRUD (IPC 용 — save/delete 는 최신 목록 반환) ──

export function listProjects(): Project[] {
  return readStored();
}

export function saveProject(input: SaveProjectInput): Project[] {
  const projects = readStored();
  const existing = input.id ? projects.find((p) => p.id === input.id) : undefined;

  const next: Project = {
    id: existing?.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    localPath: normalizePath(input.localPath),
    remoteKind: PROJECT_REMOTE_KINDS.includes(input.remoteKind as never)
      ? (input.remoteKind as Project['remoteKind'])
      : 'gitea',
    remoteUrl: (input.remoteUrl ?? '').trim().replace(/\/+$/, ''),
    defaultBranch: (input.defaultBranch ?? '').trim(),
    jiraProjectKey: (input.jiraProjectKey ?? '').trim().toUpperCase(),
  };
  if (!next.name || !next.localPath) {
    throw new Error('프로젝트 이름과 로컬 경로는 필수입니다.');
  }

  const idx = projects.findIndex((p) => p.id === next.id);
  if (idx >= 0) projects[idx] = next;
  else projects.push(next);
  writeStored(projects);
  return projects;
}

export function deleteProject(id: string): Project[] {
  const projects = readStored().filter((p) => p.id !== id);
  writeStored(projects);
  return projects;
}

// ── 소비(조회) API — 다른 feature 가 main 에서 직접 import ──

/** id 로 조회 — 없으면 null */
export function getProject(id: string): Project | null {
  return readStored().find((p) => p.id === id) ?? null;
}

/** 로컬 경로로 조회 — 정규화 후 정확 일치. 없으면 null */
export function findProjectByPath(fsPath: string): Project | null {
  const target = normalizePath(fsPath);
  if (!target) return null;
  return readStored().find((p) => normalizePath(p.localPath) === target) ?? null;
}

/** 원격 주소의 "owner/repo" 로 조회 — 없으면 null */
export function findProjectByRepo(ownerRepo: string): Project | null {
  const target = ownerRepo.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!target) return null;
  return (
    readStored().find((p) => remoteOwnerRepo(p)?.toLowerCase() === target) ?? null
  );
}

/** Jira 프로젝트 키로 조회 — 한 키에 여러 저장소(store/admin/api) 매핑 가능해 배열 */
export function findProjectsByJiraKey(key: string): Project[] {
  const target = key.trim().toUpperCase();
  if (!target) return [];
  return readStored().filter((p) => p.jiraProjectKey === target);
}

/** 원격 주소에서 "owner/repo" 추출 (https·ssh 모두) — 실패 시 null. 파싱은 shared 의 ownerRepoFromUrl 위임 */
export function remoteOwnerRepo(p: Project): string | null {
  return ownerRepoFromUrl(p.remoteUrl);
}
