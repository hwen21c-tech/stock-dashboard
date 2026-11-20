/* 체험단ZIP — 오프라인/독립 설치용 서비스 워커
   · 셸(HTML·manifest·아이콘)은 설치 시 캐시, 캠페인 데이터는 네트워크 우선 + 캐시 폴백
   · 파일을 고칠 때는 CACHE 이름의 버전을 올려 주세요.
*/
var CACHE = 'review-zip-v1';
var SHELL = [
  './review-zip.html',
  './review-zip-manifest.json',
  './review-zip-icon-192.png',
  './review-zip-icon-512.png'
];
var DATA = './data/revu-campaigns.json';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL).then(function () {
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

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = req.url;
  if (url.indexOf(self.location.origin) !== 0) return;

  if (url.indexOf('/data/revu-campaigns.json') >= 0) {
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

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('./review-zip.html').then(function (hit) {
          return hit || caches.match(req);
        });
      })
    );
    return;
  }

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
