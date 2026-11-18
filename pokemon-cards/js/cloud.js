/* cloud.js — ☁️ 가족 클라우드 동기화 (Supabase `family_sync` · 가족 코드 0623)
   ─ 포켓몬 배틀 월드(/pokemon/)와 **같은 클라우드·같은 코인 지갑**을 쓴다.
   ─ 이 앱이 쓰는 키는 딱 두 개. 나머지 키(도감·마을·판수…)는 건드리지 않는다.
       pkm.coins.v1  🪙 코인 지갑 { arin·jian·guest }  ← 배틀 월드와 함께 씀
       pkm.cards.v1  🃏 이 앱의 카드·티켓·최애·별가루·트로피·교환함
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
  let tPush = null;
  let listeners = [];

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
  function snapCards() {
    const out = { v: 1, at: {}, p: {} };
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
    });
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
  function mergeCards(remote, local) {
    const r = remote || {}, l = local || {};
    const out = { v: 1, at: {}, p: {} };
    IDS.forEach(id => {
      const rp = (r.p || {})[id], lp = (l.p || {})[id];
      if (!rp && !lp) return;
      const rt = n((r.at || {})[id]), lt = n((l.at || {})[id]);
      if (!rp) { out.p[id] = lp; out.at[id] = lt; return; }
      if (!lp) { out.p[id] = rp; out.at[id] = rt; return; }
      const win = lt >= rt ? lp : rp;
      const lose = lt >= rt ? rp : lp;
      const rec = Object.assign({}, win);
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
      /* 상대에게만 있는 카드가 있으면 '가장 적게 잃는' 쪽으로 합친다.
         win 이 카드를 일부러 줄인 경우(교환·아빠 차감)도 있으므로
         win 에 아예 없던 카드만 가져온다. */
      rec.cards = Object.assign({}, rec.cards || {});
      Object.keys(lose.cards || {}).forEach(cid => {
        if (!(cid in rec.cards)) rec.cards[cid] = lose.cards[cid];
      });
      out.p[id] = rec;
      out.at[id] = Math.max(rt, lt);
    });
    return out;
  }

  /* ---------- 클라우드 → 이 기기 ---------- */
  function applyMerged(coins, cards) {
    applying = true;
    try {
      IDS.forEach(id => {
        const pr = P.prof(id);
        if (!pr) return;
        if (coins && coins.coins && coins.coins[id] != null) {
          pr.coins = coins.coins[id];
          pr.coinsAt = n((coins.at || {})[id]) || pr.coinsAt || 0;
        }
        const c = cards && cards.p && cards.p[id];
        if (!c) return;
        pr.name = c.name || pr.name;
        pr.emoji = c.emoji || pr.emoji;
        if (c.cards && typeof c.cards === 'object') pr.cards = c.cards;
        if (c.src && typeof c.src === 'object') pr.src = c.src;
        pr.fav = Array.isArray(c.fav) ? c.fav : pr.fav;
        pr.tickets = { normal: n((c.tickets || {}).normal), high: n((c.tickets || {}).high) };
        pr.stardust = n(c.stardust);
        pr.badges = Array.isArray(c.badges) ? c.badges : pr.badges;
        pr.titles = Array.isArray(c.titles) && c.titles.length ? c.titles : pr.titles;
        pr.deck = Array.isArray(c.deck) ? c.deck : pr.deck;
        pr.wins = n(c.wins); pr.losses = n(c.losses);
        pr.trades = Array.isArray(c.trades) ? c.trades : pr.trades;
        pr.at = n((cards.at || {})[id]) || pr.at || 0;
      });
    } finally { applying = false; }
    P.save();
    S.lastAt = Date.now();
    if (window.PKCUI) { try { window.PKCUI.refreshHeader(); } catch (e) { /* */ } }
    try { document.dispatchEvent(new CustomEvent('pkccloud:applied')); } catch (e) { /* */ }
  }

  /* ---------- 올리기 ---------- */
  function push(opts) {
    opts = opts || {};
    if (pushing) return Promise.resolve('busy');
    const c = cfg();
    if (!c.code) return Promise.resolve('nocode');
    pushing = true;
    setState('syncing', '올리는 중…');
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
        setState('ok', '이미 같아요');
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
        S.lastAt = Date.now();
        setState('ok', '올렸어요');
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

  /* ---------- 내려받기 ---------- */
  function pull(opts) {
    opts = opts || {};
    if (pulling) return Promise.resolve('busy');
    pulling = true;
    setState('syncing', '받는 중…');
    return getRow().then(row => {
      if (!row) {
        pulling = false;
        return push();                       /* 클라우드가 비었으면 이 기기 내용을 올린다 */
      }
      const keys = (row.data && row.data.keys) || {};
      const remoteCoins = keys[K_COINS] ? safeParse(keys[K_COINS]) : null;
      const remoteCards = keys[K_CARDS] ? safeParse(keys[K_CARDS]) : null;
      const coins = mergeCoins(remoteCoins, snapCoins());
      const cards = mergeCards(remoteCards, snapCards());
      const before = JSON.stringify([snapCoins(), snapCards()]);
      applyMerged(coins, cards);
      const after = JSON.stringify([snapCoins(), snapCards()]);
      const changed = before !== after;
      /* 내 쪽이 더 최신이면(로컬에만 있는 내용) 올려 준다 */
      const remoteJson = JSON.stringify([normalize(remoteCoins), normalize(remoteCards)]);
      const localJson = JSON.stringify([normalize(coins), normalize(cards)]);
      S.lastAt = Date.now();
      setState('ok', changed ? '받았어요' : '최신 상태예요');
      pulling = false;
      if (remoteJson !== localJson) {
        return push({ stampBaseline: false }).then(() => (changed ? 'merged' : 'upOnly'));
      }
      return changed ? 'applied' : 'upToDate';
    }).catch(e => {
      pulling = false;
      setState('error', errMsg(e));
      return 'error';
    });
  }
  function normalize(o) { return o || null; }

  /* ---------- 저장할 때마다 (디바운스) ---------- */
  function touch() {
    if (applying) return;
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
    pull();
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
    mergeCoins, mergeCards, snapCards, snapCoins, boot
  };
})();
