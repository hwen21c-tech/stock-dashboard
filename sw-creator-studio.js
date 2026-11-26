/* 수익화 스튜디오 PRO — 오프라인/독립 설치용 서비스 워커
   · 셸(HTML·manifest·아이콘)은 미리 캐시해 두고, 열 때마다 새 파일을 먼저 확인한다.
   · 폰트·Tailwind·Lucide 같은 외부 CDN 정적 자원은 처음 받은 뒤 캐시에서 재사용한다.
   · Gemini API 응답은 절대 캐시하지 않는다(키·결과가 캐시에 남지 않도록 통과만 시킨다).
   · 파일을 고칠 때는 CACHE 이름의 버전을 올려 주세요.
   · [11/26] v1: 최초 배포 — 최신 모델(gemini-3.1-flash-lite 기본) · 사용 설명서 모달 포함.
*/
var PREFIX = 'creator-studio-';
var CACHE = PREFIX + 'v1';
var SHELL = [
  './creator-studio.html',
  './creator-studio-manifest.json',
  './creator-studio-icon-192.png',
  './creator-studio-icon-512.png',
  './creator-studio-icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf(PREFIX) === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 네트워크 우선 → 실패하면 캐시 (HTML은 새 배포를 바로 받아야 한다) */
function networkFirst(req, fallbackUrl) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      return hit || caches.match(fallbackUrl);
    });
  });
}

/* 캐시 우선 → 없으면 네트워크 (아이콘·manifest 같은 정적 파일) */
function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}

/* 외부 CDN(폰트·Tailwind·Lucide) — 캐시 먼저 주고 뒤에서 갱신 */
function staleWhileRevalidate(req) {
  return caches.match(req).then(function (hit) {
    var fetching = fetch(req).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || fetching;
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Gemini API는 손대지 않는다 */
  if (url.hostname.indexOf('generativelanguage.googleapis.com') >= 0) return;

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(networkFirst(req, './creator-studio.html'));
      return;
    }
    if (/\/creator-studio\.(html|manifest\.json|icon-[0-9]+\.png)$/.test(url.pathname) ||
        /\/creator-studio-icon-maskable-512\.png$/.test(url.pathname)) {
      event.respondWith(cacheFirst(req));
      return;
    }
    event.respondWith(networkFirst(req, './creator-studio.html'));
    return;
  }

  /* 외부 정적 자원만 런타임 캐시 */
  if (['style', 'script', 'font', 'image'].indexOf(req.destination) >= 0) {
    event.respondWith(staleWhileRevalidate(req));
  }
});
