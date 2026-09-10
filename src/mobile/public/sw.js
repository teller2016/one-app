// One App 터미널(/terminal/) — 폰 알림용 서비스 워커.
//
// 왜 있나: 안드로이드 Chrome 은 페이지의 `new Notification()` 을 거부하고("Illegal constructor")
// 서비스 워커의 `showNotification` 만 허용한다. 알림을 띄우는 쪽은 페이지(mobile.ts 의
// notifyWaiting → registration.showNotification)이고, 이 파일의 일은 **알림 클릭 처리 하나**다.
//
// ⚠️ fetch 를 가로채지 않는다 — 캐시 정책은 서버의 Cache-Control(assets 는 immutable, 나머지는
//    no-store)이 정본이다. 여기서 캐시하면 새 배포가 폰에 늦게 반영된다.
// ⚠️ 스코프는 `/terminal/` 이다(등록 경로가 그 아래) — 앱 셸 `/` 에는 아무 영향이 없다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil(
    (async () => {
      // 터미널 페이지가 이미 열려 있으면 그 창을 앞으로 가져오고 세션만 바꾼다
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const page = all.find((c) => new URL(c.url).pathname.startsWith('/terminal'));
      if (page) {
        await page.focus();
        if (id) page.postMessage({ type: 'focus-session', id });
        return;
      }
      // 닫혀 있으면 새로 열되, 어느 세션부터 보여줄지 쿼리로 넘긴다(mobile.ts 가 읽고 지운다)
      await self.clients.openWindow(
        id ? `/terminal/?session=${encodeURIComponent(id)}` : '/terminal/'
      );
    })()
  );
});
