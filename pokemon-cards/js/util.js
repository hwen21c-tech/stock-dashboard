/* util.js — 저장소 · 상태 · 공통 UI */
(function () {
  'use strict';
  const KEY = 'pkc.v1';
  const PIN = '0623';

  const PROFILES = [
    { id: 'arin', name: '아린', emoji: '🦄' },
    { id: 'jian', name: '지안', emoji: '🐥' },
    { id: 'guest', name: '게스트', emoji: '🐣' }
  ];

  const TITLES = [
    { id: 'start', name: '새내기 수집가', desc: '카드 1장부터', need: 1 },
    { id: 'c50', name: '카드 수집가', desc: '카드 50장', need: 50 },
    { id: 'c150', name: '카드 매니아', desc: '카드 150장', need: 150 },
    { id: 'c300', name: '카드 박사', desc: '카드 300장', need: 300 },
    { id: 'c600', name: '도감 마스터', desc: '카드 600장', need: 600 }
  ];

  /* ---------- ⚔️ 1:1(사람끼리) 배틀 칭호 — 누적 1:1 승수로 진화 ----------
     컴퓨터와의 대전은 여기에 절대 들어가지 않는다(승수·연승·카드 파워·무료팩·칭호 전부 해당). */
  const BATTLE_TITLES = [
    { id: 'champ', min: 20, name: '👑 챔피언' },
    { id: 'gym', min: 10, name: '🏅 체육관 관장' },
    { id: 'ace', min: 3, name: '⚡ 배틀 에이스' },
    { id: 'rookie', min: 0, name: '🥚 루키' }
  ];
  function battleTitle(wins) {
    const w = Math.max(0, Math.round(Number(wins) || 0));
    return BATTLE_TITLES.find(t => w >= t.min) || BATTLE_TITLES[BATTLE_TITLES.length - 1];
  }
  /* 다음 칭호까지 몇 승 남았는지 (이미 최고면 null) */
  function nextBattleTitle(wins) {
    const w = Math.max(0, Math.round(Number(wins) || 0));
    const up = BATTLE_TITLES.slice().sort((a, b) => a.min - b.min).find(t => t.min > w);
    return up ? { title: up, need: up.min - w } : null;
  }

  const state = {
    v: 1,
    active: 'arin',
    adminUntil: 0,
    settings: { sfx: true, bgm: true, vibration: true, volume: 0.7 },
    profiles: {}
  };

  function blankProfile(p) {
    return {
      name: p.name, emoji: p.emoji, coins: 100,
      cards: {}, src: {}, fav: [], favAt: {}, tickets: { normal: 0, high: 0 },
      opened: {}, badges: [], titles: ['start'], log: [],
      deck: [], wins: 0, losses: 0, trades: [], seen: Date.now(),
      stardust: 0, at: 0, coinsAt: 0,
      /* ⚔️ 사람끼리 1:1 전용 기록 */
      pvp: { w: 0, l: 0, streak: 0, best: 0, vs: {} },   /* 승/패·현재 연승·최고 연승·상대별 전적 */
      cardWins: {},                                        /* 카드별 1:1 승수 (1승 = 파워 +5) */
      freePacks: [],                                       /* 5승마다 받은 무료팩 [{id, packId, at}] */
      /* 🗑 지운 것 기록 — 클라우드가 되살리지 않게 (카드·무료팩·교환함) */
      cardDel: {}, freeUsed: {}, tradeOff: {}
    };
  }

  /* ---------- ⚔️ 1:1 기록 도우미 (없는 값은 0으로) ---------- */
  function intOf(v) { const x = Math.round(Number(v)); return isFinite(x) && x > 0 ? x : 0; }
  function pvpOf(pr) {
    const p = (pr && pr.pvp) || {};
    const vs = {};
    Object.keys(p.vs || {}).forEach(k => {
      const x = p.vs[k] || {};
      vs[k] = { w: intOf(x.w), l: intOf(x.l) };
    });
    return { w: intOf(p.w), l: intOf(p.l), streak: intOf(p.streak), best: intOf(p.best), vs: vs };
  }
  function cardWinsOf(pr) {
    const out = {};
    Object.keys((pr && pr.cardWins) || {}).forEach(k => { const v = intOf(pr.cardWins[k]); if (v) out[k] = v; });
    return out;
  }
  function cardWinCount(profileId, cardId) {
    const pr = state.profiles[profileId];
    return pr ? intOf((pr.cardWins || {})[cardId]) : 0;
  }
  /* 🤝 교환함 — 예전 저장본({cardId} 낱장)도 '묶음' 모양으로 맞춘다.
     [{id, cards:[카드id…], at}] · 한 묶음 10장 · 최대 10묶음 */
  function normTradeList(a) {
    const out = [], seen = {};
    (Array.isArray(a) ? a : []).forEach(t => {
      if (!t) return;
      const ids = (Array.isArray(t.cards) ? t.cards : (t.cardId ? [t.cardId] : []))
        .filter(x => x && typeof x === 'string');
      if (!ids.length) return;
      const id = String(t.id || ('tr-' + ids.join('|')));
      if (seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, cards: ids.slice(0, 10), at: Math.max(0, Math.round(Number(t.at) || 0)) });
    });
    return out.slice(0, 10);
  }

  function freePacksOf(pr) {
    return ((pr && pr.freePacks) || []).filter(x => x && x.id);
  }

  /* ---------- 바뀐 시각 기록 (클라우드에서 '누가 더 최근인지' 가리는 데 쓴다) ----------
     코인은 coinsAt, 카드·티켓·별가루·교환함은 at. */
  let coinSnap = null, profSnap = null;
  function profSig(pr) {
    return JSON.stringify([pr.name, pr.emoji, pr.cards, pr.src, pr.fav, pr.favAt || null, pr.tickets,
      pr.stardust || 0, pr.badges, pr.titles, pr.deck, pr.wins || 0, pr.losses || 0, pr.trades,
      pr.pvp || null, pr.cardWins || null, pr.freePacks || null,
      pr.cardDel || null, pr.freeUsed || null, pr.tradeOff || null]);
  }
  function resetTrack() {
    coinSnap = {}; profSnap = {};
    PROFILES.forEach(p => {
      const pr = state.profiles[p.id];
      if (!pr) return;
      coinSnap[p.id] = pr.coins;
      profSnap[p.id] = profSig(pr);
    });
  }
  function track() {
    if (!coinSnap || !profSnap) { resetTrack(); return; }
    const now = Date.now();
    PROFILES.forEach(p => {
      const pr = state.profiles[p.id];
      if (!pr) return;
      const sig = profSig(pr);
      if (profSnap[p.id] !== sig) { pr.at = now; profSnap[p.id] = sig; }
      if (coinSnap[p.id] !== pr.coins) { pr.coinsAt = now; coinSnap[p.id] = pr.coins; }
    });
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d && d.profiles) Object.assign(state, d);
      } catch (e) { /* ignore */ }
    }
    PROFILES.forEach(p => {
      if (!state.profiles[p.id]) state.profiles[p.id] = blankProfile(p);
      const pr = state.profiles[p.id];
      pr.cards = pr.cards || {}; pr.src = pr.src || {}; pr.fav = pr.fav || [];
      pr.favAt = (pr.favAt && typeof pr.favAt === 'object') ? pr.favAt : {};
      pr.cardDel = (pr.cardDel && typeof pr.cardDel === 'object') ? pr.cardDel : {};
      pr.freeUsed = (pr.freeUsed && typeof pr.freeUsed === 'object') ? pr.freeUsed : {};
      pr.tradeOff = (pr.tradeOff && typeof pr.tradeOff === 'object') ? pr.tradeOff : {};
      pr.tickets = pr.tickets || { normal: 0, high: 0 };
      pr.opened = pr.opened || {}; pr.badges = pr.badges || [];
      pr.titles = pr.titles || ['start']; pr.deck = pr.deck || []; pr.trades = pr.trades || [];
      pr.trades = normTradeList(pr.trades);
      if (typeof pr.coins !== 'number') pr.coins = 100;
      if (typeof pr.stardust !== 'number') pr.stardust = 0;
      if (typeof pr.at !== 'number') pr.at = 0;
      if (typeof pr.coinsAt !== 'number') pr.coinsAt = 0;
      /* ⚔️ 1:1 기록 — 예전 저장본에는 없으므로 기본값을 채운다 */
      pr.pvp = pvpOf(pr);
      pr.cardWins = cardWinsOf(pr);
      pr.freePacks = freePacksOf(pr).map(x => ({ id: String(x.id), packId: String(x.packId || ''), at: Number(x.at) || 0, reason: String(x.reason || '') }));
    });
    if (!state.profiles[state.active]) state.active = 'arin';
    if (!state.settings) state.settings = { sfx: true, bgm: true, vibration: true, volume: 0.7 };
    if (state.settings.vibration == null) state.settings.vibration = vibPref();
    resetTrack();
    return state;
  }

  let saveTimer = null;
  function save() {
    track();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
      try { if (window.PKCCloud) window.PKCCloud.touch(); } catch (e) { /* */ }
    }, 60);
  }

  function me() { return state.profiles[state.active]; }
  function prof(id) { return state.profiles[id]; }
  function profileMeta(id) { return PROFILES.find(p => p.id === id) || PROFILES[0]; }
  function isAdmin() { return state.adminUntil > Date.now(); }
  function setAdmin(on) { state.adminUntil = on ? Date.now() + 3 * 60 * 1000 : 0; save(); }

  /* ---------- DOM ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function won(n) { return Number(n || 0).toLocaleString('ko-KR'); }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg, gold) {
    const root = $('#toastRoot');
    let t = root.querySelector('.toast');
    if (!t) { t = el('div', 'toast'); root.appendChild(t); }
    t.className = 'toast' + (gold ? ' gold' : '');
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add('show'));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2100);
  }

  /* ---------- modal ---------- */
  const modalStack = [];
  function modal(opts) {
    const back = el('div', 'modal-back');
    const box = el('div', 'modal');
    const head = el('div', 'modal-head');
    head.innerHTML = '<h3>' + (opts.title || '') + '</h3>';
    const x = el('button', 'modal-x', '✕');
    x.setAttribute('aria-label', '나가기');
    head.appendChild(x);
    const body = el('div', 'modal-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    box.appendChild(head); box.appendChild(body);

    const foot = el('div', 'modal-foot');
    const buttons = opts.buttons || [{ label: '확인', kind: 'primary' }];
    let closed = false;
    function close(result) {
      if (closed) return;
      closed = true;
      back.style.opacity = '0';
      back.style.transition = 'opacity .18s';
      setTimeout(() => back.remove(), 180);
      const i = modalStack.indexOf(close);
      if (i >= 0) modalStack.splice(i, 1);
      if (opts.onClose) opts.onClose(result);
    }
    buttons.forEach(b => {
      const btn = el('button', 'btn ' + (b.kind || 'ghost'), b.label);
      if (b.disabled) btn.disabled = true;
      btn.addEventListener('click', () => {
        if (b.onClick) {
          const r = b.onClick(close, body);
          if (r === false) return;
        }
        if (b.keepOpen) return;
        close(b.value != null ? b.value : true);
      });
      foot.appendChild(btn);
    });
    box.appendChild(foot);
    back.appendChild(box);
    if (opts.dismissible !== false) {
      x.addEventListener('click', () => close(false));
      back.addEventListener('click', e => { if (e.target === back) close(false); });
    } else { x.style.visibility = 'hidden'; }
    $('#modalRoot').appendChild(back);
    modalStack.push(close);
    if (opts.onMount) opts.onMount(body, close);
    return { close, body, box };
  }

  function confirmBox(title, text, okLabel, cancelLabel) {
    return new Promise(resolve => {
      modal({
        title: title,
        body: '<p style="font-size:14px;line-height:1.6;margin:0;color:#dfe6ff">' + text + '</p>',
        buttons: [
          { label: cancelLabel || '✕ 나가기', kind: 'ghost', onClick: () => resolve(false) },
          { label: okLabel || '확인', kind: 'primary', onClick: () => resolve(true) }
        ],
        onClose: () => resolve(false)
      });
    });
  }

  function pinPrompt(title, cb) {
    let buf = '';
    const wrap = el('div');
    wrap.innerHTML = '<p class="muted" style="margin:0 0 12px">아빠 PIN 4자리를 입력하세요.</p>' +
      '<input class="input" id="pinIn" inputmode="numeric" maxlength="4" type="password" placeholder="••••">';
    modal({
      title: title || '🔒 아빠 확인',
      body: wrap,
      buttons: [
        { label: '✕ 나가기', kind: 'ghost' },
        {
          label: '확인', kind: 'primary', onClick: (close) => {
            const v = $('.input', wrap).value.trim();
            if (v !== PIN) { toast('PIN이 달라요'); return false; }
            setAdmin(true); close(true); cb && cb();
            return false;
          }
        }
      ],
      onMount: (b) => { const i = b.querySelector('#pinIn'); if (i) setTimeout(() => i.focus(), 120); }
    });
  }

  /* ---------- 🃏 가로형 카드(BREAK 등) 자동 감지 ----------
     카드 그림 중 가로가 더 긴 카드(예: 블로스터 BREAK)는 세로 틀(63/88)에
     꽉 채우면(object-fit:cover) 좌우가 잘려 글씨·일러스트가 깨져 보인다.
     그림이 실제로 붙는 순간 크기를 재서 img.is-landscape 를 달고,
     CSS 가 object-fit:contain + 어두운 배경으로 틀 안에 온전히 담게 한다.
     · 일반 세로형 카드는 아무것도 바뀌지 않는다.
     · 팩 표지(.pack-art 등)는 카드가 아니므로 건드리지 않는다. */
  const ART_SKIP = '.pack-art,.pack,.pack-visual,.today-card,.lid-part,.pa-bg';
  function markOrientation(img) {
    if (!img || img.dataset.ori) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    img.dataset.ori = w > h ? 'L' : 'P';
    if (w <= h) return;
    if (img.closest && img.closest(ART_SKIP)) return;
    img.classList.add('is-landscape');
    try {
      const box = img.closest('.reveal-card,.zoom-card');
      if (box) {                       /* 리빌·확대 팝업은 카드 비율 그대로 크게 */
        box.classList.add('is-landscape');
        box.style.aspectRatio = w + ' / ' + h;
      }
    } catch (e) { /* */ }
  }
  function sweepOrientation(root) {
    const list = (root || document).querySelectorAll('img');
    for (let i = 0; i < list.length; i++) {
      const img = list[i];
      if (!img.dataset.ori && img.complete) markOrientation(img);
    }
  }
  document.addEventListener('load', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG') markOrientation(t);
  }, true);
  (function watchImgs() {
    if (typeof MutationObserver !== 'function') return;
    let queued = false;
    const obs = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      const run = () => { queued = false; sweepOrientation(document); };
      if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 30);
    });
    const start = () => {
      if (!document.body) return setTimeout(start, 30);
      obs.observe(document.body, { childList: true, subtree: true });
      sweepOrientation(document);
    };
    start();
  })();

  function haptic(ms) {
    if (!vibOn()) return;                       /* 📴 무진동이면 아예 울리지 않는다 */
    if (navigator.vibrate) { try { navigator.vibrate(ms || 8); } catch (e) { } }
  }

  /* ---------- 📳 진동 설정 (기기 취향 — 클라우드로 보내지 않는다) ---------- */
  const VIB_KEY = 'pkc_vibrate_v1';
  function vibPref() {
    try { const v = localStorage.getItem(VIB_KEY); return v == null ? true : v !== '0'; } catch (e) { return true; }
  }
  function vibOn() { return state.settings && state.settings.vibration === false ? false : vibPref(); }
  function setVib(on) {
    const v = !!on;
    state.settings.vibration = v;
    try { localStorage.setItem(VIB_KEY, v ? '1' : '0'); } catch (e) { /* */ }
    save();
    return v;
  }

  window.PKC = {
    KEY, PIN, PROFILES, TITLES, BATTLE_TITLES,
    state, load, save, me, prof, profileMeta, isAdmin, setAdmin,
    $, $$, el, esc, won, toast, modal, confirmBox, pinPrompt, haptic,
    vibOn, setVib, resetTrack, markOrientation, sweepOrientation, normTradeList,
    battleTitle, nextBattleTitle, pvpOf, cardWinsOf, cardWinCount, freePacksOf
  };
})();
