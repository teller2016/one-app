// MO(모바일) 접속 모달 — 서버 켜기/끄기 + 접속 URL·QR + 토큰 재발급.
// 폰은 Tailscale 로 맥에 도달하고, URL 의 토큰이 앱 차원의 인증을 담당한다.
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Icon } from '../../../components/Icon';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import { useCopy } from '../../../lib/useCopy';
import { useEffect, useState } from 'react';
import type { TerminalServerStatus } from '../../../../shared/types';
import { errMsg } from '../../../lib/errMsg';

export function MoAccessModal({ onClose }: { onClose: () => void }) {
  const confirm = useConfirm();
  const copy = useCopy();
  const toast = useToast();
  const [status, setStatus] = useState<TerminalServerStatus | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const refresh = async () =>
      setStatus(await window.oneApp.terminal.server.status());
    void refresh();
    return window.oneApp.terminal.server.onChanged(() => void refresh());
  }, []);

  // 첫 URL(Tailscale IP 우선)을 QR 로 — 폰 카메라로 찍으면 바로 접속
  const firstUrl = status?.urls[0] ?? '';
  useEffect(() => {
    if (!firstUrl) {
      setQr('');
      return;
    }
    // qrcode 는 이 모달에서만 쓴다 — 정적 import 하면 터미널(첫 화면) 청크에 들어간다
    void import('qrcode').then((m) =>
      m.default.toDataURL(firstUrl, { margin: 1, width: 240 }).then(setQr)
    );
  }, [firstUrl]);

  // IPC 실패는 토스트로 알린다 — 삼키면 버튼만 원래대로 돌아와 아무 일도 없어 보인다
  const toggle = async () => {
    if (!status) return;
    setBusy(true);
    try {
      setStatus(await window.oneApp.terminal.server.setEnabled(!status.running));
    } catch (err) {
      toast(`서버 ${status.running ? '끄기' : '켜기'} 실패: ${errMsg(err)}`, 'fail');
    } finally {
      setBusy(false);
    }
  };

  const regen = async () => {
    const ok = await confirm({
      title: '토큰 재발급',
      message: '기존 접속 URL 과 로그인된 기기가 모두 무효화됩니다.',
      confirmLabel: '재발급',
      danger: true,
    });
    if (!ok) return;
    try {
      setStatus(await window.oneApp.terminal.server.regenToken());
    } catch (err) {
      toast(`토큰 재발급 실패: ${errMsg(err)}`, 'fail');
    }
  };

  return (
    <Modal title="모바일(MO) 접속" onClose={onClose}>
      <div className="terminal-mo">
        <p className="note">
          같은 Tailscale 네트워크의 폰에서 아래 주소로 접속하면 <strong>근태·Jira·PR·배포·메일</strong>
          과 터미널을 폰에서 쓸 수 있습니다(터미널은 하단 탭에서 열리고, 세션은 데스크톱과
          공유됩니다). 서버는 켜 두면 앱 시작 시 자동으로 다시 켜집니다.{' '}
          <strong>QR 은 처음 한 번만</strong> 찍으면 됩니다 — 열린 뒤 브라우저 메뉴에서{' '}
          <strong>홈 화면에 추가</strong>해 두면 다음부터 아이콘을 눌러 바로 연결됩니다
          (로그인은 1년간 유지).
        </p>

        {status?.error && <Banner variant="danger">{status.error}</Banner>}

        <div className="terminal-mo__row">
          <span className="form-label">접속 서버 (포트 {status?.port ?? '—'})</span>
          <Button
            size="sm"
            variant={status?.running ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void toggle()}
          >
            {status?.running ? '끄기' : '켜기'}
          </Button>
        </div>

        {status?.running && (
          <>
            {qr && (
              <div className="terminal-mo__qr">
                <img src={qr} alt="MO 접속 QR" />
                <span className="hint">폰 카메라로 QR 을 찍어 여세요</span>
              </div>
            )}
            <ul className="terminal-mo__urls">
              {status.urls.map((url) => (
                <li key={url}>
                  <code>{url}</code>
                  <Tooltip label="복사">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="접속 주소 복사"
                      onClick={() => void copy(url)}
                    >
                      <Icon name="copy" size={14} />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
            {status.urls.length === 0 && (
              <Banner variant="warning">
                외부에서 접속할 IP 를 찾지 못했습니다 — Tailscale 이 켜져 있는지
                확인하세요.
              </Banner>
            )}
            {/* 터미널만 바로 열고 싶을 때 (앱 셸의 하단 탭으로도 갈 수 있다) */}
            {status.terminalUrls.length > 0 && (
              <>
                <span className="form-label">터미널만 바로 열기</span>
                <ul className="terminal-mo__urls">
                  <li>
                    <code>{status.terminalUrls[0]}</code>
                    <Tooltip label="복사">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="터미널 주소 복사"
                        onClick={() => void copy(status.terminalUrls[0])}
                      >
                        <Icon name="copy" size={14} />
                      </button>
                    </Tooltip>
                  </li>
                </ul>
              </>
            )}
            <div className="terminal-mo__row">
              <span className="hint">
                URL 이 유출됐다면 토큰을 재발급해 무효화하세요.
              </span>
              <Button size="sm" variant="ghost" onClick={() => void regen()}>
                토큰 재발급
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
