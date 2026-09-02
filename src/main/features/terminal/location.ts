// 세션 위치 라벨 — "작업 영역 · 워크트리 폴더명". 입력대기 알림 제목(ipc.ts)과
// 팝아웃 창 타이틀·헤더(windows.ts)가 공유한다. ipc.ts 에 있던 것을 그대로 옮겼다
// (windows.ts ↔ ipc.ts 순환 import 회피).
import path from 'node:path';
import { onBroadcast } from '../../lib/broadcast';
import { worktreePaths } from '../workspaces/git';
import { listWorkspaces } from '../workspaces/store';

// 세션 위치 라벨 캐시 — cwd 는 세션 수명 동안 불변이라 waiting 마다 git 을 돌리지 않는다.
// ⚠️ 다만 **워크스페이스 목록이 바뀌면 답도 바뀐다** — 워크스페이스를 나중에 등록하면
// 그 전에 만든 세션은 `null`(라벨 없음)로 캐시돼 있어 알림 제목에 위치가 영영 안 붙었고,
// 이름 변경·제거 뒤에는 옛 이름이 계속 나왔다. 목록 변경 브로드캐스트에 맞춰 비운다.
/** 세션 cwd 가 속한 워크스페이스·워크트리 — 등록 밖(홈 등)이면 null */
export type SessionLocation = { wsId: string; wsName: string; wtPath: string };

const locations = new Map<string, SessionLocation | null>();
onBroadcast((channel) => {
  if (channel === 'workspaces:changed') locations.clear();
});

/**
 * 세션 cwd → 소속 워크스페이스·워크트리. 워크스페이스별 `git worktree list`(경량 —
 * 상태 조회 없음)로 경로를 대조한다. **git 이 아는 워크트리 경로만** 돌려주므로
 * 이 결과로 IDE 를 열어도 임의 경로 실행이 아니다(workspaces:open-editor 와 같은 규칙).
 */
export async function sessionLocation(cwd: string): Promise<SessionLocation | null> {
  const cached = locations.get(cwd);
  if (cached !== undefined) return cached;
  let best: SessionLocation | null = null;
  for (const ws of listWorkspaces()) {
    try {
      const paths = await worktreePaths(ws.repoPath);
      for (const p of paths) {
        if (cwd !== p && !cwd.startsWith(p + '/')) continue;
        // 중첩 매치(주 워크트리 폴더 안의 워크트리)는 더 깊은 경로가 정답
        if (!best || p.length > best.wtPath.length)
          best = { wsId: ws.id, wsName: ws.name, wtPath: p };
      }
    } catch {
      // git 실패(저장소 삭제 등)는 라벨 생략 사유일 뿐 — 알림은 그대로 나간다
    }
  }
  locations.set(cwd, best);
  return best;
}

/**
 * "작업 영역 · 워크트리" 라벨 (입력대기 알림·팝아웃 창 타이틀용).
 * 등록된 워크스페이스 밖이면 null — 호출부가 라벨 없이 표시한다.
 */
export async function sessionLocationLabel(cwd: string): Promise<string | null> {
  const loc = await sessionLocation(cwd);
  return loc ? `${loc.wsName} · ${path.basename(loc.wtPath)}` : null;
}
