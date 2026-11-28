/* 리뷰단 스튜디오 — 오프라인/독립 설치용 서비스 워커
   · 셸(HTML·manifest·아이콘)은 미리 캐시, 캠페인 데이터는 네트워크 우선 + 캐시 폴백
   · 파일을 고칠 때는 CACHE 이름의 버전을 올려 주세요.
   · [11/28] v10: ✍️ 지원 탭 카드·상단 요약에서 🗑️ 담기 취소(지원함 비우기) 추가, 상세 미션(글자수·사진·동영상·
     지도·방문예약·키워드) 표시와 미수집 시 원문 바로가기 안내, 얼굴노출 오탑 수정(셸 재캐시).
   · [11/26] v9: 모집 마감 지난 캠페인을 탐색 목록에서 제외(셸 재캐시) — 데이터·✍️ 지원·📝 리뷰 탭에서는 유지.
   · [11/25] v8: 카드 뱃지 개편 반영(셸 재캐시) — 🆕 NEW 는 '직전 수집 이후 새로 등록'(플랫폼별 최신 3건)만, D-day 칩은 마감임박(🔥 오늘마감 / ⏰ D-1~3)을 앞세운다.
   · [11/20] v7: 지역 드롭다운(서울·경기·인천·강원·충청·전라·경상·제주) · 얼굴노출 제외 · 유형/지역 선택 저장(셸 재캐시).
   · [11/20] v6: 유형(배송·방문·페이백·기자단) 자동 판별 · 기본 제외 3종(자부담·페이백·기자단) · 지역 필터 반영(셸 재캐시).
   · [11/20] v5: revu-studio.html 밝은 테마 토글 반영(셸 재캐시).
   · [11/20] PWA 스코프 분리: 등록 스코프를 ./revu-studio.html 하나로 좁혔다.
     같은 오리진(관제탑·체험단ZIP·사주 등)의 다른 앱 캐시는 activate에서도 건드리지 않는다.
*/
var PREFIX = 'revu-studio-';
var CACHE = PREFIX + 'v10';
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
      return Promise.all(keys.filter(function (k) {
        return k.indexOf(PREFIX) === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
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
