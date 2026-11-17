/* ============================================================================
   포켓몬 카드 배틀 TCG — 게임 엔진 + UI
   실제 카드 데이터(TCGdex ko 52종) · 특성/기술 효과 실행 · 약점×2/저항-30 · 코인토스
   ========================================================================== */
(function () {
'use strict';
const POOL = window.TCG_POOL, DECKS = window.TCG_DECKS, TYPE_KO = window.TCG_TYPES.ko;
const BY = {}; POOL.forEach(c => BY[c.id] = c);
const SAVE_KEY = 'poketcg_v1';
const PIN_CODE = '0623';
const $app = document.getElementById('app');

/* ------------------------------------------------------------ 저장소 */
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
}
const saved = loadSave();
const S = {
  coins: saved.coins != null ? saved.coins : 120,
  dex: saved.dex || {},
  wins: saved.wins || 0, plays: saved.plays || 0, packs: saved.packs || 0,
  settings: Object.assign({ pin: true, guest: false, sfx: 0.8, bgm: 0.28, bgmOn: true,
                            difficulty: 'normal', prizes: 3, autoAttack: false }, saved.settings || {}),
  screen: 'home', deckId: null, dexFilter: 'all', detail: null, pinBuf: '', pinErr: '',
  unlocked: !!saved.unlocked
};
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      coins: S.coins, dex: S.dex, wins: S.wins, plays: S.plays, packs: S.packs,
      settings: S.settings, unlocked: S.unlocked
    }));
  } catch (e) {}
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = n => Math.floor(Math.random() * n);
const pickOne = a => a[rnd(a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let UID = 0;
const newUid = () => 'u' + (++UID);

/* ------------------------------------------------------------ 사운드 초기화 */
function sfx() { return window.SFX; }
function play(fn, ...args) { try { sfx().unlock(); sfx()[fn] && sfx()[fn](...args); } catch (e) {} }
function applyAudioSettings() {
  const s = sfx();
  s.setSfx(S.settings.sfx); s.setBgm(S.settings.bgm); s.setMuted(false);
  s.bgmOn = S.settings.bgmOn;
  if (S.settings.bgmOn) s.startBGM(); else s.stopBGM();
}

/* ------------------------------------------------------------ 타입 표시 */
const ENERGY_ICON = { Fire: '🔥', Water: '💧', Lightning: '⚡', Psychic: '🔮', Fighting: '✊', Colorless: '⭐', Grass: '🌿', Metal: '⚙️', Darkness: '🌙', Dragon: '🐉' };
const STATUS_KO = { burn: '화상', poison: '독', paralyze: '마비', sleep: '잠듦', confuse: '혼란' };
const STATUS_ICON = { burn: '🔥', poison: '🟣', paralyze: '⚡', sleep: '💤', confuse: '😵‍💫' };
function enDot(type, extra) {
  return `<i class="en-dot en-${type}" title="${TYPE_KO[type] || type}">${extra == null ? '' : extra}</i>`;
}
function energyRow(list) {
  if (!list.length) return '';
  return `<div class="enrow">${list.map(t => enDot(t)).join('')}</div>`;
}

/* ------------------------------------------------------------ 카드 렌더 */
function cardEl(card, opts) {
  opts = opts || {};
  const u = opts.unit;
  const cls = ['card', opts.size || 'active'];
  if (opts.holo && (card.ex || card.rarityW >= 3)) cls.push('holo');
  if (opts.selected) cls.push('selected');
  if (opts.facedown) cls.push('facedown');
  if (opts.canTap) cls.push(opts.size === 'active' || opts.size === 'bench' ? 'can-tap' : 'tappable');
  if (opts.cls) cls.push(opts.cls);
  const hp = u ? Math.max(0, card.hp - u.dmg) : null;
  const pct = u ? Math.max(0, hp / card.hp * 100) : 100;
  const hcls = pct <= 25 ? 'danger' : pct <= 50 ? 'warn' : '';
  const st = u && u.status ? u.status : null;
  let extra = '';
  if (u) {
    extra += `<div class="hpmini"><i class="${hcls}" style="width:${pct}%"></i></div>`;
    if (u.energies.length) extra += energyRow(u.energies);
    if (u.dmg > 0) extra += `<span class="dmgpill">-${u.dmg}</span>`;
    if (st) extra += `<span class="stbadge" title="${STATUS_KO[st]}">${STATUS_ICON[st]}</span>`;
  }
  return `<div class="${cls.join(' ')}" data-uid="${opts.uid || (u ? u.uid : '')}" data-card="${card.id}" ${opts.attr || ''}>
      <img src="${card.image}" alt="${esc(card.name)}" loading="lazy" decoding="async">
      ${extra}
    </div>`;
}

/* ------------------------------------------------------------ 화면 전환 */
function go(screen) { S.screen = screen; render(); window.scrollTo(0, 0); }

function render() {
  if (!S.unlocked && S.settings.pin && !S.settings.guest) { renderPin(); return; }
  switch (S.screen) {
    case 'home': renderHome(); break;
    case 'decks': renderDecks(); break;
    case 'battle': renderBattle(); break;
    case 'pack': renderPack(); break;
    case 'dex': renderDex(); break;
    case 'settings': renderSettings(); break;
    default: renderHome();
  }
  const c = document.getElementById('modalRoot'); if (c) c.innerHTML = '';
}

/* ------------------------------------------------------------ 공통 상단바 */
function topbar(title, right) {
  return `<div class="topbar">
    <button class="iconbtn" data-act="home">◀</button>
    <h1>${title}</h1>
    ${right || ''}
    <span class="chip coins">🪙 ${S.coins}</span>
    <button class="iconbtn" data-act="sound">${S.settings.bgmOn ? '🔊' : '🔇'}</button>
  </div>`;
}

/* ------------------------------------------------------------ PIN */
function renderPin() {
  const dots = [0, 1, 2, 3].map(i => `<i class="${i < S.pinBuf.length ? 'on' : ''}"></i>`).join('');
  $app.innerHTML = `<div class="home" style="justify-content:center;min-height:100dvh">
    <div class="hero">
      <div class="ball"></div>
      <h2>포켓몬 카드 배틀</h2>
      <p>보호자 PIN을 입력해 주세요<br><span style="opacity:.7">(처음 한 번만 물어봐요)</span></p>
    </div>
    <div class="pindots">${dots}</div>
    <div style="text-align:center;color:#ff8a8a;font-size:12px;min-height:16px">${esc(S.pinErr)}</div>
    <div class="pinpad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-act="pin" data-v="${n}">${n}</button>`).join('')}
      <button data-act="guestPin" style="font-size:12px">게스트</button>
      <button data-act="pin" data-v="0">0</button>
      <button data-act="pin" data-v="del" style="font-size:16px">⌫</button>
    </div>
    <p style="text-align:center;color:var(--dim);font-size:11px;line-height:1.6;margin-top:14px">
      PIN은 설정에서 끌 수 있어요.<br>게스트로 들어가면 기록이 저장되지 않아요.
    </p>
  </div>`;
}
function pinInput(v) {
  S.pinErr = '';
  play('tap');
  if (v === 'del') { S.pinBuf = S.pinBuf.slice(0, -1); }
  else if (S.pinBuf.length < 4) S.pinBuf += v;
  if (S.pinBuf.length === 4) {
    if (S.pinBuf === PIN_CODE) { S.unlocked = true; S.pinBuf = ''; save(); play('win'); go('home'); return; }
    S.pinErr = 'PIN이 달라요. 다시 입력해 주세요.'; S.pinBuf = ''; play('lose');
  }
  renderPin();
}

/* ------------------------------------------------------------ 홈 */
function renderHome() {
  const collected = Object.keys(S.dex).length;
  $app.innerHTML = `
  ${topbar('포켓몬 카드 배틀 TCG', `<button class="iconbtn" data-act="install" title="앱 설치">📲</button>`)}
  <div class="home">
    <div class="hero">
      <div class="ball"></div>
      <h2>포켓몬 카드 배틀</h2>
      <p>진짜 한국어 카드 ${POOL.length}종 · 약점 ×2 · 특성 · 코인토스</p>
    </div>
    <div class="statline">
      <span class="chip">🃏 도감 ${collected}/${POOL.length}</span>
      <span class="chip">🏆 ${S.wins}승</span>
      <span class="chip">🎁 팩 ${S.packs}</span>
    </div>
    <div class="modes">
      <button class="mode" data-act="toDecks" data-mode="ai">
        <div class="emo">🤖</div><b>1인 AI 대결</b><small>컴퓨터와 한 판!</small>
      </button>
      <button class="mode" data-act="toDecks" data-mode="pvp">
        <div class="emo">👦👧</div><b>2인 남매 대결</b><small>한 폰으로 번갈아</small>
      </button>
      <button class="mode" data-act="goPack">
        <div class="emo">🎁</div><b>카드팩 뽑기</b><small>코인으로 랜덤 팩</small>
      </button>
      <button class="mode" data-act="goDex">
        <div class="emo">📖</div><b>내 도감</b><small>${collected} / ${POOL.length}장</small>
      </button>
    </div>
    <div class="row" style="margin-top:6px">
      <button class="btn ghost sm" data-act="goSettings">⚙️ 설정</button>
      <button class="btn ghost sm" data-act="install">📲 앱 설치</button>
      <span class="spacer"></span>
      <span style="font-size:10.5px;color:var(--dim)">카드 출처: TCGdex · 포켓몬코리아</span>
    </div>
  </div>`;
}

/* ------------------------------------------------------------ 덱 선택 */
function renderDecks() {
  const mode = S.pendingMode || 'ai';
  $app.innerHTML = `${topbar(mode === 'ai' ? '내 덱 고르기 — AI 대결' : '내 덱 고르기 — 2인 대결')}
  <div class="decks">
    ${DECKS.map(d => {
      const uniq = [...new Set(d.list)];
      const arts = uniq.slice(0, 2);
      return `<button class="deckcard ${S.deckId === d.id ? 'sel' : ''}" data-act="pickDeck" data-deck="${d.id}">
        <div class="stack">${arts.map(id => `<img src="${BY[id].image}" alt="">`).join('')}</div>
        <div style="flex:1;min-width:0">
          <div class="dtitle">${d.emoji} ${d.name} 덱</div>
          <div class="dsub">${d.tagline} · 카드 ${d.list.length}장 / ${uniq.length}종</div>
          <div class="energy-dots">${d.energies.map(e => `<span class="en-dot en-${e}">${ENERGY_ICON[e]}</span>`).join('')}</div>
        </div>
        <span style="font-size:22px">›</span>
      </button>`;
    }).join('')}
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">
      <div class="row"><span class="chip">프라이즈</span>
        <button class="btn sm ${S.settings.prizes === 3 ? 'primary' : 'ghost'}" data-act="setPrizes" data-v="3">빠른 판 3장</button>
        <button class="btn sm ${S.settings.prizes === 6 ? 'primary' : 'ghost'}" data-act="setPrizes" data-v="6">정식 6장</button>
      </div>
      ${mode === 'ai' ? `<div class="row"><span class="chip">AI 난이도</span>
        <button class="btn sm ${S.settings.difficulty === 'easy' ? 'primary' : 'ghost'}" data-act="setDiff" data-v="easy">쉬움</button>
        <button class="btn sm ${S.settings.difficulty === 'normal' ? 'primary' : 'ghost'}" data-act="setDiff" data-v="normal">보통</button>
      </div>` : ''}
    </div>
    <button class="btn primary" style="margin-top:8px;padding:15px" data-act="startBattle">⚔️ 배틀 시작!</button>
  </div>`;
}

/* ------------------------------------------------------------ 배틀 준비 */
const ENEMY_DECKS = ['fire', 'water', 'lightning', 'psychic'];

function unitOf(id) {
  const card = BY[id];
  return { uid: newUid(), id, card, dmg: 0, energies: [], status: null, thorn: 0,
           immuneNext: false, noRetreat: false, recharge: 0, blockThis: false,
           evolvedThisTurn: false, healedThisTurn: false, abilityUsedTurn: -1, enteredTurn: 0, justEvolved: false };
}
function newPlayer(idx, deckId, name, isAI) {
  const d = DECKS.find(x => x.id === deckId);
  return { idx, name, isAI, deckId, deckName: d.name, deck: shuffle(d.list.map(id => ({ uid: newUid(), id }))),
           hand: [], discard: [], prizeLeft: S.settings.prizes, prizesTaken: 0, active: null, bench: [],
           energyUsed: false, abilityUsed: false, koLastTurn: false, cantAttack: false, deckEmptyLose: false };
}

function startBattle(mode, deckId) {
  if (!deckId) { S.pendingMode = mode; go('decks'); return; }
  const foeDeck = ENEMY_DECKS.filter(x => x !== deckId)[rnd(3)];
  const p0 = newPlayer(0, deckId, mode === 'pvp' ? '플레이어 1' : (S.settings.guest ? '나' : '나'), false);
  const p1 = newPlayer(1, mode === 'pvp' ? deckId : foeDeck, mode === 'pvp' ? '플레이어 2' : 'AI', mode === 'ai');
  const B = window.__B = { mode, players: [p0, p1], cur: 0, turn: 0, busy: false, over: false,
                            log: [], coinBusy: false, awaiting: null };
  // draw + setup
  [p0, p1].forEach(p => {
    for (let i = 0; i < 6; i++) drawCard(p, true);
    const basics = p.hand.filter(c => BY[c.id].stage === 'Basic');
    if (basics[0]) { p.active = unitOf(basics[0].id); removeHand(p, basics[0].uid); }
    basics.slice(1, 3).forEach(c => {
      if (p.active && p.bench.length < 3) { p.bench.push(unitOf(c.id)); removeHand(p, c.uid); }
    });
    if (!p.active && p.hand.length) { const c = p.hand[0]; p.active = unitOf(c.id); removeHand(p, c.uid); }
  });
  B.players.forEach(p => { if (p.active) p.active.enteredTurn = 1; });
  S.battleMeta = { mode, deckId };
  go('battle');
  log(B, '배틀 시작!', 'info');
  setTimeout(() => startTurn(0, true), 420);
}
function drawCard(p, silent) {
  if (!p.deck.length) { p.deckEmptyLose = true; return null; }
  const c = p.deck.shift();
  p.hand.push({ uid: c.uid, id: c.id, isNew: true });
  if (!silent) play('draw');
  return c;
}
function removeHand(p, uid) { const i = p.hand.findIndex(c => c.uid === uid); if (i >= 0) p.hand.splice(i, 1); }

/* ------------------------------------------------------------ 로그 */
function log(B, text, kind) {
  B.log.push({ text, kind: kind || 'info', t: B.turn });
  if (B.log.length > 40) B.log.shift();
  const box = document.getElementById('logbox');
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'logline'; d.textContent = text;
  box.appendChild(d);
  setTimeout(() => d.remove(), 2600);
  while (box.children.length > 3) box.firstChild.remove();
}

/* ------------------------------------------------------------ 턴 진행 */
function curP(B) { return B.players[B.cur]; }
function foeP(B) { return B.players[1 - B.cur]; }
function unitHp(u) { return u ? Math.max(0, u.card.hp - u.dmg) : 0; }

async function startTurn(idx, first) {
  const B = window.__B; if (!B || B.over) return;
  B.cur = idx; B.turn++;
  const p = B.players[idx], foe = B.players[1 - idx];
  p.energyUsed = false; p.abilityUsed = false; p.cantAttack = false; p.cantRetreat = false;
  if (p.active) {
    if (p.active.recharge > 0) { p.cantAttack = true; p.active.recharge--; }
    if (p.active.__blockNext) { p.cantAttack = true; p.active.__blockNext = false; }
    if (p.active.noRetreat) { p.cantRetreat = true; p.active.noRetreat = false; }
  }
  if (p.active) { p.active.evolvedThisTurn = false; p.active.healedThisTurn = false; p.active.justEvolved = false; p.active.thorn = 0; p.active.blockThis = false; p.active.immuneNext = false; }
  B.players.forEach(pl => { pl.koLastTurn = false; });
  render();
  if (!p.active) { await promoteIfNeeded(idx); }

  // 상태이상 처리
  if (p.active) {
    const u = p.active;
    if (u.status === 'poison') {
      await damageUnit(B, u, 10, { status: true, noWeak: true });
      log(B, `독 데미지! ${u.card.name} -10`, 'status');
    }
    if (u.status === 'burn') {
      await damageUnit(B, u, 20, { status: true, noWeak: true });
      log(B, `화상 데미지! ${u.card.name} -20`, 'status');
      const h = await flipCoins(1, '화상 회복 판정');
      if (h === 1) { u.status = null; log(B, '화상이 나았다!', 'good'); }
    }
    if (u.status === 'paralyze') {
      p.cantAttack = true; p.cantRetreat = true;
      log(B, `${u.card.name}은(는) 마비로 움직일 수 없다!`, 'bad');
      u.status = null; // 한 턴 후 회복
    } else if (u.status === 'sleep') {
      const h = await flipCoins(1, '잠듦 판정');
      if (h === 1) { u.status = null; log(B, '잠에서 깨어났다!', 'good'); }
      else { p.cantAttack = true; p.cantRetreat = true; log(B, `${u.card.name}은(는) 자고 있다… 💤`, 'bad'); }
    }
  }
  if (B.over) return;
  // 드로우
  const c = drawCard(p);
  if (!c) { await endGame(1 - idx, '덱이 다 떨어졌어요'); return; }
  log(B, `${p.name}: 카드 1장 뽑기`, 'info');
  render();
  if (p.isAI) setTimeout(() => aiTurn(), 700);
}

function endTurn() {
  const B = window.__B; if (!B || B.busy || B.over) return;
  const p = curP(B);
  if (p.active) p.active.healedThisTurn = p.active.healedThisTurn;
  // PvP: 가림 화면
  if (B.mode === 'pvp') {
    passScreen(() => startTurn(1 - B.cur));
  } else {
    startTurn(1 - B.cur);
  }
}

function passScreen(next) {
  const B = window.__B;
  const other = B.players[1 - B.cur];
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="cover"><div class="box">
    <div style="font-size:44px">🤝</div>
    <h3>${esc(other.name)} 차례!</h3>
    <p>폰을 ${esc(other.name)}에게 넘겨주세요.<br>준비되면 눌러 주세요.</p>
    <button class="btn primary" style="width:100%;padding:14px" data-act="passGo">준비됐어요!</button>
  </div></div>`;
  window.__passNext = () => { root.innerHTML = ''; next(); };
}

/* ------------------------------------------------------------ 에너지 */
function energyChoices(p) {
  const d = DECKS.find(x => x.id === p.deckId);
  return d.energies;
}
function attachEnergy(p, unit, type) {
  unit.energies.push(type);
  p.energyUsed = true;
  play('energy', type);
  const el = document.querySelector(`.card[data-uid="${unit.uid}"]`);
  if (el) { const r = el.getBoundingClientRect(); window.VFX.burst(type === 'Colorless' ? 'spark' : type, r.left + r.width / 2, r.top + r.height / 2, { count: 26, speed: 3, ring: 60 }); }
  log(window.__B, `${unit.card.name}에게 ${TYPE_KO[type]} 에너지 장착!`, 'good');
  render();
}

/* ------------------------------------------------------------ 특성/기술 계산 */
function hasTrio(p) {
  const names = [p.active, ...p.bench].filter(Boolean).map(u => u.card.name);
  return ['바오키', '야나키', '앗차키'].every(n => names.includes(n));
}
function abilityOf(u) { return (u && u.card && u.card.ability) ? u.card.ability : null; }
function unitHasArmor(u) { return abilityOf(u) && abilityOf(u).ops.some(o => o.t === 'armor') && u.dmg === 0; }
function thawRoomBlocked(p, targetU) {
  // 상대 활성 포켓몬의 '극한 룸': 남은 HP 40 이하인 포켓몬은 기술 사용 불가
  const B0 = window.__B;
  if (!B0 || !p || p.idx == null) return false;
  const foe = B0.players[1 - p.idx];
  if (!foe || !foe.active) return false;
  const fAb = abilityOf(foe.active);
  if (fAb && fAb.ops.some(o => o.t === 'thawRoom')) {
    const lim = fAb.ops.find(o => o.t === 'thawRoom').hp;
    if (targetU && unitHp(targetU) <= lim) return true;
  }
  return false;
}
function canPay(p, u, cost) {
  let c = cost.slice();
  if (hasTrio(p)) c = c.filter(x => x !== 'Colorless');
  const pool = u.energies.slice();
  const typed = {};
  c.forEach(x => typed[x] = (typed[x] || 0) + 1);
  Object.keys(typed).forEach(t => {
    if (t === 'Colorless') return;
    for (let i = 0; i < typed[t]; i++) {
      const k = pool.indexOf(t);
      if (k < 0) { typed.__fail = true; return; }
      pool.splice(k, 1);
    }
  });
  if (typed.__fail) return false;
  return pool.length >= (typed.Colorless || 0);
}
function attackPreview(atkU, defU, atk) {
  if (!atkU || !atkU.card) return { coin: false, min: 0, max: 0 };
  defU = (defU && defU.card) ? defU : null;
  let base = atk.dmg.base, coin = false, per = null;
  for (const op of atk.ops) {
    switch (op.t) {
      case 'coinMul': coin = true; per = { flips: op.flips, per: op.per }; base = 0; break;
      case 'damagePerSelfEnergy': base = atkU.energies.length * op.per; break;
      case 'damagePerHand': base = curP(window.__B).hand.length * op.per; break;
      case 'plusPerSelfEnergy': base += atkU.energies.filter(e => !op.type || e === op.type).length * op.per; break;
      case 'coinAdd': coin = true; break;
      case 'plusIfEnergyType': if (atkU.energies.includes(op.type)) base += op.add; break;
      case 'plusIfHealedThisTurn': if (atkU.healedThisTurn) base += op.add; break;
      case 'plusIfKOLastTurn': if (curP(window.__B).koLastTurn) base += op.add; break;
      case 'discardCostAdd': if (atkU.energies.includes(op.type)) coin = true; break;
    }
  }
  if (coin) return { coin: true, min: 0, max: per ? per.flips * per.per : base + 200 };
  let dmg = base;
  if (defU) {
    if (defU.card.weak && defU.card.weak.type === atkU.card.type) dmg *= 2;
    if (defU.card.resist && defU.card.resist.type === atkU.card.type) dmg = Math.max(0, dmg - 30);
    if (unitHasArmor(defU)) dmg = Math.max(0, dmg - 80);
  }
  return { coin: false, min: dmg, max: dmg };
}

/* ------------------------------------------------------------ 데미지 적용 */
async function damageUnit(B, u, amount, opts) {
  opts = opts || {};
  if (!u) return 0;
  let dmg = amount;
  if (u.immuneNext && !opts.status) { log(B, `${u.card.name}은(는) 공격을 막았다!`, 'good'); return 0; }
  if (unitHasArmor(u) && !opts.status && !opts.noArmor) { dmg = Math.max(0, dmg - 80); }
  u.dmg += dmg;
  const el = document.querySelector(`.card[data-uid="${u.uid}"]`);
  if (el) {
    window.VFX.cardFlash(el);
    const r = el.getBoundingClientRect();
    window.VFX.popup(r.left + r.width / 2, r.top + r.height * 0.35, `-${dmg}`, opts.crit ? 'crit' : '');
  }
  render();
  return dmg;
}

/* ------------------------------------------------------------ 코인토스 */
async function flipCoins(n, label) {
  const B = window.__B;
  let heads = 0;
  for (let i = 0; i < n; i++) {
    const h = await coinFlipOne(label);
    heads += h;
  }
  return heads;
}
function coinFlipOne(label) {
  return new Promise(resolve => {
    const root = document.getElementById('modalRoot');
    const heads = Math.random() < 0.5;
    root.innerHTML = `<div class="cover"><div class="box">
      <h3>코인토스</h3>
      <p>${esc(label || '')}</p>
      <div class="coin" id="coinEl">
        <div class="face front">${heads ? '⭐' : '🌙'}</div>
        <div class="face back">${heads ? '🌙' : '⭐'}</div>
      </div>
      <div class="result-big" id="coinResult" style="opacity:0">…</div>
    </div></div>`;
    play('coinFlip');
    const el = document.getElementById('coinEl');
    el.style.setProperty('--end', heads ? '1440deg' : '1620deg');
    setTimeout(() => el.classList.add('spin'), 20);
    setTimeout(() => {
      const res = document.getElementById('coinResult');
      if (res) { res.textContent = heads ? '앞면! ⭐' : '뒷면 🌙'; res.style.opacity = 1; res.style.color = heads ? '#ffe066' : '#9aa5b1'; }
      play('coinLand', heads);
      const r = el.getBoundingClientRect();
      window.VFX.burst(heads ? 'spark' : 'colorless', r.left + r.width / 2, r.top + r.height / 2, { count: heads ? 40 : 18, speed: 4, ring: 90 });
      if (heads) window.VFX.flash(0.25);
    }, 1120);
    setTimeout(() => { root.innerHTML = ''; resolve(heads ? 1 : 0); }, 1900);
  });
}

/* ------------------------------------------------------------ 공격 실행 */
async function useAttack(ai) {
  const B = window.__B; if (!B || B.busy || B.over) return;
  const p = curP(B), foe = foeP(B);
  const u = p.active; if (!u) return;
  const atk = ai != null ? u.card.attacks[ai] : null;
  if (!atk) return;
  if (p.cantAttack) { log(B, '이번 차례에는 공격할 수 없어요!', 'bad'); return; }
  if (thawRoomBlocked(p, u)) { log(B, '상대의 「극한 룸」! HP가 낮아 기술을 쓸 수 없어요.', 'bad'); return; }
  B.busy = true;
  const atkEl = document.querySelector(`.card[data-uid="${u.uid}"]`);
  if (atkEl) {
    atkEl.style.transform = 'translateX(18px) scale(1.05)';
    setTimeout(() => { atkEl.style.transform = ''; }, 260);
  }
  play('attack', u.card.type, atk.dmg.base);
  log(B, `${u.card.name}의 「${atk.name}」!`, 'attack');
  await sleep(260);

  // 코인 관련
  let fail = false, extra = 0, mul = null, coinStatus = null, coinImmune = false, coinMoveEnergy = 0, coinAdd = 0;
  for (const op of atk.ops) {
    if (op.t === 'coinMul') {
      const h = await flipCoins(op.flips, `${atk.name} — 앞면 수 × ${op.per}`);
      mul = h * op.per;
      log(B, `코인 ${op.flips}번 중 앞면 ${h}개 → ${mul} 데미지`, 'coin');
    } else if (op.t === 'coinFail') {
      const h = await flipCoins(1, '뒷면이면 실패!');
      if (h === 0) { fail = true; }
    } else if (op.t === 'coinStatus') {
      const h = await flipCoins(op.flips, '앞면이면 상태이상!');
      if (h >= 1) coinStatus = op.s;
    } else if (op.t === 'coinAdd') {
      const h = await flipCoins(op.flips || 1, '앞면이면 추가 데미지!');
      if (h >= 1) { coinAdd = op.add; window.VFX.flash(0.2); }
    } else if (op.t === 'coinImmune') {
      const h = await flipCoins(op.flips || 1, '앞면이면 이번 차례 보호');
      if (h >= 1) coinImmune = true;
    } else if (op.t === 'coinMoveFoeEnergy') {
      const h = await flipCoins(op.flips || 1, '앞면이면 상대 에너지 이동');
      if (h >= 1) coinMoveEnergy = 1;
    } else if (op.t === 'discardCostAdd') {
      if (u.energies.includes(op.type)) {
        const yes = await confirmBox(`「${atk.name}」 강화`, `${TYPE_KO[op.type]} 에너지를 1개 버리고 +${op.add} 데미지를 더할까요?`, '더한다', '그냥 쓴다');
        if (yes) {
          const k = u.energies.indexOf(op.type); u.energies.splice(k, 1);
          p.discard.push({ type: op.type }); extra += op.add;
          play('energy', op.type);
        }
      }
    } else if (op.t === 'failIfFoeNotStatus') {
      if (!foe.active || foe.active.status !== op.s) { fail = true; log(B, `상대가 ${STATUS_KO[op.s]} 상태가 아니라 기술 실패!`, 'bad'); }
    }
  }
  if (fail) {
    log(B, `${u.card.name}의 「${atk.name}」 실패…`, 'bad');
    play('lose');
    B.busy = false; render();
    await sleep(500);
    endTurnAfterAttack(p);
    return;
  }

  // 데미지 계산
  let base = mul != null ? mul : atk.dmg.base;
  for (const op of atk.ops) {
    if (op.t === 'plusPerSelfEnergy') base += u.energies.filter(e => !op.type || e === op.type).length * op.per;
    else if (op.t === 'damagePerSelfEnergy') base = u.energies.length * op.per;
    else if (op.t === 'damagePerHand') base = p.hand.length * op.per;
    else if (op.t === 'plusIfEnergyType') { if (u.energies.includes(op.type)) { base += op.add; log(B, `강철 에너지 파워 +${op.add}`, 'good'); } }
    else if (op.t === 'plusIfHealedThisTurn') { if (u.healedThisTurn) base += op.add; }
    else if (op.t === 'plusIfKOLastTurn') { if (p.koLastTurn) base += op.add; }
  }
  base += coinAdd + extra;

  let finalDmg = base, crit = false, noWeak = atk.ops.some(o => o.t === 'snipeAny');
  if (foe.active && base > 0 && !noWeak) {
    if (foe.active.card.weak && foe.active.card.weak.type === u.card.type) { finalDmg *= 2; crit = true; }
    if (foe.active.card.resist && foe.active.card.resist.type === u.card.type) finalDmg = Math.max(0, finalDmg - 30);
  }
  if (foe.active && unitHasArmor(foe.active) && finalDmg > 0) {
    finalDmg = Math.max(0, finalDmg - 80);
    log(B, `「홍련 아머」로 데미지 -80!`, 'bad');
  }
  if (coinImmune) { u.immuneNext = true; }

  // 이펙트 + 타격
  const target = foe.active;
  if (target && base > 0) {
    const tel = document.querySelector(`.card[data-uid="${target.uid}"]`);
    const rect = tel ? tel.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    play('attack', u.card.type, finalDmg);
    window.VFX.burst(u.card.type === 'Colorless' ? 'spark' : u.card.type, cx, cy, { count: crit ? 70 : 44, speed: crit ? 6 : 4.4, ring: crit ? 130 : 90, flash: crit ? 0.45 : 0 });
    if (crit) { play('crit'); window.VFX.shake(3); window.VFX.popup(cx, cy - rect.height * 0.42, '약점 ×2!', 'crit'); }
    else if (finalDmg >= 100) window.VFX.shake(2);
    else window.VFX.shake(1);
    await sleep(crit ? 380 : 280);
    await damageUnit(B, target, finalDmg, { crit });
    if (target.dmg > 0) window.VFX.popup(cx, cy + rect.height * 0.1, `-${finalDmg}`, crit ? 'crit' : '');
  }

  // 나머지 효과
  for (const op of atk.ops) {
    switch (op.t) {
      case 'status': if (foe.active) { foe.active.status = op.s; play('status', op.s); log(B, `상대 ${foe.active.card.name} → ${STATUS_KO[op.s]}!`, 'bad'); } break;
      case 'coinStatus': if (coinStatus && foe.active) { foe.active.status = coinStatus; play('status', coinStatus); log(B, `상대 ${foe.active.card.name} → ${STATUS_KO[coinStatus]}!`, 'bad'); } break;
      case 'selfDamage': { await damageUnit(B, u, op.n, { status: true, crit: false }); log(B, `${u.card.name}도 ${op.n} 데미지!`, 'bad'); } break;
      case 'heal': { const before = u.dmg; u.dmg = Math.max(0, u.dmg - op.n); u.healedThisTurn = true; play('heal');
        const el2 = document.querySelector(`.card[data-uid="${u.uid}"]`); if (el2) { const r2 = el2.getBoundingClientRect(); window.VFX.burst('heal', r2.left + r2.width / 2, r2.top + r2.height / 2, { count: 26, speed: 2.4 }); window.VFX.popup(r2.left + r2.width / 2, r2.top + r2.height * 0.3, `+${before - (u.dmg)}`, 'heal'); }
        log(B, `${u.card.name} HP 회복!`, 'good'); } break;
      case 'draw': for (let i = 0; i < op.n; i++) drawCard(p); play('draw'); log(B, `카드 ${op.n}장 뽑기`, 'good'); render(); break;
      case 'benchAll': if (foe.bench.length) { foe.bench.forEach(b => { b.dmg += op.n; }); play('attack', u.card.type, 20);
        const anyB = foe.bench[0]; window.VFX.shake(1);
        window.VFX.popup(innerWidth / 2, innerHeight * 0.34, `벤치 전체 -${op.n}`, 'info');
        log(B, `상대 벤치 전원에게 ${op.n} 데미지!`, 'bad'); render(); } break;
      case 'benchSnipe': case 'snipeAny': {
        const targets2 = foe.bench.filter(Boolean);
        if (op.t === 'snipeAny') {
          const all = [foe.active, ...targets2].filter(Boolean);
          if (all.length) {
            const t2 = all[0];
            t2.dmg += op.n;
            window.VFX.popup(innerWidth / 2, innerHeight * 0.4, `-${op.n}`, 'info');
            play('attack', u.card.type, op.n);
            log(B, `${t2.card.name}에게 ${op.n} 데미지! (약점 무시)`, 'bad');
          }
        } else if (targets2.length) {
          const t2 = targets2[0]; t2.dmg += op.n;
          window.VFX.popup(innerWidth / 2, innerHeight * 0.3, `벤치 -${op.n}`, 'info');
          play('attack', u.card.type, op.n); log(B, `상대 벤치 ${t2.card.name}에게 ${op.n} 데미지!`, 'bad');
        }
        render(); break;
      }
      case 'multiHitCounters': {
        const hit = [foe.active, ...foe.bench].filter(x => x && x.dmg > 0).slice(0, op.max);
        if (hit.length) { hit.forEach(t3 => t3.dmg += op.n); play('attack', u.card.type, op.n);
          window.VFX.popup(innerWidth / 2, innerHeight * 0.38, `데미지 카운터 포켓몬 ${hit.length}마리 -${op.n}`, 'info');
          log(B, `데미지가 있는 상대 포켓몬 ${hit.length}마리에게 ${op.n}씩!`, 'bad'); render(); }
        break;
      }
      case 'accelFromDeck': {
        const idx = p.deck.findIndex(c => c.id && true);
        if (op.type) { u.energies.push(op.type); play('energy', op.type);
          const el3 = document.querySelector(`.card[data-uid="${u.uid}"]`);
          if (el3) { const r3 = el3.getBoundingClientRect(); window.VFX.burst(op.type, r3.left + r3.width / 2, r3.top + r3.height / 2, { count: 22, speed: 2.6, ring: 60 }); }
          log(B, `덱에서 ${TYPE_KO[op.type]} energy를 붙였다!`, 'good'); render(); }
        break;
      }
      case 'accelFromTrash': {
        for (let i = 0; i < op.n; i++) { u.energies.push(op.type); p.discard.push({ type: op.type }); }
        play('energy', op.type); log(B, `트래쉬에서 ${TYPE_KO[op.type]} 에너지 ${op.n}개 장착!`, 'good'); render(); break;
      }
      case 'accelByFoePrizes': {
        const n = Math.min(3, foe.prizesTaken || 0);
        for (let i = 0; i < Math.max(n, 1); i++) u.energies.push(op.type);
        play('energy', op.type); log(B, `트래쉬에서 ${TYPE_KO[op.type]} 에너지 장착!`, 'good'); render(); break;
      }
      case 'searchBasicToBench': {
        if (p.bench.length < 5) {
          const i2 = p.deck.findIndex(c => BY[c.id].stage === 'Basic');
          if (i2 >= 0) { const c2 = p.deck.splice(i2, 1)[0]; p.bench.push(unitOf(c2.id)); play('place'); log(B, `덱에서 ${BY[c2.id].name}을(를) 벤치로!`, 'good'); render(); }
        } break;
      }
      case 'searchEnergyHand': log(B, '덱에서 에너지를 찾아 패로! (에너지는 무한 사용)', 'good'); play('draw'); break;
      case 'topDeckEnergy': {
        const top = p.deck.splice(0, op.cards);
        const en = top.filter(c => c && c.id);
        const cnt = Math.max(1, Math.floor(top.length / 3));
        for (let i = 0; i < cnt; i++) p.discard.push({ type: 'Water' });
        if (foe.active) { await damageUnit(B, foe.active, cnt * op.per, { crit: false }); log(B, `덱 위 ${top.length}장 중 에너지 ${cnt}장 → ${cnt * op.per} 데미지!`, 'attack'); }
        render(); break;
      }
      case 'shuffleHandDrawBench': {
        const n2 = p.hand.length;
        p.deck.push(...p.hand.map(c => ({ uid: c.uid, id: c.id })));
        p.hand = []; shuffle(p.deck);
        const drawN = (p.bench.length + 1) + (foe.bench.length + 1);
        for (let i = 0; i < drawN; i++) drawCard(p, true);
        play('shuffle'); log(B, `패를 덱으로 되돌리고 ${drawN}장 뽑기`, 'info'); render(); break;
      }
      case 'discardSelfEnergy': {
        for (let i = 0; i < op.n && u.energies.length; i++) p.discard.push({ type: u.energies.pop() });
        play('tap'); log(B, `에너지 ${op.n}개를 버렸다`, 'info'); render(); break;
      }
      case 'discardFoeEnergy': {
        if (foe.active && foe.active.energies.length) { const e = foe.active.energies.pop(); foe.discard.push({ type: e });
          play('tap'); log(B, `상대 에너지 1개를 버렸다!`, 'bad'); render(); }
        break;
      }
      case 'coinMoveFoeEnergy': {
        if (coinMoveEnergy && foe.active && foe.active.energies.length && foe.bench.length) {
          const e = foe.active.energies.pop(); foe.bench[0].energies.push(e);
          log(B, `상대 에너지를 벤치로 옮겼다!`, 'good'); render();
        } break;
      }
      case 'noRetreatFoe': if (foe.active) { foe.active.noRetreat = true; log(B, `상대는 다음 차례 후퇴할 수 없다!`, 'good'); } break;
      case 'recharge': u.recharge = 2; log(B, `${u.card.name}은(는) 다음 차례 공격할 수 없다`, 'info'); break;
      case 'rechargeThis': u.blockThis = true; log(B, `「${atk.name}」은 다음 차례 쓸 수 없다`, 'info'); break;
      case 'blockEvolvedNext': if (foe.active && foe.active.card.stage !== 'Basic') { foe.active.__blockNext = true; log(B, `상대 진화 포켓몬은 다음 차례 공격 불가!`, 'good'); } break;
      case 'immuneNext': if (coinImmune) { u.immuneNext = true; log(B, `${u.card.name}은(는) 다음 차례 보호된다!`, 'good'); } break;
      case 'thorns': u.thorn = op.n; log(B, `${u.card.name}에게 닿으면 ${op.n} 반사!`, 'good'); break;
      case 'topCardChoice': {
        const c3 = p.deck.shift();
        if (c3) { p.hand.push({ uid: newUid(), id: c3.id, isNew: true }); log(B, `덱 맨 위 카드(${BY[c3.id].name})를 패로!`, 'good'); play('draw'); }
        render(); break;
      }
      case 'plusPerSelfEnergy': case 'plusIfHealedThisTurn': case 'plusIfKOLastTurn':
      case 'plusIfEnergyType': case 'damagePerSelfEnergy': case 'damagePerHand': break;
      case 'coinMul': case 'coinFail': case 'coinStatus': case 'coinAdd': case 'coinImmune': case 'coinMoveFoeEnergy': break;
    }
  }
  // 반사 데미지
  if (target && target.thorn && base > 0) {
    await damageUnit(B, u, target.thorn, { status: true });
    target.thorn = 0;
    log(B, `${target.card.name}의 반사! ${u.card.name} -${target.thorn || 60}`, 'bad');
  }
  render();
  await sleep(320);
  await resolveKOs(B, 1 - B.cur);
  if (B.over) return;
  B.busy = false;
  endTurnAfterAttack(p);
}

function endTurnAfterAttack(p) {
  const B = window.__B;
  if (B.over) return;
  if (p.active) p.active.immuneNext = p.active.immuneNext;
  B.busy = false;
  setTimeout(() => endTurn(), 380);
}

/* ------------------------------------------------------------ KO / 프라이즈 */
async function resolveKOs(B, ownerIdx) {
  const owner = B.players[ownerIdx], foe = B.players[1 - ownerIdx];
  // 활성
  if (foe.active && unitHp(foe.active) <= 0) {
    const u = foe.active;
    play('ko'); window.VFX.ko(document.querySelector(`.card[data-uid="${u.uid}"]`), u.card.type);
    log(B, `${u.card.name} 기절!`, 'bad');
    await sleep(520);
    // KO 특성
    const ab = abilityOf(u);
    if (ab && ab.ops.some(o => o.t === 'onKoDiscardFoeHand')) {
      const n = ab.ops[0].n;
      for (let i = 0; i < n && owner.hand.length; i++) {
        const k = rnd(owner.hand.length); owner.hand.splice(k, 1);
      }
      log(B, `「${ab.name}」! 상대 패 ${n}장 버리기`, 'good'); play('ability');
    }
    const prize = u.card.ex ? 2 : 1;
    owner.prizesTaken += prize; owner.prizeLeft = Math.max(0, S.settings.prizes - owner.prizesTaken);
    foe.prizeLeft = Math.max(0, S.settings.prizes - owner.prizesTaken);
    log(B, `${owner.name}: 프라이즈 ${prize}장 획득! (${owner.prizesTaken}/${S.settings.prizes})`, 'good');
    foe.discard.push({ id: u.id });
    foe.koLastTurn = false; owner.koLastTurn = false;
    foe.active = null;
    render();
    if (owner.prizesTaken >= S.settings.prizes) { await endGame(ownerIdx, '프라이즈를 모두 가져왔어요!'); return; }
    await promoteIfNeeded(1 - ownerIdx);
    if (B.over) return;
    await resolveKOs(B, ownerIdx); // 벤치 연쇄 기절
    return;
  }
  // 벤치
  for (let i = foe.bench.length - 1; i >= 0; i--) {
    const b = foe.bench[i];
    if (unitHp(b) <= 0) {
      play('ko'); window.VFX.ko(document.querySelector(`.card[data-uid="${b.uid}"]`), b.card.type);
      log(B, `벤치의 ${b.card.name} 기절!`, 'bad');
      await sleep(360);
      foe.bench.splice(i, 1);
      const prize = b.card.ex ? 2 : 1;
      owner.prizesTaken += prize;
      foe.prizeLeft = Math.max(0, S.settings.prizes - owner.prizesTaken);
      log(B, `${owner.name}: 프라이즈 ${prize}장 획득! (${owner.prizesTaken}/${S.settings.prizes})`, 'good');
      if (owner.prizesTaken >= S.settings.prizes) { await endGame(ownerIdx, '프라이즈를 모두 가져왔어요!'); return; }
      render();
    }
  }
}

async function promoteIfNeeded(idx) {
  const B = window.__B;
  const p = B.players[idx];
  if (p.active) return;
  if (!p.bench.length) {
    // 남은 포켓몬 확인
    const anyLeft = p.bench.length > 0;
    if (!anyLeft) { await endGame(1 - idx, `${p.name}의 포켓몬이 모두 쓰러졌어요`); return; }
  }
  if (p.isAI) { p.active = p.bench.shift(); log(B, `AI가 ${p.active.card.name}을(를) 내보냈다`, 'info'); render(); await sleep(300); return; }
  // 사람: 선택
  await new Promise(resolve => {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `<div class="cover"><div class="box">
      <h3>다음 포켓몬을 골라 주세요</h3>
      <div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px;margin-top:10px" id="promoteRow">
        ${p.bench.map((u, i) => `<div data-act="promote" data-i="${i}" style="width:84px">${cardEl(u.card, { size: 'bench', unit: u, holo: true })}<div style="font-size:10px;margin-top:3px">${esc(u.card.name)}</div></div>`).join('')}
      </div></div></div>`;
    window.__promoteResolve = (i) => { p.active = p.bench.splice(i, 1)[0]; p.active.enteredTurn = B.turn; root.innerHTML = ''; render(); play('place'); resolve(); };
  });
  // 진입 특성
  await onEnterAbility(p);
}

async function onEnterAbility(p) {
  const B = window.__B;
  const u = p.active; if (!u) return;
  const ab = abilityOf(u); if (!ab) return;
  if (ab.ops.some(o => o.t === 'gatherFire')) {
    const others = [p.active, ...p.bench].filter(x => x && x !== u);
    let moved = 0;
    others.forEach(o => { for (let i = o.energies.length - 1; i >= 0; i--) if (o.energies[i] === 'Fire') { u.energies.push(o.energies.splice(i, 1)[0]); moved++; } });
    if (moved) { play('ability'); log(B, `「${ab.name}」! 불꽃 에너지 ${moved}개를 모았다`, 'good'); }
  }
  if (ab.ops.some(o => o.t === 'tachyon')) {
    play('ability');
    const targets = [B.players[1 - p.idx].active, ...B.players[1 - p.idx].bench].filter(Boolean);
    if (targets.length) { targets[0].dmg += 20; log(B, `「타키온 비트」! 상대 ${targets[0].card.name}에 데미지 20`, 'good');
      window.VFX.popup(innerWidth / 2, innerHeight * 0.35, '-20', 'info'); }
  }
  render();
}

/* ------------------------------------------------------------ 종료 */
async function endGame(winIdx, reason) {
  const B = window.__B; if (B.over) return;
  B.over = true; B.busy = true;
  const iWon = winIdx === 0;
  S.plays++;
  const reward = iWon ? 40 : 20;
  S.coins += reward; if (iWon) S.wins++;
  save();
  play(iWon ? 'win' : 'lose');
  window.VFX.flash(iWon ? 0.5 : 0.2);
  if (iWon) { for (let i = 0; i < 4; i++) setTimeout(() => window.VFX.burst('spark', innerWidth * (0.2 + Math.random() * 0.6), innerHeight * 0.4, { count: 40, speed: 5 }), i * 220); }
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="cover"><div class="box">
    <div style="font-size:52px">${iWon ? '🏆' : '💪'}</div>
    <h3>${iWon ? '이겼다!' : '아쉽다!'}</h3>
    <p>${esc(reason || '')}<br>코인 +${reward} 🪙</p>
    <div class="row" style="gap:8px">
      <button class="btn ghost" style="flex:1" data-act="rematch">다시 하기</button>
      <button class="btn primary" style="flex:1" data-act="home">홈으로</button>
    </div>
  </div></div>`;
}

/* ------------------------------------------------------------ AI */
async function aiTurn() {
  const B = window.__B; if (!B || B.over || B.busy) return;
  const p = curP(B); if (!p.isAI) return;
  B.busy = true;
  const easy = S.settings.difficulty === 'easy';
  const sleepT = ms => new Promise(r => setTimeout(r, ms));
  render();

  // 1) 진화
  for (const h of p.hand.slice()) {
    const card = BY[h.id];
    if (!card.evolvesFrom) continue;
    const targets = [p.active, ...p.bench].filter(u => u && u.card.name === card.evolvesFromName && u.enteredTurn < B.turn);
    if (targets.length && Math.random() > 0.35) {
      const t = targets[0];
      await evolveUnit(p, t, h, true);
      break;
    }
  }
  // 2) 특성
  if (!p.abilityUsed) {
    const u = p.active;
    const ab = abilityOf(u);
    if (ab && ab.ops.length) {
      const ok = await useAbility(true);
      if (ok) { await sleepT(320); }
    }
  }
  // 3) 에너지
  if (!p.energyUsed && p.active) {
    const d = DECKS.find(x => x.id === p.deckId);
    const type = d.energies[0];
    attachEnergy(p, p.active, type);
    await sleepT(240);
  }
  // 4) 공격
  if (p.active && !p.cantAttack && !p.rechargeBlocked) {
    const opts = p.active.card.attacks.map((a, i) => ({ a, i })).filter(o => canPay(p, p.active, o.a.cost) && !(o.i === 0 && p.active.blockThis));
    if (opts.length) {
      let best = opts[0];
      for (const o of opts) {
        const pv = attackPreview(p.active, foeP(B).active, o.a);
        const bpv = attackPreview(p.active, foeP(B).active, best.a);
        if ((pv.max || 0) > (bpv.max || 0)) best = o;
      }
      if (!easy || Math.random() > 0.12) {
        B.busy = false;
        await useAttack(best.i);
        return;
      }
    }
  }
  if (easy && Math.random() < 0.15 && p.hand.length) {
    const h = pickOne(p.hand);
    if (p.bench.length < 5 && BY[h.id].stage === 'Basic') { p.bench.push(unitOf(h.id)); removeHand(p, h.uid); play('place'); render(); await sleepT(280); }
  }
  B.busy = false;
  await sleepT(260);
  endTurn();
}

/* ------------------------------------------------------------ 진화 / 벤치 */
async function evolveUnit(p, unit, handCard, silent) {
  const B = window.__B;
  const card = BY[handCard.id];
  const prevHp = unit.dmg;
  const evolved = unitOf(card.id);
  evolved.uid = unit.uid; evolved.energies = unit.energies; evolved.dmg = unit.dmg;
  evolved.status = unit.status; evolved.enteredTurn = unit.enteredTurn;
  evolved.evolvedThisTurn = true; evolved.justEvolved = true;
  // 교체
  if (p.active && p.active.uid === unit.uid) p.active = evolved;
  else { const i = p.bench.findIndex(u => u.uid === unit.uid); if (i >= 0) p.bench[i] = evolved; }
  removeHand(p, handCard.uid);
  B.busy = false;
  play('evolve');
  const el = document.querySelector(`.card[data-uid="${unit.uid}"]`);
  if (el) { const r = el.getBoundingClientRect(); window.VFX.burst('spark', r.left + r.width / 2, r.top + r.height / 2, { count: 60, speed: 4, ring: 120, flash: 0.25 }); }
  log(B, `${card.evolvesFromName} → ${card.name} 진화!`, 'good');
  // 진화 특성
  const ab = card.ability;
  if (ab && ab.ops.some(o => o.t === 'rescueLine')) {
    play('ability');
    const basic = p.discard.find(c => c.id && BY[c.id].stage === 'Basic');
    if (basic && p.bench.length < 5) { p.bench.push(unitOf(basic.id)); p.discard.splice(p.discard.indexOf(basic), 1); log(B, `「${ab.name}」! 트래쉬에서 기본 포켓몬 부활`, 'good'); }
  }
  render();
  await sleep(360);
}

function benchFromHand(p, handCard) {
  if (p.bench.length >= 5) { log(window.__B, '벤치가 가득 찼어요!', 'bad'); return; }
  p.bench.push(unitOf(handCard.id));
  removeHand(p, handCard.uid);
  play('place');
  const u = p.bench[p.bench.length - 1]; u.enteredTurn = window.__B.turn;
  log(window.__B, `${BY[handCard.id].name}을(를) 벤치로!`, 'good');
  render();
}

/* ------------------------------------------------------------ 특성 사용 */
async function useAbility(isAI) {
  const B = window.__B; if (!B || B.busy || B.over) return false;
  const p = curP(B), u = p.active;
  const ab = abilityOf(u);
  if (!ab) return false;
  if (p.abilityUsed) { if (!isAI) log(B, '이번 차례엔 이미 특성을 썼어요', 'bad'); return false; }
  const op = ab.ops[0]; if (!op) return false;
  B.busy = true;
  play('ability');
  const el = document.querySelector(`.card[data-uid="${u.uid}"]`);
  if (el) { const r = el.getBoundingClientRect(); window.VFX.burst('psychic', r.left + r.width / 2, r.top + r.height / 2, { count: 40, speed: 3, ring: 110, flash: 0.2 }); }
  log(B, `특성 「${ab.name}」 발동!`, 'ability');
  switch (op.t) {
    case 'armor': log(B, '데미지 -80 준비 완료 (데미지 카운터가 없을 때)', 'good'); break;
    case 'thawRoom': log(B, '상대 HP 40 이하 포켓몬은 기술 사용 불가!', 'good'); break;
    case 'trio': log(B, '멍키 트리오: 무색 에너지 비용 사라짐!', 'good'); break;
    case 'gatherFire': await onEnterAbility(p); break;
    case 'tachyon': {
      const t = foeP(B).active || foeP(B).bench[0];
      if (t) { t.dmg += 20; window.VFX.popup(innerWidth / 2, innerHeight * 0.35, '-20', 'info'); log(B, `상대 ${t.card.name}에 데미지 20`, 'good'); }
      break;
    }
    case 'accelTrashHeal': {
      u.energies.push(op.type); u.dmg = Math.max(0, u.dmg - op.heal); u.healedThisTurn = true;
      play('energy', op.type); play('heal');
      log(B, `트래쉬에서 ${TYPE_KO[op.type]} 에너지 장착 + HP ${op.heal} 회복`, 'good'); break;
    }
    case 'accelByPrizesLeft': {
      if (p.prizeLeft <= op.max) { u.energies.push(op.type); log(B, `트래쉬에서 ${TYPE_KO[op.type]} 에너지 장착!`, 'good'); }
      else log(B, '프라이즈가 4장 이하일 때 쓸 수 있어요', 'bad');
      break;
    }
    case 'bugTurbo': {
      const h = await flipCoins(1, '앞면이면 에너지 4개 충전!');
      if (h === 1) { for (let i = 0; i < 4; i++) u.energies.push('Colorless'); log(B, '기본 에너지 4개 충전!', 'good'); play('energy', 'Colorless'); }
      else { if (u.energies.length) { p.discard.push({ type: u.energies.pop() }); } log(B, '뒷면… 에너지 1개 버림', 'bad'); }
      break;
    }
    case 'hyperBlower': {
      const foe = foeP(B), other = foe.bench[0];
      if (other) {
        foe.bench.shift();
        if (foe.active) foe.bench.push(foe.active);
        foe.active = other; play('place');
        log(B, `상대 포켓몬 교체! ${other.card.name} 등장`, 'good');
        // 이 카드는 트래쉬
        const i = p.active === u ? 'active' : 'bench';
        p.discard.push({ id: u.card.id });
        if (i === 'active') p.active = null; else p.bench.splice(p.bench.indexOf(u), 1);
        render();
        await promoteIfNeeded(p.idx);
      } else log(B, '상대 벤치가 비어 교체할 수 없어요', 'bad');
      break;
    }
    case 'onKoDiscardFoeHand': case 'rescueLine': log(B, '기절 시 발동하는 특성이에요', 'info'); break;
    default: log(B, `${ab.name} 발동`, 'good');
  }
  p.abilityUsed = true;
  B.busy = false;
  render();
  return true;
}

/* ------------------------------------------------------------ 전투 렌더 */
function hpBar(u) {
  const hp = unitHp(u), pct = Math.max(0, hp / u.card.hp * 100);
  const cls = pct <= 25 ? 'danger' : pct <= 50 ? 'warn' : '';
  return `<div class="hpwrap"><div class="hpbar"><i class="${cls}" style="width:${pct}%"></i></div>
    <span class="hptext">${hp}/${u.card.hp}</span></div>`;
}
function statusBadges(u) {
  let out = '';
  if (u.status) out += `<span class="badge ${u.status}">${STATUS_ICON[u.status]} ${STATUS_KO[u.status]}</span>`;
  if (u.recharge > 0) out += `<span class="badge">공격불가</span>`;
  if (u.noRetreat) out += `<span class="badge">후퇴불가</span>`;
  if (u.immuneNext) out += `<span class="badge">보호</span>`;
  if (u.card.ex) out += `<span class="badge" style="background:#5a1a2a;border-color:#ff5566;color:#ffc9d2">ex</span>`;
  return out;
}
function infoPanel(u, side) {
  return `<div class="infopanel">
    <div class="nm">${esc(u.card.name)} ${u.card.ex ? '<span style="color:#ff8a9a">ex</span>' : ''}</div>
    ${hpBar(u)}
    <div class="badges">${statusBadges(u)}<span class="badge">${TYPE_KO[u.card.type]}</span>${u.energies.length ? `<span class="badge">⚡×${u.energies.length}</span>` : ''}</div>
  </div>`;
}

function renderBattle() {
  const B = window.__B;
  if (!B) { go('home'); return; }
  const me = B.players[0], foe = B.players[1];
  const p = curP(B);
  const myTurn = B.cur === 0;
  const hideHand = B.mode === 'pvp' && B.cur === 1;
  const prizesMe = Math.max(0, S.settings.prizes - me.prizesTaken);
  const prizesFoe = Math.max(0, S.settings.prizes - foe.prizesTaken);
  const dots = n => `<span class="prize-dots">${Array.from({ length: S.settings.prizes }).map((_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;

  const benchRow = (pl, size) => `<div class="benchrow">${[0, 1, 2, 3, 4].map(i => {
    const u = pl.bench[i];
    if (!u) return `<div class="benchslot">${i === 0 ? '벤치' : ''}</div>`;
    return cardEl(u.card, { size: 'bench', unit: u, holo: true, uid: u.uid,
      attr: `data-act="tapBench" data-own="${pl.idx}" data-i="${i}"` });
  }).join('')}</div>`;

  const activeBlock = (pl, isFoe) => `<div class="activerow" style="${isFoe ? 'flex-direction:row-reverse' : ''}">
    ${pl.active
      ? cardEl(pl.active.card, { size: 'active', unit: pl.active, holo: true, uid: pl.active.uid,
          attr: `data-act="tapActive" data-own="${pl.idx}"`, canTap: !isFoe })
      : `<div style="width:var(--cw);height:calc(var(--cw)*1.376);border-radius:12px;border:1px dashed #4a3f76;display:grid;place-items:center;color:#5e5289;font-size:11px">기절</div>`}
    ${pl.active ? infoPanel(pl.active) : '<div class="infopanel"><div class="nm">—</div></div>'}
  </div>`;

  const curU = me.active;
  const atkButtons = (curU && myTurn && !B.busy) ? curU.card.attacks.map((a, i) => {
    const payable = canPay(me, curU, a.cost) && !me.cantAttack && !(i === 0 && curU.blockThis) && !thawRoomBlocked(me, curU);
    const pv = attackPreview(curU, foe.active, a);
    const label = pv.coin ? '? 데미지' : `${pv.min}${pv.max !== pv.min ? '-' + pv.max : ''}`;
    return `<button class="btn sm ${payable ? 'primary' : 'ghost'}" data-act="attack" data-i="${i}" ${payable ? '' : 'disabled'} style="flex:1;min-width:0">
      <span style="display:flex;align-items:center;gap:2px;flex-wrap:wrap">${a.cost.map(c => enDot(c)).join('') || '무료'}</span>
      <b style="font-size:12px">${esc(a.name)}</b><span style="font-size:11px;opacity:.9">${label}</span>
    </button>`;
  }).join('') : '';

  const energyBtns = (myTurn && !me.energyUsed) ? energyChoices(me).map(e =>
    `<button class="enbtn" data-act="energyType" data-type="${e}"><span class="en-dot en-${e}">${ENERGY_ICON[e]}</span>${TYPE_KO[e]} 에너지</button>`).join('')
    : `<span class="chip" style="font-size:11px">${me.energyUsed ? '✅ 에너지 사용 완료' : ''}</span>`;

  const hasAbility = curU && abilityOf(curU) && myTurn && !me.abilityUsed;

  const hint = B.busy ? '…' : (myTurn ? (me.energyUsed ? '공격하거나 턴을 넘기세요' : '에너지를 1개 붙일 수 있어요') : '상대 차례…');

  $app.innerHTML = `
  <div class="battle">
    <div class="bhead">
      <button class="iconbtn" data-act="quit">◀</button>
      <span class="pname">${esc(foe.name)} ${dots(prizesMe)}</span>
      <span class="spacer"></span>
      <span class="chip" style="font-size:10.5px">${B.turn}턴</span>
      <span class="pname">${dots(prizesFoe)} ${esc(me.name)}</span>
      <button class="iconbtn" data-act="sound">${S.settings.bgmOn ? '🔊' : '🔇'}</button>
    </div>
    <div class="field" id="field">
      <div class="side foe">
        ${benchRow(foe)}
        ${activeBlock(foe, true)}
      </div>
      <div class="midline">
        <span class="ln"></span>
        <span class="turnbanner ${myTurn ? '' : 'foe'}">${myTurn ? '내 차례' : esc(foe.name) + ' 차례'}</span>
        <span class="ln"></span>
      </div>
      <div class="side me">
        ${activeBlock(me, false)}
        ${benchRow(me)}
      </div>
      <div class="logbox" id="logbox"></div>
    </div>
    <div class="sidepanel hidden" id="sidepanel">
      <div class="section-title">전투 기록</div>
      <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dim);flex:1;overflow:auto">
        ${B.log.slice(-14).reverse().map(l => `<div style="padding:4px 6px;border-radius:7px;background:rgba(255,255,255,.03)">${esc(l.text)}</div>`).join('')}
      </div>
      <button class="btn ghost sm" data-act="quit">배틀 포기</button>
    </div>
    <div class="handwrap">
      <div class="handrow">
        ${me.hand.map(h => {
          const c = BY[h.id];
          return `<div data-act="handCard" data-uid="${h.uid}" style="position:relative">${cardEl(c, { size: 'hand', holo: true, cls: h.isNew ? 'newdeal' : '' })}</div>`;
        }).join('') || '<div style="color:#5e5289;font-size:12px;padding:14px">패가 비었어요</div>'}
      </div>
    </div>
    <div class="controls">
      <div class="energybar">${energyBtns}</div>
      <div class="hintline" id="hint">${hint}</div>
      <div class="btnrow">${atkButtons || `<button class="btn ghost" disabled style="flex:1">공격 없음</button>`}</div>
      <div class="btnrow">
        <button class="btn ghost sm" data-act="ability" ${hasAbility ? '' : 'disabled'}>✨ 특성</button>
        <button class="btn ghost sm" data-act="retreat" ${(myTurn && curU && !me.cantRetreat) ? '' : 'disabled'}>🔄 후퇴</button>
        <button class="btn sm" data-act="endTurn" ${myTurn && !B.busy ? '' : 'disabled'}>턴 넘기기 ▶</button>
      </div>
    </div>
  </div>`;
  const sp = document.getElementById('sidepanel');
  if (sp && window.innerWidth >= 700) sp.classList.remove('hidden');
  bindTilt();
}

function bindTilt() {
  document.querySelectorAll('.card.holo').forEach(el => {
    if (el.__tilt) return;
    el.__tilt = true;
    el.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(600px) rotateY(${px * 14}deg) rotateX(${-py * 14}deg) scale(1.03)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/* ------------------------------------------------------------ 액션 시트 */
function sheet(title, items, sub) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="cover" data-act="closeSheet"><div class="box" onclick="event.stopPropagation()">
    <h3 style="font-size:16px">${esc(title)}</h3>
    ${sub ? `<p style="margin-bottom:10px">${esc(sub)}</p>` : '<div style="height:8px"></div>'}
    <div style="display:flex;flex-direction:column;gap:8px">
      ${items.map((it, i) => `<button class="btn ${it.kind || 'ghost'}" data-act="sheetItem" data-i="${i}" ${it.disabled ? 'disabled' : ''} style="justify-content:flex-start">${it.label}</button>`).join('')}
      <button class="btn ghost" data-act="closeSheet" style="opacity:.7">닫기</button>
    </div></div></div>`;
  window.__sheetItems = items;
}
function confirmBox(title, text, okLabel, cancelLabel) {
  return new Promise(resolve => {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `<div class="cover"><div class="box">
      <h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="row"><button class="btn ghost" style="flex:1" data-act="confirmNo">${esc(cancelLabel || '취소')}</button>
      <button class="btn primary" style="flex:1" data-act="confirmYes">${esc(okLabel || '확인')}</button></div></div></div>`;
    window.__confirmYes = () => { root.innerHTML = ''; resolve(true); };
    window.__confirmNo = () => { root.innerHTML = ''; resolve(false); };
  });
}
function toast(msg) {
  const d = document.createElement('div');
  d.className = 'logline';
  d.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:95;opacity:1;font-size:12px;padding:9px 14px;background:rgba(20,16,36,.95);border:1px solid #4b3d86;border-radius:14px;max-width:86vw;text-align:center';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = 0; setTimeout(() => d.remove(), 400); }, 2000);
}

/* ------------------------------------------------------------ 카드 상세 */
function cardDetailHtml(c) {
  const atk = c.attacks.map(a => `<div class="atkline">
      <div><span class="ac">${a.cost.map(x => enDot(x)).join('') || '<span class="badge">무료</span>'}</span>
      <span class="an">${esc(a.name)}</span><span class="ad">${a.dmgText || ''}</span></div>
      ${a.text ? `<div class="tx">${esc(a.text)}</div>` : ''}
    </div>`).join('');
  return `<div class="bigcard">${cardEl(c, { size: 'active', holo: true })}</div>
    <div class="detail">
      <div><b>${esc(c.name)}</b> · ${TYPE_KO[c.type]} · ${c.stage === 'Basic' ? '기본' : c.stage === 'Stage1' ? '1진화' : '2진화'} · HP ${c.hp}
      ${c.evolvesFromName ? ` · <span style="color:#9ad">${esc(c.evolvesFromName)}에서 진화</span>` : ''}</div>
      <div style="margin-top:4px">후퇴 ${c.retreat} · 약점 ${c.weak ? TYPE_KO[c.weak.type] + ' ×2' : '없음'} · 저항 ${c.resist ? TYPE_KO[c.resist.type] + ' -30' : '없음'}</div>
      ${c.ability ? `<div class="atkline" style="border-color:#6b5ca5;background:rgba(180,107,255,.10)">
        <div><span class="badge" style="background:#4a2a7a;border-color:#b46bff">특성</span> <span class="an">${esc(c.ability.name)}</span></div>
        <div class="tx">${esc(c.ability.text)}</div></div>` : ''}
      ${atk}
      <div style="margin-top:8px;font-size:11px;color:#6f639b">${esc(c.set)} · ${esc(c.id)} · 이미지: 포켓몬코리아</div>
    </div>`;
}

/* ------------------------------------------------------------ 팩 */
function renderPack() {
  const cost = 30;
  $app.innerHTML = `${topbar('카드팩 뽑기')}
  <div class="packwrap">
    <div class="chap" style="text-align:center">
      <div class="chip coins" style="font-size:14px;padding:7px 14px">🪙 ${S.coins} 코인</div>
      <p style="color:var(--dim);font-size:12px;margin:10px 0 0">팩 1개 = ${cost} 코인 · 카드 5장<br>배틀에서 이기면 40코인!${S.coins < cost ? '<br><b style="color:#ffb4b4">코인이 부족해요 — 배틀에서 모아 보세요</b>' : ''}</p>
    </div>
    <div class="pack" id="packEl" data-act="openPack">
      <div class="foil"></div><div class="pball"></div><div class="plabel">POKÉMON TCG</div>
    </div>
    <div style="font-size:11.5px;color:var(--dim)">👆 팩을 눌러서 뜯어요</div>
    <div id="packResult" class="packcards" style="margin-top:8px"></div>
  </div>`;
}

function pickPackCards() {
  // rarity weight → 희귀 1장 보장
  const all = POOL.slice();
  const byW = w => all.filter(c => c.rarityW === w);
  const out = [];
  const rarePool = all.filter(c => c.rarityW >= 3);
  if (rarePool.length) out.push(pickOne(rarePool));
  while (out.length < 5) {
    const c = pickOne(all);
    if (!out.find(x => x.id === c.id)) out.push(c);
  }
  return shuffle(out);
}

async function openPack() {
  const cost = 30;
  if (S.coins < cost) { toast('코인이 부족해요! 배틀에서 코인을 모아 보세요.'); play('lose'); return; }
  S.coins -= cost; save();
  play('packRip');
  const pack = document.getElementById('packEl');
  if (pack) { pack.classList.add('opening'); setTimeout(() => pack.classList.add('spent'), 480); }
  window.VFX.packBurst(pack);
  await sleep(420);
  const cards = pickPackCards();
  S.packs++;
  const res = document.getElementById('packResult');
  if (!res) return;
  res.innerHTML = cards.map((c, i) => `<div class="reveal facedown" data-i="${i}" style="animation-delay:${i * 0.12}s" data-act="revealCard" data-id="${c.id}"></div>`).join('');
  const coinChip = document.querySelector('.topbar .coins');
  if (coinChip) coinChip.textContent = '🪙 ' + S.coins;
  // 순차 공개
  for (let i = 0; i < cards.length; i++) {
    await sleep(300);
    const slot = res.querySelector(`.reveal[data-i="${i}"]`);
    if (!slot) continue;
    const c = cards[i];
    const isNew = !S.dex[c.id];
    S.dex[c.id] = 1; save();
    slot.classList.remove('facedown');
    if (c.rarityW >= 4) slot.classList.add('rare');
    slot.innerHTML = `<img src="${c.image}" alt="${esc(c.name)}">${isNew ? '<span class="newtag">NEW</span>' : ''}`;
    play(c.rarityW >= 4 ? 'fanfare' : 'flipCard');
    const r = slot.getBoundingClientRect();
    window.VFX.burst(c.rarityW >= 4 ? 'spark' : 'colorless', r.left + r.width / 2, r.top + r.height / 2, { count: c.rarityW >= 4 ? 50 : 18, ring: c.rarityW >= 4 ? 120 : 50, flash: c.rarityW >= 4 ? 0.3 : 0 });
  }
  await sleep(200);
  const tbl = document.getElementById('packResult');
  if (tbl) tbl.insertAdjacentHTML('afterend', `<div class="row" style="margin-top:6px">
      <button class="btn ghost sm" data-act="goDex">📖 도감 보기</button>
      <button class="btn primary sm" data-act="openPackAgain">🎁 한 팩 더 (30🪙)</button>
    </div>`);
}

/* ------------------------------------------------------------ 도감 */
function renderDex() {
  const types = ['all', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Colorless'];
  const list = POOL.filter(c => S.dexFilter === 'all' || c.type === S.dexFilter);
  const got = POOL.filter(c => S.dex[c.id]).length;
  $app.innerHTML = `${topbar('내 도감')}
  <div style="padding:10px 12px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <span class="chip">📖 ${got} / ${POOL.length}장</span>
    <div style="flex:1;height:8px;background:#2a2344;border-radius:5px;overflow:hidden;min-width:100px">
      <i style="display:block;height:100%;width:${got / POOL.length * 100}%;background:linear-gradient(90deg,#ffd23d,#ff8a3d)"></i>
    </div>
  </div>
  <div class="filterbar">${types.map(t => `<button class="${S.dexFilter === t ? 'on' : ''}" data-act="dexFilter" data-t="${t}">${t === 'all' ? '전체' : TYPE_KO[t]}</button>`).join('')}</div>
  <div class="dexgrid">
    ${list.map(c => `<div class="dexitem ${S.dex[c.id] ? '' : 'locked'}" data-act="dexCard" data-id="${c.id}">
      <img src="${c.image}" alt="${esc(c.name)}" loading="lazy">
      <div class="dm">${S.dex[c.id] ? esc(c.name) : '???'}</div>
    </div>`).join('')}
  </div>`;
}

/* ------------------------------------------------------------ 설정 */
function renderSettings() {
  $app.innerHTML = `${topbar('설정')}
  <div class="decks">
    <div class="deckcard" style="flex-direction:column;align-items:stretch;gap:10px">
      <div class="dtitle">사운드</div>
      <div class="row"><span style="font-size:12px;width:74px">효과음</span>
        <input type="range" min="0" max="1" step="0.05" value="${S.settings.sfx}" data-act="volSfx" style="flex:1"></div>
      <div class="row"><span style="font-size:12px;width:74px">배경음</span>
        <input type="range" min="0" max="1" step="0.05" value="${S.settings.bgm}" data-act="volBgm" style="flex:1"></div>
      <div class="row">
        <button class="btn sm ${S.settings.bgmOn ? 'primary' : 'ghost'}" data-act="toggleBgm">${S.settings.bgmOn ? '🎵 BGM 켜짐' : '🔇 BGM 꺼짐'}</button>
        <button class="btn sm ghost" data-act="testSfx">🔊 소리 테스트</button>
      </div>
    </div>
    <div class="deckcard" style="flex-direction:column;align-items:stretch;gap:10px">
      <div class="dtitle">보호자 · 아이 설정</div>
      <div class="row"><span style="font-size:12px;flex:1">가족 PIN 잠금 (${PIN_CODE})</span>
        <button class="btn sm ${S.settings.pin ? 'primary' : 'ghost'}" data-act="togglePin">${S.settings.pin ? '잠금' : '열림'}</button></div>
      <div class="row"><span style="font-size:12px;flex:1">게스트 모드 (기록 안 남김)</span>
        <button class="btn sm ${S.settings.guest ? 'primary' : 'ghost'}" data-act="toggleGuest">${S.settings.guest ? '게스트' : '내 계정'}</button></div>
      <div class="row"><span style="font-size:12px;flex:1">도감 초기화</span>
        <button class="btn sm ghost" data-act="resetDex">초기화</button></div>
    </div>
    <div class="deckcard" style="flex-direction:column;align-items:stretch;gap:8px">
      <div class="dtitle">앱 정보</div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.7">
        카드 데이터: TCGdex 한국어 API (api.tcgdex.net/v2/ko)<br>
        카드 이미지: 포켓몬코리아 공식 카드 DB<br>
        카드 ${POOL.length}종 · 세트 ${[...new Set(POOL.map(p => p.set))].join(', ')}<br>
        포켓몬 카드 게임은 (주)포켓몬코리아의 상표입니다. 이 앱은 가족용 비공식 팬 게임입니다.
      </div>
      <button class="btn sm ghost" data-act="install">📲 앱 설치</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------ 설치 (PWA) */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
async function doInstall() {
  play('tap');
  if (isStandalone()) { toast('이미 앱으로 설치되어 있어요! 🎉'); return; }
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const res = await deferredPrompt.userChoice;
    deferredPrompt = null;
    toast(res.outcome === 'accepted' ? '앱을 설치했어요! 홈 화면을 확인해 보세요 🎉' : '설치를 취소했어요');
    return;
  }
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSamsung = /SamsungBrowser/.test(ua);
  const guide = isIOS
    ? 'Safari 하단의 공유 버튼(⬆️) → "홈 화면에 추가"를 눌러 주세요.'
    : isSamsung
      ? '삼성 인터넷 하단 메뉴(☰) → "홈 화면에 추가"를 눌러 주세요.'
      : '크롬 우측 상단 ⋮ → "앱 설치" 또는 "홈 화면에 추가"를 눌러 주세요.';
  toast('📲 ' + guide);
}

/* ------------------------------------------------------------ 이벤트 */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const B = window.__B;
  switch (act) {
    case 'home': play('tap'); window.__B = null; go('home'); break;
    case 'sound': {
      S.settings.bgmOn = !S.settings.bgmOn; save(); applyAudioSettings(); play('tap');
      if (B) renderBattle(); else render(); break;
    }
    case 'install': doInstall(); break;
    case 'pin': pinInput(t.dataset.v); break;
    case 'guestPin': S.settings.guest = true; S.unlocked = true; play('tap'); go('home'); break;
    case 'goPack': play('tap'); go('pack'); break;
    case 'openPack': openPack(); break;
    case 'openPackAgain': openPack(); break;
    case 'goDex': play('tap'); go('dex'); break;
    case 'goSettings': play('tap'); go('settings'); break;
    case 'toDecks': play('tap'); S.pendingMode = t.dataset.mode; if (!S.deckId) S.deckId = 'fire'; go('decks'); break;
    case 'pickDeck': S.deckId = t.dataset.deck; play('tap'); renderDecks(); break;
    case 'setPrizes': S.settings.prizes = parseInt(t.dataset.v, 10); save(); play('tap'); renderDecks(); break;
    case 'setDiff': S.settings.difficulty = t.dataset.v; save(); play('tap'); renderDecks(); break;
    case 'startBattle': play('tap'); startBattle(S.pendingMode || 'ai', S.deckId || 'fire'); break;
    case 'rematch': { const m = S.battleMeta || { mode: 'ai', deckId: 'fire' }; document.getElementById('modalRoot').innerHTML = ''; startBattle(m.mode, m.deckId); break; }
    case 'quit': {
      const yes = await confirmBox('배틀을 그만둘까요?', '지금 나가면 이 판은 기록되지 않아요.', '나가기', '계속하기');
      if (yes) { window.__B = null; go('home'); }
      break;
    }
    case 'handCard': {
      if (!B || B.busy || B.cur !== 0) break;
      const h = B.players[0].hand.find(x => x.uid === t.dataset.uid);
      if (!h) break;
      const c = BY[h.id];
      const items = [];
      if (c.stage === 'Basic') items.push({ label: `🃏 ${esc(c.name)} 벤치로 내보내기`, act: 'bench', kind: 'ghost' });
      const evo = B.players[0].active && B.players[0].active.card.name === c.evolvesFromName;
      const evoB = B.players[0].bench.find(u => u.card.name === c.evolvesFromName);
      if (c.evolvesFromName && (evo || evoB)) items.push({ label: `✨ ${esc(c.name)}(으)로 진화!`, act: 'evolve', kind: 'primary' });
      items.push({ label: '🔍 카드 자세히 보기', act: 'detail', kind: 'ghost' });
      play('tap');
      sheet(c.name, items);
      window.__handUid = h.uid;
      break;
    }
    case 'sheetItem': {
      const items = window.__sheetItems || [];
      const it = items[parseInt(t.dataset.i, 10)];
      document.getElementById('modalRoot').innerHTML = '';
      if (!it || !B) break;
      const h = B.players[0].hand.find(x => x.uid === window.__handUid);
      if (!h) break;
      const c = BY[h.id];
      if (it.act === 'bench') benchFromHand(B.players[0], h);
      else if (it.act === 'detail') showDetail(c.id);
      else if (it.act === 'evolve') {
        let target = B.players[0].active && B.players[0].active.card.name === c.evolvesFromName ? B.players[0].active : null;
        if (!target) target = B.players[0].bench.find(u => u.card.name === c.evolvesFromName);
        if (target) evolveUnit(B.players[0], target, h);
      }
      break;
    }
    case 'dexFilter': S.dexFilter = t.dataset.t; play('tap'); renderDex(); break;
    case 'dexCard': showDetail(t.dataset.id); break;
    case 'energyType': {
      if (!B || B.busy) break;
      window.__energyType = t.dataset.type;
      play('tap');
      document.querySelectorAll('.enbtn').forEach(b => b.classList.remove('sel'));
      t.classList.add('sel');
      const hint = document.getElementById('hint');
      if (hint) hint.textContent = `${TYPE_KO[t.dataset.type]} 에너지를 붙일 포켓몬을 눌러 주세요`;
      break;
    }
    case 'tapActive': {
      if (!B || B.busy) break;
      const own = parseInt(t.dataset.own, 10);
      if (own !== 0) break;
      if (window.__energyType && !B.players[0].energyUsed && B.players[0].active) {
        attachEnergy(B.players[0], B.players[0].active, window.__energyType);
        window.__energyType = null;
      } else showDetail(B.players[0].active.card.id);
      break;
    }
    case 'tapBench': {
      if (!B || B.busy) break;
      const own = parseInt(t.dataset.own, 10), i = parseInt(t.dataset.i, 10);
      if (own !== 0) break;
      const u = B.players[0].bench[i];
      if (!u) break;
      if (window.__energyType && !B.players[0].energyUsed) { attachEnergy(B.players[0], u, window.__energyType); window.__energyType = null; }
      else showDetail(u.card.id);
      break;
    }
    case 'attack': {
      const i = parseInt(t.dataset.i, 10);
      if (!B || B.busy) break;
      play('tap');
      useAttack(i); break;
    }
    case 'ability': if (B) useAbility(false); break;
    case 'retreat': {
      if (!B || B.busy) break;
      const p = B.players[0], u = p.active;
      if (!u || !p.bench.length) { toast('벤치에 포켓몬이 없어요'); break; }
      if (p.cantRetreat) { toast('이번 차례엔 후퇴할 수 없어요'); break; }
      if (u.noRetreat) { toast('후퇴할 수 없는 상태예요'); break; }
      const cost = u.card.retreat;
      if (u.energies.length < cost) { toast(`후퇴에는 에너지 ${cost}개가 필요해요`); break; }
      for (let i = 0; i < cost; i++) p.discard.push({ type: u.energies.pop() });
      const idx = await chooseBench(p);
      if (idx < 0) { break; }
      const next = p.bench.splice(idx, 1)[0];
      p.bench.push(u);
      p.active = next;
      play('place'); log(B, `후퇴! ${next.card.name} 등장`, 'info');
      render();
      break;
    }
    case 'endTurn': if (B && B.cur === 0) { play('tap'); endTurn(); } break;
    case 'promote': if (window.__promoteResolve) window.__promoteResolve(parseInt(t.dataset.i, 10)); break;
    case 'passGo': if (window.__passNext) window.__passNext(); break;
    case 'confirmYes': if (window.__confirmYes) window.__confirmYes(); break;
    case 'confirmNo': if (window.__confirmNo) window.__confirmNo(); break;
    case 'closeSheet': { const r = document.getElementById('modalRoot'); if (r) r.innerHTML = ''; break; }
    case 'revealCard': showDetail(t.dataset.id); break;
    case 'toggleBgm': S.settings.bgmOn = !S.settings.bgmOn; save(); applyAudioSettings(); play('tap'); renderSettings(); break;
    case 'togglePin': S.settings.pin = !S.settings.pin; save(); play('tap'); renderSettings(); break;
    case 'toggleGuest': S.settings.guest = !S.settings.guest; save(); play('tap'); renderSettings(); break;
    case 'resetDex': {
      const yes = await confirmBox('도감을 초기화할까요?', '모은 카드 기록이 모두 사라져요.', '초기화', '그대로');
      if (yes) { S.dex = {}; save(); renderSettings(); }
      break;
    }
    case 'testSfx': play('shuffle'); setTimeout(() => play('attack', 'Fire', 100), 500); setTimeout(() => play('coinLand', true), 1100); setTimeout(() => play('fanfare'), 1500); break;
  }
});
document.addEventListener('input', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.dataset.act === 'volSfx') { S.settings.sfx = parseFloat(t.value); save(); sfx().setSfx(S.settings.sfx); play('tap'); }
  if (t.dataset.act === 'volBgm') { S.settings.bgm = parseFloat(t.value); save(); sfx().setBgm(S.settings.bgm); }
});

function chooseBench(p) {
  return new Promise(resolve => {
    if (p.bench.length === 1) { resolve(0); return; }
    const root = document.getElementById('modalRoot');
    root.innerHTML = `<div class="cover"><div class="box"><h3>누구와 교체할까요?</h3>
      <div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px;margin-top:8px">
      ${p.bench.map((u, i) => `<div data-act="chooseBench" data-i="${i}" style="width:80px">${cardEl(u.card, { size: 'bench', unit: u, holo: true })}<div style="font-size:10px">${esc(u.card.name)}</div></div>`).join('')}
      </div><button class="btn ghost sm" data-act="chooseBench" data-i="-1" style="margin-top:10px">취소</button></div></div>`;
    window.__chooseBench = i => { root.innerHTML = ''; resolve(i); };
  });
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act="chooseBench"]');
  if (t && window.__chooseBench) window.__chooseBench(parseInt(t.dataset.i, 10));
});

function showDetail(id) {
  const c = BY[id]; if (!c) return;
  play('flipCard');
  const root = document.getElementById('modalRoot') || (() => { const d = document.createElement('div'); d.id = 'modalRoot'; document.body.appendChild(d); return d; })();
  root.innerHTML = `<div class="cover" data-act="closeSheet"><div class="box" onclick="event.stopPropagation()" style="max-height:88vh;overflow:auto">
    ${cardDetailHtml(c)}
    <button class="btn ghost" data-act="closeSheet" style="width:100%;margin-top:10px">닫기</button>
  </div></div>`;
}

/* ------------------------------------------------------------ 시작 */
function boot() {
  if (!document.getElementById('modalRoot')) { const d = document.createElement('div'); d.id = 'modalRoot'; document.body.appendChild(d); }
  window.VFX.mount();
  applyAudioSettings();
  document.addEventListener('pointerdown', () => sfx().unlock(), { once: true });
  render();
  // data 검증
  if (!POOL || !POOL.length) { $app.innerHTML = '<div class="home"><h2>카드 데이터를 불러오지 못했어요</h2></div>'; }
}
boot();
window.__DEBUG = { S, startBattle, openPack, useAttack, useAbility, attachEnergy, endTurn, render,
  unitOf, BY, newPlayer, DECKS, addEnergy(u, types) { types.forEach(t => u.energies.push(t)); } };
})();
