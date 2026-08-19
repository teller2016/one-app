import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// 단독 배포판 — 런타임 의존성(puppeteer 등 external 모듈)이 없어서
// One App 본체의 copyRuntimeDeps 훅이 필요 없다. React 는 렌더러 번들에 포함된다.
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // 배포 zip 안의 폴더/실행 파일 이름 — 한글은 Windows 탐색기에서 깨질 수 있어 영문 고정
    // (창 제목·UI 는 한국어)
    executableName: 'OvertimeApproval',
  },
  rebuildConfig: {},
  hooks: {
    // macOS 전용: 자가서명 인증서로 고정 서명.
    // adhoc 서명(기본)은 빌드마다 서명이 바뀌어 safeStorage 의 키체인 접근이 끊기고
    // 저장한 계정이 날아간다(One App 본체 2026-07 실사고와 동일 원인).
    // 인증서가 없는 맥에서는 서명 없이 통과한다 — 그 경우 리빌드 후 계정 재입력이 필요할 수 있다.
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform !== 'darwin') return;
      const identity = 'One App Sign';
      try {
        if (
          !execSync('security find-identity -v -p codesigning', {
            encoding: 'utf8',
          }).includes(identity)
        )
          return;
      } catch {
        return;
      }
      for (const outputPath of packageResult.outputPaths) {
        const appPath = path.join(outputPath, 'OvertimeApproval.app');
        if (!fs.existsSync(appPath)) continue;
        execSync(
          `xattr -dr com.apple.FinderInfo "${appPath}" 2>/dev/null; xattr -dr com.apple.ResourceFork "${appPath}" 2>/dev/null; true`,
          { shell: '/bin/zsh' },
        );
        execSync(`codesign --force --deep --sign "${identity}" "${appPath}"`, {
          stdio: 'inherit',
        });
         
        console.log(`[forge] "${identity}" 로 서명 완료: ${appPath}`);
      }
    },
  },
  makers: [
    // Windows 는 zip 만 만든다 (Squirrel 설치본은 macOS 에서 빌드할 수 없음 — mono/wine 필요)
    new MakerZIP({}, ['win32', 'darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
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
  ],
};

export default config;
