import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Vite 플러그인은 external 로 둔 모듈을 패키지에서 제외한다(electron/forge#3738).
// 런타임에 require 하는 puppeteer 등 프로덕션 의존성 전체를 패키지 node_modules 로 복사한다.
// npm 이 계산한 실제 트리(호이스팅·중첩 포함)를 그대로 복사하므로 누락이 없다.
// (Chromium 은 동봉하지 않고 시스템 Chrome 을 쓰므로 용량은 작다.)
function copyRuntimeDeps(buildPath: string): number {
  const projectRoot = process.cwd();
  let out = '';
  try {
    out = execSync('npm ls --omit=dev --all --parseable', {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // npm ls 는 peer/extraneous 경고로 비정상 종료할 수 있으나 stdout 은 유효
    out = String((err as { stdout?: Buffer | string }).stdout ?? '');
  }

  const sep = path.sep;
  const paths = out
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p.includes(`${sep}node_modules${sep}`));

  let count = 0;
  for (const abs of paths) {
    if (!fs.existsSync(abs)) continue;
    const rel = path.relative(projectRoot, abs); // 예: node_modules/cosmiconfig/node_modules/parse-json
    const dest = path.join(buildPath, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // 각 패키지를 실제 위치 그대로 복사(중첩분은 각자 라인으로도 복사됨 — 동일 내용이라 무해)
    fs.cpSync(abs, dest, { recursive: true });
    count++;
  }
  return count;
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: './assets/icon', // 확장자 없이 — 플랫폼별로 .icns/.ico 자동 선택
  },
  rebuildConfig: {},
  hooks: {
    // asar 로 묶기 전에, Vite 가 제외한 런타임 모듈(puppeteer 등)을 채워 넣는다
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const count = copyRuntimeDeps(buildPath);
      // eslint-disable-next-line no-console
      console.log(`[forge] 런타임 의존성 ${count}개 패키지에 포함 (puppeteer 등)`);
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
