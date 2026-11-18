/* ============================================================
   포켓몬 배틀 월드 — 마을 꾸미기 소품 벡터 아트 (SVG + 캔버스 공용)

   ─ 이모지(⛺🔥⛲💡)에 기대던 주요 소품을 100x100 좌표계의 도형으로 그린다.
   ─ 화면(마을)은 SVG 로, 📸 사진 합성(canvas)은 같은 도형을 Path2D 로 그린다.
     → 두 곳의 모양이 정확히 같고, 어느 크기에서도 깨지지 않는다.

   도형 종류
     p : path          d / f(칠) / s(선) / w(선굵기) / o(투명도)
     e : ellipse       cx cy rx ry
     c : circle        cx cy r
     r : roundRect     x y w h rad
     l : line(path)    d (선만)
     h : glow halo     cx cy r c  (부드러운 빛무리 — 방사형 그라데이션)
   ============================================================ */
(function () {
  'use strict';
  if (window.POK_PROPS && window.POK_PROPS.version) return;

  var RED = '#ef5350';
  var RED_D = '#cf3f3c';
  var GOLD = '#ffd166';
  var GOLD_D = '#e2ab2c';
  var WOOD = '#c98b52';
  var WOOD_D = '#8a5a34';
  var STONE = '#d5dce5';
  var STONE_D = '#9aa6b4';
  var INK = '#2b3348';
  var LEAF = '#57b53a';
  var LEAF_L = '#7ed14f';
  var WATER = '#6ec8e8';
  var SHADOW = 'rgba(18,48,8,.20)';

  var ART = {
    /* ⛺ 포켓몬센터 텐트 */
    tent: [
      { k: 'e', cx: 50, cy: 89, rx: 38, ry: 7, f: SHADOW },
      { k: 'p', d: 'M50 22 L88 88 L50 88 Z', f: RED_D },
      { k: 'p', d: 'M50 22 L12 88 L50 88 Z', f: '#f4675f', s: '#cf3f3c', w: 1.6 },
      { k: 'p', d: 'M50 46 L36 88 L64 88 Z', f: INK },
      { k: 'p', d: 'M50 46 L36 88 L64 88', f: 'none', s: '#ffffff', w: 2.2 },
      { k: 'c', cx: 41, cy: 52, r: 7, f: '#ffffff', s: '#cf3f3c', w: 1.4 },
      { k: 'r', x: 40, y: 49.2, w: 2.2, h: 5.6, rad: 0.8, f: RED },
      { k: 'r', x: 38.2, y: 51, w: 5.6, h: 2.2, rad: 0.8, f: RED },
      { k: 'p', d: 'M50 22 L12 88', f: 'none', s: '#ffffff', w: 2.4, o: 0.5 },
      { k: 'p', d: 'M50 22 L88 88', f: 'none', s: '#a82c2a', w: 1.6, o: 0.5 },
    ],

    /* 🔥 캠프파이어 */
    campfire: [
      { k: 'h', cx: 50, cy: 52, r: 34, c: '#ffb347' },
      { k: 'e', cx: 50, cy: 88, rx: 30, ry: 6, f: SHADOW },
      { k: 'e', cx: 26, cy: 85, rx: 9, ry: 5.4, f: STONE_D },
      { k: 'e', cx: 74, cy: 85, rx: 9, ry: 5.4, f: '#b9c2cc' },
      { k: 'e', cx: 50, cy: 90, rx: 8, ry: 4.6, f: '#aeb8c4' },
      { k: 'l', d: 'M28 84 L72 73', s: WOOD_D, w: 7.5 },
      { k: 'l', d: 'M28 73 L72 84', s: '#a9724a', w: 7 },
      { k: 'p', d: 'M50 24 C67 42 69 57 50 78 C31 57 33 42 50 24 Z', f: '#ff7a2f' },
      { k: 'p', d: 'M50 38 C61 52 63 63 50 78 C37 63 39 52 50 38 Z', f: '#ffc247' },
      { k: 'p', d: 'M50 54 C57 63 58 70 50 78 C42 70 43 63 50 54 Z', f: '#fff3c4' },
    ],

    /* ⛲ 연못 분수 */
    fountain: [
      { k: 'h', cx: 50, cy: 46, r: 26, c: '#a9ecfb' },
      { k: 'e', cx: 50, cy: 82, rx: 34, ry: 12, f: '#e4edf5', s: '#a9c3d8', w: 1.8 },
      { k: 'e', cx: 50, cy: 80, rx: 27, ry: 8.6, f: WATER },
      { k: 'e', cx: 50, cy: 79.4, rx: 18, ry: 5, f: 'none', s: 'rgba(255,255,255,.8)', w: 2 },
      { k: 'r', x: 45, y: 58, w: 10, h: 22, rad: 2, f: '#eaf1f8', s: '#b7cde0', w: 1.2 },
      { k: 'e', cx: 50, cy: 58, rx: 15, ry: 5.6, f: '#f4f9fd', s: '#b7cde0', w: 1.4 },
      { k: 'l', d: 'M50 56 C50 42 44 32 39 26', s: '#bfeaff', w: 4.2 },
      { k: 'c', cx: 39, cy: 24.5, r: 3, f: '#e6f9ff' },
      { k: 'c', cx: 57, cy: 33, r: 2.2, f: '#e6f9ff' },
      { k: 'c', cx: 44, cy: 36, r: 1.8, f: '#e6f9ff' },
    ],

    /* 💡 가랜드 전구 */
    garland: [
      { k: 'l', d: 'M6 20 Q50 58 94 20', s: '#7a6650', w: 2.6 },
      { k: 'h', cx: 14, cy: 30, r: 9, c: '#ffd166' },
      { k: 'h', cx: 27, cy: 40, r: 9, c: '#ff9aa8' },
      { k: 'h', cx: 39, cy: 48, r: 9, c: '#8fd6ff' },
      { k: 'h', cx: 50, cy: 51, r: 9, c: '#a8e06a' },
      { k: 'h', cx: 61, cy: 48, r: 9, c: '#ffb86b' },
      { k: 'h', cx: 73, cy: 40, r: 9, c: '#c9a8ff' },
      { k: 'h', cx: 86, cy: 30, r: 9, c: '#8fd6ff' },
      { k: 'c', cx: 14, cy: 31, r: 4.2, f: '#ffd166', s: '#e2ab2c', w: 1 },
      { k: 'c', cx: 27, cy: 41, r: 4.2, f: '#ff9aa8', s: '#db7383', w: 1 },
      { k: 'c', cx: 39, cy: 48.6, r: 4.2, f: '#8fd6ff', s: '#5aa8d8', w: 1 },
      { k: 'c', cx: 50, cy: 51.6, r: 4.2, f: '#a8e06a', s: '#7eb445', w: 1 },
      { k: 'c', cx: 61, cy: 48.6, r: 4.2, f: '#ffb86b', s: '#d68c40', w: 1 },
      { k: 'c', cx: 73, cy: 41, r: 4.2, f: '#c9a8ff', s: '#9b7ad8', w: 1 },
      { k: 'c', cx: 86, cy: 31, r: 4.2, f: '#8fd6ff', s: '#5aa8d8', w: 1 },
    ],

    /* 🗿 피카츄 동상 — 돌 받침 위의 노란 친구 */
    statue: [
      { k: 'e', cx: 50, cy: 92, rx: 27, ry: 4.6, f: SHADOW },
      { k: 'r', x: 25, y: 81, w: 50, h: 9, rad: 3, f: '#8f9aa8' },
      { k: 'e', cx: 50, cy: 81, rx: 25, ry: 5.4, f: '#aab4c0' },
      { k: 'p', d: 'M36 81 C31 64 35 48 50 48 C65 48 69 64 64 81 Z', f: '#e8b93c' },
      { k: 'p', d: 'M42 36 L28 9 L50 28 Z', f: '#f2c94c', s: '#b8860b', w: 1.6 },
      { k: 'p', d: 'M58 36 L72 9 L50 28 Z', f: '#f2c94c', s: '#b8860b', w: 1.6 },
      { k: 'p', d: 'M28 9 L33 11 L44 26 Z', f: '#3a2a10' },
      { k: 'p', d: 'M72 9 L67 11 L56 26 Z', f: '#3a2a10' },
      { k: 'c', cx: 50, cy: 40, r: 13.5, f: '#f2c94c', s: '#b8860b', w: 1.4 },
      { k: 'c', cx: 44.5, cy: 38, r: 2, f: '#2f2410' },
      { k: 'c', cx: 55.5, cy: 38, r: 2, f: '#2f2410' },
      { k: 'c', cx: 40.5, cy: 44.5, r: 3.2, f: '#e8604f' },
      { k: 'c', cx: 59.5, cy: 44.5, r: 3.2, f: '#e8604f' },
      { k: 'p', d: 'M47 46 Q50 49.5 53 46', f: 'none', s: '#8a6a12', w: 1.4 },
      { k: 'l', d: 'M65 72 L79 58 L72 55 L84 40', s: '#f2c94c', w: 5.5 },
      { k: 'l', d: 'M65 72 L79 58 L72 55 L84 40', s: '#b8860b', w: 1.3, o: 0.6 },
    ],

    /* 🏮 몬스터볼 가로등 */
    lamp: [
      { k: 'h', cx: 50, cy: 32, r: 30, c: '#ffe9a8' },
      { k: 'e', cx: 50, cy: 92, rx: 16, ry: 4.4, f: SHADOW },
      { k: 'r', x: 47, y: 48, w: 6, h: 44, rad: 2, f: '#8d9aa8', s: '#6f7c8a', w: 1 },
      { k: 'r', x: 37, y: 88, w: 26, h: 5.4, rad: 2.6, f: '#6f7c8a' },
      { k: 'p', d: 'M32 33 A18 18 0 0 1 68 33 Z', f: '#f8fbff', s: INK, w: 1.6 },
      { k: 'p', d: 'M32 33 A18 18 0 0 0 68 33 Z', f: RED, s: INK, w: 1.6 },
      { k: 'r', x: 31.6, y: 30.6, w: 36.8, h: 4.8, rad: 1, f: INK },
      { k: 'c', cx: 50, cy: 33, r: 5.6, f: '#ffffff', s: INK, w: 1.8 },
      { k: 'c', cx: 50, cy: 33, r: 2, f: '#dfe6ef' },
    ],

    /* 🌟 별빛 조명 */
    star: [
      { k: 'h', cx: 50, cy: 58, r: 34, c: '#ffd166' },
      { k: 'l', d: 'M50 6 L50 26', s: '#7a6650', w: 2.2 },
      { k: 'p', d: 'M50.0 30.0 L56.5 47.1 L74.7 48.0 L60.5 59.4 L65.3 77.0 L50.0 67.0 L34.7 77.0 L39.5 59.4 L25.3 48.0 L43.5 47.1 Z', f: GOLD, s: GOLD_D, w: 2.2 },
      { k: 'p', d: 'M50.0 41.0 L53.8 50.8 L64.3 51.4 L56.1 58.0 L58.8 68.1 L50.0 62.4 L41.2 68.1 L43.9 58.0 L35.7 51.4 L46.2 50.8 Z', f: '#fff2bc', o: 0.95 },
    ],

    /* 🪴 몬스터볼 화분 */
    ballpot: [
      { k: 'e', cx: 50, cy: 90, rx: 20, ry: 4.4, f: SHADOW },
      { k: 'l', d: 'M50 62 L50 44', s: '#3f8a22', w: 3.4 },
      { k: 'p', d: 'M50 58 C41 44 31 40 27 38 C33 52 41 58 50 60 Z', f: LEAF, s: '#3f8a22', w: 1.2 },
      { k: 'p', d: 'M50 58 C59 44 69 40 73 38 C67 52 59 58 50 60 Z', f: LEAF_L, s: '#3f8a22', w: 1.2 },
      { k: 'c', cx: 50, cy: 38, r: 5.4, f: '#ff8a8a', s: '#cf3f3c', w: 1.2 },
      { k: 'p', d: 'M30 60 L70 60 L64 88 L36 88 Z', f: '#f8fbff', s: '#c3d2e2', w: 1.6 },
      { k: 'p', d: 'M30 60 L70 60 L67.6 73 L32.4 73 Z', f: RED },
      { k: 'r', x: 30.6, y: 72, w: 38.8, h: 3.4, rad: 1, f: INK },
      { k: 'c', cx: 50, cy: 73.7, r: 3.6, f: '#ffffff', s: INK, w: 1.6 },
    ],

    /* 🪑 나무 벤치 */
    bench: [
      { k: 'e', cx: 50, cy: 91, rx: 32, ry: 4.6, f: SHADOW },
      { k: 'r', x: 22, y: 70, w: 8, h: 20, rad: 2, f: WOOD_D },
      { k: 'r', x: 70, y: 70, w: 8, h: 20, rad: 2, f: WOOD_D },
      { k: 'r', x: 18, y: 60, w: 64, h: 10, rad: 3, f: WOOD, s: WOOD_D, w: 1.6 },
      { k: 'l', d: 'M20 65 L80 65', s: WOOD_D, w: 1.2, o: 0.55 },
      { k: 'r', x: 18, y: 40, w: 64, h: 8, rad: 3, f: '#d69a5e', s: WOOD_D, w: 1.6 },
      { k: 'r', x: 18, y: 30, w: 64, h: 8, rad: 3, f: '#d69a5e', s: WOOD_D, w: 1.6 },
      { k: 'r', x: 76, y: 38, w: 7, h: 26, rad: 2, f: WOOD_D },
      { k: 'r', x: 17, y: 38, w: 7, h: 26, rad: 2, f: WOOD_D },
    ],

    /* 🚩 응원 깃발 */
    flag: [
      { k: 'e', cx: 45, cy: 90, rx: 14, ry: 4, f: SHADOW },
      { k: 'r', x: 43, y: 22, w: 4.4, h: 68, rad: 2, f: '#b8c2cc', s: '#8d9aa8', w: 1 },
      { k: 'c', cx: 45.2, cy: 21, r: 3.8, f: GOLD, s: GOLD_D, w: 1.2 },
      { k: 'p', d: 'M47.4 26 C62 22 72 31 86 26 L86 52 C72 57 62 48 47.4 52 Z', f: RED, s: RED_D, w: 1.6 },
      { k: 'p', d: 'M47.4 34 C62 30 72 39 86 34 L86 40 C72 45 62 36 47.4 40 Z', f: '#ffffff', o: 0.9 },
    ],
  };

  var cache = {};       /* path 문자열 → Path2D */
  var uid = 0;

  function path2d(d) {
    if (!cache[d]) {
      try { cache[d] = new Path2D(d); } catch (e) { cache[d] = null; }
    }
    return cache[d];
  }

  /* ---------- SVG(화면) ---------- */
  function esc(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function svgMarkup(key) {
    var list = ART[key];
    if (!list) return '';
    var id = 'pa' + (uid += 1);
    var halos = list.filter(function (s) { return s.k === 'h'; });
    var out = '<svg class="pa" viewBox="0 0 100 100" aria-hidden="true" focusable="false">';
    if (halos.length) {
      out += '<defs>';
      halos.forEach(function (h, i) {
        out += '<radialGradient id="' + id + 'g' + (i + 1) + '"><stop offset="0" stop-color="' + esc(h.c) + '" stop-opacity=".55"/><stop offset="1" stop-color="' + esc(h.c) + '" stop-opacity="0"/></radialGradient>';
      });
      out += '</defs>';
    }
    var hi = 0;
    list.forEach(function (s) {
      var f = s.f === 'none' ? 'none' : esc(s.f || 'none');
      var st = s.s ? ' stroke="' + esc(s.s) + '" stroke-width="' + (s.w || 1) + '" stroke-linejoin="round" stroke-linecap="round"' : '';
      var op = (s.o === undefined) ? '' : ' opacity="' + s.o + '"';
      if (s.k === 'h') {
        out += '<circle cx="' + s.cx + '" cy="' + s.cy + '" r="' + s.r + '" fill="url(#' + id + 'g' + (hi += 1) + ')"/>';
      } else if (s.k === 'p' || s.k === 'l') {
        out += '<path d="' + esc(s.d) + '" fill="' + f + '"' + st + op + '/>';
      } else if (s.k === 'c') {
        out += '<circle cx="' + s.cx + '" cy="' + s.cy + '" r="' + s.r + '" fill="' + f + '"' + st + op + '/>';
      } else if (s.k === 'e') {
        out += '<ellipse cx="' + s.cx + '" cy="' + s.cy + '" rx="' + s.rx + '" ry="' + s.ry + '" fill="' + f + '"' + st + op + '/>';
      } else if (s.k === 'r') {
        out += '<rect x="' + s.x + '" y="' + s.y + '" width="' + s.w + '" height="' + s.h + '" rx="' + (s.rad || 0) + '" fill="' + f + '"' + st + op + '/>';
      }
    });
    return out + '</svg>';
  }

  /* ---------- 캔버스(사진) ---------- */
  function draw(ctx, key, cx, cy, size) {
    var list = ART[key];
    if (!list || !ctx) return false;
    var s = (size || 64) / 100;
    ctx.save();
    ctx.translate(cx - 50 * s, cy - 50 * s);
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    list.forEach(function (sh) {
      ctx.save();
      if (sh.o !== undefined) ctx.globalAlpha = sh.o;
      if (sh.k === 'h') {
        var g = ctx.createRadialGradient(sh.cx, sh.cy, 0, sh.cx, sh.cy, sh.r);
        g.addColorStop(0, hexA(sh.c, 0.55));
        g.addColorStop(1, hexA(sh.c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2);
        ctx.fill();
      } else if (sh.k === 'p' || sh.k === 'l') {
        var p = path2d(sh.d);
        if (!p) { ctx.restore(); return; }
        if (sh.f && sh.f !== 'none') { ctx.fillStyle = sh.f; ctx.fill(p); }
        if (sh.s) {
          ctx.strokeStyle = sh.s;
          ctx.lineWidth = sh.w || 1;
          ctx.stroke(p);
        }
      } else {
        ctx.beginPath();
        if (sh.k === 'c') ctx.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2);
        else if (sh.k === 'e') ctx.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, 0, 0, Math.PI * 2);
        else if (sh.k === 'r') roundRect(ctx, sh.x, sh.y, sh.w, sh.h, sh.rad || 0);
        if (sh.f && sh.f !== 'none') { ctx.fillStyle = sh.f; ctx.fill(); }
        if (sh.s) { ctx.strokeStyle = sh.s; ctx.lineWidth = sh.w || 1; ctx.stroke(); }
      }
      ctx.restore();
    });
    ctx.restore();
    return true;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexA(c, a) {
    if (!c) return 'rgba(255,255,255,' + a + ')';
    if (c.charAt(0) !== '#') return c;
    var n = c.slice(1);
    if (n.length === 3) n = n.charAt(0) + n.charAt(0) + n.charAt(1) + n.charAt(1) + n.charAt(2) + n.charAt(2);
    var v = parseInt(n, 16);
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
  }

  window.POK_PROPS = {
    version: 1,
    keys: function () { return Object.keys(ART); },
    has: function (k) { return !!ART[k]; },
    svg: svgMarkup,
    draw: draw,
  };
})();
