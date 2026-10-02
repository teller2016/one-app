// MO 폰 푸시 — 폰이 MO 페이지를 닫아 둬도(얼어 있어도) 입력 대기를 알린다 (Web Push · VAPID).
//
// 왜 있나: 예전 폰 알림은 **페이지가 직접** 띄웠다(controller.ts notifyWaiting). 안드로이드 Chrome 은 앱 전환·
// 화면 잠금 뒤 곧 페이지를 얼리고 소켓을 끊어, 답이 끝날 때쯤엔 알릴 주체가 없었다(2026-10-02 신고 — 폰이
// MO 를 백그라운드에 둔 채로 PC 서버 연결이 0 이었다). 웹 푸시는 PC → 브라우저 푸시 서비스(안드로이드 Chrome 은
// FCM) → 폰의 서비스 워커(`mobile-app/public/sw.js` 의 push)로 가서 페이지가 없어도 온다.
//
// 흐름: 알림을 허용한 폰이 `/term` 으로 'push-key' 를 요청 → 이 파일의 공개키로 pushManager.subscribe →
// 'push-subscribe' 로 구독 등록. 입력 대기(ipc.ts onAgentWaiting — 데스크톱 토스트와 같은 턴당 1회 판정)에서
// 등록된 폰 전부로 보낸다. MO 를 보고 있는 폰이 있으면 보내지 않는다(server.ts canPushToPhone).
//
// ⚠️ 키·구독은 **인스턴스별 파일**(runtimeFile) — 개발 인스턴스(포트+1)와 설치본은 출처(origin)가 달라 구독도
//    따로다. 한 파일을 공유하면 양쪽이 서로의 폰 구독으로 보내 알림이 겹치고, 누르면 엉뚱한 쪽이 열린다.
// ⚠️ VAPID 비밀키는 safeStorage 암호화 — 이 키가 있으면 등록된 폰에 아무 알림이나 보낼 수 있다.
// ⚠️ PC 가 푸시 서비스(fcm.googleapis.com 등)에 닿아야 한다 — 실패해도 페이지가 살아 있으면 예전 방식
//    (페이지 알림)이 그대로 남아 있다.
import crypto from 'node:crypto';
import { generateVAPIDKeys, sendNotification } from 'web-push';
import { runtimeFile } from '../../lib/devInstance';
import {
  decryptSecret,
  encryptSecret,
  readUserJson,
  whenSecretsReady,
  writeUserJson,
} from '../../lib/store';

const FILE = runtimeFile('terminal-push.json');
/** 등록 폰 상한 — 넘으면 오래된 구독부터 버린다(브라우저 데이터를 지우면 구독이 새로 생긴다) */
const MAX_SUBS = 10;
const SEND_TIMEOUT_MS = 10_000;
/** 푸시 서비스 보관 시간 — 폰이 꺼져 있다가 한참 뒤 켜졌을 때 지난 대기 알림이 우르르 오지 않게 */
const TTL_SEC = 10 * 60;
// VAPID 연락처 — 스펙상 mailto:/https: 필수다. 푸시 서비스로 나가는 값이라 개인 주소를 쓰지 않는다
const VAPID_SUBJECT = 'mailto:one-app@example.com';
// 구독 주소는 폰이 보낸 값이다 — 아무 https 주소나 받으면 PC 가 그 주소로 요청을 쏘는 통로가 되므로
// 브라우저 푸시 서비스만 받는다(Chrome·Firefox·Safari·Edge)
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

type StoredSub = { endpoint: string; keys: { p256dh: string; auth: string }; addedAt: number };
type PushStore = { publicKey?: string; privateKeyEnc?: string; subs?: StoredSub[] };
type VapidKeys = { publicKey: string; privateKey: string };

const read = (): PushStore => readUserJson<PushStore>(FILE, {});

// 복호화한 키 — 매 전송마다 키체인을 열지 않는다
let vapidCache: VapidKeys | null = null;

/** VAPID 공개키 — 없으면 키 쌍을 만든다. 키체인을 못 쓰면 null(푸시만 포기한다) */
export function getPushPublicKey(): string | null {
  const store = read();
  if (store.publicKey && store.privateKeyEnc) return store.publicKey;
  try {
    const keys = generateVAPIDKeys();
    // 키가 바뀌면 옛 구독은 쓸 수 없다(구독이 공개키에 묶인다) — 구독도 비운다
    writeUserJson(FILE, {
      publicKey: keys.publicKey,
      privateKeyEnc: encryptSecret(keys.privateKey),
      subs: [],
    });
    vapidCache = keys;
    return keys.publicKey;
  } catch (err) {
    console.error('[push] VAPID 키 생성 실패', err);
    return null;
  }
}

function vapidKeys(): VapidKeys | null {
  const store = read();
  if (!store.publicKey || !store.privateKeyEnc) return null;
  if (vapidCache?.publicKey === store.publicKey) return vapidCache;
  // 키체인을 못 쓰면 null — 재발급하지 않는다(재발급하면 등록된 폰 구독이 전부 무효가 된다)
  const privateKey = decryptSecret(store.privateKeyEnc);
  if (!privateKey) return null;
  vapidCache = { publicKey: store.publicKey, privateKey };
  return vapidCache;
}

function parseSubscription(raw: unknown): Omit<StoredSub, 'addedAt'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof r.endpoint !== 'string' || r.endpoint.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(r.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  const p256dh = r.keys?.p256dh;
  const auth = r.keys?.auth;
  if (typeof p256dh !== 'string' || p256dh.length > 200 || !B64URL.test(p256dh)) return null;
  if (typeof auth !== 'string' || auth.length > 100 || !B64URL.test(auth)) return null;
  return { endpoint: r.endpoint, keys: { p256dh, auth } };
}

/** 폰 구독 등록 — 폰은 접속할 때마다 보낸다(브라우저가 구독을 바꿨을 수 있다). 같은 구독이면 쓰지 않는다 */
export function addPushSubscription(raw: unknown): void {
  const sub = parseSubscription(raw);
  if (!sub) return;
  const store = read();
  const subs = store.subs ?? [];
  const same = subs.find((s) => s.endpoint === sub.endpoint);
  if (same && same.keys.p256dh === sub.keys.p256dh && same.keys.auth === sub.keys.auth) return;
  const rest = subs.filter((s) => s.endpoint !== sub.endpoint);
  writeUserJson(FILE, { ...store, subs: [...rest, { ...sub, addedAt: Date.now() }].slice(-MAX_SUBS) });
}

/** 등록된 폰 구독을 모두 지운다 — 접속 토큰 재발급("모든 기기 무효화")과 짝이다 */
export function clearPushSubscriptions(): void {
  const store = read();
  if (store.subs?.length) writeUserJson(FILE, { ...store, subs: [] });
}

// 같은 세션의 아직 전달 못 한 푸시는 푸시 서비스가 최신 하나로 바꾼다 — 폰이 꺼져 있는 동안 같은 세션
// 알림이 쌓이지 않게. topic 은 URL-safe base64 32자 이하라 세션 id 를 해시해 넣는다
const topicFor = (id: string) =>
  crypto.createHash('sha256').update(id).digest('base64url').slice(0, 32);

export type WaitingPush = { id: string; title: string; body: string };

/** 입력 대기 푸시 — 등록된 폰 전부로. 사라진 구독(404·410)은 지운다 */
export async function sendWaitingPush(p: WaitingPush): Promise<void> {
  const subs = read().subs ?? [];
  if (!subs.length) return;
  // 복원 세션의 대기가 이 앱의 첫 키체인 접근이 되면 창이 그려지기 전에 main 이 멈춘다(lib/store.ts)
  await whenSecretsReady();
  const keys = vapidKeys();
  if (!keys) return;
  // tag 는 페이지 알림(controller.ts notifyWaiting)과 같다 — 둘 다 와도 한 장으로 합쳐진다
  const payload = JSON.stringify({ ...p, tag: `wait:${p.id}` });
  const gone = new Set<string>();
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendNotification(sub, payload, {
          vapidDetails: { subject: VAPID_SUBJECT, ...keys },
          TTL: TTL_SEC,
          urgency: 'high', // 안드로이드 절전(Doze) 중에도 바로 깨워 보여 준다
          topic: topicFor(p.id),
          timeout: SEND_TIMEOUT_MS,
        });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.add(sub.endpoint);
        else console.warn('[push] 전송 실패', status ?? (err as Error).message);
      }
    })
  );
  if (gone.size) {
    const store = read();
    writeUserJson(FILE, { ...store, subs: (store.subs ?? []).filter((s) => !gone.has(s.endpoint)) });
  }
}
