import { useEffect, useState } from 'react';
import type { MirrorMode, MirrorStatus } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { StatusDot } from '../../../components/StatusDot';

/** 사이드바 하단 미러링 위젯 — scrcpy 로 USB 폰 화면을 미러링한다. */
export function MirrorWidget() {
  const [status, setStatus] = useState<MirrorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setStatus(await window.oneApp.mirror.getStatus());
  };

  useEffect(() => {
    void refresh();
    // 미러 창을 닫는 등 프로세스 상태가 바뀌면 다시 조회
    return window.oneApp.mirror.onChanged(() => void refresh());
  }, []);

  const start = async (mode: MirrorMode) => {
    setBusy(true);
    setError('');
    const res = await window.oneApp.mirror.start(mode);
    if (!res.ok) setError(res.error ?? 'scrcpy 실행에 실패했습니다.');
    await refresh();
    setBusy(false);
  };

  const stop = async () => {
    setBusy(true);
    setError('');
    await window.oneApp.mirror.stop();
    setBusy(false);
  };

  const running = status?.running ?? null;
  const statusText = !status
    ? '확인 중...'
    : !status.installed
      ? 'scrcpy 미설치'
      : running
        ? running === 'mirror'
          ? '미러링 중'
          : '제어 중 (화면 없음)'
        : (status.device ?? 'USB 기기 없음');
  const canStart = !!status?.installed && !!status?.device;

  return (
    <div className="mirw">
      <div className="mirw__head">
        <span className="mirw__title">
          <Icon name="smartphone" size={12} />폰 미러링
        </span>
        <RefreshButton
          size={12}
          onClick={() => void refresh()}
          title="USB 기기 다시 확인"
        />
      </div>

      <div className="mirw__status">
        <StatusDot
          md
          status={running ? 'ok' : status?.error ? 'fail' : 'idle'}
        />
        <span className="mirw__status-text" title={statusText}>
          {statusText}
        </span>
      </div>

      {(error || status?.error) && (
        <p className="mirw__error">{error || status?.error}</p>
      )}
      {status && !status.installed && (
        <p className="hint">brew install scrcpy 로 설치하세요.</p>
      )}

      {running ? (
        <Button
          variant="danger"
          size="sm"
          className="mirw__btn"
          onClick={stop}
          loading={busy}
        >
          {running === 'mirror' ? '미러링 종료' : '제어 종료'}
        </Button>
      ) : (
        // 두 모드 나란히 — 미러링(화면 미러) / 제어(화면 없이 키보드·마우스만)
        <div className="mirw__actions">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void start('mirror')}
            loading={busy}
            disabled={!canStart}
            title="폰 화면을 미러링합니다 (폰 화면은 꺼짐)"
          >
            미러링
          </Button>
          <Button
            size="sm"
            onClick={() => void start('control')}
            loading={busy}
            disabled={!canStart}
            title="화면 미러 없이 맥 키보드·마우스로 폰을 조작합니다"
          >
            제어
          </Button>
        </div>
      )}
    </div>
  );
}
