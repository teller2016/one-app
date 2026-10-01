// MO 터미널 — 폰 셸(App.tsx)이 쓰는 공개 API.
// 셸은 탭바 배지(입력 대기 수)·변경 탭 대상(터미널이 보는 워크트리)을 `moTerminal` 로 읽는다.
// ⚠️ 배럴이 아니라 순수 헬퍼 파일 — 배럴은 데스크톱 xterm 을 끌고 온다(MoTerminalTab 주석)
import { tileColor } from '../../renderer/features/terminal/lib/workspace';
import { controller, type MoTermState } from './controller';

export { MoTerminalTab } from './MoTerminalTab';

export type MoTerminalTarget = {
  /** 워크스페이스 id — 변경 탭이 `{ workspaceId, worktreePath }` 로 대상을 넘긴다 */
  wsId: string;
  path: string;
  wsName: string;
  /** 타일 색 번호(1~10) — 사용자 지정 색, 없으면 이름 해시(tileColor 결과) */
  wsColor: number;
  worktreeName: string;
  branch?: string;
};

export type MoTerminalSummary = {
  /** 입력 대기 세션 수 — 안정화된 집합(깜빡임 유예 3초) */
  waitingCount: number;
  connected: boolean;
  /**
   * 지금 보는 작업 영역 — 작업 영역을 골랐으면 그 워크트리, 아니면 붙어 있는 세션의 위치가
   * 속한 워크트리. 어느 워크스페이스에도 안 속하면(홈 디렉터리 세션 등) null — 변경 탭이 이 대상을 따라간다.
   */
  target: MoTerminalTarget | null;
};

function deriveTarget(s: MoTermState): MoTerminalTarget | null {
  if (s.scope) {
    return {
      wsId: s.scope.wsId,
      path: s.scope.path,
      wsName: s.scope.wsName,
      wsColor: tileColor({ name: s.scope.wsName, color: s.scope.wsColor }),
      worktreeName: s.scope.name,
      branch: s.scope.branch,
    };
  }
  const sess = s.attachedId ? s.sessions.find((x) => x.id === s.attachedId) : undefined;
  if (!sess) return null;
  // 세션 위치가 속한 워크트리 — 트리는 접속 직후 컨트롤러가 한 번 받아 둔다
  for (const ws of s.workspaces) {
    const wt = ws.worktrees.find((w) => w.path === sess.cwd);
    if (wt)
      return {
        wsId: ws.id,
        path: wt.path,
        wsName: ws.name,
        wsColor: tileColor(ws),
        worktreeName: wt.name,
        branch: wt.branch,
      };
  }
  return null;
}

// useSyncExternalStore 가 같은 참조를 받도록 입력이 같으면 이전 요약을 돌려준다
let lastState: MoTermState | null = null;
let lastSummary: MoTerminalSummary = { waitingCount: 0, connected: false, target: null };

export const moTerminal = {
  subscribe(fn: () => void): () => void {
    controller.start();
    return controller.subscribe(fn);
  },
  getState(): MoTerminalSummary {
    const s = controller.getState();
    if (s === lastState) return lastSummary;
    lastState = s;
    const target = deriveTarget(s);
    const prev = lastSummary;
    const sameTarget =
      prev.target === target ||
      (!!prev.target &&
        !!target &&
        prev.target.wsId === target.wsId &&
        prev.target.path === target.path &&
        prev.target.wsName === target.wsName &&
        prev.target.wsColor === target.wsColor &&
        prev.target.worktreeName === target.worktreeName &&
        prev.target.branch === target.branch);
    if (sameTarget && prev.waitingCount === s.waiting.length && prev.connected === s.connected)
      return prev;
    lastSummary = {
      waitingCount: s.waiting.length,
      connected: s.connected,
      target: sameTarget ? prev.target : target,
    };
    return lastSummary;
  },
};
