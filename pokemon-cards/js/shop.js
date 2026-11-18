/* shop.js — 팩 상점 · 리얼 팩 뜯기(절취선 드래그) · 5장 카드 뭉치 넘기기 */
(function () {
  'use strict';
  const P = window.PKC, D = window.PKData, U = window.PKUI, A = window.PKCAudio;
  const $ = P.$, esc = P.esc;

  let activeCat = 'sv';
  let activeEra = 'all';
  let busy = false;

  /* 🎁 1:1 5승 보상으로 받은 무료팩 — 코인·티켓 없이 바로 뜯는다 */
  function freeSection(pr) {
    const list = P.freePacksOf(pr);
    if (!list.length) return '';
    const rows = list.slice().reverse().map(fp => {
      const m = D.packMeta(fp.packId);
      if (!m) return '';
      return '<button class="free-row" data-freepack="' + esc(fp.id) + '">' +
        '<div class="free-art">' + U.packArt(m, { tiny: true }) + '</div>' +
        '<div class="free-txt"><b>' + esc(m.name) + '</b><small>1:1 ' + esc(fp.reason || '5승') + ' 보상 · 무료</small></div>' +
        '<span class="btn gold sm">무료로 뜯기</span></button>';
    }).join('');
    if (!rows) return '';
    return '<div class="free-bar"><div class="free-h">🎁 무료 팩 <b>' + list.length + '</b>개' +
      '<span>1:1에서 5승마다 받는 보상 · 코인 0</span></div>' + rows + '</div>';
  }

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
      freeSection(pr) +
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
    root.querySelectorAll('[data-freepack]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation(); A.unlock();
      const fp = P.freePacksOf(P.me()).filter(x => x.id === b.dataset.freepack)[0];
      if (!fp) { P.toast('무료팩을 찾을 수 없어요'); return; }
      openFlow(fp.packId, { price: 0, free: true, fpId: fp.id });
    }));
  }

  /* =====================================================================
     팩 뜯기 — ① 절취선 손가락 드래그로 윗뚜껑 벗겨내기
                ② 열린 입구에서 빛이 터지며 카드 5장이 솟아오르기
                ③ 카드 뭉치 1장씩 뒤집기 → 바닥 수집 트레이로 이동
     ===================================================================== */
  const RARE = r => r >= 4;
  const STARS = { 1: '★', 2: '★★', 4: '★★★★', 5: '★★★★★' };

  async function openFlow(packId, o) {
    if (busy) return;
    const pr = P.me();
    const meta = D.packMeta(packId);
    if (!meta) return;
    const price = o.price != null ? o.price : meta.price;
    const isHigh = meta.price === 80;
    const tkey = isHigh ? 'high' : 'normal';
    if (o.free) {
      if (!P.freePacksOf(pr).some(x => x.id === o.fpId)) { P.toast('무료팩이 없어요'); return; }
    } else if (o.ticket) {
      if (!pr.tickets[tkey]) { P.toast('티켓이 없어요'); return; }
    } else if (pr.coins < price) {
      A.sfx.error(); P.toast('코인이 부족해요 · ' + (price - pr.coins) + '코인 더 필요해요');
      return;
    }
    busy = true;
    let packData;
    try { packData = await D.loadPack(packId); }
    catch (e) { busy = false; P.toast('팩 데이터를 불러오지 못했어요'); return; }

    /* ---------- 상태 ---------- */
    let finished = false;   // 스테이지가 닫혔는가
    let torn = false;       // 팩이 실제로 찢어졌는가 (차감·지급의 유일한 기준)
    let cards = null, isNew = null;

    const stage = P.el('div', 'open-stage');
    stage.innerHTML = '<button class="btn ghost sm close" id="opClose">✕ 나가기</button>' +
      '<div class="op-area" id="opArea"></div>';
    document.body.appendChild(stage);
    const area = stage.querySelector('#opArea');

    function finish() {
      if (finished) return;
      finished = true;
      stage.style.transition = 'opacity .25s'; stage.style.opacity = '0';
      setTimeout(() => stage.remove(), 260);
      busy = false;
      if (torn) {
        P.save();
        U.checkTrophies(P.state.active);
      }
      if ($('#screen-shop').classList.contains('active')) render();
      if ($('#screen-home').classList.contains('active')) U.renderHome();
      U.refreshHeader();
    }
    /* ✕ 나가기 — 뜯기 전이면 아무 차감·지급 없이 그대로 닫는다 */
    stage.querySelector('#opClose').addEventListener('click', () => { A.sfx.tap(); finish(); });

    /* 팩이 찢어진 순간에만 코인/티켓 차감 · opened 증가 · 카드 도감 저장 */
    function spend() {
      const p = P.me();
      if (o.free) {
        /* 🎁 무료팩 — 코인·티켓 차감 0, 무료팩 1개만 쓴다 */
        const before = P.freePacksOf(p);
        const after = before.filter(x => x.id !== o.fpId);
        if (after.length === before.length) { A.sfx.error(); P.toast('무료팩이 없어요'); return false; }
        p.freePacks = after;
        /* 🗑 쓴 무료팩 기록 — 다음 동기화(20초)가 판으로 되살리지 않게 */
        p.freeUsed = p.freeUsed || {};
        p.freeUsed[o.fpId] = Date.now();
        const cut = Object.keys(p.freeUsed).sort((a, b) => p.freeUsed[b] - p.freeUsed[a]).slice(60);
        cut.forEach(k => { delete p.freeUsed[k]; });
      } else if (o.ticket) {
        if (!p.tickets[tkey]) { A.sfx.error(); P.toast('티켓이 없어요'); return false; }
        p.tickets[tkey] -= 1;
      } else {
        if (p.coins < price) {
          A.sfx.error(); P.toast('코인이 부족해요 · ' + (price - p.coins) + '코인 더 필요해요');
          return false;
        }
        p.coins -= price;
        U.bumpCoins();
      }
      p.opened[packId] = (p.opened[packId] || 0) + 1;
      P.state.profiles[P.state.active] = p;
      cards = D.pull(packData, !!o.boosted);
      isNew = cards.map(c => !p.cards[c.id]);
      cards.forEach(c => U.addCard(P.state.active, c, packId, 1));
      P.save();
      U.refreshHeader();
      torn = true;
      return true;
    }

    /* ---------- ① 밀봉 팩 ---------- */
    const art = D.img(meta.cover);
    area.innerHTML =
      '<div class="rip-stage" id="ripWrap">' +
        '<div class="pack-visual" id="pv">' +
          '<img class="pv-art" src="' + art + '" alt="">' +
          '<div class="pv-inside"></div>' +
          '<div class="pv-open" id="pvOpen"></div>' +
          '<div class="pv-lid" id="lid" data-dir="1">' +
            '<div class="lid-part" id="lidFlat"><img src="' + art + '" alt=""><i class="lid-foil"></i></div>' +
            '<div class="lid-curl" id="lidCurl"></div>' +
            '<div class="lid-edge" id="lidEdge"></div>' +
          '</div>' +
          '<div class="tear-guide" id="tearGuide"><b>✂️</b><i class="tg-line"></i><b class="tg-arrow">→</b>' +
            '<i class="tg-finger">👆</i></div>' +
          '<div class="pv-glass"></div>' +
          '<div class="pv-shine"></div>' +
        '</div>' +
      '</div>' +
      '<div class="open-hint" id="opHint"><b>' + esc(meta.name) + '</b><br>' +
        '맨 위 점선을 <b>손가락으로 쓱—</b> 그어 뜯어요!</div>' +
      '<div class="btn-row" id="ripBtns" style="margin-top:10px;justify-content:center">' +
        '<button class="btn gold" id="ripBtn" style="padding:14px 26px;font-size:15px">✂️ 한 번에 뜯기</button>' +
      '</div>';

    const wrap = area.querySelector('#ripWrap');
    const pv = area.querySelector('#pv');
    const lid = area.querySelector('#lid');
    const guide = area.querySelector('#tearGuide');
    const hint = area.querySelector('#opHint');
    const btns = area.querySelector('#ripBtns');

    let peelPct = 0, progress = 0, dir = 1, f0 = 0.05;
    let dragging = false, tearing = false, lastTick = 0;

    function applyPeel(pct) {
      peelPct = Math.max(0, Math.min(100, pct));
      lid.style.setProperty('--peel', peelPct.toFixed(2) + '%');
      lid.classList.toggle('peeling', peelPct > 1.5);
      guide.classList.toggle('gone', peelPct > 3);
    }
    function fracOf(x) {
      const r = lid.getBoundingClientRect();
      return Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width)));
    }
    function pctOf(f) { return dir > 0 ? f * 100 : (1 - f) * 100; }

    pv.addEventListener('pointerdown', e => {
      if (torn || tearing || finished) return;
      const f = fracOf(e.clientX);
      dir = f < 0.5 ? 1 : -1;
      f0 = f;
      lid.dataset.dir = String(dir);
      dragging = true;
      lid.classList.add('dragging');
      applyPeel(pctOf(f));
      try { pv.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      A.unlock();
    });

    pv.addEventListener('pointermove', e => {
      if (!dragging || torn) return;
      const f = fracOf(e.clientX);
      const denom = dir > 0 ? Math.max(0.12, 1 - f0) : Math.max(0.12, f0);
      const d = dir > 0 ? f - f0 : f0 - f;
      progress = Math.max(0, Math.min(1, d / denom));
      applyPeel(pctOf(f));
      const t = Date.now();
      if (t - lastTick > 55) {
        lastTick = t;
        hotSpark(e.clientX, e.clientY, 2);
        A.sfx.tearTick(progress);
        hint.innerHTML = '<b>' + esc(meta.name) + '</b><br>' +
          (progress >= 0.7 ? '🔥 끝까지 그었어요! 손을 떼면 뜯겨요' : '계속 그어 보세요 · ' + Math.round(progress * 100) + '%');
      }
    });

    function endDrag(ok) {
      if (!dragging || torn) return;
      dragging = false;
      lid.classList.remove('dragging');
      if (ok) { complete(); return; }
      if (progress < 0.05) { complete(); return; }   /* 톡 누르기 = 한 번에 뜯기 */
      applyPeel(0); progress = 0;
      hint.innerHTML = '<b>' + esc(meta.name) + '</b><br>70% 넘게 그어야 뜯겨요. 다시 쓱—!';
      A.sfx.barMiss();
    }
    pv.addEventListener('pointerup', () => endDrag(progress >= 0.7 || peelPct >= 96));
    pv.addEventListener('pointercancel', () => endDrag(false));

    /* ✂️ 한 번에 뜯기 (자동 찢기 애니메이션) */
    function autoTear() {
      if (torn || tearing || finished) return;
      tearing = true;
      guide.classList.add('gone');
      dir = 1; lid.dataset.dir = '1';
      const t0 = performance.now(), dur = 620;
      (function step(now) {
        if (finished) return;
        const p = Math.min(1, (now - t0) / dur);
        applyPeel(p * 100);
        progress = p;
        if (p < 1) requestAnimationFrame(step);
        else complete();
      })(t0);
      A.sfx.tearRipLong();
    }
    area.querySelector('#ripBtn').addEventListener('click', autoTear);

    /* ---------- ② 윗뚜껑이 날아가고 → 빛 폭발 → 카드 솟아오르기 ---------- */
    function complete() {
      if (torn) return;
      if (!spend()) return;
      tearing = true;
      lid.classList.add('flung');
      applyPeel(100);
      guide.classList.add('gone');
      hint.innerHTML = '<b>' + esc(meta.name) + '</b><br>뜯었다!';
      A.sfx.rip(); P.haptic(26);
      sparkle(pv, 26);
      setTimeout(() => {
        if (finished) return;
        A.sfx.whoosh();
        const b = P.el('div', 'burst');
        document.body.appendChild(b);
        setTimeout(() => b.remove(), 820);
      }, 170);
      setTimeout(emerge, 430);
    }

    function emerge() {
      if (finished) return;
      wrap.classList.add('torn');
      stage.classList.add('has-tray');
      hint.style.display = 'none';
      btns.style.display = 'none';
      A.sfx.emerge();
      buildStack();
      setTimeout(() => { const o2 = area.querySelector('#pvOpen'); if (o2) o2.classList.add('fade'); }, 1500);
    }

    /* ---------- ③ 카드 뭉치 (뒷면 → 탭 뒤집기 → 바닥 트레이) ---------- */
    function buildStack() {
      const box = P.el('div', 'stack-wrap');
      box.innerHTML =
        '<div class="st-tip" id="stTip">카드를 <b>한 번 누르면</b> 뒤집혀요</div>' +
        '<div class="stack" id="stackH">' +
          cards.map((c, i) =>
            '<div class="st-card" data-i="' + i + '">' +
              '<div class="st-aura"></div>' +
              '<div class="st-inner"><div class="st-tilt">' +
                '<div class="st-face back"><img src="' + D.BACK + '" alt=""><span class="st-num">' + (i + 1) + '</span></div>' +
                '<div class="st-face front"><img src="' + D.img(c.img) + '" alt="' + esc(c.name) + '"><div class="holo"></div></div>' +
              '</div></div>' +
            '</div>').join('') +
        '</div>' +
        '<div class="st-count" id="stCount">1 / 5</div>' +
        '<div class="st-result" id="stResult"></div>' +
        '<div class="st-btns">' +
          '<button class="btn ghost" id="allFlip">🔄 한 번에 보기</button>' +
          '<button class="btn primary" id="saveBtn" disabled>확인 (0/5)</button>' +
        '</div>';
      area.appendChild(box);

      const tray = P.el('div', 'st-tray');
      tray.innerHTML = [0, 1, 2, 3, 4].map(i => '<div class="tray-slot" data-i="' + i + '"></div>').join('');
      stage.appendChild(tray);

      const stackEl = box.querySelector('#stackH');
      const countEl = box.querySelector('#stCount');
      const tipEl = box.querySelector('#stTip');
      const resEl = box.querySelector('#stResult');
      const allBtn = box.querySelector('#allFlip');
      const saveBtn = box.querySelector('#saveBtn');
      const slots = Array.prototype.slice.call(tray.querySelectorAll('.tray-slot'));
      const els = Array.prototype.slice.call(stackEl.querySelectorAll('.st-card'));

      let cur = 0, auto = false, done = false;
      const flipped = {};

      function restack() {
        els.forEach((el, i) => {
          const k = i - cur;
          el.style.setProperty('--k', String(k > 0 ? k : 0));
          el.style.zIndex = String(k >= 0 ? 40 - k : 0);
          el.classList.toggle('is-top', i === cur);
          el.classList.toggle('gone', i < cur);
          el.style.pointerEvents = 'none';
        });
      }
      function head() {
        countEl.textContent = Math.min(cur + 1, 5) + ' / 5';
      }

      /* 무지개 예고 (r>=4) — 뒷면 테두리 아우라 + 두근거림 */
      function peek() {
        if (done || cur > 4) return;
        const el = els[cur];
        if (!el || flipped[cur]) return;
        if (RARE(cards[cur].r)) {
          el.classList.add('peek');
          A.sfx.heartbeat();
          P.haptic(14);
          tipEl.innerHTML = '💫 뭔가 특별한 기운… <b>눌러서 확인!</b>';
        } else {
          el.classList.remove('peek');
          tipEl.innerHTML = '카드를 <b>한 번 누르면</b> 뒤집혀요';
        }
      }

      function flipCur() {
        if (done || cur > 4) return;
        const i = cur, el = els[i], c = cards[i];
        if (flipped[i]) return;
        flipped[i] = 1;
        el.classList.remove('peek');
        el.classList.add('flipped');
        head();
        A.sfx.flip(); P.haptic(9);
        setTimeout(() => {
          if (finished) return;
          el.classList.add('rev', 'r' + c.r);
          A.sfx.reveal(c.r);
          burst(el, c.r === 5 ? 34 : c.r === 4 ? 20 : c.r === 2 ? 10 : 5);
          if (c.r >= 5) { flash(); setTimeout(flash, 260); setTimeout(flash, 470); }
          tipEl.innerHTML = RARE(c.r) ? '✨ <b>' + esc(c.name) + '</b> — 한 번 더 누르면 바닥으로!' : '한 번 더 누르면 <b>바닥으로</b> 내려가요';
        }, 320);
        /* 5번째 카드: 손대지 않아도 잠시 뒤 자동으로 바닥에 내려 결과로 이어진다 */
        if (i === 4) setTimeout(() => { if (!done && finished === false && flipped[4] && !landed[4]) flyCard(); }, 2400);
      }
      const landed = {};

      function flyCard() {
        if (done || cur > 4) return;
        const i = cur, el = els[i];
        if (!flipped[i] || landed[i]) return;
        landed[i] = 1;
        const slot = slots[i];
        const a = el.getBoundingClientRect(), b = slot.getBoundingClientRect();
        const fly = P.el('div', 'st-fly');
        fly.innerHTML = '<img src="' + D.img(cards[i].img) + '" alt="">';
        fly.style.left = a.left + 'px';
        fly.style.top = a.top + 'px';
        fly.style.width = a.width + 'px';
        fly.style.height = a.height + 'px';
        fly.style.setProperty('--tx', (b.left - a.left).toFixed(1) + 'px');
        fly.style.setProperty('--ty', (b.top - a.top).toFixed(1) + 'px');
        fly.style.setProperty('--sc', (b.width / Math.max(1, a.width)).toFixed(3));
        document.body.appendChild(fly);
        el.classList.add('gone');
        A.sfx.slot(); P.haptic(7);
        setTimeout(() => {
          fly.remove();
          if (finished) return;
          slot.classList.add('on');
          if (RARE(cards[i].r)) slot.classList.add('rare');
          slot.innerHTML = '<img src="' + D.img(cards[i].img) + '" alt="">' + (RARE(cards[i].r) ? '<i class="ts-star">★</i>' : '');
        }, 470);
        cur++;
        head();
        if (cur >= 5) {
          setTimeout(showResult, 560);
        } else {
          restack();
          setTimeout(peek, 430);
        }
      }

      /* 탭/스와이프 — 뒤집기 ↔ 다음 카드 */
      let gx = 0, gy = 0;
      stackEl.addEventListener('pointerdown', e => { gx = e.clientX; gy = e.clientY; });
      stackEl.addEventListener('pointerup', e => {
        if (finished || done) return;
        const sw = Math.abs(e.clientX - gx) > 26 || Math.abs(e.clientY - gy) > 26;
        if (sw) P.haptic(6);
        if (!flipped[cur]) flipCur(); else flyCard();
      });
      stackEl.addEventListener('pointercancel', () => { });

      /* 3D 틸트 홀로그램 */
      stackEl.addEventListener('pointermove', e => {
        const el = els[cur];
        if (!el || !flipped[cur]) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / Math.max(1, r.width) - 0.5;
        const py = (e.clientY - r.top) / Math.max(1, r.height) - 0.5;
        el.style.setProperty('--ry', (px * 16).toFixed(1) + 'deg');
        el.style.setProperty('--rx', (-py * 13).toFixed(1) + 'deg');
        el.style.setProperty('--mx', ((px + 0.5) * 100).toFixed(1) + '%');
        el.style.setProperty('--my', ((py + 0.5) * 100).toFixed(1) + '%');
      });
      stackEl.addEventListener('pointerleave', () => {
        const el = els[cur];
        if (!el) return;
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });

      /* 🔄 한 번에 보기 */
      allBtn.addEventListener('click', () => {
        if (auto || done || finished) return;
        auto = true; allBtn.disabled = true;
        A.unlock();
        (function next() {
          if (finished || done) { auto = false; return; }
          if (cur > 4) { auto = false; return; }
          if (!flipped[cur]) { flipCur(); setTimeout(next, 880); }
          else { flyCard(); setTimeout(next, 600); }
        })();
      });

      function showResult() {
        if (done) return;
        done = true;
        auto = false;
        countEl.textContent = '5 / 5';
        tipEl.innerHTML = '5장 모두 확인 완료!';
        stackEl.classList.add('done');
        setTimeout(() => {
          if (finished) return;
          stackEl.style.display = 'none';
          tipEl.style.display = 'none';
          resEl.classList.add('show');
          try { stage.scrollTo({ top: stage.scrollHeight, behavior: 'smooth' }); } catch (e) { /* */ }
        }, 360);
        const best = cards.reduce((a, c) => (c.r > a.r ? c : a), cards[0]);
        resEl.innerHTML = '<div class="hr"></div>' +
          '<div class="res-title">' + (best.r >= 4 ? '✨ 대박 카드 획득!' : '카드 5장을 도감에 담았어요!') + '</div>' +
          '<div class="list" style="text-align:left">' + cards.map((c, i) =>
            '<div class="row"><b style="color:' + (c.r === 5 ? '#ffe9bf' : c.r === 4 ? '#c9b6ff' : c.r === 2 ? '#8fe3ff' : '#cfd8ff') + '">' +
            (STARS[c.r] || '★') + '</b>' +
            '<div class="grow"><b>' + esc(c.name) + '</b><small>' + esc(c.t || '') + (c.hp ? ' · HP' + c.hp : '') + ' · ' + esc(c.nn) +
            (c.v ? '' : ' ·추정') + '</small></div>' +
            (isNew[i] ? '<span class="new-tag" style="position:static">NEW</span>' : '<span class="muted">×' + (P.me().cards[c.id] || 1) + '</span>') +
            '</div>').join('') + '</div>';
        saveBtn.disabled = false;
        saveBtn.textContent = '✅ 확인 (도감에 저장됨)';
        allBtn.style.display = 'none';
        A.sfx.coin();
        U.refreshHeader();
      }
      saveBtn.addEventListener('click', () => { A.sfx.coin(); finish(); });

      restack();
      head();
      setTimeout(peek, 520);
    }

    /* 팩 앞면 탭(드래그 없이)도 진행되도록: 터치 시작 시 기본 동작 막기 */
    pv.addEventListener('touchstart', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  }

  /* 찢는 지점의 불꽃 */
  function hotSpark(x, y, n) {
    for (let i = 0; i < (n || 1); i++) {
      const s = P.el('i', 'hot-spark');
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', ((Math.random() - 0.5) * 90).toFixed(0) + 'px');
      s.style.setProperty('--dy', ((Math.random() - 0.6) * 90).toFixed(0) + 'px');
      s.style.background = ['#fff', '#ffe9a6', '#ffd27a', '#bff4ff'][i % 4];
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 620);
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

  window.PKShop = { render, openFlow, sparkle, burst, flash, hotSpark };
})();
