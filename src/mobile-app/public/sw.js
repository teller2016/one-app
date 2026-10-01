// One App 폰(MO) — 알림용 서비스 워커.
//
// 왜 있나: 안드로이드 Chrome 은 페이지의 `new Notification()` 을 거부하고("Illegal constructor")
// 서비스 워커의 `showNotification` 만 허용한다. 알림을 띄우는 쪽은 페이지(터미널 컨트롤러의
// notifyWaiting → registration.showNotification)이고, 이 파일의 일은 **알림 클릭 처리 하나**다.
//
// ⚠️ fetch 를 가로채지 않는다 — 캐시 정책은 서버의 Cache-Control(assets 는 immutable, 나머지는
//    no-store)이 정본이다. 여기서 캐시하면 새 배포가 폰에 늦게 반영된다.
// 스코프는 `/`(셸 전체). 옛 터미널 페이지가 `/terminal/` 스코프로 깔아 둔 워커도 서버가 같은 이
// 파일(`/terminal/sw.js`)을 주므로 갱신되어 같은 일을 한다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil(
    (async () => {
      // 셸이 이미 열려 있으면 그 창을 앞으로 가져오고 세션만 바꾼다(터미널 탭이 받는다)
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const page = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (page) {
        await page.focus();
        if (id) page.postMessage({ type: 'focus-session', id });
        return;
      }
      // 닫혀 있으면 새로 열되, 어느 세션부터 보여줄지 쿼리로 넘긴다(터미널 컨트롤러가 읽고 지운다)
      await self.clients.openWindow(id ? `/?session=${encodeURIComponent(id)}` : '/');
    })()
  );
});
