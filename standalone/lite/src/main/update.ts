// 새 버전 확인 + 자동 설치 IPC — 배포 리포의 GitHub Releases 를 본다.
//
// - `update:check`  최신 릴리스 태그를 현재 버전과 비교하고, 이 PC 용 zip 과 설치 가능 여부를 함께 준다
// - `update:install`  마지막 확인 결과의 zip 을 받아 교체한다(`updateInstall.ts`) — 성공하면 앱이 곧 종료·재시작
// - `update:open-folder`  자동 교체가 안 될 때 받아 풀어둔 폴더를 열어준다(반자동 폴백)
//
// ⚠️ 확인 실패는 오류로 만들지 않는다 — 사내망에서 GitHub 이 막혀 있어도 앱은 그대로 돌아야 한다.
import { app, ipcMain, shell } from 'electron';
import { fetchWithTimeout } from '@one/main/lib/http';
import type { UpdateInfo, UpdateInstallResult } from '../shared/update';
import { compareVersion, pickAsset } from './updateCore';
import { installUpdate, isStageFolder, resolveInstallTarget } from './updateInstall';

/** ⚠️ 바꾸면 `scripts/release.mjs` 의 REPO 도 함께 바꿀 것 (배포하는 곳과 보는 곳이 같아야 한다) */
const REPO = 'teller2016/one-app-lite';

const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

/**
 * 테스트 훅 — 이 태그를 "새 버전" 으로 취급한다(버전 비교 무시).
 * 패키징한 앱으로 교체 흐름을 실제로 돌려볼 때 쓴다:
 *   ONE_APP_LITE_FORCE_UPDATE_TAG=v2.0.0 out/OneAppLite-darwin-arm64/OneAppLite.app/Contents/MacOS/OneAppLite
 * 배포된 앱은 환경변수 없이 뜨므로 영향이 없다.
 */
const FORCE_TAG = process.env.ONE_APP_LITE_FORCE_UPDATE_TAG;
const API_URL = FORCE_TAG
  ? `https://api.github.com/repos/${REPO}/releases/tags/${FORCE_TAG}`
  : `https://api.github.com/repos/${REPO}/releases/latest`;

/** 시작할 때 한 번 부르는 부가 기능이라 짧게 끊는다 (본체 기본 15초보다 짧게) */
const TIMEOUT_MS = 8_000;

/** 마지막 확인 결과 — `update:install` 은 렌더러가 준 URL 이 아니라 이것을 쓴다 */
let lastInfo: UpdateInfo | null = null;

export async function checkUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  const fail = (error: string): UpdateInfo => ({
    ok: false,
    current,
    url: RELEASES_URL,
    error,
  });

  try {
    const res = await fetchWithTimeout(
      API_URL,
      {
        // GitHub API 는 User-Agent 가 없으면 403 을 준다
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OneAppLite' },
      },
      TIMEOUT_MS,
    );
    // 릴리스가 아직 하나도 없으면 404 — 오류라기보다 '비교할 것이 없음'이다
    if (res.status === 404) return fail('아직 배포된 버전이 없습니다.');
    if (!res.ok) return fail(`GitHub 응답 오류 (${res.status})`);

    const json = (await res.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
      assets?: unknown;
    };
    // 태그는 `v2.1.0` 형식으로 만든다(release.mjs) — 접두사를 떼고 비교한다
    const latest = String(json.tag_name ?? '').replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+$/.test(latest)) return fail('최신 버전 정보를 읽지 못했습니다.');

    const hasUpdate = FORCE_TAG ? true : compareVersion(latest, current) > 0;
    const asset = pickAsset(json.assets, process.platform, process.arch);
    const target = resolveInstallTarget();

    const info: UpdateInfo = {
      ok: true,
      current,
      latest,
      hasUpdate,
      url: typeof json.html_url === 'string' ? json.html_url : RELEASES_URL,
      asset,
      canInstall: !!asset && target.ok,
      installBlocked: !asset
        ? `이 PC(${process.platform}-${process.arch})용 파일이 없습니다 — 릴리스 페이지에서 확인하세요.`
        : target.ok
          ? undefined
          : target.reason,
    };
    lastInfo = info;
    return info;
  } catch (e) {
    return fail(
      e instanceof Error && e.message ? e.message : '업데이트 확인에 실패했습니다.',
    );
  }
}

async function install(): Promise<UpdateInstallResult> {
  // 확인을 안 했거나 오래됐으면 지금 한 번 더 — 렌더러가 넘긴 값을 믿지 않는다
  const info = lastInfo?.asset ? lastInfo : await checkUpdate();
  if (!info.ok) return { ok: false, error: info.error ?? '업데이트 확인에 실패했습니다.' };
  if (!info.hasUpdate) return { ok: false, error: '이미 최신 버전입니다.' };
  if (!info.asset || !info.canInstall)
    return { ok: false, error: info.installBlocked ?? '자동 설치를 할 수 없습니다.' };
  return installUpdate(info.asset, info.latest ?? 'latest');
}

export function registerUpdateIpc() {
  ipcMain.handle('update:check', () => checkUpdate());
  ipcMain.handle('update:install', () => install());
  ipcMain.handle('update:open-folder', async (_e, folder: unknown) => {
    // 우리가 만든 임시 폴더만 연다 — 렌더러가 임의 경로를 넘겨도 무시
    if (typeof folder !== 'string' || !isStageFolder(folder)) return { ok: false };
    const err = await shell.openPath(folder);
    return { ok: !err };
  });
}
