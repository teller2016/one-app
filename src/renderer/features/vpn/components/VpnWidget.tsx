import { useEffect, useState } from 'react';
import type { VpnSettingsView, VpnStatus } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';

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
  const dotMod = st === 'connected' ? 'on' : st === 'connecting' ? 'busy' : 'off';
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
    <div className="vpnw">
      <div className="vpnw__head">
        <span className="vpnw__title">🔒 VPN</span>
        <button className="icon-btn" title="VPN 설정" onClick={toggleConfig}>
          ⚙
        </button>
      </div>

      <div className="vpnw__status">
        <span className={`vpnw__dot vpnw__dot--${dotMod}`} />
        <span className="vpnw__status-text" title={statusText}>
          {statusText}
        </span>
      </div>

      {showConfig && settings && (
        <div className="vpnw__form">
          {!settings.openvpnInstalled && (
            <p className="vpnw__warn">
              openvpn CLI 필요 — 터미널에서 <code>brew install openvpn</code>
            </p>
          )}
          <Input
            className="vpnw__input"
            placeholder="VPN 계정 이름"
            value={formUser}
            onChange={(e) => setFormUser(e.target.value)}
          />
          <Input
            className="vpnw__input"
            type="password"
            placeholder={settings.hasTotpSecret ? 'OTP 시크릿 키 (저장됨)' : 'OTP 시크릿 키'}
            value={formSecret}
            onChange={(e) => setFormSecret(e.target.value)}
          />
          <button className="vpnw__file" onClick={pickOvpn} title={formOvpn}>
            {ovpnName || '.ovpn 파일 선택…'}
          </button>
          <Button variant="primary" className="vpnw__btn" onClick={saveConfig}>
            저장
          </Button>
        </div>
      )}

      {!showConfig && st !== 'connected' && settings && !settings.hasTotpSecret && (
        <Input
          className="vpnw__input"
          placeholder="Google OTP 6자리"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
        />
      )}

      {!showConfig &&
        (st === 'connected' ? (
          <Button
            variant="danger"
            className="vpnw__btn"
            onClick={disconnect}
            disabled={busy}
          >
            연결 해제
          </Button>
        ) : (
          <Button
            variant="primary"
            className="vpnw__btn"
            onClick={connect}
            disabled={busy || st === 'connecting'}
          >
            {st === 'connecting' ? '연결 중…' : 'VPN 연결'}
          </Button>
        ))}

      {errorMsg && <p className="vpnw__error">{errorMsg}</p>}
    </div>
  );
}
