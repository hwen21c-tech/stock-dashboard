/* ============================================================
   연오랑 eBook — ☁️ 책갈피·형광펜 클라우드 동기화 (Supabase)
   ─ 포켓몬과 같은 프로젝트·테이블(family_sync)을 쓰되, 행 코드는 'ebook_0623'.
     (포켓몬은 '0623' — 앞에 ebook_ 이 붙어 있어 서로 절대 섞이지 않는다)
   ─ 이 파일이 보는 곳은 localStorage 의 'ebook.v.' 접두사 키뿐이다.
       ebook.v.pos.<책키>   마지막 읽은 위치(책갈피)
       ebook.v.hl.<책키>    형광펜
       ebook.v.mk.<책키>    책갈피 목록
       ebook.v.set          보기 설정(글자 크기·줄 간격·글꼴·배경·1쪽/2쪽)
     값의 모양은 {"at": 밀리초, "d": 실제 데이터} — 기기끼리 '더 최근 것'을 고른다.
     책키는 파일명+용량 기준이라, 폰과 태블릿의 파일 날짜가 달라도 같은 책으로 묶인다.
   ─ 안전장치
       1) 읽던 기록이 하나도 없는 기기(빈 기기)는 자동으로 올리지 않는다
          → 새로 설치한 폰이 태블릿의 기록을 빈 값으로 덮어쓰지 않는다
       2) 한 책의 기록도 '더 최근 at' 일 때만 올린다 (같으면 아무것도 하지 않음)
       3) 페이지를 넘길 때마다가 아니라 0.7초 디바운스로 모아 올리고,
          탭을 숨기거나 닫을 때(keepalive) 밀린 것을 마저 올린다
   ─ 실패(오프라인·키 오류)해도 eBook 은 그대로 동작한다.
   ============================================================ */
(function () {
  'use strict';
  if (window.EBookCloud && window.EBookCloud.version) return;

  var VERSION = '1.0.0';

  /* ---------- 접속 정보 ---------- */
  var DEF = {
    url: 'https://hiruybkapzuhjrzjoyik.supabase.co',
    key: 'sb_publishable_e5JJbvCPDhY91uXaUEVNVA_8Byv_gI8',
    table: 'family_sync',
    code: '0623'
  };
  var K_CODE = 'ebk.cloud.code';
  var K_URL = 'ebk.cloud.url';
  var K_KEY = 'ebk.cloud.key';
  var K_META = 'ebk.cloud.meta';

  var PREFIX = 'ebook.v.';              /* 클라우드로 흘러가는 키 접두사 */
  var DEBOUNCE = 700;                   /* 페이지 넘김 저장을 모아 올리는 간격 */

  function isSyncKey(k) {
    return typeof k === 'string' && k.indexOf(PREFIX) === 0;
  }

  /* ---------- 작은 도구 ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } }
  function jp(raw, d) { if (raw == null) return d; try { var v = JSON.parse(raw); return v == null ? d : v; } catch (e) { return d; } }

  function cfg() {
    return {
      url: (lsGet(K_URL) || DEF.url).replace(/\/+$/, ''),
      key: lsGet(K_KEY) || DEF.key,
      table: DEF.table,
      code: (lsGet(K_CODE) || DEF.code).replace(/[^0-9A-Za-z_]/g, '') || DEF.code
    };
  }
  /* 서버 행 코드 — 포켓몬('0623')과 겹치지 않게 항상 ebook_ 을 붙인다 */
  function rowCode() { return 'ebook_' + cfg().code; }

  function metaLoad() {
    var code = rowCode();
    var m = jp(lsGet(K_META), null);
    if (!m || typeof m !== 'object' || m.code !== code) {
      return { code: code, remoteAt: null, hash: null, lastPushAt: null, lastPullAt: null, lastSyncAt: null };
    }
    return m;
  }
  function metaSave(m) { lsSet(K_META, JSON.stringify(m)); }

  /* ---------- 값 · 해시 ---------- */
  function pv(raw) {
    if (typeof raw !== 'string') return null;
    var v = jp(raw, null);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return { at: Number(v.at) || 0, d: v.d };
  }
  function blankVal(d) {
    if (d == null) return true;
    if (Array.isArray(d)) return d.length === 0;
    if (typeof d === 'object') return Object.keys(d).length === 0;
    return d === '' || d === 0 || d === false;
  }
  function hash(keys) {
    var ks = Object.keys(keys || {}).sort();
    var s = '';
    for (var i = 0; i < ks.length; i++) s += ks[i] + '\u0001' + keys[ks[i]] + '\u0002';
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var j = 0; j < s.length; j++) {
      var c = s.charCodeAt(j);
      h1 = (h1 ^ c) >>> 0; h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + c * (j + 7)) >>> 0; h2 = (h2 * 131) >>> 0;
    }
    return ks.length + ':' + h1.toString(36) + h2.toString(36);
  }
  function collect() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!isSyncKey(k)) continue;
        var v = localStorage.getItem(k);
        if (v != null) out[k] = v;
      }
    } catch (e) { /* */ }
    return out;
  }
  /* 읽던 기록이 실제로 있는가 — 빈 기기 판별 */
  function hasMeaningful(snap) {
    snap = snap || collect();
    for (var k in snap) {
      var v = pv(snap[k]);
      if (!v) continue;
      if (isSampleKey(k)) continue;
      if (!blankVal(v.d)) return true;
    }
    return false;
  }
  function isSampleKey(k) { return k.indexOf('sample-lighthouse') >= 0; }

  /* ---------- 서버(REST) ---------- */
  function headers(extra) {
    var c = cfg();
    var h = { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  function api(path) { var c = cfg(); return c.url + '/rest/v1/' + c.table + path; }

  /* 12초 안에 응답이 없으면 그만 기다린다 — 화면이 '동기화 중'에 갇히지 않게 */
  function guard(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('timeout')); }, ms || 12000);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function req(url, opts, ms) {
    var o = {};
    if (opts) for (var k in opts) o[k] = opts[k];
    var ctl = null;
    try {
      if (window.AbortController) {
        ctl = new AbortController();
        o.signal = ctl.signal;
        setTimeout(function () { try { ctl.abort(); } catch (e) { /* */ } }, (ms || 12000) + 500);
      }
    } catch (e) { /* */ }
    return fetch(url, o);
  }

  function getRow() {
    var code = rowCode();
    return guard(req(api('?code=eq.' + encodeURIComponent(code) + '&select=code,data,updated_at'), {
      headers: headers(), cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return res.json().then(function (arr) {
        if (!Array.isArray(arr) || !arr.length) return null;
        var row = arr[0];
        return { code: row.code, data: row.data || {}, updated_at: row.updated_at || null };
      });
    }), 12000);
  }
  function putRow(payload, keepalive) {
    return guard(req(api('?on_conflict=code'), {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([payload]),
      cache: 'no-store',
      keepalive: !!keepalive
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return true;
    }), 12000);
  }
  function delRow(code) {
    return guard(req(api('?code=eq.' + encodeURIComponent(code)), {
      method: 'DELETE', headers: headers({ Prefer: 'return=minimal' })
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return true;
    }), 12000);
  }
  function errMsg(e) {
    var s = String((e && e.message) || e || '');
    if (/HTTP 401|Invalid API key/i.test(s)) return '키 오류 (401)';
    if (/HTTP 40[34]/.test(s)) return '권한 오류';
    if (/Failed to fetch|NetworkError|load failed|ERR_/i.test(s)) return '인터넷 연결 없음';
    if (/abort|timed? ?out|timeout/i.test(s)) return '인터넷 응답 없음';
    return '동기화 실패';
  }
  function deviceTag() {
    try {
      var u = navigator.userAgent || '';
      if (/iPad|Tablet/i.test(u)) return 'tablet';
      if (/Mobile|Android|iPhone/i.test(u)) return 'phone';
      return 'pc';
    } catch (e) { return 'device'; }
  }

  /* ---------- 상태 · 구독 ---------- */
  var S = { state: 'idle', msg: '', lastAt: null, code: rowCode(), changedAt: 0 };
  var subs = [];
  function emit() {
    S.changedAt = Date.now();
    for (var i = 0; i < subs.length; i++) { try { subs[i](S); } catch (e) { /* */ } }
    try { document.dispatchEvent(new CustomEvent('ebookcloud:state', { detail: S })); } catch (e) { /* */ }
  }
  function setState(st, msg) { S.state = st; S.msg = msg || ''; S.code = rowCode(); emit(); }

  /* ---------- 로컬 반영 ---------- */
  var applying = false;
  var dirty = {};                 /* 이 기기에서 방금 바뀐 키 */
  var dirtyAt = {};
  function applyKey(k, raw) {
    if (!isSyncKey(k) || typeof raw !== 'string') return 0;
    if (lsGet(k) === raw) return 0;
    var keep = applying;
    applying = true;
    try { lsSet(k, raw); } finally { applying = keep; }
    return 1;
  }
  function notifyApplied(n, opts) {
    /* n 이 0 이어도 알린다 — 같은 기기의 다른 탭이 먼저 받아 둔 경우 화면만 늦을 수 있어서 */
    try { document.dispatchEvent(new CustomEvent('ebookcloud:applied', { detail: { count: n, at: Date.now(), quiet: !!(opts && opts.quiet) } })); } catch (e) { /* */ }
  }

  /* ---------- Push ---------- */
  var pushing = false;
  function push(opts) {
    opts = opts || {};
    if (pushing) { pendingAgain = true; return Promise.resolve('busy'); }
    var local = collect();
    if (!opts.force && !hasMeaningful(local)) {
      dirty = {};
      setState('ok', '이 기기는 아직 비어 있어요');
      return Promise.resolve('skip-empty');
    }
    pushing = true;
    setState('syncing', '올리는 중…');
    var startedAt = Date.now();
    return getRow().then(function (row) {
      var remote = (row && row.data && row.data.keys) || {};
      var merged = {}, k, sent = 0, applied = 0;
      for (k in remote) if (typeof remote[k] === 'string') merged[k] = remote[k];
      for (k in local) {
        var L = pv(local[k]);
        if (!L) continue;
        var R = pv(remote[k]);
        if (!R || L.at > R.at + 1) { merged[k] = local[k]; sent++; }
        else if (R.at > L.at + 1 && !dirty[k]) { merged[k] = remote[k]; applied += applyKey(k, remote[k]); }
        /* at 이 같으면 그대로 둔다 — 같은 내용을 다시 쓰지 않는다 */
      }
      var rh = hash(remote), mh = hash(merged);
      var nowIso = new Date().toISOString();
      if (row && rh === mh) {
        var m0 = metaLoad();
        m0.remoteAt = row.updated_at || nowIso;
        m0.hash = rh;
        m0.lastSyncAt = Date.now();
        metaSave(m0);
        clearDirtySince(startedAt);
        S.lastAt = Date.now();
        notifyApplied(applied);
        setState('ok', '이미 같아요');
        return 'same';
      }
      var payload = {
        code: rowCode(),
        data: { v: 1, keys: merged, pushedAt: nowIso, device: deviceTag() },
        updated_at: nowIso
      };
      return putRow(payload, !!opts.keepalive).then(function () {
        var m = metaLoad();
        m.remoteAt = nowIso;
        m.hash = mh;
        m.lastPushAt = Date.now();
        m.lastSyncAt = Date.now();
        metaSave(m);
        clearDirtySince(startedAt);
        S.lastAt = Date.now();
        notifyApplied(applied);
        setState('ok', '올렸어요 (' + sent + '개)');
        try { if (bc) bc.postMessage({ t: 'pushed', code: rowCode() }); } catch (e) { /* */ }
        return 'pushed';
      });
    }).catch(function (e) {
      setState('error', errMsg(e));
      return 'error';
    }).then(function (r) {
      pushing = false;
      /* 올리는 동안 또 바뀌었으면 한 번 더 (디바운스 사이에 끼인 변경을 잃지 않게) */
      if (r !== 'error' && (pendingAgain || Object.keys(dirty).length)) { pendingAgain = false; schedulePush(); }
      return r;
    });
  }
  function clearDirtySince(ts) {
    /* 올리기 시작 뒤에 또 바뀐 키는 남긴다 — 다음 차례에 다시 올린다 */
    for (var k in dirty) { if ((dirtyAt[k] || 0) <= ts) delete dirty[k]; }
  }

  /* ---------- Pull ---------- */
  var pulling = false;
  function pull(opts) {
    opts = opts || {};
    if (pulling) return Promise.resolve('busy');
    pulling = true;
    setState('syncing', '받는 중…');
    return getRow().then(function (row) {
      if (!row) {
        var m0 = metaLoad();
        if (m0.remoteAt || m0.hash) { m0.remoteAt = null; m0.hash = null; metaSave(m0); }
        setState('empty', '클라우드에 아직 없어요');
        return 'noRow';
      }
      var remote = (row.data && row.data.keys) || {};
      var local = collect();
      var changed = 0, k;
      for (k in remote) {        if (!isSyncKey(k)) continue;
        var R = pv(remote[k]);
        if (!R) continue;
        var L = pv(local[k]);
        if (!opts.force) {
          if (L && L.at >= R.at) continue;                  /* 이 기기가 더 최근 */
          if (dirty[k] && Date.now() - (dirtyAt[k] || 0) < 6000) continue;  /* 방금 사용자가 만진 것 */
        }
        changed += applyKey(k, remote[k]);
      }
      var m = metaLoad();
      m.remoteAt = row.updated_at || new Date().toISOString();
      m.hash = hash(remote);
      m.lastPullAt = Date.now();
      if (changed) m.lastSyncAt = Date.now();
      metaSave(m);
      if (changed) S.lastAt = Date.now();
      setState('ok', changed ? ('받았어요 (' + changed + '개)') : '이미 같아요');
      notifyApplied(changed, opts);
      return changed ? 'applied' : 'upToDate';
    }).catch(function (e) {
      setState('error', errMsg(e));
      return 'error';
    }).then(function (r) { pulling = false; return r; });
  }

  /* ---------- 자동 저장 훅 ---------- */
  var tPush = null;
  var pendingAgain = false;
  function schedulePush() {
    if (tPush) clearTimeout(tPush);
    tPush = setTimeout(function () { tPush = null; push(); }, 400);
  }
  function markDirty(k) {
    dirty[k] = 1;
    dirtyAt[k] = Date.now();
    if (tPush) clearTimeout(tPush);
    tPush = setTimeout(function () { tPush = null; push(); }, DEBOUNCE);
  }
  function flush(keepalive) {
    if (tPush) { clearTimeout(tPush); tPush = null; }
    if (!hasMeaningful()) return Promise.resolve('skip-empty');
    return push({ keepalive: !!keepalive });
  }
  function installHook() {
    if (window.__ebkSyncHooked) return;
    window.__ebkSyncHooked = true;
    try {
      var proto = Storage.prototype;
      var orig = proto.setItem;
      proto.setItem = function (k, v) {
        var r = orig.apply(this, arguments);
        try {
          if (this === window.localStorage && !applying && isSyncKey(String(k))) markDirty(String(k));
        } catch (e) { /* */ }
        return r;
      };
    } catch (e) { /* 훅을 못 걸어도 수동 동기화로 동작한다 */ }
  }

  /* ---------- 주기 점검 ---------- */
  var bc = null;
  try { if (window.BroadcastChannel) bc = new BroadcastChannel('ebook-cloud'); } catch (e) { bc = null; }

  var lastAuto = 0;
  function autoPull(minGapMs) {
    if (document.hidden) return;
    if (Date.now() - lastAuto < (minGapMs || 0)) return;
    lastAuto = Date.now();
    pull({ quiet: true });
  }

  var readyP = null;
  /* 첫 화면을 열기 전에 클라우드를 한 번 받아 둔다 (최대 ms 초까지만 기다린다) */
  function ready(ms) {
    if (readyP) return readyP;
    var to = new Promise(function (res) { setTimeout(res, Math.max(300, ms || 1800)); });
    readyP = Promise.race([pull({ quiet: true }).then(function (r) {
      if (r === 'noRow') return push();     /* 클라우드가 비었고 이 기기에 기록이 있으면 올린다 */
      return r;
    }), to]).catch(function () { return 'error'; }).then(function (r) { return r; });
    return readyP;
  }

  /* ---------- UI ---------- */
  var CSS = [
    '.ebk-row-btn{display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;margin:0 0 12px;',
    'border:1px solid var(--btn-line);border-radius:11px;background:var(--btn);color:var(--fg);',
    'font:inherit;font-size:12px;font-weight:800;letter-spacing:-.2px;cursor:pointer;text-align:left}',
    '.ebk-row-btn:active{transform:scale(.99)}',
    '.ebk-row-btn .ci{font-size:14px;line-height:1;flex:0 0 auto}',
    '.ebk-row-btn .lb{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ebk-row-btn .cd{color:var(--accent);font-weight:900}',
    '.ebk-row-btn .st{flex:0 0 auto;font-size:10.5px;font-weight:800;color:var(--muted);max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ebk-row-btn .dot{flex:0 0 7px;width:7px;height:7px;border-radius:50%;background:#9ec97a}',
    '.ebk-row-btn[data-s="syncing"] .dot{background:#ffb300;animation:ebkPulse 1s infinite}',
    '.ebk-row-btn[data-s="ok"] .dot{background:#2fbf4a}',
    '.ebk-row-btn[data-s="error"] .dot{background:#e0473a}',
    '.ebk-row-btn[data-s="empty"] .dot{background:#c9c9b8}',
    '@keyframes ebkPulse{0%,100%{opacity:.35}50%{opacity:1}}',
    '.ebk-modal{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.45);',
    '-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}',
    '.ebk-modal[hidden]{display:none}',
    '.ebk-sheet{width:min(400px,100%);max-height:84dvh;overflow:auto;border-radius:16px;background:var(--sheet);',
    'color:var(--sheet-fg);box-shadow:0 12px 34px rgba(0,0,0,.35);border:1px solid var(--line)}',
    '.ebk-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--sheet);border-radius:16px 16px 0 0}',
    '.ebk-head h2{flex:1 1 auto;margin:0;font-size:13.5px;font-weight:900;letter-spacing:-.2px}',
    '.ebk-x{width:28px;height:28px;flex:0 0 28px;border-radius:50%;border:1px solid var(--btn-line);background:var(--btn);color:var(--muted);font-size:13px;font-weight:900;cursor:pointer}',
    '.ebk-body{padding:12px 14px 16px;font-size:12px;line-height:1.6}',
    '.ebk-line{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed var(--line)}',
    '.ebk-line:last-of-type{border-bottom:0}',
    '.ebk-line .k{color:var(--muted);font-weight:800;flex:1 1 auto;min-width:0}',
    '.ebk-line .v{font-weight:900;text-align:right;overflow-wrap:anywhere}',
    '.ebk-line .v.code{color:var(--accent);letter-spacing:.02em}',
    '.ebk-note{margin:10px 0 0;font-size:11px;color:var(--muted);line-height:1.65;font-weight:700}',
    '.ebk-btns{display:flex;flex-direction:column;gap:8px;margin:12px 0 0}',
    '.ebk-btn{width:100%;padding:11px 10px;border-radius:12px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:900;',
    'letter-spacing:-.2px;background:var(--accent);border:1px solid var(--accent);color:#fff}',
    '.ebk-btn:active{transform:translateY(1px)}',
    '.ebk-btn.ghost{background:var(--btn);border-color:var(--btn-line);color:var(--fg)}',
    '.ebk-btn:disabled{opacity:.55}',
    '.ebk-msg{margin:9px 0 0;min-height:15px;font-size:11px;font-weight:800;color:var(--muted)}',
    '.ebk-msg.bad{color:#e0473a}',
    '.ebk-adv{margin-top:12px}',
    '.ebk-adv summary{cursor:pointer;font-size:11px;font-weight:800;color:var(--muted);padding:6px 0}',
    '.ebk-in{width:100%;padding:9px 11px;border-radius:10px;border:1px solid var(--btn-line);background:var(--btn);',
    'color:var(--fg);font:inherit;font-size:12px;font-weight:800}',
    '.ebk-in.lbl{margin:8px 0 4px;color:var(--muted);font-size:11px;font-weight:800;background:none;border:0;padding:0}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('ebkCss')) return;
    var s = document.createElement('style');
    s.id = 'ebkCss';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmtTime(t) {
    if (!t) return '아직 없음';
    try {
      var d = new Date(t);
      var k = new Date(d.getTime() + 9 * 3600 * 1000);
      var hh = k.getUTCHours(), mm = k.getUTCMinutes();
      var ap = hh < 12 ? '오전' : '오후';
      var h12 = hh % 12; if (h12 === 0) h12 = 12;
      var same = (function () {
        var n = new Date(Date.now() + 9 * 3600 * 1000);
        return n.getUTCFullYear() === k.getUTCFullYear() && n.getUTCMonth() === k.getUTCMonth() && n.getUTCDate() === k.getUTCDate();
      })();
      return (same ? '오늘 ' : '') + ap + ' ' + h12 + ':' + String(mm).padStart(2, '0');
    } catch (e) { return '—'; }
  }
  function statusText(s) {
    if (s.state === 'syncing') return '동기화 중…';
    if (s.state === 'error') return s.msg || '오류';
    if (s.state === 'empty') return '아직 비었어요';
    if (s.state === 'ok' && s.lastAt) return fmtTime(s.lastAt) + ' 동기화';
    if (s.msg) return s.msg;
    return '자동 동기화';
  }

  var rowEl = null;
  function mountRow() {
    injectCSS();
    var slot = document.getElementById('cloudSlot');
    if (!slot || rowEl) return;
    rowEl = el('button', 'ebk-row-btn');
    rowEl.type = 'button';
    rowEl.innerHTML = '<span class="ci">☁️</span><span class="lb">책갈피 동기화 <span class="cd"></span></span>' +
      '<span class="st"></span><span class="dot"></span>';
    rowEl.addEventListener('click', openModal);
    slot.appendChild(rowEl);
    paintRow();
  }
  function paintRow() {
    if (!rowEl) return;
    rowEl.setAttribute('data-s', S.state);
    var cd = rowEl.querySelector('.cd');
    if (cd) cd.textContent = '(' + cfg().code + ')';
    var st = rowEl.querySelector('.st');
    if (st) st.textContent = statusText(S);
    rowEl.setAttribute('aria-label', '책갈피 동기화 ' + cfg().code + ' · ' + statusText(S));
  }

  /* ---------- 모달 ---------- */
  var modalEl = null, bodyEl = null;
  function buildModal() {
    var m = el('div', 'ebk-modal');
    m.hidden = true;
    m.innerHTML =
      '<div class="ebk-sheet" role="dialog" aria-modal="true" aria-labelledby="ebkTitle">' +
      '<div class="ebk-head"><h2 id="ebkTitle">☁️ 책갈피 동기화</h2><button class="ebk-x" type="button" aria-label="닫기">✕</button></div>' +
      '<div class="ebk-body"></div></div>';
    bodyEl = m.querySelector('.ebk-body');
    m.querySelector('.ebk-x').addEventListener('click', closeModal);
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    return m;
  }
  function openModal() {
    injectCSS();
    if (!modalEl) modalEl = buildModal();
    document.body.appendChild(modalEl);
    modalEl.hidden = false;
    renderMain();
  }
  function closeModal() { if (modalEl) modalEl.hidden = true; }
  function msg(t, bad) {
    var e = bodyEl && bodyEl.querySelector('.ebk-msg');
    if (!e) return;
    e.textContent = t || '';
    e.className = 'ebk-msg' + (bad ? ' bad' : '');
  }
  function renderMain() {
    var c = cfg();
    var m = metaLoad();
    var snap = collect();
    var nBooks = 0, nHl = 0, nMk = 0;
    for (var k in snap) {
      var v = pv(snap[k]);
      if (!v || isSampleKey(k)) continue;
      if (k.indexOf(PREFIX + 'pos.') === 0) nBooks++;
      else if (k.indexOf(PREFIX + 'hl.') === 0) nHl += (v.d && typeof v.d === 'object') ? Object.keys(v.d).length : 0;
      else if (k.indexOf(PREFIX + 'mk.') === 0) nMk += Array.isArray(v.d) ? v.d.length : 0;
    }
    bodyEl.innerHTML =
      '<div class="ebk-line"><span class="k">가족 코드</span><span class="v code">' + esc(c.code) + '</span></div>' +
      '<div class="ebk-line"><span class="k">상태</span><span class="v">' + esc(statusText(S)) + '</span></div>' +
      '<div class="ebk-line"><span class="k">마지막 동기화</span><span class="v">' + esc(fmtTime(m.lastSyncAt || S.lastAt)) + '</span></div>' +
      '<div class="ebk-line"><span class="k">이 기기에 있는 기록</span><span class="v">' + nBooks + '권 · 형광펜 ' + nHl + ' · 책갈피 ' + nMk + '</span></div>' +
      '<p class="ebk-note">같은 코드를 쓰는 폰·태블릿은 <b>마지막 읽은 페이지 · 형광펜 · 보기 설정</b>이 자동으로 맞춰집니다.<br>' +
      '읽던 기록이 없는 새 기기는 클라우드를 빈 값으로 덮지 않아요. 책 파일 자체는 기기 서재에만 있습니다.</p>' +
      '<div class="ebk-msg"></div>' +
      '<div class="ebk-btns">' +
      '<button class="ebk-btn" type="button" data-a="push">☁️ 지금 올리기</button>' +
      '<button class="ebk-btn ghost" type="button" data-a="pull">⬇️ 지금 받기</button>' +
      '</div>' +
      '<details class="ebk-adv"><summary>⚙️ 고급 (가족 코드 · 서버 주소)</summary>' +
      '<div class="ebk-in lbl">가족 코드 (숫자)</div><input class="ebk-in" id="ebkCode" inputmode="numeric" maxlength="12" value="' + esc(c.code) + '">' +
      '<div class="ebk-in lbl">Supabase 공개 키</div><input class="ebk-in" id="ebkKey" spellcheck="false" value="' + esc(c.key) + '">' +
      '<div class="ebk-btns"><button class="ebk-btn ghost" type="button" data-a="save">저장</button></div>' +
      '</details>';
    wiring();
  }
  function wiring() {
    var p = bodyEl.querySelector('[data-a="push"]');
    if (p) p.addEventListener('click', function () {
      p.disabled = true; msg('올리는 중…');
      push({}).then(function (r) {
        p.disabled = false;
        if (r === 'pushed') { msg('클라우드에 올렸어요 ✔'); renderMain(); }
        else if (r === 'skip-empty') msg('이 기기에 올릴 읽기 기록이 아직 없어요', true);
        else if (r === 'same') msg('이미 클라우드와 같아요');
        else if (r === 'error') msg(S.msg || '실패했어요', true);
        else renderMain();
      });
    });
    var q = bodyEl.querySelector('[data-a="pull"]');
    if (q) q.addEventListener('click', function () {
      q.disabled = true; msg('받는 중…');
      pull({ force: true }).then(function (r) {
        q.disabled = false;
        if (r === 'applied') { msg('받았어요 · 화면에 반영했습니다'); }
        else if (r === 'upToDate') msg('이미 최신이에요');
        else if (r === 'noRow') msg('클라우드에 아직 내용이 없어요', true);
        else msg(S.msg || '실패했어요', true);
      });
    });
    var sv = bodyEl.querySelector('[data-a="save"]');
    if (sv) sv.addEventListener('click', function () {
      var nc = (bodyEl.querySelector('#ebkCode').value || '').replace(/[^0-9A-Za-z_]/g, '');
      var nk = (bodyEl.querySelector('#ebkKey').value || '').trim();
      if (!nc) { msg('코드를 넣어 주세요', true); return; }
      lsSet(K_CODE, nc);
      if (nk) lsSet(K_KEY, nk); else lsDel(K_KEY);
      lsDel(K_META);
      readyP = null;
      msg('저장했어요 · 다시 연결합니다');
      pull({ quiet: true }).then(function (r) { if (r === 'noRow') push(); renderMain(); paintRow(); });
    });
  }

  /* ---------- 부팅 ---------- */
  function boot() {
    installHook();
    try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountRow); else mountRow(); } catch (e) { /* */ }
    subs.push(paintRow);
    S.code = rowCode();
  }

  if (typeof document !== 'undefined') {
    boot();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) flush(true);          /* 탭을 숨기면 밀린 저장을 마저 올린다(keepalive) */
      else autoPull(15000);
    });
    window.addEventListener('pagehide', function () { flush(true); });
    window.addEventListener('online', function () { autoPull(1000); });
    setInterval(function () { autoPull(90000); }, 30000);
    if (bc) bc.onmessage = function (e) {
      if (e && e.data && e.data.t === 'pushed' && e.data.code === rowCode()) autoPull(1000);
    };
  }

  window.EBookCloud = {
    version: VERSION,
    ready: ready,
    pull: pull,
    push: push,
    flush: flush,
    state: function () { return S; },
    cfg: cfg,
    rowCode: rowCode,
    isSyncKey: isSyncKey,
    collect: collect,
    hasMeaningful: hasMeaningful,
    setCode: function (c) {
      var n = String(c || '').replace(/[^0-9A-Za-z_]/g, '');
      if (n) lsSet(K_CODE, n); else lsDel(K_CODE);
      lsDel(K_META); readyP = null; S.code = rowCode(); paintRow(); emit();
    },
    open: openModal,
    close: closeModal,
    paint: paintRow,
    getRow: getRow,
    deleteRow: delRow,
    debug: function () {
      return { cfg: cfg(), row: rowCode(), meta: metaLoad(), state: S, keys: Object.keys(collect()) };
    }
  };
})();
