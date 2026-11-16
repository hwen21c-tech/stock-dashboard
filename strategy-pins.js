/* ============================================================
   📌 전략 핀 (StrategyPins) — 5개 전략 탭 공통 고정핀 + 실시간
   ─ 비중법사 · 홍인기 · 만쥬 · 종가베팅 · RN존의 모든 종목 카드에
     「📌 핀 고정」 버튼을 붙인다.
   ─ 핀 고정한 종목은 다음 날 자동 선정이 갈아엎어도 그 탭에 남는다.
     (오늘 목록에 없으면 카드 맨 위에 📌 고정됨 카드로 다시 그린다)
   ─ 저장: localStorage('stock.pins.v1') + Supabase family_sync 'stock_pin_0623'
     → 폰 · 태블릿 · 새로고침에도 유지된다.
   ─ 고정핀 종목도 현재가·등락률·거래대금·차트는 계속 갱신한다
     (동적 Vercel: /api/stock-live 20초 · /api/stock-chart / 정적: 내장 스냅샷).
   ============================================================ */
(function () {
  'use strict';
  if (window.StrategyPins && window.StrategyPins.version) return;

  var VERSION = '1.0.0';
  var LS = 'stock.pins.v1';
  var SUP = {
    url: 'https://hiruybkapzuhjrzjoyik.supabase.co',
    key: 'sb_publishable_e5JJbvCPDhY91uXaUEVNVA_8Byv_gI8',
    table: 'family_sync',
    code: 'stock_pin_0623'      /* 관심종목 stock_0623 과 분리된 핀 전용 네임스페이스 */
  };

  var TABS = {
    bij: { label: '비중법사', root: '#tabBijoong' },
    hong: { label: '홍인기', root: '#tabHonginki' },
    manju: { label: '만쥬', root: '#tabManju' },
    jongbe: { label: '종가베팅', root: '#tabJongbe' },
    rn: { label: 'RN존', root: '#tabRnzone' }
  };
  var TAB_KEYS = Object.keys(TABS);

  /* ---------------------------------------------------------- 상태 */
  /* 동적 본체(Vercel)만 /api 를 쓴다 — 정적 GitHub Pages 미러에는 live-api.js 가 없다.
     없는데도 호출하면 콘솔에 404 가 쌓이므로 처음부터 시도하지 않는다. */
  var HAS_API = (function () {
    try { return !!document.querySelector('script[src*="live-api.js"]'); } catch (e) { return false; }
  })();
  var S = {
    tabs: {},          /* tab -> { code: {code,name,at,del,price,pct,value,rn,candles} } */
    at: 0,
    clearedAt: 0,
    status: 'idle',
    msg: '',
    live: {},          /* code -> {price, changePct, valueText, at} */
    liveOk: false,
    liveAt: null,
    charts: {},        /* code -> {candles, at} */
    chartBusy: {},
    api: HAS_API ? null : false,   /* null 확인 전 · true /api 동작 · false 정적 미러 */
    booted: false
  };
  TAB_KEYS.forEach(function (k) { S.tabs[k] = {}; });

  function now() { return Date.now(); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nf(n) { return (typeof n === 'number' && isFinite(n)) ? Math.round(n).toLocaleString('ko-KR') : '—'; }
  function pctTxt(v) {
    var n = Number(v);
    if (!isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function colOf(v) { return v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'); }

  /* ---------------------------------------------------------- 저장 */
  function parse(raw, d) {
    if (!raw) return d;
    try { var v = JSON.parse(raw); return v == null ? d : v; } catch (e) { return d; }
  }
  function loadLocal() {
    var d = parse(lsGet(LS), null);
    if (!d || typeof d !== 'object') return;
    TAB_KEYS.forEach(function (k) {
      var src = (d.tabs && d.tabs[k]) || {};
      Object.keys(src).forEach(function (code) {
        var it = src[code];
        if (!it || typeof it !== 'object') return;
        if (typeof it.at !== 'number') it.at = 0;
        S.tabs[k][code] = it;
      });
    });
    S.at = typeof d.at === 'number' ? d.at : 0;
    S.clearedAt = typeof d.clearedAt === 'number' ? d.clearedAt : 0;
  }
  function saveLocal(touch) {
    if (touch) S.at = now();
    lsSet(LS, JSON.stringify({ v: 1, tabs: S.tabs, at: S.at, clearedAt: S.clearedAt }));
    if (touch) schedulePush();
  }

  /* pin 목록(해제 표식 제외, 고정한 순서) */
  function list(tab) {
    var m = S.tabs[tab] || {};
    return Object.keys(m).map(function (c) { return m[c]; })
      .filter(function (it) { return it && !it.del; })
      .sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
  }
  function has(tab, code) {
    var it = (S.tabs[tab] || {})[String(code)];
    return !!(it && !it.del);
  }
  function pinnedCodes() {
    var out = [];
    TAB_KEYS.forEach(function (t) {
      list(t).forEach(function (it) { if (it.code && out.indexOf(it.code) === -1) out.push(it.code); });
    });
    return out;
  }

  /* ---------------------------------------------------------- 클라우드 */
  function apiUrl(path) { return SUP.url + '/rest/v1/' + SUP.table + path; }
  function headers(extra) {
    var h = { apikey: SUP.key, Authorization: 'Bearer ' + SUP.key, 'Content-Type': 'application/json' };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    return h;
  }
  function getRow() {
    var url = apiUrl('?select=code,data,updated_at&code=eq.' + encodeURIComponent(SUP.code));
    return fetch(url, { headers: headers(), cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().then(function (a) { return (a && a.length) ? a[0] : null; });
    });
  }
  function putRow() {
    var payload = [{ code: SUP.code, data: { v: 1, tabs: S.tabs, at: S.at, clearedAt: S.clearedAt, device: 'dashboard' }, updated_at: new Date().toISOString() }];
    return fetch(apiUrl('?on_conflict=code'), {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(payload),
      cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return true;
    });
  }
  var pushTimer = null, syncing = false;
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushNow(); }, 900);
  }
  function pushNow() {
    if (syncing) return Promise.resolve(false);
    if (!pinnedAll() && !S.clearedAt) return Promise.resolve(false);
    syncing = true;
    return putRow().then(function () {
      setStatus('ok');
      return true;
    }).catch(function (e) {
      setStatus('error', e && e.message);
      return false;
    }).then(function (r) { syncing = false; return r; });
  }
  function pinnedAll() {
    var n = 0;
    TAB_KEYS.forEach(function (t) { n += list(t).length; });
    return n;
  }
  function mergeTabs(local, remote) {
    var out = {}, changed = false, localWins = 0;
    TAB_KEYS.forEach(function (t) {
      var a = (local || {})[t] || {}, b = (remote || {})[t] || {}, m = {};
      var keys = {};
      Object.keys(a).forEach(function (k) { keys[k] = 1; });
      Object.keys(b).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var x = a[k], y = b[k];
        if (!x && y) { m[k] = y; changed = true; return; }
        if (x && !y) { m[k] = x; localWins += 1; return; }
        if ((x.at || 0) >= (y.at || 0)) {
          m[k] = x;
          if (JSON.stringify(x) !== JSON.stringify(y)) localWins += 1;
        } else { m[k] = y; changed = true; }
      });
      out[t] = m;
    });
    return { tabs: out, changed: changed, localWins: localWins };
  }
  function pullNow() {
    if (syncing) return Promise.resolve(false);
    syncing = true;
    return getRow().then(function (row) {
      var remote = (row && row.data) || null;
      if (!remote) { syncing = false; if (pinnedAll()) schedulePush(); return false; }
      var mg = mergeTabs(S.tabs, remote.tabs || {});
      if (typeof remote.clearedAt === 'number') S.clearedAt = Math.max(S.clearedAt, remote.clearedAt);
      if (mg.changed) {
        S.tabs = mg.tabs;
        saveLocal(false);
        annotateAll();
      }
      setStatus('ok');
      syncing = false;
      if (mg.localWins > 0) schedulePush();
      return true;
    }).catch(function (e) {
      syncing = false;
      setStatus('error', e && e.message);
      return false;
    });
  }
  function setStatus(st, msg) { S.status = st; S.msg = msg || ''; paintStatus(); }

  /* ---------------------------------------------------------- CSS */
  function injectCss() {
    if (document.getElementById('sp-css')) return;
    var css = [
      '.sp-card{position:relative}',
      '.sp-tools{display:flex;align-items:center;justify-content:flex-end;gap:5px;margin-top:6px;flex-wrap:wrap}',
      '.sp-pin{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:5px;cursor:pointer;',
      '  font-size:10.5px;font-weight:800;line-height:1.5;user-select:none;border:1px solid rgba(148,163,184,0.45);',
      '  background:rgba(30,41,59,0.85);color:#cbd5e1;white-space:nowrap}',
      '.sp-pin:hover{border-color:#38bdf8;color:#7dd3fc}',
      '.sp-pin.on{background:rgba(16,185,129,0.18);border-color:#10b981;color:#6ee7b7}',
      '.sp-flag{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:5px;font-size:10.5px;',
      '  font-weight:800;background:rgba(16,185,129,0.16);color:#6ee7b7;border:1px solid rgba(16,185,129,0.4)}',
      '.sp-pinned{box-shadow:inset 3px 0 0 #10b981}',
      '.sp-xcard{position:relative;background:linear-gradient(135deg,rgba(6,78,59,0.55),rgba(15,23,42,0.95));',
      '  border:1px solid #10b981;border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:4px;',
      '  grid-column:1/-1;width:100%;box-sizing:border-box}',
      '.sp-xcard .spx-top{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}',
      '.sp-xcard .spx-nm{font-size:12.5px;font-weight:800;color:#f1f5f9;display:flex;align-items:center;gap:5px}',
      '.sp-xcard .spx-code{font-size:10px;color:#94a3b8;font-weight:700}',
      '.sp-xcard .spx-px{font-size:12.5px;font-weight:800}',
      '.sp-xcard .spx-row{display:flex;flex-wrap:wrap;gap:8px;font-size:10.5px;color:#94a3b8}',
      '.sp-xcard .spx-row b{color:#cbd5e1}',
      '.sp-xcard canvas{width:100%;height:64px;display:block;margin-top:2px}',
      '.up{color:#ef4444}.down{color:#38bdf8}.flat{color:#94a3b8}',
      '.sp-note{font-size:10px;color:#94a3b8}',
      '.sp-mini{width:100%;height:56px;display:block;margin-top:4px;border-radius:5px;background:rgba(2,6,23,0.35)}',
      '.sp-basis{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:10.5px;font-weight:700;',
      '  background:rgba(15,23,42,0.9);border:1px solid rgba(56,189,248,0.35);border-radius:7px;',
      '  padding:5px 9px;margin:0 0 9px 0;color:#94a3b8;line-height:1.5}',
      '.sp-basis b{color:#6ee7b7;font-weight:800}',
      '.sp-basis .sp-b-scan{color:#fbbf24;font-weight:800}',
      '#spStat{font-size:10px;color:#94a3b8;font-weight:700;margin-left:4px}'
    ].join('\n');
    var el = document.createElement('style');
    el.id = 'sp-css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ---------------------------------------------------------- 카드 찾기 */
  function codeOf(el) {
    if (!el) return '';
    var c = el.getAttribute('data-sp-code') || el.getAttribute('data-code') || '';
    if (/^\d{6}$/.test(c)) return c;
    var oc = el.getAttribute('onclick') || '';
    var m = oc.match(/'(\d{6})'/);
    if (m) return m[1];
    var t = (el.textContent || '');
    m = t.match(/\((\d{6})\)/) || t.match(/\b(\d{6})\b/);
    return m ? m[1] : '';
  }
  function nameOf(el, code) {
    var n = el.getAttribute('data-sp-name') || el.getAttribute('data-name') || '';
    if (n) return n;
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (code && t.indexOf(code) >= 0) {
      var m = t.match(new RegExp('([가-힣A-Za-z0-9&.\\-\\s]{1,20})\\s*\\(' + code + '\\)'));
      if (m) return m[1].trim();
    }
    var first = t.split(/\s{2,}|\n| · /)[0];
    return (first || code || '').slice(0, 24);
  }
  function manjuCards(root) {
    var out = [];
    var all = root.querySelectorAll('div[style]');
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      var st = el.getAttribute('style') || '';
      if (!/border-left\s*:\s*4px/.test(st)) continue;
      if (!el.querySelector('strong')) continue;
      if (!codeOf(el)) continue;
      out.push(el);
    }
    return out;
  }
  function findCards(tab, root) {
    if (!root) return [];
    if (tab === 'bij') return Array.prototype.slice.call(root.querySelectorAll('article.card'));
    if (tab === 'hong') return Array.prototype.slice.call(root.querySelectorAll('.hi-stock-card'));
    if (tab === 'rn') return Array.prototype.slice.call(root.querySelectorAll('#stockListGrid .stock-card'));
    if (tab === 'jongbe') return Array.prototype.slice.call(root.querySelectorAll('#stockListContainer .stock-card'));
    if (tab === 'manju') return manjuCards(root);
    return [];
  }

  /* ---------------------------------------------------------- 핀 토글 */
  function snapshot(tab, code) {
    var snap = { code: code, at: now() };
    try {
      if (tab === 'rn' && window.RnZone && window.RnZone.getStocks) {
        var r = (window.RnZone.getStocks() || []).filter(function (s) { return s && s.code === code; })[0];
        if (r) {
          snap.price = r.price; snap.pct = r.changeRatio; snap.value = r.valueText || '';
          snap.rn = { upper: r.upperRN, lower: r.lowerRN, buy1: r.buy1, buy2: r.buy2, targetMin: r.targetMin, targetMax: r.targetMax };
          if (r.candles && r.candles.length) snap.candles = r.candles.slice(-60);
        }
      } else if (tab === 'jongbe' && window.Jongbe && window.Jongbe.getStocks) {
        var j = (window.Jongbe.getStocks() || []).filter(function (s) { return s && s.code === code; })[0];
        if (j) {
          snap.price = j.price; snap.pct = j.changeRatio; snap.track = j.track; snap.badge = j.badge;
          if (j.candles && j.candles.length) snap.candles = j.candles.slice(-60);
        }
      }
    } catch (e) { /* 스냅샷은 없어도 핀은 유지된다 */ }
    return snap;
  }

  function toggle(tab, card, ev) {
    if (ev && ev.preventDefault) { ev.preventDefault(); ev.stopPropagation(); }
    if (!TABS[tab] || !card) return false;
    var code = codeOf(card);
    if (!code) return false;
    var name = nameOf(card, code);
    var cur = (S.tabs[tab] || {})[code];
    if (cur && !cur.del) {
      S.tabs[tab][code] = { code: code, name: cur.name || name, at: now(), del: true };
      S.clearedAt = 0;
    } else {
      var snap = snapshot(tab, code);
      snap.name = name;
      snap.del = false;
      S.tabs[tab][code] = snap;
    }
    saveLocal(true);
    annotate(tab);
    return true;
  }

  /* ---------------------------------------------------------- 카드 장식 */
  function ensureTools(card, tab, code) {
    var tools = card.querySelector(':scope > .sp-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'sp-tools';
      card.appendChild(tools);
    }
    var on = has(tab, code);
    var pin = tools.querySelector('.sp-pin');
    if (!pin) {
      pin = document.createElement('span');
      pin.className = 'sp-pin';
      pin.setAttribute('role', 'button');
      pin.setAttribute('tabindex', '0');
      pin.addEventListener('click', function (e) { toggle(tab, card, e); });
      pin.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') toggle(tab, card, e);
      });
      tools.appendChild(pin);
    }
    pin.className = 'sp-pin' + (on ? ' on' : '');
    pin.setAttribute('aria-pressed', on ? 'true' : 'false');
    pin.textContent = on ? '📌 핀 해제' : '📌 핀 고정';
    pin.title = on
      ? '📌 고정을 풉니다 — 내일 자동 선정에서 빠지면 이 탭에서 사라집니다'
      : '📌 핀 고정 — 내일 자동 선정이 바뀌어도 이 종목은 이 탭에 계속 남습니다';

    var flag = tools.querySelector('.sp-flag');
    if (on && !flag) {
      flag = document.createElement('span');
      flag.className = 'sp-flag';
      flag.textContent = '📌 고정됨';
      tools.insertBefore(flag, pin);
    } else if (!on && flag) {
      flag.parentNode.removeChild(flag);
    }
    if (on) card.classList.add('sp-pinned'); else card.classList.remove('sp-pinned');
    card.classList.add('sp-card');
    card.setAttribute('data-sp-code', code);

    /* 만쥬 카드는 원래 차트가 없다 — 실시간 일봉 미니 차트를 붙인다(동적 /api 가능할 때) */
    if (tab === 'manju' && S.api !== false && !card.querySelector('canvas.sp-mini')) {
      var cv = document.createElement('canvas');
      cv.className = 'sp-mini';
      cv.setAttribute('data-sp-mini', code);
      cv.setAttribute('aria-label', nameOf(card, code) + ' 일봉 미니 차트');
      card.insertBefore(cv, tools);
    }
  }

  function orderPinned(tab, cards) {
    if (!cards.length) return;
    var grid = cards[0].parentNode;
    if (!grid) return;
    var mine = cards.filter(function (el) { return el.parentNode === grid; });
    if (mine.length < 2) return;
    var pinned = [], rest = [];
    mine.forEach(function (el) {
      var c = codeOf(el);
      if (c && has(tab, c)) pinned.push(el); else rest.push(el);
    });
    if (!pinned.length) return;
    var want = pinned.concat(rest);
    var already = want.every(function (el, i) { return el === mine[i]; });
    if (already) return;
    /* 카드끼리만 순서를 바꾼다 — 안내 문구 등 다른 자식은 그 자리에 둔다 */
    want.forEach(function (el) { grid.appendChild(el); });
  }

  /* ---------------------------------------------------------- 고정핀 카드(오늘 목록에 없을 때) */
  function xcardFor(tab, item) {
    var el = document.createElement('div');
    el.className = 'sp-xcard';
    el.setAttribute('data-sp-code', item.code);
    el.setAttribute('data-sp-x', tab);
    el.innerHTML =
      '<div class="spx-top">' +
        '<div class="spx-nm"><span>📌 ' + esc(item.name || item.code) + '</span>' +
          '<span class="spx-code">' + esc(item.code) + '</span>' +
          '<span class="sp-flag">📌 고정됨</span></div>' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<span class="spx-px" data-spx="px">' + (item.price ? nf(item.price) + '원' : '—') + '</span>' +
          '<span class="spx-pc ' + colOf(item.pct) + '" data-spx="pc" style="font-size:11.5px;font-weight:800;">' + (item.pct != null ? pctTxt(item.pct) : '') + '</span>' +
          '<span class="sp-pin on" role="button" tabindex="0" data-spx="unpin">📌 핀 해제</span>' +
        '</div>' +
      '</div>' +
      '<div class="spx-row">' +
        '<span>오늘 자동선정 목록 밖 · <b>핀 고정으로 유지</b></span>' +
        '<span>대금 <b data-spx="val">' + esc(item.value || '—') + '</b></span>' +
        '<span class="sp-note" data-spx="note">' + (item.at ? new Date(item.at).toLocaleDateString('ko-KR') + ' 고정' : '') + '</span>' +
      '</div>' +
      (item.rn ? ('<div class="spx-row">' +
        '<span>상단 RN <b>' + nf(item.rn.upper) + '</b></span>' +
        '<span>하단 RN <b>' + nf(item.rn.lower) + '</b></span>' +
        '<span>1차 타점 <b>' + nf(item.rn.buy1) + '</b></span>' +
        '<span>2차 타점 <b>' + nf(item.rn.buy2) + '</b></span>' +
        '</div>') : '') +
      '<canvas data-spx="cv"></canvas>';
    el.querySelector('[data-spx="unpin"]').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var cur = S.tabs[tab][item.code];
      S.tabs[tab][item.code] = { code: item.code, name: item.name, at: now(), del: true };
      if (cur) { /* tombstone 유지 */ }
      saveLocal(true);
      annotate(tab);
    });
    el.addEventListener('click', function () { openChart(item.code, item.name); });
    return el;
  }

  function renderExtras(tab, root, cards) {
    if (!root) return;
    var grid = cards.length ? cards[0].parentNode : root.querySelector('#stockListGrid, #stockListContainer, #hiStockGrid, #cards');
    if (!grid) return;
    var present = {};
    cards.forEach(function (el) {
      var c = codeOf(el);
      if (c) present[c] = 1;
    });
    var want = list(tab).filter(function (it) { return it.code && !present[it.code]; });
    var wantCodes = {};
    want.forEach(function (it) { wantCodes[it.code] = 1; });
    /* 이미 그려 둔 카드 중 필요 없는 것 제거 */
    Array.prototype.forEach.call(grid.querySelectorAll('.sp-xcard'), function (el) {
      var c = el.getAttribute('data-sp-code');
      if (!wantCodes[c]) el.parentNode.removeChild(el);
    });
    want.forEach(function (it) {
      var el = grid.querySelector('.sp-xcard[data-sp-code="' + it.code + '"]');
      if (!el) {
        el = xcardFor(tab, it);
        grid.insertBefore(el, grid.firstChild);
      } else {
        var px = el.querySelector('[data-spx="px"]');
        if (px) px.textContent = it.price ? nf(it.price) + '원' : '—';
      }
      paintXcard(el, it);
    });
  }

  function paintXcard(el, item) {
    var q = S.live[item.code];
    var price = q && typeof q.price === 'number' ? q.price : item.price;
    var pct = q && typeof q.changePct === 'number' ? q.changePct : item.pct;
    var px = el.querySelector('[data-spx="px"]');
    var pc = el.querySelector('[data-spx="pc"]');
    var val = el.querySelector('[data-spx="val"]');
    var note = el.querySelector('[data-spx="note"]');
    if (px) px.textContent = price ? nf(price) + '원' : '—';
    if (pc) {
      pc.textContent = pct != null ? pctTxt(pct) : '';
      pc.className = 'spx-pc ' + colOf(pct);
    }
    if (val && ((q && q.valueText) || item.value)) val.textContent = (q && q.valueText) || item.value;
    if (note) {
      note.textContent = q ? ('⚡ 실시간 ' + (S.liveAt || '')) : '내장 스냅샷' + (item.at ? ' · ' + new Date(item.at).toLocaleDateString('ko-KR') + ' 고정' : '');
    }
    var cv = el.querySelector('[data-spx="cv"]');
    if (cv) drawChart(cv, S.charts[item.code] ? S.charts[item.code].candles : item.candles);
  }

  /* ---------------------------------------------------------- 미니 차트 (당일 실시간 봉 포함) */
  function drawChart(cv, candles) {
    if (!cv || !candles || candles.length < 2) return;
    var dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2.5);
    var W = Math.max(120, Math.round(cv.clientWidth || cv.parentNode.clientWidth || 260));
    var H = Math.max(48, Math.round(cv.clientHeight || 64));
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var n = Math.min(candles.length, 40);
    var view = candles.slice(-n);
    var hi = -Infinity, lo = Infinity;
    view.forEach(function (c) {
      var h = c.h != null ? c.h : c.high, l = c.l != null ? c.l : c.low;
      if (h > hi) hi = h;
      if (l < lo) lo = l;
    });
    if (!isFinite(hi) || !isFinite(lo) || hi <= lo) return;
    var pad = (hi - lo) * 0.08;
    hi += pad; lo -= pad;
    var pl = 2, pr = 2, pt = 4, pb = 4;
    var cw = (W - pl - pr) / n;
    var bw = Math.max(1.4, cw * 0.62);
    function yOf(p) { return pt + (hi - p) / (hi - lo) * (H - pt - pb); }
    view.forEach(function (c, i) {
      var o = c.o != null ? c.o : c.open, cl = c.c != null ? c.c : c.close;
      var hh = c.h != null ? c.h : c.high, ll = c.l != null ? c.l : c.low;
      var up = cl >= o;
      var x = pl + cw * i + (cw - bw) / 2;
      ctx.strokeStyle = up ? '#ef4444' : '#38bdf8';
      ctx.fillStyle = up ? '#ef4444' : '#38bdf8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + bw / 2, yOf(hh));
      ctx.lineTo(x + bw / 2, yOf(ll));
      ctx.stroke();
      var y1 = yOf(Math.max(o, cl)), y2 = yOf(Math.min(o, cl));
      var bh = Math.max(1.2, y2 - y1);
      ctx.fillRect(x, y1, bw, bh);
      if (i === view.length - 1) {           /* 오늘(마지막) 봉 = 실시간 봉 표시 */
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 0.8, y1 - 0.8, bw + 1.6, bh + 1.6);
      }
    });
  }

  function fetchChart(code) {
    if (S.charts[code] && (now() - S.charts[code].at < 60000)) return Promise.resolve(S.charts[code].candles);
    if (S.chartBusy[code]) return Promise.resolve(null);
    if (S.api === false) return Promise.resolve(null);
    S.chartBusy[code] = true;
    return fetch('/api/stock-chart?code=' + encodeURIComponent(code) + '&count=60', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        S.chartBusy[code] = false;
        if (!d || !d.ok || !d.candles || !d.candles.length) {
          if (S.api === null) S.api = false;
          return null;
        }
        S.api = true;
        var arr = d.candles.map(function (c) {
          return { date: c.date, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
        });
        S.charts[code] = { candles: arr, at: now() };
        return arr;
      })
      .catch(function () {
        S.chartBusy[code] = false;
        if (S.api === null) S.api = false;
        return null;
      });
  }

  /* ---------------------------------------------------------- 실시간 시세(고정핀) */
  function liveRefresh() {
    var codes = pinnedCodes().slice(0, 40);
    var manjuCodes = [];
    var root = document.querySelector('#tabManju');
    if (root) {
      manjuCards(root).forEach(function (el) {
        var c = codeOf(el);
        if (c && codes.indexOf(c) === -1 && manjuCodes.length < 12) manjuCodes.push(c);
      });
    }
    var all = codes.concat(manjuCodes).slice(0, 40);
    if (!all.length) return Promise.resolve(false);
    if (S.api === false) return Promise.resolve(false);
    return fetch('/api/stock-live?codes=' + all.join(','), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (txt) {
        if (!txt) { if (S.api === null) S.api = false; return false; }
        var d = null;
        try { d = JSON.parse(txt); } catch (e) { d = null; }
        if (!d || d.ok !== true) { if (S.api === null) S.api = false; return false; }
        S.api = true;
        S.liveOk = true;
        S.liveAt = new Date().toLocaleTimeString('ko-KR', { hour12: false });
        (d.stocks || []).forEach(function (s) {
          if (!s || !s.code) return;
          S.live[s.code] = {
            price: typeof s.price === 'number' ? s.price : Number(s.price),
            changePct: typeof s.changePct === 'number' ? s.changePct : Number(s.changePct),
            valueText: s.valueIntegText || s.valueText || null
          };
        });
        paintLiveAll();
        return true;
      })
      .catch(function () {
        if (S.api === null) S.api = false;
        S.liveOk = false;
        return false;
      });
  }

  function paintLiveAll() {
    /* 고정핀 카드(오늘 목록에 없어 다시 그린 카드) */
    Array.prototype.forEach.call(document.querySelectorAll('.sp-xcard'), function (el) {
      var c = el.getAttribute('data-sp-code');
      var tab = el.getAttribute('data-sp-x');
      var it = (S.tabs[tab] || {})[c];
      if (it && !it.del) paintXcard(el, it);
    });
    /* 만쥬 카드의 실시간 시세 칸(있으면) */
    Array.prototype.forEach.call(document.querySelectorAll('[data-sp-live]'), function (el) {
      var code = el.getAttribute('data-sp-live');
      var q = S.live[code];
      if (!q) return;
      el.textContent = (q.price ? nf(q.price) + '원 ' : '') + (q.changePct != null ? pctTxt(q.changePct) : '');
      el.className = 'spx-pc ' + colOf(q.changePct);
    });
    paintStatus();
    TAB_KEYS.forEach(function (t) { try { basisBadge(t); } catch (e) { /* */ } });
  }

  function paintStatus() {
    var el = document.getElementById('spStat');
    if (!el) {
      var host = document.querySelector('.srb-right') || document.querySelector('.session-radar-bar');
      if (!host) return;
      el = document.createElement('span');
      el.id = 'spStat';
      host.appendChild(el);
    }
    var n = pinnedAll();
    var bits = ['📌 고정 ' + n];
    if (S.liveOk) bits.push('⚡ 실시간 ' + (S.liveAt || ''));
    else if (S.api === false) bits.push('정적 스냅샷');
    if (S.status === 'error') bits.push('☁️ 동기화 오류');
    el.textContent = bits.join(' · ');
    el.title = '5개 전략 탭 고정핀 · Supabase ' + SUP.code + ' 동기화';
  }

  /* ---------------------------------------------------------- 보이는 탭 차트 실시간 갱신 */
  var chartAt = 0, jongRotate = 0;
  function activeView() {
    var b = document.querySelector('.tab-btn.active');
    return b ? (b.getAttribute('data-view') || '') : '';
  }
  function applyJongbeChart(code) {
    if (S.api === false) return Promise.resolve(false);
    return fetch('/api/stock-chart?code=' + encodeURIComponent(code) + '&count=45', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || !d.candles) { if (S.api === null) S.api = false; return false; }
        S.api = true;
        if (window.Jongbe && typeof window.Jongbe.updateCandles === 'function') {
          return window.Jongbe.updateCandles(code, d.candles);
        }
        return false;
      })
      .catch(function () { if (S.api === null) S.api = false; return false; });
  }
  function paintManjuCharts() {
    var root = document.querySelector('#tabManju');
    if (!root || S.api === false) return;
    var cvs = root.querySelectorAll('canvas.sp-mini');
    Array.prototype.forEach.call(cvs, function (cv) {
      var code = cv.getAttribute('data-sp-mini');
      if (!code) return;
      fetchChart(code).then(function (arr) { if (arr) drawChart(cv, arr); });
    });
  }
  function refreshVisibleCharts(force) {
    if (document.visibilityState !== 'visible') return;
    if (!force && now() - chartAt < 40000) return;
    chartAt = now();
    var v = activeView();
    try {
      if (v === 'jongbe' && window.Jongbe && typeof window.Jongbe.getStocks === 'function') {
        var list = window.Jongbe.getStocks() || [];
        if (list.length) {
          for (var i = 0; i < 3; i += 1) {
            var s = list[(jongRotate + i) % list.length];
            if (s && s.code) applyJongbeChart(s.code);
          }
          jongRotate = (jongRotate + 3) % list.length;
        }
      } else if (v === 'bijoong' && window.BijoongTab && typeof window.BijoongTab.reloadCharts === 'function') {
        window.BijoongTab.reloadCharts();
      } else if (v === 'honginki' && window.HonginkiTab && typeof window.HonginkiTab.reloadCharts === 'function') {
        window.HonginkiTab.reloadCharts();
      } else if (v === 'manju') {
        paintManjuCharts();
      }
    } catch (e) { /* 한 탭이 실패해도 나머지는 그대로 */ }
  }
  /* ---------------------------------------------------------- 기준 시각 배지(모든 탭 공통) */
  /* 오늘(KST) 날짜 — 캔들 마지막 봉이 오늘 실시간 봉이면 '스캔 기준'은 그 앞 봉이다 */
  function todayISO() {
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function lastSettled(candles) {
    var arr = candles || [];
    var today = todayISO();
    for (var i = arr.length - 1; i >= 0; i -= 1) {
      var d = String(arr[i].date || '').replace(/[^0-9]/g, '');
      var iso = d.length === 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : String(arr[i].date);
      if (iso !== today) return iso;
    }
    return arr.length ? String(arr[arr.length - 1].date) : '';
  }
  function scanDate(tab) {
    try {
      if (tab === 'rn' && window.RnZone && window.RnZone.getStocks) {
        var a = window.RnZone.getStocks() || [];
        for (var i = 0; i < a.length; i += 1) {
          var cs = (a[i] && a[i].candles) || [];
          if (cs.length) return lastSettled(cs);
        }
      }
      if (tab === 'jongbe' && window.Jongbe && window.Jongbe.getStocks) {
        var b = window.Jongbe.getStocks() || [];
        for (var j = 0; j < b.length; j += 1) {
          var c2 = (b[j] && b[j].candles) || [];
          if (c2.length) return lastSettled(c2);
        }
      }
    } catch (e) { /* */ }
    var root = document.querySelector(TABS[tab].root);
    var t = root ? (root.textContent || '') : '';
    var m = t.match(/(?:\uc2e4\uce21 \uae30\uc900\uc77c|\uae30\uc900\ubd09\uc77c|\uc885\uac00 \uc2e4\uce21)\s*(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    m = t.match(/(?:\uac31\uc2e0|\uc815\uae30 \ubc18\uc601)\s*(\d{1,2}\/\d{1,2} \d{1,2}:\d{2})/);
    if (m) return m[1];
    return '';
  }

  function basisBadge(tab) {
    var cfg = TABS[tab];
    if (!cfg) return;
    var root = document.querySelector(cfg.root);
    if (!root) return;
    var el = root.querySelector(':scope > .sp-basis');
    if (!el) {
      el = document.createElement('div');
      el.className = 'sp-basis';
      el.setAttribute('data-sp-basis', tab);
      root.insertBefore(el, root.firstChild);
    }
    var stamp = S.liveOk ? ('🟢 ' + (S.liveAt || '') + ' 실시간') : (S.api === false ? '📋 정적 스냅샷' : '… 시세 확인 중');
    var how = S.liveOk ? '현재가·차트 20초 자동 갱신' : (S.api === false ? '실시간 API 없음 · 배포 시점 값' : '');
    var basis = scanDate(tab);
    el.innerHTML = '<span>기준 시각</span><b>' + esc(stamp) + '</b>' +
      (how ? '<span>' + esc(how) + '</span>' : '') +
      (basis ? '<span class="sp-b-scan">📋 자동선정 ' + esc(basis) + ' 종가 스캔</span>'
             : '<span class="sp-b-scan">📋 장마감 종가 스캔</span>');
  }

  function openChart(code, name) {
    var nm = (name || code) + ' [📌 고정핀]';
    try {
      if (typeof window.openDetail === 'function') {
        window.openDetail(nm, '📌 오늘 자동선정 목록 밖', '실시간 일봉 기준 차트', '📌 핀 고정으로 이 탭에 유지 중인 종목입니다. 차트는 /api/stock-chart 실시간 일봉(당일 봉 포함)입니다.');
        return true;
      }
    } catch (e) { /* 아래 대체 경로 */ }
    try {
      if (window.LiveAPI && typeof window.LiveAPI.searchStock === 'function' && window.RnZone && typeof window.switchView === 'function') {
        window.switchView('rnzone', null);
        var inp = document.getElementById('liveSearchInput') || document.getElementById('rnSearchInput');
        if (inp) { inp.value = name || code; setTimeout(function () { window.LiveAPI.searchStock(); }, 120); return true; }
      }
    } catch (e2) { /* */ }
    return false;
  }

  /* ---------------------------------------------------------- 장식 실행 */
  function annotate(tab) {
    var cfg = TABS[tab];
    if (!cfg) return;
    var root = document.querySelector(cfg.root);
    if (!root) return;
    var cards = findCards(tab, root);
    cards.forEach(function (el) {
      var code = codeOf(el);
      if (!code) return;
      ensureTools(el, tab, code);
    });
    orderPinned(tab, cards);
    renderExtras(tab, root, cards);
    try { basisBadge(tab); } catch (e) { /* */ }
  }
  function annotateAll() { TAB_KEYS.forEach(annotate); }

  /* ---------------------------------------------------------- 부트 */
  function boot() {
    injectCss();
    loadLocal();
    annotateAll();
    paintStatus();
    pullNow().then(function () { annotateAll(); liveRefresh(); refreshVisibleCharts(true); });
    setTimeout(function () { refreshVisibleCharts(true); paintManjuCharts(); }, 1500);

    var t = null;
    var obs = new MutationObserver(function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () { annotateAll(); }, 260);
    });
    var obsTargets = 0;
    TAB_KEYS.forEach(function (k) {
      var root = document.querySelector(TABS[k].root);
      if (root) { obs.observe(root, { childList: true, subtree: true }); obsTargets += 1; }
    });
    /* 탭 영역이 나중에 만들어지는 경우까지 대비 */
    if (obsTargets < TAB_KEYS.length) {
      var tries = 0;
      var iv = setInterval(function () {
        tries += 1;
        TAB_KEYS.forEach(function (k) {
          var root = document.querySelector(TABS[k].root);
          if (root && !root.__spObs) { root.__spObs = true; obs.observe(root, { childList: true, subtree: true }); }
        });
        if (tries > 20) clearInterval(iv);
      }, 500);
    }
    /* 화면에 보이는 동안 20초마다 실시간 시세, 60초마다 차트 */
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      liveRefresh();
    }, 20000);
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      pinnedCodes().slice(0, 8).forEach(function (code) {
        fetchChart(code).then(function (arr) {
          if (!arr) return;
          var el = document.querySelector('.sp-xcard[data-sp-code="' + code + '"] canvas');
          if (el) drawChart(el, arr);
        });
      });
    }, 60000);
    /* 탭을 바꿔 들어가면 그 탭 차트를 바로 실시간 일봉으로 다시 그린다 */
    var lastView = '';
    setInterval(function () {
      var v = activeView();
      if (!v || v === lastView) return;
      lastView = v;
      if (v === 'bijoong' || v === 'honginki' || v === 'jongbe' || v === 'manju' || v === 'rnzone') {
        setTimeout(function () { refreshVisibleCharts(true); paintManjuCharts(); }, 700);
      }
    }, 700);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { annotateAll(); liveRefresh(); refreshVisibleCharts(true); }
    });
    window.addEventListener('online', function () { pullNow(); liveRefresh(); });
    setInterval(function () {
      if (document.visibilityState === 'visible') pullNow();
    }, 60000);
    S.booted = true;
    window.__SP_BOOTED = true;
  }

  window.StrategyPins = {
    version: VERSION,
    toggle: toggle,
    has: has,
    list: list,
    annotate: annotate,
    annotateAll: annotateAll,
    refreshLive: liveRefresh,
    refreshCharts: function () { refreshVisibleCharts(true); paintManjuCharts(); },
    openChart: openChart,
    sync: function () { return pullNow().then(pushNow); },
    clear: function (tab) {
      if (!TABS[tab]) return;
      list(tab).forEach(function (it) { S.tabs[tab][it.code] = { code: it.code, name: it.name, at: now(), del: true }; });
      saveLocal(true);
      annotate(tab);
    },
    state: function () {
      var out = {};
      TAB_KEYS.forEach(function (k) { out[k] = list(k).map(function (i) { return i.code; }); });
      return {
        version: VERSION, tabs: out, total: pinnedAll(), status: S.status, msg: S.msg,
        live: { ok: S.liveOk, at: S.liveAt, count: Object.keys(S.live).length },
        api: S.api, charts: Object.keys(S.charts).length
      };
    },
    KEY: LS,
    CLOUD_CODE: SUP.code,
    TABS: TAB_KEYS
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
