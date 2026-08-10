import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Vite 플러그인은 external 로 둔 모듈을 패키지에서 제외한다(electron/forge#3738).
// 런타임에 require 하는 프로덕션 의존성(node-pty·ws 등) 전체를 패키지 node_modules 로 복사한다.
// npm ls --omit=dev 로 계산하므로 devDependency(puppeteer 등)는 자동으로 빠진다.
// npm 이 계산한 실제 트리(호이스팅·중첩 포함)를 그대로 복사하므로 누락이 없다.
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
    // node-pty 는 asar 밖에서 실행돼야 한다 — spawn-helper(확장자 없는 실행파일)는
    // AutoUnpackNatives 의 *.node 글롭에 안 걸리므로 패키지 통째로 unpack.
    asar: { unpack: '**/node_modules/node-pty/**' },
    icon: './assets/icon', // 확장자 없이 — 플랫폼별로 .icns/.ico 자동 선택
  },
  rebuildConfig: {},
  hooks: {
    // asar 로 묶기 전에, Vite 가 제외한 런타임 모듈(node-pty·ws)을 채워 넣는다
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const count = copyRuntimeDeps(buildPath);
      // eslint-disable-next-line no-console
      console.log(`[forge] 런타임 의존성 ${count}개 패키지에 포함`);
    },
    // 자가서명 인증서로 고정 서명 — adhoc 서명은 빌드마다 바뀌어 safeStorage 의
    // 키체인 접근이 끊기고, 폴백 저장으로 암호화 설정이 날아간다(2026-07 실사고).
    // packagerConfig.osxSign 은 서명 실패(FinderInfo 등 detritus)를 경고로만 삼켜
    // adhoc 산출물이 조용히 나오므로, 여기서 속성 정리 후 직접 서명하고 실패 시 빌드를 멈춘다.
    // 인증서가 없는 Mac 에서는 서명 없이 통과(기존 동작 유지).
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform !== 'darwin') return;
      const identity = 'One App Sign';
      try {
        if (!execSync('security find-identity -v -p codesigning', { encoding: 'utf8' }).includes(identity)) return;
      } catch {
        return;
      }
      for (const outputPath of packageResult.outputPaths) {
        const appPath = path.join(outputPath, 'One App.app');
        if (!fs.existsSync(appPath)) continue;
        // asar.unpacked 의 네이티브 바이너리(pty.node·spawn-helper)는 .app 서명 **전에**
        // 같은 identity 로 서명한다 — 앱 서명 뒤에 하면 리소스 seal 이 깨진다.
        // ⚠️ Mach-O 만 서명할 것: node-pty 에 함께 담긴 win32 prebuild(PE)를 서명하면
        // codesign 이 서명을 com.apple.cs.* 확장 속성으로 붙이고, 그게 detritus 로 잡혀
        // 뒤따르는 앱 --deep 서명이 실패한다.
        const unpackedPty = path.join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty');
        if (fs.existsSync(unpackedPty)) {
          execSync(
            `find "${unpackedPty}" -type f \\( -name '*.node' -o -name 'spawn-helper' \\) ` +
            `-exec sh -c 'file -b "$1" | grep -q Mach-O || exit 0; ` +
            `chmod +x "$1"; codesign --force --sign "${identity}" "$1"' _ {} \\;`,
            { stdio: 'inherit' }
          );
        }
        // 확장 속성 정리는 앱 서명 직전에 — 위 개별 서명이 남긴 속성까지 함께 걷어낸다
        execSync(`xattr -cr "${appPath}" 2>/dev/null; true`, { shell: '/bin/zsh' });
        execSync(`codesign --force --deep --sign "${identity}" "${appPath}"`, { stdio: 'inherit' });
        // eslint-disable-next-line no-console
        console.log(`[forge] "${identity}" 로 서명 완료: ${appPath}`);
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    // 네이티브 모듈(*.node)을 asar 밖으로 — packagerConfig.asar.unpack 과 {a,b} 글롭으로 병합된다
    new AutoUnpackNativesPlugin({}),
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
        {
          // MO 터미널 페이지(`/terminal/`) — main 의 HTTP 서버가 정적 서빙 (창으로 안 띄움)
          name: 'mobile_window',
          config: 'vite.mobile.config.ts',
        },
        {
          // MO 앱 셸(`/`) — 데스크톱 기능 화면을 폰에서 재사용 (창으로 안 띄움)
          name: 'mobile_app_window',
          config: 'vite.mobile-app.config.ts',
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
