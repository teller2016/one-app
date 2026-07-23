// PR 탭 설정 저장 — 비밀 정보가 없어 평문 JSON(userData/prs.json).
// excludedOrgs: 목록·알림에서 제외할 조직(owner), repos: 빠른 PR 즐겨찾기 저장소.
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
    repos: cleanList(parsed.repos),
  };
}

export function savePrsConfig(config: PrsConfig): PrsConfig {
  const clean: PrsConfig = {
    excludedOrgs: cleanList(config?.excludedOrgs),
    repos: cleanList(config?.repos).map((r) => r.trim().replace(/^\/+|\/+$/g, '')),
  };
  writeUserJson('prs.json', clean);
  return clean;
}
