// 채팅 입력창의 `/` 자동완성 목록 — 이 세션의 claude 가 실제로 받는 슬래시 명령을 모은다.
//   · 프로젝트: `<cwd>/.claude/skills/<이름>/SKILL.md` · `<cwd>/.claude/commands/**/*.md`
//   · 계정:     `<CLAUDE_CONFIG_DIR>/skills/…` · `<CLAUDE_CONFIG_DIR>/commands/…`
//   · 내장:     자주 쓰는 것만(아래 BUILTIN) — 전체 목록은 claude 버전마다 달라 손으로 고정하지 않는다
// 설명은 frontmatter 의 `description:` 한 줄(없으면 본문 첫 줄). 플러그인 스킬(`plugin:skill`)은 싣지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatCommand } from '../../../shared/terminal-protocol';

const BUILTIN: ChatCommand[] = [
  { name: 'clear', description: '대화를 비우고 새로 시작', source: 'builtin' },
  { name: 'compact', description: '대화를 요약해 컨텍스트를 줄인다', source: 'builtin' },
  { name: 'context', description: '컨텍스트 사용량 보기', source: 'builtin' },
  { name: 'cost', description: '이번 세션 비용·토큰', source: 'builtin' },
  { name: 'model', description: '모델 바꾸기 (⚠️ 새 세션 기본값으로 저장된다)', source: 'builtin' },
  { name: 'resume', description: '이전 대화 이어가기', source: 'builtin' },
  { name: 'memory', description: '메모리(CLAUDE.md) 편집', source: 'builtin' },
  { name: 'init', description: 'CLAUDE.md 만들기', source: 'builtin' },
  { name: 'help', description: '도움말', source: 'builtin' },
];

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; items: ChatCommand[] }>();

/** frontmatter 의 한 줄 값 — `description: …` (따옴표는 벗긴다) */
function frontValue(text: string, key: string): string | undefined {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const body = fm ? fm[1] : '';
  const m = body.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined;
}

function firstLine(text: string): string | undefined {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  return body.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean);
}

const readText = (f: string) => {
  try {
    return fs.readFileSync(f, 'utf8').slice(0, 4000); // 머리만 — 설명 한 줄이면 된다
  } catch {
    return null;
  }
};

const listDir = (d: string) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
};

function skillsIn(dir: string, source: ChatCommand['source']): ChatCommand[] {
  return listDir(dir)
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      const text = readText(path.join(dir, e.name, 'SKILL.md'));
      if (text === null) return [];
      const name = frontValue(text, 'name') ?? e.name;
      return [{ name, description: frontValue(text, 'description') ?? firstLine(text), source }];
    });
}

/** commands/**.md — 하위 폴더는 `폴더:이름` (claude 의 네임스페이스 규칙) */
function commandsIn(dir: string, source: ChatCommand['source'], prefix = ''): ChatCommand[] {
  return listDir(dir).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return commandsIn(full, source, `${prefix}${e.name}:`);
    if (!e.name.endsWith('.md')) return [];
    const text = readText(full) ?? '';
    return [{ name: prefix + e.name.slice(0, -3), description: frontValue(text, 'description') ?? firstLine(text), source }];
  });
}

/** 이 위치·계정의 슬래시 명령 — 프로젝트가 같은 이름을 가리면 프로젝트 것이 이긴다 */
export function listChatCommands(cwd: string, configDir: string): ChatCommand[] {
  const key = `${cwd}\n${configDir}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const all = [
    ...skillsIn(path.join(cwd, '.claude', 'skills'), 'project'),
    ...commandsIn(path.join(cwd, '.claude', 'commands'), 'project'),
    ...skillsIn(path.join(configDir, 'skills'), 'user'),
    ...commandsIn(path.join(configDir, 'commands'), 'user'),
    ...BUILTIN,
  ];
  const seen = new Set<string>();
  const items = all.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
  cache.set(key, { at: Date.now(), items });
  return items;
}
