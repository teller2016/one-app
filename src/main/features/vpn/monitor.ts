// VPN 터널 감시 — connected 동안 물리 인터페이스 변화(5초 폴링)와 주기 프로브(30초)로
// 죽은 터널을 찾아 stale 표시·알림하고, TOTP 시크릿이 있으면 SIGHUP 으로 자동 재연결한다
// (데몬이 root 로 살아 있어 관리자 인증이 다시 필요 없다). 살아 있어도 기본 인터페이스가
// 바뀌어 터널이 옛 인터페이스(와이파이)에 남았으면 새 인터페이스(유선)로 옮긴다.
// 판정 규칙·프로브는 health.ts.
import { app, powerMonitor } from 'electron';
import os from 'node:os';
import { notify, sendToast } from '../notify/notify';
import { isSystemAsleep } from '../power';
import {
  IFACE_POLL_MS,
  IFACE_SETTLE_MS,
  PROBE_INTERVAL_MS,
  PROBE_RETRY_MS,
  RESUME_GRACE_MS,
  inReconnectCooldown,
  inspectRoutes,
  interfaceFingerprint,
  interfaceLabel,
  isDetoured,
  isServerReachable,
  judgeProbe,
  probeTunnel,
  reconnectDecision,
  resetInterfaceLabels,
  type ProbeResult,
  type RouteView,
} from './health';
import {
  getVpnServer,
  getVpnStatus,
  onVpnStatus,
  reconnectVpn,
  setVpnStale,
  wasDisconnectedByUser,
} from './openvpn';
import { getVpnCredentials } from './store';

/** 감시 토스트는 한 장만 유지한다 — 응답 없음 → 재연결 중 → 재연결됨 이 같은 자리에서 바뀐다 */
const TOAST_KEY = 'vpn-health';

type Interval = ReturnType<typeof setInterval> | null;
type Timeout = ReturnType<typeof setTimeout> | null;
let ifaceTimer: Interval = null;
let probeTimer: Interval = null;
let settleTimer: Timeout = null;
let retryTimer: Timeout = null;
let fingerprint = '';
let failures = 0;
let probing = false;
// 프로브 중에 트리거(인터페이스 변화·주기)가 왔다 — 진행 중 프로브는 옛 네트워크의 결과일 수 있으니 끝난 뒤 한 번 더 돈다.
// 없으면 트리거가 조용히 삼켜져 다음 점검이 30초 주기까지 미뤄졌다
let rerunRequested = false;
// 잠자기 복귀 직후 판정 유예 만료 시각 — 그 전엔 프로브를 건너뛴다(health.ts RESUME_GRACE_MS)
let resumeGraceUntil = 0;
// 경로 옮기기를 시도한 네트워크 구성 — 옮겨도 정렬이 안 되면 같은 구성에서 30초마다 흔들지 않는다
let followedFor: string | null = null;
let lastAutoReconnectAt = 0; // 자동 SIGHUP 쿨다운 기준
const inCooldown = () => inReconnectCooldown(lastAutoReconnectAt, Date.now());
// 프로브·도달 확인은 합쳐 십수 초 걸린다 — 그 사이 OpenVPN 이 스스로 RECONNECTING 으로 갔으면(proto tcp 소켓 리셋 등,
// 상태는 connecting) 우리가 끼어들 일이 아니다. await 뒤마다 확인해 옛 터널의 판정으로 토스트·SIGHUP 을 내지 않는다.
// 끼어들면 reconnectVpn 이 "연결된 상태에서만" 으로 throw 해 헛된 실패 알럿이 떴다(2026-09-07 리뷰)
const stillConnected = () => getVpnStatus().state === 'connected';

/** 상태 구독을 걸고, 이미 연결돼 있으면(앱 재시작 후 재접속) 바로 감시를 시작한다 */
export function startVpnHealthMonitor() {
  onVpnStatus((st) => {
    if (st.state === 'connected') arm();
    else disarm();
  });
  if (getVpnStatus().state === 'connected') arm();
  // powerMonitor 는 app ready 뒤에만 쓸 수 있다 — 이 함수는 main.ts 최상위(registerVpnIpc)에서 ready 전에 불린다
  void app.whenReady().then(() => {
    powerMonitor.on('resume', onResume);
  });
}

/** 잠자기 복귀 — 잠들기 전 누적 실패를 버리고, 소켓이 회복될 시간 동안 판정을 유예한다 */
function onResume() {
  failures = 0;
  resumeGraceUntil = Date.now() + RESUME_GRACE_MS;
}

function arm() {
  if (ifaceTimer) return; // 이미 감시 중 — stale 토글 등 connected 안에서의 갱신
  fingerprint = interfaceFingerprint(os.networkInterfaces());
  failures = 0;
  ifaceTimer = setInterval(checkInterfaces, IFACE_POLL_MS);
  probeTimer = setInterval(() => void runProbe(), PROBE_INTERVAL_MS);
}

function disarm() {
  if (ifaceTimer) clearInterval(ifaceTimer);
  if (probeTimer) clearInterval(probeTimer);
  if (settleTimer) clearTimeout(settleTimer);
  if (retryTimer) clearTimeout(retryTimer);
  ifaceTimer = probeTimer = settleTimer = retryTimer = null;
  rerunRequested = false; // connected 를 벗어났다 — 빚진 재점검은 무효, 다시 connected 가 되면 새 주기가 돈다
}

function checkInterfaces() {
  if (isSystemAsleep()) return; // 다크웨이크의 반쪽짜리 네트워크 상태로 판정하지 않는다 — 복귀 뒤 다음 틱이 본다
  const next = interfaceFingerprint(os.networkInterfaces());
  if (next === fingerprint) return;
  fingerprint = next;
  // 네트워크 구성이 바뀌었으니 경로 옮기기를 다시 허용한다 — 같은 지문이 돌아와도(뽑았다 다시 꽂음)
  // 새 구성이다. 지문 값 비교로 막으면 두 번째 꽂기부터 옮기지 않는다(2026-09-07 실측)
  followedFor = null;
  resetInterfaceLabels(); // 새 어댑터일 수 있다 — 라벨 캐시를 비워 장치명(en8) 대신 이름이 나오게
  // 인터페이스가 바뀌었다(유선 꽂기/빼기·와이파이 토글) — 경로 재구성이 끝날 시간을 주고 점검
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => void runProbe(), IFACE_SETTLE_MS);
}

async function runProbe() {
  if (isSystemAsleep()) return; // 잠자기 중 프로브는 잠든 소켓의 실패만 세운다 (resume 유예와 별개로 아예 돌지 않는다)
  if (getVpnStatus().state !== 'connected') return;
  if (probing) {
    rerunRequested = true;
    return;
  }
  if (Date.now() < resumeGraceUntil) return; // 잠자기 복귀 유예 — 유예 뒤 다음 주기 프로브가 자연히 온다
  probing = true;
  try {
    const routes = await inspectRoutes(getVpnServer()?.ip ?? null);
    const result = await probeTunnel(routes);
    if (!stillConnected()) return; // 프로브 사이 데몬이 스스로 재연결에 들어갔다 — 이 결과는 옛 터널 것
    if (Date.now() < resumeGraceUntil) return; // 프로브 도중 잠들었다 깼다 — 이 결과는 잠든 소켓 것, 실패로 세지 않는다
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
    if (rerunRequested) {
      rerunRequested = false;
      // 재귀 대신 다음 틱 — 이 finally 의 호출 스택을 끊고, 그 사이 disarm 됐으면 runProbe 의 connected 검사가 걸러낸다
      if (stillConnected()) setTimeout(() => void runProbe(), 0);
    }
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
  // ⚠️ 여기엔 사망 복구 같은 도달 게이트가 없다 — "새 인터페이스 쪽 길로 서버에 닿는가"는 root 없이 검사할 수 없다
  // (health.ts isServerReachable 주석의 실측). 새 기본 네트워크가 서버에 못 닿는 격리 랜이면 SIGHUP 뒤 재시도
  // 소진으로 데몬을 잃는 위험이 남는다 — 알고 감수한다(살아 있는 터널을 그대로 두면 인터넷은 옛 길로 계속 된다)
  const label = await interfaceLabel(routes.defaultIface!);
  if (!stillConnected()) return;
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

/**
 * 재연결 실패 알림 — 그 사이 사용자가 [연결 해제]로 데몬을 끝냈거나(SIGTERM → disconnected) OpenVPN 이 스스로
 * 재연결에 들어갔으면(connecting) 우리 실패가 아니다. 우리 SIGHUP 의 실패는 waitForConnected 가 error·disconnected
 * 로 만든 뒤 reject 하므로 connecting 으로 여기 오는 경우는 그 자체 RECONNECTING 뿐이다 — 결과는 상태 리스너가 받는다.
 * ⚠️ disconnected 는 사용자 해제만이 아니다 — 데몬이 사유 없이 죽어도(외부 kill·크래시, openvpn.ts close 핸들러)
 * 같은 상태가 되므로 `wasDisconnectedByUser()` 로 구분해 그 경우엔 알린다.
 * 여기의 await 는 감시를 막지 않는다 — 실패 뒤 상태가 error·disconnected 라 이미 disarm 됐다
 */
async function reportReconnectFailure(title: string, err: unknown) {
  const { state } = getVpnStatus();
  if (state === 'connecting') return;
  if (state === 'disconnected' && wasDisconnectedByUser()) return;
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
  if (!stillConnected()) return; // 도달 확인 사이 데몬이 스스로 재연결에 들어갔다
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
    // 자동 재인증 수단이 없다 — 알럿으로 확실히 알리고 사용자가 OTP 를 넣어 재연결하게 한다.
    // ⚠️ 기다리지 않는다(void) — 여기는 probing 구간 안이라 await 하면 사용자가 모달을 닫을 때까지 감시가 멈춘다
    if (!wasStale) {
      void notify({
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
