/* 체험단ZIP — 오프라인/독립 설치용 서비스 워커
   · 셸(HTML·manifest·아이콘)은 설치 시 캐시, 캠페인 데이터는 네트워크 우선 + 캐시 폴백
   · 파일을 고칠 때는 CACHE 이름의 버전을 올려 주세요.
   · [11/20] PWA 스코프 분리: 등록 스코프를 ./review-zip.html 하나로 좁혔다.
     같은 오리진(관제탑·리뷰 스튜디오·사주 등)의 다른 앱 캐시는 activate에서도 건드리지 않는다.
   · [11/28] v13: 얼굴노출 오탑 수정(셸 재캐시) — 플랫폼 초상권 동의만 있는 캠페인·'얼굴 모자이크'·'셀카봉'은
     더 이상 얼굴노출로 걸러지지 않고, 원문에 얼굴 노출·공개·셀카 요건이 있는 캠페인만 제외된다.
   · [11/26] v12: 모집 마감 지난 캠페인 제외 반영(셀 재캐시) — 목록·빈집털이·통계에서 마감 카드 제거.
   · [11/25] v11: 카드 뱃지 개편 반영(셀 재캐시) — 🆕 NEW 는 '직전 수집 이후 새로 등록'(플랫폼별 최신 3건)만, 나머지는 마감임박(🔥 오늘마감 / ⏰ D-1~3).
   · [11/20] 제외 토글(자부담·페이백·기자단 기본 ON) · 지역 필터 반영으로 v9.
   · [11/20] 유형 필터·필터 접기·sticky 해제 반영으로 v8.
*/
var PREFIX = 'review-zip-';
var CACHE = PREFIX + 'v13';
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
      return Promise.all(keys.filter(function (k) {
        return k.indexOf(PREFIX) === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
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
