/* 리뷰단 스튜디오 — 오프라인/독립 설치용 서비스 워커
   · 셸(HTML·manifest·아이콘)은 미리 캐시, 캠페인 데이터는 네트워크 우선 + 캐시 폴백
   · 파일을 고칠 때는 CACHE 이름의 버전을 올려 주세요.
*/
var CACHE = 'revu-studio-v3';
var SHELL = [
  './revu-studio.html',
  './revu-studio-manifest.json',
  './revu-studio-icon-192.png',
  './revu-studio-icon-512.png'
];
var DATA = './data/revu-campaigns.json';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL).then(function () {
        /* 데이터는 실패해도 설치를 막지 않는다 */
        return cache.add(DATA).catch(function () {});
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isData(url) {
  return url.indexOf('/data/revu-campaigns.json') >= 0;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = req.url;
  if (url.indexOf(self.location.origin) !== 0) return;   /* Gemini API 등 외부 요청은 그대로 통과 */

  /* 1) 캠페인 데이터 — 네트워크 우선, 실패하면 캐시 */
  if (isData(url)) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(DATA, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(DATA).then(function (hit) {
          return hit || new Response(JSON.stringify({ meta: {}, campaigns: [] }), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  /* 2) 화면 이동 — 네트워크 우선, 실패하면 캐시된 셸 */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('./revu-studio.html').then(function (hit) {
          return hit || caches.match(req);
        });
      })
    );
    return;
  }

  /* 3) 그 밖의 같은 출처 자원 — 캐시 우선 */
  event.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
