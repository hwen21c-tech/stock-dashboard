/* ============================================================================
 * 📅 종가베팅 하루 경과 가드 (StrategyDayGuard) — 만쥬 · 신정재 전용 (2026-11-27)
 * ----------------------------------------------------------------------------
 *  사용자 요청: "만쥬와 신정재는 특히 종가베팅이라, 하루가 지나고 핀고정 안 하면
 *  삭제되고 다시 조건에 맞으면 나타나는 걸로 수정"
 *
 *  · 종가베팅은 **그날 종가**로만 유효하다. 기준일(자동 채점·확정 후보의 날짜)이
 *    오늘(KST)보다 과거면 그 후보는 다음 날의 매매 후보가 아니다.
 *  · 다만 **주말(토·일)은 직전 거래일(금요일) 후보를 그대로 둔다** — 금요일 종가로 뽑은
 *    후보는 월요일 장전까지가 '다음 거래일'의 후보이기 때문이다. 2026-11-27 사용자 결정
 *    "주말은 두기". 월요일 00:00 KST부터는 금요일 기준일도 지난 것으로 판정해 📌 핀 고정만
 *    남는다(목요일 이전 데이터는 주말에도 그대로 내린다).
 *  · 그래서 기준일이 지난 영역은 화면에서 내리고(비표시), 📌 핀 고정한 종목만
 *    strategy-pins 의 '📌 고정됨' 카드로 남긴다.
 *  · 오늘 기준일 데이터가 들어오면(장마감 재스캔 · 실시간 채점 · 무깜빡임 핫스왑)
 *    표시를 그대로 되돌린다 — 값을 만들거나 고치지 않고 **표시 여부만** 다룬다.
 *  · 신정재 카드 목록은 index.html 안 Jongbe 엔진이 같은 규칙(basisLabel < 오늘)으로
 *    거르고, 실시간 판정 패널은 live-api.js / live-strategy-panels.js 가 같은 규칙으로
 *    거른다. 이 파일은 만쥬 탭(자동 채점 스크리너 + 익일 대응 본문)을 맡는다.
 *  · 정적(GitHub Pages) · 동적(Vercel) 공통. 날짜를 못 읽으면 **아무것도 숨기지 않는다**
 *    (fail-open — 모르는 것을 지우지 않는다).
 * ========================================================================== */
(function () {
  'use strict';
  if (window.StrategyDayGuard && window.StrategyDayGuard.version) return;

  var VERSION = '1.1.0';
  var HIDE_CLASS = 'sd-dayhide';
  var PIN_KEY = 'stock.pins.v1';
  var KST_MS = 9 * 3600 * 1000;
  var WD = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------------------------------------------------------- 날짜 */
  function kstDate(ms) { return new Date((typeof ms === 'number' ? ms : Date.now()) + KST_MS); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { return kstDate().toISOString().slice(0, 10); }
  function isoOf(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  function dayMs(iso) {
    var t = Date.parse(String(iso || '') + 'T00:00:00Z');
    return isFinite(t) ? t : null;
  }
  /* '11/26' · '11/26(목)' · '11/26 목 20:00' · '2026-11-26' → 'YYYY-MM-DD' */
  function isoFromText(txt) {
    var t = String(txt == null ? '' : txt).replace(/\s+/g, ' ');
    var m = t.match(/(20\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
    if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
    m = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?=\s*\(?\s*[월화수목금토일]|\s+\d{1,2}\s*:)/);
    if (!m) return '';
    var now = kstDate();
    var year = now.getUTCFullYear();
    var iso = isoOf(year, Number(m[1]), Number(m[2]));
    if (!iso) return '';
    /* 연말·연초 보정 — 45일 넘게 미래면 작년 날짜로 본다 */
    var diff = (dayMs(iso) || 0) - (dayMs(todayISO()) || 0);
    if (diff > 45 * 86400000) iso = isoOf(year - 1, Number(m[1]), Number(m[2]));
    return iso;
  }
  function mdLabel(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return String(iso || '');
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    return Number(p[1]) + '/' + Number(p[2]) + '(' + WD[d.getUTCDay()] + ')';
  }
  function weekdayOf(iso) {
    var t = dayMs(iso || todayISO());
    return t == null ? null : new Date(t).getUTCDay();
  }
  function shiftISO(iso, days) {
    var t = dayMs(iso);
    return t == null ? '' : new Date(t + days * 86400000).toISOString().slice(0, 10);
  }
  /* 🗓 주말 유지 (2026-11-27 사용자 결정 "주말은 두기")
     평일이면 '오늘', 토·일이면 '직전 거래일 = 금요일'이 기준선이다. 기준일이 이 기준선보다
     과거일 때만 경과(stale)로 본다. → 토·일에 금요일 후보는 남고, 목요일 이전 후보는 내려간다.
     월요일 00:00 KST부터는 기준선이 '오늘(월)'로 돌아가 금요일 후보도 경과가 된다. */
  function weekendAnchorISO() {
    var today = todayISO();
    var wd = weekdayOf(today);
    if (wd === 6) return shiftISO(today, -1);   /* 토 → 금요일 */
    if (wd === 0) return shiftISO(today, -2);   /* 일 → 금요일 */
    return today;
  }
  function isWeekend() {
    var wd = weekdayOf(todayISO());
    return wd === 0 || wd === 6;
  }
  function isStale(iso) {
    if (!iso) return false;                 /* 날짜를 모르면 건드리지 않는다 */
    return String(iso) < weekendAnchorISO();
  }

  /* ---------------------------------------------------------- 핀 */
  function isPinned(tab, code) {
    if (!tab || !code) return false;
    try {
      if (window.StrategyPins && typeof window.StrategyPins.has === 'function') {
        return !!window.StrategyPins.has(tab, String(code));
      }
      var raw = window.localStorage ? window.localStorage.getItem(PIN_KEY) : null;
      var d = raw ? JSON.parse(raw) : null;
      var t = (d && d.tabs && d.tabs[tab]) || {};
      var it = t[String(code)];
      return !!(it && !it.del);
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------- CSS */
  function injectCss() {
    if (document.getElementById('sd-day-css')) return;
    var el = document.createElement('style');
    el.id = 'sd-day-css';
    el.textContent = '.' + HIDE_CLASS + '{display:none !important}';
    document.head.appendChild(el);
  }

  /* ---------------------------------------------------------- 만쥬 영역 찾기 */
  function headText(el, n) {
    return String((el && el.textContent) || '').replace(/\s+/g, ' ').slice(0, n || 240);
  }
  function manjuRegions(root) {
    var out = [];
    var kids = Array.prototype.slice.call(root.children || []);
    kids.forEach(function (k) {
      if (!k || !k.querySelector) return;
      var isScreener = out.some(function (r) { return r.kind === 'screener'; });
      if (!isScreener && k.querySelector('.mj-screener-card')) {
        out.push({ el: k, kind: 'screener' });
        return;
      }
      if (k.querySelector('.manju-item')) out.push({ el: k, kind: 'day' });
    });
    return out;
  }
  function regionBasis(r) {
    if (r.kind === 'screener') {
      /* 자동 채점 스크리너는 생성기가 MANJU_DATA.updatedAt 을 '오늘 날짜 시각'으로
         다시 쓰므로 그 날짜가 기준일이다(머리말에는 시각만 찍힌다). */
      var d = window.MANJU_DATA;
      var iso = isoFromText((d && d.updatedAt) || '');
      if (iso) return iso;
      return isoFromText(headText(r.el, 260));
    }
    /* 익일 대응 본문 — 머리말(세션 배너·sec-head)의 날짜만 읽는다.
       본문 깊숙한 '11/25 확정' 같은 과거 인용을 기준일로 오해하지 않게 앞부분만 본다. */
    var head = '';
    Array.prototype.slice.call(r.el.children || [], 0, 3).forEach(function (k) {
      head += ' ' + ((k && k.textContent) || '');
    });
    return isoFromText(head) || isoFromText(headText(r.el, 220));
  }

  /* ---------------------------------------------------------- 숨김/복원 */
  function applyHide(el, hide) {
    if (!el) return false;
    var on = el.getAttribute('data-sd-dayhide') === '1';
    if (!!hide === on) return false;
    if (hide) {
      el.setAttribute('data-sd-dayhide', '1');
      el.setAttribute('data-sd-dayprev', el.style.display || '');
      el.style.display = 'none';
      if (el.classList) el.classList.add(HIDE_CLASS);
    } else {
      el.removeAttribute('data-sd-dayhide');
      el.style.display = el.getAttribute('data-sd-dayprev') || '';
      el.removeAttribute('data-sd-dayprev');
      if (el.classList) el.classList.remove(HIDE_CLASS);
    }
    return true;
  }

  /* 안내 박스 — (a) 기준일이 지나 내린 영역이 있을 때, (b) 주말이라 금요일 후보를 그대로
     두는 중일 때. 둘 다 해당하면 한 박스에 같이 적는다. */
  function noticeHtml(hid, keptBasis) {
    if (!hid.length) {
      return '<div style="background:linear-gradient(135deg,rgba(12,74,110,0.45),rgba(15,23,42,0.95));' +
          'border:1px solid #38bdf8;border-radius:10px;padding:11px 13px;">' +
          '<div style="font-size:12.5px;font-weight:900;color:#7dd3fc;">🗓 주말 — 직전 거래일 ' +
            mdLabel(keptBasis) + ' 종가 기준 후보를 그대로 유지합니다</div>' +
          '<div style="font-size:11px;color:#e2e8f0;line-height:1.65;margin-top:5px;">' +
            '토·일에는 금요일 종가로 뽑은 후보를 내리지 않습니다(월요일 장전까지가 다음 거래일 후보) · ' +
            '<b>월요일 00:00부터는 📌 핀 고정한 종목만</b> 남고, 오늘 조건을 채운 종목이 있으면 다시 나타납니다.</div>' +
        '</div>';
    }
    var lines = hid.map(function (h) {
      if (h.kind === 'screener') {
        return '🤖 <b>자동 채점 스크리너</b> — ' + mdLabel(h.basis) +
          ' 기준이라 내렸습니다 · 오늘 실시간 채점이 들어오면 다시 표시합니다.';
      }
      return '🌙 <b>익일 대응 · 최종 후보</b> — ' + mdLabel(h.basis) +
        ' 기준이라 내렸습니다 · 오늘 스캔·타임라인이 갱신되면 다시 표시합니다.';
    });
    if (keptBasis) {
      lines.push('🗓 <b>주말 유지</b> — ' + mdLabel(keptBasis) + ' 기준은 주말이라 그대로 둡니다.');
    }
    return '<div style="background:linear-gradient(135deg,rgba(120,53,15,0.45),rgba(15,23,42,0.95));' +
        'border:1px solid #f59e0b;border-radius:10px;padding:11px 13px;">' +
        '<div style="font-size:12.5px;font-weight:900;color:#fbbf24;">📅 종가베팅 하루 경과 — 오늘 ' +
          mdLabel(todayISO()) + ' 기준으로 다시 채점합니다</div>' +
        '<div style="font-size:11px;color:#e2e8f0;line-height:1.65;margin-top:5px;">' + lines.join('<br>') + '</div>' +
        '<div style="font-size:10.5px;color:#94a3b8;line-height:1.65;margin-top:5px;">' +
          (isWeekend() ? '주말에는 <b>금요일 종가 후보</b>를 유지하고, 그보다 오래된 후보만 내립니다 · ' : '') +
          '📌 <b>핀 고정한 종목만</b> 아래에 남습니다' +
          '(다음 날에도 보려면 카드의 <b>📌 핀 고정</b>을 미리 눌러 두세요) · 조건을 채운 종목이 없으면 억지로 채우지 않습니다.</div>' +
      '</div>';
  }

  function ensureShelf(root, hid, regions, keptBasis) {
    var changed = false;
    var notice = document.getElementById('sdDayNotice');
    if (!notice || notice.parentNode !== root) {
      notice = document.createElement('div');
      notice.id = 'sdDayNotice';
      notice.style.cssText = 'margin-bottom:10px;';
      var anchor = regions.length ? regions[0].el : null;
      if (anchor && anchor.parentNode === root) root.insertBefore(notice, anchor);
      else root.appendChild(notice);
      changed = true;
    }
    var html = noticeHtml(hid, keptBasis);
    if (notice.getAttribute('data-sig') !== html) {
      notice.innerHTML = html;
      notice.setAttribute('data-sig', html);
      changed = true;
    }
    var wrap = document.getElementById('mjPinnedWrap');
    if (!wrap || wrap.parentNode !== root) {
      wrap = document.createElement('div');
      wrap.id = 'mjPinnedWrap';
      wrap.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-bottom:10px;';
      if (notice.parentNode === root) root.insertBefore(wrap, notice.nextSibling);
      else root.appendChild(wrap);
      changed = true;
    }
    return changed;
  }

  function clearShelf(root) {
    var changed = false;
    ['sdDayNotice', 'mjPinnedWrap'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode === root) {
        el.parentNode.removeChild(el);
        changed = true;
      }
    });
    return changed;
  }

  /* ---------------------------------------------------------- 만쥬 가드 */
  var hideSig = '';

  function guardManju() {
    var root = document.getElementById('tabManju');
    if (!root) return false;
    var regions = manjuRegions(root);
    if (!regions.length) {
      if (clearShelf(root)) return true;
      return false;
    }
    var changed = false;
    var hid = [];
    var kept = [];
    var weekend = isWeekend();
    var anchor = weekendAnchorISO();
    regions.forEach(function (r) {
      var basis = regionBasis(r);
      var stale = isStale(basis);
      if (applyHide(r.el, stale)) changed = true;
      if (stale) hid.push({ kind: r.kind, basis: basis });
      else if (weekend && basis && basis === anchor) kept.push(basis);
    });
    var keptBasis = kept.length ? kept[0] : '';
    if (hid.length || keptBasis) {
      if (ensureShelf(root, hid, regions, keptBasis)) changed = true;
    } else if (clearShelf(root)) {
      changed = true;
    }
    var sig = hid.map(function (h) { return h.kind + ':' + h.basis; }).join('|') + '#' + keptBasis;
    if (sig !== hideSig) { hideSig = sig; changed = true; }
    if (changed) {
      try {
        if (window.StrategyPins && typeof window.StrategyPins.annotate === 'function') {
          window.StrategyPins.annotate('manju');
        }
      } catch (e) { /* 핀 카드는 다음 주기에 다시 그려진다 */ }
    }
    return changed;
  }

  /* ---------------------------------------------------------- 부트 */
  function tick() {
    try { guardManju(); } catch (e) { /* 한 영역이 깨져도 대시보드는 그대로 */ }
  }
  function boot() {
    injectCss();
    tick();
    setTimeout(tick, 700);
    setTimeout(tick, 2600);
    var t = null;
    var root = document.getElementById('tabManju');
    if (root && window.MutationObserver) {
      var mo = new MutationObserver(function () {
        if (t) clearTimeout(t);
        t = setTimeout(tick, 420);
      });
      mo.observe(root, { childList: true, subtree: true });
    }
    setInterval(tick, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });
    window.addEventListener('load', function () { setTimeout(tick, 900); });
  }

  window.StrategyDayGuard = {
    version: VERSION,
    today: todayISO,
    isoFromText: isoFromText,
    mdLabel: mdLabel,
    isStale: isStale,
    isPinned: isPinned,
    isWeekend: isWeekend,
    anchor: weekendAnchorISO,
    tick: tick,
    HIDE_CLASS: HIDE_CLASS,
    PIN_KEY: PIN_KEY,
    state: function () {
      var root = document.getElementById('tabManju');
      var out = { today: todayISO(), weekend: isWeekend(), anchor: weekendAnchorISO(), regions: [] };
      if (!root) return out;
      manjuRegions(root).forEach(function (r) {
        var b = regionBasis(r);
        out.regions.push({ kind: r.kind, basis: b, stale: isStale(b), hidden: r.el.getAttribute('data-sd-dayhide') === '1' });
      });
      out.notice = !!document.getElementById('sdDayNotice');
      out.noticeText = (document.getElementById('sdDayNotice') || {}).innerText || '';
      out.shelf = !!document.getElementById('mjPinnedWrap');
      return out;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
