// 새 버전 확인 — 배포 리포의 GitHub Releases 최신 태그를 현재 버전과 비교한다.
//
// 자동 업데이트(Squirrel·서명 인프라)를 두지 않는 대신, **새 버전이 나온 사실만 알리고**
// 내려받기는 사용자가 릴리스 페이지에서 한다. 받는 사람은 zip 을 덮어쓰면 되고 설정은
// userData 에 있어 그대로 유지된다.
//
// ⚠️ 실패는 오류로 만들지 않는다 — 사내망에서 GitHub 이 막혀 있어도 앱은 그대로 돌아야 한다.
import { app, ipcMain } from 'electron';
import { fetchWithTimeout } from '@one/main/lib/http';
import type { UpdateInfo } from '../shared/update';

/** ⚠️ 바꾸면 `scripts/release.mjs` 의 REPO 도 함께 바꿀 것 (배포하는 곳과 보는 곳이 같아야 한다) */
const REPO = 'teller2016/one-app-lite';

const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** 시작할 때 한 번 부르는 부가 기능이라 짧게 끊는다 (본체 기본 15초보다 짧게) */
const TIMEOUT_MS = 8_000;

/** x.y.z 비교 — a 가 b 보다 새로우면 양수. 자리수가 빠지면 0 으로 친다 */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

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

    const json = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    // 태그는 `v2.1.0` 형식으로 만든다(release.mjs) — 접두사를 떼고 비교한다
    const latest = String(json.tag_name ?? '').replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+$/.test(latest)) return fail('최신 버전 정보를 읽지 못했습니다.');

    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersion(latest, current) > 0,
      url: typeof json.html_url === 'string' ? json.html_url : RELEASES_URL,
    };
  } catch (e) {
    return fail(
      e instanceof Error && e.message ? e.message : '업데이트 확인에 실패했습니다.',
    );
  }
}

export function registerUpdateIpc() {
  ipcMain.handle('update:check', () => checkUpdate());
}
