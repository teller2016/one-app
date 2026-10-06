// deploy 기능 공용 헬퍼 — 상태 키·진행 판별·시간 포맷
import type { DeployStatus } from '../../../../shared/types';
import { ownerRepoPartsFromUrl } from '../../../../shared/types';
import { JIRA_KEY_RE } from '../../../../shared/jira-url';
import { pad2, relativeTime } from '../../../../shared/date';

/** 상태/패널 맵의 키 (projectId:targetId) */
export const statusKey = (projectId: string, targetId: string) =>
  `${projectId}:${targetId}`;

export const isBusy = (s?: DeployStatus) =>
  s?.state === 'queued' || s?.state === 'building';

/** 젠킨스 잡 페이지 URL — "폴더/잡" 경로를 /job/폴더/job/잡 으로 변환 */
export const jenkinsJobUrl = (baseUrl: string, jobPath: string) =>
  `${baseUrl.replace(/\/+$/, '')}/job/${jobPath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/job/')}/`;

export const formatTime = (ts?: number) =>
  ts ? new Date(ts).toLocaleString('ko-KR') : '';

/** 목록 안 짧은 시각 "09/30 14:02" — 숫자만이라 모노로 그려도 된다(목업 표기) */
export const formatStamp = (ts?: number) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** 소요 시간 — "22분 47초" / "45초" / "1시간 3분" */
export const formatDuration = (ms: number) => {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return s > 0 ? `${m}분 ${s}초` : `${m}분`;
  return `${s}초`;
};

/** "5분 전" 형태의 상대 시간 (일주일 넘으면 날짜로) — 정본은 shared/date */
export const formatRelative = relativeTime;

/** Gitea 커밋 페이지 URL 베이스 — giteaUrl 미설정이거나 저장소 해석 실패면 null */
export const giteaCommitBase = (
  giteaUrl: string,
  repoUrl?: string,
): string | null => {
  if (!giteaUrl || !repoUrl) return null;
  const parsed = ownerRepoPartsFromUrl(repoUrl);
  if (!parsed) return null;
  return `${giteaUrl.replace(/\/+$/, '')}/${parsed.owner}/${parsed.repo}/commit/`;
};

/** 커밋 트레일러 — `refs: BBJ-1234` (대소문자·공백 자유, `ref:` 도 허용) */
const REFS_LINE_RE = /^[ \t]*refs?[ \t]*:(.*)$/gim;

/** 줄머리 티켓 — `- CNM-907: …` / `JVT-91 BO 회원 …` (불릿 마커 허용) */
const LINE_HEAD_KEY_RE = /^[ \t]*(?:[-*•]\s*)?([A-Z][A-Z0-9]{1,9}-\d+)\b/gm;

/** Bitbucket·git 머지 커밋 제목 — 실제 제목이 본문 첫 줄에 온다 */
const MERGE_TITLE_RE = /^Merged? (in|branch|pull request|remote)/i;

/**
 * 커밋 메시지에서 Jira 이슈 키를 뽑는다 — 등장 순서 유지·중복 제거.
 *
 * **프로젝트 키 목록에 의존하지 않는다** — 키는 저장소마다 다르고 계속 늘어난다
 * (실측: BBJ · JAVAVER · CNM · JVT · SSB …). 대신 키를 적는 **자리**를 기준으로 삼아
 * 키가 뭐로 바뀌어도 그대로 동작한다.
 *
 * ⚠️ 본문 산문은 스캔하지 않는다 — 키 패턴만으로 훑으면 `JSR-310`·`UTF-8`·`TODO-016`·
 * `US-007` 같은 표기가 티켓으로 둔갑한다(2026-08-11 사내 저장소 1200커밋 실측).
 */
export const extractIssueKeys = (message: string): string[] => {
  const lines = message.split('\n');

  // ① refs 트레일러가 있으면 그 줄에서만 — 오탐이 들어올 자리가 없다
  const refsBody = [...message.matchAll(REFS_LINE_RE)]
    .map((m) => m[1])
    .join(' ');
  const fromRefs = refsBody.match(JIRA_KEY_RE);
  if (fromRefs?.length) return [...new Set(fromRefs)];

  // ② 제목 줄 전체 — 머지 커밋이면 본문 첫 줄이 진짜 제목이라 함께 본다
  const titles = [lines[0]];
  if (MERGE_TITLE_RE.test(lines[0])) {
    const real = lines.slice(1).find((l) => l.trim());
    if (real) titles.push(real);
  }
  const keys = titles.flatMap((t): string[] => t.match(JIRA_KEY_RE) ?? []);

  // ③ 줄머리 — `- CNM-907: …` 식으로 티켓을 나열하는 커밋
  for (const m of message.matchAll(LINE_HEAD_KEY_RE)) keys.push(m[1]);

  return [...new Set(keys)];
};
