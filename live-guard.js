/*!
 * 🛡️ live-guard.js — 관제탑 전 탭 공통 안전장치 (2026-11-27)
 * ---------------------------------------------------------------------------
 * 왜: 한 종목의 이상 수치나 한 API 의 실패가 탭 전체를 깨뜨리는 일을 막는다.
 *     11/26 테마맵 +36.87% 같은 '존재할 수 없는 값'이 화면에 그대로 뜨는 걸
 *     사용자가 직접 잡았다. 원인(기준가 괴리)은 데이터·API 단에서 고쳤고,
 *     이 파일은 화면에서 마지막으로 한 번 더 막는 안전망이다.
 *
 * 하는 일 3가지
 *   ① 문장 가드  — 화면에 'NaN' · 'undefined' · 'Invalid Date' · '[object Object]' 가
 *                  글자로 나가면 '—' 로 바꾼다. (값을 만들지 않고, 모른다고 표시)
 *   ② 렌더 격리  — SD.run('이름', fn) 으로 감싼 렌더는 실패해도 다른 탭을 멈추지 않는다.
 *   ③ 오류 기록  — window.SD.logs 에 최근 30건을 남긴다. 사용자 화면에는 아무것도 띄우지 않는다.
 *
 * 원칙: 값을 새로 만들어 넣지 않는다. 모르면 '—'. 콘솔에는 warn 만 남긴다(에러 0 유지).
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.SD && window.SD.__guard) return;

  var MAX_LOGS = 30;
  var logs = [];
  var samples = [];
  var scrubbed = 0;

  function stamp() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  function note(kind, err) {
    var msg = (err && (err.stack || err.message)) || err || '';
    var line = String(msg).split('\n')[0].slice(0, 300);
    logs.push({ at: stamp(), kind: kind, msg: String(msg).slice(0, 600) });
    if (logs.length > MAX_LOGS) logs.shift();
    try { console.warn('[SD guard] ' + kind + ' — ' + line); } catch (e) { /* noop */ }
  }

  /** 렌더 함수 격리 — 예외가 나도 다른 탭·다음 폴링을 막지 않는다 */
  function run(label, fn, fallback) {
    try {
      return fn();
    } catch (e) {
      note('render:' + label, e);
      return fallback;
    }
  }

  /* ---------------------------- ① 문장 가드 ---------------------------- */
  var BAD = /(^|[^0-9A-Za-z_])(NaN|undefined|Infinity|-Infinity|Invalid Date|\[object Object\])(?![0-9A-Za-z_])/g;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, PRE: 1, CODE: 1, TEMPLATE: 1, NOSCRIPT: 1, INPUT: 1, SELECT: 1, OPTION: 1 };

  function badness(s) {
    BAD.lastIndex = 0;
    return BAD.test(s);
  }

  function fixText(node) {
    var s = node.data;
    if (!s || s.length > 4000) return;
    var out = null;
    var trimmed = s.trim();
    if (trimmed === 'null' || trimmed === 'null%' || trimmed === 'NaN%') {
      out = '—';
    } else if (badness(s)) {
      BAD.lastIndex = 0;
      out = s.replace(BAD, function (all, pre) { return pre + '—'; });
    }
    if (out !== null && out !== s) {
      if (samples.length < 20) samples.push({ before: s.slice(0, 120), after: out.slice(0, 120), at: stamp() });
      node.data = out;
      scrubbed += 1;
    }
  }

  function walk(root, budget) {
    if (!root || budget <= 0) return budget;
    var walker;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    } catch (e) {
      return budget;
    }
    var n;
    while ((n = walker.nextNode())) {
      budget -= 1;
      if (budget <= 0) break;
      var p = n.parentElement;
      if (!p) continue;
      if (SKIP_TAGS[p.tagName]) continue;
      if (p.closest && p.closest('script,style,pre,code,textarea,template,noscript,[data-raw-text]')) continue;
      fixText(n);
    }
    return budget;
  }

  var pending = [];
  var scheduled = false;

  function flush() {
    scheduled = false;
    var nodes = pending;
    pending = [];
    var budget = 3000;
    for (var i = 0; i < nodes.length && budget > 0; i += 1) {
      budget = walk(nodes[i], budget);
    }
    // 넘친 노드는 다음 유휴 시간에 한 번 더(!) — 화면을 멈추지 않기 위해 쪼갠다
    if (nodes.length && budget <= 0) {
      pending.push(document.body);
      schedule();
    }
  }

  function schedule(root) {
    if (root && root.nodeType === 1) pending.push(root);
    if (scheduled) return;
    scheduled = true;
    if (window.requestIdleCallback) {
      window.requestIdleCallback(flush, { timeout: 1500 });
    } else {
      setTimeout(flush, 200);
    }
  }

  function startSweep() {
    run('initial-sweep', function () { walk(document.body, 5000); });
    if (!window.MutationObserver) return;
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i += 1) {
          var m = muts[i];
          if (m.type === 'characterData') {
            var pe = m.target && m.target.parentElement;
            if (pe && !SKIP_TAGS[pe.tagName]) schedule(pe);
            continue;
          }
          var added = m.addedNodes || [];
          for (var j = 0; j < added.length; j += 1) {
            var a = added[j];
            if (!a) continue;
            if (a.nodeType === 1) schedule(a);
            else if (a.nodeType === 3 && a.parentElement && !SKIP_TAGS[a.parentElement.tagName]) schedule(a.parentElement);
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) {
      note('observer', e);
    }
  }

  /* ------------------------ ② 안전한 표시 포맷터 ------------------------ */
  function finite(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(String(v).replace(/[,\s%원]/g, ''));
      return isFinite(n) ? n : null;
    }
    return null;
  }

  var fmt = {
    /** 등락률 — 없으면 '—' (0.00% 와 구분) */
    pct: function (v, digits) {
      var n = finite(v);
      if (n === null) return '—';
      var d = typeof digits === 'number' ? digits : 2;
      return (n > 0 ? '+' : '') + n.toFixed(d) + '%';
    },
    /** 숫자 + 단위 — 없으면 '—' */
    num: function (v) {
      var n = finite(v);
      if (n === null) return '—';
      try { return n.toLocaleString('ko-KR'); } catch (e) { return String(n); }
    },
    /** 원 단위 금액 — 음수·NaN 은 '—' */
    won: function (v) {
      var n = finite(v);
      if (n === null || n < 0) return '—';
      try { return n.toLocaleString('ko-KR') + '원'; } catch (e) { return '—'; }
    },
    /** 날짜 — Invalid Date 는 '—' */
    date: function (v) {
      if (!v) return '—';
      var d = v instanceof Date ? v : new Date(v);
      if (!d || isNaN(d.getTime())) return '—';
      try {
        return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      } catch (e) { return '—'; }
    },
  };

  /* ----------------------------- 공개 API ----------------------------- */
  window.SD = {
    __guard: true,
    version: '2026-11-27',
    run: run,
    note: note,
    fmt: fmt,
    toNumber: finite,
    flushNow: function () { run('manual-flush', function () { walk(document.body, 8000); }); },
    get logs() { return logs.slice(); },
    get scrubbed() { return scrubbed; },
    get samples() { return samples.slice(); },
  };

  /* ------------------------- ③ 전역 오류 수집 ------------------------- */
  try {
    window.addEventListener('error', function (e) {
      if (e && e.target && e.target.tagName && e.target !== window) {
        // 리소스 로드 실패(img/script) — 화면 오류가 아니므로 참고만 남긴다
        note('resource', (e.target.src || e.target.href || e.target.tagName || '') + '');
        return;
      }
      note('js-error', (e && (e.message || (e.error && e.error.message))) || 'unknown');
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      note('promise', (r && (r.message || r)) || 'unknown');
    });
  } catch (e) { /* noop */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSweep, { once: true });
  } else {
    startSweep();
  }
})();
