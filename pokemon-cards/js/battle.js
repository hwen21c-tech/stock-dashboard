/* battle.js — ★12 코스트 5장 덱 · 1~5 순서 지정 · 배틀 아레나 (동시 플립 · 속성 공격 · KO) */
(function () {
  'use strict';
  const P = window.PKC, D = window.PKData, U = window.PKUI, A = window.PKCAudio;
  const $ = P.$, esc = P.esc;

  const BUDGET = 12;
  const ADV = 30;
  const TYPE_BONUS = {
    '불꽃': ['풀', '강철'], '풀': ['물'], '물': ['불꽃'], '번개': ['물'], '초': ['격투'],
    '격투': ['무색', '악'], '악': ['초'], '강철': ['페어리'], '드래곤': ['드래곤'],
    '페어리': ['드래곤'], '무색': []
  };
  const TIER_BONUS = { 1: 0, 2: 10, 4: 40, 5: 60 };
  const CARD_WIN_POWER = 5;          /* 1:1에서 카드가 1승 할 때마다 파워 +5 (10승 = +50) */

  /* ---------------- 🤖 컴퓨터(AI) 난이도 3단계 ----------------
     타이밍 바에서 컴퓨터가 노릴 배수(plan)를 확률로 먼저 정하고,
     바늘이 그 칸에 들어오는 순간 멈춘다. 0 = 일부러 빗나가기.
     컴퓨터와의 대전은 1:1 기록·칭호·무료팩·카드 파워에 절대 들어가지 않는다. */
  const DIFF_KEY = 'pkc_ai_diff_v1';
  const DIFFS = [
    { k: 'easy', name: '쉬움', emoji: '🌱', desc: '컴퓨터가 자주 빗나가요',
      plan: [[0, 0.66], [1.5, 0.27], [2, 0.06], [3, 0.01]] },
    { k: 'normal', name: '보통', emoji: '⚔️', desc: '가끔은 맞히는 보통 실력',
      plan: [[0, 0.30], [1.5, 0.42], [2, 0.20], [3, 0.08]] },
    /* 어려움(11/28 상향): ×2·×3를 거의 놓치지 않고, 덱도 제일 센 조합으로 꾸린다 */
    { k: 'hard', name: '어려움', emoji: '🔥', desc: '×2·×3을 거의 다 맞히고 제일 센 덱으로 나와요',
      plan: [[0, 0.02], [1.5, 0.14], [2, 0.34], [3, 0.50]] }
  ];
  function diffOf(k) { return DIFFS.find(d => d.k === k) || DIFFS[1]; }
  function getDiff() {
    try {
      const v = localStorage.getItem(DIFF_KEY);
      if (v && DIFFS.some(d => d.k === v)) return v;
    } catch (e) { /* */ }
    return 'normal';
  }
  function setDiff(k) {
    if (!DIFFS.some(d => d.k === k)) return getDiff();
    try { localStorage.setItem(DIFF_KEY, k); } catch (e) { /* */ }
    return k;
  }
  /* 난이도 확률표로 이번 바에서 노릴 배수를 뽑는다 (테스트에서도 쓴다) */
  function aiPlan(k, rnd) {
    const d = diffOf(k);
    let r = (typeof rnd === 'number' ? rnd : Math.random());
    for (const pair of d.plan) { r -= pair[1]; if (r <= 0) return pair[0]; }
    return d.plan[d.plan.length - 1][0];
  }

  const ui = {
    mode: 'ai',            // 'ai' | 'p2'
    step: 'deck',          // 'deck' | 'order' | 'pass' | 'arena'
    sel: [],               // 1P(또는 현재 플레이어) 덱
    order: [],             // 순서대로 카드 id 5개
    p2: 'jian',
    turn: 0,               // 0 = 1P, 1 = 2P
    p1Deck: [],
    p1Order: [],
    p2Deck: [],
    p2Order: [],
    bt: null,
    arenaEl: null,
    noAuto: false,         // 지우기 후 자동 채움 금지
    fType: 'all',          // 속성 필터
    fCost: 'all',          // 코스트(★) 필터
    sort: 'hp',            // 'hp' | 'fav' | 'pack'
    diff: 'normal'         // 🤖 컴퓨터 난이도
  };
  ui.diff = getDiff();

  /* 파워 = HP + 등급 보너스 + ⚡1:1 승리 보너스(그 카드 주인 기준 1승당 +5) */
  function power(card, ownerId) {
    const hp = card.hp || 40;
    return hp + (TIER_BONUS[card.r] || 0) + P.cardWinCount(ownerId || P.state.active, card.id) * CARD_WIN_POWER;
  }
  function pwBadge(cardId, ownerId) {
    const n = P.cardWinCount(ownerId || P.state.active, cardId);
    return n > 0 ? '<span class="pw-badge">⚡+' + (n * CARD_WIN_POWER) + '</span>' : '';
  }
  function advantage(a, b) { return (TYPE_BONUS[a.t] || []).indexOf(b.t) >= 0; }

  async function ownedCardList(profileId) {
    const pr = P.prof(profileId);
    const out = [];
    for (const id in pr.cards) {
      const c = await window.PKDex.ensureCard(id);
      if (c) out.push(c);
    }
    out.sort((a, b) => (b.r - a.r) || ((b.hp || 0) - (a.hp || 0)));
    return out;
  }

  function autoDeck(cards, profileId) {
    const pr = P.prof(profileId || P.state.active);
    const pool = [];
    cards.forEach(c => {
      const n = Math.min(5, pr.cards[c.id] || 1);
      for (let i = 0; i < n; i++) pool.push(c);
    });
    if (!pool.length) return [];
    const st = c => D.stars(c.r);
    const who = profileId || P.state.active;
    const cheap = pool.slice().sort((a, b) => (st(a) - st(b)) || (power(b, who) - power(a, who)));
    const deck = cheap.slice(0, 5);
    let total = deck.reduce((a, c) => a + st(c), 0);
    const better = pool.slice().sort((a, b) => (power(b, who) + st(b) * 20) - (power(a, who) + st(a) * 20));
    for (const c of better) {
      if (deck.indexOf(c) >= 0) continue;
      let worst = -1;
      for (let i = 0; i < deck.length; i++) {
        if (st(deck[i]) < st(c) && (worst < 0 || st(deck[worst]) > st(deck[i]))) worst = i;
      }
      if (worst >= 0 && total - st(deck[worst]) + st(c) <= BUDGET) {
        total = total - st(deck[worst]) + st(c);
        deck[worst] = c;
      }
    }
    return deck.slice(0, 5).map(c => c.id);
  }

  /* ---------------- 자동 덱 3종 (최강·랜덤·최애) ---------------- */
  /* 총 코스트 12 · 5장 안에서 '전투력 합계'가 가장 큰 조합 (0/1 배낭 DP) */
  function knapsack(seed, cards, profileId, budget, maxN) {
    const pr = P.prof(profileId);
    const used = {};
    seed.forEach(id => { used[id] = (used[id] || 0) + 1; });
    const pool = [];
    cards.forEach(c => {
      const left = Math.min(5, pr.cards[c.id] || 0) - (used[c.id] || 0);
      for (let i = 0; i < left; i++) pool.push(c);
    });
    if (!pool.length || budget <= 0 || maxN <= 0) return [];
    const dp = [];
    for (let cost = 0; cost <= budget; cost++) {
      const row = [];
      for (let n = 0; n <= maxN; n++) row.push(null);
      dp.push(row);
    }
    dp[0][0] = { pow: 0, ids: [] };
    pool.forEach(card => {
      const st = D.stars(card.r), pw = power(card, profileId);
      for (let cost = budget; cost >= st; cost--) {
        for (let n = maxN; n >= 1; n--) {
          const prev = dp[cost - st][n - 1];
          if (!prev) continue;
          const v = prev.pow + pw;
          const cur = dp[cost][n];
          if (!cur || v > cur.pow) dp[cost][n] = { pow: v, ids: prev.ids.concat(card.id) };
        }
      }
    });
    let best = null;
    for (let cost = 0; cost <= budget; cost++) {
      for (let n = 0; n <= maxN; n++) {
        const s = dp[cost][n];
        if (!s || !s.ids.length) continue;
        if (!best || s.pow > best.pow || (s.pow === best.pow && s.ids.length > best.ids.length)) best = s;
      }
    }
    return best ? best.ids.slice() : [];
  }

  /* 남은 자리를 싼 카드부터 채워 5장을 맞춘다 (배낭이 5장을 못 채웠을 때) */
  function fillCheap(out, cards, profileId) {
    const pr = P.prof(profileId);
    const used = {};
    let cost = 0;
    out.forEach(id => {
      used[id] = (used[id] || 0) + 1;
      const c = window.PKDex.findCard(id);
      if (c) cost += D.stars(c.r);
    });
    const who = profileId || P.state.active;
    const pool = cards.slice().sort((a, b) => (D.stars(a.r) - D.stars(b.r)) || (power(b, who) - power(a, who)));
    let guard = 0;
    while (out.length < 5 && guard++ < 600) {
      let added = false;
      for (const c of pool) {
        const st = D.stars(c.r);
        if ((used[c.id] || 0) >= Math.min(5, pr.cards[c.id] || 0)) continue;
        if (cost + st > BUDGET) continue;
        out.push(c.id); used[c.id] = (used[c.id] || 0) + 1; cost += st; added = true; break;
      }
      if (!added) break;
    }
    return out;
  }

  function deckBest(cards, profileId) { return knapsack([], cards, profileId, BUDGET, 5); }

  function deckRandom(cards, profileId) {
    const pr = P.prof(profileId);
    const pool = [];
    cards.forEach(c => {
      const n = Math.min(5, pr.cards[c.id] || 0);
      for (let i = 0; i < n; i++) pool.push(c);
    });
    if (!pool.length) return [];
    /* 예산 안에 드는 5장을 무작위로 뽑는다 (뽑힌 5장이 12를 넘으면 다시) */
    for (let attempt = 0; attempt < 600; attempt++) {
      const bag = pool.slice();
      const picks = [];
      let cost = 0;
      for (let i = 0; i < 5 && bag.length; i++) {
        const j = Math.floor(Math.random() * bag.length);
        const c = bag.splice(j, 1)[0];
        picks.push(c.id); cost += D.stars(c.r);
      }
      if (picks.length === 5 && cost <= BUDGET) return picks;
    }
    /* 5장을 못 맞추면 싼 카드부터 채운다 */
    const out = [];
    const pool2 = pool.slice().sort((a, b) => D.stars(a.r) - D.stars(b.r));
    let cost = 0;
    for (const c of pool2) {
      if (out.length >= 5) break;
      const st = D.stars(c.r);
      if (cost + st > BUDGET) continue;
      out.push(c.id); cost += st;
    }
    return out;
  }

  function deckFav(cards, profileId) {
    const pr = P.prof(profileId);
    const out = [];
    let cost = 0;
    (pr.fav || []).forEach(id => {
      if (out.length >= 5) return;
      const c = window.PKDex.findCard(id);
      if (!c || !(pr.cards[id] > 0) || out.indexOf(id) >= 0) return;
      const st = D.stars(c.r);
      if (cost + st > BUDGET) return;
      out.push(id); cost += st;
    });
    const rest = knapsack(out, cards, profileId, BUDGET - cost, 5 - out.length);
    rest.forEach(id => out.push(id));
    return fillCheap(out, cards, profileId);
  }

  /* ---------------- 나만의 덱 3칸 (프로필별 · 기기 저장 → ☁️ 가족 클라우드 동기화) ----------------
     값은 지금처럼 이 기기 저장소에 두고, **언제 바뀌었는지**만 따로 적어 둔다.
     폰에서 저장한 덱도, 태블릿에서 저장한 덱도 pkc_sync_meta_v1 의 시각을 비교해 최신 쪽이 남는다. */
  const DECKS_KEY = 'pkc_decks_v1';
  const META_KEY = 'pkc_sync_meta_v1';        /* { decksAt: {arin·jian·guest}, barSpeedAt } */
  function readDecks() {
    try {
      const d = JSON.parse(localStorage.getItem(DECKS_KEY) || '{}');
      return (d && typeof d === 'object') ? d : {};
    } catch (e) { return {}; }
  }
  function readMeta() {
    try {
      const m = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      return (m && typeof m === 'object') ? m : {};
    } catch (e) { return {}; }
  }
  function writeMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify((m && typeof m === 'object') ? m : {})); } catch (e) { /* */ }
  }
  function tsOf(v) { const x = Number(v); return (isFinite(x) && x > 0) ? x : 0; }
  function decksAtOf(profileId) { return tsOf((readMeta().decksAt || {})[profileId]); }
  function setDecksAt(profileId, ts) {
    const m = readMeta();
    m.decksAt = (m.decksAt && typeof m.decksAt === 'object') ? m.decksAt : {};
    m.decksAt[profileId] = tsOf(ts) || Date.now();
    writeMeta(m);
  }
  /* ☁️ 덱·속도가 바뀌면 클라우드에 알린다 (cloud.js 의 디바운스 push) */
  function touchCloud() { try { if (window.PKCCloud) window.PKCCloud.touch(); } catch (e) { /* */ } }

  function getSlots(profileId) {
    const all = readDecks();
    const arr = Array.isArray(all[profileId]) ? all[profileId] : [];
    return [0, 1, 2].map(i => (Array.isArray(arr[i]) && arr[i].length) ? arr[i].slice(0, 5) : null);
  }
  function setSlot(profileId, i, ids) {
    const all = readDecks();
    const arr = getSlots(profileId);
    arr[i] = (ids && ids.length) ? ids.slice(0, 5) : null;
    all[profileId] = arr;
    try { localStorage.setItem(DECKS_KEY, JSON.stringify(all)); } catch (e) { /* */ }
    setDecksAt(profileId);                       /* ☁️ 이 기기가 마지막으로 바꿨다 */
    touchCloud();                                /* ☁️ 태블릿에도 곧 반영 */
  }
  function slotCost(ids) {
    let n = 0;
    ids.forEach(id => { const c = window.PKDex.findCard(id); if (c) n += D.stars(c.r); });
    return n;
  }

  /* ---------------- ⚙️ 타이밍 바 공 속도 (아빠 전용 · 기기 저장) ---------------- */
  const SPEED_KEY = 'pkc_bar_speed_v1';
  const SPEED_PRESETS = [
    { v: 0.5, name: '매우 느림' },
    { v: 0.75, name: '느림' },
    { v: 1.0, name: '보통' },
    { v: 1.25, name: '약간 빠름' },
    { v: 1.5, name: '빠름' },
    { v: 2.0, name: '매우 빠름' }
  ];
  function getBarSpeed() {
    try {
      const raw = localStorage.getItem(SPEED_KEY);
      const n = raw == null ? NaN : parseFloat(raw);
      if (isFinite(n)) return Math.min(2, Math.max(0.5, n));
    } catch (e) { /* */ }
    return 1;
  }
  function barSpeedAtOf() { return tsOf(readMeta().barSpeedAt); }
  function setBarSpeedAt(ts) {
    const m = readMeta();
    m.barSpeedAt = tsOf(ts) || Date.now();
    writeMeta(m);
  }
  /* 아빠가 정한 속도를 저장 — 이 기기 + ☁️ 가족 클라우드(태블릿도 같은 속도) */
  function saveBarSpeed(v) {
    const x = Math.min(2, Math.max(0.5, Math.round((parseFloat(v) || 1) * 100) / 100));
    try { localStorage.setItem(SPEED_KEY, String(x)); } catch (e) { /* */ }
    barSpeed = x;
    setBarSpeedAt();
    touchCloud();
    return x;
  }
  function speedText(v) {
    const n = Math.round(v * 100) / 100;
    return (Math.round(n * 10) / 10 === n ? n.toFixed(1) : String(n)) + '×';
  }
  function speedName(v) {
    const p2 = SPEED_PRESETS.find(x => Math.abs(x.v - v) < 0.001);
    return p2 ? p2.name : '직접 설정';
  }
  let barSpeed = getBarSpeed();          /* 타이밍 바 배율 — 바가 도는 중에 바꿔도 즉시 반영 */

  /* 아빠 PIN → 속도 설정 팝업 */
  function openSpeedModal() {
    document.body.classList.add('arena-on');
    let cur = getBarSpeed();
    const wrap = P.el('div');
    wrap.innerHTML =
      '<p class="spd-desc">타이밍 바에서 <b>공이 움직이는 속도</b>를 정해요.<br>느리게 하면 아이들이 맞히기 쉬워요.</p>' +
      '<div class="spd-val"><b id="spdVal"></b><span id="spdName"></span></div>' +
      '<div class="spd-presets" id="spdPresets">' +
        SPEED_PRESETS.map(p2 => '<button class="spd-btn" data-spd="' + p2.v + '"><b>' + speedText(p2.v) + '</b><span>' +
          p2.name + (p2.v === 1 ? ' · 기본' : '') + '</span></button>').join('') +
      '</div>' +
      '<div class="spd-slide">' +
        '<input type="range" id="spdRange" class="spd-range" min="0.5" max="2" step="0.05" value="' + cur + '" aria-label="타이밍 바 속도">' +
        '<div class="spd-scale"><span>0.5×</span><span>1.0× (보통)</span><span>2.0×</span></div>' +
      '</div>';

    P.modal({
      title: '⚙️ 타이밍 바 속도',
      body: wrap,
      buttons: [
        { label: '✕ 나가기', kind: 'ghost' },
        {
          label: '확인', kind: 'primary', onClick: () => {
            const v = saveBarSpeed(cur);
            A.sfx.sparkle(); P.haptic(12);
            P.toast('타이밍 바 속도 ' + speedText(v) + ' 저장!', true);
          }
        }
      ],
      onMount: (body) => {
        const valEl = body.querySelector('#spdVal');
        const nameEl = body.querySelector('#spdName');
        const range = body.querySelector('#spdRange');
        const btns = Array.prototype.slice.call(body.querySelectorAll('[data-spd]'));
        function paint() {
          valEl.textContent = speedText(cur);
          nameEl.textContent = speedName(cur);
          range.value = String(cur);
          btns.forEach(b => b.classList.toggle('active', Math.abs(+b.dataset.spd - cur) < 0.001));
        }
        btns.forEach(b => b.addEventListener('click', () => { cur = +b.dataset.spd; A.sfx.tap(); paint(); }));
        range.addEventListener('input', () => { cur = parseFloat(range.value) || 1; paint(); });
        paint();
      }
    });
  }

  /* ---------------- 라우터 ---------------- */
  let renderSeq = 0;

  function render() {
    if (ui.step === 'arena' && ui.bt) return;      // 아레나는 자체 DOM
    const root = $('#screen-battle');
    if (ui.step === 'pass') { renderPass(root); return; }
    renderSetup(root);
  }

  async function renderSetup(root) {
    const seq = ++renderSeq;
    const keepY = window.scrollY;
    const battleOn = ($('#screen-battle') || {}).classList ? $('#screen-battle').classList.contains('active') : false;
    const meId = ui.turn === 0 ? P.state.active : ui.p2;
    const pr = P.prof(meId);
    root.innerHTML = '<div class="loading"><div class="spinner"></div>카드 불러오는 중…</div>';
    const cards = await ownedCardList(meId);
    if (seq !== renderSeq) return;
    if (!ui.sel.length && !ui.noAuto) {
      const saved = (pr.deck || []).filter(id => pr.cards[id]).slice(0, 5);
      const sStars = saved.reduce((a, id) => { const c = window.PKDex.findCard(id); return a + (c ? D.stars(c.r) : 0); }, 0);
      ui.sel = (saved.length === 5 && sStars <= BUDGET) ? saved : autoDeck(cards, meId);
    }

    const selCards = [];
    ui.sel.forEach(id => { const c = window.PKDex.findCard(id); if (c) selCards.push(c); });
    const stars = selCards.reduce((a, c) => a + D.stars(c.r), 0);
    const okDeck = selCards.length === 5 && stars <= BUDGET;
    const remain = Math.max(0, BUDGET - stars);
    const countIn = id => ui.sel.filter(x => x === id).length;
    const who = ui.turn === 0 ? P.me().name : P.prof(ui.p2).name;
    const favOrder = {};
    (pr.fav || []).forEach((id, i) => { if (!(id in favOrder)) favOrder[id] = i; });
    const pvp = P.pvpOf(pr);
    const bTitle = P.battleTitle(pvp.w);
    const bNext = P.nextBattleTitle(pvp.w);
    const diff = diffOf(ui.diff);

    /* ---- 속성 · 코스트 필터 (보유 카드에 있는 것만) ---- */
    const TYPE_ORDER = ['불꽃', '물', '번개', '풀', '초', '격투', '악', '강철', '드래곤', '무색', '페어리'];
    const typeCount = {}, costCount = {};
    cards.forEach(c => {
      const t = c.t || '무색';
      typeCount[t] = (typeCount[t] || 0) + 1;
      const st = D.stars(c.r);
      costCount[st] = (costCount[st] || 0) + 1;
    });
    if (ui.fType !== 'all' && !typeCount[ui.fType]) ui.fType = 'all';
    if (ui.fCost !== 'all' && !costCount[+ui.fCost]) ui.fCost = 'all';

    const typeChips = '<button class="chip small' + (ui.fType === 'all' ? ' active' : '') + '" data-ftype="all">전체<b>' + cards.length + '</b></button>' +
      TYPE_ORDER.filter(t => typeCount[t]).map(t =>
        '<button class="chip small' + (ui.fType === t ? ' active' : '') + '" data-ftype="' + t + '">' +
        D.typeEmoji(t) + ' ' + t + '<b>' + typeCount[t] + '</b></button>').join('');

    const costKeys = Object.keys(costCount).map(Number).sort((a, b) => a - b);
    const costChips = '<button class="chip small' + (ui.fCost === 'all' ? ' active' : '') + '" data-fcost="all">전체<b>' + cards.length + '</b></button>' +
      costKeys.map(n =>
        '<button class="chip small' + (ui.fCost === n ? ' active' : '') + '" data-fcost="' + n + '">★' + n + '<b>' + costCount[n] + '</b></button>').join('');

    const sortChips =
      '<button class="chip small' + (ui.sort === 'hp' ? ' active' : '') + '" data-fsort="hp">💪 강한 순</button>' +
      '<button class="chip small' + (ui.sort === 'fav' ? ' active' : '') + '" data-fsort="fav">⭐ 최애 먼저</button>' +
      '<button class="chip small' + (ui.sort === 'pack' ? ' active' : '') + '" data-fsort="pack">📦 팩별 묶음</button>';

    /* ---- 카드 목록 (필터 · 정렬 · 팩 묶음) ---- */
    const shownCards = cards.filter(c =>
      (ui.fType === 'all' || (c.t || '무색') === ui.fType) &&
      (ui.fCost === 'all' || D.stars(c.r) === +ui.fCost));
    const byPower = (a, b) => (power(b, meId) - power(a, meId)) || ((b.hp || 0) - (a.hp || 0));
    const byFav = (a, b) => {
      const fa = a.id in favOrder ? favOrder[a.id] : 99;
      const fb = b.id in favOrder ? favOrder[b.id] : 99;
      return (fa - fb) || byPower(a, b);
    };
    function packOfCard(id) {
      const src = pr.src[id];
      if (src) { const m = D.packMeta(src); if (m) return m; }
      const set = id.split('-')[0];
      return D.allPacks().find(p => p.set === set) || null;
    }

    function tile(c) {
      const n = countIn(c.id);
      const on = n > 0;
      const st = D.stars(c.r);
      const short = n === 0 && st > remain;
      return '<button class="pick-card' + (on ? ' sel' : '') + (short ? ' short' : '') +
        (c.id in favOrder ? ' fav' : '') + '" data-pick="' + c.id + '"' +
        (short ? ' title="남은 코스트가 부족해요"' : '') + '>' +
        '<img loading="lazy" src="' + D.img(c.img) + '" alt="' + esc(c.name) + '">' +
        '<span class="star">★' + st + '</span>' +
        pwBadge(c.id, meId) +
        (short ? '<span class="shortb">★부족</span>' : '') +
        (n > 1 ? '<span class="cnt">×' + n + '</span>' : '') +
        '</button>';
    }

    let listHtml;
    if (!cards.length) {
      listHtml = '<div class="empty">카드팩을 먼저 뜯어 카드를 모아 보세요!</div>';
    } else if (!shownCards.length) {
      listHtml = '<div class="empty">조건에 맞는 카드가 없어요<br><span style="font-size:11.5px">필터를 ‘전체’로 바꿔 보세요</span></div>';
    } else if (ui.sort === 'pack') {
      const groups = {}, gorder = [];
      shownCards.slice().sort(byPower).forEach(c => {
        const m = packOfCard(c.id);
        const key = m ? m.id : 'etc';
        if (!groups[key]) { groups[key] = { name: m ? m.name : '기타 팩', cards: [] }; gorder.push(key); }
        groups[key].cards.push(c);
      });
      const packIdx = {};
      D.allPacks().forEach((p, i) => { packIdx[p.id] = i; });
      gorder.sort((a, b) => (a === 'etc' ? 9999 : packIdx[a] == null ? 9998 : packIdx[a]) -
        (b === 'etc' ? 9999 : packIdx[b] == null ? 9998 : packIdx[b]));
      listHtml = gorder.map(k => {
        const g = groups[k];
        return '<div class="pack-group"><div class="pgh"><b>' + esc(g.name) + '</b><span>' + g.cards.length + '종</span></div>' +
          '<div class="deck-grid">' + g.cards.map(tile).join('') + '</div></div>';
      }).join('');
    } else {
      const arr = shownCards.slice().sort(ui.sort === 'fav' ? byFav : byPower);
      listHtml = '<div class="deck-grid">' + arr.map(tile).join('') + '</div>';
    }

    /* ---- 나만의 덱 3칸 ---- */
    const slots = getSlots(meId);
    const slotHtml = [0, 1, 2].map(i => {
      const ids = slots[i];
      const nm = '덱' + (i + 1);
      if (!ids) {
        return '<button class="dkslot empty" data-slot-save="' + i + '">' +
          '<span class="dk-n">' + nm + '</span>' +
          '<span class="dk-e">비어 있음</span>' +
          '<span class="dk-a">💾 저장</span></button>';
      }
      const cs = ids.map(id => window.PKDex.findCard(id));
      const got = cs.filter(Boolean);
      return '<div class="dkslot filled" data-slot-load="' + i + '" role="button" tabindex="0">' +
        '<span class="dk-n">' + nm + '</span>' +
        '<button class="dk-x" data-slot-del="' + i + '" aria-label="' + nm + ' 삭제">✕</button>' +
        '<div class="dk-t">' + cs.map(c => c
          ? '<img src="' + D.img(c.img) + '" alt="">'
          : '<span class="dk-q">?</span>').join('') + '</div>' +
        '<span class="dk-m">★' + slotCost(ids) + ' · ' + got.length + '장</span>' +
        '</div>';
    }).join('');

    /* ---- 🃏 내가 고른 카드 5칸 트레이 (항상 표시 · 고르는 즉시 채워짐) ---- */
    const trayHtml =
      '<div class="card-panel tray-panel">' +
        '<div class="tray-head"><b>🃏 내가 고른 카드</b><span id="trayCount">' + selCards.length + '/5장' +
          (stars > 0 ? ' · ★' + stars + '/' + BUDGET : '') + '</span></div>' +
        '<div class="tray" id="selTray">' +
          [0, 1, 2, 3, 4].map(i => {
            const c = selCards[i];
            if (!c) return '<div class="tslot"><span class="tnum">' + (i + 1) + '</span></div>';
            return '<button class="tslot filled" data-tpop="' + i + '" aria-label="' + esc(c.name) + ' 덱에서 빼기">' +
              '<img src="' + D.img(c.img) + '" alt="' + esc(c.name) + '">' +
              pwBadge(c.id, meId) +
              '<span class="ts">★' + D.stars(c.r) + '</span>' +
              '<span class="tx">✕</span>' +
              '<span class="tn">' + esc(c.name) + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        (selCards.length ? '<div class="tray-tip">카드를 누르면 덱에서 바로 빠져요</div>' : '') +
      '</div>';

    const orderBox = okDeck ? (
      '<div class="h2">🎯 낼 카드 순서 정하기</div>' +
      '<div class="order-box">' +
        '<div class="muted" style="font-size:11.5px;margin-bottom:8px">아래 카드를 누른 순서대로 <b>1번 → 5번</b>에 놓여요. 순서를 바꾸려면 놓인 카드를 누르세요.</div>' +
        '<div class="order-slots" id="orderSlots">' +
          [0, 1, 2, 3, 4].map(i => {
            const id = ui.order[i];
            const c = id ? window.PKDex.findCard(id) : null;
            return '<div class="oslot' + (c ? ' filled' : '') + (c ? '' : (ui.order.length === i ? ' cur' : '')) + '" data-slot="' + i + '">' +
              '<span class="n">' + (i + 1) + '</span>' +
              (c ? '<img src="' + D.img(c.img) + '" alt=""><span class="x">✕</span>' : (ui.order.length === i ? '여기에' : '')) +
              '</div>';
          }).join('') +
        '</div>' +
        '<div class="deck-grid" id="pool">' +
          selCards.map(c => {
            const used = ui.order.indexOf(c.id) >= 0;
            return '<button class="pick-card' + (used ? ' dim' : '') + '" data-place="' + c.id + '"' + (used ? ' disabled' : '') + '>' +
              '<img src="' + D.img(c.img) + '" alt="' + esc(c.name) + '">' +
              '<span class="star">★' + D.stars(c.r) + '</span>' +
              (used ? '<span class="used">' + (ui.order.indexOf(c.id) + 1) + '번</span>' : '') +
              '</button>';
          }).join('') +
        '</div>' +
        '<div class="btn-row" style="margin-top:10px">' +
          '<button class="btn ghost sm" id="autoOrder">🎲 순서 자동</button>' +
          '<button class="btn gold sm" id="readyBtn"' + (ui.order.length === 5 ? '' : ' disabled') + '>✅ 준비 완료</button>' +
        '</div>' +
      '</div>'
    ) : '';

    root.innerHTML =
      '<div class="h1">⚔️ 카드 배틀</div>' +
      (ui.mode === 'p2' && ui.turn === 1 ? '<div class="card-panel" style="margin-bottom:10px;text-align:center">' +
        '<b style="color:#ffe9bf">' + esc(who) + ' 차례</b>' +
        '<div class="muted" style="margin-top:4px;font-size:11.5px">' + esc(P.me().name) + '님은 화면을 보지 않아요!</div></div>' : '') +
      /* 🏆 1:1 전적 · 연승 · 칭호 */
      '<div class="pvp-panel">' +
        '<div class="pvp-top">' +
          '<span class="pvp-h">🧒 ' + esc(pr.name) + ' 1:1 전적</span>' +
          '<span class="pvp-title">' + bTitle.name + '</span>' +
        '</div>' +
        '<div class="pvp-nums">' +
          '<span><b>' + pvp.w + '</b><i>승</i></span>' +
          '<span><b>' + pvp.l + '</b><i>패</i></span>' +
          '<span><b>' + pvp.streak + '</b><i>연승</i></span>' +
          '<span><b>' + pvp.best + '</b><i>최고</i></span>' +
        '</div>' +
        '<div class="pvp-vs">' + P.PROFILES.filter(x => x.id !== meId).map(o => {
          const r = pvp.vs[o.id] || { w: 0, l: 0 };
          return '<span>' + esc(pr.name) + ' vs ' + esc(P.prof(o.id).name) + ' <b>' + r.w + ':' + r.l + '</b></span>';
        }).join('') + '</div>' +
        '<div class="pvp-note">사람끼리(1:1) 대전만 기록 · 컴퓨터 대전은 제외' +
          (bNext ? ' · 다음 칭호까지 ' + bNext.need + '승' : ' · 최고 칭호') + '</div>' +
      '</div>' +
      '<div class="card-panel">' +
        '<div class="btn-row" style="margin-bottom:12px">' +
          '<button class="chip' + (ui.mode === 'ai' ? ' active' : '') + '" data-mode="ai">🤖 컴퓨터와 대전</button>' +
          '<button class="chip' + (ui.mode === 'p2' ? ' active' : '') + '" data-mode="p2">🧒 남매 1:1 대전</button>' +
          (ui.mode === 'p2' && ui.p2 ? '<button class="chip small" data-pickp2="1">상대: ' + esc(P.prof(ui.p2).name) + ' ✎</button>' : '') +
        '</div>' +
        (ui.mode === 'ai' ? '<div class="diff-wrap">' +
          '<div class="df-label">🤖 컴퓨터 난이도</div>' +
          '<div class="diff-row">' + DIFFS.map(d =>
            '<button class="diff-btn' + (ui.diff === d.k ? ' active' : '') + '" data-diff="' + d.k + '">' +
            '<b>' + d.emoji + ' ' + d.name + '</b></button>').join('') + '</div>' +
          '<div class="diff-desc">' + diff.desc + ' · 지난번 선택한 난이도로 기억해요</div></div>' : '') +
        '<div class="rules-panel">' +
          '<b>룰</b> · 5장 덱, <b>★코스트 합계 12 이하</b> · 낼 <b>순서 1~5</b> 직접 지정<br>' +
          '<span class="muted">5라운드 동시 공개 → 파워(HP+등급) + 상성 보너스 +30 · 먼저 3승 승리' +
            (ui.mode === 'p2' ? ' <b style="color:#ffe9bf">(+10코인)</b>' : ' · 🤖 연습게임은 <b style="color:#ffb3c1">코인 지급 없음</b>') + '</span>' +
        '</div>' +
        '<div class="budget"><span>내 덱 코스트</span><div class="bar' + (stars > BUDGET ? '' : ' done') + '">' +
          '<i style="width:' + Math.min(100, stars / BUDGET * 100) + '%"></i></div><b>' + stars + ' / ' + BUDGET + '</b>' +
          '<span class="muted" style="font-size:11px">(' + selCards.length + '/5장)</span></div>' +
        '<div class="deck-filter">' +
          '<div class="df-label">속성</div>' +
          '<div class="filter-bar" id="typeRow">' + typeChips + '</div>' +
          '<div class="df-label">코스트</div>' +
          '<div class="filter-bar" id="costRow">' + costChips + '</div>' +
          '<div class="df-label">정렬</div>' +
          '<div class="filter-bar" id="sortRow">' + sortChips + '</div>' +
        '</div>' +
        '<div class="auto-row">' +
          '<button class="btn gold sm" id="autoBest">⚡ 최강 자동</button>' +
          '<button class="btn ghost sm" id="autoRandom">🎲 랜덤 5장</button>' +
          '<button class="btn ghost sm" id="autoFav">⭐ 최애 우선</button>' +
          '<button class="btn ghost sm" id="clearDeck">지우기</button>' +
        '</div>' +
        '<div class="muted" style="font-size:11px;margin-top:8px;line-height:1.6">카드를 누를 때마다 1장씩 추가돼요(보유 장수까지). 다시 누르면 빠져요.<br>남은 코스트로는 못 넣는 카드는 흐리게 + <b style="color:#ffb3c1">★부족</b> 표시!</div>' +
      '</div>' +
      trayHtml +
      '<div class="h2">💾 나만의 덱 <span class="muted" style="font-size:11px">' + esc(pr.name) + ' 전용 3칸</span></div>' +
      '<div class="card-panel" style="padding:11px">' +
        '<div class="dk-head"><span class="muted" style="font-size:11.5px;line-height:1.5">5장을 고른 뒤 저장하면 다음에 한 번에 불러와요.<br>☁️ 태블릿에도 같이 저장돼요.</span>' +
          '<button class="btn gold sm" id="saveDeck">💾 저장</button></div>' +
        '<div class="dk-grid">' + slotHtml + '</div>' +
      '</div>' +
      '<div class="h2">내 카드에서 5장 고르기 <span class="muted" style="font-size:11px">' +
        cards.length + '종 보유' + (shownCards.length !== cards.length ? ' · ' + shownCards.length + '종 표시' : '') + '</span></div>' +
      listHtml +
      orderBox +
      (okDeck ? '' : '<div class="muted" style="margin:14px 2px;color:#ffb3c1">5장을 고르고 코스트 12 이하로 맞춰 주세요. (현재 ' + selCards.length + '장)</div>');

    /* ---- 이벤트 ---- */
    root.querySelectorAll('[data-ftype]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap(); ui.fType = b.dataset.ftype; renderSetup(root);
    }));
    root.querySelectorAll('[data-fcost]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap();
      ui.fCost = b.dataset.fcost === 'all' ? 'all' : +b.dataset.fcost;   /* 숫자로 보관해야 칩 활성 표시가 맞는다 */
      renderSetup(root);
    }));
    root.querySelectorAll('[data-fsort]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap(); ui.sort = b.dataset.fsort; renderSetup(root);
    }));

    root.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.pick;
      const c = window.PKDex.findCard(id);
      if (!c) return;
      const owned = P.prof(meId).cards[id] || 0;
      const n = ui.sel.filter(x => x === id).length;
      const cur = ui.sel.reduce((a, x) => { const cc = window.PKDex.findCard(x); return a + (cc ? D.stars(cc.r) : 0); }, 0);
      A.sfx.tap();
      if (n > 0) {
        ui.sel = ui.sel.filter(x => x !== id);
        ui.order = ui.order.filter(x => x !== id);
      } else if (cur + D.stars(c.r) > BUDGET) {
        A.sfx.error();
        const left = Math.max(0, BUDGET - cur);
        P.toast(left > 0 ? '남은 코스트가 부족해요! (★' + left + ' 남음)' : '남은 코스트가 없어요! 다른 카드를 빼 보세요');
        return;
      } else if (n >= owned) {
        P.toast('이 카드는 ' + owned + '장 보유하고 있어요'); return;
      } else if (ui.sel.length >= 5) {
        P.toast('5장까지만 고를 수 있어요'); return;
      } else {
        ui.sel.push(id);
      }
      ui.noAuto = false;
      P.prof(meId).deck = ui.sel.slice();
      P.save();
      renderSetup(root);
    }));

    /* 🃏 트레이 — 그 자리에서 바로 빼기 */
    root.querySelectorAll('[data-tpop]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.tpop;
      const id = ui.sel[i];
      if (id == null) return;
      ui.sel.splice(i, 1);
      ui.order = ui.order.filter(x => x !== id);
      ui.noAuto = true;      /* 뺀 뒤 자동으로 다시 채우지 않는다 */
      P.prof(meId).deck = ui.sel.slice();
      P.save();
      A.sfx.tap(); P.haptic(8);
      P.toast('덱에서 뺐어요 (' + ui.sel.length + '/5장)');
      renderSetup(root);
    }));

    function applyAuto(ids, label) {
      if (!ids || !ids.length) { A.sfx.error(); P.toast('고를 수 있는 카드가 없어요'); return; }
      ui.sel = ids.slice(0, 5);
      ui.order = [];
      ui.noAuto = false;
      P.prof(meId).deck = ui.sel.slice();
      P.save();
      A.sfx.sparkle(); P.haptic(12);
      if (ui.sel.length < 5) P.toast(label + ' · 코스트 12 안에서 ' + ui.sel.length + '장만 골랐어요');
      else P.toast(label + ' 완료!', true);
      renderSetup(root);
    }
    const ab = root.querySelector('#autoBest');
    if (ab) ab.addEventListener('click', () => applyAuto(deckBest(cards, meId), '⚡ 최강 자동'));
    const ar = root.querySelector('#autoRandom');
    if (ar) ar.addEventListener('click', () => applyAuto(deckRandom(cards, meId), '🎲 랜덤 5장'));
    const af = root.querySelector('#autoFav');
    if (af) af.addEventListener('click', () => applyAuto(deckFav(cards, meId), '⭐ 최애 우선'));
    const cd = root.querySelector('#clearDeck');
    if (cd) cd.addEventListener('click', () => {
      ui.sel = []; ui.order = []; ui.noAuto = true; P.prof(meId).deck = []; P.save(); renderSetup(root);
    });

    /* ---- 덱 3칸 ---- */
    function doSave(i) {
      if (ui.sel.length !== 5) { A.sfx.error(); P.toast('5장을 먼저 골라 주세요'); return; }
      const cost = ui.sel.reduce((a, id) => { const c = window.PKDex.findCard(id); return a + (c ? D.stars(c.r) : 0); }, 0);
      if (cost > BUDGET) { A.sfx.error(); P.toast('코스트 12를 넘어 저장할 수 없어요'); return; }
      setSlot(meId, i, ui.sel);
      A.sfx.sparkle(); P.haptic(12);
      P.toast('덱' + (i + 1) + '에 저장했어요!', true);
      renderSetup(root);
    }
    function doLoad(i) {
      const ids = getSlots(meId)[i];
      if (!ids) return;
      const out = [];
      const used = {};
      let cost = 0, lost = 0;
      ids.forEach(id => {
        const c = window.PKDex.findCard(id);
        const own = pr.cards[id] || 0;
        const st = c ? D.stars(c.r) : 0;
        if (!c || (used[id] || 0) >= own || out.length >= 5 || cost + st > BUDGET) { lost++; return; }
        used[id] = (used[id] || 0) + 1; cost += st; out.push(id);
      });
      ui.sel = out;
      ui.noAuto = false;
      ui.order = ui.order.filter(id => out.indexOf(id) >= 0);
      pr.deck = out.slice();
      P.save();
      A.sfx.sparkle(); P.haptic(10);
      if (lost) P.toast('덱' + (i + 1) + ' 불러옴 · 카드 ' + lost + '장은 없어서 못 넣었어요');
      else P.toast('덱' + (i + 1) + ' 불러왔어요!', true);
      renderSetup(root);
    }

    function slotLoad(el) {
      A.sfx.tap();
      doLoad(+el.dataset.slotLoad);
    }
    root.querySelectorAll('[data-slot-load]').forEach(el => {
      el.addEventListener('click', ev => {
        if (ev.target.closest('[data-slot-del]')) return;
        slotLoad(el);
      });
      el.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); slotLoad(el); }
      });
    });
    root.querySelectorAll('[data-slot-del]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      const i = +b.dataset.slotDel;
      A.sfx.tap();
      P.confirmBox('덱 삭제', '덱' + (i + 1) + '에 저장된 덱을 지울까요?', '🗑 지우기').then(ok => {
        if (!ok) return;
        setSlot(meId, i, null);
        P.toast('덱' + (i + 1) + '을 지웠어요');
        renderSetup(root);
      });
    }));
    root.querySelectorAll('[data-slot-save]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.slotSave;
      A.sfx.tap();
      doSave(i);
    }));
    const sd = root.querySelector('#saveDeck');
    if (sd) sd.addEventListener('click', () => {
      A.sfx.tap();
      if (ui.sel.length !== 5) { A.sfx.error(); P.toast('5장을 먼저 골라 주세요'); return; }
      const cur = getSlots(meId);
      const body = P.el('div');
      body.innerHTML = '<p class="muted" style="margin:0 0 10px">지금 고른 5장을 어느 칸에 저장할까요?</p>' +
        '<div class="list">' + [0, 1, 2].map(i => {
          const ids = cur[i];
          const names = ids ? ids.map(id => { const c = window.PKDex.findCard(id); return c ? c.name : '?'; }) : [];
          return '<button class="row" data-save="' + i + '"><div class="grow"><b>덱' + (i + 1) + '</b>' +
            '<small>' + (ids ? '저장됨 · ★' + slotCost(ids) + ' · ' + names.length + '장 (덮어쓰기)' : '비어 있음') + '</small></div>' +
            '<span class="btn sm ' + (ids ? 'ghost' : 'primary') + '">' + (ids ? '덮어쓰기' : '저장') + '</span></button>';
        }).join('') + '</div>';
      const m = P.modal({ title: '💾 덱 저장', body, buttons: [{ label: '✕ 닫기', kind: 'ghost' }] });
      body.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.save;
        A.sfx.tap();
        if (cur[i]) {
          P.confirmBox('덮어쓰기', '덱' + (i + 1) + '에 저장된 덱을 지우고 지금 덱으로 바꿀까요?', '💾 덮어쓰기').then(ok => {
            if (!ok) return;
            m.close(true); doSave(i);
          });
          return;
        }
        m.close(true); doSave(i);
      }));
    });

    /* 순서 지정 */
    root.querySelectorAll('[data-place]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.place;
      if (ui.order.indexOf(id) >= 0) return;
      if (ui.order.length >= 5) { P.toast('순서는 5장까지 정할 수 있어요'); return; }
      ui.order.push(id); A.sfx.tap(); renderSetup(root);
    }));
    root.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.slot;
      if (ui.order[i]) { ui.order.splice(i, 1); A.sfx.tap(); renderSetup(root); }
    }));
    const ao = root.querySelector('#autoOrder');
    if (ao) ao.addEventListener('click', () => {
      const arr = ui.sel.slice();
      // 약한 카드부터 → 강한 카드 순 (역순 배치)
      arr.sort((a, b) => {
        const ca = window.PKDex.findCard(a), cb = window.PKDex.findCard(b);
        return power(ca, meId) - power(cb, meId);
      });
      ui.order = arr; A.sfx.sparkle(); renderSetup(root);
    });
    const rb = root.querySelector('#readyBtn');
    if (rb) rb.addEventListener('click', () => {
      if (ui.mode === 'p2' && !ui.p2) {
        pickP2(P.PROFILES.filter(p => p.id !== P.state.active), true);
        return;
      }
      onReady(root);
    });

    root.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap(); P.haptic(8);
      ui.diff = setDiff(b.dataset.diff);
      P.toast('🤖 컴퓨터 난이도 · ' + diffOf(ui.diff).name, true);
      renderSetup(root);
    }));
    root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap();
      ui.mode = b.dataset.mode;
      if (ui.mode === 'p2' && !ui.p2) {
        pickP2(P.PROFILES.filter(p => p.id !== P.state.active), false);
      } else renderSetup(root);
    }));
    const pp = root.querySelector('[data-pickp2]');
    if (pp) pp.addEventListener('click', () => {
      A.sfx.tap();
      pickP2(P.PROFILES.filter(p => p.id !== P.state.active), false);
    });

    if (battleOn) requestAnimationFrame(() => { try { window.scrollTo(0, keepY); } catch (e) { /* */ } });
  }

  function pickP2(others, thenReady) {
    const body = P.el('div');
    body.innerHTML = '<p class="muted" style="margin:0 0 10px">누구와 대결할까요? 상대도 자기 카드로 5장 덱 순서를 정해요.</p>' +
      '<div class="list">' + others.map(o =>
        '<button class="row" data-p2="' + o.id + '"><div class="avatar">' + o.emoji + '</div>' +
        '<div class="grow"><b>' + esc(P.prof(o.id).name) + '</b><small>보유 ' + U.uniqueCards(P.prof(o.id)) + '종</small></div>' +
        '<span class="btn sm primary">선택</span></button>').join('') + '</div>';
    const m = P.modal({ title: '🤝 대전 상대 선택', body, buttons: [{ label: '✕ 나가기', kind: 'ghost' }] });
    body.querySelectorAll('[data-p2]').forEach(b => b.addEventListener('click', () => {
      ui.p2 = b.dataset.p2;
      ui.mode = 'p2';
      m.close(true);
      if (thenReady) { onReady(); return; }
      render();
    }));
  }

  /* 준비 완료 → 2P 대전이면 패 가림 전환, 아니면 아레나 */
  function onReady(root) {
    const meId = ui.turn === 0 ? P.state.active : ui.p2;
    P.prof(meId).deck = ui.sel.slice();
    P.save();
    if (ui.turn === 0) {
      ui.p1Deck = ui.sel.slice();
      ui.p1Order = ui.order.slice();
      if (ui.mode === 'p2') {
        ui.turn = 1;
        ui.sel = [];
        ui.noAuto = false;
        ui.order = [];
        ui.step = 'pass';
        render();
        return;
      }
      startBattle();
      return;
    }
    ui.p2Deck = ui.sel.slice();
    ui.p2Order = ui.order.slice();
    startBattle();
  }

  function renderPass(root) {
    const p2 = P.prof(ui.p2);
    const p1 = P.me();
    root.innerHTML =
      '<div class="h1">🤝 기기를 넘겨주세요</div>' +
      '<div class="card-panel" style="text-align:center;padding:26px 18px">' +
        '<div style="font-size:46px;margin-bottom:6px">🙈</div>' +
        '<div style="font-size:17px;font-weight:900;margin-bottom:6px">' + esc(p2.name) + ' 차례!</div>' +
        '<div class="muted" style="font-size:12.5px;line-height:1.7">' + esc(p1.name) + '님이 정한 순서는 가려져 있어요.<br>' +
          '기기를 ' + esc(p2.name) + '에게 건네고 준비되면 아래 버튼을 눌러 주세요.</div>' +
        '<button class="btn gold wide" id="passGo" style="margin-top:18px;padding:15px">준비됐어요 · ' + esc(p2.name) + ' 순서 정하기</button>' +
      '</div>';
    root.querySelector('#passGo').addEventListener('click', () => {
      A.sfx.tap();
      ui.step = 'deck';
      render();
    });
  }

  /* ---------------- 아레나 ---------------- */
  /* ---------------- 🤖 컴퓨터 덱 — 난이도별 ----------------
     · 보통: 예전처럼 3팩을 섞어 무작위로 (강한 카드 1장 포함)
     · 어려움: 후보 카드 중 '코스트 12 안에서 전투력 합이 가장 큰 5장'을 고른다.
       상성(불꽃>풀…)은 상대 카드를 보고 고르므로 아래 hardPickFoe 가 처리한다. */
  function rawPower(c) { return (c.hp || 40) + (TIER_BONUS[c.r] || 0); }
  function bestDeckIds(pool) {
    /* 코스트 12 · 5장 정확히 — (코스트, 장수) 배낭 DP 로 '전투력 합 최대' 조합을 찾는다.
       (탐욕적으로 세다 보면 12 예산에 5장이 안 맞아 더 약한 조합이 뽑히는 일이 있어 DP 로 정확히) */
    const N = 5;
    const dp = [];
    for (let c = 0; c <= BUDGET; c += 1) { const row = []; for (let n = 0; n <= N; n += 1) row.push(null); dp.push(row); }
    dp[0][0] = { pow: 0, ids: [] };
    for (const c of pool) {
      const st = D.stars(c.r);
      if (!(st <= BUDGET)) continue;
      for (let cost = BUDGET; cost >= st; cost -= 1) {
        for (let n = N; n >= 1; n -= 1) {
          const prev = dp[cost - st][n - 1];
          if (!prev) continue;
          if (prev.ids.indexOf(c.id) >= 0) continue;
          const val = prev.pow + rawPower(c);
          if (!dp[cost][n] || val > dp[cost][n].pow) dp[cost][n] = { pow: val, ids: prev.ids.concat([c.id]) };
        }
      }
    }
    let best = null;
    for (let cost = 0; cost <= BUDGET; cost += 1) {
      const cur = dp[cost][N];
      if (cur && (!best || cur.pow > best.pow)) best = cur;
    }
    return best ? best.ids : [];
  }
  async function aiDeckIds(level) {
    const packs = D.allPacks();
    const picks = [];
    for (let i = 0; i < 3 && picks.length < 9; i++) {
      const p = packs[Math.floor(Math.random() * packs.length)];
      try {
        const d = await window.PKDex.ensurePack(p.id);
        picks.push.apply(picks, d.cards.slice(0, 220));
      } catch (e) { }
    }
    const pool = picks.filter(c => c && D.stars(c.r) <= BUDGET);
    /* 어려움 — 예산 12 안에서 가장 센 5장 */
    if (level === 'hard' && pool.length >= 5) {
      const strong = bestDeckIds(pool);
      if (strong.length === 5) return strong;
    }
    const out = [];
    let left = BUDGET;
    const shuffled = pool.filter(c => D.stars(c.r) <= left).sort(() => Math.random() - 0.5);
    const strong = shuffled.filter(c => D.stars(c.r) >= 4).slice(0, 1);
    strong.forEach(c => { if (D.stars(c.r) <= left) { out.push(c); left -= D.stars(c.r); } });
    for (const c of shuffled) {
      if (out.length >= 5) break;
      if (D.stars(c.r) <= left && out.indexOf(c) < 0) { out.push(c); left -= D.stars(c.r); }
    }
    return out.slice(0, 5).map(c => c.id);
  }

  async function deckFor(profileId) {
    const pr = P.prof(profileId);
    const owned = await ownedCardList(profileId);
    let sel = (pr.deck || []).filter(id => pr.cards[id]).slice(0, 5);
    let stars = sel.reduce((a, id) => { const c = window.PKDex.findCard(id); return a + (c ? D.stars(c.r) : 0); }, 0);
    if (sel.length < 5 || stars > BUDGET) sel = autoDeck(owned, profileId);
    return sel.map(id => window.PKDex.findCard(id)).filter(Boolean);
  }

  async function startBattle() {
    if (ui.arenaEl) return;
    A.unlock();
    const meId = P.state.active;
    const ord1 = ui.p1Order && ui.p1Order.length === 5 ? ui.p1Order : ui.order;
    let mine = ord1.map(id => window.PKDex.findCard(id)).filter(Boolean);
    if (mine.length < 5) mine = (await deckFor(meId));
    let foe, foeName, foeProfile = null;
    if (ui.mode === 'ai') {
      foe = (await aiDeckIds(ui.diff)).map(id => window.PKDex.findCard(id)).filter(Boolean);
      if (foe.length < 5) {
        const p = await deckFor(meId);
        foe = p.slice();
      }
      foeName = '🤖 컴퓨터 · ' + diffOf(ui.diff).name;
    } else {
      foeProfile = ui.p2;
      const ord = ui.p2Order && ui.p2Order.length === 5 ? ui.p2Order : [];
      foe = ord.map(id => window.PKDex.findCard(id)).filter(Boolean);
      if (foe.length < 5) foe = await deckFor(ui.p2);
      if (foe.length < 5) foe = (await aiDeckIds(ui.diff)).map(id => window.PKDex.findCard(id)).filter(Boolean);
      foeName = P.prof(ui.p2).name;
    }
    if (mine.length < 5 || foe.length < 5) { P.toast('5장 덱이 필요해요'); ui.step = 'deck'; render(); return; }

    ui.bt = {
      mode: ui.mode, round: 0, score: [0, 0], results: [],
      me: { profile: meId, name: P.me().name, deck: mine.slice() },
      foe: { profile: foeProfile, name: foeName, deck: foe.slice() },
      phase: 'ready',
      base: [0, 0], final: [0, 0], mult: [1, 1],
      pickA: null, pickC: null, advA: false, advB: false,
      dead: false
    };
    ui.step = 'arena';
    openArena();
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));
  function preload(src) {
    return new Promise(res => {
      let done = false;
      const fin = () => { if (!done) { done = true; res(); } };
      const im = new Image();
      im.onload = fin; im.onerror = fin;
      im.src = src;
      setTimeout(fin, 260);
    });
  }
  function alive() { return !!(ui.bt && !ui.bt.dead && ui.arenaEl); }
  function msg(html) { if (alive()) ui.arenaEl.querySelector('#arenaMsg').innerHTML = html; }
  function q(sel) { return ui.arenaEl ? ui.arenaEl.querySelector(sel) : null; }

  function closeArena() {
    if (ui.bt) ui.bt.dead = true;
    if (ui.arenaEl) { ui.arenaEl.remove(); ui.arenaEl = null; }
    document.body.classList.remove('arena-on');
    A.setMode('home');
    ui.bt = null;
    ui.step = 'deck';
    ui.turn = 0;
    ui.sel = [];
    ui.noAuto = false;
    ui.order = [];
    render();
  }

  function openArena() {
    const b = ui.bt;
    const el = P.el('div', 'arena');
    el.innerHTML =
      '<div class="arena-sky"></div><div class="arena-floor"></div>' +
      '<div class="arena-inner">' +
        '<div class="arena-top">' +
          '<div class="arena-title">BATTLE ARENA</div>' +
          '<div class="arena-top-btns">' +
            '<button class="arena-gear" id="arenaGear" aria-label="배틀 설정" title="설정">⚙️</button>' +
            '<button class="arena-close" id="arenaQuit" aria-label="배틀 나가기">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="hud">' +
          '<div class="hud-side a"><div class="hud-name">' + esc(b.me.name) + '</div><div class="pips a" id="pipsA"></div></div>' +
          '<div class="round-chip"><b id="roundNum">1</b><span>ROUND</span></div>' +
          '<div class="hud-side b"><div class="hud-name">' + esc(b.foe.name) + '</div><div class="pips b" id="pipsB"></div></div>' +
        '</div>' +
        '<div class="duel-zone">' +
          '<div class="duel">' +
            '<div class="dside empty" id="sideA">' +
              '<div class="dslot"><span>1P</span></div>' +
              '<div class="dcard" id="cardA"><div class="inner">' +
                '<div class="dface back"></div>' +
                '<div class="dface front"><img id="imgA" alt=""><div class="holo"></div>' +
                  '<span class="pw-badge" id="cbadgeA"></span></div>' +
              '</div></div>' +
              '<div class="fx-layer" id="fxA"></div>' +
              '<div class="pow-tag" id="powA"></div>' +
            '</div>' +
            '<div class="vs-mark">VS</div>' +
            '<div class="dside empty" id="sideB">' +
              '<div class="dslot"><span>2P</span></div>' +
              '<div class="dcard" id="cardB"><div class="inner">' +
                '<div class="dface back"></div>' +
                '<div class="dface front"><img id="imgB" alt=""><div class="holo"></div>' +
                  '<span class="pw-badge" id="cbadgeB"></span></div>' +
              '</div></div>' +
              '<div class="fx-layer" id="fxB"></div>' +
              '<div class="pow-tag" id="powB"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="arena-msg" id="arenaMsg">' +
          '카드를 엎어 두고 시작을 기다리는 중…<span class="sub">1라운드 · ' + esc(b.me.name) + ' vs ' + esc(b.foe.name) + '</span>' +
        '</div>' +
        '<div class="action-zone" id="actionZone"></div>' +
        '<div class="decks">' +
          '<div class="deckcol a">' +
            '<div class="deck-label"><b>' + esc(b.me.name) + '</b><span>1P</span></div>' +
            '<div class="deck-row" id="deckA"></div>' +
          '</div>' +
          '<div class="deckcol b">' +
            '<div class="deck-label"><span>2P</span><b>' + esc(b.foe.name) + '</b></div>' +
            '<div class="deck-row" id="deckB"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    ui.arenaEl = el;
    document.body.classList.add('arena-on');
    A.setMode('battle');
    el.querySelector('#arenaGear').addEventListener('click', () => {
      A.sfx.tap();
      if (P.isAdmin()) { openSpeedModal(); return; }
      P.pinPrompt('🔒 아빠 확인', () => { openSpeedModal(); });
    });
    el.querySelector('#arenaQuit').addEventListener('click', async () => {
      const ok = await P.confirmBox('배틀 종료', '지금 나가면 기록이 저장되지 않아요. 나갈까요?', '나가기');
      if (ok) closeArena();
    });
    paintPips();
    enterRound();
  }

  function paintPips() {
    const b = ui.bt;
    if (!alive()) return;
    const a = q('#pipsA'), c = q('#pipsB');
    a.innerHTML = [0, 1, 2].map(i => '<i class="' + (b.score[0] > i ? 'on' : '') + '"></i>').join('');
    c.innerHTML = [0, 1, 2].map(i => '<i class="' + (b.score[1] > i ? 'on' : '') + '"></i>').join('');
    q('#roundNum').textContent = String(Math.min(5, b.round + 1));
  }

  /* 하단 좌·우 5장 대기열 (실제 카드 뒷면) */
  function paintDecks() {
    const b = ui.bt;
    if (!alive()) return;
    [['A', b.me.deck], ['B', b.foe.deck]].forEach(pair => {
      const row = q('#deck' + pair[0]);
      if (!row) return;
      row.innerHTML = pair[1].map((c, i) => {
        const st = i < b.round ? ' used' : (i === b.round ? ' next' : '');
        return '<div class="deck-card' + st + '" data-i="' + i + '" title="' + esc(c ? c.name : '') + '"></div>';
      }).join('');
    });
  }

  function showCta(label) {
    if (!alive()) return;
    const az = q('#actionZone');
    az.innerHTML = '<div class="arena-cta"><button class="btn gold" id="battleGo">' + label + '</button></div>';
    az.querySelector('#battleGo').addEventListener('click', onGo);
  }
  function clearCta() { const az = q('#actionZone'); if (az) az.innerHTML = ''; }

  /* 라운드 준비: 배틀존 비우고 대기열 재도색 */
  /* 🤖 어려움 — 상대 카드를 보고 상성 유리 카드를 골라 낸다(60%), 아니면 계획된 순서대로 */
  function hardPickFoe(b) {
    const cur = b.foe.deck[b.round];
    const left = b.foe.deck.filter((c, i) => c && i >= b.round);
    if (!left.length || !b.pickA) return cur;
    if (Math.random() >= 0.6) return cur;
    const mine = b.pickA;
    let best = null, bestScore = -1e9;
    for (const c of left) {
      const adv = advantage(c, mine) ? 1 : 0;
      const hurt = advantage(mine, c) ? 1 : 0;
      const sc = adv * 1000 + rawPower(c) - hurt * 400;
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return best || cur;
  }
  function enterRound() {
    const b = ui.bt;
    if (!alive()) return;
    b.phase = 'ready';
    b.pickA = b.me.deck[b.round];
    /* 어려움 — 상성 좋은 카드를 이번 순서 자리로 끌어온다(남은 카드끼리 자리만 바꾼다) */
    if (b.mode === 'ai' && ui.diff === 'hard') {
      const pick = hardPickFoe(b);
      if (pick && b.foe.deck[b.round] && pick.id !== b.foe.deck[b.round].id) {
        const j = b.foe.deck.findIndex(c => c && c.id === pick.id);
        if (j > b.round) { b.foe.deck[j] = b.foe.deck[b.round]; b.foe.deck[b.round] = pick; }
      }
    }
    b.pickC = b.foe.deck[b.round];
    b.mult = [1, 1];
    b.base = [0, 0];
    b.final = [0, 0];
    ['A', 'B'].forEach(s => {
      const dside = q('#side' + s);
      const dc = q('#card' + s);
      const pw = q('#pow' + s);
      const fx = q('#fx' + s);
      if (dside) dside.className = 'dside empty';
      if (dc) { dc.className = 'dcard'; dc.style.cssText = ''; }
      if (pw) { pw.className = 'pow-tag'; pw.textContent = ''; }
      if (fx) fx.innerHTML = '';
      if (dside) Array.prototype.slice.call(dside.querySelectorAll('.ko-tag,.dmg-pop')).forEach(x => x.remove());
    });
    paintDecks();
    paintPips();
    msg((b.round + 1) + '라운드 · 두 카드가 엎어진 채 대기 중!<span class="sub">' +
      (b.round === 0 ? '아래 대기열의 1번 카드가 배틀존으로 날아가요' : '왼쪽 아래 · 오른쪽 아래 5장 대기열') + '</span>');
    showCta(b.round === 0 ? '⚔️ 배틀 시작!' : (b.round + 1) + '라운드 시작 ▶');
  }

  /* 대기열 카드 → 배틀존 비행 + 동시 플립 */
  function flyIn(side, card) {
    const b = ui.bt;
    if (!alive()) return;
    const s = side ? 'B' : 'A';
    const dside = q('#side' + s);
    const dc = q('#card' + s);
    const img = q('#img' + s);
    if (!dside || !dc || !img) return;
    img.removeAttribute('src');
    void img.offsetWidth;
    img.src = D.img(card.img);
    img.alt = card.name;
    /* ⚡ 카드 이미지 위 1:1 승리 파워 배지 (컴퓨터 카드는 승수 기록이 없어 표시되지 않는다) */
    const badge = q('#cbadge' + s);
    if (badge) {
      const n = P.cardWinCount(side ? b.foe.profile : b.me.profile, card.id);
      badge.textContent = n > 0 ? '⚡+' + (n * CARD_WIN_POWER) : '';
      badge.classList.toggle('show', n > 0);
    }
    dc.className = 'dcard' + (card.r === 5 ? ' r5' : card.r === 4 ? ' r4' : '');
    dc.style.cssText = '';
    dside.classList.remove('empty', 'win', 'lose', 'clearing');

    const thumb = q('#deck' + s + ' .deck-card[data-i="' + b.round + '"]');
    let dx = 0, dy = 0, sc = 1, rot = 0;
    if (thumb) {
      const tr = thumb.getBoundingClientRect();
      const cr = dc.getBoundingClientRect();
      if (cr.width > 1 && tr.width > 1) {
        dx = (tr.left + tr.width / 2) - (cr.left + cr.width / 2);
        dy = (tr.top + tr.height / 2) - (cr.top + cr.height / 2);
        sc = tr.width / cr.width;
        rot = side ? 14 : -14;
      }
      thumb.classList.add('used');
      thumb.classList.remove('next');
    }
    dc.style.transition = 'none';
    dc.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ') rotate(' + rot + 'deg)';
    dc.style.opacity = '0.99';
    void dc.offsetWidth;
    requestAnimationFrame(() => {
      if (!dc) return;
      dc.style.transition = '';
      dc.style.transform = '';
      dc.style.opacity = '';
      dc.classList.add('flip');
    });
  }

  let busyRound = false;
  function onGo() {
    if (busyRound) return;
    const b = ui.bt;
    if (!alive()) return;
    if (b.phase === 'ready') { startRound(); return; }
    if (b.phase === 'result') { nextRound(); return; }
  }

  async function startRound() {
    if (busyRound || !alive()) return;
    const b = ui.bt;
    if (b.phase !== 'ready') return;
    const a = b.pickA, c = b.pickC;
    if (!a || !c) { P.toast('카드를 불러오지 못했어요'); return; }
    busyRound = true;
    b.phase = 'flip';
    clearCta();

    await Promise.all([preload(D.img(a.img)), preload(D.img(c.img))]);
    if (!alive()) { busyRound = false; return; }

    flyIn(0, a);
    flyIn(1, c);
    A.sfx.whoosh();
    msg('카드가 대기열에서 배틀존으로 날아간다…!<span class="sub">' + esc(a.name) + ' vs ' + esc(c.name) + '</span>');
    await wait(110);
    if (!alive()) return;
    A.sfx.flip();
    await wait(720);
    if (!alive()) { busyRound = false; return; }

    const advA = advantage(a, c), advB = advantage(c, a);
    b.advA = advA; b.advB = advB;
    const pa = power(a, b.me.profile) + (advA ? ADV : 0);
    const pb = power(c, b.foe.profile) + (advB ? ADV : 0);
    b.base = [pa, pb];
    b.final = [pa, pb];
    const powA = q('#powA'), powB = q('#powB');
    if (powA) { powA.innerHTML = '파워 <b>' + pa + '</b>' + (advA ? ' · 상성+30' : ''); powA.classList.add('show'); }
    if (powB) { powB.innerHTML = '파워 <b>' + pb + '</b>' + (advB ? ' · 상성+30' : ''); powB.classList.add('show'); }
    A.sfx.tap();
    await wait(640);
    if (!alive()) { busyRound = false; return; }

    await barPhase();
    if (!alive()) { busyRound = false; return; }

    const fa = b.final[0], fb = b.final[1];
    const win = fa > fb ? 0 : fb > fa ? 1 : -1;
    b.results.push({
      a: a.id, c: c.id, pa: fa, pb: fb, base: [pa, pb],
      mult: [b.mult[0], b.mult[1]], advA: advA, advB: advB, win: win
    });
    if (win === 0) b.score[0]++;
    else if (win === 1) b.score[1]++;
    playRound(win, fa, fb);
  }

  /* ---------------- 타이밍 바 미니게임 ---------------- */
  function rollZones() {
    /* ×1.5(15%) · ×2(9.5%) · ×3(5.5%) 세 칸을 독립 랜덤 배치 (높은 배수 우선) */
    const W = { m15: 0.15, m2: 0.095, m3: 0.055 };
    const order = [
      { k: 'm15', w: W.m15 },
      { k: 'm2',  w: W.m2  },
      { k: 'm3',  w: W.m3  }
    ];
    /* 1) 세 칸 순서 섞기 */
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    /* 2) 평소 78% 각자 따로, 16% 2칸 붙음, 6% 3칸 연달아 뭉침 보너스! */
    const pos = {};
    const cluster = Math.random();
    if (cluster < 0.06) {
      /* 6% 확률: 세 칸 연달아 뭉침 보너스! */
      const total = W.m15 + W.m2 + W.m3;
      let cur = 0.08 + Math.random() * (0.84 - total);
      order.forEach(o => { pos[o.k] = [cur, cur + o.w]; cur += o.w; });
    } else if (cluster < 0.22) {
      /* 16% 확률: 두 칸이 나란히 붙고 한 칸은 떨어짐 */
      const pairW = order[0].w + order[1].w;
      const gap = 0.06 + Math.random() * 0.22;
      const leftFirst = Math.random() < 0.5;
      const span = pairW + gap + order[2].w;
      let cur = 0.07 + Math.random() * Math.max(0.05, 0.86 - span);
      if (leftFirst) {
        pos[order[0].k] = [cur, cur + order[0].w]; cur += order[0].w;
        pos[order[1].k] = [cur, cur + order[1].w]; cur += order[1].w + gap;
        pos[order[2].k] = [cur, cur + order[2].w];
      } else {
        pos[order[2].k] = [cur, cur + order[2].w]; cur += order[2].w + gap;
        pos[order[0].k] = [cur, cur + order[0].w]; cur += order[0].w;
        pos[order[1].k] = [cur, cur + order[1].w];
      }
    } else {
      /* 58% 확률: 세 칸 모두 독립적으로 떨어져 배치 */
      const sumW = W.m15 + W.m2 + W.m3;
      const slack = Math.max(0.04, 0.86 - sumW);
      const r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
      const s = r1 + r2 + r3 || 1;
      const g1 = 0.04 + (slack - 0.08) * (r1 / s);
      const g2 = 0.04 + (slack - 0.08) * (r2 / s);
      let cur = 0.07 + (slack - 0.08) * (r3 / s) * 0.5;
      pos[order[0].k] = [cur, cur + order[0].w]; cur += order[0].w + g1;
      pos[order[1].k] = [cur, cur + order[1].w]; cur += order[1].w + g2;
      pos[order[2].k] = [cur, cur + order[2].w];
    }
    return pos;
  }
  function zoneOf(zn, r) {
    if (r >= zn.m3[0] && r <= zn.m3[1]) return 3;
    if (r >= zn.m2[0] && r <= zn.m2[1]) return 2;
    if (r >= zn.m15[0] && r <= zn.m15[1]) return 1.5;
    return 0;
  }
  function barHint(base, other) {
    if (base > other) return '지금 앞서 있어요 · 맞히면 더 벌려요!';
    if (base * 1.5 > other) return '×1.5만 맞히면 역전!';
    if (base * 2 > other) return '×2 이상 맞히면 역전 가능!';
    if (base * 3 > other) return '×3을 맞히면 역전!';
    return '×3을 맞히면 격차가 크게 줄어요!';
  }

  async function barPhase() {
    const b = ui.bt;
    if (!alive()) return;
    const pa = b.base[0], pb = b.base[1];
    let steps;
    if (pa === pb) {
      steps = [{ side: 0, kind: 'crit' }, { side: 1, kind: 'crit' }];
      msg('완전 동점!<span class="sub">1P → 2P 순서로 둘 다 크리티컬 바를 돌려요</span>');
      await wait(600);
    } else if (pa < pb) {
      steps = [{ side: 0, kind: 'crit' }, { side: 1, kind: 'def' }];
    } else {
      steps = [{ side: 1, kind: 'crit' }, { side: 0, kind: 'def' }];
    }
    for (let i = 0; i < steps.length; i++) {
      if (!alive()) return;
      const st = steps[i];
      const nm = st.side === 0 ? b.me.name : b.foe.name;
      msg((st.kind === 'crit' ? '⚡ ' : '🛡️ ') + esc(nm) + '의 ' + (st.kind === 'crit' ? '크리티컬 찬스!' : '방어 찬스!') +
        '<span class="sub">' + (st.side === 0 ? '1P' : '2P') + ' · 기본 파워 ' + b.base[st.side] + '</span>');
      const res = await runBar(st);
      if (!alive()) return;
      b.mult[st.side] = res.mult;
      const to = Math.round(b.base[st.side] * res.mult);
      b.final[st.side] = to;
      countPower(st.side, b.base[st.side], to, res.mult, st.kind);
      await wait(820);
    }
  }

  function runBar(step) {
    return new Promise(resolve => {
      const b = ui.bt;
      if (!alive()) { resolve({ mult: 1 }); return; }
      const side = step.side;
      const isP1 = side === 0;
      const name = isP1 ? b.me.name : b.foe.name;
      const ai = b.mode === 'ai' && side === 1;
      const base = b.base[side];
      const other = b.final[1 - side];
      const kind = step.kind;

      const az = q('#actionZone');
      if (!az) { resolve({ mult: 1 }); return; }
      const zn = rollZones();
      const zStyle = (pair) => 'left:' + (pair[0] * 100).toFixed(2) + '%;width:' + ((pair[1] - pair[0]) * 100).toFixed(2) + '%;right:auto';
      az.innerHTML =
        '<div class="barbox' + (kind === 'def' ? ' def' : '') + '">' +
          '<div class="bar-head">' +
            '<span class="bar-kind">' + (kind === 'crit' ? '⚡ 크리티컬 바' : '🛡️ 방어 바') + '</span>' +
            '<span class="bar-owner">' + esc(name) + (ai ? ' · ' + diffOf(ui.diff).name : '') + '</span>' +
          '</div>' +
          '<div class="bar-hint">' + barHint(base, other) + '</div>' +
          '<div class="bar-track" id="barTrack">' +
            '<div class="bz z15" style="' + zStyle(zn.m15) + '">×1.5</div>' +
            '<div class="bz z2" style="' + zStyle(zn.m2) + '">×2</div>' +
            '<div class="bz z3" style="' + zStyle(zn.m3) + '">×3</div>' +
            '<div class="mk" id="barMk"></div>' +
          '</div>' +
          '<button class="bar-btn' + (ai ? ' ai' : '') + '" id="barBtn"' + (ai ? ' disabled' : '') + '>' + (ai ? '🤖 컴퓨터가 조준 중…' : '⚡ 지금 터치!') + '</button>' +
        '</div>';

      const track = az.querySelector('#barTrack');
      const mk = az.querySelector('#barMk');
      const btn = az.querySelector('#barBtn');
      const BW = 14, PERIOD = 2300;
      let stopped = false, raf = 0, p = 0, lastZone = -1;
      const t0 = performance.now() + 90;
      /* spd = ⚙️ 설정 배율(barSpeed) — 첫 프레임부터 곱해지고, 바가 도는 중에 바꿔도 다음 프레임에 바로 반영 */
      let spd = barSpeed, phase = 0, prevT = t0;
      /* 🤖 컴퓨터가 이번 바에서 노릴 배수 (0 = 일부러 빗나가기) */
      const aiPlanMult = ai ? aiPlan(ui.diff) : null;
      function clearOfZones(frac) {
        const pad = 0.018;
        return [zn.m15, zn.m2, zn.m3].every(pair => frac < pair[0] - pad || frac > pair[1] + pad);
      }

      function place(now) {
        if (stopped || !alive()) return;
        spd = barSpeed;
        if (now > prevT) {
          phase += ((now - prevT) / PERIOD) * Math.PI * 2 * spd;
          prevT = now;
        }
        p = 0.5 + 0.5 * Math.sin(phase - Math.PI / 2);
        const W = track.clientWidth || 1;
        const cx = p * Math.max(1, W - BW) + BW / 2;
        mk.style.left = cx + 'px';
        const z = zoneOf(zn, cx / W);
        if (z !== lastZone) {
          lastZone = z;
          if (z) { A.sfx.barTick(z); P.haptic(6); }
          track.dataset.zone = String(z);
        }
        /* 🤖 난이도만큼만 맞히는 컴퓨터: 노린 칸에 들어오면 멈추고,
           빗나가기로 정해졌으면 확실히 빈 곳에서 멈춘다. */
        if (ai && aiPlanMult != null && now > t0) {
          if (aiPlanMult > 0) {
            if (z === aiPlanMult && now - t0 > 340) { stop(true); return; }
          } else if (now - t0 > 520 && clearOfZones(cx / W)) {
            stop(true); return;
          }
        }
        raf = requestAnimationFrame(place);
      }

      function stop(force) {
        if (stopped || !alive()) return;
        if (ai && !force) return;
        stopped = true;
        cancelAnimationFrame(raf);
        const W = track.clientWidth || 1;
        const cx = parseFloat(mk.style.left) || 0;
        const mult = zoneOf(zn, cx / W);
        mk.classList.add(mult ? 'hit' : 'miss');
        track.classList.add('done');
        const badge = P.el('div', 'bar-res ' + (mult ? 'ok' : 'no'), mult ? '×' + mult + '!' : 'MISS');
        track.appendChild(badge);
        btn.disabled = true;
        btn.textContent = mult ? '×' + mult + ' 성공!' : '빗나감 ×1.0';
        if (mult) { A.sfx.critHit(mult); P.haptic(mult >= 3 ? 45 : mult >= 2 ? 32 : 20); }
        else { A.sfx.barMiss(); P.haptic(10); }
        setTimeout(() => resolve({ mult: mult || 1 }), 900);
      }

      btn.addEventListener('click', () => stop(false));
      track.addEventListener('click', () => stop(false));
      A.sfx.barStart();
      raf = requestAnimationFrame(place);
      if (ai) {
        /* 안전장치 — 6초 안에 못 멈추면 그 자리에서 멈춘다(화면이 멈춰 보이지 않게) */
        setTimeout(() => { if (!stopped && alive()) stop(true); }, 6000);
      }
    });
  }

  function countPower(side, from, to, mult, kind) {
    if (!alive()) return;
    const tag = q('#pow' + (side ? 'B' : 'A'));
    if (!tag) return;
    const b = ui.bt;
    const adv = side === 0 ? b.advA : b.advB;
    const suffix = adv ? ' · 상성+30' : '';
    tag.classList.add('show');
    const start = performance.now(), dur = 620;
    let lastV = from, lastTick = 0;
    function step(now) {
      if (!alive() || !tag) return;
      const k = Math.min(1, (now - start) / dur);
      const v = Math.round(from + (to - from) * k);
      if (v !== lastV) {
        lastV = v;
        if (now - lastTick > 55) { lastTick = now; A.sfx.barTick(1); }
      }
      tag.innerHTML = '파워 <b>' + v + '</b>' + suffix +
        (k >= 1 && mult !== 1 ? ' <em class="mult-chip' + (kind === 'def' ? ' def' : '') + '">×' + mult + '</em>' : '');
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------------- 공개 결과 · 공격 · KO ---------------- */
  function playRound(win, pa, pb) {
    const b = ui.bt;
    if (!alive()) { busyRound = false; return; }
    const a = b.pickA, c = b.pickC;
    const sideA = q('#sideA'), sideB = q('#sideB');

    if (win === -1) {
      msg('무승부!<span class="sub">' + esc(a.name) + ' ' + pa + ' vs ' + pb + ' ' + esc(c.name) + '</span>');
      A.sfx.tap();
      finishRoundUI(win);
      return;
    }
    const winnerCard = win === 0 ? a : c;
    const winSide = win === 0 ? sideA : sideB;
    const loseSide = win === 0 ? sideB : sideA;
    const winType = winnerCard.t || '무색';

    winSide.classList.add('win');
    attackFx(loseSide, winType);
    A.sfx.attack(winType);
    P.haptic(14);
    msg('<b style="color:#ffe9bf">' + esc(winnerCard.name) + '</b> 의 ' + esc(winType) + ' 공격!<span class="sub">' +
      pa + ' vs ' + pb + '</span>');

    setTimeout(() => {
      if (!alive()) return;
      loseSide.classList.add('lose');
      const kt = P.el('div', 'ko-tag', 'KO!');
      loseSide.appendChild(kt);
      const dmg = P.el('div', 'dmg-pop', '-' + Math.abs(pa - pb));
      loseSide.appendChild(dmg);
      A.sfx.koHit();
      P.haptic(30);
      const rect = loseSide.getBoundingClientRect();
      const dir = win === 0 ? 1 : -1;
      const koCard = q('#card' + (win === 0 ? 'B' : 'A'));
      if (koCard) {
        koCard.style.setProperty('--ko-x', (dir * (rect.width * 0.9 + 120)).toFixed(0) + 'px');
        koCard.style.setProperty('--ko-y', '-260px');
        koCard.style.setProperty('--ko-r', (dir * 620) + 'deg');
      }
    }, 430);

    setTimeout(() => {
      if (!alive()) return;
      msg('<b style="color:#ffe9bf">' + esc(win === 0 ? b.me.name : b.foe.name) + ' 승리!</b><span class="sub">' +
        esc(a.name) + ' ' + pa + ' vs ' + pb + ' ' + esc(c.name) + '</span>');
      A.sfx.roundWin();
      finishRoundUI(win);
    }, 1560);
  }

  function finishRoundUI(win) {
    const b = ui.bt;
    if (!alive()) { busyRound = false; return; }
    b.phase = 'result';
    paintPips();
    const over = b.round >= 4 || b.score[0] >= 3 || b.score[1] >= 3;
    showCta(over ? '🏆 결과 보기' : (b.round + 2) + '라운드 시작 ▶');
    busyRound = false;
    if (ui.mode === 'p2' && win === 0) P.haptic(30);
  }

  function nextRound() {
    const b = ui.bt;
    if (!alive()) return;
    if (b.round >= 4 || b.score[0] >= 3 || b.score[1] >= 3) { finishBattle(); return; }
    busyRound = true;
    clearCta();
    const sa = q('#sideA'), sb = q('#sideB');
    if (sa) sa.classList.add('clearing');
    if (sb) sb.classList.add('clearing');
    b.round++;
    setTimeout(() => {
      if (!alive()) return;
      busyRound = false;
      enterRound();
    }, 300);
  }

  /* ---------------- 속성 공격 이펙트 ---------------- */
  function attackFx(side, type) {
    const fx = side.querySelector('.fx-layer');
    if (!fx) return;
    const color = D.typeColor(type);
    const atk = P.el('div', 'atk');
    atk.style.setProperty('--fx', '70px');
    atk.innerHTML = '<div class="core" style="background:radial-gradient(circle,#fff,' + color + ' 55%,transparent 72%);box-shadow:0 0 26px 8px ' + color + '88"></div>';

    if (type === '번개') {
      atk.innerHTML += '<svg class="bolt" viewBox="0 0 60 100" aria-hidden="true">' +
        '<path d="M34 2 L10 54 h16 L18 98 L52 40 H34 L44 2 Z" fill="#dff6ff" stroke="#8fe3ff" stroke-width="2"/>' +
        '</svg>';
    } else if (type === '풀') {
      for (let i = 0; i < 7; i++) {
        atk.innerHTML += '<div class="leaf" style="--dx:' + ((i - 3) * 22) + 'px;--dy:' + (-40 - i * 8) + 'px;background:linear-gradient(140deg,#b9ff9f,' + color + ');animation-delay:' + (i * 45) + 'ms;transform:rotate(' + (i * 40) + 'deg)"></div>';
      }
    } else {
      atk.innerHTML += '<div class="proj" style="background:radial-gradient(circle,#fff,' + color + ' 60%,transparent 75%);box-shadow:0 0 22px 6px ' + color + '99"></div>';
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        atk.innerHTML += '<i class="p" style="--dx:' + (Math.cos(ang) * 70).toFixed(0) + 'px;--dy:' + (Math.sin(ang) * 70 - 20).toFixed(0) + 'px;background:' + color + '"></i>';
      }
    }
    atk.innerHTML += '<div class="ring" style="border-color:' + color + '"></div>';
    fx.appendChild(atk);
    setTimeout(() => { if (atk.parentNode) atk.remove(); }, 1600);

    const hit = P.el('div');
    hit.className = 'atk';
    hit.style.animationDelay = '.3s';
    hit.innerHTML = '<div class="core" style="animation-delay:.32s;width:90px;height:90px;background:radial-gradient(circle,#fff,' + color + ' 45%,transparent 70%);opacity:.9"></div>';
    fx.appendChild(hit);
    setTimeout(() => hit.remove(), 1700);
  }

  /* ---------------- 결과 ---------------- */
  /* ⚔️ 사람끼리(1:1) 전용 보상 — 컴퓨터 대전에서는 이 함수가 아예 불리지 않는다.
     ① 승/패·연승·최고 연승·상대별 전적  ② 출전 카드 5장 각 +1승(파워 +5)
     ③ 누적 5승마다 랜덤 무료팩 1개  ④ 누적 승수로 칭호 진화(칭호는 승수에서 바로 계산) */
  function pvpRec(pr) {
    pr.pvp = P.pvpOf(pr);
    return pr.pvp;
  }
  function grantRandomFreePack(pr) {
    const packs = D.allPacks();
    if (!packs.length) return null;
    const pack = packs[Math.floor(Math.random() * packs.length)];
    const fp = {
      id: 'fp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      packId: pack.id, at: Date.now(), reason: '5승'
    };
    pr.freePacks = P.freePacksOf(pr).concat([fp]).slice(-40);
    return fp;
  }
  function applyPvpResult(b, winner) {
    const mePr = P.prof(b.me.profile), foePr = P.prof(b.foe.profile);
    if (!mePr || !foePr) return null;
    const wPr = winner === 0 ? mePr : foePr;
    const lPr = winner === 0 ? foePr : mePr;
    const wId = winner === 0 ? b.me.profile : b.foe.profile;
    const lId = winner === 0 ? b.foe.profile : b.me.profile;
    const wDeck = winner === 0 ? b.me.deck : b.foe.deck;

    const wp = pvpRec(wPr), lp = pvpRec(lPr);
    wp.w += 1;
    wp.streak = (wp.streak || 0) + 1;
    wp.best = Math.max(wp.best || 0, wp.streak);
    const wv = wp.vs[lId] || { w: 0, l: 0 };
    wp.vs[lId] = { w: wv.w + 1, l: wv.l };
    lp.l += 1;
    lp.streak = 0;
    const lv = lp.vs[wId] || { w: 0, l: 0 };
    lp.vs[wId] = { w: lv.w, l: lv.l + 1 };

    /* ② 출전 카드 5장 각 +1승 (한 매치당 1승 · 같은 카드가 두 장이어도 1승) */
    wPr.cardWins = P.cardWinsOf(wPr);
    const ids = [];
    (wDeck || []).forEach(c => { if (c && c.id && ids.indexOf(c.id) < 0) ids.push(c.id); });
    const ups = ids.map(id => {
      wPr.cardWins[id] = (wPr.cardWins[id] || 0) + 1;
      return { id: id, n: wPr.cardWins[id] };
    });

    /* ③ 누적 5승(5·10·15…)마다 124개 팩 중 랜덤 무료팩 1개 */
    const fp = (wp.w % 5 === 0) ? grantRandomFreePack(wPr) : null;

    P.save();
    return {
      name: wPr.name, profileId: wId, pr: wPr, pvp: wp,
      ups: ups, fp: fp, title: P.battleTitle(wp.w),
      next: P.nextBattleTitle(wp.w)
    };
  }
  function pvpResultHtml(res) {
    if (!res) return '';
    const fpMeta = res.fp ? D.packMeta(res.fp.packId) : null;
    const ups = res.ups.map(u => {
      const c = window.PKDex.findCard(u.id);
      return '<span class="pr-up">' + (c ? '<img src="' + D.img(c.img) + '" alt="">' : '') +
        '<i>⚡+' + (u.n * CARD_WIN_POWER) + '</i></span>';
    }).join('');
    return '<div class="pvp-result">' +
      '<div class="pr-title">' + res.title.name + ' <b>' + esc(res.name) + '</b></div>' +
      '<div class="pr-line">1:1 <b>' + res.pvp.w + '승</b> ' + res.pvp.l + '패 · 현재 <b>' + res.pvp.streak +
        '연승</b> (최고 ' + res.pvp.best + '연승)</div>' +
      (res.next ? '<div class="pr-sub">다음 칭호까지 ' + res.next.need + '승 · ' + res.next.title.name + '</div>' :
        '<div class="pr-sub">최고 칭호를 달성했어요! 👑</div>') +
      (ups ? '<div class="pr-ups-h">카드 파워업 +' + CARD_WIN_POWER + ' (출전 5장)</div><div class="pr-ups">' + ups + '</div>' : '') +
      (res.fp ? '<div class="pr-free">🎁 ' + res.pvp.w + '승 달성! 무료팩 1개 · <b>' +
        esc(fpMeta ? fpMeta.name : '랜덤 팩') + '</b></div>' : '') +
      '</div>';
  }

  function finishBattle() {
    const b = ui.bt;
    if (!b) return;
    const winner = b.score[0] > b.score[1] ? 0 : b.score[1] > b.score[0] ? 1 : -1;
    let reward = '', coinReward = false;
    /* 🪙 코인은 사람끼리(1:1) 대전에서만 — 컴퓨터(연습게임)에서 이겨도 전적만 남고 코인은 0 */
    if (winner === 0) {
      const pr = P.prof(b.me.profile);
      pr.wins = (pr.wins || 0) + 1;
      if (b.mode === 'p2') { pr.coins += 10; coinReward = true; reward = '+10 코인 획득!'; }
      else { reward = '🤖 연습게임은 코인이 지급되지 않아요'; }
      P.save();
      if (coinReward) U.bumpCoins();
    } else if (winner === 1) {
      if (b.mode === 'p2') {
        const pr = P.prof(b.foe.profile);
        pr.coins += 10; pr.wins = (pr.wins || 0) + 1;
        P.save(); reward = b.foe.name + ' +10 코인';
      } else {
        const pr = P.prof(b.me.profile);
        pr.losses = (pr.losses || 0) + 1; P.save();
      }
    }
    if (winner === 0) A.sfx.win(); else if (winner === 1) A.sfx.lose();

    /* 🧒 사람끼리(1:1) 대전일 때만 — 컴퓨터 대전은 여기에 들어오지 않는다 */
    const pvpRes = (b.mode === 'p2' && winner !== -1) ? applyPvpResult(b, winner) : null;

    const body = '<div style="text-align:center;font-size:44px;margin-bottom:6px">' +
      (winner === 0 ? '🏆' : winner === 1 ? '💧' : '🤝') + '</div>' +
      '<div style="text-align:center;font-size:20px;font-weight:900;margin-bottom:6px">' +
      (winner === 0 ? P.prof(b.me.profile).name + ' 승리!' : winner === 1 ? b.foe.name + ' 승리!' : '무승부') + '</div>' +
      '<div style="text-align:center;font-size:16px;font-weight:900;color:#ffe9bf">' + b.score[0] + ' : ' + b.score[1] + '</div>' +
      (reward ? '<div style="text-align:center;margin-top:8px;color:' + (coinReward ? '#6ef2b0' : '#9aa6cc') + ';font-weight:900;font-size:13px">' + reward + '</div>' : '') +
      pvpResultHtml(pvpRes) +
      '<div class="list" style="margin-top:16px">' + b.results.map((r, i) => {
        const ca = b.me.deck.find(c => c.id === r.a), cc = b.foe.deck.find(c => c.id === r.c);
        const m = r.mult || [1, 1];
        const mchip = (m[0] !== 1 ? ' <em class="mult-chip">×' + m[0] + '</em>' : '') + ' / ' +
          (m[1] !== 1 ? '<em class="mult-chip">×' + m[1] + '</em>' : '×1.0');
        return '<div class="row"><b style="color:#ffe9bf">' + (i + 1) + 'R</b><div class="grow"><b>' +
          esc(ca ? ca.name : '') + ' ' + r.pa + ' vs ' + r.pb + ' ' + esc(cc ? cc.name : '') + '</b>' +
          '<small style="display:block;font-size:10.5px;color:#9aa6cc">기본 ' + (r.base ? r.base[0] + ' / ' + r.base[1] : '-') + mchip + '</small></div>' +
          '<span style="width:12px;height:12px;border-radius:4px;display:inline-block;background:' +
          (r.win === 0 ? '#67e8ff' : r.win === 1 ? '#ff8ade' : 'rgba(255,255,255,.28)') + '"></span></div>';
      }).join('') + '</div>';
    closeArena();
    const btns = [{ label: '홈으로', kind: 'ghost', onClick: () => { U.go('home'); } }];
    if (pvpRes && pvpRes.fp) {
      const fp = pvpRes.fp;
      btns.push({
        label: '🎁 무료팩', kind: 'gold', onClick: () => {
          setTimeout(() => { try { window.PKShop.openFlow(fp.packId, { price: 0, free: true, fpId: fp.id }); } catch (e) { /* */ } }, 260);
        }
      });
    }
    btns.push({ label: '다시 배틀', kind: 'primary', onClick: () => { render(); } });
    P.modal({
      title: winner === 0 ? '🏆 배틀 승리' : '배틀 결과',
      body,
      buttons: btns
    });
    U.refreshHeader();
  }

  /* ---------------- ☁️ 클라우드 창구 — 덱 3칸 · 타이밍 바 속도 ----------------
     cloud.js(snapCards·mergeCards·applyMerged)가 이 창구로만 읽고 쓴다.
     건드리는 키는 pkc_decks_v1 · pkc_bar_speed_v1 · pkc_sync_meta_v1 셋뿐이다.
     도감(pkm.shared.dex.v1.*)·마을(pkm.village.*)·판수 기록은 읽지도 쓰지도 않는다. */
  function normSlots(v) {
    return [0, 1, 2].map(i => (Array.isArray(v) && Array.isArray(v[i]) && v[i].length) ? v[i].slice(0, 5) : null);
  }
  function refreshDeckScreen(profileId) {
    if (ui.step === 'arena') return;                        /* 배틀 중에는 건드리지 않는다 */
    if (P.state.active !== profileId) return;               /* 지금 고른 프로필의 덱만 */
    const scr = $('#screen-battle');
    if (!scr || !scr.classList.contains('active')) return;   /* 배틀 화면을 보고 있을 때만 */
    render();
  }
  window.PKCDeckSync = {
    keys: { decks: DECKS_KEY, speed: SPEED_KEY, meta: META_KEY },
    slots: function (id) { return getSlots(id); },
    decksAt: function (id) { return decksAtOf(id); },
    barSpeed: function () { return barSpeed; },
    barSpeedAt: function () { return barSpeedAtOf(); },
    applyDecks: function (id, arr, at) {
      const all = readDecks();
      all[id] = normSlots(arr);
      try { localStorage.setItem(DECKS_KEY, JSON.stringify(all)); } catch (e) { /* */ }
      if (tsOf(at) > 0) setDecksAt(id, tsOf(at));
      refreshDeckScreen(id);
    },
    applyBarSpeed: function (v, at) {
      const x = Number(v);
      if (!isFinite(x)) return;
      barSpeed = Math.min(2, Math.max(0.5, x));
      try { localStorage.setItem(SPEED_KEY, String(barSpeed)); } catch (e) { /* */ }
      if (tsOf(at) > 0) setBarSpeedAt(tsOf(at));
    }
  };

  window.PKBattle = {
    render, power, advantage,
    diff: function () { return ui.diff; }, setDiff: setDiff, DIFFS: DIFFS, aiPlan: aiPlan,
    cardPower: function (id, ownerId) { return P.cardWinCount(ownerId || P.state.active, id) * CARD_WIN_POWER; },
    /* ---- 검증용 ---- */
    /* 타이밍 바 확률표를 n번 뽑아 본 결과 */
    aiStats: function (k, n) {
      const N = Math.max(1, Math.min(4000, Number(n) || 600));
      const out = { n: N, miss: 0, z15: 0, z2: 0, z3: 0 };
      for (let i = 0; i < N; i += 1) {
        const m = aiPlan(k || ui.diff);
        if (m === 1.5) out.z15 += 1;
        else if (m === 2) out.z2 += 1;
        else if (m === 3) out.z3 += 1;
        else out.miss += 1;
      }
      return out;
    },
    /* 난이도별 컴퓨터 덱(카드 id 5장) */
    aiDeck: async function (k) { return aiDeckIds(k || ui.diff); },
    /* 상대 카드 1장을 주면 어려움이 고를 카드 — 상성 우선인지 확인 */
    counterPick: function (foeIds, mineId) {
      const deck = (foeIds || []).map((id) => window.PKDex.findCard(id)).filter(Boolean);
      const mine = mineId ? window.PKDex.findCard(mineId) : null;
      const b = { round: 0, foe: { deck: deck }, pickA: mine };
      return hardPickFoe(b);
    },
    rawPower: rawPower
  };
})();
