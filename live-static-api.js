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
  var API_BASE = 'https://stock-dashboard-live-6frm.vercel.app';
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
