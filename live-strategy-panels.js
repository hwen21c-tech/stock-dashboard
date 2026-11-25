/* ============================================================================
 * ⚡ 장중 전략 실시간 판정 패널 — 정적 관제탑(GitHub Pages) 전용 (2026-11-24)
 * ----------------------------------------------------------------------------
 *  정적 페이지의 전략 5탭(비중법사·홍인기·깡토·종가베팅·RN존)은 장마감 확정 스냅샷만
 *  들고 있다. 이 파일은 동적 본체(/api/tabs-live)의 strategyLive 를 그대로 받아
 *  깡토 · 종가베팅 · RN존 세 탭 맨 위에 '지금 조건을 채웠는지'를 붙인다.
 *
 *  · 요청 경로는 live-static-api.js 가 상대 '/api/...' 를 동적 오리진으로 넘겨 준다.
 *    (__API_BASE 가 없으면 상대경로 그대로 — 일반 서버에서 열 때)
 *  · 응답이 없거나 형식이 다르면 아무것도 그리지 않는다. 정적 스냅샷은 그대로 두고
 *    **값을 만들어 내지 않는다**(실패를 성공처럼 보이게 하지 않는 원칙).
 *  · 장중(08:00~20:05)에는 30초, 그 밖에는 10분 간격으로 다시 받는다. 숨은 탭에서는 쉽니다.
 * ========================================================================== */
(function () {
  'use strict';

  var REFRESH_LIVE_MS = 30 * 1000;
  var REFRESH_IDLE_MS = 10 * 60 * 1000;
  var lastAt = 0;
  var busy = false;
  var lastSig = {};

  function base() {
    return window.__API_BASE || '';
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function won(v) {
    return isNum(v) ? Math.round(v).toLocaleString('ko-KR') + '원' : '—';
  }

  function pct(v) {
    return isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '—';
  }

  function eok(v) {
    if (!isNum(v)) return '—';
    return v >= 1000 ? Math.round(v).toLocaleString('ko-KR') + '억' : v.toFixed(1) + '억';
  }

  function colFor(v) {
    if (!isNum(v)) return '#94a3b8';
    return v > 0 ? '#f87171' : v < 0 ? '#60a5fa' : '#94a3b8';
  }

  function stateColor(key) {
    if (key === 'stop' || key === 'below') return '#fca5a5';
    if (key === 'tp' || key === 'tp1' || key === 'tp2' || key === 'target' || key === 'upper') return '#fbbf24';
    if (key === 'break' || key === 'lower' || key === 'hold' || key === 'entry') return '#34d399';
    if (key === 'near' || key === 'near_lower') return '#93c5fd';
    return '#94a3b8';
  }

  /* ---------- 상자 접기/펼치기 (11/26 · 동적 live-api.js 와 같은 규격/같은 저장 키) ----------
   *  · 헤더 오른쪽 [접기 ▾] / [펼치기 ▸] 하나. 기본 펼침.
   *  · 접힘은 localStorage(sd_strat_box_fold_v1)에 남겨 30초 새로고침·페이지 재방문 뒤에도 유지.
   *  · 접어도 카드·차트는 그대로 — 상자 본문만 숨긴다. 400px에서 제목은 한 줄 말줌임. */
  var BOX_FOLD_STORE = 'sd_strat_box_fold_v1';

  function folds() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(BOX_FOLD_STORE) : null;
      var o = raw ? JSON.parse(raw) : {};
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }

  function collapsed(key) {
    return key ? Boolean(folds()[key]) : false;
  }

  function setCollapsed(key, on) {
    if (!key) return;
    var all = folds();
    if (on) all[key] = 1; else delete all[key];
    try { if (window.localStorage) window.localStorage.setItem(BOX_FOLD_STORE, JSON.stringify(all)); } catch (e) { /* 저장 실패 — 이번 화면에서만 */ }
  }

  function toggle(key) {
    var next = !collapsed(key);
    setCollapsed(key, next);
    Array.prototype.forEach.call(document.querySelectorAll('[data-lsp-box="' + key + '"]'), function (el) {
      el.style.display = next ? 'none' : 'block';
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-lsp-boxtog="' + key + '"]'), function (btn) {
      btn.textContent = next ? '펼치기 ▸' : '접기 ▾';
      btn.setAttribute('aria-expanded', next ? 'false' : 'true');
      btn.title = next ? '이 판정 상자를 펼칩니다' : '이 판정 상자를 접습니다(접어도 아래 종목 카드·차트는 그대로)';
    });
    return next;
  }
  window.LiveStrategyPanels = window.LiveStrategyPanels || {};
  window.LiveStrategyPanels.boxToggle = toggle;

  function toggleBtn(key, accent, isCollapsed) {
    if (!key) return '';
    return '<button type="button" data-lsp-boxtog="' + esc(key) + '" aria-expanded="' + (isCollapsed ? 'false' : 'true') + '"' +
      ' title="' + (isCollapsed ? '이 판정 상자를 펼칩니다' : '이 판정 상자를 접습니다(접어도 아래 종목 카드·차트는 그대로)') + '"' +
      ' onclick="' + esc("if(window.LiveStrategyPanels&&LiveStrategyPanels.boxToggle){LiveStrategyPanels.boxToggle('" + key + "')}") + '"' +
      ' style="flex:0 0 auto;padding:3px 9px;border-radius:6px;background:rgba(148,163,184,0.10);border:1px solid ' + accent +
      ';color:' + accent + ';font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap;line-height:1.5;">' +
      (isCollapsed ? '펼치기 ▸' : '접기 ▾') + '</button>';
  }

  function box(title, sub, accent, body, foldKey) {
    var isCollapsed = collapsed(foldKey);
    return (
      '<div style="background:#0b1220;border:1px solid ' + accent + ';border-radius:10px;padding:10px 11px;margin:10px 0;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:nowrap;">' +
      '<span style="font-size:12px;font-weight:800;color:' + accent + ';min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + title + '</span>' +
      toggleBtn(foldKey, accent, isCollapsed) +
      '</div>' +
      '<div style="font-size:10px;color:#94a3b8;font-weight:700;margin-top:2px;line-height:1.4;">' + sub + '</div>' +
      '<div data-lsp-box="' + esc(foldKey || '') + '" style="display:' + (isCollapsed ? 'none' : 'block') + ';">' + body + '</div></div>'
    );
  }

  function row(c, L, src, right) {
    var nm = String(c.name || '');
    var onclick =
      "if(window.openDetail){openDetail('" +
      nm.replace(/'/g, '').replace(/[\r\n]/g, ' ') + ' (' + String(c.code || '') + ")','실시간 일봉 차트','" +
      esc(pct(L.pct)) + "','정적 관제탑 — 동적 /api/tabs-live 의 장중 판정입니다.')}";
    return (
      '<div onclick="' + esc(onclick) + '" title="누르면 차트 팝업" ' +
      'style="cursor:pointer;padding:6px 8px;margin-bottom:4px;border-radius:6px;background:rgba(15,23,42,0.72);border:1px solid rgba(148,163,184,0.16);">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;flex-wrap:wrap;">' +
      '<span style="font-size:11.5px;font-weight:800;color:#e2e8f0;">' + esc(c.name) +
      ' <span style="font-size:9.5px;color:#64748b;font-weight:700;">' + esc(c.code) + '</span> ' +
      '<span style="color:' + stateColor(L.stateKey) + ';font-weight:900;">' + esc(L.stateLabel) + '</span></span>' +
      '<span style="font-size:11px;font-weight:800;color:' + colFor(L.pct) + ';white-space:nowrap;">' +
      esc(won(L.price)) + ' ' + esc(pct(L.pct)) + '</span></div>' +
      '<div style="font-size:10px;color:#94a3b8;line-height:1.5;margin-top:2px;">' + right + '</div>' +
      '</div>'
    );
  }

  function kkRow(c) {
    var L = c.live;
    if (!L) return '<div style="font-size:11px;color:#94a3b8;padding:5px 8px;">' + esc(c.name) + ' — 실시간 시세 미수신</div>';
    var right =
      '매수타점(전고점) ' + won(L.pivot) +
      (isNum(L.toPivotPct) ? ' · 거리 ' + (L.toPivotPct >= 0 ? '+' : '') + L.toPivotPct.toFixed(2) + '%' : '') +
      ' · 손절 ' + won(L.stop) + ' · 익절 ' + won(L.tp) +
      '<br>60일선 ' + won(L.ma60) + ' <b style="color:' + (L.aboveMa60 ? '#34d399' : '#fca5a5') + ';">' +
      (L.aboveMa60 ? '위' : '아래') + '</b> · 대금 ' + eok(L.valueEok) +
      ' · 기준일 종가 ' + won(L.base) + ' 대비 <b style="color:' + colFor(L.vsBasePct) + ';">' + pct(L.vsBasePct) + '</b>';
    return row(c, L, 'kkangto', right);
  }

  function jbRow(c) {
    var L = c.live;
    var track = c.track === 'shin' ? '신정재' : c.track === 'kang' ? '강창권' : '';
    if (!L) return '<div style="font-size:11px;color:#94a3b8;padding:5px 8px;">' + esc(c.name) + ' — 실시간 시세 미수신</div>';
    var right =
      (track ? '<b style="color:#fbbf24;">' + track + '</b> · ' : '') +
      '기준가 ' + won(L.base) + ' 대비 <b style="color:' + colFor(L.vsBasePct) + ';">' + pct(L.vsBasePct) + '</b>' +
      ' · 목표 ' + won(L.target1) + (isNum(L.target2) ? ' / ' + won(L.target2) : '') +
      ' · 손절 ' + won(L.stopPrice) +
      '<br>대금 ' + (esc(L.valueText || eok(L.valueEok)));
    return row(c, L, 'jongbe', right);
  }

  function rnRow(c) {
    var L = c.live;
    if (!L) return '<div style="font-size:11px;color:#94a3b8;padding:5px 8px;">' + esc(c.name) + ' — 실시간 시세 미수신</div>';
    var right =
      '하단 RN ' + won(L.lowerRN) + ' · 상단 RN ' + won(L.upperRN) +
      (isNum(L.zonePct) ? ' · 구간 ' + Math.round(L.zonePct) + '%' : '') +
      (isNum(L.buy1) ? '<br>매수 1차 ' + won(L.buy1) + ' · 2차 ' + won(L.buy2) : '') +
      ' · 대금 ' + esc(L.valueText || eok(L.valueEok));
    return row(c, L, 'rnzone', right);
  }

  function panel(sec, title, accent, rowFn, foldKey) {
    if (!sec || !sec.cards || !sec.cards.length) return null;
    var head =
      '<div style="font-size:10px;color:#94a3b8;margin:3px 0 6px;line-height:1.5;">' +
      '기준 ' + esc(sec.basisLabel || sec.basisDate || '—') + ' · 오늘 <b style="color:#e2e8f0;">' + esc(sec.dayLabel || '—') + '</b>' +
      (sec.basisStale ? ' <span style="color:#fbbf24;font-weight:800;">⚠️ 재스캔 필요</span>' : '') + '</div>';
    return box(title, '실시간 ' + (sec.live || 0) + '/' + (sec.total || 0) + '종목', accent, head + sec.cards.map(rowFn).join(''), foldKey);
  }

  function host(tabId, hostId) {
    var tab = document.getElementById(tabId);
    if (!tab) return null;
    var h = document.getElementById(hostId);
    if (!h) {
      h = document.createElement('div');
      h.id = hostId;
      if (tab.firstChild) tab.insertBefore(h, tab.firstChild);
      else tab.appendChild(h);
    }
    return h;
  }

  function paint(hostId, html) {
    var h = document.getElementById(hostId);
    if (!h) return 0;
    if (!html) {
      if (h.innerHTML) h.innerHTML = '';
      lastSig[hostId] = '';
      return 0;
    }
    var sig = html.length + ':' + html.slice(0, 120) + ':' + html.slice(-80);
    if (lastSig[hostId] !== sig) {
      h.innerHTML = html;
      lastSig[hostId] = sig;
    }
    h.setAttribute('data-live', '1');
    return 1;
  }

  function inMarketHours() {
    var now = new Date();
    var day = now.getDay();
    if (day === 0 || day === 6) return false;
    var m = now.getHours() * 60 + now.getMinutes();
    return m >= 8 * 60 && m <= 20 * 60 + 5;
  }

  function load() {
    if (busy || document.hidden) return Promise.resolve(0);
    busy = true;
    var url = base() + '/api/tabs-live?_=' + Date.now();
    return fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (body) {
        var sl = body && body.strategyLive;
        if (!sl) return 0;
        var applied = 0;
        host('tabKkangto', 'stratLiveKkangtoHost');
        host('tabJongbe', 'stratLiveJongbeHost');
        host('tabRnzone', 'stratLiveRnzoneHost');
        applied += paint('stratLiveKkangtoHost', panel(sl.kkangto, '⚡ 깡토 추세추종 · 실시간 조건 판정', '#38bdf8', kkRow, 'kkangto'));
        applied += paint('stratLiveJongbeHost', panel(sl.jongbe, '💪 종가베팅 마스터 · 실시간 조건 판정', '#fbbf24', jbRow, 'jongbe'));
        applied += paint('stratLiveRnzoneHost', panel(sl.rnzone, '🎯 RN존 · 실시간 구간 판정', '#f472b6', rnRow, 'rnzone'));
        lastAt = Date.now();
        return applied;
      })
      .catch(function () {
        return 0; // 응답 없음 — 정적 스냅샷 유지, 값을 만들지 않는다
      })
      .then(function (n) {
        busy = false;
        return n;
      });
  }

  function tick() {
    var wait = inMarketHours() ? REFRESH_LIVE_MS : REFRESH_IDLE_MS;
    if (Date.now() - lastAt >= wait) load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(load, 1200); });
  } else {
    setTimeout(load, 1200);
  }
  setInterval(tick, 15 * 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tick();
  });

  window.LiveStrategyPanels = window.LiveStrategyPanels || {};
  window.LiveStrategyPanels.load = load;
  window.LiveStrategyPanels.refresh = load;
  window.LiveStrategyPanels.boxToggle = toggle;
})();
