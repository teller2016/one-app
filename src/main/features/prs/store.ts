// PR 탭 설정 저장 — 비밀 정보가 없어 평문 JSON(userData/prs.json).
// excludedOrgs: 목록에서 제외할 조직(owner). 빠른 PR 저장소는 프로젝트 레지스트리에서 파생.
import type { PrsConfig } from '../../../shared/types';
import { readUserJson, writeUserJson } from '../../lib/store';

const cleanList = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((s): s is string => typeof s === 'string' && !!s))]
    : [];

export function getPrsConfig(): PrsConfig {
  const parsed = readUserJson<Partial<PrsConfig>>('prs.json', {});
  return {
    excludedOrgs: cleanList(parsed.excludedOrgs),
  };
}

export function savePrsConfig(config: PrsConfig): PrsConfig {
  const clean: PrsConfig = {
    excludedOrgs: cleanList(config?.excludedOrgs),
  };
  writeUserJson('prs.json', clean);
  return clean;
}
