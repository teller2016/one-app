import { useCallback } from 'react';
import { useToast } from '../../../components/Toast';
import { useRegisterCommands } from '../../../lib/commands';
import { errMsg } from '../../../lib/errMsg';
import { openTerminalSession } from '../../../lib/sectionNav';

/**
 * ⌘P '루트 세션 열기' — 다른 claude 세션을 지휘하는 루트 claude 탭을 연다(이미 떠 있으면 그 탭으로).
 * 탭을 만드는 것은 main(`features/orchestrator/root.ts`)이고, 여기는 명령 등록과 터미널 섹션 이동만 한다.
 * 화면에는 아무것도 그리지 않는다.
 */
export function RootCommand() {
  const toast = useToast();

  const open = useCallback(() => {
    void (async () => {
      try {
        const res = await window.oneApp?.orchestrator?.openRoot();
        if (!res) return;
        if (!res.ok) {
          toast(res.error, 'fail');
          return;
        }
        openTerminalSession({ sessionId: res.sessionId, cwd: res.cwd });
      } catch (err) {
        toast(errMsg(err, '루트 세션을 열지 못했습니다.'), 'fail');
      }
    })();
  }, [toast]);

  useRegisterCommands('orchestrator', () =>
    window.oneApp?.orchestrator
      ? [
          {
            id: 'root-session-open',
            group: '명령',
            label: '루트 세션 열기',
            hint: '다른 claude 세션을 찾아 일을 맡기는 루트 claude',
            keywords: 'root orchestrator 루트 지휘 오케스트레이터',
            icon: 'terminal',
            run: open,
          },
        ]
      : []
  );

  return null;
}
