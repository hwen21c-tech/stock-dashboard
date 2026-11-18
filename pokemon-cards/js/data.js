/* data.js — 팩 인덱스 · 카드 로딩 · 뽑기 확률 */
(function () {
  'use strict';
  const IMG_BASE = 'https://cards.image.pokemonkorea.co.kr/data/';
  const SYM_BASE = IMG_BASE + 'images/symbol/';
  const BACK = 'assets/card-back.jpg';
  const P = window.PKC;

  const db = { index: null, packs: {}, loading: {} };

  function img(path) { return IMG_BASE + path; }

  /* ---------- 클래식 시리즈 내부 시대(에라) ---------- */
  const ERAS = [
    { key: 'all', name: '전체', emoji: '🟡' },
    { key: 'sm', name: '썬&문', emoji: '🌗' },
    { key: 'xy', name: 'XY', emoji: '🧬' },
    { key: 'bw', name: 'BW', emoji: '⚫' }
  ];
  const ERA_MARK = { sm: 'SM', xy: 'XY', bw: 'BW', sv: 'SV', swsh: 'SWSH', high: 'HIGH' };
  function eraOf(p) { return p.era || (p.cat === 'classic' ? 'sm' : p.cat); }
  function eraName(k) {
    const e = ERAS.find(x => x.key === k);
    return e ? e.name : k;
  }
  function sym(meta) { return meta && meta.sym ? SYM_BASE + meta.sym + '.png' : null; }

  async function loadIndex() {
    if (db.index) return db.index;
    const r = await fetch('data/packs.json', { cache: 'force-cache' });
    const j = await r.json();
    db.index = j;
    return j;
  }

  async function loadPack(id) {
    if (db.packs[id]) return db.packs[id];
    if (db.loading[id]) return db.loading[id];
    db.loading[id] = fetch('data/packs/' + id + '.json', { cache: 'force-cache' })
      .then(r => r.json())
      .then(j => { db.packs[id] = j; return j; });
    return db.loading[id];
  }

  function packMeta(id) {
    return (db.index && db.index.packs.find(p => p.id === id)) || null;
  }

  function seriesList() { return db.index ? db.index.series : []; }
  function packsOf(cat, era) {
    if (!db.index) return [];
    return db.index.packs.filter(p => p.cat === cat && (!era || era === 'all' || eraOf(p) === era));
  }
  function erasOf(cat) {
    if (!db.index) return [];
    const set = {};
    db.index.packs.forEach(p => { if (p.cat === cat) set[eraOf(p)] = (set[eraOf(p)] || 0) + 1; });
    return ERAS.filter(e => e.key === 'all' || set[e.key]).map(e => ({ ...e, n: e.key === 'all' ? db.index.packs.filter(p => p.cat === cat).length : set[e.key] }));
  }
  function allPacks() { return db.index ? db.index.packs : []; }

  /* 오늘의 추천 팩: 날짜 시드 */
  function daySeed(d) {
    const t = d || new Date();
    return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function todayPack() {
    const packs = allPacks();
    if (!packs.length) return null;
    const seed = daySeed();
    const p = packs[hash('pkc' + seed) % packs.length];
    const disc = p.price === 80 ? 65 : 40;
    return { pack: p, price: disc, seed };
  }

  const STARS = { 1: 1, 2: 2, 4: 4, 5: 5 };
  function stars(t) { return STARS[t] || 1; }
  function tierName(t) {
    return ({ 1: '일반', 2: '레어', 4: '더블 레어', 5: '울트라 레어' })[t] || '일반';
  }
  const RARITY_KO = {
    'common': '노멀', 'uncommon': '언커먼', 'none': '노멀', 'rare': '레어', 'rare holo': '레어',
    'holo rare': '레어', 'double rare': '더블레어', 'triple rare': '트리플레어',
    'illustration rare': '일러스트레어', 'special illustration rare': '스페셜일러스트',
    'character rare': '캐릭터레어', 'character super rare': '캐릭터슈퍼레어',
    'ultra rare': '울트라레어', 'hyper rare': '하이퍼레어', 'secret rare': '시크릿레어',
    'mega hyper rare': '메가하이퍼레어', 'radiant rare': '래디언트', 'black white rare': '흑백레어',
    'ace spec rare': '에이스스펙', 'rare holo v': 'V', 'rare holo vmax': 'VMAX',
    'rare holo vstar': 'VSTAR', 'rare holo gx': 'GX', 'rare holo ex': 'EX',
    'rare prism star': '프리즘스타', 'prism star': '프리즘스타', 'shiny rare': '샤이니',
    'shiny ultra rare': '샤이니울트라', 'rare shiny': '샤이니', 'rare secret': '시크릿'
  };
  function rarityKo(rr) {
    if (!rr) return '기본';
    return RARITY_KO[String(rr).toLowerCase()] || String(rr);
  }

  function tierFromRarity(rr) {
    const r = String(rr || '').toLowerCase();
    if (/illustration|ultra|hyper|secret|character|radiant|shiny|rainbow|ace spec|black white|mega/.test(r)) return 5;
    if (/double|triple|vmax|vstar|gx|ex|prism/.test(r)) return 4;
    if (/rare/.test(r)) return 2;
    return 1;
  }

  const TYPE_COLOR = {
    '풀': '#4bd47a', '불꽃': '#ff7648', '물': '#4bb8ff', '번개': '#ffd93d', '초': '#c07bff',
    '격투': '#e2703a', '악': '#8a6bb5', '강철': '#9fb4c7', '드래곤': '#6a7bff',
    '무색': '#c8cfe8', '페어리': '#ff9ad5'
  };
  function typeColor(t) { return TYPE_COLOR[t] || '#c8cfe8'; }
  function typeEmoji(t) {
    return ({ '풀': '🌿', '불꽃': '🔥', '물': '💧', '번개': '⚡', '초': '🔮', '격투': '✊', '악': '🌑', '강철': '⚙️', '드래곤': '🐉', '무색': '⭐', '페어리': '🎀' })[t] || '⭐';
  }
  const TYPES = ['풀', '불꽃', '물', '번개', '초', '격투', '악', '강철', '드래곤', '무색', '페어리'];

  /* 뽑기: 5장. 슬롯별 가중치 (tier1,2,4,5) */
  function pickTier(rng, boosted, slot) {
    let w;
    if (slot === 4) w = boosted ? [40, 32, 22, 6] : [48, 32, 17, 3];
    else w = boosted ? [54, 28, 15, 3] : [64, 24, 10, 2];
    const sum = w.reduce((a, b) => a + b, 0);
    let r = rng() * sum;
    const tiers = [1, 2, 4, 5];
    for (let i = 0; i < 4; i++) { r -= w[i]; if (r <= 0) return tiers[i]; }
    return 1;
  }

  function weightedPick(list, rng) {
    const total = list.reduce((a, c) => a + (c.w || 1), 0);
    let r = rng() * total;
    for (const c of list) { r -= (c.w || 1); if (r <= 0) return c; }
    return list[list.length - 1];
  }

  /* 5장 뽑기. boosted: 오늘의 팩 여부
     · 같은 팩 안에서 같은 카드(c.id)는 절대 두 번 나오지 않는다.
     · 해당 티어 풀이 모자라면 아래/위 티어 → 팩 전체 순으로 미중복 카드를 고른다. */
  function pull(packData, boosted) {
    const cards = (packData && packData.cards) || [];
    if (!cards.length) return [];
    const byTier = { 1: [], 2: [], 4: [], 5: [] };
    cards.forEach(c => {
      const t = byTier[c.r] ? c.r : 1;
      byTier[t].push(c);
    });
    const rng = Math.random;
    const used = {};
    const out = [];
    const FALLBACK = { 1: [1, 2, 4, 5], 2: [2, 1, 4, 5], 4: [4, 2, 5, 1], 5: [5, 4, 2, 1] };

    function takeFree(pool) {
      if (!pool || !pool.length) return null;
      const free = pool.filter(c => !used[c.id]);
      if (!free.length) return null;
      return weightedPick(free, rng);
    }

    for (let i = 0; i < 5; i++) {
      const tier = pickTier(rng, boosted, i);
      let picked = null;
      const order = FALLBACK[tier] || [1, 2, 4, 5];
      for (let k = 0; k < order.length && !picked; k++) picked = takeFree(byTier[order[k]]);
      if (!picked) picked = takeFree(cards);            // 팩에 남은 카드가 없을 때만
      if (!picked) picked = weightedPick(cards, rng);   // 팩 카드 종류가 5종 미만인 극단적 경우
      used[picked.id] = 1;
      out.push(picked);
    }
    // 5장 모두 일반이면 마지막 1장을 레어 이상으로 승격 (중복 없는 카드가 있을 때만)
    if (out.every(c => c.r === 1)) {
      const better = cards.filter(c => c.r >= 2 && !used[c.id]);
      if (better.length) {
        out[4] = weightedPick(better, rng);
        used[out[4].id] = 1;
      }
    }
    return out;
  }

  /* 컬렉션 계산 */
  function ownedInPack(profile, packData) {
    let n = 0;
    packData.cards.forEach(c => { if (profile.cards[c.id]) n++; });
    return n;
  }

  window.PKData = {
    BACK, ERAS, ERA_MARK,
    img, sym, loadIndex, loadPack, packMeta, seriesList, packsOf, erasOf, eraOf, eraName, allPacks,
    todayPack, stars, tierName, rarityKo, tierFromRarity, typeColor, typeEmoji, TYPES,
    pull, ownedInPack, daySeed
  };
})();
