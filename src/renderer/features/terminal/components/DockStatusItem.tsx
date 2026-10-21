import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { StatusBarItem } from '../../../components/StatusBar';
import { StatusDot } from '../../../components/StatusDot';
import { useToast } from '../../../components/Toast';
import { errMsg } from '../../../lib/errMsg';
import { useRegisterCommands } from '../../../lib/commands';

/**
 * 상태바 독 터미널 항목 — 누르면 독 오른쪽 빈자리에 작은 터미널 패널을 띄우고(펼친 채 바로 입력),
 * 다시 누르면 숨긴다. 패널 창·배정은 main(`features/terminal/dock.ts`·`windows.ts`)이 갖는다.
 */
export function DockStatusItem() {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const api = window.oneApp?.terminal?.dock;
    if (!api) return;
    void api.state().then((s) => setOpen(s.open));
    return api.onState((s) => setOpen(s.open));
  }, []);

  const toggle = useCallback(() => {
    void (async () => {
      try {
        const s = await window.oneApp?.terminal?.dock?.toggle();
        if (s) setOpen(s.open);
      } catch (err) {
        toast(errMsg(err, '독 터미널을 열지 못했습니다.'), 'fail');
      }
    })();
  }, [toast]);

  // ⌘P 팔레트 명령 — 버튼과 같은 핸들러
  useRegisterCommands('dock-terminal', () =>
    window.oneApp?.terminal?.dock
      ? [
          {
            id: 'dock-terminal-toggle',
            group: '명령',
            label: open ? '독 터미널 숨기기' : '독 터미널 열기',
            hint: '독 오른쪽 빈자리의 작은 터미널',
            keywords: 'dock terminal 독 터미널 패널',
            icon: 'panel-bottom',
            run: toggle,
          },
        ]
      : []
  );

  // 독 패널 API 가 없는 환경(폰 셸·구 preload)에서는 항목 자체를 그리지 않는다
  if (!window.oneApp?.terminal?.dock) return null;

  return (
    <StatusBarItem
      icon={<Icon name="panel-bottom" size={12} />}
      dot={open ? <StatusDot status="ok" /> : undefined}
      label="독 터미널"
      title={
        open
          ? '독 터미널 숨기기 (세션은 그대로 남습니다)'
          : '독 오른쪽에 터미널 띄우기 — 패널 안에서 ⌘↑ 펼치기 · ⌘↓ 접기'
      }
      active={open}
      onClick={toggle}
    />
  );
}
