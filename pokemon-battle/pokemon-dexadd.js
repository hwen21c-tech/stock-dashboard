/* ============================================================
   포켓몬 배틀 월드 — ➕ 아빠 권한 '포켓몬 추가(생기게 하기)'
   ─ 아빠 잠금(PIN)이 풀려 있을 때만 도감 화면에 ➕ 버튼이 보인다.
   ─ 이름이나 도감번호(1~1025)로 찾고, 마리수·자리(아린·지안·게스트)를 골라
     통합 도감(pkm.shared.dex.v1.<slot>)에 넣는다.
       · ids 에 추가 · counts 증가 · dates 오늘 · caughtAt 지금
       · 🗑 지운 기록(removed)이 있으면 지운다 — 다시 살아나게 한다
   ─ 저장하면 pokemon-sync.js 가 곧바로 클라우드로 올린다(PkmSync.push + 저장 훅).
   ─ 쓰는 화면: pokemon-battle · math · hangul · english · village
   ============================================================ */
(function () {
  'use strict';
  if (window.PkmDexAdd && window.PkmDexAdd.version) return;

  var VERSION = '1.0.0';
  var PREFIX = 'pkm.shared.dex.v1.';
  var PROF_KEYS = { math: 'mpb.profiles.v1', english: 'epb.profiles.v1', hangul: 'hpb.profiles.v1' };
  var SLOT_ORDER = ['p1', 'p2', 'guest'];
  var SLOT_FALLBACK = { p1: '첫째', p2: '둘째', guest: '게스트' };
  var SLOT_EMOJI = { p1: '👧', p2: '🧒', guest: '🧪' };
  var SUBJECT = 'admin';
  var DB = null;
  var dbPromise = null;
  var el = null;          /* 모달 루트 */
  var bindings = [];      /* { button, isUnlocked, getSlot, onDone } */
  var UI = { slot: 'p1', pick: null, hits: [], n: 1, msgT: 0 };

  function ls(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
  function jp(raw, d) { if (raw == null) return d; try { var v = JSON.parse(raw); return v == null ? d : v; } catch (e) { return d; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function kstToday() {
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  /* ---------- 자리(슬롯) 이름 — 산수·영어·한글 프로필에서 실제 이름을 찾는다 ---------- */
  function nameFromName(name) {
    var n = String(name || '');
    if (/게스트|guest|테스트/i.test(n)) return 'guest';
    if (/첫째|아린/.test(n)) return 'p1';
    if (/둘째|지안/.test(n)) return 'p2';
    return '';
  }
  function slotName(slot) {
    var want = slot === 'guest' ? 'p3' : slot === 'p2' ? 'p2' : 'p1';
    var games = ['math', 'english', 'hangul'];
    for (var i = 0; i < games.length; i += 1) {
      var o = jp(ls(PROF_KEYS[games[i]], null), null);
      var list = (o && Array.isArray(o.list)) ? o.list : [];
      for (var k = 0; k < list.length; k += 1) {
        var p = list[k];
        if (p && p.id === want && p.name) return String(p.name).slice(0, 8);
      }
    }
    return SLOT_FALLBACK[slot] || '친구';
  }

  /* ---------- 도감 저장소 ---------- */
  function readDex(slot) {
    var o = jp(ls(PREFIX + slot, null), null) || {};
    return {
      ids: (Array.isArray(o.ids) ? o.ids : []).filter(function (n) { return Number.isFinite(n); }),
      counts: (o.counts && typeof o.counts === 'object') ? o.counts : {},
      dates: (o.dates && typeof o.dates === 'object') ? o.dates : {},
      subjects: (o.subjects && typeof o.subjects === 'object') ? o.subjects : {},
      removed: (o.removed && typeof o.removed === 'object') ? o.removed : {},
      caughtAt: (o.caughtAt && typeof o.caughtAt === 'object') ? o.caughtAt : {},
      resetAt: Number(o.resetAt) || 0
    };
  }
  /* 한 마리(또는 n마리)를 도감에 '생기게' 한다 — 지운 기록이 있으면 지운다 */
  function addMon(slot, id, n) {
    var num = Number(id);
    var cnt = Math.max(1, Math.min(99, Number(n) || 1));
    var dex = readDex(slot);
    var at = dex.ids.indexOf(num);
    if (at < 0) dex.ids.push(num);
    var key = String(num);
    dex.counts[key] = Math.max(1, (Number(dex.counts[key]) || 0) + cnt);
    if (!dex.dates[key]) dex.dates[key] = kstToday();
    if (!Array.isArray(dex.subjects[key]) || !dex.subjects[key].length) dex.subjects[key] = [SUBJECT];
    delete dex.removed[key];                 /* 🗑 지웠던 기록을 지운다 — 이제 살아 있다 */
    dex.caughtAt[key] = Date.now();
    var out = { ids: dex.ids, counts: dex.counts, dates: dex.dates, subjects: dex.subjects, v: 1 };
    if (Object.keys(dex.removed).length) out.removed = dex.removed;
    if (Object.keys(dex.caughtAt).length) out.caughtAt = dex.caughtAt;
    if (dex.resetAt > 0) out.resetAt = dex.resetAt;
    lsSet(PREFIX + slot, JSON.stringify(out));
    /* ☁️ 곧바로 클라우드로 — 저장 훅(500ms)을 기다리지 않고 한 번 밀어 올린다 */
    try { if (window.PkmSync && typeof PkmSync.push === 'function') { var r = PkmSync.push(); if (r && r.catch) r.catch(function () { /* */ }); } } catch (e) { /* */ }
    try { document.dispatchEvent(new CustomEvent('pkmdex:change', { detail: { slot: slot, id: num, count: cnt } })); } catch (e) { /* */ }
    return { slot: slot, id: num, count: cnt, ids: dex.ids.length };
  }

  /* ---------- 도감 목록(이름·번호) ---------- */
  function loadDB() {
    if (dbPromise) return dbPromise;
    dbPromise = fetch('./pokemon-db.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        DB = (Array.isArray(list) ? list : []).filter(function (p) { return p && Number.isFinite(p.id); });
        return DB;
      })
      .catch(function () { DB = []; return DB; });
    return dbPromise;
  }
  function spr(id) { return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + id + '.png'; }
  function art(id) { return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/' + id + '.png'; }
  function num3(p) { return String((p && (p.num || p.id)) || '').padStart(3, '0'); }
  function titleOf(p) { return (p && (p.short || p.name)) || '포켓몬'; }

  function search(q) {
    var s = String(q || '').trim();
    if (!s || !DB) return [];
    var hits = [];
    if (/^\d{1,4}$/.test(s)) {
      var n = Number(s);
      hits = DB.filter(function (p) { return Number(p.num) === n || Number(p.id) === n; });
      /* 번호로 찾으면 대표(원본) 폼을 먼저 */
      hits.sort(function (a, b) { return (a.form ? 1 : 0) - (b.form ? 1 : 0) || a.id - b.id; });
    } else {
      var low = s.toLowerCase();
      hits = DB.filter(function (p) {
        var nm = String(p.name || '').toLowerCase();
        var sh = String(p.short || '').toLowerCase();
        return nm.indexOf(low) >= 0 || (sh && sh.indexOf(low) >= 0);
      });
      hits.sort(function (a, b) { return (a.form ? 1 : 0) - (b.form ? 1 : 0) || Number(a.num) - Number(b.num); });
    }
    return hits.slice(0, 12);
  }

  /* ---------- 화면 ---------- */
  var CSS = [
    '.pkda{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:flex-end;justify-content:center;background:rgba(18,38,14,.55);padding:0;',
    'font-family:"Apple SD Gothic Neo","Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif;overscroll-behavior:contain}',
    '.pkda[hidden]{display:none}',
    '.pkda .pkda-sheet{position:relative;width:min(520px,100%);max-height:92vh;overflow:auto;background:linear-gradient(180deg,#fffdf3,#f3ffe4);',
    'border:3px solid #cfe6a6;border-radius:22px 22px 0 0;box-shadow:0 -13px 34px rgba(20,60,10,.35);padding:14px 14px 16px;color:#2f4a16}',
    '@media(min-width:560px){.pkda{align-items:center}.pkda .pkda-sheet{border-radius:22px}}',
    '.pkda-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px}',
    '.pkda-h h2{margin:0;font-size:16px;font-weight:900;letter-spacing:-.03em}',
    '.pkda-h h2 small{display:block;font-size:10.5px;font-weight:800;color:#7d8a63;letter-spacing:0;margin-top:2px}',
    '.pkda-x{width:32px;height:32px;flex:0 0 32px;border-radius:50%;border:2px solid #dbe7c2;background:#fff;color:#5c7a34;font-weight:900;font-size:15px}',
    '.pkda-lb{display:flex;align-items:center;gap:6px;margin:10px 0 5px;font-size:11px;font-weight:900;color:#6b8547}',
    '.pkda-in{width:100%;box-sizing:border-box;height:42px;border-radius:13px;border:2px solid #d6e7b8;background:#fff;padding:0 12px;font-size:14px;font-weight:800;color:#2f4a16}',
    '.pkda-in:focus{outline:none;border-color:#8fd06a;box-shadow:0 0 0 3px rgba(143,208,106,.25)}',
    '.pkda-hits{display:flex;flex-direction:column;gap:6px;margin-top:8px;max-height:196px;overflow:auto}',
    '.pkda-hit{display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:7px 9px;border-radius:13px;border:2px solid #e2eecd;background:#fff;color:#2f4a16;font-weight:800;font-size:13px}',
    '.pkda-hit.on{border-color:#5cb82b;background:#f0ffdd}',
    '.pkda-hit img{width:34px;height:34px;object-fit:contain;image-rendering:pixelated}',
    '.pkda-hit b{font-weight:900}',
    '.pkda-hit span{font-size:10.5px;font-weight:800;color:#8b9673}',
    '.pkda-none{margin:6px 0 0;font-size:11.5px;font-weight:800;color:#a08b6b}',
    '.pkda-pick{display:flex;align-items:center;gap:12px;margin-top:10px;padding:10px;border-radius:16px;border:2px dashed #cde3a4;background:#f8ffef}',
    '.pkda-pick[hidden]{display:none}',
    '.pkda-pick .pkda-art{width:74px;height:74px;flex:0 0 74px;border-radius:14px;background:radial-gradient(60% 60% at 50% 45%,#e8ffd0,#f7ffe9);display:flex;align-items:center;justify-content:center}',
    '.pkda-pick .pkda-art img{width:66px;height:66px;object-fit:contain}',
    '.pkda-pick .pkda-who{min-width:0}',
    '.pkda-pick .pkda-who b{display:block;font-size:15px;font-weight:900;letter-spacing:-.02em}',
    '.pkda-pick .pkda-who span{display:block;font-size:10.5px;font-weight:800;color:#7d8a63;margin-top:2px}',
    '.pkda-row{display:flex;gap:8px}',
    '.pkda-row>*{flex:1;min-width:0}',
    '.pkda-slots{display:flex;gap:7px;flex-wrap:wrap}',
    '.pkda-slot{flex:1;min-width:88px;height:42px;border-radius:13px;border:2px solid #dbe7c2;background:#fff;color:#4d6b2a;font-weight:900;font-size:12.5px}',
    '.pkda-slot.on{border-color:#5cb82b;background:linear-gradient(180deg,#eaffcc,#d5f7ae);color:#2f4a16;box-shadow:0 2px 0 rgba(70,120,30,.25)}',
    '.pkda-step{display:flex;align-items:center;gap:8px}',
    '.pkda-step button{width:42px;height:42px;flex:0 0 42px;border-radius:13px;border:2px solid #dbe7c2;background:#fff;color:#2f4a16;font-size:19px;font-weight:900}',
    '.pkda-step input{flex:1;text-align:center;font-size:16px;font-weight:900}',
    '.pkda-go{width:100%;margin-top:14px;height:48px;border-radius:15px;border:none;background:linear-gradient(180deg,#7ae04f,#3fb422);color:#fff;font-size:15px;font-weight:900;letter-spacing:-.02em;box-shadow:0 4px 0 rgba(40,110,20,.35)}',
    '.pkda-go:disabled{background:#dfe8d2;box-shadow:none;color:#9dae86}',
    '.pkda-go:active{transform:translateY(2px);box-shadow:0 2px 0 rgba(40,110,20,.35)}',
    '.pkda-msg{margin:9px 0 0;min-height:15px;font-size:11.5px;font-weight:900;color:#5c7a34;text-align:center}',
    '.pkda-msg.bad{color:#c0392b}',
    '.pkda-note{margin:9px 0 0;font-size:10px;font-weight:800;color:#93a87a;text-align:center;line-height:1.5}',
    '.pkda-toast{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%) translateY(14px);z-index:2147482500;',
    'max-width:min(420px,92vw);padding:11px 15px;border-radius:14px;background:rgba(30,58,20,.94);color:#f3ffe6;font-size:12.5px;font-weight:900;text-align:center;',
    'box-shadow:0 10px 26px rgba(15,40,8,.4);opacity:0;transition:opacity .18s ease,transform .18s ease;pointer-events:none;line-height:1.45}',
    '.pkda-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('pkdaStyle')) return;
    var st = document.createElement('style');
    st.id = 'pkdaStyle';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  var toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'pkda-toast';
      toastEl.setAttribute('role', 'status');
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 2200);
  }

  function build() {
    injectCSS();
    var box = document.createElement('div');
    box.className = 'pkda';
    box.id = 'pkdaModal';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'pkdaTitle');
    box.innerHTML =
      '<div class="pkda-sheet">'
      + '<div class="pkda-h"><h2 id="pkdaTitle">➕ 포켓몬 추가 <small>아빠 권한 · 도감에 생기게 하기</small></h2>'
      + '<button type="button" class="pkda-x" data-a="close" aria-label="닫기">✕</button></div>'
      + '<div class="pkda-lb">🔎 이름 또는 도감번호</div>'
      + '<input class="pkda-in" id="pkdaQ" type="text" inputmode="search" autocomplete="off" placeholder="예) 카스쿤 · 268 · 피카츄">'
      + '<div class="pkda-hits" id="pkdaHits"></div>'
      + '<p class="pkda-none" id="pkdaNone" hidden>찾는 친구가 없어요 — 이름이나 1~1025 번호로 다시 써 보세요</p>'
      + '<div class="pkda-pick" id="pkdaPick" hidden>'
      + '<div class="pkda-art"><img id="pkdaArt" alt="" decoding="async"></div>'
      + '<div class="pkda-who"><b id="pkdaName">—</b><span id="pkdaMeta">—</span></div>'
      + '</div>'
      + '<div class="pkda-row">'
      + '<div><div class="pkda-lb">🐾 마리수</div><div class="pkda-step">'
      + '<button type="button" data-a="minus" aria-label="한 마리 줄이기">−</button>'
      + '<input class="pkda-in" id="pkdaN" type="text" inputmode="numeric" value="1" aria-label="마리수">'
      + '<button type="button" data-a="plus" aria-label="한 마리 늘리기">+</button>'
      + '</div></div>'
      + '</div>'
      + '<div class="pkda-lb">👧 누구 도감에 넣을까요</div>'
      + '<div class="pkda-slots" id="pkdaSlots"></div>'
      + '<button type="button" class="pkda-go" id="pkdaGo" disabled>➕ 도감에 추가</button>'
      + '<p class="pkda-msg" id="pkdaMsg">이름이나 번호로 찾고, 자리를 골라 주세요</p>'
      + '<p class="pkda-note">넣은 포켓몬은 산수·한글·영어·마을이 함께 쓰는 통합 도감에 바로 생기고,<br>가족 클라우드에도 곧바로 올라가 다른 기기에도 나타나요.</p>'
      + '</div>';

    box.addEventListener('click', function (e) {
      if (e.target === box) { close(); return; }
      var b = e.target.closest ? e.target.closest('[data-a]') : null;
      if (!b) {
        var hit = e.target.closest ? e.target.closest('.pkda-hit') : null;
        if (hit) pick(Number(hit.dataset.id));
        return;
      }
      var a = b.dataset.a;
      if (a === 'close') close();
      else if (a === 'plus') setN(UI.n + 1);
      else if (a === 'minus') setN(UI.n - 1);
      else if (a === 'slot') { UI.slot = b.dataset.slot; paintSlots(); }
    });
    box.addEventListener('input', function (e) {
      if (e.target.id === 'pkdaQ') onQuery(e.target.value);
      else if (e.target.id === 'pkdaN') { UI.n = clampN(e.target.value); }
    });
    box.addEventListener('keydown', function (e) {
      if (e.target.id === 'pkdaQ' && e.key === 'Enter') {
        e.preventDefault();
        if (UI.hits.length) pick(Number(UI.hits[0].id));
      } else if (e.target.id === 'pkdaN' && e.key === 'Enter') {
        e.preventDefault();
        if (UI.pick) commit();
      }
    });
    var goBtn = box.querySelector('#pkdaGo');
    if (goBtn) goBtn.addEventListener('click', function (e) { e.preventDefault(); commit(); });
    var root = document.body || document.documentElement;
    root.appendChild(box);
    el = box;
  }

  function clampN(v) {
    var n = parseInt(String(v || '').replace(/[^\d]/g, ''), 10);
    if (!isFinite(n) || n < 1) n = 1;
    if (n > 99) n = 99;
    return n;
  }
  function setN(n) {
    UI.n = clampN(n);
    var inp = document.getElementById('pkdaN');
    if (inp) inp.value = String(UI.n);
  }
  function msg(text, bad) {
    var m = document.getElementById('pkdaMsg');
    if (!m) return;
    m.className = 'pkda-msg' + (bad ? ' bad' : '');
    m.textContent = text || ' ';
  }
  function paintSlots() {
    var host = document.getElementById('pkdaSlots');
    if (!host) return;
    host.innerHTML = SLOT_ORDER.map(function (s) {
      return '<button type="button" class="pkda-slot' + (s === UI.slot ? ' on' : '') + '" data-a="slot" data-slot="' + s + '"'
        + ' aria-pressed="' + (s === UI.slot ? 'true' : 'false') + '">' + SLOT_EMOJI[s] + ' ' + esc(slotName(s)) + '</button>';
    }).join('');
  }
  function paintHits() {
    var host = document.getElementById('pkdaHits');
    var none = document.getElementById('pkdaNone');
    if (!host) return;
    host.innerHTML = UI.hits.map(function (p) {
      var on = UI.pick && UI.pick.id === p.id;
      return '<button type="button" class="pkda-hit' + (on ? ' on' : '') + '" data-id="' + p.id + '">'
        + '<img src="' + spr(p.id) + '" alt="" loading="lazy" decoding="async">'
        + '<b>#' + num3(p) + ' ' + esc(titleOf(p)) + '</b>'
        + '<span>' + esc((p.types || []).join('·')) + '</span></button>';
    }).join('');
    if (none) none.hidden = !(UI.hits.length === 0 && String((document.getElementById('pkdaQ') || {}).value || '').trim());
  }
  function paintPick() {
    var box = document.getElementById('pkdaPick');
    var img = document.getElementById('pkdaArt');
    var nm = document.getElementById('pkdaName');
    var meta = document.getElementById('pkdaMeta');
    var go = document.getElementById('pkdaGo');
    if (!box) return;
    if (!UI.pick) {
      box.hidden = true;
      if (go) go.disabled = true;
      return;
    }
    box.hidden = false;
    if (img) {
      img.onerror = function () { img.onerror = null; img.src = spr(UI.pick.id); };
      img.src = art(UI.pick.id);
      img.alt = titleOf(UI.pick);
    }
    if (nm) nm.textContent = '#' + num3(UI.pick) + ' ' + titleOf(UI.pick);
    var has = readDex(UI.slot).ids.indexOf(Number(UI.pick.id)) >= 0;
    if (meta) {
      meta.textContent = (UI.pick.types || []).join('·') + ' · ' + (UI.pick.genus || (UI.pick.gen ? UI.pick.gen + '세대' : ''))
        + (has ? ' · ✅ 이미 ' + slotName(UI.slot) + ' 도감에 있어요(마리수 +)' : '');
    }
    if (go) go.disabled = false;
  }

  function pick(id) {
    if (!DB) return;
    var p = null;
    for (var i = 0; i < DB.length; i += 1) if (Number(DB[i].id) === Number(id)) { p = DB[i]; break; }
    if (!p) return;
    UI.pick = p;
    paintHits();
    paintPick();
    msg('마리수와 자리를 고르고 ➕ 도감에 추가를 눌러 주세요', false);
  }

  var qT = 0;
  function onQuery(v) {
    clearTimeout(qT);
    qT = setTimeout(function () {
      UI.hits = search(v);
      if (UI.hits.length === 1) { pick(UI.hits[0].id); return; }
      paintHits();
    }, 90);
  }

  function commit() {
    if (!UI.pick) { msg('먼저 포켓몬을 골라 주세요', true); return; }
    var p = UI.pick;
    var r = addMon(UI.slot, p.id, UI.n);
    var line = '🎁 ' + slotName(UI.slot) + ' 도감에 #' + num3(p) + ' ' + titleOf(p) + (r.count > 1 ? ' ×' + r.count : '') + '을(를) 넣었어요';
    toast(line);
    msg(line, false);
    paintPick();
    paintHits();
    /* 이 화면의 도감·숫자를 바로 다시 그린다 */
    for (var i = 0; i < bindings.length; i += 1) {
      try { if (bindings[i].onDone) bindings[i].onDone(UI.slot, Number(p.id), r.count); } catch (e) { /* */ }
    }
  }

  function open(opts) {
    opts = opts || {};
    if (!el) build();
    if (opts.slot && SLOT_ORDER.indexOf(opts.slot) >= 0) UI.slot = opts.slot;
    UI.pick = null;
    UI.hits = [];
    UI.n = 1;
    setN(1);
    var q = document.getElementById('pkdaQ');
    if (q) q.value = '';
    paintSlots();
    paintHits();
    paintPick();
    msg('이름이나 번호로 찾고, 자리를 골라 주세요', false);
    el.hidden = false;
    loadDB().then(function () { try { UI.hits = search((q && q.value) || ''); paintHits(); } catch (e) { /* */ } });
    setTimeout(function () { try { q.focus(); } catch (e) { /* */ } }, 80);
  }
  function close() { if (el) el.hidden = true; }

  /* ---------- ➕ 버튼 붙이기 ----------
     bind({ button, isUnlocked, getSlot, onDone })
       · isUnlocked() 가 참일 때만 버튼이 보인다(아빠 PIN 을 통과한 동안)
       · 버튼을 누르면 지금 도감 주인 자리(getSlot)로 열린다 */
  function syncOne(b) {
    var on = false;
    try { on = !!(b.isUnlocked && b.isUnlocked()); } catch (e) { on = false; }
    if (b.button) b.button.hidden = !on;
    return on;
  }
  function bind(opts) {
    if (!opts || !opts.button) return null;
    bindings.push(opts);
    var btn = opts.button;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var slot = 'p1';
      try { slot = (opts.getSlot && opts.getSlot()) || 'p1'; } catch (err) { slot = 'p1'; }
      try { if (window.Sound && Sound.ensure) Sound.ensure(); } catch (err) { /* */ }
      open({ slot: slot });
    });
    syncOne(opts);
    return opts;
  }
  function sync() {
    var any = false;
    for (var i = 0; i < bindings.length; i += 1) if (syncOne(bindings[i])) any = true;
    return any;
  }
  /* 1초마다 잠금 상태를 따라간다(아빠 잠금이 풀리면 ➕ 가 나타나고, 다시 잠기면 사라진다) */
  setInterval(function () { try { sync(); } catch (e) { /* */ } }, 1000);

  window.PkmDexAdd = {
    version: VERSION,
    bind: bind,
    open: open,
    close: close,
    sync: sync,
    addMon: addMon,
    readDex: readDex,
    slotName: slotName
  };
})();
