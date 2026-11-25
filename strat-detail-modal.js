/* ============================================================================
   🎯 RN존 · 신정재 — 카드 클릭 → 확대 차트 + 재료·설명 모달 (strat-detail-modal.js)
   ----------------------------------------------------------------------------
   · 사용자 요청(2026-11-26): "만쥬·비중법사·홍인기는 차트 누르면 확대되면서
     차트와 맞는 재료 등 설명이 나오는데, 신정재와 RN존은 달라 유사하게 수정."
   · 만쥬(ManjuDetail)·비중법사(#chartModal)·홍인기(#hiChartModal)와 같은 흐름으로,
     카드를 누르면 그 자리에서 [확대 차트 + 이 종목의 판정 근거·재료·뉴스]가 한 화면에 열린다.
   · 각 탭이 이미 들고 있는 차트 DOM(#tabRnzone .chart-section / #tabJongbe main.chart-panel)을
     이 모달 안으로 '옮겨서' 그대로 쓴다 — 줌·팬·타점·6대 팁·KRX 안전도 로직을 다시 만들지 않는다.
     (탭 본문에서는 빠지므로 화면은 [실시간 박스] → [종목 카드] → [원칙·도해] 로 정리된다)
   · 뉴스는 /api/stock-live?code=…&news=1 (네이버 증권 종목뉴스) 실측만 표시하고,
     없거나 실패하면 '미확인'이라고 적는다 — 추정·생성 금지.
   · 정적 Pages에서는 live-static-api.js 가 /api/* 를 동적 오리진으로 넘겨 준다(같은 경로 사용).
   ========================================================================== */
(function () {
  'use strict';
  if (window.StratDetail) return;

  var PANEL_SEL = {
    rn: '#tabRnzone .chart-section',
    jb: '#tabJongbe main.chart-panel'
  };
  var TAB_SEL = { rn: '#tabRnzone', jb: '#tabJongbe' };
  var LAYOUT_SEL = { rn: '#tabRnzone .dashboard-grid', jb: '#tabJongbe .main-layout' };

  var box = null, els = {}, cur = { kind: null, code: null }, seq = 0, suppress = false;
  var nodes = {}, holds = {};

  /* ---------------------------------------------------------------- 유틸 */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function nf(v) {
    var n = num(v);
    return n === null ? '—' : Math.round(n).toLocaleString('ko-KR');
  }
  function pct(v, d) {
    var n = num(v);
    if (n === null) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(d === undefined ? 2 : d) + '%';
  }
  function won(v) { var n = num(v); return n === null ? '—' : Math.round(n).toLocaleString('ko-KR') + '원'; }
  function eok(v) {
    var n = num(v);
    if (n === null) return '—';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + '조';
    return Math.round(n).toLocaleString('ko-KR') + '억';
  }
  function colorOf(v) { var n = num(v); return n === null ? '#94a3b8' : (n > 0 ? '#f43f5e' : (n < 0 ? '#38bdf8' : '#94a3b8')); }
  function isOpen() { return !!(box && box.style.display === 'block'); }

  /* ---------------------------------------------------------------- CSS */
  function css() {
    if (document.getElementById('sdmCss')) return;
    var st = document.createElement('style');
    st.id = 'sdmCss';
    st.textContent = [
      '#stratDetailModal{position:fixed;inset:0;z-index:22000;display:none;background:rgba(2,6,23,0.86);',
      '  -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px}',
      '#stratDetailModal .sdm-panel{max-width:880px;margin:8px auto 28px;background:#0b1220;border:1px solid #334155;',
      '  border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,0.6);overflow:hidden}',
      '#stratDetailModal .sdm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;',
      '  padding:10px 12px;background:linear-gradient(135deg,#0f172a,#1e293b);border-bottom:1px solid #334155;position:sticky;top:0;z-index:3}',
      '#stratDetailModal .sdm-title{font-size:14px;font-weight:900;color:#fff;word-break:keep-all;line-height:1.35}',
      '#stratDetailModal .sdm-sub{font-size:10.5px;color:#94a3b8;margin-top:2px;line-height:1.45}',
      '#stratDetailModal .sdm-x{flex:0 0 auto;background:rgba(148,163,184,0.15);border:1px solid #475569;color:#e2e8f0;',
      '  border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:800;cursor:pointer}',
      '#stratDetailModal .sdm-body{padding:10px 10px 12px;display:flex;flex-direction:column;gap:9px}',
      '#stratDetailModal .sdm-sec{background:#0f172a;border:1px solid #1e293b;border-radius:9px;padding:8px 10px}',
      '#stratDetailModal .sdm-h{font-size:11.5px;font-weight:900;color:#a5b4fc;margin-bottom:5px;display:flex;',
      '  justify-content:space-between;align-items:baseline;gap:6px;flex-wrap:wrap}',
      '#stratDetailModal .sdm-h .s{font-size:9.5px;color:#64748b;font-weight:700}',
      '#stratDetailModal .sdm-t{font-size:11px;color:#cbd5e1;line-height:1.6;word-break:keep-all}',
      '#stratDetailModal .sdm-r{display:flex;justify-content:space-between;align-items:baseline;gap:8px;',
      '  padding:2px 0;border-bottom:1px dashed rgba(148,163,184,0.12);font-size:10.5px;line-height:1.5}',
      '#stratDetailModal .sdm-r .k{color:#94a3b8;white-space:nowrap}',
      '#stratDetailModal .sdm-r .v{color:#e2e8f0;font-weight:800;text-align:right}',
      '#stratDetailModal .sdm-news a{color:#e2e8f0;text-decoration:none}',
      '#stratDetailModal .sdm-news .it{display:flex;gap:6px;align-items:flex-start;padding:2px 0;font-size:11px;line-height:1.55}',
      '#stratDetailModal .sdm-news .n{color:#64748b;font-weight:800;flex:0 0 auto}',
      '#stratDetailModal .sdm-news .m{color:#64748b;font-size:9.5px;font-weight:700}',
      '#stratDetailModal .sdm-foot{display:flex;gap:6px;flex-wrap:wrap;padding:9px 10px;border-top:1px solid #1e293b;background:#0b1120}',
      '#stratDetailModal .sdm-btn{background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:7px;',
      '  padding:6px 10px;font-size:11px;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}',
      '#stratDetailModal .sdm-btn.pri{background:#0284c7;border-color:#38bdf8;color:#fff}',
      '#stratDetailModal .sdm-btn.warn{background:rgba(251,191,36,0.14);border-color:rgba(251,191,36,0.5);color:#fcd34d}',
      /* 옮겨 온 차트 패널 — 모달 폭에 맞춰 여백만 정리한다(차트 코드는 손대지 않음) */
      '#stratDetailModal .chart-section{padding:8px;background:#0b1220;border:0;border-radius:0}',
      '#stratDetailModal main.chart-panel{padding:8px;background:transparent;border:0;border-radius:0;backdrop-filter:none}',
      '#stratDetailModal .chart-wrapper{height:320px}',
      '#stratDetailModal .canvas-container{height:340px}',
      '#stratDetailModal .tactical-grid{grid-template-columns:1fr}',
      '@media (max-width:430px){',
      '  #stratDetailModal{padding:6px}',
      '  #stratDetailModal .sdm-panel{margin:4px auto 18px}',
      '  #stratDetailModal .chart-wrapper{height:280px}',
      '  #stratDetailModal .canvas-container{height:300px}',
      '}',
      /* 차트 패널이 모달로 빠진 뒤 남은 탭 레이아웃 — 목록이 폭을 다 쓴다 */
      '#tabJongbe .main-layout.sdm-solo{grid-template-columns:minmax(0,1fr)}',
      '#tabRnzone .dashboard-grid.sdm-solo{display:flex;flex-direction:column}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* --------------------------------------------------------------- DOM */
  function ensure() {
    if (box) return;
    css();
    box = document.createElement('div');
    box.id = 'stratDetailModal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '전략 종목 상세');
    box.innerHTML =
      '<div class="sdm-panel">' +
        '<div class="sdm-head">' +
          '<div style="min-width:0"><div class="sdm-title" id="sdmTitle">—</div>' +
          '<div class="sdm-sub" id="sdmSub">—</div></div>' +
          '<button type="button" class="sdm-x" id="sdmClose" aria-label="닫기">✕ 닫기</button>' +
        '</div>' +
        '<div class="sdm-body">' +
          '<div id="sdmHost"></div>' +
          '<div id="sdmFacts"></div>' +
          '<div id="sdmNews" class="sdm-sec sdm-news"></div>' +
          '<div id="sdmRule"></div>' +
        '</div>' +
        '<div class="sdm-foot" id="sdmFoot"></div>' +
      '</div>';
    document.body.appendChild(box);
    els.title = box.querySelector('#sdmTitle');
    els.sub = box.querySelector('#sdmSub');
    els.host = box.querySelector('#sdmHost');
    els.facts = box.querySelector('#sdmFacts');
    els.news = box.querySelector('#sdmNews');
    els.rule = box.querySelector('#sdmRule');
    els.foot = box.querySelector('#sdmFoot');
    box.querySelector('#sdmClose').addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) close();
    });
    window.addEventListener('resize', function () { if (isOpen()) redraw(); });
  }

  /* --------------------------------------------------------- 패널 이동 */
  function holdOf(kind) {
    if (!holds[kind]) {
      var d = document.createElement('div');
      d.id = 'sdmHold-' + kind;
      d.style.display = 'none';
      document.body.appendChild(d);
      holds[kind] = d;
    }
    return holds[kind];
  }
  function panelOf(kind, cacheOnly) {
    if (nodes[kind] && document.body.contains(nodes[kind])) return nodes[kind];
    if (cacheOnly) return null;
    var el = document.querySelector(PANEL_SEL[kind]);
    if (el) nodes[kind] = el;
    return nodes[kind] || null;
  }

  /* 탭 본문에서 차트 패널을 떼어 숨은 보관함으로 — 메인 화면은 목록만 남는다 */
  function detach(kind) {
    var el = panelOf(kind);
    if (!el) return false;
    holdOf(kind).appendChild(el);
    var lay = document.querySelector(LAYOUT_SEL[kind]);
    if (lay) lay.classList.add('sdm-solo');
    return true;
  }

  /* ------------------------------------------------------------- 그리기 */
  function redraw() {
    var kind = cur.kind;
    var run = function () {
      try {
        if (kind === 'rn' && window.RnZone) { window.RnZone.resize(); window.RnZone.draw(); }
        if (kind === 'jb' && window.Jongbe) { window.Jongbe.resize(); window.Jongbe.render(); }
      } catch (e) { /* 차트 엔진 미준비 — 다음 틱에 다시 */ }
    };
    setTimeout(run, 40);
    setTimeout(run, 260);
  }

  function stockOf(kind, code) {
    var list = null;
    try {
      if (kind === 'rn' && window.RnZone && window.RnZone.getStocks) list = window.RnZone.getStocks();
      if (kind === 'jb' && window.Jongbe && window.Jongbe.getStocks) list = window.Jongbe.getStocks();
    } catch (e) { list = null; }
    var arr = list || [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].code === code) return arr[i];
    return null;
  }

  function sec(title, inner, note) {
    return '<section class="sdm-sec"><div class="sdm-h"><span>' + title + '</span>' +
      (note ? '<span class="s">' + note + '</span>' : '') + '</div>' + inner + '</section>';
  }
  function row(k, v) {
    return '<div class="sdm-r"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  }

  /* ------------------------------------------------------------- 뉴스 */
  function renderNews(kind, code) {
    var my = ++seq;
    els.news.style.display = 'block';
    els.news.innerHTML = '<div class="sdm-h"><span>📰 재료 · 최신 뉴스</span>' +
      '<span class="s">네이버 증권 종목뉴스 (실측)</span></div>' +
      '<div class="sdm-t" style="color:#64748b;">조회 중…</div>';
    fetch('/api/stock-live?code=' + encodeURIComponent(code) + '&news=1', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (my !== seq) return;
        if (!j || j.ok !== true) throw new Error('bad');
        var items = j.news || [];
        if (!items.length) {
          els.news.innerHTML = '<div class="sdm-h"><span>📰 재료 · 최신 뉴스</span></div>' +
            '<div class="sdm-t" style="color:#94a3b8;">최근 관련 속보가 확인되지 않았습니다 — <b style="color:#fbbf24;">재료 미확인</b>' +
            ' (차트·수급만으로 판단)</div>';
          return;
        }
        var html = items.slice(0, 4).map(function (n, i) {
          var when = n.isToday ? (n.time || '') : ((n.date || '') + ' ' + (n.time || '')).trim();
          var meta = [when, n.press].filter(Boolean).join(' · ');
          var title = esc(n.title);
          var body = n.url
            ? '<a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + title + '</a>'
            : title;
          return '<div class="it"><span class="n">' + (i + 1) + '</span><span>' + body +
            (meta ? ' <span class="m">— ' + esc(meta) + '</span>' : '') + '</span></div>';
        }).join('');
        els.news.innerHTML = '<div class="sdm-h"><span>📰 재료 · 최신 뉴스</span>' +
          '<span class="s">네이버 증권 · ' + items.length + '건</span></div><div>' + html + '</div>';
      })
      .catch(function () {
        if (my !== seq) return;
        els.news.innerHTML = '<div class="sdm-h"><span>📰 재료 · 최신 뉴스</span></div>' +
          '<div class="sdm-t" style="color:#94a3b8;">뉴스 조회 실패 — <b style="color:#fbbf24;">미확인</b>' +
          ' (서버 응답 없음 · 차트·수급만으로 판단)</div>';
      });
  }

  /* --------------------------------------------------------- RN존 본문 */
  function renderRn(s) {
    var price = num(s.price);
    var up = num(s.upperRN), lo = num(s.lowerRN), aux = num(s.auxRN);
    var dUp = (price && up) ? (up / price - 1) * 100 : null;
    var dLo = (price && lo) ? (1 - lo / price) * 100 : null;
    var catLabel = ({
      touch_lower: '🟢 하단 RN 터치 (1차 타점)',
      near_lower: '🟡 하단 RN 근접 (진입 대기)',
      touch_upper: '🚀 상단 RN 터치 (돌파 임박 · 추격 금지)',
      upper: '🔥 상단 RN 근접',
      search: '🔎 실시간 조회 종목',
      above_top: '⬆️ 공식 최상단 RN 위'
    })[s.category] || '—';

    var f = '';
    f += row('현재가', '<b style="color:' + colorOf(s.changeRatio) + ';">' + won(price) + ' ' + pct(s.changeRatio) + '</b>');
    f += row('상태', '<b>' + catLabel + '</b>');
    f += row('상단 RN (' + (s.upperColorKo || '공식선') + ')',
      '<b style="color:' + (s.upperColorHex || '#f59e0b') + ';">' + won(up) + '</b> ' +
      '<span style="color:#94a3b8;">현재가 대비 ' + pct(dUp) + '</span>');
    f += row('하단 RN (' + (s.lowerColorKo || '공식선') + ')',
      '<b style="color:' + (s.lowerColorHex || '#38bdf8') + ';">' + won(lo) + '</b> ' +
      '<span style="color:#94a3b8;">현재가 아래 ' + pct(dLo) + '</span>');
    if (aux) f += row('중간 보조 (비공식)', won(aux) + ' <span style="color:#94a3b8;">표기용 눈금 · 매매 기준선 아님</span>');
    f += row('구간 폭', up && lo ? (up - lo).toLocaleString('ko-KR') + '원' : '—');
    f += row('1차 매수 (하단 RN +4%)', '<b style="color:#22c55e;">' + won(s.buy1) + ' 이하</b>');
    f += row('2차 분할 (1차 −20%)', '<b style="color:#ef4444;">' + won(s.buy2) + '</b>');
    f += row('목표 (+7~20%)', '<b style="color:#a855f7;">' + nf(s.targetMin) + ' ~ ' + nf(s.targetMax) + '원</b>');
    f += row('당일 거래대금', (s.valueText || '—') + (s.valueBasis ? ' <span style="color:#94a3b8;">(' + esc(s.valueBasis) + ')</span>' : ''));
    if (s.capText) f += row('시가총액', esc(s.capText));
    if (s.pickReason) f += row('자동선정 사유', esc(s.pickReason));
    if (s.zoneText) f += '<div class="sdm-t" style="margin-top:6px;color:#94a3b8;font-size:10px;">' + esc(s.zoneText) + '</div>';

    els.facts.innerHTML = sec('🧭 RN존 판정 · 타점', f, '차트박사 공식 21선 기준');

    var r = '';
    r += '<div class="sdm-t">① 상단 RN <b style="color:#f59e0b;">' + won(up) + '</b>을 <b>실제로 터치</b>한 종목만 매수 대상입니다(터치 없으면 진입 금지).<br>' +
      '② 상단 RN 터치 뒤 <b style="color:#38bdf8;">하단 RN ' + won(lo) + '</b>까지 내려올 때가 진입 자리 — 지금은 하단 RN 위 ' + pct(dLo) + ' 지점입니다.<br>' +
      '③ 1차 매수가 = 하단 RN +4% 이내 → <b style="color:#22c55e;">' + won(s.buy1) + ' 이하</b>, ④ 2차 = 1차 −20% → <b style="color:#ef4444;">' + won(s.buy2) + '</b><br>' +
      '⑤ 목표 +7~20% → <b style="color:#a855f7;">' + nf(s.targetMin) + '~' + nf(s.targetMax) + '원</b> 분할 매도, ⑥ 보유 2개월~최장 3개월(90일) 기계적 정리<br>' +
      '⑦ 익절 후 같은 사이클 재진입 금지 — 상단 RN을 다시 터치해야 새 사이클입니다.</div>' +
      '<div class="sdm-t" style="margin-top:6px;color:#64748b;font-size:9.8px;">※ 1차·2차·목표는 하단 RN에서 계산한 값이고, ' +
      '중간 보조선은 공식 21선이 아니라 표기용 눈금이라 타점에 쓰지 않습니다.</div>';
    els.rule.innerHTML = sec('📋 RN존 원칙 — 이 종목에 대입', r, '성경호 차트박사');

    els.foot.innerHTML =
      '<button type="button" class="sdm-btn warn" id="sdmCalc">🧮 1:2 분할 매수 계산기</button>' +
      '<a class="sdm-btn" href="https://m.stock.naver.com/domestic/stock/' + encodeURIComponent(s.code) + '/total" target="_blank" rel="noopener">📊 네이버 증권</a>' +
      '<button type="button" class="sdm-btn pri" id="sdmFootClose">닫기</button>';
    var cb = els.foot.querySelector('#sdmCalc');
    if (cb) cb.addEventListener('click', function () {
      try { if (window.RnZone && window.RnZone.toggleCalc) window.RnZone.toggleCalc(); } catch (e) { /* */ }
    });
  }

  /* -------------------------------------------------------- 신정재 본문 */
  function renderJb(s) {
    var price = num(s.price);
    var tips = Array.isArray(s.tips) ? s.tips : [];
    var tipScore = num(s.tipScore), tipTotal = num(s.tipTotal) || 6;
    var f = '';
    f += row('현재가', '<b style="color:' + colorOf(s.changeRatio) + ';">' + won(price) + ' ' + pct(s.changeRatio) + '</b>');
    f += row('패턴', '<b style="color:#fbbf24;">' + esc(s.patternLabel || '—') + '</b>' + (s.patternNote ? ' <span style="color:#94a3b8;">' + esc(s.patternNote) + '</span>' : ''));
    f += row('6대 팁', '<b style="color:' + (tipScore >= 4 ? '#6ee7b7' : tipScore >= 2 ? '#fbbf24' : '#fca5a5') + ';">' + (tipScore === null ? '—' : tipScore + '/' + tipTotal) + '</b>');
    f += row('기준가 (전일 종가)', '<b style="color:#fbbf24;">' + won(s.basePrice || s.price) + '</b>');
    f += row('5일선 / 20일선', won(s.ma5) + ' / ' + won(s.ma20));
    f += row('120일 전고점', won(s.hi120) + (num(s.gap120) !== null ? ' <span style="color:' + (Math.abs(s.gap120) <= 3 ? '#6ee7b7' : '#cbd5e1') + ';">이격 ' + pct(s.gap120) + '</span>' : ''));
    f += row('당일 거래대금', esc(s.valueText || '—'));
    if (s.capText) f += row('시가총액', esc(s.capText));
    f += row('매수 타점', '<span style="color:#6ee7b7;">' + esc(s.entry || '—') + '</span>');
    f += row('익절 / 손절', '<span style="color:#a855f7;">' + esc(s.target || '—') + '</span><br><span style="color:#fca5a5;">' + esc(s.stop || '—') + '</span>');

    /* 재료(테마)·수급 — 재스캔이 남긴 6대 팁 근거에서 그대로 가져온다(새로 만들지 않음) */
    var material = null, supply = null;
    tips.forEach(function (t) {
      if (!t) return;
      if (t.key === 'material') material = t;
      if (t.key === 'supply') supply = t;
    });
    if (material) {
      f += row('재료 (테마)', '<span style="color:' + (material.pass ? '#6ee7b7' : '#fca5a5') + ';">' + (material.pass ? '✅ 충족' : '⬜ 미충족') + '</span> ' +
        '<span style="color:#cbd5e1;">' + esc(material.evidence || '—') + '</span>');
    }
    if (num(s.foreignEok) !== null || num(s.organEok) !== null) {
      var sd = String(s.supplyDate || '');
      var sdTxt = sd.length === 8 ? sd.slice(0, 4) + '/' + sd.slice(4, 6) + '/' + sd.slice(6, 8) : sd;
      f += row('수급 (확정)', '<span style="color:' + colorOf(s.foreignEok) + ';">외인 ' + eok(s.foreignEok) + '</span> · ' +
        '<span style="color:' + colorOf(s.organEok) + ';">기관 ' + eok(s.organEok) + '</span>' +
        (sdTxt ? ' <span style="color:#94a3b8;">(' + sdTxt + ')</span>' : ''));
    }

    els.facts.innerHTML = sec('🧩 재료 · 테마 · 수급 · 타점', f, esc(s.basisLabel || '') + ' 기준');

    /* 6대 팁 X/6 상세 — 모달 안에서 한 번에 보이게 */
    var tipHtml = tips.length
      ? tips.map(function (t) {
          return '<div style="margin-top:4px;"><div style="font-size:11px;font-weight:800;color:' + (t.pass ? '#6ee7b7' : '#94a3b8') + ';">' +
            (t.pass ? '✅' : '⬜') + ' ' + esc(t.label) + '</div>' +
            '<div style="font-size:10.5px;color:#94a3b8;line-height:1.55;">' + esc(t.evidence || '') + '</div></div>';
        }).join('')
      : '<div class="sdm-t" style="color:#fbbf24;">6대 팁 데이터가 없습니다 — 재스캔이 필요합니다(추정으로 채우지 않음).</div>';
    els.rule.innerHTML = sec('✅ 6대 팁 상세 체크', tipHtml,
      (tipScore === null ? '—' : tipScore + '/' + tipTotal) + ' 충족');

    els.foot.innerHTML =
      '<button type="button" class="sdm-btn warn" id="sdmTips">✅ 6대 팁 체크</button>' +
      '<button type="button" class="sdm-btn warn" id="sdmCalc">🧮 익절·손절 계산기</button>' +
      '<a class="sdm-btn" href="https://m.stock.naver.com/domestic/stock/' + encodeURIComponent(s.code) + '/total" target="_blank" rel="noopener">📊 네이버 증권</a>' +
      '<button type="button" class="sdm-btn pri" id="sdmFootClose">닫기</button>';

    /* #checklistModal · #calcModal 은 탭 CSS(z-index:999) 안에 있어 이 모달(22000) 뒤로 숨는다 */
    function raise(id) {
      var el = document.getElementById(id);
      if (el) el.style.zIndex = '23100';
      return el;
    }
    var tipsBtn = els.foot.querySelector('#sdmTips');
    if (tipsBtn) tipsBtn.addEventListener('click', function () {
      raise('checklistModal');
      try { window.Jongbe.openChecklistModal(); } catch (e) { /* */ }
    });
    var calcBtn = els.foot.querySelector('#sdmCalc');
    if (calcBtn) calcBtn.addEventListener('click', function () {
      raise('calcModal');
      try { window.Jongbe.openCalcModal(); } catch (e) { /* */ }
    });
  }

  /* --------------------------------------------------------------- 열기 */
  function open(kind, code) {
    if (!kind || !code) return false;
    var s = stockOf(kind, code);
    ensure();
    cur.kind = kind;
    cur.code = code;

    /* 차트 패널을 모달로 옮긴다 — 탭 본문에서는 사라진다(레이아웃은 목록만 남김) */
    var panel = panelOf(kind);
    if (panel && panel.parentNode !== els.host) els.host.appendChild(panel);
    var lay = document.querySelector(LAYOUT_SEL[kind]);
    if (lay) lay.classList.add('sdm-solo');

    /* 헤더 */
    var name = s ? (s.name || code) : code;
    var badge = s ? (s.badge || s.patternLabel || '') : '';
    var price = s ? num(s.price) : null;
    if (kind === 'rn') {
      els.title.innerHTML = '<span>' + esc(name) + '</span> <span style="font-size:11px;color:#94a3b8;font-weight:700;">' + esc(code) + '</span>' +
        (price !== null ? ' <span style="font-size:12px;font-weight:800;color:' + colorOf(s.changeRatio) + ';">' + won(price) + ' ' + pct(s.changeRatio) + '</span>' : '') +
        (badge ? ' <span style="font-size:10px;color:#7dd3fc;font-weight:800;">' + esc(badge) + '</span>' : '');
      els.sub.textContent = 'RN존 · 확대 차트 + 판정 근거' +
        (s && s.valueText ? ' · 당일 대금 ' + s.valueText : '') +
        ' · 카드/미니차트를 누르면 이 화면이 열립니다';
    } else {
      els.title.innerHTML = '<span>' + esc(name) + '</span> <span style="font-size:11px;color:#94a3b8;font-weight:700;">' + esc(code) + '</span>' +
        (price !== null ? ' <span style="font-size:12px;font-weight:800;color:' + colorOf(s.changeRatio) + ';">' + won(price) + ' ' + pct(s.changeRatio) + '</span>' : '');
      els.sub.textContent = '신정재 종가매매 · 확대 차트(엔벨로프) + 6대 팁 + 재료' +
        (s && s.basisLabel ? ' · 기준 ' + s.basisLabel : '') +
        (badge ? ' · ' + badge : '');
    }

    box.style.display = 'block';
    document.body.style.overflow = 'hidden';
    if (box.scrollTop) box.scrollTop = 0;

    if (!s) {
      els.facts.innerHTML = sec('데이터', '<div class="sdm-t" style="color:#fbbf24;">이 종목의 상세 데이터가 아직 없습니다 — ' +
        '자동 스캔이 갱신된 뒤 다시 눌러 주세요(가짜 추정값을 만들지 않습니다).</div>');
      els.news.style.display = 'none';
      els.rule.innerHTML = '';
      els.foot.innerHTML = '<button type="button" class="sdm-btn pri" id="sdmFootClose">닫기</button>';
    } else if (kind === 'rn') {
      renderRn(s);
      renderNews(kind, code);
    } else {
      renderJb(s);
      renderNews(kind, code);
    }
    var fc = els.foot.querySelector('#sdmFootClose');
    if (fc) fc.addEventListener('click', close);

    redraw();
    return true;
  }

  function close() {
    if (!box) return;
    box.style.display = 'none';
    document.body.style.overflow = '';
    /* 차트 패널은 숨은 보관함으로 되돌린다 — 열 때마다 새로 그린다 */
    Object.keys(nodes).forEach(function (kind) {
      if (nodes[kind] && els.host && nodes[kind].parentNode === els.host) holdOf(kind).appendChild(nodes[kind]);
    });
    cur.kind = null;
    cur.code = null;
  }

  /* --------------------------------------------------- 선택 + 모달 연결 */
  function idxOfJb(code) {
    var list = (window.Jongbe && window.Jongbe.getStocks) ? (window.Jongbe.getStocks() || []) : [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].code === code) return i;
    return -1;
  }

  function select(kind, code) {
    suppress = true;
    try {
      if (kind === 'rn' && window.RnZone && window.RnZone.selectStockByCode) window.RnZone.selectStockByCode(code);
      if (kind === 'jb' && window.Jongbe && window.Jongbe.selectStock) {
        var idx = idxOfJb(code);
        if (idx >= 0) window.Jongbe.selectStock(idx);
      }
    } catch (e) { /* 선택 실패해도 모달은 연다 */ }
    suppress = false;
  }

  /* 카드(또는 카드 안 미니차트) 클릭 → 선택 + 모달. 핀 버튼·링크·입력은 건드리지 않는다. */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.sp-tools, .sp-pin, .sp-xcard, .sp-mini, button, a, input, select, textarea, label')) return;
    var card = t.closest('#tabRnzone .stock-card[data-code], #tabJongbe .stock-card[data-code]');
    if (!card) return;
    var code = card.getAttribute('data-code');
    if (!code) return;
    var kind = card.closest('#tabRnzone') ? 'rn' : 'jb';
    e.preventDefault();
    e.stopPropagation();
    select(kind, code);
    open(kind, code);
  }, true);

  /* 다른 모듈이 부르는 선택(핀·신호등 칩·실시간 조회)도 같은 화면으로 연결 */
  function hookModules() {
    try {
      if (window.RnZone && !window.RnZone.__sdmHooked) {
        window.RnZone.__sdmHooked = true;
        var rsel = window.RnZone.selectStockByCode;
        if (typeof rsel === 'function') {
          window.RnZone.selectStockByCode = function (code) {
            var r = rsel.apply(this, arguments);
            if (!suppress && code) open('rn', code);
            return r;
          };
        }
        /* 실시간 종목 조회(/api/stock-chart) — 검색하면 바로 확대 차트+설명을 연다 */
        var upsert = window.RnZone.upsertStock;
        if (typeof upsert === 'function') {
          window.RnZone.upsertStock = function (stock) {
            var r = upsert.apply(this, arguments);
            if (r && stock && stock.code) setTimeout(function () { open('rn', stock.code); }, 30);
            return r;
          };
        }
      }
      if (window.Jongbe && !window.Jongbe.__sdmHooked) {
        window.Jongbe.__sdmHooked = true;
        var jsel = window.Jongbe.selectStock;
        if (typeof jsel === 'function') {
          window.Jongbe.selectStock = function (idx) {
            var list = window.Jongbe.getStocks ? (window.Jongbe.getStocks() || []) : [];
            var code = (list[idx] && list[idx].code) || null;
            var r = jsel.apply(this, arguments);
            if (!suppress && code) open('jb', code);
            return r;
          };
        }
      }
    } catch (e) { /* */ }
  }

  function boot() {
    detach('rn');
    detach('jb');
    hookModules();
    hookSwitch();
  }

  /* 탭을 옮기면 열려 있던 확대 차트 모달은 닫는다(다른 화면 위에 떠 있지 않게) */
  function hookSwitch() {
    var sv = window.switchView;
    if (typeof sv !== 'function' || sv.__sdmSwitchWrapped) return;
    var wrapped = function () {
      if (isOpen()) close();
      return sv.apply(this, arguments);
    };
    wrapped.__sdmSwitchWrapped = true;
    window.switchView = wrapped;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('load', function () { detach('rn'); detach('jb'); hookModules(); hookSwitch(); });

  window.StratDetail = {
    version: '1.0.0',
    open: open,
    close: close,
    detach: detach,
    isOpen: isOpen,
    state: function () {
      return { open: isOpen(), kind: cur.kind, code: cur.code, rnPanel: !!nodes.rn, jbPanel: !!nodes.jb };
    }
  };
})();
