import { useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { StatusBarItem } from '../../../components/StatusBar';
import { StatusDot } from '../../../components/StatusDot';
import { useRegisterCommands } from '../../../lib/commands';
import { MoAccessModal } from './MoAccessModal';

/**
 * 상태바 MO(모바일 접속) 항목 — 접속 서버 켜짐/꺼짐을 보여주고, 누르면 접속 모달을 연다.
 * (2026-09-30 리디자인: 터미널 탭바 오른쪽 버튼에서 상태바로 옮겼다 — 이제 여기가 유일한 진입점)
 */
export function MoStatusItem() {
  const [running, setRunning] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const api = window.oneApp?.terminal;
    if (!api) return;
    const refresh = async () => setRunning((await api.server.status()).running);
    void refresh();
    return api.server.onChanged(() => void refresh());
  }, []);

  // ⌘K 팔레트 명령
  useRegisterCommands('mo', () =>
    window.oneApp?.terminal
      ? [
          {
            id: 'mo-open',
            group: '명령',
            label: 'MO(모바일) 접속',
            hint: running ? '서버 켜짐' : '서버 꺼짐',
            keywords: 'mobile mo qr 폰',
            icon: 'terminal',
            run: () => setOpen(true),
          },
        ]
      : [],
  );

  // 터미널 API 가 없는 환경(폰 셸 등)에서는 항목 자체를 그리지 않는다
  if (!window.oneApp?.terminal) return null;

  return (
    <>
      <StatusBarItem
        // 폰 미러링(smartphone)과 구분 — MO 는 폰에서 여는 터미널이다
        icon={<Icon name="terminal" size={12} />}
        dot={<StatusDot status={running ? 'ok' : 'idle'} />}
        label={
          <>
            MO{' '}
            <span className="statusbar__meta">
              {running === null ? '…' : running ? '켜짐' : '꺼짐'}
            </span>
          </>
        }
        title={`모바일(MO) 접속 — 서버 ${running ? '켜짐' : '꺼짐'}`}
        active={open}
        onClick={() => setOpen(true)}
      />
      {open && <MoAccessModal onClose={() => setOpen(false)} />}
    </>
  );
}
