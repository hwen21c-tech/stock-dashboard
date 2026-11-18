/* ============================================================
   포켓몬 배틀 월드 — 🪙 코인 지갑 (카드팩 앱과 같은 지갑을 쓴다)
   ─ 저장 키 `pkm.coins.v1` 하나를 배틀 월드(pokemon-sync.js)와
     카드팩 앱(pokemon-cards)이 함께 읽고 쓴다. → 가족 클라우드(0623)로 동기화.
   ─ 구조
       { v:1, coins:{ arin:130, jian:80, guest:100 }, at:{ arin:1690000000000, ... } }
     `at` = 그 프로필 코인이 마지막으로 바뀐 시각.
     클라우드에서 합칠 때는 '더 최근에 바뀐 쪽'을 쓴다 — 그래서
     게임으로 번 +10도, 카드팩으로 쓴 -50도 서로 지워지지 않는다.
   ─ 프로필 열쇠는 게임 슬롯(p1·p2·guest)이 아니라 이름표(arin·jian·guest)를 쓴다.
     (카드팩 앱의 ?profile=arin|jian|guest 와 같은 열쇠)
   ============================================================ */
(function () {
  'use strict';
  if (window.PkmCoins && window.PkmCoins.v) return;

  var KEY = 'pkm.coins.v1';
  var IDS = ['arin', 'jian', 'guest'];
  var SLOT2ID = { p1: 'arin', p2: 'jian', p3: 'guest', guest: 'guest' };
  var START = 100;                 /* 카드팩 앱과 같은 시작 코인 */
  var PLAY_REWARD = 10;            /* 학습 1판 완료 = +10코인 */

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
  function num(v) { var n = Number(v); return isFinite(n) && n >= 0 ? Math.round(n) : null; }
  function jp(raw, d) { if (raw == null) return d; try { var v = JSON.parse(raw); return v == null ? d : v; } catch (e) { return d; } }

  function idOf(slot) { return SLOT2ID[String(slot)] || 'arin'; }

  function read() {
    var o = jp(lsGet(KEY), null);
    if (!o || typeof o !== 'object' || o.v !== 1) o = { v: 1, coins: {}, at: {} };
    if (!o.coins || typeof o.coins !== 'object') o.coins = {};
    if (!o.at || typeof o.at !== 'object') o.at = {};
    return o;
  }
  function write(o) {
    lsSet(KEY, JSON.stringify(o));
    /* 같은 화면 안의 🪙 표시(홈 카드)가 바로 따라오게 알린다 */
    try { document.dispatchEvent(new CustomEvent('pkmcoins:change', { detail: o })); } catch (e) { /* */ }
  }

  function get(id) {
    var o = read(), v = num((o.coins || {})[id]);
    return v == null ? START : v;
  }
  function getSlot(slot) { return get(idOf(slot)); }
  function at(id) { var o = read(); var t = Number((o.at || {})[id]); return isFinite(t) && t > 0 ? t : 0; }

  function set(id, n) {
    var o = read();
    var v = Math.max(0, Math.round(Number(n) || 0));
    o.coins[id] = v;
    o.at[id] = Date.now();
    write(o);
    return v;
  }
  function add(idOrSlot, n) {
    var id = SLOT2ID[String(idOrSlot)] || idOrSlot;
    if (IDS.indexOf(id) < 0) id = 'arin';
    var before = get(id);
    return set(id, before + (Number(n) || 0));
  }
  function all() {
    var out = {};
    for (var i = 0; i < IDS.length; i += 1) out[IDS[i]] = get(IDS[i]);
    return out;
  }
  function hasRecord() {
    var o = read();
    for (var i = 0; i < IDS.length; i += 1) if (Number((o.at || {})[IDS[i]]) > 0) return true;
    return false;
  }

  /* 화면에 "+10 🪙" 를 잠깐 띄운다 — 페이지마다 CSS 가 달라서 스스로 스타일을 입힌다.
     결과 창(z-index 60대)보다 위에 뜨도록 아주 높게 잡는다. */
  var popEl = null, popTimer = 0;
  function pop(n, label) {
    try {
      if (!document.body) return;
      if (!popEl) {
        popEl = document.createElement('div');
        popEl.setAttribute('role', 'status');
        popEl.style.cssText = 'position:fixed;left:50%;top:14%;transform:translate(-50%,-6px);z-index:2147483000;'
          + 'padding:7px 16px;border-radius:999px;font-weight:900;font-size:clamp(13px,3.6vw,17px);'
          + 'color:#3a2600;background:linear-gradient(180deg,#ffe9a8,#ffc93c);'
          + 'border:2px solid rgba(255,255,255,.8);box-shadow:0 6px 20px rgba(120,80,0,.35);'
          + 'pointer-events:none;opacity:0;transition:opacity .2s ease,transform .2s ease;'
          + 'font-family:"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;white-space:nowrap';
        document.body.appendChild(popEl);
      }
      popEl.textContent = '🪙 +' + Math.max(0, Math.round(Number(n) || 0)) + '코인' + (label ? ' · ' + label : '');
      popEl.style.opacity = '1';
      popEl.style.transform = 'translate(-50%,0)';
      clearTimeout(popTimer);
      popTimer = setTimeout(function () {
        if (!popEl) return;
        popEl.style.opacity = '0';
        popEl.style.transform = 'translate(-50%,-6px)';
      }, 1700);
    } catch (e) { /* */ }
  }

  window.PkmCoins = {
    v: 1,
    KEY: KEY, IDS: IDS, SLOT2ID: SLOT2ID, START: START, REWARD: PLAY_REWARD,
    idOf: idOf, read: read, get: get, getSlot: getSlot, at: at,
    set: set, add: add, all: all, hasRecord: hasRecord, pop: pop
  };
})();
