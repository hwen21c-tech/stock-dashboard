/* 연오랑 가족 사주·만세력 — 단독 앱(scope: /stock-dashboard/saju.html) 전용 서비스 워커
   관제탑 sw.js(scope: /stock-dashboard/)와 캐시·범위를 공유하지 않습니다.
   · HTML/내비게이션: 항상 네트워크 우선(신선한 내용), 오프라인일 때만 마지막 사본
   · 매니페스트/아이콘: 네트워크 우선 + 캐시 폴백
*/
const CACHE = 'saju-pwa-v6';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(function (k) { return k.indexOf('saju-pwa-') === 0 && k !== CACHE; })
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
        throw err;
      }
    })());
    return;
  }

  e.respondWith((async function () {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const c = await caches.open(CACHE);
        c.put(req.url, res.clone());
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req.url, { ignoreSearch: true });
      if (cached) return cached;
      throw err;
    }
  })());
});
