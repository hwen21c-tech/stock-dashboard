/* more.js — 내 정보 · 교환함 · 칭호 · 설정 · 아빠 관리자 */
(function () {
  'use strict';
  const P = window.PKC, D = window.PKData, U = window.PKUI, A = window.PKCAudio;
  const $ = P.$, esc = P.esc;

  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });

  function render() {
    const root = $('#screen-more');
    const pr = P.me();
    const uniq = U.uniqueCards(pr), total = U.totalCards(pr);
    const titles = P.TITLES.map(t => {
      const has = pr.titles.indexOf(t.id) >= 0;
      return '<div class="trophy' + (has ? '' : ' locked-trophy') + '"><div class="em">' + (has ? '🎖️' : '🔒') + '</div>' +
        '<div><b>' + esc(t.name) + '</b><small>' + esc(t.desc) + '</small></div>' +
        (has ? '<span class="muted" style="margin-left:auto;font-size:11px">획득</span>' : '') + '</div>';
    }).join('');

    const packsDone = pr.badges.filter(b => b.indexOf('p100:') === 0).length;
    const packsHalf = pr.badges.filter(b => b.indexOf('p50:') === 0).length;

    root.innerHTML =
      '<div class="h1">🎒 내 정보</div>' +
      '<div class="card-panel">' +
        '<div class="btn-row" style="margin-bottom:12px">' + P.PROFILES.map(p => {
          const op = P.prof(p.id);
          return '<button class="avatar' + (p.id === P.state.active ? ' on' : '') + '" data-switch="' + p.id + '" title="' + esc(op.name) + '">' + p.emoji + '</button>';
        }).join('') + '<div class="grow" style="align-self:center;margin-left:6px"><b>' + esc(pr.name) + '</b>' +
          '<div class="muted" style="font-size:11.5px">' + (P.isAdmin() ? '🔓 아빠 모드 켜짐' : '프로필 전환') + '</div></div></div>' +
        '<div class="stat-row">' +
          '<div class="stat"><b>' + P.won(pr.coins) + '</b><span>코인</span></div>' +
          '<div class="stat"><b>' + P.won(pr.stardust || 0) + '</b><span>별가루 ✨</span></div>' +
          '<div class="stat"><b>' + uniq + '</b><span>도감 종류</span></div>' +
        '</div>' +
        '<div class="kv" style="margin-top:10px"><span>모은 카드</span><b>' + P.won(total) + '장</b></div>' +
        '<div class="kv"><span>🎟️ 일반 팩 티켓</span><b>' + (pr.tickets.normal || 0) + '장</b></div>' +
        '<div class="kv"><span>🎟️ 하이클래스 티켓</span><b>' + (pr.tickets.high || 0) + '장</b></div>' +
        '<div class="kv"><span>🏅 50% 팩</span><b>' + packsHalf + '개</b></div>' +
        '<div class="kv"><span>🏆 완주 팩</span><b>' + packsDone + '개</b></div>' +
        '<div class="kv"><span>⚔️ 전적</span><b>' + (pr.wins || 0) + '승 ' + (pr.losses || 0) + '패</b></div>' +
      '</div>' +

      '<div class="h2">🎖️ 칭호 <span class="muted" style="font-size:11px">' + pr.titles.length + '/' + P.TITLES.length + '</span></div>' +
      '<div class="list">' + titles + '</div>' +

      '<div class="h2">🤝 남매 카드 교환함</div>' +
      '<div class="card-panel" style="padding:12px">' +
        '<div class="muted" style="font-size:12px;margin-bottom:8px">2장 이상 가진 중복 카드를 올리면, 다른 프로필이 1:1로 맞교환할 수 있어요.</div>' +
        '<div class="btn-row"><button class="btn primary sm" id="regTrade">📤 내 중복카드 올리기</button>' +
        '<button class="btn ghost sm" id="myTrades">📥 내가 올린 카드</button></div>' +
        '<div id="tradeBox" style="margin-top:12px"></div>' +
      '</div>' +

      '<div class="h2">⚙️ 설정</div>' +
      '<div class="card-panel">' +
        '<div class="kv"><span>효과음</span><button class="btn sm ' + (P.state.settings.sfx ? 'primary' : 'ghost') + '" id="tgSfx">' + (P.state.settings.sfx ? '켜짐' : '꺼짐') + '</button></div>' +
        '<div class="kv"><span>배경음악 (BGM)</span><button class="btn sm ' + (P.state.settings.bgm ? 'primary' : 'ghost') + '" id="tgBgm">' + (P.state.settings.bgm ? '켜짐' : '꺼짐') + '</button></div>' +
        '<div class="field" style="margin-top:10px"><label>볼륨</label>' +
          '<input type="range" min="0" max="100" value="' + Math.round((P.state.settings.volume || 0.7) * 100) + '" id="volRng" style="width:100%"></div>' +
        '<div class="btn-row" style="margin-top:8px">' +
          '<button class="btn gold sm" id="installBtn">📲 앱 설치</button>' +
          '<button class="btn ghost sm" id="muteAll">' + (P.state.settings.sfx ? '🔇 전체 음소거' : '🔊 소리 켜기') + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="h2">🔒 아빠 관리자</div>' +
      '<div class="card-panel">' +
        '<div class="muted" style="font-size:12px;margin-bottom:10px">PIN으로 코인·팩 티켓 선물과 도감 카드 추가/삭제를 할 수 있어요. (3분 뒤 자동 잠금)</div>' +
        '<div class="btn-row"><button class="btn ' + (P.isAdmin() ? 'danger' : 'primary') + ' sm" id="adminBtn">' +
          (P.isAdmin() ? '🔒 바로 잠그기' : '🔑 PIN 입력하고 열기') + '</button>' +
          '<button class="btn ghost sm" id="backupBtn">⏪ 이전 백업 불러오기</button></div>' +
        '<div class="muted" style="font-size:11px;line-height:1.6;margin-top:9px">매일 아침 10:02 · 오후 4:02 · 밤 11:55 에 자동 저장된 가족 클라우드 백업으로 <b>카드·코인만</b> 되돌려요. (도감·마을 기록은 그대로)</div>' +
      '</div>' +

      '<div class="muted" style="margin:18px 2px 8px;font-size:11px;line-height:1.7">' +
        '카드 정보·이미지: 포켓몬코리아 공식 카드 DB (pokemoncard.co.kr)<br>' +
        '카드 등급: 공식 카드 등급 기준 · XY·BW 카드는 HP·이름·번호 규칙으로 추정(·추정 표기)<br>' +
        '이 앱은 가족 전용이며 상업적 이용 목적이 아닙니다.</div>';

    root.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', () => {
      A.sfx.tap();
      P.state.active = b.dataset.switch; P.save();
      U.refreshHeader(); render();
      P.toast(P.me().name + ' 프로필로 전환했어요');
    }));
    root.querySelector('#tgSfx').addEventListener('click', () => { A.toggleSfx(!P.state.settings.sfx); render(); U.refreshHeader(); });
    root.querySelector('#tgBgm').addEventListener('click', () => { A.unlock(); A.toggleBgm(!P.state.settings.bgm); render(); U.refreshHeader(); });
    root.querySelector('#volRng').addEventListener('input', e => { A.setVolume(e.target.value / 100); });
    root.querySelector('#muteAll').addEventListener('click', () => { A.toggleSfx(!P.state.settings.sfx); render(); U.refreshHeader(); });
    root.querySelector('#installBtn').addEventListener('click', async () => {
      if (installEvt) { installEvt.prompt(); installEvt = null; }
      else P.modal({
        title: '📲 앱 설치', body: '<p style="font-size:13.5px;line-height:1.7;margin:0">브라우저 메뉴에서 <b>「홈 화면에 추가」</b>를 눌러 주세요.<br>' +
          '크롬: ⋮ 메뉴 → 홈 화면에 추가<br>사파리: 공유 → 홈 화면에 추가</p>',
        buttons: [{ label: '확인', kind: 'primary' }]
      });
    });
    root.querySelector('#adminBtn').addEventListener('click', () => {
      if (P.isAdmin()) { P.setAdmin(false); P.toast('잠갔어요'); render(); }
      else P.pinPrompt('🔒 아빠 확인', () => { P.toast('🔓 아빠 모드 열림 (3분)'); openAdmin(); });
    });
    const bkBtn = root.querySelector('#backupBtn');
    if (bkBtn) bkBtn.addEventListener('click', () => {
      A.sfx.tap();
      if (P.isAdmin()) { openBackup(); return; }
      P.pinPrompt('🔒 아빠 확인', openBackup);
    });
    root.querySelector('#regTrade').addEventListener('click', registerTrade);
    root.querySelector('#myTrades').addEventListener('click', myTrades);
    renderTradeBox(root.querySelector('#tradeBox'));
  }

  /* ---------------- 교환함 ---------------- */
  function allMyDupes(pr) {
    const ids = Object.keys(pr.cards).filter(id => pr.cards[id] >= 2 && (!pr.trades || !pr.trades.some(t => t.cardId === id)));
    return ids;
  }

  async function registerTrade() {
    const pr = P.me();
    const ids = allMyDupes(pr);
    if (!ids.length) { P.toast('교환함에 올릴 중복 카드(2장 이상)가 없어요'); return; }
    const cards = [];
    for (const id of ids.slice(0, 80)) {
      const c = await window.PKDex.ensureCard(id);
      if (c) cards.push(c);
    }
    const body = P.el('div');
    body.innerHTML = '<p class="muted" style="margin:0 0 10px">교환함에 올릴 카드를 골라 주세요. (내 보유 2장 이상)</p>' +
      '<div class="dex-grid">' + cards.map(c =>
        '<button class="dex-card r' + c.r + '" data-reg="' + c.id + '"><img loading="lazy" src="' + D.img(c.img) + '" alt="">' +
        '<span class="cnt">×' + pr.cards[c.id] + '</span></button>').join('') + '</div>';
    const m = P.modal({ title: '📤 교환함에 올리기', body, buttons: [{ label: '✕ 나가기', kind: 'ghost' }] });
    body.querySelectorAll('[data-reg]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.reg;
      pr.trades = pr.trades || [];
      if (pr.trades.some(t => t.cardId === id) || pr.trades.length >= 10) { P.toast('이미 올렸거나 10개를 넘었어요'); return; }
      pr.trades.push({ cardId: id, at: Date.now() });
      P.save(); A.sfx.coin(); P.toast('교환함에 올렸어요!', true);
      m.close(true); render();
    }));
  }

  async function myTrades() {
    const pr = P.me();
    if (!pr.trades || !pr.trades.length) { P.toast('올린 카드가 없어요'); return; }
    const body = P.el('div');
    const rows = [];
    for (const t of pr.trades) {
      const c = await window.PKDex.ensureCard(t.cardId);
      if (c) rows.push('<div class="row"><img src="' + D.img(c.img) + '" style="width:38px;border-radius:6px" alt="">' +
        '<div class="grow"><b>' + esc(c.name) + '</b><small>' + esc(c.nn) + '</small></div>' +
        '<button class="btn sm danger" data-unreg="' + c.id + '">내리기</button></div>');
    }
    body.innerHTML = '<div class="list">' + rows.join('') + '</div>';
    const m = P.modal({ title: '📥 내가 올린 카드', body, buttons: [{ label: '확인', kind: 'primary' }] });
    body.querySelectorAll('[data-unreg]').forEach(b => b.addEventListener('click', () => {
      pr.trades = pr.trades.filter(t => t.cardId !== b.dataset.unreg);
      P.save(); m.close(true); render(); P.toast('교환함에서 내렸어요');
    }));
  }

  async function renderTradeBox(host) {
    const me = P.me();
    const offers = [];
    P.PROFILES.forEach(p => {
      if (p.id === P.state.active) return;
      const op = P.prof(p.id);
      (op.trades || []).forEach(t => {
        if (!op.cards[t.cardId]) return;
        offers.push({ from: p.id, fromName: op.name, cardId: t.cardId });
      });
    });
    if (!offers.length) { host.innerHTML = '<div class="empty">아직 올라온 교환 카드가 없어요</div>'; return; }
    host.innerHTML = '<div class="list">' + offers.map((o, i) =>
      '<div class="row" data-offer="' + i + '"><div class="avatar">' + P.profileMeta(o.from).emoji + '</div>' +
      '<div class="grow"><b>' + esc(o.fromName) + '의 카드</b><small data-cname="' + o.cardId + '">' + esc(o.cardId) + '</small></div>' +
      '<button class="btn sm primary" data-acc="' + i + '">교환</button></div>').join('') + '</div>';
    for (const o of offers) {
      const c = await window.PKDex.ensureCard(o.cardId);
      const el = host.querySelector('[data-cname="' + o.cardId + '"]');
      if (el && c) el.textContent = c.name + ' · ' + c.nn;
    }
    host.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', () => {
      const o = offers[+b.dataset.acc];
      acceptTrade(o);
    }));
  }

  async function acceptTrade(o) {
    const me = P.me();
    const mine = allMyDupes(me);
    const giveCard = await window.PKDex.ensureCard(o.cardId);
    if (!giveCard) return;
    const cards = [];
    for (const id of mine.slice(0, 80)) {
      const c = await window.PKDex.ensureCard(id);
      if (c) cards.push(c);
    }
    if (!cards.length) { P.toast('내놓을 중복 카드(2장 이상)가 없어요'); return; }
    const body = P.el('div');
    body.innerHTML = '<div class="row" style="margin-bottom:10px"><div class="grow"><b>받는 카드 · ' + esc(giveCard.name) + '</b>' +
      '<small>' + esc(o.fromName) + ' 님의 카드 1장</small></div></div>' +
      '<p class="muted" style="margin:0 0 8px">내가 줄 카드를 고르세요 (2장 이상 보유)</p>' +
      '<div class="dex-grid">' + cards.map(c =>
        '<button class="dex-card r' + c.r + '" data-give="' + c.id + '"><img loading="lazy" src="' + D.img(c.img) + '" alt="">' +
        '<span class="cnt">×' + me.cards[c.id] + '</span></button>').join('') + '</div>';
    const m = P.modal({ title: '🤝 1:1 교환', body, buttons: [{ label: '✕ 나가기', kind: 'ghost' }] });
    body.querySelectorAll('[data-give]').forEach(b => b.addEventListener('click', async () => {
      const giveId = b.dataset.give;
      const giveMe = await window.PKDex.ensureCard(giveId);
      const ok = await P.confirmBox('교환 확인',
        '<b>' + esc(me.name) + '</b>: ' + esc(giveMe.name) + ' 1장 ✕<br>' +
        '<b>' + esc(giveCard.name) + '</b> 1장 받기<br><br>' +
        '서로 1:1로 바꿀까요?', '🤝 교환하기');
      if (!ok) return;
      if ((me.cards[giveId] || 0) < 2 || (P.prof(o.from).cards[giveCard.id] || 0) < 1) { P.toast('조건이 바뀌었어요'); return; }
      U.removeCard(P.state.active, giveId, 1);
      U.addCard(P.state.active, giveCard, P.prof(o.from).src[giveCard.id] || null, 1);
      U.removeCard(o.from, giveCard.id, 1);
      U.addCard(o.from, giveMe, me.src[giveId] || null, 1);
      P.prof(o.from).trades = (P.prof(o.from).trades || []).filter(t => t.cardId !== giveCard.id);
      P.save();
      A.sfx.levelUp();
      m.close(true);
      P.modal({
        title: '🎉 교환 완료!',
        body: '<p style="font-size:14px;line-height:1.7;margin:0">' + esc(me.name) + ' → <b>' + esc(giveCard.name) + '</b> 획득<br>' +
          esc(o.fromName) + ' → <b>' + esc(giveMe.name) + '</b> 획득</p>',
        buttons: [{ label: '확인', kind: 'primary' }]
      });
      U.checkTrophies(P.state.active, true);
      U.checkTrophies(o.from, true);
      render();
    }));
  }

  /* ---------------- 아빠 관리자 ---------------- */
  function openAdmin() {
    let target = P.state.active;
    const body = P.el('div');
    function paint() {
      const tp = P.prof(target);
      body.innerHTML =
        '<div class="field"><label>대상 프로필</label><div class="btn-row">' +
          P.PROFILES.map(p => '<button class="chip' + (p.id === target ? ' active' : '') + '" data-tg="' + p.id + '">' + p.emoji + ' ' + esc(P.prof(p.id).name) + '</button>').join('') +
        '</div></div>' +
        '<div class="row" style="margin-bottom:10px"><div class="grow"><b>' + esc(tp.name) + '</b>' +
          '<small>🪙 ' + P.won(tp.coins) + ' · 🎟️ 일반 ' + (tp.tickets.normal || 0) + ' / 하이클래스 ' + (tp.tickets.high || 0) + ' · ✨ ' + P.won(tp.stardust || 0) + '</small></div></div>' +
        '<div class="field"><label>코인 선물 (숫자 직접 입력)</label>' +
          '<div class="search-row"><input class="input" id="amtIn" type="number" inputmode="numeric" min="1" step="10" placeholder="예: 200">' +
          '<button class="btn gold sm" id="giveAmt">지급</button>' +
          '<button class="btn danger sm" id="takeAmt">차감</button></div></div>' +
        '<div class="field"><label>팩 티켓 선물</label>' +
          '<div class="btn-row">' +
            '<button class="btn ghost sm" data-tk="normal">🎟️ 일반 +1</button>' +
            '<button class="btn ghost sm" data-tk="high">✨ 하이클래스 +1</button>' +
            '<button class="btn ghost sm" data-tk="normal:-1">일반 -1</button>' +
            '<button class="btn ghost sm" data-tk="high:-1">하이클래스 -1</button>' +
          '</div></div>' +
        '<div class="field"><label>도감 카드 선물 (+1장 / 삭제)</label>' +
          '<div class="search-row"><input class="input" id="cardQ" placeholder="카드 이름 검색 (예: 피카츄)"><button class="btn ghost sm" id="cardSearch">검색</button></div>' +
          '<div id="cardRes" class="dex-grid" style="margin-top:8px"></div></div>';
      body.querySelectorAll('[data-tg]').forEach(b => b.addEventListener('click', () => { target = b.dataset.tg; paint(); }));
      body.querySelector('#giveAmt').addEventListener('click', () => {
        const v = Math.max(0, parseInt(body.querySelector('#amtIn').value || '0', 10));
        if (!v) { P.toast('숫자를 입력해 주세요'); return; }
        P.prof(target).coins += v; P.save(); A.sfx.coin();
        P.toast(P.prof(target).name + '에게 ' + P.won(v) + '코인 지급!', true);
        paint(); U.refreshHeader();
      });
      body.querySelector('#takeAmt').addEventListener('click', () => {
        const v = Math.max(0, parseInt(body.querySelector('#amtIn').value || '0', 10));
        if (!v) { P.toast('숫자를 입력해 주세요'); return; }
        const pr = P.prof(target);
        pr.coins = Math.max(0, pr.coins - v); P.save(); A.sfx.error();
        P.toast(P.prof(target).name + ' 코인 ' + P.won(v) + ' 차감'); paint(); U.refreshHeader();
      });
      body.querySelectorAll('[data-tk]').forEach(b => b.addEventListener('click', () => {
        const [k, sign] = b.dataset.tk.split(':');
        const pr = P.prof(target);
        const d = sign === '-1' ? -1 : 1;
        pr.tickets[k] = Math.max(0, (pr.tickets[k] || 0) + d);
        P.save(); A.sfx.coin();
        P.toast((k === 'high' ? '하이클래스' : '일반') + ' 팩 티켓 ' + (d > 0 ? '+1' : '-1'));
        paint();
      }));
      const doSearch = async () => {
        const q = body.querySelector('#cardQ').value.trim();
        if (!q) return;
        const res = body.querySelector('#cardRes');
        res.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        let pool = window.PKDex.allCards;
        if (!pool) {
          res.innerHTML = '<div class="loading"><div class="spinner"></div>전체 카드 불러오는 중…</div>';
          pool = await window.PKDex.loadAll();
        }
        const hits = pool.filter(c => c.name.indexOf(q) >= 0).slice(0, 24);
        if (!hits.length) { res.innerHTML = '<div class="empty">검색 결과가 없어요 (현재 팩 기준)</div>'; return; }
        res.innerHTML = hits.map(c =>
          '<button class="dex-card r' + c.r + '" data-add="' + c.id + '"><img loading="lazy" src="' + D.img(c.img) + '" alt="">' +
          '<span class="cnt">+' + '</span></button>').join('');
        res.querySelectorAll('[data-add]').forEach(bb => bb.addEventListener('click', async () => {
          const c = await window.PKDex.ensureCard(bb.dataset.add);
          if (!c) return;
          const pr = P.prof(target);
          const cur = pr.cards[c.id] || 0;
          const ok = await P.confirmBox('카드 관리', esc(pr.name) + ' · <b>' + esc(c.name) + '</b> (현재 ' + cur + '장)',
            cur ? '➕ 1장 추가' : '➕ 1장 주기');
          if (ok) { U.addCard(target, c, null, 1); A.sfx.coin(); P.toast('+1장 지급'); paint(); }
        }));
      };
      body.querySelector('#cardSearch').addEventListener('click', doSearch);
      body.querySelector('#cardQ').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    }
    paint();
    P.modal({
      title: '🔒 아빠 관리자 모드',
      body,
      buttons: [
        { label: '🔒 잠그기', kind: 'danger', onClick: () => { P.setAdmin(false); P.toast('잠갔어요'); render(); } },
        { label: '확인', kind: 'primary' }
      ],
      onClose: () => { U.refreshHeader(); render(); }
    });
  }

  /* ---------------- ⏪ 이전 백업 불러오기 (아빠 PIN) ---------------- */
  function pad2(v) { return (v < 10 ? '0' : '') + v; }
  /* 11/18 10:02 (KST) */
  function fmtSlotAt(t) {
    if (!t) return '백업 없음';
    const d = new Date(t);
    if (!isFinite(d.getTime())) return '백업 없음';
    const k = new Date(d.getTime() + 9 * 3600 * 1000);
    return (k.getUTCMonth() + 1) + '/' + k.getUTCDate() + ' ' + pad2(k.getUTCHours()) + ':' + pad2(k.getUTCMinutes());
  }

  function slotCard(slot) {
    const meta = slot.meta;
    if (!meta) {
      return '<div class="bk-slot" data-s="' + slot.s + '">' +
        '<div class="bk-top"><b>' + slot.name + '</b><span class="bk-time">백업 없음</span></div>' +
        '<div class="bk-none">' + (slot.error ? esc(slot.error) : '아직 이 시점의 백업이 없어요') + '</div>' +
        '</div>';
    }
    const hasCards = meta.has.cards, hasCoins = meta.has.coins;
    const head = meta.rows.map(r => '<span class="bk-h">' + r.emoji + ' ' + esc(r.name) + '</span>').join('');
    const cardCells = meta.rows.map(r => '<span class="bk-v">' + (hasCards ? P.won(r.cards) + '장' : '—') + '</span>').join('');
    const coinCells = meta.rows.map(r => '<span class="bk-v">' + (hasCoins && r.coins != null ? P.won(r.coins) : '—') + '</span>').join('');
    const canRestore = hasCards || hasCoins;
    return '<div class="bk-slot" data-s="' + slot.s + '">' +
      '<div class="bk-top"><b>' + slot.name + '</b><span class="bk-time">' + fmtSlotAt(meta.at) + '</span></div>' +
      '<div class="bk-grid">' +
        '<span class="bk-l"></span>' + head +
        '<span class="bk-l">카드</span>' + cardCells +
        '<span class="bk-l">코인</span>' + coinCells +
      '</div>' +
      (canRestore
        ? '<button class="btn primary sm" data-restore="' + slot.s + '">이 시점으로 복원</button>'
        : '<button class="btn ghost sm" disabled>카드팩 기록 없음</button>') +
      '</div>';
  }

  function openBackup() {
    const body = P.el('div');
    body.innerHTML =
      '<div class="muted" style="font-size:12px;line-height:1.65;margin:0 0 11px">' +
        '가족 클라우드에 자동 저장된 3개 시점이에요. <b>카드·코인만</b> 그 시점으로 되돌리고,' +
        ' 도감·마을·배틀 기록은 그대로 둡니다.' +
      '</div>' +
      '<div class="list" id="slotList"><div class="loading"><div class="spinner"></div>백업을 불러오고 있어요…</div></div>';
    const m = P.modal({
      title: '⏪ 이전 백업 불러오기',
      body: body,
      buttons: [{ label: '✕ 나가기', kind: 'ghost' }, { label: '확인', kind: 'primary' }],
      onClose: () => { U.refreshHeader(); render(); }
    });
    const host = body.querySelector('#slotList');
    window.PKCCloud.loadSlots().then(list => {
      if (!host.isConnected) return;
      host.innerHTML = list.map(slotCard).join('');
      host.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => {
        const slot = list.filter(x => x.s === b.dataset.restore)[0];
        if (slot) askRestore(slot, m);
      }));
    });
  }

  async function askRestore(slot, m) {
    const ok = await P.confirmBox('⏪ ' + slot.name + ' 시점으로',
      '<b>' + esc(fmtSlotAt(slot.meta && slot.meta.at)) + '</b> 저장된 기록이에요.<br><br>' +
      '카드와 코인이 그때로 돌아가요. 그 뒤에 뜯은 카드·쓴 코인은 사라져요.<br>' +
      '도감·마을·배틀 기록은 그대로예요.<br><br>되돌릴까요?',
      '확인 · 이 시점으로 복원');
    if (!ok) return;
    A.sfx.tap();
    const r = await window.PKCCloud.restoreSlot(slot.suffix);
    if (!r || !r.ok) {
      P.toast((r && r.msg) ? r.msg : '되돌리지 못했어요');
      return;
    }
    try { m.close(true); } catch (e) { /* */ }
    U.refreshHeader();
    const lines = P.PROFILES.map(p => {
      const pr = P.prof(p.id);
      return '<div class="kv"><span>' + p.emoji + ' ' + esc(pr.name) + '</span><b>카드 ' + P.won(U.totalCards(pr)) +
        '장 · 🪙 ' + P.won(pr.coins) + '</b></div>';
    }).join('');
    P.modal({
      title: '✅ 이전 백업으로 되돌렸어요',
      body: '<div>' + lines + '</div>' +
        '<p class="muted" style="font-size:11.5px;line-height:1.6;margin:10px 0 0">다른 기기도 이 시점으로 맞춰져요. 도감·마을 기록은 손대지 않았어요.</p>',
      buttons: [{ label: '확인', kind: 'primary' }]
    });
    render();
  }

  window.PKMore = { render, openAdmin, openBackup };
})();
