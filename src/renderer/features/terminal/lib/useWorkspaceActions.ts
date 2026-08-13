// 워크스페이스·워크트리 CRUD — LNB(WorkspaceNav)가 쓰는 액션 묶음.
//
// TerminalSection 에서 떼어냈다: 여기 있는 것들은 workspaces·worktrees·confirm·toast
// 외에는 아무것도 건드리지 않아(세션 목록은 워크트리 제거 경고 문구에만 쓴다) 섹션의
// 다른 상태와 얽히지 않는다.
//
// LNB 는 `memo` 라 넘기는 콜백의 참조가 고정돼야 한다 — 그래서 `void` 래핑까지 여기서
// `useCallback` 으로 만들어 내보낸다(호출부에서 인라인 화살표를 쓰면 memo 가 깨진다).
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/Toast';
import type {
  TerminalSessionInfo,
  TerminalWorkspace,
  WorktreeInfo,
} from '../../../../shared/types';
import { worktreeName } from './workspace';

export type WorkspaceActions = {
  /** 워크트리 폴더 제거 (확인 후 git worktree remove) */
  onRemoveWorktree: (ws: TerminalWorkspace, wt: WorktreeInfo) => void;
  /** 워크스페이스를 목록에서 제거 (저장소 파일은 그대로) */
  onRemoveWorkspace: (ws: TerminalWorkspace) => void;
  onRename: (ws: TerminalWorkspace, name: string) => void;
  onSetColor: (ws: TerminalWorkspace, color: number) => void;
  onReveal: (ws: TerminalWorkspace) => void;
  onReorder: (ids: string[]) => void;
};

export function useWorkspaceActions({
  sessions,
  setWorkspaces,
  refreshWorktrees,
}: {
  /** 워크트리 제거 경고에 "이 위치를 쓰는 세션 N개" 를 넣기 위해서만 쓴다 */
  sessions: TerminalSessionInfo[];
  setWorkspaces: Dispatch<SetStateAction<TerminalWorkspace[]>>;
  refreshWorktrees: () => Promise<void>;
}): WorkspaceActions {
  const confirm = useConfirm();
  const toast = useToast();

  const removeWorktree = useCallback(
    async (ws: TerminalWorkspace, wt: WorktreeInfo) => {
      const inUse = sessions.filter((s) => s.cwd === wt.path).length;
      const ok = await confirm({
        title: '워크트리 제거',
        message: [
          `'${worktreeName(wt)}'(${wt.branch ?? wt.head ?? '?'}) 워크트리 폴더를 제거합니다.`,
          wt.dirty ? '커밋하지 않은 변경이 함께 사라집니다.' : '',
          inUse > 0 ? `이 위치를 쓰는 세션 ${inUse}개의 작업 폴더가 사라집니다.` : '',
          '브랜치는 삭제되지 않습니다.',
        ]
          .filter(Boolean)
          .join(' '),
        confirmLabel: '제거',
        danger: true,
      });
      if (!ok) return;
      try {
        // dirty·missing 워크트리는 git 이 --force 를 요구한다 (확인은 위에서 이미 받았다)
        const r = await window.oneApp.workspaces.removeWorktree(
          ws.id,
          wt.path,
          wt.dirty || wt.missing
        );
        if (r.ok) {
          toast('워크트리를 제거했습니다');
          void refreshWorktrees();
        } else {
          toast(`워크트리 제거 실패: ${r.error ?? '알 수 없는 오류'}`, 'fail');
        }
      } catch (err) {
        toast(`워크트리 제거 실패: ${(err as Error).message}`, 'fail');
      }
    },
    [sessions, confirm, toast, refreshWorktrees]
  );

  const removeWorkspace = useCallback(
    async (ws: TerminalWorkspace) => {
      const ok = await confirm({
        title: '워크스페이스 제거',
        message: `'${ws.name}' 를 목록에서 제거합니다. 저장소·워크트리 파일은 삭제되지 않습니다.`,
        confirmLabel: '제거',
        danger: true,
      });
      if (!ok) return;
      try {
        await window.oneApp.workspaces.delete(ws.id); // 목록 갱신은 onChanged 브로드캐스트
      } catch (err) {
        toast(`워크스페이스 제거 실패: ${(err as Error).message}`, 'fail');
      }
    },
    [confirm, toast]
  );

  // 이름·색 변경은 같은 save 채널 — 미지정 필드는 main 이 기존 값을 유지한다
  const saveWorkspace = useCallback(
    async (input: { id: string; name: string; repoPath: string; color?: number }) => {
      try {
        await window.oneApp.workspaces.save(input);
      } catch (err) {
        toast(`워크스페이스 저장 실패: ${(err as Error).message}`, 'fail');
      }
    },
    [toast]
  );

  // 드래그 순서 변경 — 브로드캐스트를 기다리면 드롭 순간 원래 자리로 튀어 보이므로
  // 로컬 목록을 먼저 재배열한다(낙관적 갱신 — main 저장 결과가 곧 덮어 확정)
  const onReorder = useCallback(
    (ids: string[]) => {
      setWorkspaces((cur) => {
        const byId = new Map(cur.map((w) => [w.id, w]));
        const next: TerminalWorkspace[] = [];
        for (const id of ids) {
          const w = byId.get(id);
          if (w) {
            next.push(w);
            byId.delete(id);
          }
        }
        next.push(...byId.values());
        return next;
      });
      window.oneApp.workspaces.reorder(ids).catch((err: Error) => {
        toast(`순서 저장 실패: ${err.message}`, 'fail');
      });
    },
    [setWorkspaces, toast]
  );

  const revealWorkspace = useCallback(
    async (ws: TerminalWorkspace) => {
      const r = await window.oneApp.workspaces.reveal(ws.id);
      if (!r.ok) toast(`폴더를 열지 못했습니다: ${r.error ?? ''}`, 'fail');
    },
    [toast]
  );

  // ── LNB 에 넘길 동기 시그니처 래퍼 — memo 유지를 위해 참조를 고정한다 ──
  const onRemoveWorktree = useCallback(
    (ws: TerminalWorkspace, wt: WorktreeInfo): void => {
      void removeWorktree(ws, wt);
    },
    [removeWorktree]
  );
  const onRemoveWorkspace = useCallback(
    (ws: TerminalWorkspace): void => {
      void removeWorkspace(ws);
    },
    [removeWorkspace]
  );
  const onRename = useCallback(
    (ws: TerminalWorkspace, name: string): void => {
      void saveWorkspace({ id: ws.id, name, repoPath: ws.repoPath });
    },
    [saveWorkspace]
  );
  const onSetColor = useCallback(
    (ws: TerminalWorkspace, color: number): void => {
      void saveWorkspace({ id: ws.id, name: ws.name, repoPath: ws.repoPath, color });
    },
    [saveWorkspace]
  );
  const onReveal = useCallback(
    (ws: TerminalWorkspace): void => {
      void revealWorkspace(ws);
    },
    [revealWorkspace]
  );

  return {
    onRemoveWorktree,
    onRemoveWorkspace,
    onRename,
    onSetColor,
    onReveal,
    onReorder,
  };
}
