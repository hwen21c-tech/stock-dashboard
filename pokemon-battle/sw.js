/* ============================================================
   포켓몬 배틀 월드 — 독립 PWA 서비스워커
   · 이 파일은 /stock-dashboard/pokemon-battle/sw.js 이고 scope 는 이 폴더뿐이다.
   · 같은 오리진의 '연오랑 관제탑'(/sw.js, scope: /) · '카드팩'(/pokemon-cards/) ·
     'eBook'(/ebook/) 과는 완전히 별개 앱으로 인식된다.
   · 캐시 이름에 pkm-world- 접두사를 붙여 다른 앱 워커의 캐시 정리와 섞이지 않게 한다.
   · 경로는 모두 상대경로 — 워커 파일 위치(이 폴더)를 기준으로 찾는다.
   ============================================================ */
const PREFIX = 'pkm-world-';
const VERSION = PREFIX + 'static-v2';  /* 2026-11-18 경량 선캐시(설치 속도 개선) + 나머지 에셋은 실행 시 자동 캐시 */
const SHELL = [
  './',
  './manifest.json',
  './index.html',
  './pokemon-battle2.css',
  './pokemon-battle2.js',
  './pokemon-coins.js',
  './pokemon-sync.js',
  './pokemon-battle-icon-192.png',
  './pokemon-battle-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 하나가 실패해도 나머지는 담는다(첫 설치가 통째로 깨지지 않게).
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // 외부(포켓몬 스프라이트 CDN, Supabase 클라우드, TTS 함수)는 손대지 않고 브라우저에 맡긴다.
  if (url.origin !== self.location.origin) return;
  // 이 앱 폴더 밖(관제탑·카드팩·eBook 등)은 절대 건드리지 않는다.
  if (!url.pathname.startsWith(self.registration.scope.replace(self.location.origin, ''))) return;

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
        if (req.mode === 'navigate') {
          const home = await cache.match('./index.html');
          if (home) return home;
        }
      }
      throw err;
    }
  })());
});
