/* ============================================================================
 * 🌙 오늘 종가베팅 공략 후보 (2트랙) — 2026-11-24 신설
 * ----------------------------------------------------------------------------
 *  1번 메인 탭의 「🌅 오늘 시초가 공략 후보」 바로 아래에 붙는다.
 *
 *  트랙 ①  🔥 테마주도주 (신정재·만쥬 결)
 *           당일 거래대금 300억↑ · 등락률 +3%↑ · 윗꼬리 5% 이내 (상한가 포함)
 *  트랙 ②  💰 수급주도주 (침착해·홍인기 결)
 *           KIS 장중 가집계 외인·기관 양매수(또는 한쪽 강한 매수) + 거래대금 500억↑
 *
 *  · 값은 /api/tabs-live 의 closingPicks 만 쓴다 — 화면은 계산·추정하지 않는다.
 *    (서버가 기준 미달이면 빈 배열로 내려주고, 화면은 '조건 충족 종목 없음'만 적는다.
 *     기준을 채우려 임의로 완화하지 않는 것이 사용자 확정 철칙이다.)
 *  · 장중 30초 · 그 밖 10분 간격으로 다시 받는다. 숨은 탭에서는 쉰다.
 *  · 카드 클릭 → 공통 종목 모달(window.openDetail — 일봉·분봉·RN).
 * ========================================================================== */
(function () {
  'use strict';

  var LIVE_MS = 30 * 1000;
  var IDLE_MS = 10 * 60 * 1000;
  var TABS_URL = '/api/tabs-live';

  var lastAt = 0;
  var busy = false;
  var DATA = null;      /* 마지막 성공 응답의 closingPicks */
  var FAIL = null;      /* 마지막 실패 사유(문자열) */
  var track = 'theme';
  var collapsed = false;

  function $(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v) { return isNum(v) ? v : null; }
  function comma(v) { return isNum(v) ? Math.round(v).toLocaleString('ko-KR') : '—'; }
  function won(v) { return isNum(v) ? Math.round(v).toLocaleString('ko-KR') + '원' : '—'; }
  function pctf(v) { return isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '—'; }
  function eok(v) {
    if (!isNum(v)) return '—';
    return Math.abs(v) >= 1000 ? comma(v) + '억' : (Math.round(v * 10) / 10).toLocaleString('ko-KR') + '억';
  }
  function signedEok(v) {
    if (!isNum(v)) return '—';
    return (v > 0 ? '+' : v < 0 ? '-' : '') + eok(Math.abs(v));
  }
  function upColor(v) {
    if (!isNum(v)) return '#cbd5e1';
    return v > 0 ? '#f43f5e' : v < 0 ? '#38bdf8' : '#cbd5e1';
  }
  function tailColor(t) {
    if (!isNum(t)) return '#cbd5e1';
    return t <= 2 ? '#6ee7b7' : t <= 5 ? '#fcd34d' : '#fda4af';
  }

  /* 기기 시계가 아니라 KST 기준으로 장 상태를 본다 */
  function nowKst() {
    var d = new Date();
    try {
      var f = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
      }).formatToParts(d);
      var o = {};
      f.forEach(function (p) { o[p.type] = p.value; });
      return {
        minute: (parseInt(o.hour, 10) % 24) * 60 + parseInt(o.minute, 10),
        ymd: o.year + '-' + o.month + '-' + o.day,
        wd: o.weekday || ''
      };
    } catch (e) {
      return {
        minute: d.getHours() * 60 + d.getMinutes(),
        ymd: d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(),
        wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
      };
    }
  }

  /* ⏱ 종가베팅 타임 뱃지 — KST 시각 기준 자동 전환 (15:18~15:30 종가 매수창 강조) */
  function timeInfo() {
    var k = nowKst();
    if (k.wd === 'Sat' || k.wd === 'Sun') return { cls: 'closed', text: '⏱ 휴장' };
    var m = k.minute;
    if (m < 9 * 60) return { cls: 'closed', text: '⏱ 장전 대기' };
    if (m < 15 * 60 + 18) return { cls: 'lead', text: '🔥 장중 실시간' };
    if (m < 15 * 60 + 30) return { cls: 'lead', text: '⏰ 종가 매수창 (15:18~15:30)' };
    return { cls: '', text: '🌙 마감 · 익일 대비' };
  }

  function inMarketHours() {
    var k = nowKst();
    if (k.wd === 'Sat' || k.wd === 'Sun') return false;
    return k.minute >= 8 * 60 && k.minute <= 20 * 60 + 5;
  }

  function listOf(k) {
    if (!DATA) return [];
    return (k === 'supply' ? DATA.supplyTrack : DATA.themeTrack) || [];
  }

  /* --------------------------------- 카드 --------------------------------- */
  function chip(cls, text) {
    return '<span class="op-chip ' + cls + '">' + esc(text) + '</span>';
  }

  function themeCard(p, i) {
    var chips = [];
    if (isNum(p.upperTailPct)) chips.push(chip(p.upperTailPct <= 2 ? 'ok' : 'warm', '윗꼬리 ' + p.upperTailPct.toFixed(2) + '%'));
    if (p.upperLimit) chips.push(chip('hot', '상한가'));
    if (isNum(p.themeRank)) chips.push(chip(p.themeRank === 1 ? 'hot' : 'st-up', '테마 ' + p.themeRank + '위'));
    if (p.valueBasis) chips.push(chip('mute', p.valueBasis));
    return '<div class="op-card lead" data-cp-track="theme" data-cp-idx="' + i + '" role="button" tabindex="0">' +
      '<div class="op-card-top"><span class="op-rank">' + (p.rank || i + 1) + '</span>' +
      '<span class="op-name">' + esc(p.name) + '</span>' +
      '<span class="op-price">' + won(p.price) + '</span>' +
      '<span class="op-chg" style="color:' + upColor(p.changePct) + ';">' + pctf(p.changePct) + '</span></div>' +
      '<div class="op-meta">대금 ' + eok(p.valueEok) + (p.themeName ? ' · ' + esc(p.themeName) : '') + '</div>' +
      '<div class="op-chips">' + chips.join('') + '</div>' +
      '<div class="op-why">' + esc(p.ruleHint || '') + '</div>' +
      '</div>';
  }

  function supplyCard(p, i) {
    var chips = [];
    if (isNum(p.foreignEok)) chips.push(chip(p.foreignEok > 0 ? 'st-up' : p.foreignEok < 0 ? 'st-dn' : 'mute', '외 ' + signedEok(p.foreignEok)));
    if (isNum(p.organEok)) chips.push(chip(p.organEok > 0 ? 'st-up' : p.organEok < 0 ? 'st-dn' : 'mute', '기 ' + signedEok(p.organEok)));
    if (isNum(p.totalEok)) chips.push(chip('ok', '합 ' + signedEok(p.totalEok)));
    if (p.supplyKind) chips.push(chip('warm', p.supplyKind));
    return '<div class="op-card" data-cp-track="supply" data-cp-idx="' + i + '" role="button" tabindex="0">' +
      '<div class="op-card-top"><span class="op-rank">' + (p.rank || i + 1) + '</span>' +
      '<span class="op-name">' + esc(p.name) + '</span>' +
      '<span class="op-price">' + won(p.price) + '</span>' +
      '<span class="op-chg" style="color:' + upColor(p.changePct) + ';">' + pctf(p.changePct) + '</span></div>' +
      '<div class="op-meta">대금 ' + eok(p.valueEok) + (p.basis ? ' · ' + esc(p.basis) : '') + '</div>' +
      '<div class="op-chips">' + chips.join('') + '</div>' +
      '<div class="op-why">' + esc(p.ruleHint || '') + '</div>' +
      '</div>';
  }

  /* --------------------------------- 렌더 --------------------------------- */
  function rulesText() {
    var r = (DATA && DATA.rules) || {};
    return {
      theme: r.theme || '당일 거래대금 300억↑ · 등락률 +3%↑ · 윗꼬리 5% 이내 · ETF·ETP·우선주 제외',
      supply: r.supply || 'KIS 가집계 외인·기관 양매수(또는 한쪽 강한 매수) + 거래대금 500억↑'
    };
  }

  function render() {
    var box = $('closingPicksBox');
    var body = $('cpBody');
    if (!box || !body) return;

    var themeN = (DATA && (DATA.themeTrack || []).length) || 0;
    var supplyN = (DATA && (DATA.supplyTrack || []).length) || 0;

    if ($('cpTabThemeN')) $('cpTabThemeN').textContent = themeN;
    if ($('cpTabSupplyN')) $('cpTabSupplyN').textContent = supplyN;
    var tt = $('cpTabTheme'), ts = $('cpTabSupply');
    if (tt) { tt.classList.toggle('active', track === 'theme'); tt.setAttribute('aria-selected', track === 'theme' ? 'true' : 'false'); }
    if (ts) { ts.classList.toggle('active', track === 'supply'); ts.setAttribute('aria-selected', track === 'supply' ? 'true' : 'false'); }

    var tb = $('cpTimeBadge'), ti = timeInfo();
    if (tb) { tb.className = 'op-badge op-time ' + ti.cls; tb.textContent = ti.text; }

    var badge = $('cpBadge');
    if (badge) {
      var bt;
      if (DATA && DATA.asOfLabel) {
        bt = '⏱ ' + DATA.asOfLabel;
        if (FAIL) bt += ' · ⚠️ 갱신 실패(마지막 성공 유지)';
      } else if (FAIL) {
        bt = '⚠️ ' + FAIL;
      } else {
        bt = '⏱ 로딩 중';
      }
      badge.className = 'op-badge' + (collapsed ? ' closed' : '') + (track === 'supply' ? ' lead' : '');
      badge.textContent = bt;
    }

    var note = $('cpNote');
    var rt = rulesText();
    if (note) {
      var line = track === 'theme'
        ? '🔥 <b style="color:#fda4af;">테마주도주</b> — ' + esc(rt.theme)
        : '💰 <b style="color:#fcd34d;">수급주도주</b> — ' + esc(rt.supply);
      var extra = track === 'theme' ? (DATA && DATA.themeAsOfLabel) : (DATA && DATA.supplyAsOfLabel);
      note.innerHTML = line + (extra ? '<br><span style="color:#94a3b8;">기준: ' + esc(extra) + '</span>' : '');
    }

    var list = listOf(track);
    if (!DATA) {
      body.innerHTML = '<div style="font-size:11.5px; color:#94a3b8; padding:8px;">⏳ 종가베팅 후보를 불러오는 중…</div>';
    } else if (!list.length) {
      body.innerHTML = '<div style="font-size:11.5px; color:#fca5a5; padding:8px; line-height:1.7;">' +
        '조건 충족 종목 없음 — ' + esc(track === 'theme' ? rt.theme : rt.supply) +
        ' <span style="color:#94a3b8;">(기준을 임의로 완화해 채우지 않습니다)</span></div>';
    } else {
      body.innerHTML = list.map(track === 'theme' ? themeCard : supplyCard).join('');
    }

    var prin = $('cpPrinciple');
    if (prin) {
      prin.innerHTML = '<b>📐 종가베팅 원칙</b> ' +
        (track === 'theme'
          ? '15:18~20 저점지지 확인 후 진입 · 갭상승 시 분할익절 · 재료 소진(당일 고점 대비 -5% 이상 밀림)이면 제외'
          : '오후 수급·프로그램 방어 확인 · 익일 10시 기관 대응까지 홀딩 · 외인·기관이 동반 이탈하면 즉시 정리');
    }

    var foot = $('cpFoot');
    if (foot) {
      foot.innerHTML = '출처: ' + esc((DATA && DATA.sourceLabel) || '/api/tabs-live closingPicks') +
        (DATA && DATA.generatedAtKst ? ' · ' + esc(DATA.generatedAtKst) + ' 갱신' : '') +
        ' · 카드를 누르면 이 종목의 상세 차트(일봉·분봉·RN)가 열립니다.' +
        (FAIL ? '<br><span style="color:#fca5a5;">⚠️ ' + esc(FAIL) + '</span>' : '');
    }

    Array.prototype.forEach.call(body.querySelectorAll('[data-cp-idx]'), function (el) {
      var t = el.getAttribute('data-cp-track');
      var idx = parseInt(el.getAttribute('data-cp-idx'), 10);
      function go() { open(t, idx); }
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  function open(t, i) {
    var p = (t === 'supply' ? listOf('supply') : listOf('theme'))[i];
    if (!p) return;
    var title = p.name + (p.code ? ' (' + p.code + ')' : '');
    var sub = pctf(p.changePct);
    var meta;
    var desc;
    if (t === 'supply') {
      meta = '대금 ' + eok(p.valueEok) + ' · 외 ' + signedEok(p.foreignEok) + ' · 기 ' + signedEok(p.organEok);
      desc = '<div style="font-size:10.5px; color:#e2e8f0; line-height:1.6;">' +
        '· 현재가 <b>' + won(p.price) + '</b> · 등락률 <b style="color:' + upColor(p.changePct) + ';">' + pctf(p.changePct) + '</b><br>' +
        '· 당일 거래대금 <b>' + eok(p.valueEok) + '</b><br>' +
        '· 외국인 ' + signedEok(p.foreignEok) + ' · 기관 ' + signedEok(p.organEok) +
        (isNum(p.totalEok) ? ' · 합산 <b>' + signedEok(p.totalEok) + '</b>' : '') +
        (p.supplyKind ? ' <span style="color:#fcd34d;">(' + esc(p.supplyKind) + ')</span>' : '') + '<br>' +
        '· <span style="color:#fcd34d;">' + esc(p.ruleHint || '') + '</span></div>' +
        '<br><span style="color:#94a3b8; font-size:10px;">수급: ' + esc((DATA && DATA.supplyAsOfLabel) || 'KIS 가집계') +
        ' · 기준: ' + esc(rulesText().supply) + '</span>';
    } else {
      meta = '대금 ' + eok(p.valueEok) + (isNum(p.upperTailPct) ? ' · 윗꼬리 ' + p.upperTailPct.toFixed(2) + '%' : '');
      desc = '<div style="font-size:10.5px; color:#e2e8f0; line-height:1.6;">' +
        '· 현재가 <b>' + won(p.price) + '</b> · 등락률 <b style="color:' + upColor(p.changePct) + ';">' + pctf(p.changePct) + '</b><br>' +
        '· 당일 거래대금 <b>' + eok(p.valueEok) + '</b>' + (p.valueBasis ? ' (' + esc(p.valueBasis) + ')' : '') + '<br>' +
        '· 윗꼬리 <b style="color:' + tailColor(p.upperTailPct) + ';">' + (isNum(p.upperTailPct) ? p.upperTailPct.toFixed(2) + '%' : '—') + '</b>' +
        (p.upperLimit ? ' · <span style="color:#fda4af;">상한가</span>' : '') + '<br>' +
        (p.themeName ? '· 테마: <b>' + esc(p.themeName) + '</b>' + (isNum(p.themeRank) ? ' (' + p.themeRank + '위)' : '') + '<br>' : '') +
        '· <span style="color:#fcd34d;">' + esc(p.ruleHint || '') + '</span></div>' +
        '<br><span style="color:#94a3b8; font-size:10px;">기준: ' + esc(rulesText().theme) +
        ' · ' + esc((DATA && DATA.themeAsOfLabel) || '실시간') + '</span>';
    }
    try {
      if (typeof window.openDetail === 'function') window.openDetail(title, sub, meta, desc);
    } catch (e) { /* noop */ }
  }

  /* -------------------------------- 수집 --------------------------------- */
  function load(fresh) {
    if (busy) return Promise.resolve(false);
    busy = true;
    return fetch(TABS_URL + (fresh ? '?fresh=1' : '?_=' + Date.now()), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (body) {
        var cp = body && body.closingPicks;
        if (!cp || cp.ok !== true) throw new Error('closingPicks 없음');
        DATA = cp;
        FAIL = null;
        lastAt = Date.now();
        render();
        return true;
      })
      .catch(function (e) {
        FAIL = '갱신 실패 — ' + String((e && e.message) || e);
        render();
        return false;
      })
      .then(function (n) { busy = false; return n; });
  }

  function tick() {
    if (document.hidden) return;
    var wait = inMarketHours() ? LIVE_MS : IDLE_MS;
    if (Date.now() - lastAt >= wait) load(false);
  }

  function setTrack(k) {
    if (k !== 'theme' && k !== 'supply') return;
    track = k;
    render();
  }
  window.cpSetTrack = setTrack;

  /* 상단 🔄 즉시 새로고침(live-api.js 의 forceLiveRefresh)에 이 박스 갱신을 체인으로 붙인다 */
  function patchForceRefresh() {
    try {
      var orig = window.forceLiveRefresh;
      if (typeof orig !== 'function' || orig.__cpPatched) return;
      var patched = function () {
        try { load(true); } catch (e) { /* noop */ }
        return orig.apply(this, arguments);
      };
      patched.__cpPatched = true;
      window.forceLiveRefresh = patched;
    } catch (e) { /* noop */ }
  }

  function boot() {
    if (!$('closingPicksBox')) return;          /* 이 페이지에 박스가 없으면 아무것도 하지 않는다 */
    var t1 = $('cpTabTheme'), t2 = $('cpTabSupply'), tg = $('cpToggleBtn'), box = $('closingPicksBox');
    if (t1) t1.addEventListener('click', function () { setTrack('theme'); });
    if (t2) t2.addEventListener('click', function () { setTrack('supply'); });
    if (tg && box) {
      tg.addEventListener('click', function () {
        collapsed = !collapsed;
        box.classList.toggle('collapsed', collapsed);
        tg.textContent = collapsed ? '펼치기' : '접기';
        tg.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        render();
      });
    }
    /* 🔄 즉시 새로고침 버튼에도 물려 둔다(체인) */
    patchForceRefresh();

    render();
    load(false);
    setInterval(tick, LIVE_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    /* defer 순서상 이 파일이 live-api.js 보다 먼저 돌 수 있다 → load 시점에 한 번 더 물린다 */
    window.addEventListener('load', patchForceRefresh);
  }

  window.ClosingPicks = { load: load, render: render, setTrack: setTrack };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
