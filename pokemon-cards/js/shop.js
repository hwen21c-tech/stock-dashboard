/* shop.js — 팩 상점 · 팩 뜯기 연출 */
(function () {
  'use strict';
  const P = window.PKC, D = window.PKData, U = window.PKUI, A = window.PKCAudio;
  const $ = P.$, esc = P.esc;

  let activeCat = 'sv';
  let busy = false;

  function ownedInPack(pr, meta) {
    let n = 0;
    for (const k in pr.cards) if (k.indexOf(meta.set + '-') === 0) n++;
    return n;
  }

  function render() {
    const root = $('#screen-shop');
    const pr = P.me();
    const idx = D.allPacks();
    if (!idx.length) { root.innerHTML = '<div class="loading"><div class="spinner"></div>불러오는 중…</div>'; return; }
    if (!idx.some(p => p.cat === activeCat)) activeCat = 'sv';
    const series = D.seriesList();
    const today = D.todayPack();
    const list = D.packsOf(activeCat);

    const tabs = series.map(s => {
      const n = D.packsOf(s.key).length;
      return '<button class="series-tab' + (s.key === activeCat ? ' active' : '') + '" data-cat="' + s.key + '">' +
        s.emoji + ' ' + esc(s.name) + ' <span style="opacity:.6">' + n + '</span></button>';
    }).join('');

    const todayHtml = today ? (
      '<button class="today-card" id="shopToday" style="margin-bottom:10px"><span class="shine"></span>' +
      '<div style="width:84px;flex:0 0 84px">' + U.packArt(today.pack, {tiny:true}) + '</div>' +
      '<div class="tc-txt"><div class="tagline">⚡ 오늘의 추천 팩 · R 이상 확률 UP</div>' +
      '<b>' + esc(today.pack.name) + '</b>' +
      '<div class="muted" style="margin-top:3px"><s>' + today.pack.price + '코인</s> → <b style="color:#ffe9a8">' + today.price + '코인</b></div></div>' +
      '<div class="btn gold sm">뜯기</div></button>') : '';

    const grid = list.map(p => {
      const own = ownedInPack(pr, p);
      const rate = Math.min(1, own / p.total);
      const isToday = today && today.pack.id === p.id;
      const done = own >= p.total;
      const half = rate >= 0.5;
      const ticket = p.price === 80 ? pr.tickets.high : pr.tickets.normal;
      return '<div class="pack' + (isToday ? ' today' : '') + '" data-pack="' + p.id + '">' +
        '<div class="cover">' + U.packArt(p, {}) +
          (isToday ? '<span class="badge-hot">오늘의 팩</span>' : '') +
          (done ? '<span class="badge-done">완주 🏆</span>' : (half ? '<span class="badge-done">50% 🏅</span>' : '')) +
        '</div>' +
        '<div class="pbody">' +
          '<div class="bar' + (done ? ' done' : '') + '"><i style="width:' + (rate * 100).toFixed(1) + '%"></i></div>' +
          '<div class="pmeta"><span>' + own + ' / ' + p.total + '장</span><span>' + (rate * 100).toFixed(0) + '%</span></div>' +
          '<div class="btn primary sm pbtn" data-open="' + p.id + '">' + (isToday ? today.price : p.price) + '🪙 뜯기</div>' +
          (ticket > 0 ? '<div class="btn ghost sm" data-ticket="' + p.id + '" style="padding:6px;font-size:11.5px">🎟️ 티켓 ' + ticket + '장</div>' : '') +
        '</div></div>';
    }).join('');

    root.innerHTML =
      '<div class="h1">🛍️ 카드팩 상점</div>' +
      '<div class="muted" style="margin:-6px 2px 8px">' + idx.length + '개 공식 카드팩 · 5장씩 뜯기</div>' +
      todayHtml +
      '<div class="series-tabs">' + tabs + '</div>' +
      '<div class="muted" style="margin:0 2px 8px">' + esc((series.find(s => s.key === activeCat) || {}).desc || '') + '</div>' +
      '<div class="pack-grid">' + grid + '</div>' +
      '<div class="muted" style="margin:16px 2px;font-size:11.5px;line-height:1.6">일반 팩 50코인 · 하이클래스 팩 80코인. 아빠 PIN으로 코인·티켓을 선물할 수 있어요.</div>';

    root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap(); activeCat = b.dataset.cat; render();
    }));
    root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation(); A.unlock();
      const id = b.dataset.open;
      const meta = D.packMeta(id);
      const t = today && today.pack.id === id;
      openFlow(id, { price: t ? today.price : meta.price, boosted: !!t });
    }));
    root.querySelectorAll('[data-ticket]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation(); A.unlock();
      const id = b.dataset.ticket;
      const meta = D.packMeta(id);
      const t = today && today.pack.id === id;
      openFlow(id, { price: t ? today.price : meta.price, boosted: !!t, ticket: true });
    }));
    const tt = root.querySelector('#shopToday');
    if (tt) tt.addEventListener('click', () => {
      A.unlock();
      openFlow(today.pack.id, { price: today.price, boosted: true });
    });
  }

  /* ---------- 팩 뜯기 ---------- */
  async function openFlow(packId, o) {
    if (busy) return;
    const pr = P.me();
    const meta = D.packMeta(packId);
    if (!meta) return;
    const price = o.price != null ? o.price : meta.price;
    const isHigh = meta.price === 80;
    const tkey = isHigh ? 'high' : 'normal';
    if (o.ticket) {
      if (!pr.tickets[tkey]) { P.toast('티켓이 없어요'); return; }
    } else if (pr.coins < price) {
      A.sfx.error(); P.toast('코인이 부족해요 · ' + (price - pr.coins) + '코인 더 필요해요');
      return;
    }
    busy = true;
    let packData;
    try { packData = await D.loadPack(packId); }
    catch (e) { busy = false; P.toast('팩 데이터를 불러오지 못했어요'); return; }

    if (o.ticket) pr.tickets[tkey] -= 1; else { pr.coins -= price; U.bumpCoins(); }
    pr.opened[packId] = (pr.opened[packId] || 0) + 1;
    P.state.profiles[P.state.active] = pr;
    P.save();
    U.refreshHeader();

    const cards = D.pull(packData, !!o.boosted);
    const isNew = cards.map(c => !pr.cards[c.id]);
    // 뜯는 순간 카드 지급 (중간에 나가도 유지)
    cards.forEach(c => { U.addCard(P.state.active, c, packId, 1); });
    U.refreshHeader();

    const stage = P.el('div', 'open-stage');
    stage.innerHTML =
      '<button class="btn ghost sm close" id="opClose">✕ 나가기</button>' +
      '<div id="opArea" style="display:flex;flex-direction:column;align-items:center;width:100%;max-width:720px"></div>';
    document.body.appendChild(stage);

    let finished = false;
    function finish(save) {
      if (finished) return;
      finished = true;
      stage.style.transition = 'opacity .25s'; stage.style.opacity = '0';
      setTimeout(() => stage.remove(), 260);
      busy = false;
      U.checkTrophies(P.state.active);
      if (window.PKShop && $('#screen-shop').classList.contains('active')) render();
      if ($('#screen-home').classList.contains('active')) U.renderHome();
      U.refreshHeader();
    }
    stage.querySelector('#opClose').addEventListener('click', () => {
      // 아직 안 뜯었으면 코인 환불
      if (!torn) {
        if (o.ticket) pr.tickets[tkey] += 1; else pr.coins += price;
        pr.opened[packId] = Math.max(0, (pr.opened[packId] || 1) - 1);
        P.save(); U.refreshHeader();
        finish(false);
      } else finish(true);
    });

    let torn = false;
    const area = stage.querySelector('#opArea');
    area.innerHTML =
      '<div class="pack-visual" id="pv">' +
        U.packArt(meta, {}) +
        '<div class="tear-flap" id="flap" style="transform:rotateX(0deg)"></div>' +
        '<div class="tear-line" id="tline"></div>' +
      '</div>' +
      '<div class="open-hint" id="opHint"><b>' + esc(meta.name) + '</b><br>팩 위쪽을 드래그하거나 아래 버튼을 눌러 뜯어요!</div>' +
      '<div class="btn-row" style="margin-top:14px;justify-content:center">' +
        '<button class="btn gold" id="ripBtn">✂️ 팩 뜯기</button>' +
      '</div>';

    const pv = area.querySelector('#pv');
    const flap = area.querySelector('#flap');
    const tline = area.querySelector('#tline');

    function doRip() {
      if (torn) return;
      torn = true;
      A.sfx.rip(); P.haptic(18);
      tline.classList.add('show');
      flap.style.transition = 'transform .55s cubic-bezier(.3,.9,.3,1), opacity .55s';
      flap.style.transform = 'rotateX(-135deg) translateY(-10px)';
      flap.style.opacity = '0.2';
      pv.style.transition = 'transform .5s ease';
      pv.style.transform = 'scale(1.06)';
      sparkle(area, 18);
      setTimeout(() => {
        A.sfx.whoosh();
        const b = P.el('div', 'burst');
        document.body.appendChild(b);
        setTimeout(() => b.remove(), 800);
      }, 380);
      setTimeout(() => showCards(), 760);
    }
    area.querySelector('#ripBtn').addEventListener('click', doRip);
    pv.addEventListener('click', doRip);
    // swipe tear
    let sx = 0, sy = 0, dragging = false;
    pv.addEventListener('pointerdown', e => { dragging = true; sx = e.clientX; sy = e.clientY; });
    pv.addEventListener('pointerup', e => {
      if (!dragging) return; dragging = false;
      if (Math.abs(e.clientX - sx) > 42 || Math.abs(e.clientY - sy) > 42) doRip();
    });

    function showCards() {
      area.innerHTML =
        '<div class="muted" style="margin-bottom:8px">카드를 하나씩 터치해서 뒤집어 보세요!</div>' +
        '<div class="open-cards">' + cards.map((c, i) =>
          '<div class="flip-card" data-i="' + i + '">' +
            '<div class="halo"></div><div class="rainbow"></div>' +
            '<div class="flip-inner">' +
              '<div class="flip-back">🎴</div>' +
              '<div class="flip-front"><img src="' + D.img(c.img) + '" alt="' + esc(c.name) + '">' +
                (isNew[i] ? '<span class="new-tag">NEW</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>').join('') + '</div>' +
        '<div class="btn-row" style="margin-top:14px;justify-content:center">' +
          '<button class="btn ghost" id="allFlip">🔄 모두 뒤집기</button>' +
          '<button class="btn primary" id="doneBtn" disabled>확인 (0/5)</button>' +
        '</div>' +
        '<div class="open-result" id="opResult"></div>';

      let revealed = 0;
      const flipped = new Set();
      const doneBtn = area.querySelector('#doneBtn');

      function flip(i) {
        const el = area.querySelector('.flip-card[data-i="' + i + '"]');
        if (!el || el.classList.contains('flipped')) return;
        el.classList.add('flipped');
        flipped.add(i);
        const c = cards[i];
        setTimeout(() => {
          el.classList.add('revealed', 'r' + c.r);
          A.sfx.flip();
          if (c.r >= 2) P.haptic(c.r >= 4 ? 22 : 10);
          setTimeout(() => {
            A.sfx.fanfare(c.r);
            if (c.r >= 4) sparkle(el.parentNode, c.r === 5 ? 26 : 14);
          }, 120);
        }, 240);
        revealed++;
        doneBtn.textContent = '확인 (' + revealed + '/5)';
        if (revealed === 5) {
          doneBtn.disabled = false;
          renderResult();
        }
      }
      area.querySelectorAll('.flip-card').forEach(el => {
        el.addEventListener('click', () => flip(+el.dataset.i));
      });
      area.querySelector('#allFlip').addEventListener('click', () => {
        cards.forEach((c, i) => {
          const el = area.querySelector('.flip-card[data-i="' + i + '"]');
          if (el && !el.classList.contains('flipped')) {
            setTimeout(() => flip(i), flipped.size * 130);
          }
        });
      });

      function renderResult() {
        const box = area.querySelector('#opResult');
        const best = cards.reduce((a, c) => c.r > a.r ? c : a, cards[0]);
        box.innerHTML = '<div class="hr"></div>' +
          '<div style="font-size:15px;font-weight:900;margin-bottom:6px">' + (best.r >= 4 ? '✨ 대박 카드 획득!' : '카드 5장을 도감에 담았어요!') + '</div>' +
          '<div class="list" style="text-align:left">' + cards.map((c, i) =>
            '<div class="row"><b style="color:' + (c.r === 5 ? '#ffd24a' : c.r === 4 ? '#c9a8ff' : c.r === 2 ? '#7fc4ff' : '#cfd8ff') + '">' +
            (c.r === 5 ? '★★★★★' : c.r === 4 ? '★★★★' : c.r === 2 ? '★★' : '★') + '</b>' +
            '<div class="grow"><b>' + esc(c.name) + '</b><small>' + esc(c.t || '') + (c.hp ? ' · HP' + c.hp : '') + ' · ' + esc(c.nn) + '</small></div>' +
            (isNew[i] ? '<span class="new-tag" style="position:static">NEW</span>' : '<span class="muted">×' + (P.me().cards[c.id] || 1) + '</span>') +
            '</div>').join('') + '</div>';
        U.refreshHeader();
        doneBtn.textContent = '✅ 확인 (도감에 저장됨)';
        doneBtn.addEventListener('click', () => finish(true));
        A.sfx.coin();
        const af = area.querySelector('#allFlip'); if (af) af.style.display = 'none';
      }
    }
  }

  function sparkle(host, n) {
    if (!host) return;
    const rect = host.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const s = P.el('div', 'spark');
      s.style.left = (rect.width / 2 + (Math.random() - 0.5) * rect.width * 0.7) + 'px';
      s.style.top = (rect.height / 2 + (Math.random() - 0.5) * rect.height * 0.7) + 'px';
      s.style.setProperty('--dx', ((Math.random() - 0.5) * 220) + 'px');
      s.style.setProperty('--dy', ((Math.random() - 0.5) * 220) + 'px');
      s.style.background = ['#fff', '#ffd24a', '#59e3ff', '#ff7ad9'][i % 4];
      host.appendChild(s);
      setTimeout(() => s.remove(), 950);
    }
  }

  window.PKShop = { render, openFlow, sparkle };
})();
