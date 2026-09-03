// lite 에 실리는 파일 집합의 불변식 — 루트 `npm test`(vitest) 가 돌린다.
//
// ⚠️ 본체 파일에서 외부 패키지를 import 하면 TS·Vite 모두 루트 node_modules 를 따라 올라가
// 해석하므로, lite package.json 에 없는 패키지가 **아무 경고 없이** lite 번들에 들어간다
// (순수 JS 면 조용히 비대해지고 node-pty 같은 네이티브면 빌드가 깨진다). 여기서 막는다.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectReach, LITE_ROOT, REPO_ROOT } from './lib/reach.mjs';

/** lite 가 값으로 import 해도 되는 외부 패키지 — lite package.json 의 dependencies + electron + node 내장 */
const ALLOWED_BARE = new Set(['electron', 'react', 'react-dom', 'node:*']);

const reach = collectReach();

describe('lite 도달 그래프', () => {
  it('모든 import 가 해석된다 (alias·상대·scss)', () => {
    expect(reach.unresolved).toEqual([]);
  });

  it('본체 파일에 실제로 닿는다 (그래프가 비어 있으면 워커가 깨진 것)', () => {
    expect(reach.bodyFiles.length).toBeGreaterThan(50);
    expect(reach.bodyFiles).toContain('src/main/features/approval/ipc.ts');
    expect(reach.bodyFiles).toContain('src/renderer/features/approval/components/ApprovalSection.tsx');
    expect(reach.bodyFiles).toContain('src/renderer/styles/_base.scss');
  });

  it('값으로 import 하는 외부 패키지가 허용 목록 밖으로 새지 않는다', () => {
    const leaked = Object.entries(reach.bare).filter(([pkg]) => !ALLOWED_BARE.has(pkg));
    const detail = leaked.map(([pkg, files]) => `${pkg} ← ${files.join(', ')}`).join('\n');
    expect(leaked, `lite package.json 에 없는 패키지가 번들에 들어갑니다:\n${detail}`).toEqual([]);
  });

  it('데스크톱 전용 기능(터미널·MO·워크스페이스)에 닿지 않는다', () => {
    const forbidden = reach.bodyFiles.filter((f) =>
      /^src\/(mobile|mobile-app)\/|^src\/(main|renderer)\/features\/(terminal|workspaces|mirror|vpn|mail|attendance|deploy|prs|nightwatch|weekly|schedule|changes)\//.test(
        f,
      ),
    );
    expect(forbidden).toEqual([]);
  });
});

describe('lite package.json 이 본체와 같은 버전을 쓴다', () => {
  // React 가 갈리면 vite dedupe 가 lite 것으로 모으므로 "본체 타입 vs lite 런타임" 이 어긋난다.
  // Electron·Vite·TypeScript 도 같은 이유로 맞춘다. 양쪽 모두에 있는 패키지는 지정 범위가 같아야 한다.
  const read = (dir: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  const flat = (p: ReturnType<typeof read>) => ({ ...p.dependencies, ...p.devDependencies });
  const root = flat(read(REPO_ROOT));
  const lite = flat(read(LITE_ROOT));

  it('공통 패키지의 버전 지정이 일치한다', () => {
    const mismatch = Object.keys(lite)
      .filter((k) => k in root && root[k] !== lite[k])
      .map((k) => `${k}: 본체 ${root[k]} ≠ lite ${lite[k]}`);
    expect(mismatch).toEqual([]);
  });

  it('lite 의 런타임 의존은 react·react-dom 뿐이다 (그 외는 번들에 안 들어가거나 external 이 필요하다)', () => {
    expect(Object.keys(read(LITE_ROOT).dependencies ?? {}).sort()).toEqual(['react', 'react-dom']);
  });
});
