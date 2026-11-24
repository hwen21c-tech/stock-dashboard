/* ============================================================
   ⚡ 5번 💰 수급 주도주 탭 — 「장중 외인·기관 가집계 상위 (KIS)」 패널
   ------------------------------------------------------------
   · 데이터: /api/tabs-live?mode=supply_live (한투 KIS FHPTJ04400000 국내기관_외국인
     매매종목 가집계 — 외국인(1)·기관계(2) 두 목록) · 60초 폴링.
   · 표기: 외국인 순매수 상위 / 기관계 순매수 상위 / 합산(외+기) 상위 3열.
     각 행 = 종목명 · 현재가 · 당일 등락률 · 순매수 금액(억 원).
   · 금액 단위: KIS 응답 netValueRaw 는 백만원 → 서버가 netValueEok(raw/100)로 내려준다.
   · 15:30 이후·휴장일·개장 전·KIS 오류면 서버가 확정치(supply-latest.json)로 폴백해
     confirmed=true 로 내려준다 → 패널은 「확정 11/23 기준」으로 그리고, 가집계처럼 보이지
     않게 문구를 바꾼다.
   · 값이 없으면 만들지 않는다 — '가집계 응답 없음'만 적는다(추측 금지).
   · 정적(GitHub Pages) 본체도 같은 파일을 쓴다 — live-static-api.js 가 '/api/' 요청을
     동적 오리진으로 넘겨 주므로 동일 동작.
   ============================================================ */
(function () {
  'use strict';
  if (window.KisSupplyPanel && window.KisSupplyPanel.__ready) return;

  var API = '/api/tabs-live?mode=supply_live&top=8';
  var POLL_MS = 60000;
  var STALE_MS = 55000;
  var S = { data: null, at: '', err: '', busy: false, timer: null, last: 0, lastTry: 0, shown: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function nf(v) { var n = num(v); return n === null ? '—' : Math.round(n).toLocaleString('ko-KR'); }
  function won(v) { var n = num(v); return (n === null || n <= 0) ? '—' : nf(n) + '원'; }
  function eok(v) {
    var n = num(v);
    if (n === null) return '—';
    return (n > 0 ? '+' : '') + (Math.round(n * 10) / 10).toLocaleString('ko-KR') + '억';
  }
  function pct(v) { var n = num(v); return n === null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function col(v) { var n = num(v); return n === null ? '#94a3b8' : (n > 0 ? 'up' : (n < 0 ? 'down' : 'flat')); }
  function kstNow() {
    var d = new Date();
    return new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 9 * 3600000);
  }
  function hm() {
    var d = kstNow(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function injectCss() {
    if (document.getElementById('kis-sup-css')) return;
    var st = document.createElement('style');
    st.id = 'kis-sup-css';
    st.textContent = [
      '#kisSupplyPanel{background:#0b1120;border:1px solid #0369a1;border-radius:8px;padding:8px 10px;margin:0 0 12px;}',
      '#kisSupplyPanel .ksp-hd{display:flex;justify-content:space-between;align-items:baseline;gap:6px;flex-wrap:wrap;margin-bottom:6px;}',
      '#kisSupplyPanel .ksp-title{font-size:12px;font-weight:900;color:#7dd3fc;}',
      '#kisSupplyPanel .ksp-kis{font-size:8.5px;font-weight:900;color:#0b1120;background:#38bdf8;border-radius:3px;padding:0 4px;margin-left:4px;}',
      '#kisSupplyPanel .ksp-stamp{font-size:9.5px;font-weight:800;color:#94a3b8;}',
      '#kisSupplyPanel .ksp-stamp.live{color:#6ee7b7;}',
      '#kisSupplyPanel .ksp-stamp.warn{color:#fbbf24;}',
      '#kisSupplyPanel .ksp-grid{display:grid;grid-template-columns:1fr;gap:6px;}',
      '@media (min-width:560px){#kisSupplyPanel .ksp-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}',
      '#kisSupplyPanel .ksp-col{background:rgba(2,6,23,0.62);border:1px solid #1e3a8a;border-radius:6px;padding:5px 6px;min-width:0;}',
      '#kisSupplyPanel .ksp-col-h{font-size:9.5px;font-weight:900;color:#93c5fd;margin-bottom:3px;display:flex;justify-content:space-between;gap:4px;}',
      '#kisSupplyPanel .ksp-col-h span{color:#64748b;font-weight:800;}',
      '#kisSupplyPanel .ksp-row{display:grid;grid-template-columns:12px minmax(0,1fr) auto;grid-column-gap:5px;align-items:center;',
      '  font-size:10.5px;line-height:1.5;padding:2px 0;border-bottom:1px dashed rgba(51,65,85,0.6);cursor:pointer;}',
      '#kisSupplyPanel .ksp-row:last-child{border-bottom:0;}',
      '#kisSupplyPanel .ksp-rk{font-size:8.5px;font-weight:900;color:#64748b;text-align:center;}',
      '#kisSupplyPanel .ksp-nm{color:#e2e8f0;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#kisSupplyPanel .ksp-meta{grid-column:2/4;font-size:9px;color:#94a3b8;display:flex;gap:6px;flex-wrap:wrap;}',
      '#kisSupplyPanel .ksp-net{font-weight:900;font-feature-settings:\'tnum\';white-space:nowrap;}',
      '#kisSupplyPanel .ksp-net.buy{color:#6ee7b7;}',
      '#kisSupplyPanel .ksp-net.sell{color:#fda4af;}',
      '#kisSupplyPanel .ksp-up{color:#f87171;}',
      '#kisSupplyPanel .ksp-down{color:#38bdf8;}',
      '#kisSupplyPanel .ksp-flat{color:#94a3b8;}',
      '#kisSupplyPanel .ksp-dual{font-size:8px;font-weight:900;color:#0b1120;background:#6ee7b7;border-radius:3px;padding:0 3px;margin-left:3px;}',
      '#kisSupplyPanel .ksp-note{font-size:9px;color:#94a3b8;margin-top:6px;line-height:1.55;word-break:keep-all;}',
      '#kisSupplyPanel .ksp-empty{font-size:10px;color:#94a3b8;border:1px dashed #334155;border-radius:6px;padding:8px;line-height:1.5;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function host() {
    var el = $('kisSupplyPanel');
    if (el) return el;
    var tab = $('tabSupply');
    if (!tab) return null;
    var grid = tab.querySelector('.supply-grid-4');
    el = document.createElement('div');
    el.id = 'kisSupplyPanel';
    if (grid && grid.parentNode) grid.parentNode.insertBefore(el, grid);
    else tab.appendChild(el);
    return el;
  }

  function rowsOf(groupKey) {
    var d = S.data || {};
    var g = (d.groups || {})[groupKey];
    var rows = (g && g.top) || null;
    if (rows && rows.length) {
      return rows.map(function (r) {
        return {
          code: r.code, name: r.name, price: r.price, chg: r.changePct,
          net: num(r.netValueEok),
          dual: groupKey === 'foreign' ? (num(r.organEok) || 0) > 0 : (num(r.foreignEok) || 0) > 0
        };
      });
    }
    /* 확정치 폴백은 groups 가 없고 top 만 온다 — 그 목록에서 해당 주체 값이 있는 행만 고른다. */
    var top = d.top || [];
    var out = [];
    top.forEach(function (r) {
      var net = groupKey === 'foreign' ? num(r.foreignEok) : num(r.organEok);
      if (net === null) return;
      out.push({
        code: r.code, name: r.name, price: r.price, chg: r.changePct, net: net,
        dual: (num(r.foreignEok) || 0) > 0 && (num(r.organEok) || 0) > 0
      });
    });
    out.sort(function (a, b) { return (b.net || 0) - (a.net || 0); });
    return out;
  }

  function sumRows() {
    var d = S.data || {};
    var top = (d.top || []).slice(0);
    if (!top.length) {
      /* top 이 없으면 그룹에서 코드로 합친다 */
      var m = {};
      rowsOf('foreign').concat(rowsOf('organ')).forEach(function (r) {
        if (!r.code) return;
        var cur = m[r.code] || { code: r.code, name: r.name, price: r.price, chg: r.chg, f: null, o: null };
        if (r.net !== null && r.net !== undefined) {
          if (cur.f === null) cur.f = r.net; else cur.o = r.net;
        }
        m[r.code] = cur;
      });
      top = Object.keys(m).map(function (k) {
        var x = m[k];
        x.total = (x.f || 0) + (x.o || 0);
        x.dual = (x.f || 0) > 0 && (x.o || 0) > 0;
        return x;
      });
    } else {
      top = top.map(function (r) {
        var f = num(r.foreignEok), o = num(r.organEok);
        return {
          code: r.code, name: r.name, price: r.price, chg: r.changePct,
          net: num(r.totalEok) !== null ? num(r.totalEok) : ((f || 0) + (o || 0)),
          f: f, o: o, dual: (f || 0) > 0 && (o || 0) > 0
        };
      });
    }
    top.sort(function (a, b) { return (b.net || 0) - (a.net || 0); });
    return top;
  }

  function rowHtml(r, i, kindLabel) {
    var sub = '';
    if (kindLabel === 'dual') {
      var parts = [];
      if (num(r.f) !== null) parts.push('외인 ' + eok(r.f));
      if (num(r.o) !== null) parts.push('기관 ' + eok(r.o));
      sub = parts.join(' · ');
    }
    var reason = '【KIS ' + ((S.data || {}).confirmed ? '확정 수치' : '장중 가집계') + '】 ' + kindLabel + ' ' + (i + 1) + '위 ' +
      (r.name || '') + ' — 순매수 ' + eok(r.net) + (r.f !== undefined && r.f !== null ? ' (외인 ' + eok(r.f) + ')' : '') +
      (r.o !== undefined && r.o !== null ? ' (기관 ' + eok(r.o) + ')' : '') +
      '.【현재가】 ' + won(r.price) + ' (' + pct(r.chg) + ').' +
      '【출처】 한투 KIS 국내기관_외국인 매매종목 가집계(FHPTJ04400000) — ' + ((S.data || {}).asOfLabel || S.at);
    var title = (r.name || '') + ' [KIS ' + (kindLabel === 'dual' ? '합산' : (kindLabel === 'foreign' ? '외국인' : '기관계')) + ' 순매수 ' + (i + 1) + '위]';
    var oc = 'openDetail(' + JSON.stringify(title) + ', ' + JSON.stringify(pct(r.chg)) + ', ' +
      JSON.stringify((kindLabel === 'foreign' ? '외인 ' : (kindLabel === 'organ' ? '기관 ' : '합산 ')) + eok(r.net)) + ', ' +
      JSON.stringify(reason) + ')';
    return '<div class="ksp-row" data-code="' + esc(r.code) + '" data-name="' + esc(r.name) + '"' +
      (typeof window.openDetail === 'function' ? ' onclick="' + esc(oc) + '"' : '') + '>' +
      '<span class="ksp-rk">' + (i + 1) + '</span>' +
      '<span class="ksp-nm">' + esc(r.name) + (r.dual && kindLabel !== 'dual' ? '<span class="ksp-dual">쌍매수</span>' : '') + '</span>' +
      '<span class="ksp-net ' + ((num(r.net) || 0) >= 0 ? 'buy' : 'sell') + '">' + eok(r.net) + '</span>' +
      '<span class="ksp-meta">' + (sub ? '<span>' + esc(sub) + '</span>' : '') +
      '<span>' + won(r.price) + '</span><span class="ksp-' + col(r.chg) + '">' + pct(r.chg) + '</span>' +
      '<span>(' + esc(r.code || '') + ')</span></span>' +
      '</div>';
  }

  function colHtml(title, sub, rows, kindLabel) {
    var body = rows.length
      ? rows.slice(0, 5).map(function (r, i) { return rowHtml(r, i, kindLabel); }).join('')
      : '<div class="ksp-empty">해당 주체의 순매수 종목이 응답에 없습니다(0으로 만들지 않음).</div>';
    return '<div class="ksp-col"><div class="ksp-col-h">' + esc(title) + '<span>' + esc(sub) + '</span></div>' + body + '</div>';
  }

  function noteText() {
    var d = S.data || {};
    if (!d || !d.ok) {
      return S.err ? '※ ' + S.err + ' — 잠시 후 다시 시도합니다(값을 만들지 않음).' : '※ KIS 가집계 응답 대기 중입니다.';
    }
    if (d.confirmed) {
      return '※ 장중 가집계가 비어 있어 ' + (d.asOfLabel || '직전 거래일 확정치') + '로 표시합니다' +
        (d.fallbackReason ? ' (' + String(d.fallbackReason) + ')' : '') +
        ' — 확정치는 그날 종가 × 순매수 주수이며 실시간이 아닙니다. 5번 탭 아래 카드와 같은 확정 수치입니다.';
    }
    return '※ 한투 KIS 장중 가집계(외국인·기관계 순매수 상위) · ' + (d.asOfLabel || S.at) +
      ' · 60초마다 갱신. 15:30 이후에는 마감 시점 값에서 멈춥니다.' +
      ' 합산 = 같은 종목의 외국인 + 기관계 순매수(억 원).';
  }

  function render() {
    var el = host();
    if (!el) return;
    injectCss();
    var d = S.data || {};
    var stampCls = 'ksp-stamp', stampTxt = '⏳ 불러오는 중…';
    if (d && d.ok) {
      if (d.confirmed) { stampCls += ' warn'; stampTxt = '📋 ' + (d.asOfLabel || '확정치'); }
      else { stampCls += ' live'; stampTxt = '⚡ ' + (d.asOfLabel || '가집계') + ' · ' + S.at + ' 갱신'; }
    } else if (S.err) {
      stampCls += ' warn'; stampTxt = '⚠ ' + S.err;
    }
    var heads = {
      foreign: ['🌏 외국인', '순매수 상위'],
      organ: ['🏢 기관계', '순매수 상위'],
      dual: ['🏛️ 합산(외+기)', '순매수 상위']
    };
    var grid = '';
    if (!d || !d.ok) {
      grid = '<div class="ksp-empty">KIS 장중 가집계를 받지 못했습니다 — 아래 확정 수급 카드는 그대로 보실 수 있습니다.</div>';
    } else {
      grid = colHtml('🌏 외국인 순매수 상위', '억 원', rowsOf('foreign'), 'foreign') +
        colHtml('🏢 기관계 순매수 상위', '억 원', rowsOf('organ'), 'organ') +
        colHtml('🏛️ 합산(외+기) 순매수 상위', '억 원', sumRows(), 'dual');
    }
    el.innerHTML = '<div class="ksp-hd"><span class="ksp-title">⚡ 장중 외인·기관 가집계 상위<span class="ksp-kis">KIS</span></span>' +
      '<span class="' + stampCls + '">' + esc(stampTxt) + '</span></div>' +
      '<div class="ksp-grid">' + grid + '</div>' +
      '<div class="ksp-note">' + esc(noteText()) + '</div>';
    window.__KIS_SUPPLY_PANEL = {
      at: S.at, ok: !!(d && d.ok), confirmed: !!(d && d.confirmed),
      asOfLabel: (d && d.asOfLabel) || '', rows: { foreign: rowsOf('foreign').length, organ: rowsOf('organ').length, dual: sumRows().length }
    };
  }

  function fetchNow(force) {
    if (S.busy) return Promise.resolve(false);
    var now = Date.now();
    if (!force && now - S.lastTry < STALE_MS) return Promise.resolve(false);
    S.busy = true;
    S.lastTry = now;
    return fetch(API + (force ? '&fresh=1' : ''), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        S.busy = false;
        if (!d || d.mode !== 'supply_live') {
          S.err = '가집계 응답 없음';
          if (!S.data) render();
          return false;
        }
        S.data = d;
        S.err = d.ok ? '' : (d.reason || '가집계 없음');
        S.at = hm();
        S.last = Date.now();
        render();
        return true;
      })
      .catch(function () {
        S.busy = false;
        S.err = '가집계 연결 실패';
        if (!S.data) render();
        return false;
      });
  }

  function visible() {
    var el = $('kisSupplyPanel');
    return !!(el && el.offsetParent !== null);
  }

  function tick() {
    if (document.visibilityState !== 'visible') return;
    if (!visible()) return;                       /* 5번 탭이 열려 있을 때만 부른다 */
    if (Date.now() - S.last < STALE_MS) return;
    fetchNow(false);
  }

  function boot() {
    host();
    render();
    fetchNow(true);
    if (S.timer) clearInterval(S.timer);
    S.timer = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && visible() && Date.now() - S.last > STALE_MS) fetchNow(false);
    });
  }

  window.KisSupplyPanel = {
    __ready: true,
    refresh: function () { return fetchNow(true); },
    data: function () { return S.data; },
    state: function () { return window.__KIS_SUPPLY_PANEL || null; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
