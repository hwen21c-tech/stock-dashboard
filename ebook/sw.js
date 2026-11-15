/* ============================================================
   연오랑 eBook 오디오북 — 독립 PWA 서비스워커
   · 이 파일은 /ebook/sw.js 이고 scope 는 /ebook/ 으로 한정된다.
   · 같은 오리진의 '연오랑 관제탑'(/sw.js, scope: /) 과는 완전히 별개 앱이다.
   · 캐시 이름에 ebook-reader- 접두사를 붙여, 관제탑 워커의 캐시 정리와 섞이지 않게 한다.
   ============================================================ */
const PREFIX = 'ebook-reader-';
const VERSION = PREFIX + 'v3';
/* 상대 경로로 적는다 — Vercel(/ebook/) 에서도, GitHub Pages(/stock-dashboard/ebook/) 에서도
   서비스워커 파일 위치를 기준으로 같은 파일을 찾는다 */
const SHELL = [
  './manifest.json',
  '../ebook.html',
  '../ebook-sync.js',
  '../ebook-icon.svg',
  '../ebook-icon-192.png',
  '../ebook-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 하나가 실패해도 나머지는 담는다 (첫 설치가 통째로 깨지지 않게)
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(PREFIX) && k !== VERSION).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // 다른 오리진과 API(/api/tts 음성)는 손대지 않고 브라우저에 맡긴다.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION).catch(() => null);
    try {
      // 화면(HTML)은 항상 최신, 나머지는 브라우저 기본 캐시 정책을 따른다.
      const res = await fetch(req, req.mode === 'navigate' ? { cache: 'no-store' } : undefined);
      if (cache && res && res.ok && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      if (cache) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
      }
      throw err;
    }
  })());
});
