/* cloud.js — ☁️ 가족 클라우드 동기화 (Supabase `family_sync` · 가족 코드 0623)
   ─ 포켓몬 배틀 월드(/pokemon/)와 **같은 클라우드·같은 코인 지갑**을 쓴다.
   ─ 이 앱이 쓰는 키는 딱 두 개. 나머지 키(도감·마을·판수…)는 건드리지 않는다.
       pkm.coins.v1  🪙 코인 지갑 { arin·jian·guest }  ← 배틀 월드와 함께 씀
       pkm.cards.v1  🃏 이 앱의 카드·티켓·최애·별가루·트로피·교환함
                        + 💾 나만의 덱 3칸(프로필별 decks · decksAt)
                        + ⚙️ 타이밍 바 속도(루트 settings · 아빠 PIN)
     ─ 덱은 프로필의 카드 기록과 따로 비교한다(decksAt). 그래서 덱을 고쳐도
       그 프로필의 카드·티켓이 낡은 기록으로 덮이지 않는다. 덱·속도의 '바뀐 시각'은
       기기 저장소 pkc_sync_meta_v1 에도 적어 두어 다음 비교에 쓴다.
   ─ 안전 규칙
       1) 올릴 때는 **서버 행을 먼저 읽어** 우리 키만 바꿔 쓴다 → 남의 키를 지우지 않는다
       2) 코인은 프로필마다 '마지막으로 바뀐 시각(at)'이 더 최근인 쪽을 쓴다
          → 게임으로 번 +10도, 카드팩으로 쓴 -50도 서로 지워지지 않는다
       3) 카드·티켓·별가루는 프로필별 at 이 더 최근인 기록을 쓰고,
          트로피(뱃지·칭호)는 합집합 — 한 번 딴 트로피는 사라지지 않는다
       4) 실패(오프라인·키 오류)해도 앱은 그대로 동작한다 (로컬 저장 우선)
*/
(function () {
  'use strict';
  const P = window.PKC;
  const DEF = {
    url: 'https://hiruybkapzuhjrzjoyik.supabase.co',
    key: 'sb_publishable_e5JJbvCPDhY91uXaUEVNVA_8Byv_gI8',
    table: 'family_sync',
    code: '0623'
  };
  const K_CODE = 'pkc.cloud.code';
  const K_COINS = 'pkm.coins.v1';
  const K_CARDS = 'pkm.cards.v1';
  const IDS = ['arin', 'jian', 'guest'];

  const S = { state: 'idle', msg: '', lastAt: null, code: '' };
  let applying = false;
  let pushing = false;
  let pulling = false;
  let restoring = false;
  let tPush = null;
  let listeners = [];
  /* 🔇 배경 확인(20초) 상태
       lastStamp  — 마지막으로 본 서버 행의 updated_at (바뀌었는지 싸게 확인하는 기준)
       quickCount — 가벼운 확인 횟수 (가끔은 본문까지 확인해 안전하게)
       muteTouch  — 적용한 값을 저장할 때 '내가 바꾼 것'처럼 되쏘지 않게 */
  let lastStamp = '';
  let quickCount = 0;
  let muteTouch = false;

  function cfg() {
    let code = DEF.code;
    try { code = localStorage.getItem(K_CODE) || DEF.code; } catch (e) { /* */ }
    return { url: DEF.url, key: DEF.key, table: DEF.table, code: code };
  }
  function setCode(code) {
    try { localStorage.setItem(K_CODE, String(code || DEF.code)); } catch (e) { /* */ }
  }

  function emit() {
    for (const fn of listeners) { try { fn(S); } catch (e) { /* */ } }
    try { document.dispatchEvent(new CustomEvent('pkccloud:state', { detail: S })); } catch (e) { /* */ }
  }
  function setState(st, msg) { S.state = st; S.msg = msg || ''; emit(); }
  function onState(fn) { if (typeof fn === 'function') listeners.push(fn); }

  /* ---------- 서버 ---------- */
  function api(path) {
    const c = cfg();
    return c.url + '/rest/v1/' + c.table + path;
  }
  function headers(extra) {
    const c = cfg();
    const h = {
      'apikey': c.key,
      'Authorization': 'Bearer ' + c.key,
      'Content-Type': 'application/json'
    };
    return Object.assign(h, extra || {});
  }
  function getRow() {
    const c = cfg();
    const url = api('?code=eq.' + encodeURIComponent(c.code) + '&select=code,data,updated_at');
    return fetch(url, { headers: headers(), cache: 'no-store' }).then(res => {
      if (!res.ok) return res.text().then(t => { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return res.json().then(arr => (Array.isArray(arr) && arr.length ? arr[0] : null));
    });
  }
  /* updated_at 한 칸(48바이트)만 읽어 행이 바뀌었는지 본다.
     본문(data · 17KB)을 20초마다 받지 않으려는 것. */
  function getStamp() {
    const c = cfg();
    const url = api('?code=eq.' + encodeURIComponent(c.code) + '&select=updated_at');
    return fetch(url, { headers: headers(), cache: 'no-store' }).then(res => {
      if (!res.ok) return res.text().then(t => { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return res.json().then(arr => (Array.isArray(arr) && arr.length && arr[0]) ? String(arr[0].updated_at || '') : '');
    });
  }
  /* 서버가 주는 시각 표기(2026-11-18T09:09:17.762+00:00)와 우리가 쓰는 ISO(Z)를 같은 값으로 맞춘다 */
  function stampKey(v) {
    const s = String(v || '');
    if (!s) return '';
    const t = Date.parse(s);
    return isFinite(t) ? String(t) : s;
  }
  function putRow(payload, keepalive) {
    const url = api('?on_conflict=code');
    return fetch(url, {
      method: 'POST',
      headers: headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([payload]),
      cache: 'no-store',
      keepalive: !!keepalive
    }).then(res => {
      if (!res.ok) return res.text().then(t => { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return true;
    });
  }
  function errMsg(e) {
    const s = String((e && e.message) || e || '');
    if (/HTTP 401|Invalid API key/i.test(s)) return '키 오류 (401)';
    if (/HTTP 40[34]/.test(s)) return '권한 오류';
    if (/Failed to fetch|NetworkError|load failed|Network request failed/i.test(s)) return '인터넷 연결 없음';
    return '동기화 실패';
  }

  /* ---------- 이 기기의 카드 기록 → 클라우드 모양 ---------- */
  function n(v) { const x = Number(v); return isFinite(x) ? x : 0; }
  function dev() { return window.PKCDeckSync || null; }
  function clampSpeed(v) { const x = Number(v); return isFinite(x) ? Math.min(2, Math.max(0.5, Math.round(x * 100) / 100)) : null; }
  function normDecks(arr) {
    return [0, 1, 2].map(i => (Array.isArray(arr) && Array.isArray(arr[i]) && arr[i].length) ? arr[i].slice(0, 5) : null);
  }
  function decksHas(arr) { return Array.isArray(arr) && arr.some(x => Array.isArray(x) && x.length); }
  function snapCards() {
    const out = { v: 1, at: {}, p: {} };
    const DS = dev();
    IDS.forEach(id => {
      const pr = P.prof(id);
      if (!pr) return;
      out.at[id] = n(pr.at);
      out.p[id] = {
        name: pr.name || '', emoji: pr.emoji || '',
        cards: pr.cards || {}, src: pr.src || {},
        fav: (pr.fav || []).filter(x => x && pr.cards && pr.cards[x]),
        tickets: { normal: n((pr.tickets || {}).normal), high: n((pr.tickets || {}).high) },
        stardust: n(pr.stardust), badges: pr.badges || [], titles: pr.titles || [],
        deck: pr.deck || [], wins: n(pr.wins), losses: n(pr.losses),
        trades: pr.trades || []
      };
      /* 💾 나만의 덱 3칸 — 이 프로필의 칸과 바뀐 시각 */
      if (DS) {
        const slots = DS.slots(id);
        const at = n(DS.decksAt(id));
        if (at > 0 || decksHas(slots)) {
          out.p[id].decks = normDecks(slots);
          out.p[id].decksAt = at;
        }
      }
      /* ⏪ 백업에서 되돌린 시각 — 있으면 다른 기기의 옛 카드가 되살아나지 않는다 */
      if (n(pr.resetAt) > 0) out.p[id].resetAt = n(pr.resetAt);
    });
    /* ⚙️ 기기 설정 — 지금은 아빠가 정한 타이밍 바 속도 하나 (폰에서 바꾸면 태블릿도 같은 속도) */
    if (DS) {
      const at = n(DS.barSpeedAt());
      const v = clampSpeed(DS.barSpeed());
      if (at > 0 && v != null) out.settings = { barSpeed: v, at: at };
    }
    return out;
  }
  function snapCoins() {
    const out = { v: 1, coins: {}, at: {} };
    IDS.forEach(id => {
      const pr = P.prof(id);
      if (!pr) return;
      out.coins[id] = Math.max(0, Math.round(n(pr.coins)));
      out.at[id] = n(pr.coinsAt);
    });
    return out;
  }

  /* ---------- 합치기 ---------- */
  function union(a, b) {
    const out = (Array.isArray(a) ? a.slice() : []);
    (Array.isArray(b) ? b : []).forEach(v => { if (out.indexOf(v) < 0) out.push(v); });
    return out;
  }
  function mergeCoins(remote, local) {
    const r = remote || {}, l = local || {};
    const out = { v: 1, coins: {}, at: {} };
    IDS.forEach(id => {
      const rv = (r.coins || {})[id], lv = (l.coins || {})[id];
      const rt = n((r.at || {})[id]), lt = n((l.at || {})[id]);
      if (rv == null && lv == null) return;
      let v, t;
      if (lv == null) { v = rv; t = rt; }
      else if (rv == null) { v = lv; t = lt; }
      else if (lt > rt) { v = lv; t = lt; }
      else if (rt > lt) { v = rv; t = rt; }
      else { v = Math.max(n(rv), n(lv)); t = rt; }
      out.coins[id] = Math.max(0, Math.round(n(v)));
      if (t > 0) out.at[id] = t;
    });
    return out;
  }
  /* 💾 덱 3칸 — 어느 쪽이 최신인가
     ① 양쪽 다 시각이 있으면 늦은 쪽
     ② 한쪽만 시각이 있으면 그쪽 (이번 업그레이드 전에 저장한 덱은 시각이 없다)
     ③ 둘 다 시각이 없으면 비어 있지 않은 쪽 — 예전 기기의 덱이 조용히 지워지지 않게
     칸을 하나 비우는 것도 '바꿈'이라 시각이 붙으므로, 지운 덱도 그대로 전해진다. */
  function pickDecks(rp, lp) {
    const rd = Array.isArray(rp.decks) ? rp.decks : null;
    const ld = Array.isArray(lp.decks) ? lp.decks : null;
    if (!rd && !ld) return null;
    const rT = n(rp.decksAt), lT = n(lp.decksAt);
    let pick, at;
    if (!rd) { pick = ld; at = lT; }
    else if (!ld) { pick = rd; at = rT; }
    else if (rT > 0 && lT > 0) { if (lT >= rT) { pick = ld; at = lT; } else { pick = rd; at = rT; } }
    else if (lT > 0) { pick = ld; at = lT; }
    else if (rT > 0) { pick = rd; at = rT; }
    else {
      const rEmpty = !decksHas(rd), lEmpty = !decksHas(ld);
      if (rEmpty && !lEmpty) { pick = ld; at = 0; }
      else { pick = rd; at = 0; }
    }
    return { decks: normDecks(pick), at: at };
  }
  /* ⚙️ 기기 설정(타이밍 바 속도) — 루트에 하나뿐, at 이 더 최근인 쪽 */
  function mergeSettings(rs, ls) {
    const r = (rs && typeof rs === 'object') ? rs : null;
    const l = (ls && typeof ls === 'object') ? ls : null;
    if (!r && !l) return null;
    const rt = n(r && r.at), lt = n(l && l.at);
    const at = Math.max(rt, lt);
    if (at <= 0) return null;                    /* 시각이 없는 설정은 옮기지 않는다 */
    let pick;
    if (!r) pick = l;
    else if (!l) pick = r;
    else pick = (lt >= rt) ? l : r;              /* 같은 시각이면 이 기기(로컬) 우선 */
    const v = clampSpeed(pick.barSpeed);
    if (v == null) return null;
    return { barSpeed: v, at: at };
  }
  function mergeCards(remote, local) {
    const r = remote || {}, l = local || {};
    const out = { v: 1, at: {}, p: {} };
    const st = mergeSettings(r.settings, l.settings);
    if (st) out.settings = st;
    IDS.forEach(id => {
      const rp = (r.p || {})[id], lp = (l.p || {})[id];
      if (!rp && !lp) return;
      const rt = n((r.at || {})[id]), lt = n((l.at || {})[id]);
      if (!rp) { out.p[id] = lp; out.at[id] = lt; return; }
      if (!lp) { out.p[id] = rp; out.at[id] = rt; return; }
      const win = lt >= rt ? lp : rp;
      const lose = lt >= rt ? rp : lp;
      const rec = Object.assign({}, win);
      const resetAt = Math.max(n(rp.resetAt), n(lp.resetAt));
      if (resetAt > 0) rec.resetAt = resetAt;
      /* 트로피는 합집합 — 딴 것은 사라지지 않는다 */
      rec.badges = union(rp.badges, lp.badges);
      rec.titles = union(rp.titles, lp.titles);
      /* 최애 3장은 지금 가진 카드 안에서만 */
      rec.fav = (rec.fav || []).filter(x => rec.cards && rec.cards[x]);
      if ((rec.fav || []).length < 3) {
        (lose.fav || []).forEach(x => {
          if (rec.fav.length < 3 && rec.cards && rec.cards[x] && rec.fav.indexOf(x) < 0) rec.fav.push(x);
        });
      }
      /* 교환함 — 양쪽에 올라온 카드는 살린다 */
      const tr = (rec.trades || []).slice();
      (lose.trades || []).forEach(t => { if (!tr.some(x => x.cardId === t.cardId)) tr.push(t); });
      rec.trades = tr;
      /* 💾 나만의 덱 3칸 — 카드·코인과 따로, 덱만의 바뀐 시각(decksAt)으로 가린다.
         (덱을 고쳤다고 그 프로필의 카드·티켓 기록 전체가 덮이지 않게) */
      const dk = pickDecks(rp, lp);
      if (dk) { rec.decks = dk.decks; rec.decksAt = dk.at; }
      /* 상대에게만 있는 카드가 있으면 '가장 적게 잃는' 쪽으로 합친다.
         win 이 카드를 일부러 줄인 경우(교환·아빠 차감)도 있으므로
         win 에 아예 없던 카드만 가져온다.
         단, 되돌림(resetAt)이 상대의 마지막 변경보다 뒤라면 그 옛 카드는 살리지 않는다
         — 복원한 기록이 낡은 기기의 push 로 조용히 되살아나는 것을 막는다. */
      rec.cards = Object.assign({}, rec.cards || {});
      if (!(resetAt > 0 && resetAt > n(lose.at))) {
        Object.keys(lose.cards || {}).forEach(cid => {
          if (!(cid in rec.cards)) rec.cards[cid] = lose.cards[cid];
        });
      }
      out.p[id] = rec;
      out.at[id] = Math.max(rt, lt);
    });
    return out;
  }

  /* ---------- 클라우드 → 이 기기 ----------
     실제로 달라진 것만 쓴다. 하나도 안 달라졌으면 저장도, 다시 그리기도 하지 않는다
     (20초마다 화면이 새로 그려지며 스크롤이 맨 위로 튀던 원인).
     돌려주는 값 { dirty, visual } — dirty: 저장할 값이 바뀜 · visual: 화면에 보이는 게 바뀜 */
  function canon(o) {
    if (o === null || typeof o !== 'object') return JSON.stringify(o === undefined ? null : o);
    if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  }
  function eqv(a, b) { return canon(a) === canon(b); }

  function applyMerged(coins, cards) {
    const DS = dev();
    let dirty = false, visual = false;
    applying = true;
    try {
      IDS.forEach(id => {
        const pr = P.prof(id);
        if (!pr) return;
        if (coins && coins.coins && coins.coins[id] != null) {
          const cv = Math.max(0, Math.round(n(coins.coins[id])));
          const cat = n((coins.at || {})[id]);
          if (pr.coins !== cv) { pr.coins = cv; dirty = true; visual = true; }
          if (cat > 0 && pr.coinsAt !== cat) { pr.coinsAt = cat; dirty = true; }
        }
        const c = cards && cards.p && cards.p[id];
        if (!c) return;
        if (c.name && c.name !== pr.name) { pr.name = c.name; dirty = true; visual = true; }
        if (c.emoji && c.emoji !== pr.emoji) { pr.emoji = c.emoji; dirty = true; visual = true; }
        if (c.cards && typeof c.cards === 'object' && !eqv(c.cards, pr.cards)) { pr.cards = c.cards; dirty = true; visual = true; }
        if (c.src && typeof c.src === 'object' && !eqv(c.src, pr.src)) { pr.src = c.src; dirty = true; visual = true; }
        if (Array.isArray(c.fav) && !eqv(c.fav, pr.fav)) { pr.fav = c.fav; dirty = true; visual = true; }
        const tk = { normal: n((c.tickets || {}).normal), high: n((c.tickets || {}).high) };
        if (!eqv(tk, pr.tickets)) { pr.tickets = tk; dirty = true; visual = true; }
        if (pr.stardust !== n(c.stardust)) { pr.stardust = n(c.stardust); dirty = true; visual = true; }
        if (Array.isArray(c.badges) && !eqv(c.badges, pr.badges)) { pr.badges = c.badges; dirty = true; visual = true; }
        if (Array.isArray(c.titles) && c.titles.length && !eqv(c.titles, pr.titles)) { pr.titles = c.titles; dirty = true; visual = true; }
        if (Array.isArray(c.deck) && !eqv(c.deck, pr.deck)) { pr.deck = c.deck; dirty = true; visual = true; }
        if (pr.wins !== n(c.wins)) { pr.wins = n(c.wins); dirty = true; visual = true; }
        if (pr.losses !== n(c.losses)) { pr.losses = n(c.losses); dirty = true; visual = true; }
        if (Array.isArray(c.trades) && !eqv(c.trades, pr.trades)) { pr.trades = c.trades; dirty = true; visual = true; }
        const at = n((cards.at || {})[id]);
        if (at > 0 && pr.at !== at) { pr.at = at; dirty = true; }
        if (n(c.resetAt) > n(pr.resetAt)) { pr.resetAt = n(c.resetAt); dirty = true; }
        /* 💾 나만의 덱 3칸 — 병합 결과를 이 기기 저장소에 그대로 반영 (같으면 건드리지 않는다) */
        if (DS && Array.isArray(c.decks) && !eqv(normDecks(c.decks), DS.slots(id))) {
          DS.applyDecks(id, c.decks, n(c.decksAt));
          dirty = true; visual = true;
        }
      });
    } finally { applying = false; }
    /* ⚙️ 타이밍 바 속도 (아빠 PIN 설정) */
    if (DS && cards && cards.settings) {
      const v = clampSpeed(cards.settings.barSpeed);
      const at = n(cards.settings.at);
      if (v != null && at > 0 && clampSpeed(DS.barSpeed()) !== v) {
        DS.applyBarSpeed(v, at);
        dirty = true; visual = true;
      }
    }
    S.lastAt = Date.now();
    if (dirty) {
      muteTouch = true;          /* 이 저장은 내가 바꾼 게 아니라 받은 것 — 되쏘지 않는다 */
      P.save();
      setTimeout(() => { muteTouch = false; }, 400);   /* 오래 남아 남의 push 를 막지 않게 */
    }
    if (visual) {
      if (window.PKCUI) { try { window.PKCUI.refreshHeader(); } catch (e) { /* */ } }
      try { document.dispatchEvent(new CustomEvent('pkccloud:applied')); } catch (e) { /* */ }
    }
    return { dirty: dirty, visual: visual };
  }

  /* ============================================================
     ⏪ 이전 백업 불러오기 (3슬롯)
     ─ 스케줄 액션(scheduled-actions/포켓몬-클라우드-3슬롯-자동백업)이 매일
       아침 10:02 · 오후 16:02 · 밤 23:55 에 가족 코드 행(0623) 전체를
       슬롯 행 `{code}_am` · `{code}_pm` · `{code}_night` 에 그대로 복사해 둔다.
     ─ 되돌리는 범위는 이 앱의 두 키뿐이다.
         pkm.cards.v1  🃏 카드·티켓·최애·별가루·트로피·교환함
         pkm.coins.v1  🪙 코인 지갑
       도감(pkm.shared.dex.v1.*)·마을·판수 같은 다른 키는 읽지도 쓰지도 않는다.
     ─ push() 는 '합치기'라 되돌리기가 되지 않으므로, 현재 행을 먼저 읽어
       두 키만 바꾼 data 를 서버 행에 직접 쓴다(나머지 키는 그대로 보존).
     ============================================================ */
  const SLOTS = [
    { s: 'am', suffix: '_am', name: '🌅 아침 10시', at: '10:02' },
    { s: 'pm', suffix: '_pm', name: '🌇 오후 4시', at: '16:02' },
    { s: 'night', suffix: '_night', name: '🌙 밤 12시', at: '23:55' }
  ];

  function slotCodes() {
    const c = cfg();
    return SLOTS.map(s => c.code + s.suffix);
  }
  /* 슬롯 한 줄 요약 — 저장 시각 + 프로필별 카드 장수·코인 */
  function summarize(row, code) {
    if (!row) return null;
    const data = row.data || {};
    const keys = data.keys || {};
    const cards = safeParse(keys[K_CARDS]);
    const coins = safeParse(keys[K_COINS]);
    const has = { cards: !!(cards && cards.p), coins: !!(coins && coins.coins) };
    const rows = IDS.map(id => {
      const meta = P.profileMeta(id);
      const p = (cards && cards.p && cards.p[id]) || null;
      let total = 0, kinds = 0;
      if (p && p.cards) {
        Object.keys(p.cards).forEach(cid => {
          const v = n(p.cards[cid]);
          if (v > 0) { total += v; kinds++; }
        });
      }
      const cv = (coins && coins.coins && coins.coins[id] != null) ? Math.max(0, Math.round(n(coins.coins[id]))) : null;
      return {
        id: id,
        emoji: (p && p.emoji) || meta.emoji,
        name: (p && p.name) || meta.name,
        cards: total, kinds: kinds, coins: cv
      };
    });
    return { code: code, at: data.backedUpAt || row.updated_at || null, has: has, rows: rows };
  }

  /* 모달을 열 때 3슬롯을 읽는다 — 카드 장수·코인 미리보기까지. */
  function loadSlots() {
    const codes = slotCodes();
    const list = codes.map(encodeURIComponent).join(',');
    const url = api('?code=in.(' + list + ')&select=code,updated_at,data');
    return fetch(url, { headers: headers(), cache: 'no-store' }).then(res => {
      if (!res.ok) return res.text().then(t => { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return res.json();
    }).then(arr => {
      const byCode = {};
      (Array.isArray(arr) ? arr : []).forEach(row => { if (row && row.code) byCode[row.code] = row; });
      return SLOTS.map((slot, i) => {
        const row = byCode[codes[i]] || null;
        return {
          s: slot.s, suffix: slot.suffix, name: slot.name, at: slot.at,
          code: codes[i],
          ready: !!row,
          meta: summarize(row, codes[i])
        };
      });
    }).catch(e => {
      setState('error', errMsg(e));
      return SLOTS.map(slot => ({
        s: slot.s, suffix: slot.suffix, name: slot.name, at: slot.at,
        code: cfg().code + slot.suffix, ready: false, meta: null, error: errMsg(e)
      }));
    });
  }

  /* 백업 값을 '지금' 시각으로 다시 찍는다 — 다른 기기도 이 값이 더 최근임을 알도록 */
  function stampCoins(src, now) {
    const out = { v: 1, coins: {}, at: {} };
    IDS.forEach(id => {
      const v = (src.coins || {})[id];
      if (v == null) return;
      out.coins[id] = Math.max(0, Math.round(n(v)));
      out.at[id] = now;
    });
    return out;
  }
  function stampCards(src, now) {
    const out = { v: 1, at: {}, p: {} };
    IDS.forEach(id => {
      const p = (src.p || {})[id];
      if (!p) return;
      const rec = Object.assign({}, p);
      rec.cards = Object.assign({}, rec.cards || {});
      rec.fav = (rec.fav || []).filter(x => rec.cards[x]);
      rec.resetAt = now;          /* 이 시점 값이 낡은 기기의 옛 카드보다 우선한다 */
      out.p[id] = rec;
      out.at[id] = now;
    });
    return out;
  }

  let lastRestore = { code: '', msg: '', at: 0 };
  /* slotSuffix: '_am' | '_pm' | '_night'
     → { ok, code: 'restored'|'empty'|'error'|'nocode', msg, cards, coins } */
  function restoreSlot(slotSuffix) {
    const c = cfg();
    if (!c.code) return Promise.resolve({ ok: false, code: 'nocode', msg: '가족 코드가 없어요' });
    if (restoring) return Promise.resolve({ ok: false, code: 'busy', msg: '되돌리는 중이에요' });
    const fromCode = c.code + slotSuffix;
    restoring = true;
    setState('syncing', '되돌리는 중…');
    const url = api('?code=eq.' + encodeURIComponent(fromCode) + '&select=code,data,updated_at');
    return fetch(url, { headers: headers(), cache: 'no-store' }).then(res => {
      if (!res.ok) return res.text().then(t => { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return res.json();
    }).then(arr => {
      const row = (Array.isArray(arr) && arr.length) ? arr[0] : null;
      const srcKeys = (row && row.data && row.data.keys) || {};
      const srcCards = safeParse(srcKeys[K_CARDS]);
      const srcCoins = safeParse(srcKeys[K_COINS]);
      if (!srcCards && !srcCoins) {
        const r = { ok: false, code: 'empty', msg: '이 슬롯에는 카드팩 기록이 없어요' };
        lastRestore = { code: fromCode, msg: r.msg, at: Date.now() };
        setState('ok', r.msg);
        return r;
      }
      const now = Date.now();
      const coins = srcCoins ? stampCoins(srcCoins, now) : null;
      const cards = srcCards ? stampCards(srcCards, now) : null;
      /* 현재 행을 먼저 읽는다 — 다른 키(도감·마을·판수 …)는 그대로 두고 두 키만 바꾼다 */
      return getRow().then(cur => {
        const curData = (cur && cur.data) || {};
        const curKeys = (curData && curData.keys) || {};
        const keys = Object.assign({}, curKeys);
        if (coins) keys[K_COINS] = JSON.stringify(coins);
        if (cards) keys[K_CARDS] = JSON.stringify(cards);
        const nowIso = new Date(now).toISOString();
        const payload = {
          code: c.code,
          data: Object.assign({}, curData, {
            v: 1, keys: keys, pushedAt: nowIso, cardsApp: true,
            restoredFrom: fromCode, restoredAt: nowIso
          }),
          updated_at: nowIso
        };
        return putRow(payload).then(() => {
          applyMerged(coins, cards);      /* 이 기기 화면 즉시 갱신 */
          S.lastAt = now;
          const r = {
            ok: true, code: 'restored',
            msg: '이 시점으로 되돌렸어요',
            cards: cards ? cards.p : null,
            coins: coins ? coins.coins : null
          };
          lastRestore = { code: fromCode, msg: r.msg, at: now };
          setState('ok', '되돌렸어요');
          return r;
        });
      });
    }).catch(e => {
      const r = { ok: false, code: 'error', msg: errMsg(e) };
      lastRestore = { code: fromCode, msg: r.msg, at: Date.now() };
      setState('error', r.msg);
      return r;
    }).then(r => { restoring = false; return r; });
  }

  /* ---------- 올리기 ---------- */
  function push(opts) {
    opts = opts || {};
    if (pushing || restoring) return Promise.resolve('busy');
    const c = cfg();
    if (!c.code) return Promise.resolve('nocode');
    const quiet = !!opts.silent;          /* 배경에서 오간 것이면 칩에 '동기화 중'을 띄우지 않는다 */
    pushing = true;
    if (!quiet) setState('syncing', '올리는 중…');
    const localCoins = snapCoins();
    const localCards = snapCards();
    return getRow().then(row => {
      const data = (row && row.data) || {};
      const remoteKeys = (data && data.keys) || {};
      const remoteCoins = remoteKeys[K_COINS] ? safeParse(remoteKeys[K_COINS]) : null;
      const remoteCards = remoteKeys[K_CARDS] ? safeParse(remoteKeys[K_CARDS]) : null;

      /* 처음 올리는 코인은 '지금'을 기준 시각으로 박아 둔다 —
         기준이 없으면 다른 기기의 예전 값이 이 코인을 덮을 수 있다. */
      if (opts.stampBaseline !== false) {
        IDS.forEach(id => {
          if (localCoins.at[id]) return;
          if (remoteCoins && n((remoteCoins.at || {})[id])) return;
          localCoins.at[id] = Date.now();
        });
      }
      const coins = mergeCoins(remoteCoins, localCoins);
      const cards = mergeCards(remoteCards, localCards);

      const keys = Object.assign({}, remoteKeys);
      keys[K_COINS] = JSON.stringify(coins);
      keys[K_CARDS] = JSON.stringify(cards);

      const sameCoins = remoteCoins && JSON.stringify(mergeCoins(remoteCoins, remoteCoins)) === JSON.stringify(coins);
      const sameCards = remoteCards && JSON.stringify(mergeCards(remoteCards, remoteCards)) === JSON.stringify(cards);
      if (row && sameCoins && sameCards) {
        applyMerged(coins, cards);
        if (!quiet) setState('ok', '이미 같아요');
        return 'same';
      }
      const nowIso = new Date().toISOString();
      const payload = {
        code: c.code,
        data: Object.assign({}, data, { v: 1, keys: keys, pushedAt: nowIso, cardsApp: true }),
        updated_at: nowIso
      };
      return putRow(payload, !!opts.keepalive).then(() => {
        applyMerged(coins, cards);
        lastStamp = stampKey(nowIso);
        S.lastAt = Date.now();
        if (!quiet) setState('ok', '올렸어요');
        return 'pushed';
      });
    }).catch(e => {
      setState('error', errMsg(e));
      return 'error';
    }).then(r => { pushing = false; return r; });
  }

  function safeParse(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
  }

  /* ---------- 내려받기 ----------
     opts.silent  — 배경 자동 확인(20초). 칩에 '받는 중…'을 띄우지 않고,
                    바뀐 것이 없으면 저장도 다시 그리기도 하지 않는다.
     opts.full    — 가벼운 확인을 건너뛰고 본문까지 받는다 */
  function pull(opts) {
    opts = opts || {};
    if (pulling) return Promise.resolve('busy');
    const silent = !!opts.silent;
    pulling = true;
    if (!silent) setState('syncing', '받는 중…');

    /* 가벼운 확인 — updated_at 만 보고 같으면 여기서 끝낸다.
       5번에 1번은 본문까지 확인해, updated_at 이 안 바뀐 변경도 놓치지 않는다. */
    let quick;
    if (silent && !opts.full) {
      quickCount++;
      quick = (quickCount % 5 === 0) ? Promise.resolve(null) : getStamp().then(st => {
        if (st && lastStamp && stampKey(st) === lastStamp) return 'same';
        return null;
      }).catch(() => null);
    } else {
      quick = Promise.resolve(null);
    }

    return quick.then(skip => {
      if (skip === 'same') {
        pulling = false;
        S.lastAt = Date.now();          /* 조용히 최신 시각만 적어 둔다 (칩·화면 변화 없음) */
        return 'upToDate';
      }
      return getRow().then(row => {
        if (!row) {
          pulling = false;
          return push({ silent: silent });           /* 클라우드가 비었으면 이 기기 내용을 올린다 */
        }
        lastStamp = stampKey(row.updated_at);
        const keys = (row.data && row.data.keys) || {};
        const remoteCoins = keys[K_COINS] ? safeParse(keys[K_COINS]) : null;
        const remoteCards = keys[K_CARDS] ? safeParse(keys[K_CARDS]) : null;
        const coins = mergeCoins(remoteCoins, snapCoins());
        const cards = mergeCards(remoteCards, snapCards());
        const res = applyMerged(coins, cards);         /* 실제로 달라진 게 있을 때만 저장·재렌더 */
        pulling = false;
        const changed = res.visual;
        /* 내 쪽에만 있는 내용이 있으면 올려 준다.
           시각(at)만 다른 경우는 올리지 않는다 — 20초마다 헛되이 올리는 것을 막는다. */
        if (!sameContent(remoteCoins, coins) || !sameContent(remoteCards, cards)) {
          return push({ stampBaseline: false, silent: silent }).then(() => {
            if (changed) setState('ok', '받았어요');
            else if (!silent) setState('ok', '최신 상태예요');
            return changed ? 'merged' : 'upOnly';
          });
        }
        if (changed) setState('ok', '받았어요');
        else if (!silent) setState('ok', '최신 상태예요');
        return changed ? 'applied' : 'upToDate';
      }).catch(e => {
        pulling = false;
        if (silent && S.state === 'error') return 'error';   /* 같은 오류를 20초마다 칩에 다시 쓰지 않는다 */
        setState('error', errMsg(e));
        return 'error';
      });
    });
  }
  function normalize(o) { return o || null; }
  /* 시각 필드(at · decksAt)를 뺀 '알맹이'만 견준다 — 값이 같으면 올릴 것도 없다 */
  function stripTimes(o) {
    if (o === null || typeof o !== 'object') return o === undefined ? null : o;
    if (Array.isArray(o)) return o.map(stripTimes);
    const out = {};
    Object.keys(o).sort().forEach(k => {
      if (k === 'at' || k === 'decksAt') return;
      out[k] = stripTimes(o[k]);
    });
    return out;
  }
  function sameContent(a, b) { return JSON.stringify(stripTimes(a)) === JSON.stringify(stripTimes(b)); }

  /* ---------- 저장할 때마다 (디바운스) ---------- */
  function touch() {
    if (applying) return;
    if (muteTouch) { muteTouch = false; return; }   /* 방금 받아서 저장한 것은 되쏘지 않는다 */
    if (tPush) clearTimeout(tPush);
    tPush = setTimeout(() => { tPush = null; push(); }, 1200);
  }
  function flush() {
    if (tPush) { clearTimeout(tPush); tPush = null; return push({ keepalive: true }); }
    return Promise.resolve('noop');
  }

  /* ---------- 주기 점검 ---------- */
  let lastAuto = 0;
  function autoPull(gap) {
    if (document.hidden) return;
    if (Date.now() - lastAuto < (gap || 0)) return;
    lastAuto = Date.now();
    pull({ silent: true });          /* 배경 확인은 조용히 — 칩 깜박임·스크롤 튐 없음 */
  }
  function boot() {
    S.code = cfg().code;
    emit();
    const first = pull();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flush();
      else autoPull(8000);
    });
    window.addEventListener('pagehide', () => flush());
    window.addEventListener('online', () => autoPull(1000));
    setInterval(() => autoPull(20000), 10000);
    return first;
  }

  window.PKCCloud = {
    K_COINS, K_CARDS, IDS,
    state: S, cfg, setCode, onState,
    push, pull, touch, flush,
    mergeCoins, mergeCards, snapCards, snapCoins, boot,
    SLOTS, loadSlots, restoreSlot,
    lastRestoreInfo: function () { return lastRestore; }
  };
})();
