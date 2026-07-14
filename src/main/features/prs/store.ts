// PR 탭 설정 저장 — 비밀 정보가 없어 평문 JSON(userData/prs.json).
// excludedOrgs: 목록·알림에서 제외할 조직(owner), repos: 빠른 PR 즐겨찾기 저장소.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { PrsConfig } from '../../../shared/types';

const filePath = () => path.join(app.getPath('userData'), 'prs.json');

const cleanList = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((s): s is string => typeof s === 'string' && !!s))]
    : [];

export function getPrsConfig(): PrsConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as Partial<PrsConfig>;
    return {
      excludedOrgs: cleanList(parsed.excludedOrgs),
      repos: cleanList(parsed.repos),
    };
  } catch {
    return { excludedOrgs: [], repos: [] };
  }
}

export function savePrsConfig(config: PrsConfig): PrsConfig {
  const clean: PrsConfig = {
    excludedOrgs: cleanList(config?.excludedOrgs),
    repos: cleanList(config?.repos).map((r) => r.trim().replace(/^\/+|\/+$/g, '')),
  };
  fs.writeFileSync(filePath(), JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}
