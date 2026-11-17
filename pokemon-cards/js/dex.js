/* dex.js — 도감 · 카드 확대 팝업 · 별가루 · 선물 · 교환 */
(function () {
  'use strict';
  const P = window.PKC, D = window.PKData, U = window.PKUI, A = window.PKCAudio;
  const $ = P.$, esc = P.esc;

  const filt = { pack: null, type: 'all', owned: 'all', q: '' };
  const cardMap = {};          // id -> card (로드된 팩)
  let allCards = null;         // 전체 카드 배열 (한 번만 구성)
  let loadingAll = false;
  let shown = 0;
  const PAGE = 120;

  function registerCards(packData) {
    packData.cards.forEach(c => { cardMap[c.id] = c; });
  }

  async function ensurePack(packId) {
    const d = await D.loadPack(packId);
    registerCards(d);
    return d;
  }

  function findCard(id) {
    if (cardMap[id]) return cardMap[id];
    return null;
  }

  async function ensureCard(id) {
    if (cardMap[id]) return cardMap[id];
    const set = id.split('-')[0];
    const meta = D.allPacks().find(p => p.set === set);
    if (!meta) return null;
    await ensurePack(meta.id);
    return cardMap[id] || null;
  }

  async function loadAllCards(progress) {
    if (allCards) return allCards;
    if (loadingAll) return null;
    loadingAll = true;
    const packs = D.allPacks();
    const out = [];
    let i = 0;
    for (const p of packs) {
      try {
        const d = await D.loadPack(p.id);
        registerCards(d);
        d.cards.forEach(c => out.push(c));
      } catch (e) { }
      i++;
      if (progress && i % 4 === 0) progress(i, packs.length);
    }
    allCards = out;
    loadingAll = false;
    return out;
  }

  /* ---------------- 화면 ---------------- */
  async function render() {
    const root = $('#screen-dex');
    const pr = P.me();
    const packs = D.allPacks();
    if (!packs.length) return;
    if (!filt.pack) {
      // 가장 많이 모은 팩 → 없으면 최근 뜯은 팩 → 첫 팩
      let best = null, bestN = 0;
      packs.forEach(p => { const n = U.ownedOfPack(pr, p); if (n > bestN) { bestN = n; best = p.id; } });
      if (!best) {
        const opened = Object.keys(pr.opened || {});
        best = opened.length ? opened[opened.length - 1] : packs[0].id;
      }
      filt.pack = best;
    }
    const packChips = '<button class="chip small' + (filt.pack === 'all' ? ' active' : '') + '" data-fpack="all">🌏 전체</button>' +
      packs.map(p => '<button class="chip small' + (filt.pack === p.id ? ' active' : '') + '" data-fpack="' + p.id + '">' +
        esc(p.name.length > 12 ? p.name.slice(0, 12) + '…' : p.name) + '</button>').join('');

    const typeChips = '<button class="chip' + (filt.type === 'all' ? ' active' : '') + '" data-ftype="all">전체</button>' +
      D.TYPES.map(t => '<button class="chip' + (filt.type === t ? ' active' : '') + '" data-ftype="' + t + '">' +
        D.typeEmoji(t) + ' ' + t + '</button>').join('');

    root.innerHTML =
      '<div class="h1">📖 내 도감 <span class="muted" style="font-size:12px;font-weight:700">' + U.uniqueCards(pr) + '종</span></div>' +
      '<div class="card-panel" style="padding:10px">' +
        '<div class="search-row"><input id="dexSearch" placeholder="포켓몬 이름 검색" value="' + esc(filt.q) + '">' +
          '<button class="btn ghost sm" id="dexSearchBtn">🔍</button></div>' +
        '<div class="filter-bar" id="packChips">' + packChips + '</div>' +
        '<div class="filter-bar" id="typeChips">' + typeChips + '</div>' +
        '<div class="filter-bar" id="ownChips">' +
          '<button class="chip small' + (filt.owned === 'all' ? ' active' : '') + '" data-fown="all">전체</button>' +
          '<button class="chip small' + (filt.owned === 'own' ? ' active' : '') + '" data-fown="own">✅ 보유</button>' +
          '<button class="chip small' + (filt.owned === 'miss' ? ' active' : '') + '" data-fown="miss">⬜ 미보유</button>' +
        '</div>' +
      '</div>' +
      '<div id="dexBody"><div class="loading"><div class="spinner"></div>불러오는 중…</div></div>';

    root.querySelectorAll('[data-fpack]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap(); filt.pack = b.dataset.fpack; render();
    }));
    root.querySelectorAll('[data-ftype]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap(); filt.type = b.dataset.ftype; render();
    }));
    root.querySelectorAll('[data-fown]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap(); filt.owned = b.dataset.fown; render();
    }));
    const si = root.querySelector('#dexSearch');
    const doSearch = () => { filt.q = si.value.trim(); render(); };
    root.querySelector('#dexSearchBtn').addEventListener('click', doSearch);
    si.addEventListener('keydown', e => { if (e.key === 'Enter') { si.blur(); doSearch(); } });

    const body = root.querySelector('#dexBody');
    if (filt.pack === 'all') {
      if (!allCards) {
        body.innerHTML = '<div class="loading"><div class="spinner"></div><div id="loadTxt">도감 불러오는 중…</div></div>';
        const txt = body.querySelector('#loadTxt');
        await loadAllCards((i, n) => { if (txt) txt.textContent = '도감 불러오는 중… ' + i + '/' + n; });
      }
      shown = 0;
      paint(body, allCards || []);
    } else {
      const d = await ensurePack(filt.pack);
      shown = 0;
      paint(body, d.cards);
    }
  }

  function filtered(list) {
    const pr = P.me();
    return list.filter(c => {
      if (filt.type !== 'all' && c.t !== filt.type) return false;
      const own = !!pr.cards[c.id];
      if (filt.owned === 'own' && !own) return false;
      if (filt.owned === 'miss' && own) return false;
      if (filt.q && c.name.indexOf(filt.q) < 0) return false;
      return true;
    });
  }

  function paint(host, list) {
    const pr = P.me();
    const arr = filtered(list);
    const head = '<div class="muted" style="margin:10px 2px 6px">' + arr.length + '장 · 보유 ' +
      arr.filter(c => pr.cards[c.id]).length + '장</div>';
    if (!arr.length) { host.innerHTML = head + '<div class="empty">조건에 맞는 카드가 없어요</div>'; return; }
    host.innerHTML = head + '<div class="dex-grid" id="dexGrid"></div>' +
      '<div id="dexMore" style="margin:14px 0"></div>';
    const grid = host.querySelector('#dexGrid');
    const more = host.querySelector('#dexMore');
    function chunk() {
      const next = arr.slice(shown, shown + PAGE);
      next.forEach(c => {
        const own = pr.cards[c.id] || 0;
        const div = document.createElement('div');
        div.className = 'dex-card r' + c.r + (own ? '' : ' lock');
        div.dataset.card = c.id;
        div.innerHTML = '<img loading="lazy" decoding="async" src="' + D.img(c.img) + '" alt="' + esc(c.name) + '">' +
          (c.r >= 4 ? '<span class="rar" style="color:' + (c.r === 5 ? '#ffd24a' : '#c9a8ff') + '">' + (c.r === 5 ? '★5' : '★4') + '</span>' : '') +
          (own > 1 ? '<span class="cnt">×' + own + '</span>' : '') +
          (own ? '<span class="pk">' + esc(c.name) + '</span>' : '');
        div.addEventListener('click', () => openCard(c.id));
        grid.appendChild(div);
      });
      shown += next.length;
      more.innerHTML = shown < arr.length ?
        '<button class="btn ghost wide" id="moreBtn">더 보기 (' + shown + '/' + arr.length + ')</button>' : '';
      const mb = more.querySelector('#moreBtn');
      if (mb) mb.addEventListener('click', chunk);
    }
    chunk();
  }

  /* ---------------- 카드 팝업 ---------------- */
  async function openCard(id, opts) {
    const card = await ensureCard(id);
    if (!card) { P.toast('카드 정보를 찾을 수 없어요'); return; }
    A.unlock();
    const pr = P.me();
    const own = pr.cards[id] || 0;
    const srcPack = pr.src[id] ? D.packMeta(pr.src[id]) : null;
    const typeColor = D.typeColor(card.t);
    const isFav = pr.fav.indexOf(id) >= 0;
    const rarityLabel = D.rarityKo(card.rr) + (card.v ? '' : ' ·추정');

    const wrap = P.el('div');
    wrap.innerHTML =
      '<div class="card3d-wrap"><div class="card3d r' + card.r + (card.r >= 4 ? ' holo' + card.r : '') + '" id="c3d">' +
        '<div class="frame"></div>' +
        '<img src="' + D.img(card.img) + '" alt="' + esc(card.name) + '">' +
        '<div class="holo"></div>' +
        '<div class="type-fx" id="typeFx"></div>' +
      '</div></div>' +
      '<div class="card-info">' +
        '<div class="ct"><b>' + esc(card.name) + '</b>' +
          '<button class="btn ghost sm" id="ttsBtn" style="margin-left:auto">🔊 이름</button></div>' +
        '<div class="tset">' +
          '<span class="tbadge" style="color:' + typeColor + ';border-color:' + typeColor + '55;background:' + typeColor + '18">' +
            D.typeEmoji(card.t) + ' ' + esc(card.t || '기타') + '</span>' +
          (card.hp ? '<span class="tbadge" style="color:#ffd24a;border-color:#ffd24a55;background:#ffd24a14">HP ' + card.hp + '</span>' : '') +
          '<span class="tbadge" style="color:#c9a8ff;border-color:#c9a8ff55;background:#c9a8ff14">' + esc(rarityLabel) + '</span>' +
          (isFav ? '<span class="tbadge" style="color:#ffd24a;border-color:#ffd24a66">⭐ 최애</span>' : '') +
        '</div>' +
        '<div class="kv"><span>카드 번호</span><b>' + esc(card.nn) + '</b></div>' +
        '<div class="kv"><span>카드 종류</span><b>' + esc(card.k || '-') + '</b></div>' +
        '<div class="kv"><span>내 보유</span><b>' + (own ? own + '장' : '미보유') + '</b></div>' +
        '<div class="kv"><span>획득 팩</span><b>' + esc(srcPack ? srcPack.name : '-') + '</b></div>' +
        '<div class="kv"><span>별가루</span><b>' + P.won(pr.stardust || 0) + ' ✨</b></div>' +
      '</div>' +
      '<div class="chips-row" id="cardActions"></div>';

    const m = P.modal({
      title: '카드 정보',
      body: wrap,
      buttons: [
        { label: '✕ 나가기', kind: 'ghost' },
        { label: '확인', kind: 'primary' }
      ],
      onMount: (body, close) => {
        // 3D 틸트
        const c3d = wrap.querySelector('#c3d');
        c3d.addEventListener('pointermove', e => {
          const r = c3d.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          c3d.style.transform = 'rotateY(' + (px * 18).toFixed(1) + 'deg) rotateX(' + (-py * 18).toFixed(1) + 'deg) scale(1.03)';
        });
        c3d.addEventListener('pointerleave', () => { c3d.style.transform = ''; });
        // 속성 이펙트
        setTimeout(() => { A.sfx.typePop(card.t); typeFx(wrap.querySelector('#typeFx'), card.t); }, 220);
        setTimeout(() => { if (card.r >= 4) A.sfx.sparkle(); }, 500);
        // TTS
        wrap.querySelector('#ttsBtn').addEventListener('click', () => speak(card.name));
        // 액션
        const acts = wrap.querySelector('#cardActions');
        acts.innerHTML =
          '<button class="btn ghost sm" id="favBtn">' + (isFav ? '⭐ 최애 해제' : '⭐ 최애 핀') + '</button>' +
          (own >= 2 ? '<button class="btn ghost sm" id="dustBtn">♻️ 별가루 변환 (' + starDust(card) + '✨)</button>' : '') +
          (own >= 2 ? '<button class="btn ghost sm" id="giftBtn">🎁 남매에게 선물</button>' : '') +
          '<button class="btn ghost sm" id="admBtn">' + (P.isAdmin() ? '🔓 아빠 모드' : '🔒 아빠') + '</button>';

        wrap.querySelector('#favBtn').addEventListener('click', () => {
          const i = pr.fav.indexOf(id);
          if (i >= 0) { pr.fav.splice(i, 1); P.toast('최애에서 뺐어요'); }
          else {
            if (pr.fav.length >= 3) { P.toast('최애는 3장까지만 고정할 수 있어요'); A.sfx.error(); return; }
            pr.fav.push(id); P.toast('⭐ 최애 카드로 고정!', true); A.sfx.sparkle();
          }
          P.save(); close(true);
        });
        const db = wrap.querySelector('#dustBtn');
        if (db) db.addEventListener('click', () => {
          if ((pr.cards[id] || 0) < 2) return;
          const gain = starDust(card);
          U.removeCard(P.state.active, id, 1);
          pr.stardust = (pr.stardust || 0) + gain;
          P.save(); A.sfx.coin(); P.toast('♻️ 별가루 +' + gain + '✨');
          close(true); U.refreshHeader();
          if ($('#screen-dex').classList.contains('active')) render();
        });
        const gb = wrap.querySelector('#giftBtn');
        if (gb) gb.addEventListener('click', () => { close(true); giftModal(card); });
        wrap.querySelector('#admBtn').addEventListener('click', () => {
          if (P.isAdmin()) { close(true); adminCard(card); }
          else P.pinPrompt('🔒 아빠 확인', () => { close(true); adminCard(card); });
        });
      }
    });
  }

  function typeFx(host, type) {
    if (!host) return;
    const emo = D.typeEmoji(type);
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('i');
      s.textContent = emo;
      s.style.left = (8 + Math.random() * 84) + '%';
      s.style.animationDelay = (i * 90) + 'ms';
      s.style.fontSize = (12 + Math.random() * 10) + 'px';
      host.appendChild(s);
      setTimeout(() => s.remove(), 2600 + i * 90);
    }
  }

  function starDust(card) { return { 1: 3, 2: 8, 4: 25, 5: 80 }[card.r] || 3; }
  function dustCost(card) { return { 1: 8, 2: 20, 4: 60, 5: 180 }[card.r] || 8; }

  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) { P.toast('이 기기에서는 읽어주기를 지원하지 않아요'); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = 0.92; u.pitch = 1.06;
      const vs = window.speechSynthesis.getVoices();
      const ko = vs.find(v => /ko[-_]KR/i.test(v.lang));
      if (ko) u.voice = ko;
      window.speechSynthesis.speak(u);
    } catch (e) { P.toast('읽어주기를 사용할 수 없어요'); }
  }

  /* 선물 */
  function giftModal(card) {
    const pr = P.me();
    const others = P.PROFILES.filter(p => p.id !== P.state.active);
    const body = P.el('div');
    body.innerHTML = '<p class="muted" style="margin:0 0 10px">' + esc(card.name) + ' 1장을 선물할 친구를 골라요. (내 보유 ' + (pr.cards[card.id] || 0) + '장)</p>' +
      '<div class="list">' + others.map(o => {
        const op = P.prof(o.id);
        return '<button class="row" data-gift="' + o.id + '" style="text-align:left"><div class="avatar">' + o.emoji + '</div>' +
          '<div class="grow"><b>' + esc(op.name) + '</b><small>보유 ' + (op.cards[card.id] || 0) + '장</small></div>' +
          '<span class="btn sm ghost">🎁 선물</span></button>';
      }).join('') + '</div>';
    const m = P.modal({
      title: '🎁 카드 선물하기', body,
      buttons: [{ label: '✕ 나가기', kind: 'ghost' }]
    });
    body.querySelectorAll('[data-gift]').forEach(b => b.addEventListener('click', async () => {
      const to = b.dataset.gift;
      const ok = await P.confirmBox('선물 확인', esc(pr.name) + ' → <b>' + esc(P.prof(to).name) + '</b><br>' + esc(card.name) + ' 1장을 선물할까요?', '🎁 선물하기');
      if (!ok) return;
      if ((pr.cards[card.id] || 0) < 2) { P.toast('2장 이상일 때만 선물할 수 있어요'); return; }
      U.removeCard(P.state.active, card.id, 1);
      U.addCard(to, card, pr.src[card.id] || null, 1);
      A.sfx.sparkle(); P.toast(P.prof(to).name + '에게 ' + card.name + ' 선물 완료!', true);
      m.close(true);
      U.checkTrophies(to, true);
      render();
    }));
  }

  /* 아빠 카드 관리 */
  function adminCard(card) {
    const pr = P.me();
    const body = P.el('div');
    body.innerHTML = '<p class="muted" style="margin:0 0 10px">🔓 아빠 모드 · ' + esc(pr.name) + ' 도감</p>' +
      '<div class="row"><div class="grow"><b>' + esc(card.name) + '</b><small>현재 ' + (pr.cards[card.id] || 0) + '장</small></div></div>' +
      '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn gold" id="admAdd">+1장 선물</button>' +
        '<button class="btn danger" id="admDel">🗑 1장 삭제</button>' +
      '</div>';
    const m = P.modal({
      title: '🔒 아빠 관리자', body,
      buttons: [{ label: '✕ 나가기', kind: 'ghost' }, { label: '확인', kind: 'primary' }]
    });
    body.querySelector('#admAdd').addEventListener('click', () => {
      U.addCard(P.state.active, card, pr.src[card.id] || null, 1);
      A.sfx.coin(); P.toast('+1장 지급 완료', true); m.close(true);
      U.checkTrophies(P.state.active);
      render();
    });
    body.querySelector('#admDel').addEventListener('click', async () => {
      const ok = await P.confirmBox('카드 삭제', esc(card.name) + ' 1장을 도감에서 지울까요?', '🗑 삭제');
      if (!ok) return;
      U.removeCard(P.state.active, card.id, 1);
      P.toast('삭제했어요'); m.close(true); render();
    });
  }

  /* 별가루 교환 (미보유 카드) */
  async function dustExchange(card) {
    const pr = P.me();
    if (pr.cards[card.id]) { P.toast('이미 보유한 카드예요'); return; }
    const cost = dustCost(card);
    const ok = await P.confirmBox('별가루 교환',
      esc(card.name) + ' 카드를 <b>' + cost + '✨</b>에 교환할까요?<br>(내 별가루 ' + P.won(pr.stardust || 0) + '✨)', '✨ 교환하기');
    if (!ok) return;
    if ((pr.stardust || 0) < cost) { A.sfx.error(); P.toast('별가루가 부족해요'); return; }
    pr.stardust -= cost;
    U.addCard(P.state.active, card, filt.pack !== 'all' ? filt.pack : null, 1);
    P.save(); A.sfx.sparkle(); P.toast(card.name + ' 획득!', true);
    U.checkTrophies(P.state.active);
    render();
  }

  window.PKDex = {
    render, openCard, findCard, ensureCard, ensurePack, registerCards, starDust, dustCost, dustExchange,
    loadAll: () => loadAllCards(),
    get allCards() { return allCards; }
  };
})();
