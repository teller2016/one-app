// 새 PR 알림 폴러 — 5분마다 열린 PR 을 확인해 처음 보는 PR 이 생기면 알림.
// 첫 조회는 기준선만 잡고 알리지 않는다 (앱 켤 때마다 기존 PR 로 도배 방지).
import { fetchOpenPrs } from './gitea';
import { getPrsConfig } from './store';
import { getGiteaConfig, isPrNotifyEnabled } from '../settings/store';
import { notify } from '../notify/notify';

const POLL_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let seeded = false;
const seen = new Set<string>(); // "repo#number"

async function tick() {
  if (!isPrNotifyEnabled()) return;
  const gitea = getGiteaConfig();
  if (!gitea) return; // Gitea 미설정 — 조용히 쉼

  let prs;
  try {
    prs = await fetchOpenPrs(gitea.url, gitea.token);
  } catch {
    return; // 일시적 오류(VPN 등)는 다음 폴링에서 재시도
  }

  // 제외 조직 필터 반영 (매 tick 저장값을 읽으므로 저장 후 재시작 불필요)
  const excluded = new Set(getPrsConfig().excludedOrgs);
  const visible = prs.filter((pr) => !excluded.has(pr.repo.split('/')[0]));

  const fresh = visible.filter((pr) => !seen.has(`${pr.repo}#${pr.number}`));
  // 제외 조직 PR 도 seen 에는 넣는다 — 필터를 풀었을 때 과거 PR 로 도배되지 않게
  prs.forEach((pr) => seen.add(`${pr.repo}#${pr.number}`));

  if (!seeded) {
    seeded = true; // 첫 조회는 기준선 — 알리지 않음
    return;
  }

  if (fresh.length === 0) return;

  // 알림은 틱당 한 번만 (여러 건이면 목록으로 요약)
  const lines = fresh
    .slice(0, 5)
    .map((pr) => `· [${pr.repo.split('/').pop()}] #${pr.number} ${pr.title} — ${pr.author}`);
  if (fresh.length > 5) lines.push(`· 외 ${fresh.length - 5}건`);
  void notify({
    title: fresh.length === 1 ? '새 PR 이 올라왔어요' : `새 PR ${fresh.length}건`,
    body: lines.join('\n'),
    section: 'prs',
  });
}

/** PR 알림 폴러 시작 (앱 ready 후 1회 호출) */
export function startPrPoller() {
  if (timer) return;
  void tick(); // 즉시 1회 — 기준선 잡기
  timer = setInterval(() => void tick(), POLL_MS);
}
