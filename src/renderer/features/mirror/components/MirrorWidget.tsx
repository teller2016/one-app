import { useEffect, useState } from 'react';
import type { MirrorStatus } from '../../../../shared/types';
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

  const start = async () => {
    setBusy(true);
    setError('');
    const res = await window.oneApp.mirror.start();
    if (!res.ok) setError(res.error ?? '미러링 실행에 실패했습니다.');
    await refresh();
    setBusy(false);
  };

  const stop = async () => {
    setBusy(true);
    setError('');
    await window.oneApp.mirror.stop();
    setBusy(false);
  };

  const running = status?.running ?? false;
  const statusText = !status
    ? '확인 중...'
    : !status.installed
      ? 'scrcpy 미설치'
      : running
        ? '미러링 중'
        : (status.device ?? 'USB 기기 없음');

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
          미러링 종료
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          className="mirw__btn"
          onClick={start}
          loading={busy}
          disabled={!status?.installed || !status?.device}
        >
          미러링 시작
        </Button>
      )}
    </div>
  );
}
