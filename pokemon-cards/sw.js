/* sw.js — 오프라인 셸 + 데이터 캐시 */
const V = 'pkc-v11';
const SHELL = [
  './', './index.html', './app.css',
  './js/util.js', './js/cloud.js', './js/audio.js', './js/data.js', './js/ui.js',
  './js/shop.js', './js/dex.js', './js/battle.js', './js/more.js', './js/main.js',
  './pokemon-cards.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './assets/card-back.jpg',
  './data/packs.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => { }));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== V).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 카드 이미지(외부) — 캐시 우선
  if (url.hostname.endsWith('pokemonkorea.co.kr')) {
    e.respondWith(caches.open(V + '-img').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch (err) {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // 팩 데이터 — 네트워크 우선, 실패 시 캐시
  if (url.pathname.indexOf('/data/') >= 0) {
    e.respondWith((async () => {
      const c = await caches.open(V);
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await c.match(req);
        return hit || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // 셸 — 캐시 우선
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && url.origin === location.origin) {
        const c = await caches.open(V);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return (await caches.match('./index.html')) || new Response('offline', { status: 503 });
    }
  })());
});
