/* ============================================================================
 * 📉 전략 탭 공통 카드 미니 차트 — RN존 · 신정재가 비중법사·홍인기·깡토와 같은
 *    '카드 안 일봉 캔들 + 기준선' 양식을 쓰도록 한 곳에 모은 렌더러 (2026-11-26)
 * ----------------------------------------------------------------------------
 *  · 카드 안 <canvas data-su-mini="코드"> 를 찾아 그린다. 데이터는 각 탭이 이미
 *    들고 있는 일봉(candles)을 그대로 넘긴다 — 새로 받아오지 않는다.
 *  · 기준선(refs)은 [{v, color, label, dash}] — 값이 없으면 그 선만 건너뛴다.
 *  · 값이 없으면 아무것도 만들지 않는다(빈 캔버스 + '일봉 없음' 캡션은 각 탭이 처리).
 *  · 굵기·색·여백은 깡토(.kk-mini)·홍인기(.sc-mini) 카드와 같은 규격:
 *    배경 #070c14 · 상승 #ef4444 · 하락 #3b82f6 · 기준선 점선 · 오른쪽 라벨.
 * ========================================================================== */
(function () {
  'use strict';

  var COL = {
    bg: '#070c14',
    grid: 'rgba(148,163,184,0.10)',
    up: '#ef4444',
    down: '#3b82f6',
    flat: '#94a3b8',
    last: '#e2e8f0',
    label: '#94a3b8'
  };

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function px(v) { return Math.round(v) + 0.5; }

  function normalize(candles) {
    var out = [];
    (candles || []).forEach(function (c) {
      if (!c) return;
      var o = num(c.open), h = num(c.high), l = num(c.low), cl = num(c.close);
      if (o === null || h === null || l === null || cl === null) return;
      out.push({ o: o, h: h, l: l, c: cl });
    });
    return out;
  }

  /* candles: [{open,high,low,close}] 또는 [{o,h,l,c}]
     refs:     [{v, color, label, dash:[4,3]}]  (가격 기준선)
     opt:      { count: 60, height: 96 } */
  function draw(cv, candles, refs, opt) {
    if (!cv || !cv.getContext) return false;
    var o = opt || {};
    var list = (candles || []).map(function (c) {
      if (!c) return null;
      return {
        o: num(c.open) !== null ? num(c.open) : num(c.o),
        h: num(c.high) !== null ? num(c.high) : num(c.h),
        l: num(c.low) !== null ? num(c.low) : num(c.l),
        c: num(c.close) !== null ? num(c.close) : num(c.c)
      };
    }).filter(function (c) { return c && c.o !== null && c.h !== null && c.l !== null && c.c !== null; });
    if (!list.length) return false;

    var count = o.count || 60;
    if (list.length > count) list = list.slice(-count);

    var W = Math.round(cv.clientWidth || (cv.parentNode ? cv.parentNode.clientWidth : 0) || 280);
    var H = Math.round(o.height || Number(cv.getAttribute('data-h')) || 96);
    if (W < 40) W = 280;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = H + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);

    var pl = 4, pr = 54, pt = 6, pb = 12;
    var iw = Math.max(20, W - pl - pr);
    var ih = Math.max(20, H - pt - pb);

    var hi = -Infinity, lo = Infinity;
    list.forEach(function (c) {
      if (c.h > hi) hi = c.h;
      if (c.l < lo) lo = c.l;
    });
    (refs || []).forEach(function (r) {
      var v = num(r && r.v);
      if (v === null) return;
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    });
    if (!isFinite(hi) || !isFinite(lo)) return false;
    if (hi === lo) { hi = lo * 1.02 + 1; lo = lo * 0.98 - 1; }
    var pad = (hi - lo) * 0.06;
    hi += pad; lo -= pad;

    function yOf(v) { return pt + (hi - v) / (hi - lo) * ih; }

    /* 가로 눈금 3줄 */
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    for (var i = 1; i <= 3; i += 1) {
      var gy = px(pt + ih * i / 4);
      ctx.beginPath();
      ctx.moveTo(pl, gy);
      ctx.lineTo(pl + iw, gy);
      ctx.stroke();
    }

    /* 캔들 */
    var step = iw / list.length;
    var bw = Math.max(1.4, Math.min(7, step * 0.66));
    list.forEach(function (c, idx) {
      var x = pl + step * (idx + 0.5);
      var up = c.c >= c.o;
      ctx.strokeStyle = up ? COL.up : COL.down;
      ctx.fillStyle = up ? COL.up : COL.down;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px(x), yOf(c.h));
      ctx.lineTo(px(x), yOf(c.l));
      ctx.stroke();
      var y1 = yOf(Math.max(c.o, c.c));
      var y2 = yOf(Math.min(c.o, c.c));
      var bh = Math.max(1, y2 - y1);
      ctx.fillRect(Math.round(x - bw / 2), Math.round(y1), Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)));
    });

    /* 기준선 + 오른쪽 라벨 (라벨이 겹치면 뒤 라벨만 건너뛴다 — 선은 그대로 그린다) */
    var placed = [];
    var refSorted = (refs || []).slice().sort(function (a, b) {
      var av = num(a && a.v); var bv = num(b && b.v);
      return (bv === null ? -Infinity : bv) - (av === null ? -Infinity : av);
    });
    refSorted.forEach(function (r) {
      var v = num(r && r.v);
      if (v === null) return;
      if (v > hi || v < lo) return;
      var y = px(yOf(v));
      ctx.save();
      ctx.strokeStyle = r.color || '#94a3b8';
      ctx.lineWidth = 1;
      if (r.dash !== false) {
        var d = Array.isArray(r.dash) ? r.dash : [4, 3];
        if (ctx.setLineDash) ctx.setLineDash(d);
      }
      ctx.beginPath();
      ctx.moveTo(pl, y);
      ctx.lineTo(pl + iw, y);
      ctx.stroke();
      ctx.restore();
      if (!r.label) return;
      for (var k = 0; k < placed.length; k += 1) {
        if (Math.abs(placed[k] - y) < 9) return;   // 이미 붙인 라벨과 붙으면 건너뛴다
      }
      placed.push(y);
      ctx.fillStyle = r.color || COL.label;
      ctx.font = '700 8.5px -apple-system,BlinkMacSystemFont,"Pretendard",sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      var ly = Math.max(pt + 5, Math.min(pt + ih - 5, y));   // 캔버스 위/아래로 새지 않게
      var txt = String(r.label).slice(0, 8);
      var tw = ctx.measureText(txt).width;
      ctx.save();
      ctx.fillStyle = 'rgba(7,12,20,0.72)';                  // 캔들 위에 겹쳐도 읽히게 얇은 판
      ctx.fillRect(pl + iw + 1, ly - 6, tw + 3, 12);
      ctx.restore();
      ctx.fillText(txt, pl + iw + 3, ly);
    });

    /* 마지막 종가 — 점선 + 오른쪽 가격 */
    var last = list[list.length - 1];
    var ly = px(yOf(last.c));
    ctx.save();
    ctx.strokeStyle = 'rgba(226,232,240,0.55)';
    ctx.lineWidth = 1;
    if (ctx.setLineDash) ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(pl, ly);
    ctx.lineTo(pl + iw, ly);
    ctx.stroke();
    ctx.restore();
    return true;
  }

  function drawIn(root, code, candles, refs, opt) {
    if (!root) return 0;
    var sel = code
      ? 'canvas[data-su-mini="' + String(code).replace(/"/g, '') + '"]'
      : 'canvas[data-su-mini]';
    var n = 0;
    Array.prototype.forEach.call(root.querySelectorAll(sel), function (cv) {
      if (draw(cv, candles, refs, opt)) n += 1;
    });
    return n;
  }

  window.StratMini = { draw: draw, drawIn: drawIn, COL: COL };
})();
