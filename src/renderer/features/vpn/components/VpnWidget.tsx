import { useEffect, useState } from 'react';
import type { VpnSettingsView, VpnStatus } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { FileTrigger } from '../../../components/FileTrigger';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { SidebarWidget } from '../../../components/SidebarWidget';
import { StatusDot } from '../../../components/StatusDot';

/** 사이드바 하단 VPN 위젯 — OpenVPN 연결 상태 표시 + 연결/해제 */
export function VpnWidget() {
  const [settings, setSettings] = useState<VpnSettingsView | null>(null);
  const [status, setStatus] = useState<VpnStatus>({ state: 'disconnected' });
  // 어느 버튼이 진행 중인지 — 연결됨 상태엔 [재연결]·[연결 해제] 두 버튼이 나란히 있다
  const [busy, setBusy] = useState<'connect' | 'reconnect' | 'disconnect' | null>(null);
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
    setBusy('connect');
    setError('');
    const res = await window.oneApp.vpn.connect(otp.trim() || undefined);
    if (!res.ok) setError(res.error ?? '연결에 실패했습니다.');
    else setOtp('');
    setBusy(null);
  };

  // 관리자 인증 없이 터널을 다시 세운다 — 네트워크 전환 뒤 '응답 없음' 복구용
  const reconnect = async () => {
    setBusy('reconnect');
    setError('');
    const res = await window.oneApp.vpn.reconnect(otp.trim() || undefined);
    if (!res.ok) setError(res.error ?? '재연결에 실패했습니다.');
    else setOtp('');
    setBusy(null);
  };

  const disconnect = async () => {
    setBusy('disconnect');
    setError('');
    const res = await window.oneApp.vpn.disconnect();
    if (!res.ok) setError(res.error ?? '해제에 실패했습니다.');
    setBusy(null);
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
  // 연결됨인데 터널이 응답하지 않는다(네트워크 전환 뒤) — 감시가 판정, 재연결로 복구
  const stale = st === 'connected' && !!status.stale;
  // 상태 점 — error 는 'fail'(danger 점)로 disconnected(idle)와 시각 구분 (DESIGN.md)
  const dotStatus: 'ok' | 'busy' | 'fail' | 'idle' =
    st === 'connected'
      ? stale
        ? 'fail'
        : 'ok'
      : st === 'connecting'
        ? 'busy'
        : st === 'error'
          ? 'fail'
          : 'idle';
  const statusText =
    st === 'connected'
      ? stale
        ? '응답 없음 · 재연결 필요'
        : `연결됨${status.vpnIp ? ` · ${status.vpnIp}` : ''}`
      : st === 'connecting'
        ? (status.detail ?? '연결 중')
        : st === 'error'
          ? '연결 안 됨'
          : '연결 안 됨';
  const errorMsg = st === 'error' ? (status.error ?? error) : error;
  const ovpnName = formOvpn ? formOvpn.split('/').pop() : '';
  // 아이콘·상태점은 축소 타일에도 그대로 쓴다 (SidebarWidget 이 팝오버 진입점으로 삼는다)
  const icon = <Icon name="lock" size={12} />;
  const dot = <StatusDot status={dotStatus} />;
  const tooltip = `VPN — ${statusText}`;

  return (
    // 사이드바를 접으면 글자가 감춰지므로 툴팁이 상태를 대신하고, 조작은 팝오버로 넘어간다
    <SidebarWidget icon={icon} dot={dot} tooltip={tooltip}>
      <div className="sbw" title={tooltip}>
        {/* 한 줄: 아이콘 · 상태 · 우측 액션 (설정 ⚙ + 연결/해제) */}
        <div className="sbw__row">
          <span className="sbw__icon">{icon}</span>
          <span className="sbw__label">
            {dot}
            {/* 자물쇠 아이콘이 VPN 정체성 — 접두사 없이 상태만 (말줄임 방지) */}
            <span className="sbw__text" title={tooltip}>
              {statusText}
            </span>
          </span>
          <span className="sbw__actions">
            <button className="icon-btn" title="VPN 설정" onClick={toggleConfig}>
              <Icon name="settings" size={12} />
            </button>
          </span>
        </div>

        {/* 액션 줄 — 연결/해제 (설정 폼이 열려 있으면 폼의 저장 버튼이 대신함) */}
        {!showConfig && (
          <div className="sbw__buttons">
            {st === 'connected' ? (
              <>
                {/* 응답 없음이면 재연결이 주 동작 — 평소엔 조용한 ghost */}
                <Button
                  variant={stale ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={reconnect}
                  loading={busy === 'reconnect'}
                  disabled={busy === 'disconnect'}
                >
                  재연결
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={disconnect}
                  loading={busy === 'disconnect'}
                  disabled={busy === 'reconnect'}
                >
                  연결 해제
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={connect}
                loading={busy === 'connect' || st === 'connecting'}
              >
                VPN 연결
              </Button>
            )}
          </div>
        )}

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
              placeholder={
                settings.hasTotpSecret ? 'OTP 시크릿 키 (저장됨)' : 'OTP 시크릿 키'
              }
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

        {/* 시크릿이 없으면 연결·재연결 모두 OTP 를 손으로 넣는다 — 정상 연결 중에도 [재연결]이 항상 있으니 칸도 항상 둔다
            (connected 에서 숨기면 재연결을 눌러도 "OTP를 입력하거나…" 오류만 떴다) */}
        {!showConfig && settings && !settings.hasTotpSecret && (
          <div className="sbw__sub">
            <Input
              small
              placeholder={st === 'connected' && !stale ? 'Google OTP 6자리 (재연결 시)' : 'Google OTP 6자리'}
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </div>
        )}

        {errorMsg && <p className="sbw__error">{errorMsg}</p>}
      </div>
    </SidebarWidget>
  );
}
