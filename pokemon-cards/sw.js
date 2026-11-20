/* sw.js — 오프라인 셸 + 데이터 캐시
   2026-11-18: 캐시 정리를 'pkc-' 접두사로 한정. 이전에는 k !== V 필터로 같은 오리진의
   다른 앱(관제탑·배틀 월드·eBook·사주) 캐시와 자기 카드 이미지 캐시까지 지웠다.
   2026-11-18 v18: 배경 자동 동기화가 화면을 다시 그리지 않게(스크롤 튐·칩 깜빡임) 고친 셸.
   2026-11-18 v20: AI 난이도(쉬움·보통·어려움) · 사람끼리 1:1 전적/연승 · 카드 ⚡파워 · 5승 무료팩 · 배틀 칭호.
   2026-11-18 v21: ⭐ 최애 해제가 동기화에 되살아나지 않게(카드별 favAt) · 가로형 카드(BREAK) 안 잘리게 ·
                   도감 첫 진입에서 '0장 · 조건에 맞는 카드가 없어요'가 뜨지 않게(로드 약속 공유·렌더 순번).
   2026-11-20 v22: 🤖 컴퓨터(연습게임) 대전 승리 코인 지급 제거 — 코인은 사람끼리 1:1 대전에서만.
   2026-11-20 v23: 🤖 연습게임 승리 안내를 한 줄로 정리('연습게임은 코인이 지급되지 않아요'). */
const PREFIX = 'pkc-';
const V = PREFIX + 'v23';          /* 셸·팩 데이터 */
const IMG = PREFIX + 'img-v1';     /* 카드 이미지 — 셸 버전과 분리해 업데이트 때 지우지 않는다 */
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
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // 구 이미지 캐시(pkc-v*-img)는 새 상수 이름(IMG)으로 1회 옮겨 담는다.
    //  → 셸 버전이 올라가도 태블릿에 받아 둔 카드 그림이 사라지지 않는다.
    try {
      const dest = await caches.open(IMG);
      for (const old of keys.filter(k => k !== IMG && /^pkc-v\d+-img$/.test(k))) {
        const src = await caches.open(old);
        for (const req of await src.keys()) {
          if (!(await dest.match(req))) {
            const res = await src.match(req);
            if (res) await dest.put(req, res);
          }
        }
      }
    } catch (err) { /* 이관 실패해도 아래 정리는 진행 */ }
    await Promise.all(
      keys.filter(k => k.startsWith(PREFIX) && k !== V && k !== IMG).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 카드 이미지(외부) — 캐시 우선
  if (url.hostname.endsWith('pokemonkorea.co.kr')) {
    e.respondWith(caches.open(IMG).then(async c => {
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
