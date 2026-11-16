/* ============================================================
   🎯 만쥬 탭 종목 상세 팝업 (ManjuDetail)
   ─ 채점 스크리너 카드 · 최종 후보(한진칼/삼성SDI/나무가)를 누르면
     ① 오늘 상승 이유(재료·뉴스) ② 캔들 상태(시/고/저/종·윗꼬리)
     ③ 외인/기관 수급(양매수 여부) ④ 재료 크기·시장분위기
     ⑤ 최근 5일/20일 상승률(과열 여부) + 일봉 차트를 한 화면에 보여 준다.
   ─ 데이터: window.MANJU_DATA (auto_update_all_tabs.py 가 15분마다 갱신 · 실측)
     값이 없으면 '미확인'으로 표시한다(추정값을 만들지 않는다).
   ============================================================ */
(function () {
  'use strict';
  if (window.ManjuDetail) return;

  var COL = { up: '#f43f5e', dn: '#38bdf8', dim: '#94a3b8', line: '#1e293b', gold: '#fbbf24' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nf(n) { return (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('ko-KR'); }
  function pct(n, d) {
    if (n == null || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + Number(n).toFixed(d == null ? 2 : d) + '%';
  }
  function eok(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 10000) return (n / 10000).toFixed(2) + '조';
    return Math.round(n).toLocaleString('ko-KR') + '억';
  }
  function colOf(v) { return v == null ? COL.dim : (v > 0 ? COL.up : (v < 0 ? COL.dn : COL.dim)); }

  var box, titleEl, bodyEl, canvas, ctx, series = [], curCode = null;

  function ensure() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'manjuDetailModal';
    box.style.cssText = 'position:fixed;inset:0;z-index:22000;display:none;background:rgba(2,6,23,0.82);'
      + 'backdrop-filter:blur(2px);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:10px;';
    box.innerHTML =
      '<div style="max-width:760px;margin:12px auto 40px;background:#0b1220;border:1px solid #334155;border-radius:12px;'
      + 'box-shadow:0 12px 40px rgba(0,0,0,0.55);overflow:hidden;">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:11px 13px;'
      + 'background:linear-gradient(135deg,#0f172a,#1e293b);border-bottom:1px solid #334155;">'
      + '<div style="min-width:0;"><div id="mjdTitle" style="font-size:15px;font-weight:900;color:#fff;word-break:keep-all;">—</div>'
      + '<div id="mjdSub" style="font-size:11px;color:#94a3b8;margin-top:2px;">—</div></div>'
      + '<button type="button" aria-label="닫기" style="background:rgba(148,163,184,0.15);border:1px solid #475569;color:#e2e8f0;'
      + 'border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800;">✕ 닫기</button></div>'
      + '<div id="mjdBody" style="padding:12px 13px 16px;display:flex;flex-direction:column;gap:10px;"></div>'
      + '</div>';
    document.body.appendChild(box);
    titleEl = box.querySelector('#mjdTitle');
    bodyEl = box.querySelector('#mjdBody');
    box.querySelector('button').addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', function () { if (box && box.style.display === 'block') draw(); });
  }

  function sec(no, title, inner) {
    return '<section style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:10px 11px;">'
      + '<div style="font-size:11.5px;font-weight:900;color:#a5b4fc;margin-bottom:6px;">' + no + '. ' + title + '</div>'
      + '<div style="font-size:11.5px;color:#cbd5e1;line-height:1.6;">' + inner + '</div></section>';
  }
  function row(k, v) {
    return '<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px dashed rgba(148,163,184,0.12);">'
      + '<span style="color:#94a3b8;white-space:nowrap;">' + k + '</span>'
      + '<span style="text-align:right;color:#e2e8f0;">' + v + '</span></div>';
  }

  function renderStock(s, meta) {
    var c = s.candle || {};
    var t = s.trend || [];
    var n = s.news || {};
    var heads = n.headlines || [];
    var tags = n.materialTags || [];
    var mood = s.moodRef || {};

    var name = meta && meta.name ? meta.name : (window.ManjuNames && window.ManjuNames[s.code]) || s.code;
    var q = s.quote || {};
    /* 상단 숫자는 네이버 실측(quote) — 일봉 등락률(candle.pct)과 다르면 ②에서 둘을 병기한다 */
    var pctv = q.pct != null ? q.pct : (c.pct != null ? c.pct : null);
    var pxTop = q.price != null ? q.price : c.close;
    titleEl.innerHTML = '<span>' + esc(name) + '</span> <span style="font-size:11px;color:#94a3b8;font-weight:700;">' + esc(s.code)
      + '</span> <span style="font-size:12px;font-weight:800;color:' + colOf(pctv) + ';">' + nf(pxTop) + '원 '
      + pct(pctv) + '</span>';
    var stamp = (window.MANJU_DATA && window.MANJU_DATA.stamp) || '';
    box.querySelector('#mjdSub').textContent = '기준 봉 ' + (c.date || '—') + ' · 데이터 ' + stamp + ' 실측 (네이버 증권)';

    /* ① 오늘 상승 이유 (재료·뉴스) */
    var h1 = '';
    if (heads.length) {
      h1 += '<div style="display:flex;flex-direction:column;gap:4px;">';
      heads.forEach(function (h, i) {
        h1 += '<div style="display:flex;gap:6px;align-items:flex-start;">'
          + '<span style="color:#64748b;font-weight:800;">' + (i + 1) + '</span>'
          + '<span style="flex:1;min-width:0;">' + esc(h.title)
          + '<span style="color:#64748b;font-size:10px;"> — ' + esc(h.press || '') + ' ' + esc(h.date || '') + '</span></span></div>';
      });
      h1 += '</div>';
    } else {
      h1 += '<span style="color:#fbbf24;">오늘 종목 뉴스가 확인되지 않았습니다 — 재료 미확인(차트·수급만으로 판단)</span>';
    }
    if (tags.length) {
      h1 += '<div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;">' + tags.map(function (t2) {
        return '<span style="background:rgba(99,102,241,0.2);color:#c7d2fe;border:1px solid rgba(99,102,241,0.45);'
          + 'border-radius:4px;padding:1px 6px;font-size:10px;font-weight:800;">#' + esc(t2) + '</span>';
      }).join('') + '</div>';
    }

    /* ② 캔들 상태 */
    var pos = c.closePos;
    var wickTxt = (c.upper != null ? '윗꼬리 ' + pct(c.upper) : '윗꼬리 —');
    var bodyTxt = (c.body != null ? '몸통 ' + pct(c.body) : '몸통 —');
    var posTxt = (pos != null ? '종가 위치 ' + pos + '% (저가~고가 중)' : '종가 위치 —');
    var barVsLive = (q.pct != null && c.pct != null && Math.abs(q.pct - c.pct) >= 0.2)
      ? '<span style="color:#fbbf24;"> (일봉 기준 ' + pct(c.pct) + ')</span>' : '';
    var h2 = row('등락률', '<b style="color:' + colOf(pctv) + ';">' + pct(pctv) + '</b> 실측' + barVsLive)
      + row('시 / 고 / 저 / 종', nf(c.open) + ' / ' + nf(c.high) + ' / ' + nf(c.low) + ' / <b>' + nf(c.close) + '</b>')
      + row('캔들 모양', bodyTxt + ' · ' + wickTxt + (c.lower != null ? ' · 아래꼬리 ' + pct(c.lower) : ''))
      + row('종가 위치', posTxt + (pos != null && pos >= 90 ? ' <b style="color:#34d399;">(고가 밀착)</b>' : (pos != null && pos <= 30 ? ' <b style="color:#f87171;">(저가권 마감)</b>' : '')))
      + row('거래량', c.volX != null ? '20일 평균 대비 <b>' + c.volX + '배</b>' : '—')
      + '<div style="margin-top:8px;background:#0b1120;border:1px solid #1e293b;border-radius:8px;padding:4px;">'
      + '<canvas id="mjdCanvas" style="width:100%;height:170px;display:block;"></canvas>'
      + '<div style="font-size:9.5px;color:#64748b;text-align:right;padding:2px 4px 0;">최근 ' + (s.candles || []).length + '봉 일봉</div></div>';

    /* ③ 외인/기관 수급 */
    var h3 = '';
    if (s.bothBuy === true) h3 += '<div style="margin-bottom:5px;"><span style="background:rgba(52,211,153,0.18);color:#6ee7b7;border:1px solid rgba(52,211,153,0.5);border-radius:4px;padding:1px 7px;font-size:10.5px;font-weight:900;">🟢 외인·기관 양매수</span></div>';
    else if (s.bothBuy === false) h3 += '<div style="margin-bottom:5px;"><span style="background:rgba(148,163,184,0.15);color:#cbd5e1;border:1px solid #475569;border-radius:4px;padding:1px 7px;font-size:10.5px;font-weight:900;">⚪ 양매수 아님</span></div>';
    if (t.length) {
      h3 += '<div style="display:grid;grid-template-columns:44px 1fr 1fr 1fr;gap:4px;font-size:10.5px;">'
        + '<div style="color:#64748b;font-weight:800;">일자</div><div style="color:#64748b;font-weight:800;text-align:right;">외인</div>'
        + '<div style="color:#64748b;font-weight:800;text-align:right;">기관</div><div style="color:#64748b;font-weight:800;text-align:right;">개인</div>';
      t.slice(0, 3).forEach(function (r) {
        h3 += '<div style="color:#94a3b8;">' + esc(r.label || '') + '</div>'
          + '<div style="text-align:right;color:' + colOf(r.foreignEok) + ';font-weight:700;">' + eok(r.foreignEok) + '</div>'
          + '<div style="text-align:right;color:' + colOf(r.organEok) + ';font-weight:700;">' + eok(r.organEok) + '</div>'
          + '<div style="text-align:right;color:' + colOf(r.personalEok) + ';font-weight:700;">' + eok(r.personalEok) + '</div>';
      });
      h3 += '</div><div style="font-size:9.5px;color:#64748b;margin-top:4px;">거래소 확정치(순매수 주수 × 그날 종가) · 장중 당일 값은 없습니다</div>';
    } else {
      h3 += '<span style="color:#fbbf24;">수급 확정치 응답 없음(미확인)</span>';
    }

    /* ④ 재료 크기 · 시장분위기 */
    var lvl = n.materialLevel || '';
    var lvlCol = lvl === '강' ? '#34d399' : (lvl === '중' ? '#fbbf24' : '#94a3b8');
    var h4 = row('재료 크기', lvl ? '<b style="color:' + lvlCol + ';">' + esc(lvl) + '</b> (' + (n.materialScore || 0) + '점 · 관련 보도 ' + (n.newsCount || 0) + '건)' : '미확인')
      + row('코스피 / 코스닥', pct(mood.kospi) + ' / ' + pct(mood.kosdaq))
      + row('야간선물 / 나스닥100선물', pct(mood.nightFuture) + ' / ' + pct(mood.nq))
      + row('지수 종가베팅 / 하방베팅 점수',
        (mood.indexCloseScore != null ? '<b style="color:#34d399;">' + mood.indexCloseScore + '점</b>' : '—')
        + ' / ' + (mood.indexDownScore != null ? '<b style="color:#f87171;">' + mood.indexDownScore + '점</b>' : '—'));

    /* ⑤ 5일 / 20일 상승률 */
    var over = (s.chg5 != null && s.chg5 >= 40) || (s.chg20 != null && s.chg20 >= 100);
    var h5 = row('최근 5일', '<b style="color:' + colOf(s.chg5) + ';">' + pct(s.chg5) + '</b>')
      + row('최근 20일', '<b style="color:' + colOf(s.chg20) + ';">' + pct(s.chg20) + '</b>')
      + row('과열 판정', over ? '<b style="color:#fbbf24;">🔥 과열 (5일 +40%↑ 또는 20일 +100%↑)</b>' : '정상 범위');

    bodyEl.innerHTML = sec('①', '오늘 상승 이유 (재료·뉴스)', h1)
      + sec('②', '캔들 상태 (시/고/저/종 · 윗꼬리)', h2)
      + sec('③', '외인 / 기관 수급 (양매수 여부)', h3)
      + sec('④', '재료 크기 · 시장분위기', h4)
      + sec('⑤', '최근 5일 / 20일 상승률 (과열 여부)', h5)
      + '<div style="font-size:9.5px;color:#64748b;line-height:1.5;">데이터: 네이버 증권 일봉·종목 뉴스·투자자별 매매동향(확정) · '
      + '지수/선물 실측. 값이 없는 항목은 미확인으로 표시합니다(추정 금지).</div>';

    canvas = document.getElementById('mjdCanvas');
    ctx = canvas ? canvas.getContext('2d') : null;
    series = (s.candles || []).slice();
    draw();

    /* 실시간 60일봉이 있으면(동적 Vercel) 차트·현재가를 한 번 더 보강.
       정적 GitHub Pages(live-api.js 없음)에서는 /api 가 없으므로 호출하지 않는다(404 콘솔 오류 방지). */
    try {
      if (!window.LiveAPI) throw new Error('static');
      fetch('/api/stock-chart?code=' + encodeURIComponent(s.code), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var arr = j && (j.candles || j.bars || null);
          if (!arr || !arr.length || curCode !== s.code) return;
          var mapped = arr.map(function (b) {
            return { date: b.date || b.d, open: b.open != null ? b.open : b.o, high: b.high != null ? b.high : b.h,
              low: b.low != null ? b.low : b.l, close: b.close != null ? b.close : b.c, vol: b.vol || b.v || 0 };
          });
          if (mapped.length >= 20) { series = mapped; draw(); }
        })
        .catch(function () { /* 정적 배포본은 API 없음 — 내장 일봉 유지 */ });
    } catch (e) { /* noop */ }
  }

  function draw() {
    if (!canvas || !ctx || !series.length) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 320;
    var h = canvas.clientHeight || 170;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var padL = 4, padR = 46, padT = 8, padB = 14;
    var plotW = w - padL - padR, plotH = h - padT - padB;
    var hi = -Infinity, lo = Infinity;
    series.forEach(function (b) { if (b.high > hi) hi = b.high; if (b.low < lo) lo = b.low; });
    var rng = hi - lo || 1;
    var y = function (v) { return padT + plotH - (v - lo) / rng * plotH; };
    var bw = Math.max(2, plotW / series.length * 0.62);
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
    for (var i = 0; i <= 3; i++) {
      var gy = padT + plotH * i / 3;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke();
      var val = hi - rng * i / 3;
      ctx.fillStyle = '#64748b'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
      ctx.fillText(Math.round(val).toLocaleString('ko-KR'), w - padR + 4, gy + 3);
    }
    series.forEach(function (b, i) {
      var x = padL + plotW * (i + 0.5) / series.length;
      var up = b.close >= b.open;
      ctx.strokeStyle = up ? COL.up : COL.dn;
      ctx.fillStyle = up ? COL.up : COL.dn;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y(b.high)); ctx.lineTo(x, y(b.low)); ctx.stroke();
      var top = Math.min(y(b.open), y(b.close));
      var bh = Math.max(1.4, Math.abs(y(b.open) - y(b.close)));
      ctx.fillRect(x - bw / 2, top, bw, bh);
    });
    var last = series[series.length - 1];
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#fbbf24';
    ctx.beginPath(); ctx.moveTo(padL, y(last.close)); ctx.lineTo(w - padR, y(last.close)); ctx.stroke();
    ctx.setLineDash([]);
  }

  function open(code) {
    ensure();
    var data = window.MANJU_DATA || {};
    var stocks = data.stocks || {};
    var s = stocks[code];
    var meta = null;
    try {
      var el = document.querySelector('[data-manju-code="' + code + '"]');
      if (el) {
        var nm = el.querySelector('strong');
        meta = { name: nm ? String(nm.textContent).replace(/\s*\([0-9]{6}\)\s*/, '').trim() : null };
      }
    } catch (e) { /* noop */ }
    box.style.display = 'block';
    document.body.style.overflow = 'hidden';
    curCode = code;
    if (!s) {
      titleEl.textContent = (meta && meta.name ? meta.name : code) + ' (' + code + ')';
      box.querySelector('#mjdSub').textContent = '상세 데이터 대기';
      bodyEl.innerHTML = '<div style="font-size:12px;color:#fbbf24;line-height:1.7;">이 종목의 상세 데이터가 아직 없습니다. '
        + 'auto_update_all_tabs.py 가 15분 주기로 채점표·상세 데이터를 갱신하므로, 다음 갱신 뒤 다시 눌러 주세요.'
        + '<br><span style="color:#94a3b8;">(가짜 추정값을 보여 주지 않기 위해 비워 둡니다)</span></div>';
      return;
    }
    renderStock(s, meta);
  }

  function close() {
    if (!box) return;
    box.style.display = 'none';
    document.body.style.overflow = '';
    curCode = null;
  }

  /* 카드(채점 스크리너 · 최종 후보) 클릭 → 상세 팝업.
     캡처 단계에서 먼저 잡아 기존 openDetail(...) 핸들러를 대체한다.
     단, 상세 데이터가 없는 종목은 건드리지 않고 기존 팝업을 그대로 둔다. */
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-manju-code]') : null;
    if (!el) return;
    var code = el.getAttribute('data-manju-code');
    var stocks = (window.MANJU_DATA || {}).stocks || {};
    if (!stocks[code]) return;
    e.preventDefault();
    e.stopPropagation();
    open(code);
  }, true);

  window.ManjuDetail = { open: open, close: close };
  window.openManjuDetail = window.openManjuDetail || function (code) { open(code); };
})();
