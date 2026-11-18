/* ui.js — 공통 화면 · 상태 조작 · 트로피 */
(function () {
  'use strict';
  const P = window.PKC, D = window.PKData;
  const $ = P.$, esc = P.esc;

  /* ---------- 상태 조작 ---------- */
  function addCard(profileId, card, packId, n) {
    const pr = P.prof(profileId);
    const before = pr.cards[card.id] || 0;
    pr.cards[card.id] = before + (n || 1);
    if (packId) pr.src[card.id] = packId;
    P.save();
    return before;
  }
  function removeCard(profileId, cardId, n) {
    const pr = P.prof(profileId);
    const cur = pr.cards[cardId] || 0;
    const next = Math.max(0, cur - (n || 1));
    if (next === 0) { delete pr.cards[cardId]; delete pr.src[cardId]; }
    else pr.cards[cardId] = next;
    pr.fav = pr.fav.filter(id => pr.cards[id]);
    P.save();
    return next;
  }
  function totalCards(pr) {
    return Object.keys(pr.cards).reduce((a, k) => a + pr.cards[k], 0);
  }
  function uniqueCards(pr) { return Object.keys(pr.cards).length; }

  /* ---------- 트로피 ---------- */
  function ownedOfPack(pr, meta) {
    let n = 0;
    const pre = meta.set + '-';
    for (const k in pr.cards) if (k.indexOf(pre) === 0) n++;
    return n;
  }

  function checkTrophies(profileId, silent) {
    const pr = P.prof(profileId);
    const got = [];
    const packs = D.allPacks();
    for (const meta of packs) {
      const n = ownedOfPack(pr, meta);
      const rate = n / Math.max(1, meta.total);
      const b50 = 'p50:' + meta.id, b100 = 'p100:' + meta.id;
      if (rate >= 0.5 && pr.badges.indexOf(b50) < 0) {
        pr.badges.push(b50); pr.coins += 100;
        got.push({ em: '🏅', title: meta.name + ' 50%', desc: '100코인 지급!' });
      }
      if (rate >= 1 && pr.badges.indexOf(b100) < 0) {
        pr.badges.push(b100); pr.coins += 300;
        got.push({ em: '🏆', title: meta.name + ' 완주!', desc: '300코인 지급!' });
      }
    }
    const uniq = uniqueCards(pr);
    P.TITLES.forEach(t => {
      if (uniq >= t.need && pr.titles.indexOf(t.id) < 0) {
        pr.titles.push(t.id);
        const bonus = { start: 0, c50: 50, c150: 120, c300: 250, c600: 500 }[t.id] || 0;
        pr.coins += bonus;
        got.push({ em: '🎖️', title: '칭호 획득 · ' + t.name, desc: t.desc + (bonus ? ' · ' + bonus + '코인' : '') });
      }
    });
    if (got.length) P.save();
    if (got.length && !silent) {
      window.PKCAudio.sfx.sparkle();
      P.modal({
        title: '🎉 새 트로피!',
        body: '<div class="list">' + got.map(g =>
          '<div class="trophy"><div class="em">' + g.em + '</div><div><b>' + esc(g.title) + '</b><small>' + esc(g.desc) + '</small></div></div>'
        ).join('') + '</div>',
        buttons: [{ label: '확인', kind: 'gold' }]
      });
    }
    return got;
  }

  /* ---------- 헤더 ---------- */
  function refreshHeader() {
    const pr = P.me();
    const meta = P.profileMeta(P.state.active);
    $('#coinNum').textContent = P.won(pr.coins);
    $('#pfName').textContent = pr.name || meta.name;
    $('#pfEmoji').textContent = pr.emoji || meta.emoji;
    /* 🎖️ 배틀 칭호는 프로필 칩에 마우스를 올리면 보인다 */
    const pf = $('#pfChip');
    if (pf) {
      const bt = P.battleTitle(P.pvpOf(pr).w);
      pf.setAttribute('title', (pr.name || meta.name) + ' · ' + bt.name);
    }
    const sb = $('#soundBtn');
    const on = P.state.settings.sfx;
    sb.textContent = on ? (P.state.settings.bgm ? '🔊' : '🔈') : '🔇';
    sb.classList.toggle('off', !on);
    /* 📳 진동 상태 */
    const vb = $('#vibBtn');
    if (vb) {
      const vib = P.vibOn();
      vb.textContent = vib ? '📳' : '📴';
      vb.classList.toggle('off', !vib);
      vb.setAttribute('aria-label', vib ? '진동 끄기' : '진동 켜기');
      vb.setAttribute('title', vib ? '진동 켜짐 — 눌러서 끄기' : '진동 꺼짐 — 눌러서 켜기');
    }
  }
  function bumpCoins() {
    const c = $('#coinChip');
    c.classList.remove('pulse');
    void c.offsetWidth;
    c.classList.add('pulse');
  }

  function go(tab) {
    P.$$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    P.$$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + tab));
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (tab !== 'battle') window.PKCAudio.setMode('home');
    if (tab === 'home') renderHome();
    if (tab === 'shop' && window.PKShop) window.PKShop.render();
    if (tab === 'dex' && window.PKDex) window.PKDex.render();
    if (tab === 'battle' && window.PKBattle) window.PKBattle.render();
    if (tab === 'more' && window.PKMore) window.PKMore.render();
    refreshHeader();
  }

  /* ---------- 홈 ---------- */
  async function renderHome() {
    const root = $('#screen-home');
    const pr = P.me();
    const total = totalCards(pr), uniq = uniqueCards(pr);
    const meta = P.profileMeta(P.state.active);
    let packsDone = 0, packsHalf = 0;
    D.allPacks().forEach(p => {
      const b50 = pr.badges.indexOf('p50:' + p.id) >= 0, b100 = pr.badges.indexOf('p100:' + p.id) >= 0;
      if (b100) packsDone++; else if (b50) packsHalf++;
    });
    const today = D.todayPack();
    const favHtml = [0, 1, 2].map(i => {
      const id = pr.fav[i];
      if (!id) return '<div class="fav-slot">⭐<br>최애 ' + (i + 1) + '</div>';
      const card = window.PKDex ? window.PKDex.findCard(id) : null;
      if (!card) {
        if (window.PKDex) window.PKDex.ensureCard(id).then(c => { if (c) renderHome(); });
        return '<div class="fav-slot">⭐<br>최애 ' + (i + 1) + '</div>';
      }
      return '<div class="fav-slot" data-fav="' + esc(card.id) + '"><img loading="lazy" src="' + D.img(card.img) + '" alt="">' +
        '<div class="cap">' + esc(card.name) + '</div></div>';
    }).join('');

    root.innerHTML =
      '<div class="hero">' +
        '<div class="who">' + esc(meta.emoji) + ' ' + esc(pr.name) + ' 님의 카드 노트</div>' +
        '<div class="big">🪙 ' + P.won(pr.coins) + ' 코인</div>' +
        '<div class="sub">' + (today ? '오늘의 추천 팩 <b>' + esc(today.pack.name) + '</b> · ' + today.price + '코인' : '카드팩을 뜯어 도감을 채워보세요!') + '</div>' +
        '<div class="stat-row">' +
          '<div class="stat"><b>' + P.won(total) + '</b><span>모은 카드</span></div>' +
          '<div class="stat"><b>' + P.won(uniq) + '</b><span>도감 종류</span></div>' +
          '<div class="stat"><b>' + packsDone + '</b><span>완주 팩</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="home-duo"><div class="hd-left">' +
      (today ? '<div class="h2">🔥 오늘의 추천 팩</div>' +
        '<button class="today-card" id="homeToday"><span class="shine"></span>' +
          '<div style="width:66px;flex:0 0 66px">' + packArt(today.pack, {tiny:true}) + '</div>' +
          '<div class="tc-txt"><div class="tagline">오늘만 이 가격! R 이상 확률 UP</div>' +
          '<b>' + esc(today.pack.name) + '</b>' +
          '<div class="muted" style="margin-top:3px"><s>' + today.pack.price + '코인</s> → <b style="color:#ffe9bf">' + today.price + '코인</b></div></div>' +
          '<div class="btn gold sm">뜯기</div>' +
        '</button>' : '') +
      '</div><div class="hd-right">' +
      '<div class="h2">⭐ 최애 카드</div>' +
      '<div class="fav-wrap">' + favHtml + '</div>' +
      '</div></div>' +
      '<div class="h2">바로 가기</div>' +
      '<div class="quick-grid">' +
        '<button class="quick" data-go="shop"><span class="ico">🛍️</span><b>카드팩 뜯기</b><span>' + D.allPacks().length + '개 팩</span></button>' +
        '<button class="quick" data-go="dex"><span class="ico">📖</span><b>내 도감</b><span>' + P.won(uniq) + '종 수집</span></button>' +
        '<button class="quick" data-go="battle"><span class="ico">⚔️</span><b>카드 배틀</b><span>★12 코스트 아레나</span></button>' +
        '<button class="quick" data-go="more"><span class="ico">🎒</span><b>내 정보</b><span>칭호 · 교환함 · 관리자</span></button>' +
      '</div>';

    root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      window.PKCAudio.unlock(); window.PKCAudio.sfx.tap(); go(b.dataset.go);
    }));
    const tt = root.querySelector('#homeToday');
    if (tt) tt.addEventListener('click', () => {
      window.PKCAudio.unlock();
      window.PKShop.openFlow(today.pack.id, { price: today.price, boosted: true });
    });
    root.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', () => {
      window.PKDex.openCard(b.dataset.fav);
    }));
  }

  /* ---------- 카드 타일 ---------- */
  function cardTile(card, opts) {
    opts = opts || {};
    const cls = 'dex-card r' + card.r + (opts.locked ? ' lock' : '');
    const pw = P.cardWinCount(opts.profile || P.state.active, card.id) * 5;
    return '<button class="' + cls + '" data-card="' + esc(card.id) + '">' +
      '<img loading="lazy" decoding="async" src="' + D.img(card.img) + '" alt="' + esc(card.name) + '">' +
      (card.r >= 4 ? '<span class="rar" style="color:' + (card.r === 5 ? '#ffe9bf' : '#c9b6ff') + '">' + (card.r === 5 ? '★5' : '★4') + '</span>' : '') +
      (pw > 0 ? '<span class="pw-badge">⚡+' + pw + '</span>' : '') +
      (opts.count > 1 ? '<span class="cnt">×' + opts.count + '</span>' : '') +
      '</button>';
  }

  /* ---------- 팩 아트 ---------- */
  const SERIES_STYLE = {
    sv: { c1: '#7a3cff', c2: '#241a5c', em: '🟣', label: 'SCARLET & VIOLET', era: 'SV' },
    swsh: { c1: '#1e6bff', c2: '#0b1e46', em: '🔵', label: 'SWORD & SHIELD', era: 'SWSH' },
    classic: { c1: '#d9a13a', c2: '#3d2408', em: '🟡', label: 'CLASSIC', era: 'SM' },
    high: { c1: '#ff4fb0', c2: '#3d0830', em: '✨', label: 'HIGH CLASS', era: 'HIGH' }
  };
  const ERA_STYLE = {
    sm: { c1: '#c98f2c', c2: '#3a2106', em: '🌗', label: 'SUN & MOON', era: 'SM' },
    xy: { c1: '#2f8ad6', c2: '#0a2440', em: '🧬', label: 'XY ERA', era: 'XY' },
    bw: { c1: '#6f7b8f', c2: '#151b28', em: '⚫', label: 'BLACK & WHITE', era: 'BW' }
  };

  function packArt(meta, opts) {
    opts = opts || {};
    const st = (meta.cat === 'classic' && ERA_STYLE[meta.era]) || SERIES_STYLE[meta.cat] || SERIES_STYLE.sv;
    return '<div class="pack-art' + (opts.tiny ? ' sm' : (opts.cls ? ' ' + opts.cls : '')) + '" style="--c1:' + st.c1 + ';--c2:' + st.c2 + '">' +
      '<img class="pa-bg" src="' + D.img(meta.cover) + '" alt="" loading="lazy" decoding="async">' +
      '<div class="pa-glow"></div>' +
      '<div class="pa-crimp"></div>' +
      '<div class="pa-top"><span class="pa-series">' + (st.em || '') + ' ' + st.label + '</span></div>' +
      '<div class="pa-mid"></div>' +
      '<div class="pa-name">' + esc(meta.name) + '</div>' +
      '<div class="pa-bottom"><span>5 CARDS</span><span>' + meta.total + '종</span></div>' +
      '<div class="pa-shine"></div>' +
    '</div>';
  }

  window.PKUI = {
    addCard, removeCard, totalCards, uniqueCards, checkTrophies, ownedOfPack,
    refreshHeader, bumpCoins, go, renderHome, cardTile, packArt
  };
})();
