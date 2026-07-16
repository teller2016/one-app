import { useEffect, useState } from 'react';
import type { VpnSettingsView, VpnStatus } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { FileTrigger } from '../../../components/FileTrigger';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { StatusDot } from '../../../components/StatusDot';

/** 사이드바 하단 VPN 위젯 — OpenVPN 연결 상태 표시 + 연결/해제 */
export function VpnWidget() {
  const [settings, setSettings] = useState<VpnSettingsView | null>(null);
  const [status, setStatus] = useState<VpnStatus>({ state: 'disconnected' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [otp, setOtp] = useState('');
  // 설정 폼 입력값
  const [formUser, setFormUser] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formOvpn, setFormOvpn] = useState('');

  useEffect(() => {
    void (async () => {
      const [s, st] = await Promise.all([
        window.oneApp.vpn.getSettings(),
        window.oneApp.vpn.getStatus(),
      ]);
      setSettings(s);
      setStatus(st);
      setFormUser(s.username);
      setFormOvpn(s.ovpnPath);
      // 필수 설정이 비어 있으면 설정 폼을 바로 펼친다
      if (!s.username || !s.ovpnPath) setShowConfig(true);
    })();
    return window.oneApp.vpn.onStatus(setStatus);
  }, []);

  const connect = async () => {
    setBusy(true);
    setError('');
    const res = await window.oneApp.vpn.connect(otp.trim() || undefined);
    if (!res.ok) setError(res.error ?? '연결에 실패했습니다.');
    else setOtp('');
    setBusy(false);
  };

  const disconnect = async () => {
    setBusy(true);
    setError('');
    const res = await window.oneApp.vpn.disconnect();
    if (!res.ok) setError(res.error ?? '해제에 실패했습니다.');
    setBusy(false);
  };

  const saveConfig = async () => {
    setError('');
    // 필수값 검증 — 빈 채로 저장하면 연결 단계에서 헷갈리므로 여기서 막는다
    if (!formUser.trim()) {
      setError('VPN 계정 이름을 입력하세요. (OpenVPN의 Username)');
      return;
    }
    if (!formOvpn) {
      setError('.ovpn 설정 파일을 선택하세요.');
      return;
    }
    const res = await window.oneApp.vpn.saveSettings({
      username: formUser,
      totpSecret: formSecret || undefined,
      ovpnPath: formOvpn,
    });
    if (res.ok && res.settings) {
      setSettings(res.settings);
      setFormSecret('');
      setShowConfig(false);
    } else {
      setError(res.error ?? '저장에 실패했습니다.');
    }
  };

  const pickOvpn = async () => {
    const { path } = await window.oneApp.vpn.pickOvpn();
    if (path) setFormOvpn(path);
  };

  // 설정 폼을 열 때 최신 설정을 다시 읽는다 (외부에서 바뀌었을 수 있음)
  const toggleConfig = async () => {
    if (!showConfig) {
      const s = await window.oneApp.vpn.getSettings();
      setSettings(s);
      setFormUser(s.username);
      setFormOvpn(s.ovpnPath);
    }
    setShowConfig((v) => !v);
  };

  const st = status.state;
  // 상태 점 — error 는 'fail'(danger 점)로 disconnected(idle)와 시각 구분 (DESIGN.md)
  const dotStatus: 'ok' | 'busy' | 'fail' | 'idle' =
    st === 'connected'
      ? 'ok'
      : st === 'connecting'
        ? 'busy'
        : st === 'error'
          ? 'fail'
          : 'idle';
  const statusText =
    st === 'connected'
      ? `연결됨${status.vpnIp ? ` · ${status.vpnIp}` : ''}`
      : st === 'connecting'
        ? (status.detail ?? '연결 중')
        : st === 'error'
          ? '연결 안 됨'
          : '연결 안 됨';
  const errorMsg = st === 'error' ? (status.error ?? error) : error;
  const ovpnName = formOvpn ? formOvpn.split('/').pop() : '';

  return (
    <div className="sbw">
      {/* 한 줄: 아이콘 · 상태 · 우측 액션 (설정 ⚙ + 연결/해제) */}
      <div className="sbw__row">
        <span className="sbw__icon">
          <Icon name="lock" size={12} />
        </span>
        <span className="sbw__label">
          <StatusDot status={dotStatus} />
          <span className="sbw__text" title={`VPN · ${statusText}`}>
            VPN · {statusText}
          </span>
        </span>
        <span className="sbw__actions">
          <button className="icon-btn" title="VPN 설정" onClick={toggleConfig}>
            <Icon name="settings" size={12} />
          </button>
          {!showConfig &&
            (st === 'connected' ? (
              <Button
                variant="danger"
                size="sm"
                onClick={disconnect}
                loading={busy}
              >
                해제
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={connect}
                loading={busy || st === 'connecting'}
              >
                연결
              </Button>
            ))}
        </span>
      </div>

      {showConfig && settings && (
        <div className="sbw__sub">
          {!settings.openvpnInstalled && (
            <p className="vpnw__warn">
              openvpn CLI 필요 — 터미널에서 <code>brew install openvpn</code>
            </p>
          )}
          <Input
            small
            placeholder="VPN 계정 이름"
            value={formUser}
            onChange={(e) => setFormUser(e.target.value)}
          />
          <Input
            small
            type="password"
            placeholder={settings.hasTotpSecret ? 'OTP 시크릿 키 (저장됨)' : 'OTP 시크릿 키'}
            value={formSecret}
            onChange={(e) => setFormSecret(e.target.value)}
          />
          <FileTrigger onClick={pickOvpn} title={formOvpn}>
            {ovpnName || '.ovpn 파일 선택…'}
          </FileTrigger>
          <Button variant="primary" size="sm" onClick={saveConfig}>
            저장
          </Button>
        </div>
      )}

      {!showConfig && st !== 'connected' && settings && !settings.hasTotpSecret && (
        <div className="sbw__sub">
          <Input
            small
            placeholder="Google OTP 6자리"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
        </div>
      )}

      {errorMsg && <p className="sbw__error">{errorMsg}</p>}
    </div>
  );
}
