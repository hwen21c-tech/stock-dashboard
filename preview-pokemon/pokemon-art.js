/* ============================================================
   포켓몬 배틀 월드 — 배경 일러스트(art) 로더
   ─ /art/*.webp 를 미리 받아 성공한 뒤에만 data-art 를 붙인다.
     → 그림이 아직 없거나 실패하면 기존 CSS 그라데이션 배경이 그대로 남는다(폴백).
   ─ 배틀 무대(.pb2-bg[data-theme]) · 마을(.meadow[data-tod]) 둘 다 담당.
   ============================================================ */
(function () {
  'use strict';
  if (window.POK_ART && window.POK_ART.version) return;

  var BASE = './art/';

  /* 타입 테마 → 그림 파일 (power=전기·강철 밤하늘은 '밤' 그림을 쓴다) */
  var BATTLE = {
    forest: 'battle-forest',
    lake: 'battle-lake',
    volcano: 'battle-volcano',
    power: 'battle-night',
    ruins: 'battle-ruins',
    canyon: 'battle-canyon',
    sky: 'battle-sky',
  };
  var VILLAGE = { day: 'village-day', sunset: 'village-sunset', night: 'village-night' };
  /* 초원 말고 다른 마을 테마 — 낮 그림 한 장을 쓰고 노을·밤은 마을 화면이 색 보정으로 만든다 */
  var VILLAGE_THEME = {
    beach: 'village-beach',
    mountain: 'village-mountain',
    desert: 'village-desert',
    starter: 'village-starter',
    harbor: 'village-harbor',
    forest: 'village-forest',
    snow: 'village-snow',
    canal: 'village-canal',
  };

  var state = {};   /* src → 'loading' | 'ok' | 'fail' */
  var queue = {};   /* src → [callback] */

  function srcBattle(key) { var n = BATTLE[key]; return n ? BASE + n + '.webp' : ''; }
  /* srcVillage(tod, theme, wide) — 테마·가로/세로에 맞는 마을 그림 경로.
     기존 호출(srcVillage(tod))은 그대로 초원 마을 세로 그림을 돌려준다. */
  function srcVillage(tod, theme, wide) {
    var n = (theme && VILLAGE_THEME[theme]) ? VILLAGE_THEME[theme] : VILLAGE[tod];
    if (!n) return '';
    return BASE + n + (wide ? '-wide' : '') + '.webp';
  }

  function flush(src, ok) {
    state[src] = ok ? 'ok' : 'fail';
    var list = queue[src] || [];
    delete queue[src];
    for (var i = 0; i < list.length; i += 1) {
      try { list[i](ok); } catch (e) { /* */ }
    }
  }

  /* 그림이 준비되면 cb(true). 실패/없음은 cb(false) — 한 번만 받는다. */
  function ensure(src, cb) {
    if (!src) { cb(false); return; }
    var st = state[src];
    if (st === 'ok') { cb(true); return; }
    if (st === 'fail') { cb(false); return; }
    if (st === 'loading') { (queue[src] = queue[src] || []).push(cb); return; }
    state[src] = 'loading';
    queue[src] = [cb];
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () { flush(src, true); };
    im.onerror = function () { flush(src, false); };
    try { im.src = src; } catch (e) { flush(src, false); }
  }

  /* 배틀 무대 한 칸에 지금 테마의 그림을 입힌다 */
  function battle(el) {
    if (!el || !el.dataset) return;
    var key = el.dataset.theme;
    if (!key) return;
    var src = srcBattle(key);
    if (!src) { el.removeAttribute('data-art'); return; }
    el.setAttribute('data-art-pending', key);
    ensure(src, function (ok) {
      if (!el.isConnected) return;
      el.removeAttribute('data-art-pending');
      if (ok && el.dataset.theme === key) el.setAttribute('data-art', key);
      else if (!ok) el.removeAttribute('data-art');
      /* 그림이 늦게 도착했는데 그새 테마가 바뀐 경우 다시 계산 */
      if (ok && el.dataset.theme && el.dataset.theme !== key) battle(el);
    });
  }

  /* 마을 풀밭 한 칸에 지금 시간대의 그림을 입힌다 */
  function village(el) {
    if (!el || !el.dataset) return;
    var tod = el.dataset.tod;
    if (!tod) return;
    var theme = el.dataset.vtheme || 'meadow';
    var wide = el.dataset.fmt === 'wide';
    var src = srcVillage(tod, theme, wide);
    if (!src) { el.removeAttribute('data-art'); return; }
    ensure(src, function (ok) {
      if (!el.isConnected) return;
      if (ok && el.dataset.tod === tod) el.setAttribute('data-art', tod);
      else if (!ok) el.removeAttribute('data-art');
      if (ok && el.dataset.tod && el.dataset.tod !== tod) village(el);
    });
  }

  function sweep() {
    var i;
    var bgs = document.querySelectorAll('.pb2-bg[data-theme]');
    for (i = 0; i < bgs.length; i += 1) battle(bgs[i]);
    var mv = document.querySelectorAll('.meadow[data-tod]');
    for (i = 0; i < mv.length; i += 1) village(mv[i]);
  }

  /* 테마·시간대가 바뀌면(2인 대결·마을 자동 하늘) 그 무대의 그림도 따라 바뀐다 */
  function watch() {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i += 1) {
        var t = list[i].target;
        if (!t || !t.dataset || !t.classList) continue;
        if (t.classList.contains('pb2-bg')) battle(t);
        else if (t.classList.contains('meadow')) village(t);
      }
    });
    mo.observe(document.documentElement, {
      attributes: true, subtree: true, attributeFilter: ['data-theme', 'data-tod'],
    });
  }

  /* 화면에 지금 필요한 그림이 뜬 다음, 남는 그림은 한가할 때 미리 받아 둔다 */
  function preloadSoon() {
    var go = function () {
      var keys = Object.keys(BATTLE).concat(Object.keys(VILLAGE));
      var list = keys.map(function (k) {
        return BATTLE[k] ? srcBattle(k) : srcVillage(k);
      }).filter(Boolean);
      var i = 0;
      var step = function () {
        if (i >= list.length) return;
        ensure(list[i], function () {
          i += 1;
          if (window.requestIdleCallback) requestIdleCallback(step, { timeout: 2500 });
          else setTimeout(step, 400);
        });
      };
      step();
    };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 });
    else setTimeout(go, 1800);
  }

  window.POK_ART = {
    version: 1,
    srcBattle: srcBattle,
    srcVillage: srcVillage,
    battle: battle,
    village: village,
    sweep: sweep,
    ensure: ensure,
    state: function () { return Object.assign({}, state); },
    keys: function () { return { battle: Object.keys(BATTLE), village: Object.keys(VILLAGE) }; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { sweep(); watch(); preloadSoon(); });
  } else {
    sweep();
    watch();
    preloadSoon();
  }
})();

/* ============================================================
   포켓몬 그림 안전망 — 외부 CDN이 느리거나 막혀도 '빈칸'이 남지 않게 한다.
   실패 순서: official-artwork → other/home → 기본 도트 스프라이트 → 인라인 SVG(몬스터볼)
   · 각 페이지가 붙여 둔 onerror(그림을 display:none 으로 숨기는 코드)를 capture 단계에서
     먼저 가로채(stopPropagation) 다음 후보로 넘긴다 → 상대·파트너가 통째로 사라지지 않는다.
   ============================================================ */
(function () {
  'use strict';
  var SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  var BALL_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">'
    + '<rect width="96" height="96" rx="20" fill="#eef7df"/>'
    + '<circle cx="48" cy="50" r="32" fill="#ffffff" stroke="#2f4a16" stroke-width="5"/>'
    + '<path d="M16 50h64" stroke="#2f4a16" stroke-width="7"/>'
    + '<circle cx="48" cy="50" r="12" fill="#ffffff" stroke="#2f4a16" stroke-width="5"/>'
    + '<circle cx="48" cy="50" r="5" fill="#79c94a"/>'
    + '</svg>');

  function idOf(src) {
    if (!src) return 0;
    var m = /sprites\/pokemon\/(?:other\/(?:official-artwork|home)\/)?(?:shiny\/)?(\d+)\.png/.exec(src);
    return m ? Number(m[1]) : 0;
  }
  /* 지금 그림의 '다음 후보' — 없으면 '' (더 내려갈 곳이 없다) */
  function nextSrc(src) {
    var s = String(src || '');
    var id = idOf(s);
    if (!id) return '';
    var shiny = /\/shiny\//.test(s) ? 'shiny/' : '';
    if (/other\/official-artwork\//.test(s)) return SPRITES + 'other/home/' + shiny + id + '.png';
    if (/other\/home\//.test(s)) return SPRITES + shiny + id + '.png';
    return '';   /* 기본 도트까지 실패 → 인라인 SVG */
  }
  function rescue(img, ev) {
    if (!img || img.tagName !== 'IMG') return false;
    var src = img.getAttribute('src') || '';
    if (!/sprites\/pokemon\//.test(src)) return false;
    if (ev && ev.stopPropagation) { try { ev.stopPropagation(); } catch (e) { /* */ } }
    var nxt = nextSrc(src);
    img.style.display = '';
    if (img.style.opacity === '0') img.style.opacity = '1';
    if (nxt) { img.src = nxt; return true; }
    img.setAttribute('data-pok-fallback', '1');
    try { img.onerror = null; } catch (e) { /* */ }
    if (src !== BALL_SVG) img.src = BALL_SVG;
    return true;
  }
  document.addEventListener('error', function (e) { rescue(e.target, e); }, true);

  /* 이미 실패한 채로 남은 그림(스크립트가 늦게 실린 경우)도 한 번씩 구제한다 */
  function sweep() {
    var list = document.images || [];
    for (var i = 0; i < list.length; i += 1) {
      var img = list[i];
      if (!img.complete || img.naturalWidth > 0) continue;
      if (/sprites\/pokemon\//.test(img.getAttribute('src') || '')) rescue(img, null);
    }
  }
  window.addEventListener('load', sweep);
  setTimeout(sweep, 2500);
  setTimeout(sweep, 6000);
  window.POK_ART = Object.assign(window.POK_ART || {}, {
    ballSvg: BALL_SVG,
    imgNext: nextSrc,
    imgSweep: sweep,
  });
})();
