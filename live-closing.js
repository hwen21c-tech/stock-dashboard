/* ============================================================================
 * 🌙 오늘 종가베팅 공략 후보 (2트랙) — 2026-11-24 신설
 * ----------------------------------------------------------------------------
 *  1번 메인 탭의 「🌅 오늘 시초가 공략 후보」 바로 아래에 붙는다.
 *
 *  트랙 ①  🔥 테마주도주 (신정재·만쥬 결)
 *           당일 거래대금 300억↑ · 등락률 +3%↑ · 윗꼬리 5% 이내 (상한가 포함)
 *           정렬은 테마 강도 우선(테마 1위 > 2~3위 > 그 외 · 상한가 가점 → 등락률·대금)
 *  트랙 ②  💰 수급주도주 (침착해·홍인기 결)
 *           KIS 장중 가집계 외인·기관 양매수(또는 한쪽 강한 매수) + 거래대금 500억↑
 *           카드에 외인·기관 **양쪽 금액**을 적고 매도는 파란 칩 + '매도', 확인 불가면 '미확인'
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
  var CHIM = null;      /* 같은 응답의 closingPicks.chimchakhae (📘 3번째 탭) */
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

  /* 수급 한쪽 표기 — 매수/매도/미확인을 글자로 구분한다(수치가 없으면 절대 0으로 적지 않는다) */
  function sideText(v) {
    if (!isNum(v)) return '미확인';
    if (v > 0) return '매수 ' + signedEok(v);
    if (v < 0) return '매도 ' + signedEok(v);
    return '0억';
  }
  function sideChip(label, v) {
    if (!isNum(v)) return chip('mute', label + ' 미확인');
    if (v > 0) return chip('st-up', label + ' 매수 ' + signedEok(v));
    if (v < 0) return chip('st-dn', label + ' 매도 ' + signedEok(v));
    return chip('mute', label + ' 0억');
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
    /* 외인·기관 **양쪽을 항상** 적는다 — 반대쪽이 매도면 파란 칩 + '매도', 확인 불가면 '미확인'(임의 0 금지) */
    chips.push(sideChip('외', p.foreignEok));
    chips.push(sideChip('기', p.organEok));
    if ((p.totalKnown === true || (!('totalKnown' in p) && isNum(p.foreignEok) && isNum(p.organEok))) && isNum(p.totalEok)) {
      chips.push(chip('ok', '합 ' + signedEok(p.totalEok)));
    }
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
    /* 🧭 1번 메인 탭 상단 콤팩트 장세 배너 — 어느 트랙을 보고 있어도 같이 갱신한다 */
    renderMainBanner();
    /* 📘 3번째 탭(침착해)은 자체 렌더로 넘긴다 — 기존 테마·수급 렌더는 그대로 둔다 */
    if (track === 'chim') { renderChimTab(); return; }
    var box = $('closingPicksBox');
    var body = $('cpBody');
    if (!box || !body) return;

    var themeN = (DATA && (DATA.themeTrack || []).length) || 0;
    var supplyN = (DATA && (DATA.supplyTrack || []).length) || 0;

    if ($('cpTabThemeN')) $('cpTabThemeN').textContent = themeN;
    if ($('cpTabSupplyN')) $('cpTabSupplyN').textContent = supplyN;
    if ($('cpTabChimN')) $('cpTabChimN').textContent = (CHIM && (CHIM.rows || []).length) || 0;
    var tt = $('cpTabTheme'), ts = $('cpTabSupply');
    if (tt) { tt.classList.toggle('active', track === 'theme'); tt.setAttribute('aria-selected', track === 'theme' ? 'true' : 'false'); }
    if (ts) { ts.classList.toggle('active', track === 'supply'); ts.setAttribute('aria-selected', track === 'supply' ? 'true' : 'false'); }
    var tc = $('cpTabChim');
    if (tc) { tc.classList.toggle('active', track === 'chim'); tc.setAttribute('aria-selected', track === 'chim' ? 'true' : 'false'); }

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
        ? '🔥 <b style="color:#fda4af;">테마주도주</b> — ' + esc(rt.theme) +
          (DATA && DATA.rules && DATA.rules.themeSort ? '<br><span style="color:#94a3b8;">정렬: ' + esc(DATA.rules.themeSort) + '</span>' : '')
        : '💰 <b style="color:#fcd34d;">수급주도주</b> — ' + esc(rt.supply);
      var extra = track === 'theme' ? (DATA && DATA.themeAsOfLabel) : (DATA && DATA.supplyAsOfLabel);
      note.innerHTML = line + (extra ? '<br><span style="color:#94a3b8;">기준: ' + esc(extra) + '</span>' : '');
    }

    var list = listOf(track);
    if (!DATA) {
      body.innerHTML = '<div style="font-size:11.5px; color:#94a3b8; padding:8px;">⏳ 종가베팅 후보를 불러오는 중…</div>';
    } else if (!list.length) {
      var nts = ((DATA && DATA.notes) || []).filter(Boolean);
      body.innerHTML = '<div style="font-size:11.5px; color:#fca5a5; padding:8px; line-height:1.7;">' +
        '조건 충족 종목 없음 — ' + esc(track === 'theme' ? rt.theme : rt.supply) +
        ' <span style="color:#94a3b8;">(기준을 임의로 완화해 채우지 않습니다)</span>' +
        (nts.length ? '<br><span style="color:#fcd34d;">' + esc(nts.join(' ')) + '</span>' : '') + '</div>';
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

  /* ================== 📘 3번째 탭: 침착해 종가베팅 (프로그램 수급 1순위) ==================
   *  같은 박스(#closingPicksBox)의 3번째 탭(track='chim')으로 그린다.
   *  값은 서버 closingPicks.chimchakhae 만 쓴다(프로그램 = KIS 종목별 프로그램매매추이 0465).
   *  카드 클릭 → openDetail + '📘 침착해 관점 종배 분석' 박스(접기/펼치기).
   * ========================================================================== */

  function ckList() {
    return (CHIM && CHIM.rows) || [];
  }

  function trendCls(kind) {
    if (kind === 'flip') return 'hot';
    if (kind === 'up') return 'ok';
    if (kind === 'flat') return 'warm';
    if (kind === 'down') return 'st-dn';
    return 'mute';
  }

  function qtyText(v) {
    if (!isNum(v)) return '—';
    var a = Math.abs(v);
    var s = a >= 10000
      ? (Math.round(a / 1000) / 10).toLocaleString('ko-KR') + '만주'
      : a.toLocaleString('ko-KR') + '주';
    return (v > 0 ? '+' : v < 0 ? '-' : '') + s;
  }

  function chimCard(p, i) {
    var chips = [];
    /* 📰 재료/테마 뱃지 — 서버가 재료를 확인해 내려준 종목만 카드가 된다(화면은 판정하지 않는다) */
    if (p.materialTag) chips.push(chip('warm', '📰 ' + p.materialTag));
    chips.push(chip(trendCls(p.programTrend),
      '프로그램 ' + (isNum(p.programEok) ? signedEok(p.programEok) : '미수신')));
    if (isNum(p.programQty)) chips.push(chip('mute', qtyText(p.programQty)));
    if (p.programStatus !== '미수신' && p.programTrendLabel) chips.push(chip(trendCls(p.programTrend), p.programTrendLabel));
    chips.push(sideChip('외', p.foreignEok));
    chips.push(sideChip('기', p.organEok));
    /* 경보·악재 뱃지 — 서버가 만든 riskBadges(지정·경고 예고·관리종목·DART)를 그대로 적는다.
     *  riskBadges 가 없는 예전 응답은 warnLabel·shortOver 만으로 되돌아간다. */
    var badges = p.riskBadges || [];
    if (badges.length) {
      badges.forEach(function (b) { if (b && b.text) chips.push(chip('st-dn', b.text)); });
    } else {
      if (p.warnLabel) chips.push(chip('st-dn', '⚠️ ' + p.warnLabel));
      if (p.shortOver) chips.push(chip('st-dn', '⛔ 단기과열'));
    }
    var ek = (p.strategy && p.strategy.entryKind) || null;
    if (ek === '눌림' || ek === '돌파·불타기') chips.push(chip(ek === '돌파·불타기' ? 'hot' : 'warm', ek));
    return '<div class="op-card" data-ck-idx="' + i + '" role="button" tabindex="0">' +
      '<div class="op-card-top"><span class="op-rank">' + (p.rank || i + 1) + '</span>' +
      '<span class="op-name">' + esc(p.name) + '</span>' +
      '<span class="op-price">' + won(p.price) + '</span>' +
      '<span class="op-chg" style="color:' + upColor(p.changePct) + ';">' + pctf(p.changePct) + '</span></div>' +
      '<div class="op-meta">대금 ' + eok(p.valueEok) +
      (p.themeName ? ' · ' + esc(p.themeName) : '') +
      (p.tag ? ' · ' + esc(p.tag) : '') + '</div>' +
      '<div class="op-chips">' + chips.join('') + '</div>' +
      (p.materialLine ? '<div class="op-why" style="color:#fcd34d;">📰 재료: ' + esc(p.materialLine) + '</div>' : '') +
      '<div class="op-why">' + esc(p.chimchakhaeReason || '') + '</div>' +
      '</div>';
  }

  /* 시장 게이트 한 줄 — 지수 등락 + 판정(외인선물은 공개 실시간 소스가 없어 미수신 표기) */
  function gateLine() {
    var g = (CHIM && CHIM.marketGate) || null;
    if (!g) return '';
    var parts = [];
    if (isNum(g.kospiPct)) parts.push('코스피 ' + pctf(g.kospiPct));
    if (isNum(g.kosdaqPct)) parts.push('코스닥 ' + pctf(g.kosdaqPct));
    var tail = g.label
      ? ' → <b style="color:' + (g.advice === 'normal' ? '#6ee7b7' : '#fda4af') + ';">' + esc(g.label) + '</b>'
      : '';
    var ff = isNum(g.foreignFut)
      ? ' <span style="color:#94a3b8;">외인선물 ' + (g.foreignFut > 0 ? '+' : g.foreignFut < 0 ? '-' : '') +
        Math.abs(Math.round(g.foreignFut)).toLocaleString('ko-KR') + '계약</span>'
      : ' <span style="color:#94a3b8;">(외인선물 미수신)</span>';
    return '🌡 시장: ' + (parts.length ? parts.join(' · ') : '지수 미수신') + tail + ff;
  }

  /* 📘 탭 상단 — 시장 판별 배너(3강 Ch.1): 지수·외인 현물·외인 선물로 장세를 판별한다.
   *  서버가 marketBanner 를 안 내려주는 예전 응답이면 아무것도 그리지 않는다. */
  var CHIM_BANNER_STYLE = {
    warn: { bd: '#fda4af', bg: 'rgba(244,63,94,.14)', fg: '#fecdd3' },
    strong: { bd: '#6ee7b7', bg: 'rgba(16,185,129,.14)', fg: '#bbf7d0' },
    caution: { bd: '#fcd34d', bg: 'rgba(245,158,11,.14)', fg: '#fde68a' },
    neutral: { bd: '#94a3b8', bg: 'rgba(148,163,184,.10)', fg: '#e2e8f0' },
    unknown: { bd: '#64748b', bg: 'rgba(100,116,139,.12)', fg: '#cbd5e1' }
  };
  function chimBannerHtml() {
    var b = CHIM && CHIM.marketBanner;
    if (!b || !b.line) return '';
    var c = CHIM_BANNER_STYLE[b.kind] || CHIM_BANNER_STYLE.neutral;
    var ev = (b.reasons || []).filter(Boolean).join(' · ');
    var hits = (b.hits || []).filter(Boolean).join(' · ');
    /* 🌙 장전 한정 야간선물 한 줄 — 서버가 못 받았으면(b.nightLine 없음) 줄 자체를 그리지 않는다.
     *   등락 방향은 앱의 등락 색(상승 빨강·하락 파랑)을 그대로 쓴다. */
    var nf = b.nightFutures || null;
    var nl = b.nightLine || (nf && nf.line) || '';
    var nCol = (nf && isNum(nf.changePct))
      ? (nf.changePct > 0 ? '#f43f5e' : nf.changePct < 0 ? '#38bdf8' : '#cbd5e1')
      : '#cbd5e1';
    var nBg = (nf && isNum(nf.changePct))
      ? (nf.changePct > 0 ? 'rgba(244,63,94,.13)' : nf.changePct < 0 ? 'rgba(56,189,248,.13)' : 'rgba(148,163,184,.10)')
      : 'rgba(148,163,184,.10)';
    return '<div style="margin:0 0 9px; padding:9px 10px; border:1px solid ' + c.bd + '; border-radius:9px; background:' + c.bg + '; font-size:11.5px; line-height:1.55; color:' + c.fg + ';">' +
      '<div style="font-weight:800;">' + esc(b.line) + '</div>' +
      (nl ? '<div title="KIS 코스피200 야간선물(CM) — 장전 참고 줄이며 장세 판정(kind)에는 넣지 않습니다" style="margin-top:4px; padding:3px 7px; border-radius:6px; background:' + nBg + '; border:1px solid ' + nCol + '55; color:' + nCol + '; font-weight:800;">' + esc(nl) + '</div>' : '') +
      (ev ? '<div style="margin-top:3px; color:#cbd5e1;">' + esc(ev) + '</div>' : '') +
      (hits ? '<div style="margin-top:2px; color:' + c.fg + ';">근거: ' + esc(hits) + '</div>' : '') +
      '<div style="margin-top:3px; color:#94a3b8; font-size:10px;">' + esc(b.asOf || '') +
        (b.stale ? ' · 장 시작 후 실시간으로 다시 판별됩니다' : '') + '</div>' +
      '</div>';
  }

  /* ================== 🧭 1번 메인 탭 상단 콤팩트 배너 (#mainMarketGateBanner) ==================
   *  index.html 을 건드리지 않고 이 스크립트가 직접 넣는다(07:45 콘텐츠 생성 작업과의 충돌 방지).
   *  · 자리: #tabOverview 첫 자식 (없으면 #openingPicksBox 바로 위)
   *  · 2줄: ① 장세 판정 + 행동 + 기준 시각 ② 장전에는 야간선물 한 줄, 그 밖에는 지수·수급 근거
   *  · 값은 같은 응답의 closingPicks.chimchakhae.marketBanner 만 쓴다(화면은 계산하지 않는다).
   *  · 누르면 📘 침착해 종베 탭으로 내려간다.
   * ========================================================================== */
  function ensureMainBanner() {
    var el = document.getElementById('mainMarketGateBanner');
    if (el) return el;
    var host = document.getElementById('tabOverview');
    var op = document.getElementById('openingPicksBox');
    if (!host && !op) return null;
    el = document.createElement('div');
    el.id = 'mainMarketGateBanner';
    el.setAttribute('role', 'status');
    el.style.cssText = 'margin:0 0 10px; padding:8px 10px; border-radius:9px; border:1px solid #334155; background:rgba(15,23,42,0.85); cursor:pointer;';
    if (host) host.insertBefore(el, host.firstChild);
    else op.parentNode.insertBefore(el, op);
    el.addEventListener('click', function () {
      try {
        if (track !== 'chim') setTrack('chim');
        if (collapsed) {
          collapsed = false;
          var box = $('closingPicksBox');
          var tg = $('cpToggleBtn');
          if (box) box.classList.remove('collapsed');
          if (tg) { tg.textContent = '접기'; tg.setAttribute('aria-expanded', 'true'); }
          render();
        }
        var target = $('closingPicksBox');
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { /* noop */ }
    });
    return el;
  }

  function renderMainBanner() {
    var el = ensureMainBanner();
    if (!el) return;
    var b = CHIM && CHIM.marketBanner;
    if (!b || !b.line) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = '';
    var c = CHIM_BANNER_STYLE[b.kind] || CHIM_BANNER_STYLE.neutral;
    var nf = b.nightFutures || null;
    var nl = b.nightLine || (nf && nf.line) || '';
    var row2col = nl
      ? (nf && isNum(nf.changePct)
        ? (nf.changePct > 0 ? '#f43f5e' : nf.changePct < 0 ? '#38bdf8' : '#e2e8f0')
        : '#e2e8f0')
      : '#cbd5e1';
    var tip = [b.line, (b.reasons || []).join(' · '), (b.hits || []).length ? '근거: ' + b.hits.join(' · ') : '', b.asOf || '']
      .filter(Boolean).join('\n');
    el.style.borderColor = c.bd;
    el.style.background = c.bg;
    el.title = tip + '\n(누르면 📘 침착해 종베 탭으로 이동)';
    /* 2줄 고정 — ① 판정(한 줄 고정·넘치면 …) + 기준 시각 ② 장전에는 야간선물, 그 밖에는 행동 지침 */
    var row2fallback = (b.action || '') + ((b.reasons || []).length && !nl ? ' · ' + (b.reasons || []).slice(0, 2).join(' · ') : '');
    el.innerHTML =
      '<div style="display:flex; align-items:center; gap:6px; flex-wrap:nowrap;">' +
        '<span style="font-size:12px; font-weight:800; color:' + c.fg + '; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(b.icon || '') + ' ' + esc(b.title || '') + '</span>' +
        (b.asOf ? '<span style="font-size:9px; font-weight:700; color:#94a3b8; white-space:nowrap; flex:none;">' + esc(b.asOf) + '</span>' : '') +
      '</div>' +
      ((nl || row2fallback) ? '<div style="margin-top:3px; font-size:11px; font-weight:700; color:' + row2col + '; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(nl || row2fallback) + '</div>' : '');
  }

  /* 📘 탭 렌더 — render() 가 track==='chim' 일 때 여기로 온다 */
  function renderChimTab() {
    var body = $('cpBody');
    if (!body) return;
    /* 탭 선택 표시 — render() 의 초기 반환 경로에서는 세 탭 클래스를 못 맞춰서 여기서 맞춘다 */
    var tTh = $('cpTabTheme'), tSup = $('cpTabSupply'), tCh = $('cpTabChim');
    if (tTh) { tTh.classList.toggle('active', false); tTh.setAttribute('aria-selected', 'false'); }
    if (tSup) { tSup.classList.toggle('active', false); tSup.setAttribute('aria-selected', 'false'); }
    if (tCh) { tCh.classList.add('active'); tCh.setAttribute('aria-selected', 'true'); }
    var badge = $('cpBadge');
    if (badge) {
      var bt;
      if (CHIM && CHIM.ok) {
        bt = '⏱ ' + (CHIM.programAsOfLabel || CHIM.asOfLabel || '기준 확인 중');
        if (FAIL) bt += ' · ⚠️ 갱신 실패(마지막 성공 유지)';
      } else if (FAIL) {
        bt = '⚠️ ' + FAIL;
      } else {
        bt = '⏱ 로딩 중';
      }
      badge.className = 'op-badge' + (collapsed ? ' closed' : '') + ' lead';
      badge.textContent = bt;
    }
    var tb = $('cpTimeBadge');
    if (tb) { var ti = timeInfo(); tb.className = 'op-badge op-time ' + ti.cls; tb.textContent = ti.text; }

    var note = $('cpNote');
    if (note) {
      var r = (CHIM && CHIM.rules) || {};
      note.innerHTML = '📘 <b style="color:#c7d2fe;">침착해 종가베팅</b> — ' + esc(r.material || '재료가 확인된 종목만 후보') +
        (r.select ? '<br><span style="color:#cbd5e1;">선별: ' + esc(r.select) + '</span>' : '') +
        (r.sort ? '<br><span style="color:#94a3b8;">정렬: ' + esc(r.sort) + '</span>' : '') +
        (gateLine() ? '<br>' + gateLine() : '') +
        (CHIM && CHIM.asOfLabel ? '<br><span style="color:#94a3b8;">기준: ' + esc(CHIM.asOfLabel) +
          (CHIM.programAsOfLabel ? ' · ' + esc(CHIM.programAsOfLabel) : '') + '</span>' : '');
    }

    var list = ckList();
    if (!CHIM) {
      body.innerHTML = DATA
        ? '<div style="font-size:11.5px; color:#94a3b8; padding:8px;">이 응답에 침착해 트랙(closingPicks.chimchakhae)이 없습니다 — 서버 배포본을 확인하세요.</div>'
        : '<div style="font-size:11.5px; color:#94a3b8; padding:8px;">⏳ 침착해 종가베팅 후보를 불러오는 중…</div>';
    } else if (!list.length) {
      var nts = ((CHIM && CHIM.notes) || []).filter(Boolean);
      body.innerHTML = chimBannerHtml() +
        '<div style="font-size:11.5px; color:#fca5a5; padding:8px; line-height:1.7;">' +
        '재료(테마·뉴스·공시)와 프로그램 방어 조건을 함께 통과한 종목이 없습니다' +
        ' <span style="color:#94a3b8;">(기준을 임의로 완화해 채우지 않습니다)</span>' +
        (nts.length ? '<br><span style="color:#fcd34d;">' + esc(nts.join(' ')) + '</span>' : '') + '</div>';
    } else {
      body.innerHTML = chimBannerHtml() + list.map(chimCard).join('');
    }

    var prin = $('cpPrinciple');
    if (prin) {
      var rr = (CHIM && CHIM.rules) || {};
      prin.innerHTML = '<b>📘 침착해 원칙</b> ' + esc(rr.entry || '13시 이후 프로그램이 받아주는 눌림에서 분할매수') +
        ' · ' + esc(rr.exit || '당일 고점 프로그램 매도 전환 시 청산') +
        ' · ' + esc(rr.stop || '프로그램 매도세로 저점 이탈 시 즉시 손절');
    }

    var foot = $('cpFoot');
    if (foot) {
      var rl = (CHIM && CHIM.rules) || {};
      var mg = (CHIM && CHIM.materialGate) || null;
      foot.innerHTML = '출처: ' + esc((CHIM && CHIM.programSource) || 'KIS 종목별 프로그램매매추이(0465)') +
        (CHIM && CHIM.generatedAtKst ? ' · ' + esc(CHIM.generatedAtKst) + ' 갱신' : '') +
        (CHIM && CHIM.materialSource ? '<br><span style="color:#94a3b8;">' + esc(CHIM.materialSource) + '</span>' : '') +
        (mg ? '<br><span style="color:#94a3b8;">재료 게이트: 테마 ' + (mg.theme || 0) + ' · 뉴스 ' + (mg.news || 0) +
          ' · 재료 미확인 제외 ' + (mg.none || 0) + '종목</span>' : '') +
        (CHIM && CHIM.afterHoursGuide ? '<br>시간외·익일 08:50: ' + esc(CHIM.afterHoursGuide) : '') +
        (rl.split ? '<br>3단 분할: ' + esc(rl.split) : '') +
        (CHIM && CHIM.warnSource ? '<br><span style="color:#94a3b8;">경보 출처: ' + esc(CHIM.warnSource) + '</span>' : '') +
        (rl.caveat ? '<br><span style="color:#94a3b8;">' + esc(rl.caveat) + '</span>' : '') +
        '<br>카드를 누르면 상세 차트와 함께 <b style="color:#c7d2fe;">📘 침착해 관점 종배 분석(재료·선정 사유·매수타점·3단 분할·손절)</b>이 열립니다.';
    }

    Array.prototype.forEach.call(body.querySelectorAll('[data-ck-idx]'), function (el) {
      var idx = parseInt(el.getAttribute('data-ck-idx'), 10);
      function go() { openChim(idx); }
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  function openChim(i) {
    var p = ckList()[i];
    if (!p) return;
    var title = p.name + (p.code ? ' (' + p.code + ')' : '');
    var meta = '대금 ' + eok(p.valueEok) + ' · 프로그램 ' + (isNum(p.programEok) ? signedEok(p.programEok) : '미수신');
    var s = p.strategy || {};
    var line = function (label, text) {
      return text
        ? '<div style="margin:3px 0;"><span style="color:#a5b4fc; font-weight:700;">' + esc(label) + '</span> ' + esc(text) + '</div>'
        : '';
    };
    var head = '<div style="font-size:10.5px; color:#e2e8f0; line-height:1.6;">' +
      (p.materialLine ? '· 📰 재료 <b style="color:#fcd34d;">' + esc(p.materialLine) + '</b><br>' : '') +
      '· 현재가 <b>' + won(p.price) + '</b> · 등락률 <b style="color:' + upColor(p.changePct) + ';">' + pctf(p.changePct) + '</b><br>' +
      '· 당일 거래대금 <b>' + eok(p.valueEok) + '</b><br>' +
      '· 프로그램 순매수 <b style="color:' + (isNum(p.programEok) ? upColor(p.programEok) : '#94a3b8') + ';">' +
        (isNum(p.programEok) ? signedEok(p.programEok) : '미수신') + '</b>' +
        (isNum(p.programQty) ? ' (' + qtyText(p.programQty) + ')' : '') +
        (p.programStatus !== '미수신' && p.programTrendLabel ? ' · <span style="color:#fcd34d;">' + esc(p.programTrendLabel) + '</span>' : '') + '<br>' +
      '· 외국인 <b>' + sideText(p.foreignEok) + '</b> · 기관 <b>' + sideText(p.organEok) + '</b>' +
      (p.supplyKind ? ' <span style="color:#fcd34d;">(' + esc(p.supplyKind) + ')</span>' : '') + '<br>' +
      ((p.riskBadges || []).length
        ? '· 경보·악재 ' + (p.riskBadges || []).map(function (b) { return '<b style="color:#fda4af;">' + esc(b.text) + '</b>'; }).join(' · ') +
          (p.krxWarnAsOf ? ' <span style="color:#94a3b8;">(종목마스터 ' + esc(p.krxWarnAsOf) + ')</span>' : '') + '<br>'
        : (p.warnLabel ? '· <span style="color:#fda4af;">⚠️ ' + esc(p.warnLabel) + '</span>' : '') +
          (p.shortOver ? ' <span style="color:#fda4af;">⛔ 단기과열</span>' : '') + ((p.warnLabel || p.shortOver) ? '<br>' : '')) +
      '</div>';

    var dartBox = p.dartRisk
      ? '<div style="margin-top:8px; padding:7px 9px; border:1px solid rgba(244,63,94,.5); border-radius:8px; background:rgba(127,29,29,.22);">' +
        '<div style="font-size:11px; font-weight:700; color:#fda4af;">⛔ DART 희석·악재 공시</div>' +
        '<div style="margin-top:3px; font-size:10.5px; color:#e2e8f0; line-height:1.6;">' +
        esc(p.dartRisk.label) + ' — ' + esc(p.dartRisk.reportNm || '') +
        (p.dartRisk.rceptDate ? ' <span style="color:#94a3b8;">(' + esc(p.dartRisk.rceptDate) + ' 접수)</span>' : '') +
        '<br><span style="color:#fcd34d;">공시 확인 종목은 원전대로 패스 · 보유 중이면 즉시 정리 검토</span>' +
        (p.dartRisk.url ? '<br><a href="' + esc(p.dartRisk.url) + '" target="_blank" rel="noopener" style="color:#93c5fd;">공시 원문 보기</a>' : '') +
        '</div></div>'
      : '';

    /* ① 종배 선정 사유 — **재료(테마·뉴스·공시) 근거가 먼저**, 그다음 프로그램·외인/기관 수급 */
    var matNews = p.materialNews || null;
    var matDart = p.materialDart || null;
    var materialBlock =
      '<div style="margin:4px 0 2px; color:#fcd34d; font-weight:700;">재료 · 이슈</div>' +
      line('재료', p.materialLine || '재료 미확인') +
      (matNews && matNews.url
        ? '<div style="margin:3px 0;"><span style="color:#a5b4fc; font-weight:700;">근거</span> ' +
          '<a href="' + esc(matNews.url) + '" target="_blank" rel="noopener" style="color:#93c5fd;">기사 원문 보기</a>' +
          (matNews.press ? ' <span style="color:#94a3b8;">(' + esc(matNews.press) + (matNews.time ? ' ' + esc(matNews.time) : '') + ')</span>' : '') +
          '</div>'
        : '') +
      (matDart
        ? '<div style="margin:3px 0;"><span style="color:#a5b4fc; font-weight:700;">공시</span> ' + esc(matDart.label) +
          ' — ' + esc(matDart.reportNm || '') +
          (matDart.rceptDate ? ' <span style="color:#94a3b8;">(' + esc(matDart.rceptDate) + ' 접수)</span>' : '') +
          (matDart.url ? ' <a href="' + esc(matDart.url) + '" target="_blank" rel="noopener" style="color:#93c5fd;">원문</a>' : '') +
          '</div>'
        : '') +
      '<div style="margin:6px 0 2px; color:#6ee7b7; font-weight:700;">수급 · 프로그램 (참고)</div>';

    var box = '<details open style="margin-top:8px; padding:7px 9px; border:1px solid rgba(129,140,248,.5); border-radius:8px; background:rgba(49,46,129,.25);">' +
      '<summary style="cursor:pointer; font-size:11px; font-weight:700; color:#c7d2fe; outline:none;">📘 침착해 관점 종배 분석 <span style="font-weight:400; color:#94a3b8;">(접기/펼치기)</span></summary>' +
      '<div style="margin-top:6px; font-size:10.5px; color:#e2e8f0; line-height:1.65;">' +
      '<div style="margin:4px 0 2px; color:#fda4af; font-weight:700;">① 종배 선정 사유</div>' +
      materialBlock +
      line('·', p.chimchakhaeReason || '') +
      '<div style="margin:7px 0 2px; color:#6ee7b7; font-weight:700;">② 매수타점 및 3단 분할</div>' +
      line('타점', s.entry) +
      line('진입 구분', s.entryKind ? s.entryKind + (s.entryRule ? ' — ' + s.entryRule : '') : '') +
      line('3단 분할', s.split3 || (CHIM && CHIM.split3) || '') +
      line('분할/비중', s.sizing) +
      line('시간외·익일', s.afterHours || p.nextDayGuide) +
      line('즉시 손절', s.stop) +
      '</div></details>' + dartBox;

    try {
      if (typeof window.openDetail === 'function') window.openDetail(title, pctf(p.changePct), meta, head + box);
    } catch (e) { /* noop */ }
  }

  function open(t, i) {
    var p = (t === 'supply' ? listOf('supply') : listOf('theme'))[i];
    if (!p) return;
    var title = p.name + (p.code ? ' (' + p.code + ')' : '');
    var sub = pctf(p.changePct);
    var meta;
    var desc;
    if (t === 'supply') {
      meta = '대금 ' + eok(p.valueEok) + ' · 외 ' + sideText(p.foreignEok) + ' · 기 ' + sideText(p.organEok);
      desc = '<div style="font-size:10.5px; color:#e2e8f0; line-height:1.6;">' +
        '· 현재가 <b>' + won(p.price) + '</b> · 등락률 <b style="color:' + upColor(p.changePct) + ';">' + pctf(p.changePct) + '</b><br>' +
        '· 당일 거래대금 <b>' + eok(p.valueEok) + '</b><br>' +
        '· 외국인 <b style="color:' + (isNum(p.foreignEok) ? upColor(p.foreignEok) : '#94a3b8') + ';">' + sideText(p.foreignEok) + '</b>' +
        ' · 기관 <b style="color:' + (isNum(p.organEok) ? upColor(p.organEok) : '#94a3b8') + ';">' + sideText(p.organEok) + '</b>' +
        ((p.totalKnown === true || (!('totalKnown' in p) && isNum(p.foreignEok) && isNum(p.organEok))) && isNum(p.totalEok)
          ? ' · 합산 <b>' + signedEok(p.totalEok) + '</b>'
          : ' · <span style="color:#94a3b8;">합산 미확인(반대쪽 수치 확인 불가)</span>') +
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
        CHIM = cp.chimchakhae || null;
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
    if (k !== 'theme' && k !== 'supply' && k !== 'chim') return;
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
    var t3 = $('cpTabChim');
    if (t3) t3.addEventListener('click', function () { setTrack('chim'); });
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
