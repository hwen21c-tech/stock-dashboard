/* 이차전지 실무 대백과 — 단독 앱(scope: /stock-dashboard/battery-bible.html) 전용 서비스 워커
   관제탑 sw.js(scope: /stock-dashboard/)와 캐시·범위를 공유하지 않습니다.
   · HTML/내비게이션: 항상 네트워크 우선(신선한 내용), 오프라인일 때만 마지막 사본
   · 매니페스트/아이콘: 네트워크 우선 + 캐시 폴백
*/
const CACHE = 'battery-bible-v1';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(function (k) { return k.indexOf('battery-bible-') === 0 && k !== CACHE; })
          .map(function (k) { return caches.delete(k); })
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 1) 문서(내비게이션): network-first, 실패 시 캐시 사본
  if (req.mode === 'navigate') {
    e.respondWith((async function () {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res && res.ok) {
          const c = await caches.open(CACHE);
          c.put(req.url, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req.url, { ignoreSearch: true });
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<body style="margin:0;background:#070c14;color:#dfe8f2;font:15px/1.7 -apple-system,system-ui,sans-serif;padding:40px 22px">' +
          '<h2 style="color:#3ddad0;font-size:17px">오프라인 상태입니다</h2>' +
          '<p style="color:#8ea3b8">이차전지 실무 대백과는 처음 한 번 열어 두면 오프라인에서도 열립니다. 네트워크에 연결한 뒤 다시 열어 주세요.</p></body>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // 2) 매니페스트·아이콘: network-first + 캐시 폴백
  if (/\/icons\//.test(url.pathname) || /\.webmanifest$/.test(url.pathname)) {
    e.respondWith((async function () {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const c = await caches.open(CACHE);
          c.put(req, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })());
  }
});
