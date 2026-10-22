import { useRegisterCommands } from '../../../lib/commands';
import { useOpenRoot } from '../lib/rootSession';

/**
 * ⌘P '루트 세션 열기' — 다른 claude 세션을 지휘하는 루트 claude 탭을 연다(이미 떠 있으면 그 탭으로).
 * 탭을 만드는 것은 main(`features/orchestrator/root.ts`)이고, 여기는 명령 등록만 한다(동작은 useOpenRoot —
 * 터미널 LNB 의 고정 '루트' 칸과 같다). 화면에는 아무것도 그리지 않는다.
 */
export function RootCommand() {
  const open = useOpenRoot();

  useRegisterCommands('orchestrator', () =>
    window.oneApp?.orchestrator
      ? [
          {
            id: 'root-session-open',
            group: '명령',
            label: '루트 세션 열기',
            hint: '다른 claude 세션을 찾아 일을 맡기는 루트 claude',
            keywords: 'root orchestrator 루트 지휘 오케스트레이터',
            icon: 'root',
            run: open,
          },
        ]
      : []
  );

  return null;
}
