// VPN 터널 감시 — connected 동안 물리 인터페이스 변화(5초 폴링)와 주기 프로브(30초)로
// 죽은 터널을 찾아 stale 표시·알림하고, TOTP 시크릿이 있으면 SIGHUP 으로 자동 재연결한다
// (데몬이 root 로 살아 있어 관리자 인증이 다시 필요 없다). 살아 있어도 기본 인터페이스가
// 바뀌어 터널이 옛 인터페이스(와이파이)에 남았으면 새 인터페이스(유선)로 옮긴다.
// 판정 규칙·프로브는 health.ts.
import os from 'node:os';
import { notify, sendToast } from '../notify/notify';
import {
  IFACE_POLL_MS,
  IFACE_SETTLE_MS,
  MIN_AUTO_RECONNECT_GAP_MS,
  PROBE_INTERVAL_MS,
  PROBE_RETRY_MS,
  inspectRoutes,
  interfaceFingerprint,
  interfaceLabel,
  isDetoured,
  isServerReachable,
  judgeProbe,
  probeTunnel,
  reconnectDecision,
  type ProbeResult,
  type RouteView,
} from './health';
import {
  getVpnServer,
  getVpnStatus,
  onVpnStatus,
  reconnectVpn,
  setVpnStale,
} from './openvpn';
import { getVpnCredentials } from './store';

/** 감시 토스트는 한 장만 유지한다 — 응답 없음 → 재연결 중 → 재연결됨 이 같은 자리에서 바뀐다 */
const TOAST_KEY = 'vpn-health';

type Timer = ReturnType<typeof setTimeout> | null;
let ifaceTimer: Timer = null;
let probeTimer: Timer = null;
let settleTimer: Timer = null;
let retryTimer: Timer = null;
let fingerprint = '';
let failures = 0;
let probing = false;
// 경로 옮기기를 시도한 네트워크 구성 — 옮겨도 정렬이 안 되면 같은 구성에서 30초마다 흔들지 않는다
let followedFor: string | null = null;
let lastAutoReconnectAt = 0; // 자동 SIGHUP 쿨다운 기준
const inCooldown = () => Date.now() - lastAutoReconnectAt < MIN_AUTO_RECONNECT_GAP_MS;

/** 상태 구독을 걸고, 이미 연결돼 있으면(앱 재시작 후 재접속) 바로 감시를 시작한다 */
export function startVpnHealthMonitor() {
  onVpnStatus((st) => {
    if (st.state === 'connected') arm();
    else disarm();
  });
  if (getVpnStatus().state === 'connected') arm();
}

function arm() {
  if (ifaceTimer) return; // 이미 감시 중 — stale 토글 등 connected 안에서의 갱신
  fingerprint = interfaceFingerprint(os.networkInterfaces());
  failures = 0;
  ifaceTimer = setInterval(checkInterfaces, IFACE_POLL_MS);
  probeTimer = setInterval(() => void runProbe(), PROBE_INTERVAL_MS);
}

function disarm() {
  for (const t of [ifaceTimer, probeTimer, settleTimer, retryTimer]) if (t) clearTimeout(t);
  ifaceTimer = probeTimer = settleTimer = retryTimer = null;
}

function checkInterfaces() {
  const next = interfaceFingerprint(os.networkInterfaces());
  if (next === fingerprint) return;
  fingerprint = next;
  // 네트워크 구성이 바뀌었으니 경로 옮기기를 다시 허용한다 — 같은 지문이 돌아와도(뽑았다 다시 꽂음)
  // 새 구성이다. 지문 값 비교로 막으면 두 번째 꽂기부터 옮기지 않는다(2026-09-07 실측)
  followedFor = null;
  // 인터페이스가 바뀌었다(유선 꽂기/빼기·와이파이 토글) — 경로 재구성이 끝날 시간을 주고 점검
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => void runProbe(), IFACE_SETTLE_MS);
}

async function runProbe() {
  if (probing || getVpnStatus().state !== 'connected') return;
  probing = true;
  try {
    const routes = await inspectRoutes(getVpnServer()?.ip ?? null);
    const result = await probeTunnel(routes);
    const judged = judgeProbe(result, failures);
    failures = judged.failures;
    if (judged.verdict === 'alive') {
      // 스스로 살아났으면(와이파이 복귀 등) 응답 없음 표시와 토스트를 걷는다
      if (getVpnStatus().stale) {
        setVpnStale(false);
        sendToast({ message: 'VPN 터널 응답 복구', variant: 'ok', dedupeKey: TOAST_KEY });
      }
      if (isDetoured(routes) && followedFor !== fingerprint) await followDefaultInterface(routes);
      return;
    }
    if (judged.verdict === 'suspect') {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void runProbe(), PROBE_RETRY_MS);
      return;
    }
    await onTunnelDead(result as Exclude<ProbeResult, 'ok'>, routes);
  } finally {
    probing = false;
  }
}

/**
 * 살아 있지만 기본이 아닌 인터페이스를 타는 터널을 기본 인터페이스로 옮긴다 — 유선을 꽂았는데
 * 와이파이 경로에 남은 경우. 시크릿이 없으면 OTP 를 받아야 하니 건드리지 않는다(느릴 뿐 동작한다).
 */
async function followDefaultInterface(routes: RouteView) {
  if (inCooldown()) return; // followedFor 를 남기지 않아 다음 프로브에서 다시 시도한다
  followedFor = fingerprint;
  if (!getVpnCredentials()?.totpSecret) return;
  const label = await interfaceLabel(routes.defaultIface!);
  sendToast({
    title: 'VPN 경로 변경',
    message: `기본 네트워크가 ${label} 로 바뀌어 터널을 옮깁니다.`,
    variant: 'info',
    sticky: true,
    dedupeKey: TOAST_KEY,
  });
  lastAutoReconnectAt = Date.now();
  try {
    await reconnectVpn();
    const ip = getVpnStatus().vpnIp;
    sendToast({
      message: `VPN 재연결됨${ip ? ` · ${ip}` : ''} — ${label} 경로로 옮겼습니다.`,
      variant: 'ok',
      sticky: true,
      dedupeKey: TOAST_KEY,
    });
  } catch (err) {
    await reportReconnectFailure('VPN 경로 변경 실패', err);
  }
}

/** 재연결 실패 알림 — 그 사이 사용자가 [연결 해제]로 데몬을 끝냈으면(SIGTERM → disconnected) 실패가 아니다 */
async function reportReconnectFailure(title: string, err: unknown) {
  if (getVpnStatus().state === 'disconnected') return;
  await notify({ title, body: `${(err as Error).message}\nVPN 위젯에서 다시 연결하세요.` });
}

async function onTunnelDead(result: Exclude<ProbeResult, 'ok'>, routes: RouteView) {
  const wasStale = !!getVpnStatus().stale; // 이미 알린 상태면 같은 알림을 반복하지 않는다
  setVpnStale(true);

  // 지금 재연결해도 성공할 수 있는가 — 실패하면 재시도 소진으로 데몬이 죽어 관리자 인증부터 다시 해야 한다.
  // 물리 네트워크가 돌아오면 인터페이스 변화·주기 프로브가 다시 여기로 온다
  const server = getVpnServer();
  const reachable =
    result === 'unreachable' && server?.port ? await isServerReachable(server) : null;
  if (reconnectDecision(result, routes, reachable) === 'wait') {
    if (!wasStale) {
      sendToast({
        title: 'VPN 터널 응답 없음',
        message: '네트워크 연결이 없거나 불안정합니다. 복구되면 다시 확인합니다.',
        variant: 'fail',
        sticky: true,
        dedupeKey: TOAST_KEY,
      });
    }
    return;
  }

  const cred = getVpnCredentials();
  if (!cred?.totpSecret) {
    // 자동 재인증 수단이 없다 — 알럿으로 확실히 알리고 사용자가 OTP 를 넣어 재연결하게 한다
    if (!wasStale) {
      await notify({
        title: 'VPN 터널 응답 없음',
        body: '네트워크가 바뀐 뒤 VPN 이 끊긴 것 같습니다. VPN 위젯에서 OTP 를 입력하고 [재연결]을 누르세요.',
      });
    }
    return;
  }

  if (inCooldown()) {
    // 방금 자동 재연결을 했는데 또 죽었다 — 접촉 불량·불안정 회선일 수 있으니 연달아 흔들지 않는다
    if (!wasStale) {
      sendToast({
        title: 'VPN 터널 응답 없음',
        message: '방금 재연결했습니다 — 잠시 뒤 다시 확인합니다.',
        variant: 'fail',
        sticky: true,
        dedupeKey: TOAST_KEY,
      });
    }
    return;
  }

  sendToast({
    title: 'VPN 터널 응답 없음',
    message: '네트워크가 바뀐 것 같습니다 — 재연결합니다.',
    variant: 'fail',
    sticky: true,
    dedupeKey: TOAST_KEY,
  });
  lastAutoReconnectAt = Date.now();
  try {
    await reconnectVpn();
    const ip = getVpnStatus().vpnIp;
    // 자리를 비운 사이 스스로 고쳤어도 무슨 일이 있었는지 알 수 있게 남겨 둔다(✕ 로 닫음)
    sendToast({
      message: `VPN 재연결됨${ip ? ` · ${ip}` : ''} — 네트워크 전환으로 터널을 다시 세웠습니다.`,
      variant: 'ok',
      sticky: true,
      dedupeKey: TOAST_KEY,
    });
  } catch (err) {
    await reportReconnectFailure('VPN 재연결 실패', err);
  }
}
