/* ============================================================
   포켓몬 배틀 월드 — 독립 PWA 서비스워커
   · 이 파일은 /pokemon/sw.js 이고 scope 는 /pokemon/ 으로 한정된다.
   · 같은 오리진의 '연오랑 관제탑'(/sw.js, scope: /) 과는 완전히 별개 앱으로 인식된다.
   · 캐시 이름에 pkm-world- 접두사를 붙여, 관제탑 워커의 캐시 정리와 섞이지 않게 한다.
   ============================================================ */
const PREFIX = 'pkm-world-';
const VERSION = PREFIX + 'v16';  /* 2026-11-16 v16: 홈 6번째 메뉴 「🏡 3D 포켓몬 아지트」(/pokemon-3d.html) 연결
                                    (v15: 🛡️ 아빠 PIN 도감 삭제 영구 방어 — removed·caughtAt 기록) */
const SHELL = [
  '/pokemon/manifest.json',
  '/pokemon-battle.html',
  '/pokemon/math-pokemon.html',
  '/pokemon/hangul-pokemon.html',
  '/pokemon/english-pokemon.html',
  '/pokemon/versus-pokemon.html',
  '/pokemon/village-pokemon.html',
  '/pokemon-battle2.css',
  '/pokemon-battle2.js',
  '/pokemon-audio.js',
  '/pokemon-3rd.js',
  '/pokemon-art.js',
  '/pokemon-props.js',
  '/pokemon-lock.js',
  '/pokemon-sync.js',
  '/pokemon-db.json',
  '/hangul-bank.json',
  '/english-bank.json',
  '/evo-map.json',
  /* 배경 일러스트 — 첫 설치 때 미리 받아 두어 오프라인에서도 그림이 나온다 */
  '/art/battle-forest.webp',
  '/art/battle-lake.webp',
  '/art/battle-volcano.webp',
  '/art/battle-night.webp',
  '/art/battle-ruins.webp',
  '/art/battle-canyon.webp',
  '/art/battle-sky.webp',
  '/art/village-day.webp',
  '/art/village-sunset.webp',
  '/art/village-night.webp',
  /* 마을 4테마 — 세로(정사각) + 가로(16:9) */
  '/art/village-day-wide.webp',
  '/art/village-sunset-wide.webp',
  '/art/village-night-wide.webp',
  '/art/village-beach.webp',
  '/art/village-beach-wide.webp',
  '/art/village-mountain.webp',
  '/art/village-mountain-wide.webp',
  '/art/village-desert.webp',
  '/art/village-desert-wide.webp',
  /* 마을 5→9테마 — 태초·항구·숲속·설원·운하 */
  '/art/village-starter.webp',
  '/art/village-starter-wide.webp',
  '/art/village-harbor.webp',
  '/art/village-harbor-wide.webp',
  '/art/village-forest.webp',
  '/art/village-forest-wide.webp',
  '/art/village-snow.webp',
  '/art/village-snow-wide.webp',
  '/art/village-canal.webp',
  '/art/village-canal-wide.webp',
  /* 수채화 꾸미기 소품(투명 PNG) */
  '/assets/props/bench.png',
  '/assets/props/mat.png',
  '/assets/props/campfire.png',
  '/assets/props/tent.png',
  '/assets/props/arch.png',
  '/assets/props/fountain.png',
  '/assets/props/hammock.png',
  '/assets/props/sign.png',
  '/assets/props/lantern.png',
  '/assets/props/flowerbed.png',
  '/assets/props/chest.png',
  '/assets/props/log.png',
  /* 실음원 BGM·환경음 — 첫 설치 때 받아 두어 오프라인·비행기모드에서도 소리가 난다 */
  '/audio/music_battle.mp3',
  '/audio/music_boss.mp3',
  '/audio/music_village.mp3',
  '/audio/amb_water.mp3',
  '/audio/amb_fire.mp3',
  '/audio/amb_forest.mp3',
  '/audio/amb_thunder.mp3',
  '/audio/amb_ghost.mp3',
  '/audio/amb_cave.mp3',
  '/audio/amb_wind.mp3'
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
  // 외부(포켓몬 스프라이트 CDN 등)와 API(/api/tts)는 손대지 않고 브라우저에 맡긴다.
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
