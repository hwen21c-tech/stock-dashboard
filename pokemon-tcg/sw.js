/* 포켓몬 카드 배틀 TCG — 오프라인 셸 + 카드 이미지 캐시
   2026-11-18: 캐시 정리를 'tcg-' 접두사로 한정. 이전에는 k !== SHELL && k !== IMG 필터로
   같은 오리진의 다른 앱(관제탑·카드팩·배틀 월드·eBook·사주) 캐시까지 지웠다. */
const PREFIX = 'tcg-';
const SHELL = PREFIX + 'shell-v4';
const IMG = PREFIX + 'img-v1';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './data.js', './sfx.js', './vfx.js',
  './pokemon-tcg.webmanifest', './icons/tcg-192.png', './icons/tcg-512.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== SHELL && k !== IMG).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 카드 이미지(포켓몬코리아) → 캐시 우선 (한 번 받으면 오프라인에서도)
  if (/pokemoncard\.co\.kr$/.test(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(IMG);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req, { mode: 'no-cors' });
        cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // 앱 셸 → 네트워크 우선, 실패 시 캐시
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      const cache = await caches.open(SHELL);
      cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const cache = await caches.open(SHELL);
      return (await cache.match(req)) || (await cache.match('./index.html')) || Response.error();
    }
  })());
});
