/* battle.js — 코스트 제한 5장 덱 · 5라운드 동시 오픈 대결 */
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
    mode: null,            // 'ai' | 'p2'
    p2Ready: false,
    step: 'setup',
    sel: [],               // 덱 구성 시 선택
    p2: 'jian',
    bt: null               // 진행 중 배틀
  };

  function power(card) {
    const hp = card.hp || 40;
    return hp + (TIER_BONUS[card.r] || 0);
  }
  function advantage(a, b) {
    return (TYPE_BONUS[a.t] || []).indexOf(b.t) >= 0;
  }

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

  /* ---------------- 화면 ---------------- */
  function render() {
    const root = $('#screen-battle');
    if (!ui.bt) { renderSetup(root); return; }
    renderBattle(root);
  }

  async function renderSetup(root) {
    const pr = P.me();
    root.innerHTML = '<div class="loading"><div class="spinner"></div>카드 불러오는 중…</div>';
    const cards = await ownedCardList(P.state.active);
    const deck = (pr.deck || []).filter(id => pr.cards[id]).slice(0, 5);
    if (!ui.sel.length) ui.sel = deck.slice();

    const selCards = [];
    ui.sel.forEach(id => { const c = window.PKDex.findCard(id); if (c) selCards.push(c); });
    const stars = selCards.reduce((a, c) => a + D.stars(c.r), 0);
    const okDeck = selCards.length === 5 && stars <= BUDGET;
    const countIn = id => ui.sel.filter(x => x === id).length;

    const grid = cards.length ? cards.map(c => {
      const n = countIn(c.id);
      const on = n > 0;
      return '<button class="pick-card' + (on ? ' sel' : '') + '" data-pick="' + c.id + '">' +
        '<img loading="lazy" src="' + D.img(c.img) + '" alt="' + esc(c.name) + '">' +
        '<span class="star">★' + D.stars(c.r) + '</span>' +
        (n > 1 ? '<span class="cnt" style="position:absolute;left:2px;bottom:2px;right:auto;font-size:9px;padding:1px 4px;border-radius:6px;background:rgba(6,10,30,.9)">×' + n + '</span>' : '') +
        '</button>';
    }).join('') : '<div class="empty" style="grid-column:1/-1">카드팩을 먼저 뜯어 카드를 모아 보세요!</div>';

    root.innerHTML =
      '<div class="h1">⚔️ 카드 배틀</div>' +
      '<div class="card-panel">' +
        '<div style="font-size:13px;line-height:1.65">' +
          '<b>룰</b> · 5장 덱, <b>★코스트 합계 12 이하</b><br>' +
          '<span class="muted">일반 ★1 · 레어 ★2 · 더블레어 ★4 · 울트라 ★5 — 좋은 카드만 채울 수 없어요.</span><br>' +
          '<span class="muted">5라운드 엎어서 동시 오픈 → 파워(HP+등급) + 상성 보너스 +30 · 먼저 3승 승리 (+10코인)</span>' +
        '</div>' +
        '<div class="budget"><span>내 덱 코스트</span><div class="bar' + (stars > BUDGET ? '' : ' done') + '">' +
          '<i style="width:' + Math.min(100, stars / BUDGET * 100) + '%"></i></div><b>' + stars + ' / ' + BUDGET + '</b>' +
          '<span class="muted" style="font-size:11.5px">(' + selCards.length + '/5장)</span></div>' +
        '<div class="btn-row" style="margin-top:10px">' +
          '<button class="btn ghost sm" id="autoDeck">🎲 자동 구성</button>' +
          '<button class="btn ghost sm" id="clearDeck">지우기</button>' +
        '</div>' +
        '<div class="muted" style="font-size:11px;margin-top:8px">카드를 누를 때마다 1장씩 추가돼요(보유 장수까지). 다시 누르면 빠져요.</div>' +
      '</div>' +
      '<div class="h2">내 카드에서 5장 고르기 <span class="muted" style="font-size:11px">' + cards.length + '장 보유</span></div>' +
      '<div class="deck-grid">' + grid + '</div>' +
      '<div class="h2">대전 상대</div>' +
      '<div class="list">' +
        '<button class="row" data-mode="ai"><div class="avatar">🤖</div><div class="grow"><b>컴퓨터와 대전</b><small>혼자서 연습 배틀</small></div>' +
          '<span class="btn sm gold">시작</span></button>' +
        '<button class="row" data-mode="p2"><div class="avatar">👧🧒</div><div class="grow"><b>남매 1:1 대전</b><small>한 기기로 번갈아 패를 가리고 대결</small></div>' +
          '<span class="btn sm primary">시작</span></button>' +
      '</div>' +
      (okDeck ? '' : '<div class="muted" style="margin:14px 2px;color:#ffb3c1">5장을 고르고 코스트 12 이하로 맞춰 주세요. (현재 ' + selCards.length + '장)</div>');

    root.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.pick;
      const c = window.PKDex.findCard(id);
      if (!c) return;
      const owned = P.prof(P.state.active).cards[id] || 0;
      const n = ui.sel.filter(x => x === id).length;
      const cur = ui.sel.reduce((a, x) => { const cc = window.PKDex.findCard(x); return a + (cc ? D.stars(cc.r) : 0); }, 0);
      A.sfx.tap();
      if (n > 0 && (ui.sel.length >= 5 || cur + D.stars(c.r) > BUDGET || n >= owned)) {
        ui.sel = ui.sel.filter(x => x !== id);
      } else if (n >= owned) {
        P.toast('이 카드는 ' + owned + '장 보유하고 있어요');
        return;
      } else if (ui.sel.length >= 5) {
        P.toast('5장까지만 고를 수 있어요');
        return;
      } else if (cur + D.stars(c.r) > BUDGET) {
        A.sfx.error(); P.toast('코스트 12를 넘었어요');
        return;
      } else {
        ui.sel.push(id);
      }
      P.prof(P.state.active).deck = ui.sel.slice();
      P.save();
      renderSetup(root);
    }));
    const ad = root.querySelector('#autoDeck');
    if (ad) ad.addEventListener('click', () => {
      ui.sel = autoDeck(cards, P.state.active);
      P.prof(P.state.active).deck = ui.sel.slice(); P.save(); A.sfx.sparkle();
      renderSetup(root);
    });
    root.querySelector('#clearDeck').addEventListener('click', () => {
      ui.sel = []; P.prof(P.state.active).deck = []; P.save(); renderSetup(root);
    });
    root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      if (!okDeck) { A.sfx.error(); P.toast('먼저 5장 덱을 완성해 주세요'); return; }
      if (b.dataset.mode === 'p2') openP2Picker();
      else startBattle('ai');
    }));
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
    // 1) 가장 저렴한 카드로 5장 슬롯 채우기
    const cheap = pool.slice().sort((a, b) => (st(a) - st(b)) || (power(b) - power(a)));
    const deck = cheap.slice(0, 5);
    // 2) 남은 카드로 업그레이드 (예산 12 유지)
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

  function openP2Picker() {
    const others = P.PROFILES.filter(p => p.id !== P.state.active);
    const body = P.el('div');
    body.innerHTML = '<p class="muted" style="margin:0 0 10px">누구와 대결할까요? 상대 덱은 그 친구의 카드로 자동 구성돼요.</p>' +
      '<div class="list">' + others.map(o =>
        '<button class="row" data-p2="' + o.id + '"><div class="avatar">' + o.emoji + '</div>' +
        '<div class="grow"><b>' + esc(P.prof(o.id).name) + '</b><small>보유 ' + U.uniqueCards(P.prof(o.id)) + '종</small></div>' +
        '<span class="btn sm primary">선택</span></button>').join('') + '</div>';
    const m = P.modal({ title: '🤝 대전 상대 선택', body, buttons: [{ label: '✕ 나가기', kind: 'ghost' }] });
    body.querySelectorAll('[data-p2]').forEach(b => b.addEventListener('click', () => {
      ui.p2 = b.dataset.p2; m.close(true); startBattle('p2');
    }));
  }

  async function deckFor(profileId) {
    const pr = P.prof(profileId);
    const owned = await ownedCardList(profileId);
    let sel = (pr.deck || []).filter(id => pr.cards[id]).slice(0, 5);
    let stars = sel.reduce((a, id) => { const c = window.PKDex.findCard(id); return a + (c ? D.stars(c.r) : 0); }, 0);
    if (sel.length < 5 || stars > BUDGET) sel = autoDeck(owned, profileId);
    let out = sel.map(id => window.PKDex.findCard(id)).filter(Boolean);
    if (out.length < 5) {
      const extra = await aiDeck();
      out = out.concat(extra).slice(0, 5);
    }
    return out;
  }

  async function startBattle(mode) {
    A.unlock();
    ui.mode = mode;
    const myDeck = await deckFor(P.state.active);
    let foeDeck, foeName;
    if (mode === 'ai') {
      foeDeck = await aiDeck();
      foeName = '🤖 컴퓨터';
    } else {
      foeDeck = await deckFor(ui.p2);
      foeName = P.prof(ui.p2).name;
    }
    if (myDeck.length < 5) { P.toast('5장 덱이 필요해요'); return; }
    ui.bt = {
      mode, round: 0, score: [0, 0], results: [],
      me: { profile: P.state.active, name: P.me().name, deck: myDeck.slice(), used: [] },
      foe: { profile: mode === 'p2' ? ui.p2 : null, name: foeName, deck: foeDeck.slice(), used: [] },
      phase: 'pick', pick1: null, pick2: null, reveal: null
    };
    render();
  }

  async function aiDeck() {
    const packs = D.allPacks();
    const picks = [];
    for (let i = 0; i < 3 && picks.length < 9; i++) {
      const p = packs[Math.floor(Math.random() * packs.length)];
      try {
        const d = await window.PKDex.ensurePack(p.id);
        picks.push.apply(picks, d.cards.slice(0, 200));
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
    return out.slice(0, 5);
  }

  /* ---------------- 배틀 진행 ---------------- */
  function renderBattle(root) {
    const b = ui.bt;
    const meName = P.prof(b.me.profile).name;
    const dots = [];
    for (let i = 0; i < 5; i++) {
      const r = b.results[i];
      dots.push('<div class="rd' + (r ? (r.win === 0 ? ' a' : r.win === 1 ? ' b' : ' d') : '') + '"></div>');
    }
    const hand = b.me.deck.filter(c => b.me.used.indexOf(c.id) < 0);

    let phaseHtml = '';
    if (b.phase === 'pick') {
      if (b.mode === 'p2') {
        if (b.pick1 == null) {
          phaseHtml = '<div class="card-panel" style="margin-top:10px"><b>' + esc(meName) + ' 차례</b>' +
            '<p class="muted" style="margin:6px 0 10px">상대가 보지 않게 카드를 골라 주세요. 고르면 화면이 가려져요.</p></div>';
        } else {
          phaseHtml = '<div class="card-panel" style="margin-top:10px;text-align:center">' +
            '<div style="font-size:30px">🙈</div><b>' + esc(b.foe.name) + ' 차례</b>' +
            '<p class="muted" style="margin:6px 0 0">기기를 ' + esc(b.foe.name) + '에게 넘기고 카드를 골라 주세요.</p>' +
            '<button class="btn primary wide" id="p2Next" style="margin-top:10px">준비됐어요 · 카드 고르기</button></div>';
        }
      } else {
        phaseHtml = '<div class="card-panel" style="margin-top:10px"><b>' + (b.round + 1) + '라운드</b>' +
          '<p class="muted" style="margin:6px 0 0">낼 카드를 하나 골라 주세요. 상대는 몰라요!</p></div>';
      }
    }

    let stageHtml = '';
    if (b.reveal) {
      const { a, c, r } = b.reveal;
      stageHtml =
        '<div class="battle-stage">' +
          '<div class="slot filled ' + (r.win === 0 ? 'win' : r.win === 1 ? 'lose' : '') + '"><img src="' + D.img(a.img) + '" alt=""></div>' +
          '<div class="vs">VS</div>' +
          '<div class="slot filled ' + (r.win === 1 ? 'win' : r.win === 0 ? 'lose' : '') + '"><img src="' + D.img(c.img) + '" alt=""></div>' +
        '</div>' +
        '<div class="muted" style="text-align:center;margin-top:8px;font-size:12px">' +
          esc(a.name) + ' <b>' + r.pa + '</b> vs <b>' + r.pb + '</b> ' + esc(c.name) +
          (r.advA ? ' · 상성+30' : '') + (r.advB ? ' · 상성+30' : '') + '</div>' +
        '<div style="text-align:center;font-size:17px;font-weight:900;margin-top:6px;color:' +
          (r.win === 0 ? '#59e3ff' : r.win === 1 ? '#ff7ad9' : '#c8cfe8') + '">' +
          (r.win === 0 ? esc(meName) + ' 승리!' : r.win === 1 ? esc(b.foe.name) + ' 승리!' : '무승부') + '</div>' +
        '<div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn primary" id="nextRound">' +
          (b.round >= 4 || b.score[0] >= 3 || b.score[1] >= 3 ? '결과 보기' : '다음 라운드') + '</button></div>';
    } else if (b.phase === 'pick' && (b.mode !== 'p2' || b.pick1 != null)) {
      const isP2Turn = b.mode === 'p2' && b.pick1 != null;
      const handOwner = isP2Turn ? b.foe : b.me;
      const list = (isP2Turn ? b.foe.deck.filter(c => b.foe.used.indexOf(c.id) < 0) : hand);
      stageHtml = '<div class="deck-grid" style="margin-top:10px">' + (list.length ? list.map(c =>
        '<button class="pick-card" data-bpick="' + c.id + '"><img src="' + D.img(c.img) + '" alt="' + esc(c.name) + '">' +
        '<span class="star">★' + D.stars(c.r) + '</span></button>').join('') :
        '<div class="empty" style="grid-column:1/-1">낼 카드가 없어요</div>') + '</div>';
    } else if (b.phase === 'pick' && b.mode === 'p2' && b.pick1 == null) {
      stageHtml = '<div class="deck-grid" style="margin-top:10px">' + hand.map(c =>
        '<button class="pick-card" data-bpick="' + c.id + '"><img src="' + D.img(c.img) + '" alt="' + esc(c.name) + '">' +
        '<span class="star">★' + D.stars(c.r) + '</span></button>').join('') + '</div>';
    }

    root.innerHTML =
      '<div class="h1">⚔️ ' + esc(meName) + ' vs ' + esc(b.foe.name) + '</div>' +
      '<div class="score"><span class="a">' + b.score[0] + '</span><span style="font-size:13px;color:#9fb0dd">:</span>' +
        '<span class="b">' + b.score[1] + '</span></div>' +
      '<div class="round-dots">' + dots.join('') + '</div>' +
      phaseHtml + stageHtml +
      '<div style="margin-top:16px"><button class="btn ghost sm" id="quitBattle">그만두기</button></div>';

    root.querySelector('#quitBattle').addEventListener('click', async () => {
      const ok = await P.confirmBox('배틀 종료', '지금 나가면 기록이 저장되지 않아요. 나갈까요?', '나가기');
      if (ok) { ui.bt = null; render(); }
    });
    const p2n = root.querySelector('#p2Next');
    if (p2n) p2n.addEventListener('click', () => { A.sfx.tap(); ui.p2Ready = true; renderBattle(root); });

    root.querySelectorAll('[data-bpick]').forEach(btn => btn.addEventListener('click', () => pickCard(btn.dataset.bpick)));

    const nx = root.querySelector('#nextRound');
    if (nx) nx.addEventListener('click', () => {
      A.sfx.tap();
      if (b.round >= 4 || b.score[0] >= 3 || b.score[1] >= 3) finishBattle();
      else { b.round++; b.phase = 'pick'; b.pick1 = null; b.pick2 = null; b.reveal = null; ui.p2Ready = false; render(); }
    });
  }

  function pickCard(id) {
    const b = ui.bt;
    if (b.mode === 'ai') {
      const card = b.me.deck.find(c => c.id === id);
      if (!card) return;
      b.me.used.push(id);
      const foeHand = b.foe.deck.filter(c => b.foe.used.indexOf(c.id) < 0);
      const foeCard = foeHand[Math.floor(Math.random() * foeHand.length)];
      b.foe.used.push(foeCard.id);
      b.pick1 = id; b.pick2 = foeCard.id;
      reveal();
    } else {
      if (b.pick1 == null) {
        b.pick1 = id;
        b.me.used.push(id);
        ui.p2Ready = false;
        render();
      } else {
        b.pick2 = id;
        b.foe.used.push(id);
        reveal();
      }
    }
  }

  function reveal() {
    const b = ui.bt;
    const a = b.me.deck.find(c => c.id === b.pick1);
    const c = b.foe.deck.find(x => x.id === b.pick2);
    if (!a || !c) return;
    const advA = advantage(a, c), advB = advantage(c, a);
    const pa = power(a) + (advA ? ADV : 0);
    const pb = power(c) + (advB ? ADV : 0);
    let win = pa > pb ? 0 : pb > pa ? 1 : -1;
    const r = { a: a.id, c: c.id, pa, pb, advA, advB, win };
    b.results.push(r);
    if (win === 0) b.score[0]++; else if (win === 1) b.score[1]++;
    b.reveal = { a, c, r };
    b.phase = 'reveal';
    A.sfx.flip();
    setTimeout(() => { if (win === 0) A.sfx.win(); else if (win === 1) A.sfx.lose(); else A.sfx.tap(); }, 420);
    if (win >= 0 && (b.score[win] >= 3)) setTimeout(() => { }, 200);
    render();
  }

  async function finishBattle() {
    const b = ui.bt;
    const winner = b.score[0] > b.score[1] ? 0 : b.score[1] > b.score[0] ? 1 : -1;
    let reward = '';
    if (winner === 0) {
      const pr = P.prof(b.me.profile);
      pr.coins += 10; pr.wins = (pr.wins || 0) + 1;
      P.save(); A.sfx.win(); reward = '+10 코인 획득!'; U.bumpCoins();
    } else if (winner === 1) {
      if (b.mode === 'p2') {
        const pr = P.prof(b.foe.profile);
        pr.coins += 10; pr.wins = (pr.wins || 0) + 1;
        P.save(); reward = b.foe.name + ' +10 코인';
      } else {
        const pr = P.prof(b.me.profile);
        pr.losses = (pr.losses || 0) + 1; P.save();
      }
      A.sfx.lose();
    } else {
      P.save(); A.sfx.tap();
    }
    const body = '<div style="text-align:center;font-size:34px;margin-bottom:8px">' +
      (winner === 0 ? '🏆' : winner === 1 ? '💧' : '🤝') + '</div>' +
      '<div style="text-align:center;font-size:19px;font-weight:900;margin-bottom:6px">' +
      (winner === 0 ? P.prof(b.me.profile).name + ' 승리!' : winner === 1 ? b.foe.name + ' 승리!' : '무승부') + '</div>' +
      '<div style="text-align:center;font-size:15px;font-weight:800;color:#ffd24a">' + b.score[0] + ' : ' + b.score[1] + '</div>' +
      (reward ? '<div style="text-align:center;margin-top:8px;color:#5df2a4;font-weight:800">' + reward + '</div>' : '') +
      '<div class="list" style="margin-top:14px">' + b.results.map((r, i) => {
        const ca = b.me.deck.find(c => c.id === r.a), cc = b.foe.deck.find(c => c.id === r.c);
        return '<div class="row"><b>' + (i + 1) + 'R</b><div class="grow"><b>' + esc(ca ? ca.name : '') + ' ' + r.pa +
          ' vs ' + r.pb + ' ' + esc(cc ? cc.name : '') + '</b></div>' +
          '<span>' + (r.win === 0 ? '🟦' : r.win === 1 ? '🟪' : '⬜') + '</span></div>';
      }).join('') + '</div>';
    P.modal({
      title: winner === 0 ? '🏆 배틀 승리' : '배틀 결과',
      body,
      buttons: [
        { label: '홈으로', kind: 'ghost', onClick: () => { ui.bt = null; U.go('home'); } },
        { label: '다시 배틀', kind: 'primary', onClick: () => { ui.bt = null; render(); } }
      ],
      onClose: () => { ui.bt = null; U.refreshHeader(); }
    });
  }

  window.PKBattle = { render, power, advantage };
})();
