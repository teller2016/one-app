// Claude 세션 현황 — ⌘⇧P 빠른 전환 팝업(renderer `SessionSwitcher`)의 데이터.
//
// 터미널 세션 중 **claude 가 실제로 떠 있는 것**만 고른다(셸 탭에서 손으로 친 claude 포함, claude 가 끝나
// 셸만 남은 에이전트 탭 제외). 각 세션의 대화 기록에서 작업 제목·첫 요청·마지막 요청을 꺼낸다(sessionDigest.ts).
//
// 팝업이 열린 동안만 몇 초마다 불리므로 비용을 묶는다:
// - pane 셸 pid 는 세션 수명 동안 그대로다(`exec <sh> -il` 은 pid 를 바꾸지 않는다) — 한 번 묻고 기억한다.
// - claude 찾기는 `ps` 한 번으로 전 세션(findClaudeMany).
// - 대화 기록은 파일별로 **읽은 데까지 기억**해 늘어난 바이트만 읽는다. 처음엔 끝 TAIL_BYTES 만.
import fs from 'node:fs';
import type { TerminalOverviewItem } from '../../../shared/types';
import { alive, completeLines, findClaudeMany, readRange } from './claudeFiles';
import { sessionLocationLabel } from './location';
import { listSessions, sessionRootPid } from './pty';
import { digestLines, firstPromptOf, type TranscriptDigest } from './sessionDigest';

/** 처음 읽는 꼬리 — ai-title 은 실측상 끝에서 31KB 안쪽이지만, 도구 결과 한 줄이 수백 KB 일 수 있어 넉넉히 */
const TAIL_BYTES = 1024 * 1024;
/** 첫 요청을 찾는 머리 — 첫 user 줄은 파일 맨 앞쪽에 온다 */
const HEAD_BYTES = 256 * 1024;

type FileDigest = TranscriptDigest & {
  /** 여기까지 읽었다(완성된 줄 경계) */
  read: number;
  /** read 가 줄 경계인가 — 꼬리부터 읽기 시작하면 첫 조각은 줄 중간이다 */
  aligned: boolean;
  /** undefined = 아직 못 찾음(다시 본다) · null = 머리에 없다(포기) */
  firstPrompt?: string | null;
};

const rootPids = new Map<string, number>();
const digests = new Map<string, FileDigest>();

/** 터미널 세션 id → pane 셸 pid (죽었으면 다시 묻는다) */
async function rootsFor(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of ids) {
    let pid = rootPids.get(id);
    if (!pid || !alive(pid)) {
      pid = (await sessionRootPid(id)) ?? undefined;
      if (pid) rootPids.set(id, pid);
      else rootPids.delete(id);
    }
    if (pid) out.set(id, pid);
  }
  for (const id of rootPids.keys()) if (!ids.includes(id)) rootPids.delete(id);
  return out;
}

/** 대화 기록 요약 갱신 — 파일이 아직 없으면(첫 메시지 전) null */
function digestFile(file: string): { digest: FileDigest; mtime: number } | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const size = st.size;
  let d = digests.get(file);
  // 처음이거나 파일이 줄었으면(다시 쓰임) 꼬리부터 새로
  if (!d || size < d.read) {
    d = { read: Math.max(0, size - TAIL_BYTES), aligned: size <= TAIL_BYTES };
    digests.set(file, d);
  }
  if (size > d.read) {
    // 너무 많이 늘었으면 그 사이는 건너뛰고 꼬리만 — 제목·마지막 요청은 뒤쪽이 정답이다
    if (size - d.read > TAIL_BYTES) {
      d.read = size - TAIL_BYTES;
      d.aligned = false;
    }
    try {
      let text = readRange(file, d.read, size);
      if (!d.aligned) {
        const nl = text.indexOf('\n');
        if (nl >= 0) {
          d.read += Buffer.byteLength(text.slice(0, nl + 1), 'utf8');
          text = text.slice(nl + 1);
          d.aligned = true;
        } else text = '';
      }
      const { lines, used } = completeLines(text);
      d.read += used;
      digestLines(lines, d);
    } catch {
      // 읽기 실패는 다음 주기에 다시 — 지난 요약은 그대로 쓴다
    }
  }
  if (d.firstPrompt === undefined) {
    try {
      const { lines } = completeLines(readRange(file, 0, Math.min(size, HEAD_BYTES)));
      const first = firstPromptOf(lines);
      // 작은 파일에서 못 찾았으면 아직 안 쓰였을 수 있다 — 다음에 다시 본다
      if (first) d.firstPrompt = first;
      else if (size >= HEAD_BYTES) d.firstPrompt = null;
    } catch {
      // 다음 주기에 다시
    }
  }
  return { digest: d, mtime: st.mtimeMs };
}

export async function terminalOverview(): Promise<TerminalOverviewItem[]> {
  const sessions = listSessions();
  const claudes = await findClaudeMany(await rootsFor(sessions.map((s) => s.id)));
  const items: TerminalOverviewItem[] = [];
  const liveFiles = new Set<string>();
  for (const s of sessions) {
    const c = claudes.get(s.id);
    if (!c) continue;
    liveFiles.add(c.file);
    const got = digestFile(c.file);
    const d = got?.digest;
    items.push({
      id: s.id,
      cwd: s.cwd,
      tabTitle: s.title,
      status: s.status,
      working: s.working,
      location: await sessionLocationLabel(s.cwd),
      title: d?.aiTitle ?? null,
      firstPrompt: d?.firstPrompt ?? null,
      lastPrompt: d?.lastPrompt ?? null,
      activityAt: got?.mtime ?? s.createdAt,
    });
  }
  // 끝난 대화(`/clear` 로 바뀐 것 포함)의 요약은 버린다
  for (const f of digests.keys()) if (!liveFiles.has(f)) digests.delete(f);
  return items;
}
