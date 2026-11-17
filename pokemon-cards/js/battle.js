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
    arenaEl: null
  };

  function power(card) {
    const hp = card.hp || 40;
    return hp + (TIER_BONUS[card.r] || 0);
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
    const cheap = pool.slice().sort((a, b) => (st(a) - st(b)) || (power(b) - power(a)));
    const deck = cheap.slice(0, 5);
    let total = deck.reduce((a, c) => a + st(c), 0);
    const better = pool.slice().sort((a, b) => (power(b) + st(b) * 20) - (power(a) + st(a) * 20));
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

  /* ---------------- 라우터 ---------------- */
  function render() {
    if (ui.step === 'arena' && ui.bt) return;      // 아레나는 자체 DOM
    const root = $('#screen-battle');
    if (ui.step === 'pass') { renderPass(root); return; }
    renderSetup(root);
  }

  async function renderSetup(root) {
    const meId = ui.turn === 0 ? P.state.active : ui.p2;
    const pr = P.prof(meId);
    root.innerHTML = '<div class="loading"><div class="spinner"></div>카드 불러오는 중…</div>';
    const cards = await ownedCardList(meId);
    if (!ui.sel.length) {
      const saved = (pr.deck || []).filter(id => pr.cards[id]).slice(0, 5);
      const sStars = saved.reduce((a, id) => { const c = window.PKDex.findCard(id); return a + (c ? D.stars(c.r) : 0); }, 0);
      ui.sel = (saved.length === 5 && sStars <= BUDGET) ? saved : autoDeck(cards, meId);
    }

    const selCards = [];
    ui.sel.forEach(id => { const c = window.PKDex.findCard(id); if (c) selCards.push(c); });
    const stars = selCards.reduce((a, c) => a + D.stars(c.r), 0);
    const okDeck = selCards.length === 5 && stars <= BUDGET;
    const countIn = id => ui.sel.filter(x => x === id).length;
    const who = ui.turn === 0 ? P.me().name : P.prof(ui.p2).name;

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

    const grid = cards.length ? cards.map(c => {
      const n = countIn(c.id);
      const on = n > 0;
      return '<button class="pick-card' + (on ? ' sel' : '') + '" data-pick="' + c.id + '">' +
        '<img loading="lazy" src="' + D.img(c.img) + '" alt="' + esc(c.name) + '">' +
        '<span class="star">★' + D.stars(c.r) + '</span>' +
        (n > 1 ? '<span class="cnt" style="position:absolute;left:2px;bottom:2px;right:auto;font-size:9px;padding:1px 4px;border-radius:6px;background:rgba(4,8,20,.9)">×' + n + '</span>' : '') +
        '</button>';
    }).join('') : '<div class="empty" style="grid-column:1/-1">카드팩을 먼저 뜯어 카드를 모아 보세요!</div>';

    root.innerHTML =
      '<div class="h1">⚔️ 카드 배틀</div>' +
      (ui.mode === 'p2' && ui.turn === 1 ? '<div class="card-panel" style="margin-bottom:10px;text-align:center">' +
        '<b style="color:#ffe9bf">' + esc(who) + ' 차례</b>' +
        '<div class="muted" style="margin-top:4px;font-size:11.5px">' + esc(P.me().name) + '님은 화면을 보지 않아요!</div></div>' : '') +
      '<div class="card-panel">' +
        '<div class="btn-row" style="margin-bottom:12px">' +
          '<button class="chip' + (ui.mode === 'ai' ? ' active' : '') + '" data-mode="ai">🤖 컴퓨터와 대전</button>' +
          '<button class="chip' + (ui.mode === 'p2' ? ' active' : '') + '" data-mode="p2">🧒 남매 1:1 대전</button>' +
          (ui.mode === 'p2' && ui.p2 ? '<button class="chip small" data-pickp2="1">상대: ' + esc(P.prof(ui.p2).name) + ' ✎</button>' : '') +
        '</div>' +
        '<div class="rules-panel">' +
          '<b>룰</b> · 5장 덱, <b>★코스트 합계 12 이하</b> · 낼 <b>순서 1~5</b> 직접 지정<br>' +
          '<span class="muted">5라운드 동시 공개 → 파워(HP+등급) + 상성 보너스 +30 · 먼저 3승 승리 (+10코인)</span>' +
        '</div>' +
        '<div class="budget"><span>내 덱 코스트</span><div class="bar' + (stars > BUDGET ? '' : ' done') + '">' +
          '<i style="width:' + Math.min(100, stars / BUDGET * 100) + '%"></i></div><b>' + stars + ' / ' + BUDGET + '</b>' +
          '<span class="muted" style="font-size:11px">(' + selCards.length + '/5장)</span></div>' +
        '<div class="btn-row" style="margin-top:10px">' +
          '<button class="btn ghost sm" id="autoDeck">🎲 자동 구성</button>' +
          '<button class="btn ghost sm" id="clearDeck">지우기</button>' +
        '</div>' +
        '<div class="muted" style="font-size:11px;margin-top:8px">카드를 누를 때마다 1장씩 추가돼요(보유 장수까지). 다시 누르면 빠져요.</div>' +
      '</div>' +
      '<div class="h2">내 카드에서 5장 고르기 <span class="muted" style="font-size:11px">' + cards.length + '장 보유</span></div>' +
      '<div class="deck-grid">' + grid + '</div>' +
      orderBox +
      (okDeck ? '' : '<div class="muted" style="margin:14px 2px;color:#ffb3c1">5장을 고르고 코스트 12 이하로 맞춰 주세요. (현재 ' + selCards.length + '장)</div>');

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
      } else if (n >= owned) {
        P.toast('이 카드는 ' + owned + '장 보유하고 있어요'); return;
      } else if (ui.sel.length >= 5) {
        P.toast('5장까지만 고를 수 있어요'); return;
      } else if (cur + D.stars(c.r) > BUDGET) {
        A.sfx.error(); P.toast('코스트 12를 넘었어요'); return;
      } else {
        ui.sel.push(id);
      }
      P.prof(meId).deck = ui.sel.slice();
      P.save();
      renderSetup(root);
    }));
    const ad = root.querySelector('#autoDeck');
    if (ad) ad.addEventListener('click', () => {
      ui.sel = autoDeck(cards, meId); ui.order = [];
      P.prof(meId).deck = ui.sel.slice(); P.save(); A.sfx.sparkle();
      renderSetup(root);
    });
    const cd = root.querySelector('#clearDeck');
    if (cd) cd.addEventListener('click', () => {
      ui.sel = []; ui.order = []; P.prof(meId).deck = []; P.save(); renderSetup(root);
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
        return power(ca) - power(cb);
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
  async function aiDeckIds() {
    const packs = D.allPacks();
    const picks = [];
    for (let i = 0; i < 3 && picks.length < 9; i++) {
      const p = packs[Math.floor(Math.random() * packs.length)];
      try {
        const d = await window.PKDex.ensurePack(p.id);
        picks.push.apply(picks, d.cards.slice(0, 220));
      } catch (e) { }
    }
    const out = [];
    let left = BUDGET;
    const shuffled = picks.filter(c => D.stars(c.r) <= left).sort(() => Math.random() - 0.5);
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
      foe = (await aiDeckIds()).map(id => window.PKDex.findCard(id)).filter(Boolean);
      if (foe.length < 5) {
        const p = await deckFor(meId);
        foe = p.slice();
      }
      foeName = '🤖 컴퓨터';
    } else {
      foeProfile = ui.p2;
      const ord = ui.p2Order && ui.p2Order.length === 5 ? ui.p2Order : [];
      foe = ord.map(id => window.PKDex.findCard(id)).filter(Boolean);
      if (foe.length < 5) foe = await deckFor(ui.p2);
      if (foe.length < 5) foe = (await aiDeckIds()).map(id => window.PKDex.findCard(id)).filter(Boolean);
      foeName = P.prof(ui.p2).name;
    }
    if (mine.length < 5 || foe.length < 5) { P.toast('5장 덱이 필요해요'); ui.step = 'deck'; render(); return; }

    ui.bt = {
      mode: ui.mode, round: 0, score: [0, 0], results: [],
      me: { profile: meId, name: P.me().name, deck: mine.slice() },
      foe: { profile: foeProfile, name: foeName, deck: foe.slice() },
      phase: 'ready'
    };
    ui.step = 'arena';
    openArena();
  }

  function closeArena() {
    if (ui.arenaEl) { ui.arenaEl.remove(); ui.arenaEl = null; }
    A.setMode('home');
    ui.bt = null;
    ui.step = 'deck';
    ui.turn = 0;
    ui.sel = [];
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
          '<button class="arena-close" id="arenaQuit">✕</button>' +
        '</div>' +
        '<div class="hud">' +
          '<div class="hud-side a"><div class="hud-name">' + esc(b.me.name) + '</div><div class="pips a" id="pipsA"></div></div>' +
          '<div class="round-chip"><b id="roundNum">1</b><span>ROUND</span></div>' +
          '<div class="hud-side b"><div class="hud-name">' + esc(b.foe.name) + '</div><div class="pips b" id="pipsB"></div></div>' +
        '</div>' +
        '<div class="duel">' +
          '<div class="dside" id="sideA">' +
            '<div class="dcard" id="cardA"><div class="inner">' +
              '<div class="dface back"></div>' +
              '<div class="dface front"><img id="imgA" alt=""><div class="holo"></div></div>' +
            '</div><div class="fx-layer" id="fxA"></div></div>' +
            '<div class="pow-tag" id="powA"></div>' +
          '</div>' +
          '<div class="vs-mark">VS</div>' +
          '<div class="dside" id="sideB">' +
            '<div class="dcard" id="cardB"><div class="inner">' +
              '<div class="dface back"></div>' +
              '<div class="dface front"><img id="imgB" alt=""><div class="holo"></div></div>' +
            '</div><div class="fx-layer" id="fxB"></div></div>' +
            '<div class="pow-tag" id="powB"></div>' +
          '</div>' +
        '</div>' +
        '<div class="arena-msg" id="arenaMsg">카드를 엎어 두고 시작을 기다리는 중…<span class="sub">1라운드 · ' + esc(b.me.name) + ' vs ' + esc(b.foe.name) + '</span></div>' +
        '<div class="arena-cta"><button class="btn gold" id="battleGo">⚔️ 배틀 시작!</button></div>' +
      '</div>';
    document.body.appendChild(el);
    ui.arenaEl = el;
    A.setMode('battle');
    el.querySelector('#arenaQuit').addEventListener('click', async () => {
      const ok = await P.confirmBox('배틀 종료', '지금 나가면 기록이 저장되지 않아요. 나갈까요?', '나가기');
      if (ok) closeArena();
    });
    el.querySelector('#battleGo').addEventListener('click', onGo);
    paintPips();
    enterRound();
  }

  function paintPips() {
    const b = ui.bt;
    const a = ui.arenaEl.querySelector('#pipsA');
    const c = ui.arenaEl.querySelector('#pipsB');
    a.innerHTML = [0, 1, 2].map(i => '<i class="' + (b.score[0] > i ? 'on' : '') + '"></i>').join('');
    c.innerHTML = [0, 1, 2].map(i => '<i class="' + (b.score[1] > i ? 'on' : '') + '"></i>').join('');
    ui.arenaEl.querySelector('#roundNum').textContent = String(Math.min(5, b.round + 1));
  }

  /* 라운드 카드 등장 (양쪽 뒷면) */
  function enterRound() {
    const b = ui.bt;
    const el = ui.arenaEl;
    const a = b.me.deck[b.round], c = b.foe.deck[b.round];
    b.phase = 'ready';
    b.pickA = a; b.pickC = c;

    const sideA = el.querySelector('#sideA');
    const sideB = el.querySelector('#sideB');
    sideA.className = 'dside';
    sideB.className = 'dside';
    const cardA = el.querySelector('#cardA');
    const cardB = el.querySelector('#cardB');
    cardA.className = 'dcard';
    cardB.className = 'dcard';
    el.querySelector('#imgA').src = D.img(a.img);
    el.querySelector('#imgB').src = D.img(c.img);
    el.querySelector('#imgA').alt = a.name;
    el.querySelector('#imgB').alt = c.name;
    el.querySelector('#fxA').innerHTML = '';
    el.querySelector('#fxB').innerHTML = '';
    el.querySelector('#powA').className = 'pow-tag';
    el.querySelector('#powB').className = 'pow-tag';
    el.querySelector('#powA').textContent = '';
    el.querySelector('#powB').textContent = '';
    el.querySelectorAll('.ko-tag,.dmg-pop').forEach(x => x.remove());

    // 등장 애니메이션
    void cardA.offsetWidth;
    cardA.classList.add('enter');
    cardB.classList.add('enter');
    A.sfx.whoosh();

    const msg = el.querySelector('#arenaMsg');
    msg.innerHTML = (b.round + 1) + '라운드 · 두 카드가 엎어진 채 등장!<span class="sub">' +
      (ui.mode === 'p2' ? '서로 무엇을 냈는지 몰라요' : '컴퓨터의 카드도 뒷면이에요') + '</span>';
    const go = el.querySelector('#battleGo');
    go.textContent = b.round === 0 ? '⚔️ 배틀 시작!' : (b.round + 1) + '라운드 시작 ▶';
    go.disabled = false;
    go.style.display = '';
    go.onclick = onGo;
    paintPips();
  }

  let busyRound = false;
  function onGo() {
    if (busyRound) return;
    const b = ui.bt;
    if (!b || !ui.arenaEl) return;
    if (b.phase === 'done') return;
    if (b.phase === 'ready') { startRound(); return; }
    if (b.phase === 'result') { nextRound(); return; }
  }

  function startRound() {
    const b = ui.bt;
    const el = ui.arenaEl;
    if (!b || !el) { busyRound = false; return; }
    busyRound = true;
    b.phase = 'flip';
    el.querySelector('#battleGo').style.display = 'none';
    const a = b.pickA, c = b.pickC;
    el.querySelector('#cardA').classList.add('flip');
    el.querySelector('#cardB').classList.add('flip');
    A.sfx.flip();
    const msg = el.querySelector('#arenaMsg');
    msg.innerHTML = '두 카드가 동시에 뒤집힌다…!<span class="sub">잠깐만…</span>';

    setTimeout(() => {
      if (!ui.bt || !ui.arenaEl) { busyRound = false; return; }
      const advA = advantage(a, c), advB = advantage(c, a);
      const pa = power(a) + (advA ? ADV : 0);
      const pb = power(c) + (advB ? ADV : 0);
      const win = pa > pb ? 0 : pb > pa ? 1 : -1;
      const rec = { a: a.id, c: c.id, pa, pb, advA, advB, win };
      b.results.push(rec);

      const powA = el.querySelector('#powA');
      const powB = el.querySelector('#powB');
      powA.innerHTML = '파워 <b>' + pa + '</b>' + (advA ? ' · 상성+30' : '');
      powB.innerHTML = '파워 <b>' + pb + '</b>' + (advB ? ' · 상성+30' : '');
      powA.classList.add('show'); powB.classList.add('show');

      setTimeout(() => {
        if (!ui.bt || !ui.arenaEl) { busyRound = false; return; }
        if (win === 0) b.score[0]++; else if (win === 1) b.score[1]++;
        playRound(a, c, win, pa, pb);
      }, 560);
    }, 780);
  }

  function playRound(a, c, win, pa, pb) {
    const b = ui.bt;
    const el = ui.arenaEl;
    if (!b || !el) { busyRound = false; return; }
    const sideA = el.querySelector('#sideA');
    const sideB = el.querySelector('#sideB');
    const msg = el.querySelector('#arenaMsg');

    if (win === -1) {
      msg.innerHTML = '무승부!<span class="sub">' + esc(a.name) + ' ' + pa + ' vs ' + pb + ' ' + esc(c.name) + '</span>';
      A.sfx.tap();
      finishRoundUI(win);
      return;
    }
    const winnerCard = win === 0 ? a : c;
    const loserCard = win === 0 ? c : a;
    const winSide = win === 0 ? sideA : sideB;
    const loseSide = win === 0 ? sideB : sideA;
    const winType = winnerCard.t || '무색';

    winSide.classList.add('win');
    // 공격 이펙트 → 진 카드
    attackFx(loseSide, winType);
    A.sfx.attack(winType);
    P.haptic(14);

    msg.innerHTML = '<b style="color:#ffe9bf">' + esc(winnerCard.name) + '</b> 의 ' + esc(winType) + ' 공격!<span class="sub">' +
      pa + ' vs ' + pb + '</span>';

    setTimeout(() => {
      if (!ui.bt || !ui.arenaEl) return;
      loseSide.classList.add('lose');
      const kt = P.el('div', 'ko-tag', 'KO!');
      loseSide.appendChild(kt);
      const dmg = P.el('div', 'dmg-pop', '-' + Math.abs(pa - pb));
      loseSide.appendChild(dmg);
      A.sfx.koHit();
      P.haptic(30);
      const rect = loseSide.getBoundingClientRect();
      const dir = win === 0 ? 1 : -1;
      el.querySelector('#card' + (win === 0 ? 'B' : 'A')).style.setProperty('--ko-x', (dir * (rect.width * 0.9 + 120)).toFixed(0) + 'px');
      el.querySelector('#card' + (win === 0 ? 'B' : 'A')).style.setProperty('--ko-y', '-260px');
      el.querySelector('#card' + (win === 0 ? 'B' : 'A')).style.setProperty('--ko-r', (dir * 620) + 'deg');
    }, 420);

    setTimeout(() => {
      if (!ui.bt || !ui.arenaEl) return;
      msg.innerHTML = '<b style="color:#ffe9bf">' + esc(win === 0 ? b.me.name : b.foe.name) + ' 승리!</b><span class="sub">' +
        esc(a.name) + ' ' + pa + ' vs ' + pb + ' ' + esc(c.name) + '</span>';
      A.sfx.roundWin();
      finishRoundUI(win);
    }, 1500);
  }

  function finishRoundUI(win) {
    const b = ui.bt;
    if (!b || !ui.arenaEl) { busyRound = false; return; }
    b.phase = 'result';
    paintPips();
    const el = ui.arenaEl;
    const go = el.querySelector('#battleGo');
    const over = b.round >= 4 || b.score[0] >= 3 || b.score[1] >= 3;
    go.textContent = over ? '🏆 결과 보기' : (b.round + 2) + '라운드 시작 ▶';
    go.style.display = '';
    go.disabled = false;
    go.onclick = onGo;
    busyRound = false;
    // 패배 측에 위로(?) 표현
    if (ui.mode === 'p2' && win === 0) P.haptic(30);
  }

  function nextRound() {
    const b = ui.bt;
    if (b.round >= 4 || b.score[0] >= 3 || b.score[1] >= 3) { finishBattle(); return; }
    b.round++;
    b.phase = 'ready';
    enterRound();
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

    // 별도 타격 폭발
    const hit = P.el('div');
    hit.className = 'atk';
    hit.style.animationDelay = '.3s';
    hit.innerHTML = '<div class="core" style="animation-delay:.32s;width:90px;height:90px;background:radial-gradient(circle,#fff,' + color + ' 45%,transparent 70%);opacity:.9"></div>';
    fx.appendChild(hit);
    setTimeout(() => hit.remove(), 1700);
  }

  /* ---------------- 결과 ---------------- */
  function finishBattle() {
    const b = ui.bt;
    const winner = b.score[0] > b.score[1] ? 0 : b.score[1] > b.score[0] ? 1 : -1;
    let reward = '';
    if (winner === 0) {
      const pr = P.prof(b.me.profile);
      pr.coins += 10; pr.wins = (pr.wins || 0) + 1;
      P.save(); reward = '+10 코인 획득!'; U.bumpCoins();
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

    const body = '<div style="text-align:center;font-size:44px;margin-bottom:6px">' +
      (winner === 0 ? '🏆' : winner === 1 ? '💧' : '🤝') + '</div>' +
      '<div style="text-align:center;font-size:20px;font-weight:900;margin-bottom:6px">' +
      (winner === 0 ? P.prof(b.me.profile).name + ' 승리!' : winner === 1 ? b.foe.name + ' 승리!' : '무승부') + '</div>' +
      '<div style="text-align:center;font-size:16px;font-weight:900;color:#ffe9bf">' + b.score[0] + ' : ' + b.score[1] + '</div>' +
      (reward ? '<div style="text-align:center;margin-top:8px;color:#6ef2b0;font-weight:900">' + reward + '</div>' : '') +
      '<div class="list" style="margin-top:16px">' + b.results.map((r, i) => {
        const ca = b.me.deck.find(c => c.id === r.a), cc = b.foe.deck.find(c => c.id === r.c);
        return '<div class="row"><b style="color:#ffe9bf">' + (i + 1) + 'R</b><div class="grow"><b>' +
          esc(ca ? ca.name : '') + ' ' + r.pa + ' vs ' + r.pb + ' ' + esc(cc ? cc.name : '') + '</b></div>' +
          '<span style="width:12px;height:12px;border-radius:4px;display:inline-block;background:' +
          (r.win === 0 ? '#67e8ff' : r.win === 1 ? '#ff8ade' : 'rgba(255,255,255,.28)') + '"></span></div>';
      }).join('') + '</div>';
    closeArena();
    P.modal({
      title: winner === 0 ? '🏆 배틀 승리' : '배틀 결과',
      body,
      buttons: [
        { label: '홈으로', kind: 'ghost', onClick: () => { U.go('home'); } },
        { label: '다시 배틀', kind: 'primary', onClick: () => { render(); } }
      ]
    });
    U.refreshHeader();
  }

  window.PKBattle = { render, power, advantage };
})();
