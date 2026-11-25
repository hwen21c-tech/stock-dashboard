/* ============================================================================
   ⚡ 상단 퀵 탭 정리 (quick-tabs.js) — 2026-11-26 사용자 요청
   ----------------------------------------------------------------------------
   "보기 쉽게 수정해 달라. 메인 탭만 두고 나머지 탭은 위에서 터치하면 보이는 방식으로 해도 된다."
   · 상단 두 줄 퀵 버튼(1줄: 브리핑·홍인기·비중법사·깡토·만쥬·신정재·RN·저장·보관함 /
     2줄: 수급주도주·애프터마켓·시장&수급심층분석·시간별 뉴스·증시일정·신규상장·과열제외)에서
     모든 화면으로 한 번에 갈 수 있으므로, 가로 스크롤 탭 바(.view-tabs)에는 메인만 남긴다.
   · 나머지 탭 버튼은 **DOM 에서 지우지 않고 display:none 으로만 숨긴다**
     — switchView(view, btn) 가 `.tab-btn[data-view=...]` 를 찾아 active 를 칠하기 때문.
   · 지금 보고 있는 화면은 퀵 버튼에 테두리로 표시(active 연동)한다.
   ========================================================================== */
(function () {
  'use strict';
  if (window.QuickTabs) return;

  var TAB_VIEW = {
    tabOverview: 'overview', tabSupply: 'supply', tabAftermarket: 'aftermarket',
    tabAnalysis: 'analysis', tabNews: 'news', tabManju: 'manju', tabCalendar: 'calendar',
    tabRnzone: 'rnzone', tabJongbe: 'jongbe', tabHonginki: 'honginki',
    tabBijoong: 'bijoong', tabKkangto: 'kkangto', tabIpo: 'ipo'
  };

  function css() {
    if (document.getElementById('qtCss')) return;
    var st = document.createElement('style');
    st.id = 'qtCss';
    st.textContent = [
      /* 중복 탭 버튼 숨김 — 메인만 남긴다(과열 제외 토글도 퀵 버튼으로 옮겨 중복) */
      '.view-tabs .tab-btn:not([data-view="overview"]){display:none !important}',
      /* 퀵 버튼 두 줄 */
      '.sd-quickrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 8px;max-width:100%}',
      '.sd-quickrow .btn-action{white-space:nowrap}',
      /* 지금 보고 있는 화면 표시 */
      '.sd-quickrow .btn-action.qt-active{box-shadow:inset 0 0 0 2px #7dd3fc;color:#ffffff !important}',
      '.sd-quickrow .btn-action.qt-on{box-shadow:inset 0 0 0 2px #fb7185}',
      '.view-tabs .tab-btn.qt-main-active{box-shadow:0 0 0 1px #38bdf8 inset}',
      '@media (max-width:430px){.sd-quickrow{gap:5px}.sd-quickrow .btn-action{font-size:10.5px;padding:5px 7px}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function byId(id) { return document.getElementById(id); }

  function currentView() {
    var keys = Object.keys(TAB_VIEW);
    for (var i = 0; i < keys.length; i++) {
      var el = byId(keys[i]);
      if (el && el.style.display !== 'none') return TAB_VIEW[keys[i]];
    }
    return 'overview';
  }

  function sync(view) {
    var v = view || currentView();
    var btns = document.querySelectorAll('[data-quick]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-quick') === v;
      if (on) btns[i].classList.add('qt-active');
      else btns[i].classList.remove('qt-active');
    }
    var mainBtn = document.querySelector('.view-tabs .tab-btn[data-view="overview"]');
    if (mainBtn) {
      if (v === 'overview') mainBtn.classList.add('qt-main-active');
      else mainBtn.classList.remove('qt-main-active');
    }
    window.__QT = { view: v };
    return v;
  }

  /* 🚫 과열제외 — 탭 바의 토글(#ohToggle)이 숨겨지므로 퀵 버튼에 켜짐/꺼짐을 그대로 보여 준다 */
  function syncOh() {
    var b = document.getElementById('sdOhQuick');
    if (!b) return;
    var on = false;
    try { on = !!(window.OhBadge && window.OhBadge.state && window.OhBadge.state().excluded); } catch (e) { on = false; }
    b.classList.toggle('qt-on', on);
    var txt = on ? '🚫 과열제외 ON' : '🚫 과열제외';
    if (b.textContent !== txt) b.textContent = txt;
  }

  function hook() {
    var orig = window.switchView;
    if (typeof orig !== 'function' || orig.__qtWrapped) return;
    var wrapped = function (view, btn) {
      var r = orig.apply(this, arguments);
      try { sync(view); } catch (e) { /* */ }
      return r;
    };
    wrapped.__qtWrapped = true;
    window.switchView = wrapped;
  }

  function boot() {
    css();
    hook();
    sync();
    /* switchView 내부(로컬 함수) 호출·핫스왑처럼 래퍼를 안 거치는 경로도 따라가도록 주기 확인 */
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      var v = currentView();
      if (!window.__QT || window.__QT.view !== v) sync(v);
      syncOh();
    }, 900);
    syncOh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('load', function () { hook(); sync(); });

  window.QuickTabs = { sync: sync, syncOh: syncOh, current: currentView, state: function () { return window.__QT || null; } };
})();
