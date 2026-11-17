/* shop.js — 팩 상점 · 팩 뜯기 (중앙 확대 3D 플립 · 등급별 이펙트) */
(function () {
  'use strict';
  const P = window.PKC, D = window.PKData, U = window.PKUI, A = window.PKCAudio;
  const $ = P.$, esc = P.esc;

  let activeCat = 'sv';
  let activeEra = 'all';
  let busy = false;

  function ownedInPack(pr, meta) {
    let n = 0;
    const pre = meta.set + '-';
    for (const k in pr.cards) if (k.indexOf(pre) === 0) n++;
    return n;
  }

  function render() {
    const root = $('#screen-shop');
    const pr = P.me();
    const idx = D.allPacks();
    if (!idx.length) { root.innerHTML = '<div class="loading"><div class="spinner"></div>불러오는 중…</div>'; return; }
    if (!idx.some(p => p.cat === activeCat)) { activeCat = 'sv'; activeEra = 'all'; }
    const series = D.seriesList();
    const today = D.todayPack();
    const list = D.packsOf(activeCat, activeCat === 'classic' ? activeEra : null);

    const tabs = series.map(s => {
      const n = D.packsOf(s.key).length;
      return '<button class="series-tab' + (s.key === activeCat ? ' active' : '') + '" data-cat="' + s.key + '">' +
        s.emoji + ' ' + esc(s.name) + ' <span class="cnt">' + n + '</span></button>';
    }).join('');

    let eraTabs = '';
    if (activeCat === 'classic') {
      eraTabs = '<div class="era-tabs">' + D.erasOf('classic').map(e =>
        '<button class="era-tab' + (e.key === activeEra ? ' active' : '') + '" data-era="' + e.key + '">' +
        e.emoji + ' ' + esc(e.name) + ' <span style="opacity:.6">' + e.n + '</span></button>').join('') + '</div>';
    }

    const todayHtml = today ? (
      '<button class="today-card" id="shopToday" style="margin-bottom:12px;width:100%"><span class="shine"></span>' +
      '<div style="width:66px;flex:0 0 66px">' + U.packArt(today.pack, {tiny:true}) + '</div>' +
      '<div class="tc-txt"><div class="tagline">⚡ 오늘의 추천 팩 · R 이상 확률 UP</div>' +
      '<b>' + esc(today.pack.name) + '</b>' +
      '<div class="muted" style="margin-top:3px"><s>' + today.pack.price + '코인</s> → <b style="color:#ffe9bf">' + today.price + '코인</b></div></div>' +
      '<div class="btn gold sm">뜯기</div></button>') : '';

    const grid = list.map(p => {
      const own = ownedInPack(pr, p);
      const rate = Math.min(1, own / p.total);
      const isToday = today && today.pack.id === p.id;
      const done = own >= p.total;
      const half = rate >= 0.5;
      const ticket = p.price === 80 ? pr.tickets.high : pr.tickets.normal;
      const eraMark = p.cat === 'classic' ? (D.ERA_MARK[p.era] || 'SM') : '';
      return '<div class="pack' + (isToday ? ' today' : '') + '" data-pack="' + p.id + '">' +
        '<div class="cover">' + U.packArt(p, {}) +
          (isToday ? '<span class="badge-hot">오늘의 팩</span>' : '') +
          (done ? '<span class="badge-done">완주 🏆</span>' : (half ? '<span class="badge-done">50% 🏅</span>' : '')) +
          (eraMark ? '<span class="era-badge">' + eraMark + '</span>' : '') +
        '</div>' +
        '<div class="pbody">' +
          '<div class="bar' + (done ? ' done' : '') + '"><i style="width:' + (rate * 100).toFixed(1) + '%"></i></div>' +
          '<div class="pmeta"><span>' + own + ' / ' + p.total + '장</span><span>' + (rate * 100).toFixed(0) + '%</span></div>' +
          '<div class="btn primary sm pbtn" data-open="' + p.id + '">' + (isToday ? today.price : p.price) + '🪙 뜯기</div>' +
          (ticket > 0 ? '<div class="btn ghost sm" data-ticket="' + p.id + '" style="padding:6px;font-size:11px">🎟️ 티켓 ' + ticket + '장</div>' : '') +
        '</div></div>';
    }).join('');

    root.innerHTML =
      '<div class="h1">🛍️ 카드팩 상점</div>' +
      '<div class="muted" style="margin:-6px 2px 10px">' + idx.length + '개 공식 카드팩 · 5장씩 뜯기' +
        (activeCat === 'classic' ? ' · 썬&문·XY·BW ' + D.packsOf('classic').length + '팩' : '') + '</div>' +
      todayHtml +
      '<div class="series-tabs">' + tabs + '</div>' +
      eraTabs +
      '<div class="muted" style="margin:0 2px 10px">' + esc((series.find(s => s.key === activeCat) || {}).desc || '') + '</div>' +
      '<div class="pack-grid">' + grid + '</div>' +
      '<div class="muted" style="margin:18px 2px;font-size:11.5px;line-height:1.7">일반 팩 50코인 · 하이클래스 팩 80코인. 아빠 PIN으로 코인·티켓을 선물할 수 있어요.<br>' +
        'XY·BW 카드 등급(★)은 공식 등급 DB가 없어 HP·카드 이름·번호 규칙으로 추정했어요. 카드 팝업에 <b>·추정</b>으로 표시됩니다.</div>';

    root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap(); activeCat = b.dataset.cat; activeEra = 'all'; render();
    }));
    root.querySelectorAll('[data-era]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap(); activeEra = b.dataset.era; render();
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
    cards.forEach(c => { U.addCard(P.state.active, c, packId, 1); });
    U.refreshHeader();

    const stage = P.el('div', 'open-stage');
    stage.innerHTML =
      '<button class="btn ghost sm close" id="opClose">✕ 나가기</button>' +
      '<div id="opArea" style="display:flex;flex-direction:column;align-items:center;width:100%;max-width:760px"></div>';
    document.body.appendChild(stage);

    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      stage.style.transition = 'opacity .25s'; stage.style.opacity = '0';
      setTimeout(() => stage.remove(), 260);
      busy = false;
      U.checkTrophies(P.state.active);
      if ($('#screen-shop').classList.contains('active')) render();
      if ($('#screen-home').classList.contains('active')) U.renderHome();
      U.refreshHeader();
    }
    stage.querySelector('#opClose').addEventListener('click', () => {
      if (!torn) {
        if (o.ticket) pr.tickets[tkey] += 1; else pr.coins += price;
        pr.opened[packId] = Math.max(0, (pr.opened[packId] || 1) - 1);
        P.save(); U.refreshHeader();
        finish();
      } else finish();
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
      '<div class="btn-row" style="margin-top:16px;justify-content:center">' +
        '<button class="btn gold" id="ripBtn" style="padding:15px 28px;font-size:15px">✂️ 팩 뜯기</button>' +
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
      sparkle(area, 20);
      setTimeout(() => {
        A.sfx.whoosh();
        const b = P.el('div', 'burst');
        document.body.appendChild(b);
        setTimeout(() => b.remove(), 800);
      }, 380);
      setTimeout(() => showCards(), 780);
    }
    area.querySelector('#ripBtn').addEventListener('click', doRip);
    pv.addEventListener('click', doRip);
    let sx = 0, sy = 0, dragging = false;
    pv.addEventListener('pointerdown', e => { dragging = true; sx = e.clientX; sy = e.clientY; });
    pv.addEventListener('pointerup', e => {
      if (!dragging) return; dragging = false;
      if (Math.abs(e.clientX - sx) > 42 || Math.abs(e.clientY - sy) > 42) doRip();
    });

    /* 카드 5장 — 실제 카드 뒷면 */
    function showCards() {
      area.innerHTML =
        '<div class="muted" style="margin-bottom:10px;text-align:center">카드를 눌러 크게 뒤집어 보세요!</div>' +
        '<div class="open-cards">' + cards.map((c, i) =>
          '<div class="oc-card" data-i="' + i + '">' + (isNew[i] ? '<span class="new-tag">NEW</span>' : '') + '</div>').join('') + '</div>' +
        '<div class="open-result" id="opResult"></div>' +
        '<div class="btn-row" style="margin-top:14px;justify-content:center">' +
          '<button class="btn ghost" id="allFlip">🔄 모두 뒤집기</button>' +
          '<button class="btn primary" id="doneBtn" disabled>확인 (0/5)</button>' +
        '</div>';

      const revealed = new Set();
      const doneBtn = area.querySelector('#doneBtn');
      const allBtn = area.querySelector('#allFlip');
      let autoRunning = false;

      area.querySelectorAll('.oc-card').forEach(el => {
        el.addEventListener('click', () => {
          const i = +el.dataset.i;
          if (revealed.has(i) || autoRunning) return;
          zoomReveal(i, false);
        });
      });

      function markSlot(i) {
        const el = area.querySelector('.oc-card[data-i="' + i + '"]');
        if (!el) return;
        const c = cards[i];
        el.classList.add('taken');
        const img = document.createElement('img');
        img.src = D.img(c.img);
        img.alt = c.name;
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:5';
        el.appendChild(img);
        if (c.r >= 4) {
          el.style.borderColor = c.r === 5 ? '#ffe9b0' : '#c3adff';
          el.style.boxShadow = c.r === 5 ? '0 0 18px rgba(231,195,122,.65)' : '0 0 14px rgba(150,110,255,.5)';
        }
        revealed.add(i);
        doneBtn.textContent = '확인 (' + revealed.size + '/5)';
        if (revealed.size === 5) { doneBtn.disabled = false; renderResult(); }
      }

      function zoomReveal(i, auto) {
        const c = cards[i];
        const host = area.querySelector('.oc-card[data-i="' + i + '"]');
        const from = host ? host.getBoundingClientRect() : null;
        A.sfx.whoosh();

        const z = P.el('div', 'zoom-stage');
        z.innerHTML =
          '<button class="btn ghost sm zclose" id="zclose">✕ 나가기</button>' +
          '<div class="zoom-wrap">' +
            '<div class="zoom-card" id="zc" style="transform:scale(.22);transition:transform .52s cubic-bezier(.2,.9,.2,1)">' +
              '<div class="zoom-halo"></div><div class="zoom-rays"></div><div class="zoom-pop"></div>' +
              '<div class="zi">' +
                '<div class="zoom-face back"></div>' +
                '<div class="zoom-face front"><img src="' + D.img(c.img) + '" alt="' + esc(c.name) + '"><div class="holo"></div></div>' +
              '</div>' +
            '</div>' +
            '<div class="zoom-info" id="zi2">' +
              '<b>' + esc(c.name) + '</b>' +
              '<div class="zmeta">' + esc(c.t || '') + (c.hp ? ' · HP ' + c.hp : '') + ' · ' + esc(c.nn) + '</div>' +
              '<div class="zrar">' + stars(c.r) + ' ' + esc(D.rarityKo(c.rr)) + (c.v ? '' : ' ·추정') + '</div>' +
            '</div>' +
            '<div class="zoom-btns" id="zbtns">' +
              '<button class="btn ghost" id="zback">✕ 나가기</button>' +
              '<button class="btn gold" id="zok">확인</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(z);
        const zc = z.querySelector('#zc');

        // 확대 등장
        requestAnimationFrame(() => { zc.style.transform = 'scale(1)'; });
        // 뒤집기
        setTimeout(() => {
          zc.classList.add('flipped');
          A.sfx.flip();
          P.haptic(c.r >= 4 ? 22 : 10);
        }, 240);
        // 이펙트
        setTimeout(() => {
          zc.classList.add('rev', 'r' + c.r);
          if (c.r >= 5) zc.classList.add('rays5', 'holo5');
          else if (c.r >= 4) zc.classList.add('rays4', 'holo4');
          else if (c.r >= 2) zc.classList.add('holo2');
          A.sfx.reveal(c.r);
          burst(zc, c.r === 5 ? 34 : c.r === 4 ? 20 : c.r === 2 ? 10 : 5);
          if (c.r >= 5) { flash(); for (let k = 0; k < 3; k++) setTimeout(flash, 260 + k * 190); }
          z.querySelector('#zi2').classList.add('show');
          z.querySelector('#zbtns').classList.add('show');
          if (auto) setTimeout(() => z.querySelector('#zok').click(), 1150);
        }, 880);

        z.querySelector('#zclose').addEventListener('click', () => { close(); });
        z.querySelector('#zback').addEventListener('click', () => { A.sfx.tap(); close(); markSlot(i); });
        z.querySelector('#zok').addEventListener('click', () => {
          A.sfx.slot();
          close();
          markSlot(i);
        });
        function close() {
          z.style.transition = 'opacity .22s'; z.style.opacity = '0';
          setTimeout(() => z.remove(), 230);
        }
        window.__pkZoomOpen = true;
      }

      function stars(t) {
        return ({ 1: '★', 2: '★★', 4: '★★★★', 5: '★★★★★' })[t] || '★';
      }

      allBtn.addEventListener('click', () => {
        if (autoRunning) return;
        autoRunning = true;
        allBtn.disabled = true;
        const todo = [0, 1, 2, 3, 4].filter(i => !revealed.has(i));
        (function next(k) {
          if (k >= todo.length) { autoRunning = false; allBtn.disabled = false; return; }
          zoomReveal(todo[k], true);
          setTimeout(() => next(k + 1), 1750);
        })(0);
      });

      function renderResult() {
        const box = area.querySelector('#opResult');
        const best = cards.reduce((a, c) => c.r > a.r ? c : a, cards[0]);
        box.innerHTML = '<div class="hr"></div>' +
          '<div style="font-size:15px;font-weight:900;margin-bottom:8px">' + (best.r >= 4 ? '✨ 대박 카드 획득!' : '카드 5장을 도감에 담았어요!') + '</div>' +
          '<div class="list" style="text-align:left">' + cards.map((c, i) =>
            '<div class="row"><b style="color:' + (c.r === 5 ? '#ffe9bf' : c.r === 4 ? '#c9b6ff' : c.r === 2 ? '#8fe3ff' : '#cfd8ff') + '">' +
            (c.r === 5 ? '★★★★★' : c.r === 4 ? '★★★★' : c.r === 2 ? '★★' : '★') + '</b>' +
            '<div class="grow"><b>' + esc(c.name) + '</b><small>' + esc(c.t || '') + (c.hp ? ' · HP' + c.hp : '') + ' · ' + esc(c.nn) +
            (c.v ? '' : ' ·추정') + '</small></div>' +
            (isNew[i] ? '<span class="new-tag" style="position:static">NEW</span>' : '<span class="muted">×' + (P.me().cards[c.id] || 1) + '</span>') +
            '</div>').join('') + '</div>';
        U.refreshHeader();
        doneBtn.textContent = '✅ 확인 (도감에 저장됨)';
        doneBtn.addEventListener('click', () => finish());
        A.sfx.coin();
        allBtn.style.display = 'none';
      }
    }
  }

  function sparkle(host, n) {
    if (!host) return;
    const rect = host.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const s = P.el('div', 'spark');
      s.style.left = (rect.width / 2 + (Math.random() - 0.5) * rect.width * 0.8) + 'px';
      s.style.top = (rect.height / 2 + (Math.random() - 0.5) * rect.height * 0.8) + 'px';
      s.style.setProperty('--dx', ((Math.random() - 0.5) * 240) + 'px');
      s.style.setProperty('--dy', ((Math.random() - 0.5) * 240) + 'px');
      s.style.position = 'fixed';
      s.style.background = ['#fff', '#ffe4a6', '#67e8ff', '#ff8ade'][i % 4];
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 950);
    }
  }

  /* 카드 위 파티클 폭발 */
  function burst(host, n) {
    if (!host) return;
    const layer = P.el('div');
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:12;overflow:visible';
    host.appendChild(layer);
    for (let i = 0; i < n; i++) {
      const s = P.el('i');
      const ang = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 120;
      s.style.cssText = 'position:absolute;left:50%;top:50%;width:' + (3 + Math.random() * 5) + 'px;height:' +
        (3 + Math.random() * 5) + 'px;border-radius:50%;background:' +
        ['#fff', '#ffe4a6', '#67e8ff', '#ff8ade', '#b6a6ff'][i % 5] +
        ';box-shadow:0 0 10px 2px rgba(255,240,200,.8);--dx:' + (Math.cos(ang) * dist).toFixed(0) + 'px;--dy:' +
        (Math.sin(ang) * dist).toFixed(0) + 'px;animation:sparkUp ' + (900 + Math.random() * 500) + 'ms ease-out forwards;animation-delay:' + (Math.random() * 160) + 'ms';
      layer.appendChild(s);
    }
    setTimeout(() => layer.remove(), 2200);
  }

  function flash() {
    const f = P.el('div', 'reveal-flash');
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 640);
  }

  window.PKShop = { render, openFlow, sparkle, burst, flash };
})();
