/* ============================================================
   🌐 정적 관제탑(GitHub Pages) 전용 API 셔틀 — live-static-api.js
   ------------------------------------------------------------
   정적 페이지에는 /api/* 서버리스 함수가 없다. 그래서 상대경로 /api/... 를
   부르면 곧바로 404 가 콘솔에 쌓인다(11/18 이식 작업의 원래 걸림돌).

   그런데 동적 본체(Vercel)의 API 는 응답 헤더에
       access-control-allow-origin: *
   를 붙여 내려온다(실측: /api/stock-live · /api/stock-live?mode=alerts ·
   /api/stock-chart 모두 200 + ACAO:*). 그래서 같은 요청을 동적 오리진으로
   넘겨 주면 정적 페이지에서도 실시간 시세·200일 일봉을 그대로 쓸 수 있다.

   원칙
   · '/api/' 로 시작하는 상대 경로만 동적 오리진으로 바꾼다. 다른 요청은 손대지 않는다.
   · 동적 오리진이 죽었거나 네트워크가 막히면 fetch 가 실패하고,
     각 탭 엔진은 이미 갖고 있는 내장 스냅샷(장마감 확정 일봉)으로 폴백한다.
     → 가짜·추정 데이터를 만들지 않는다. 실패하면 화면에 "정적 스냅샷"이라고 밝힌다.
   · 응답이 영영 안 오면 화면이 '연결 중'에 멈추므로 15초 타임아웃을 건다
     (호출 측이 자기 signal 을 넘긴 경우에는 그대로 존중한다).
   ============================================================ */
(function () {
  'use strict';
  var API_BASE = 'https://stock-dashboard-live-bice.vercel.app';
  window.__API_BASE = API_BASE;      /* 이 값이 있으면 각 엔진·핀 모듈이 '/api 사용 가능'으로 본다 */
  window.__STATIC_PAGE = true;

  var orig = window.fetch ? window.fetch.bind(window) : null;
  if (!orig) return;

  window.fetch = function (input, init) {
    try {
      var url = (typeof input === 'string') ? input : ((input && input.url) || '');
      if (url.indexOf('/api/') === 0) {
        var opt = init ? Object.assign({}, init) : {};
        if (!opt.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
          opt.signal = AbortSignal.timeout(15000);
        }
        return orig(API_BASE + url, opt);
      }
    } catch (e) { /* 아래에서 원래 요청 그대로 진행한다 */ }
    return orig(input, init);
  };
})();

/* ============================================================
   ⏳ '오늘 남은 정규 브리핑' 안내 — 정적 페이지용 런타임 계산 (2026-11-24)
   ------------------------------------------------------------
   정적 index.html 의 안내 문구는 생성기(auto_update_all_tabs.py)가 갱신하지만,
   두 갱신 사이에 시각이 지나면 이미 지난 슬롯이 '남은 시간대'로 남는다(11/24 21시:
   19:00·19:30·20:00 이 남은 것처럼 표시). 동적 본체(live-macro.js)와 같은 14회
   슬롯 목록·같은 문구로 브라우저에서 다시 계산해 두 화면이 같은 말을 하게 한다.
   ============================================================ */
(function () {
  'use strict';
  var SLOTS = ['07:30', '08:50', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00',
               '17:30', '19:00', '19:30', '20:00', '22:00', '23:59'];

  function kst() {
    var now = new Date();
    return new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
  }

  function paint() {
    var rt = document.getElementById('remainingBriefingTitle');
    var rx = document.getElementById('remainingBriefingText');
    if (!rt || !rx) return;
    var t = kst();
    var md = (t.getMonth() + 1) + '/' + t.getDate();
    var wd = t.getDay();
    var title;
    var text;
    if (wd === 0 || wd === 6) {
      title = '⏳ 다음 정규 브리핑 안내';
      text = '오늘(' + md + ')은 주말 휴장입니다. 다음 정규 브리핑은 직전 거래일 종가·주말 뉴스를 정리한 뒤 '
        + '평일 장전(07:30)부터 타임라인에 자동 등록됩니다.';
    } else {
      title = '⏳ 오늘 남은 정규 브리핑 안내';
      var hm = (t.getHours() < 10 ? '0' : '') + t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes();
      var rest = SLOTS.filter(function (s) { return s > hm; });
      text = rest.length
        ? '오늘(' + md + ') 남은 정규 브리핑은 ' + rest.join(' · ') + ' 순서로 해당 시각에 타임라인에 자동 등록됩니다.'
        : '오늘(' + md + ') 정규 브리핑은 모두 마감됐습니다. 다음 정규 브리핑은 다음 평일 07:30 장전부터 타임라인에 자동 등록됩니다.';
    }
    if (rt.textContent !== title) rt.textContent = title;
    if (rx.textContent !== text) rx.textContent = text;
  }

  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(paint, 80); });
  } else {
    setTimeout(paint, 80);
  }
  setInterval(function () { if (!document.hidden) paint(); }, 60 * 1000);
})();
