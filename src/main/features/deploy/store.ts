// 배포 프로젝트 저장 — 젠킨스 API 토큰/비밀번호는 safeStorage 로 암호화해 저장
import crypto from 'node:crypto';
import type {
  DeployProjectView,
  DeployTarget,
  SaveDeployProjectInput,
} from '../../../shared/types';
import {
  readUserJson,
  writeUserJson,
  encryptSecret,
  decryptSecret,
} from '../../lib/store';

interface StoredDeployProject {
  id: string;
  name: string;
  jenkinsUrl: string;
  username: string;
  secretEnc?: string; // safeStorage 로 암호화된 API 토큰/비밀번호(base64)
  production?: boolean; // 운영(PROD) 프로젝트 — 배포 시 강한 확인
  targets: DeployTarget[];
}

function readStored(): StoredDeployProject[] {
  const parsed = readUserJson<{ projects?: StoredDeployProject[] }>(
    'deploy.json',
    {},
  );
  return Array.isArray(parsed.projects) ? parsed.projects : [];
}

const writeStored = (projects: StoredDeployProject[]) =>
  writeUserJson('deploy.json', { projects });

/** 렌더러에 보낼 안전한 형태 — 토큰/비밀번호 값은 보내지 않고 "설정됨" 여부만 */
const toView = (p: StoredDeployProject): DeployProjectView => ({
  id: p.id,
  name: p.name,
  jenkinsUrl: p.jenkinsUrl,
  username: p.username,
  hasSecret: !!p.secretEnc,
  production: !!p.production,
  targets: p.targets,
});

export function listProjects(): DeployProjectView[] {
  return readStored().map(toView);
}

export function saveProject(
  input: SaveDeployProjectInput,
): DeployProjectView[] {
  const projects = readStored();
  const existing = input.id
    ? projects.find((p) => p.id === input.id)
    : undefined;

  const next: StoredDeployProject = {
    id: existing?.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    jenkinsUrl: input.jenkinsUrl.trim().replace(/\/+$/, ''), // 끝 슬래시 제거
    username: input.username.trim(),
    secretEnc: existing?.secretEnc,
    production: !!input.production,
    targets: input.targets
      .map((t) => ({
        id: t.id ?? crypto.randomUUID(),
        name: t.name.trim(),
        jobPath: t.jobPath.trim(),
      }))
      .filter((t) => t.name && t.jobPath),
  };

  // 토큰/비밀번호는 입력이 있을 때만 갱신 (빈 값이면 기존 유지)
  if (input.secret && input.secret.length > 0) {
    next.secretEnc = encryptSecret(input.secret);
  }

  const idx = projects.findIndex((p) => p.id === next.id);
  if (idx >= 0) projects[idx] = next;
  else projects.push(next);
  writeStored(projects);
  return listProjects();
}

export function deleteProject(id: string): DeployProjectView[] {
  writeStored(readStored().filter((p) => p.id !== id));
  return listProjects();
}

/** 젠킨스 호출용 자격증명 복호화. 계정 미설정이면 null */
export function getProjectCredentials(projectId: string): {
  jenkinsUrl: string;
  username: string;
  secret: string;
  targets: DeployTarget[];
} | null {
  const p = readStored().find((x) => x.id === projectId);
  if (!p || !p.username || !p.secretEnc) return null;
  const secret = decryptSecret(p.secretEnc);
  if (secret == null) return null;
  return {
    jenkinsUrl: p.jenkinsUrl,
    username: p.username,
    secret,
    targets: p.targets,
  };
}
