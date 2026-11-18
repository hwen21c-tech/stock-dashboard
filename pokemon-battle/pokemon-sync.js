/* ============================================================
   포켓몬 배틀 월드 — ☁️ 가족 클라우드 자동 동기화 (Supabase)
   ─ 폰 · 태블릿이 같은 '가족 코드'로 도감·이름·마을·아이템·판수를 맞춘다.
   ─ <head>에서 가장 먼저 실행되어 localStorage.setItem 을 감시한다.
   ─ 저장 규칙
      1) 로컬에서 실제로 바뀐 것(포획·닉네임·배치·아이템 등)만 500ms 디바운스로 UPSERT
      2) 빈 기기가 먼저 클라우드를 빈 값으로 덮어쓰지 않는다
         · 로컬에 의미 있는 데이터가 없으면 자동 Push 금지 (수동 '지금 올리기'만 허용)
         · 특정 키가 '빈 값'인데 클라우드에 이미 내용이 있으면 그 키는 보내지 않는다
      3) updated_at(최신) + 내용 해시로 비교 — 같으면 아무것도 하지 않는다(불필요한 덮어쓰기·새로고침 방지)
   ─ 실패(오프라인·키 오류)해도 게임은 그대로 동작한다.
   ============================================================ */
(function () {
  'use strict';
  if (window.PkmSync && window.PkmSync.version) return;

  var VERSION = '1.2.0';

  /* ---------- 접속 정보 (기본값 · 고급 설정에서 기기별로 바꿀 수 있다) ---------- */
  var DEF = {
    url: 'https://hiruybkapzuhjrzjoyik.supabase.co',
    key: 'sb_publishable_e5JJbvCPDhY91uXaUEVNVA_8Byv_gI8',
    table: 'family_sync',
    code: '0623'
  };

  var K_CODE = 'pkm.cloud.code';
  var K_URL = 'pkm.cloud.url';
  var K_KEY = 'pkm.cloud.key';
  var K_META = 'pkm.cloud.meta';
  var K_PIN = 'pkm.family.pin.v1';

  /* ---------- 동기화 대상 키 ---------- */
  /* 앞부분(prefix)으로 잡는 키 — 슬롯(p1·p2·guest)·테마가 붙는다 */
  var PREFIX = [
    'pkm.shared.dex.v1.',      /* 통합 도감(산수·한글·영어 공통) */
    'pkm.village.v1.',         /* 마을 옛 저장분 */
    'pkm.village.v2.',         /* 마을 배치(테마별 포켓몬·꾸미기) */
    'pkm.village.inv.v1.',     /* 꾸미기 아이템 보유 수량 */
    'pkm.village.theme.v1.',   /* 고른 마을 테마 */
    'pkm.village.propsgift.',  /* 소품 선물 받은 기록 */
    'pkm.balls.v1.',           /* 몬스터볼 */
    'pkm.partner.v1.',         /* 파트너 포켓몬 */
    'pkm.shiny.v1.',           /* 이로치 */
    'pkm.mission.v1.',         /* 오늘의 미션 */
    'pkm.buff.v1.',            /* 버프 */
    'pkm.rare.v1.',            /* 희귀 포획 기록 */
    'pkm.rank.v1.',            /* 랭크 */
    'pkm.boss.v1.',            /* 보스 */
    'pkm.streak.v1.',          /* 연속 출석 */
    'pkm.wrong.v1.',           /* 🔁 오답 노트(약점 덱) — 문제·정답·틀린 횟수 */
    'pkm.stamp.v1.',           /* 🗓️ 주간 출석 스탬프(월~일) */
    'pkm.ticket.v1.',          /* 응원권 */
    'pkm.agit.healBonus',      /* 🎁 아빠 선물 — 3D 아지트 회복 3회권(슬롯별 잔여) */
    'pkm.versus.cfg.v1.',      /* 대전 설정 */
    'pkm.versus.mode.v1'/*(정확히 일치)*/
  ];
  /* 이름이 정확히 이 키들 */
  var EXACT = [
    'pkm.versus.mode.v1',
    'pkm.quota.v1',            /* 아빠가 정한 하루 판수 */
    'pkm.coins.v1',            /* 🪙 코인 지갑 — 카드팩 앱(pokemon-cards)과 함께 쓴다 */
    'mpb.profiles.v1',         /* 산수 놀이 친구(이름) */
    'hpb.profiles.v1',         /* 한글 놀이 친구(이름) */
    'epb.profiles.v1',         /* 영어 놀이 친구(이름) */
    'pkm.deck.v1.hangul',      /* 한글 낱말 덱 위치 */
    'pkm.deck.v1.english'      /* 영어 낱말 덱 위치 */
  ];
  /* 기기 전용 — 절대 클라우드로 보내지 않는다 */
  var NEVER = [
    'pkm.cloud.',              /* 동기화 자체 설정 */
    'pkm.shared.dex.v1.migrated', /* 이 기기의 1회 이전 깃발 */
    'pkm.family.pin.v1',       /* 기기 PIN */
    'pkm.family.unlocked.v1',  /* 잠금 해제(세션) */
    'pkm.mute.v1', 'mpb.mute', 'hpb.mute', 'epb.mute', /* 소리 */
    'pkm.audio.v1',            /* 🔊 볼륨(배경음·발음) — 기기별 취향이라 클라우드로 보내지 않는다 */
    'pkm.timer.v1.'            /* 타이머 표시 on/off — 기기 취향 */
  ];

  function startsWith(s, p) { return s.length >= p.length && s.slice(0, p.length) === p; }
  function neverKey(k) {
    for (var i = 0; i < NEVER.length; i++) if (startsWith(k, NEVER[i])) return true;
    return false;
  }
  function isSyncKey(k) {
    if (!k || neverKey(k)) return false;
    for (var i = 0; i < EXACT.length; i++) if (k === EXACT[i]) return true;
    for (var j = 0; j < PREFIX.length; j++) if (startsWith(k, PREFIX[j])) return true;
    return false;
  }

  /* ---------- 작은 도구 ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } }
  function jp(raw, d) {
    if (raw == null) return d;
    try { var v = JSON.parse(raw); return v == null ? d : v; } catch (e) { return d; }
  }
  function cfg() {
    return {
      url: (lsGet(K_URL) || DEF.url).replace(/\/+$/, ''),
      key: lsGet(K_KEY) || DEF.key,
      table: DEF.table,
      code: (lsGet(K_CODE) || DEF.code)
    };
  }
  function metaLoad(code) {
    var m = jp(lsGet(K_META), null);
    if (!m || typeof m !== 'object' || m.code !== code) {
      return { code: code, remoteAt: null, hash: null, lastPushAt: null, lastPullAt: null, seen: {} };
    }
    if (!m.seen || typeof m.seen !== 'object') m.seen = {};
    return m;
  }
  function metaSave(m) { lsSet(K_META, JSON.stringify(m)); }

  /* ---------- 스냅숏 · 해시 ---------- */
  function collectLocal() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || !isSyncKey(k)) continue;
        var v = localStorage.getItem(k);
        if (v != null) out[k] = v;
      }
    } catch (e) { /* */ }
    return out;
  }
  function hashOf(obj) {
    var ks = Object.keys(obj || {}).sort();
    var s = '';
    for (var i = 0; i < ks.length; i++) s += ks[i] + '\u0001' + obj[ks[i]] + '\u0002';
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var j = 0; j < s.length; j++) {
      var c = s.charCodeAt(j);
      h1 = (h1 ^ c) >>> 0; h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + c * (j + 7)) >>> 0; h2 = (h2 * 131) >>> 0;
    }
    return ks.length + ':' + h1.toString(36) + h2.toString(36);
  }

  /* ---------- '빈 값' 판정 — 클라우드에 있는 내용을 빈 값으로 덮지 않기 위한 안전장치 ---------- */
  function isBlankish(key, raw) {
    var v = jp(raw, null);
    if (startsWith(key, 'pkm.shared.dex.v1.')) {
      /* 아빠가 🗑 도감 초기화로 일부러 비운 도감(resetAt)은 '빈 값'이 아니라
         '비웠다는 기록'이다 — 이걸 빈 값으로 보면 클라우드의 옛 도감을 받아 되살려 버린다. */
      if (v && Number(v.resetAt) > 0) return false;
      /* 🗑 낱개로 지운 기록(removed)도 '올릴 거리'다 — 마지막 한 마리를 지우면 목록은 비지만
         지운 기록은 반드시 클라우드로 가야 다른 기기가 되살리지 못한다. */
      if (v && v.removed && typeof v.removed === 'object' && Object.keys(v.removed).length) return false;
      return !(v && Array.isArray(v.ids) && v.ids.length);
    }
    if (startsWith(key, 'pkm.village.v2.')) {
      if (!v || typeof v !== 'object') return true;
      var th = Object.keys(v);
      for (var i = 0; i < th.length; i++) {
        var o = v[th[i]] || {};
        if ((o.poke && o.poke.length) || (o.items && o.items.length)) return false;
      }
      return true;
    }
    if (startsWith(key, 'pkm.village.v1.')) {
      return !((v && v.poke && v.poke.length) || (v && v.items && v.items.length));
    }
    if (startsWith(key, 'pkm.village.inv.v1.') || startsWith(key, 'pkm.balls.v1.')) {
      if (!v || typeof v !== 'object') return true;
      var kk = Object.keys(v);
      for (var n = 0; n < kk.length; n++) if (Number(v[kk[n]]) > 0) return false;
      return true;
    }
    if (startsWith(key, 'pkm.shiny.v1.')) return !(Array.isArray(v) && v.length);
    if (key.indexOf('profiles.v1') >= 0) {
      var list = (v && Array.isArray(v.list)) ? v.list : [];
      for (var p = 0; p < list.length; p++) {
        var nm = list[p] && list[p].name;
        if (nm && ['첫째', '둘째', '게스트'].indexOf(String(nm).trim()) < 0) return false;
      }
      return true;
    }
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return v === '' || v === false || v === 0;
  }

  /* 로컬에 '아이가 실제로 만든' 데이터가 있는가 (빈 기기 판별) */
  function hasMeaningfulLocal(snap) {
    snap = snap || collectLocal();
    var k, i, v;
    for (k in snap) {
      if (startsWith(k, 'pkm.shared.dex.v1.')) {
        v = jp(snap[k], null);
        if (v && Array.isArray(v.ids) && v.ids.length) return true;
        if (v && Number(v.resetAt) > 0) return true;   /* 일부러 비운 도감도 올릴 거리가 있다 */
        if (v && v.removed && typeof v.removed === 'object' && Object.keys(v.removed).length) return true;   /* 지운 기록도 */
        continue;
      }
      if (k.indexOf('profiles.v1') >= 0) {
        v = jp(snap[k], null);
        var list = (v && Array.isArray(v.list)) ? v.list : [];
        for (i = 0; i < list.length; i++) {
          var nm = list[i] && list[i].name;
          if (nm && ['첫째', '둘째', '게스트'].indexOf(String(nm).trim()) < 0) return true;
        }
        continue;
      }
      if (startsWith(k, 'pkm.village.v2.')) {
        v = jp(snap[k], null);
        if (!v || typeof v !== 'object') continue;
        var th = Object.keys(v);
        for (i = 0; i < th.length; i++) {
          var o = v[th[i]] || {};
          if ((o.poke && o.poke.length) || (o.items && o.items.length)) return true;
        }
        continue;
      }
      if (startsWith(k, 'pkm.village.v1.')) {
        v = jp(snap[k], null);
        if ((v && v.poke && v.poke.length) || (v && v.items && v.items.length)) return true;
        continue;
      }
      if (startsWith(k, 'pkm.village.inv.v1.') || startsWith(k, 'pkm.balls.v1.')) {
        v = jp(snap[k], null);
        if (!v || typeof v !== 'object') continue;
        var kk = Object.keys(v);
        for (i = 0; i < kk.length; i++) if (Number(v[kk[i]]) > 0) return true;
        continue;
      }
      if (startsWith(k, 'pkm.shiny.v1.')) {
        v = jp(snap[k], null);
        if (Array.isArray(v) && v.length) return true;
        continue;
      }
      if (k === COIN_KEY) {
        v = jp(snap[k], null);
        var cat = (v && v.at) || {};
        for (i = 0; i < COIN_IDS.length; i += 1) if (Number(cat[COIN_IDS[i]]) > 0) return true;
      }
    }
    return false;
  }

  /* 데이터 '양' 점수 — 처음 연결할 때 어느 쪽이 더 많은지 비교한다 */
  function scoreOf(snap) {
    var s = 0, k, v, i;
    for (k in snap) {
      if (startsWith(k, 'pkm.shared.dex.v1.')) {
        v = jp(snap[k], null);
        if (v && Array.isArray(v.ids)) s += 3 * v.ids.length;
        continue;
      }
      if (k.indexOf('profiles.v1') >= 0) {
        v = jp(snap[k], null);
        var list = (v && Array.isArray(v.list)) ? v.list : [];
        for (i = 0; i < list.length; i++) {
          var nm = list[i] && list[i].name;
          if (nm && ['첫째', '둘째', '게스트'].indexOf(String(nm).trim()) < 0) s += 100;
        }
        continue;
      }
      if (startsWith(k, 'pkm.village.v2.')) {
        v = jp(snap[k], null);
        if (v && typeof v === 'object') {
          var th = Object.keys(v);
          for (i = 0; i < th.length; i++) {
            var o = v[th[i]] || {};
            s += 2 * ((o.poke && o.poke.length) || 0) + ((o.items && o.items.length) || 0);
          }
        }
        continue;
      }
      if (startsWith(k, 'pkm.village.inv.v1.')) {
        v = jp(snap[k], null);
        if (v && typeof v === 'object') {
          var kk = Object.keys(v);
          for (i = 0; i < kk.length; i++) s += 2 * (Number(v[kk[i]]) || 0);
        }
        continue;
      }
      if (startsWith(k, 'pkm.shiny.v1.')) {
        v = jp(snap[k], null);
        if (Array.isArray(v)) s += 2 * v.length;
        continue;
      }
      if (k === 'pkm.coins.v1') {
        v = jp(snap[k], null);
        var cc = (v && v.at) || {};
        for (i = 0; i < 3; i += 1) if (Number(cc[['arin', 'jian', 'guest'][i]]) > 0) s += 1;
      }
    }
    return s;
  }

  /* ---------- 서버(REST) ---------- */
  function api(path) {
    var c = cfg();
    return c.url + '/rest/v1/' + c.table + path;
  }
  function headers(extra) {
    var c = cfg();
    var h = {
      'apikey': c.key,
      'Authorization': 'Bearer ' + c.key,
      'Content-Type': 'application/json'
    };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  function getRow() {
    var c = cfg();
    var url = api('?code=eq.' + encodeURIComponent(c.code) + '&select=code,data,updated_at');
    return fetch(url, { headers: headers(), cache: 'no-store' }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return res.json().then(function (arr) {
        return (Array.isArray(arr) && arr.length) ? youngest(arr[0]) : null;
      });
    });
  }
  function youngest(row) {
    return { code: row.code, data: row.data || {}, updated_at: row.updated_at || null };
  }
  function putRow(payload, keepalive) {
    var c = cfg();
    var url = api('?on_conflict=code');
    return fetch(url, {
      method: 'POST',
      headers: headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([payload]),
      cache: 'no-store',
      keepalive: !!keepalive
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return true;
    });
  }
  function delRow(code) {
    var c = cfg();
    var url = api('?code=eq.' + encodeURIComponent(code));
    return fetch(url, { method: 'DELETE', headers: headers({ 'Prefer': 'return=minimal' }) }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return true;
    });
  }

  /* ============================================================
     ⏪ 이전 백업 불러오기 (3슬롯)
     ─ 스케줄 액션(scheduled-actions/포켓몬-클라우드-3슬롯-자동백업)이 매일
       아침 10:02 · 오후 16:02 · 밤 23:55 에 현재 코드의 내용을 슬롯 행
       `{code}_am` · `{code}_pm` · `{code}_night` 에 그대로 복사해 둔다.
     ─ 복원 = 그 슬롯의 data.keys 를 이 기기에 쓰고, 지금 코드({code}) 행도 같은 값으로 덮는다.
       (push() 는 '합치기'라 되돌리기가 되지 않으므로 서버 행을 직접 쓴다)
     ============================================================ */
  var SLOTS = [
    { s: 'am', suffix: '_am', name: '🌅 아침 10시', at: '10:02' },
    { s: 'pm', suffix: '_pm', name: '🌇 오후 4시', at: '16:02' },
    { s: 'night', suffix: '_night', name: '🌙 밤 12시', at: '23:55' }
  ];
  var slotMeta = { am: null, pm: null, night: null };
  var slotReady = false;

  function slotCodes() {
    var c = cfg();
    return SLOTS.map(function (s) { return c.code + s.suffix; });
  }
  /* 모달을 열 때 3슬롯의 '언제 저장됐는지'만 가볍게 읽는다(내용은 복원할 때 읽는다) */
  function loadSlots() {
    var codes = slotCodes();
    slotReady = false;
    var list = codes.map(encodeURIComponent).join(',');
    function read(sel) {
      return fetch(api('?code=in.(' + list + ')&select=' + sel), { headers: headers(), cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; });
    }
    return read('code,updated_at,backedUpAt:data->>backedUpAt').then(function (arr) {
      /* `->>` 추출을 못 쓰는 서버면 updated_at 만으로 다시 읽는다 */
      if (!Array.isArray(arr)) return read('code,updated_at');
      return arr;
    }).then(function (arr) {
      var byCode = {};
      (Array.isArray(arr) ? arr : []).forEach(function (row) { if (row && row.code) byCode[row.code] = row; });
      slotMeta = {};
      SLOTS.forEach(function (s, i) {
        var row = byCode[codes[i]];
        slotMeta[s.s] = row ? { at: row.backedUpAt || row.updated_at || null } : null;
      });
      slotReady = true;
      return slotMeta;
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* 11/16 16:02 (KST) */
  function fmtSlotAt(t) {
    if (!t) return '저장 없음';
    var d = new Date(t);
    if (!isFinite(d.getTime())) return '저장 없음';
    var k = new Date(d.getTime() + 9 * 3600 * 1000);
    return (k.getUTCMonth() + 1) + '/' + k.getUTCDate() + ' ' + pad2(k.getUTCHours()) + ':' + pad2(k.getUTCMinutes());
  }

  /* 되돌릴 때 '그 시점엔 없던 포켓몬'이 사라지도록 resetAt 을 찍는다.
     (다른 기기가 낡은 목록을 들고 push 해도 지운 것으로 처리된다 — mergeDex 규칙 그대로) */
  function markDexRestore(backupRaw, currentRaw, at) {
    var b = jp(backupRaw, null);
    if (!b || !Array.isArray(b.ids)) return backupRaw;
    var cur = jp(currentRaw, null);
    var curIds = (cur && Array.isArray(cur.ids)) ? cur.ids.map(String) : [];
    var set = {};
    b.ids.forEach(function (id) { set[String(id)] = 1; });
    var lost = curIds.some(function (id) { return !set[id]; });
    var already = Number(b.resetAt) || 0;
    if (!lost || already >= at) return backupRaw;
    b.resetAt = at;
    return JSON.stringify(b);
  }

  var lastRestoreErr = '';
  /* slotSuffix: '_am' | '_pm' | '_night'  → 'restored' | 'same' | 'empty' | 'error' */
  function restoreSlot(suffix) {
    var c = cfg();
    if (!c.code) return Promise.resolve('nocode');
    var fromCode = c.code + suffix;
    lastRestoreErr = '';
    setState('syncing', '되돌리는 중…');
    var url = api('?code=eq.' + encodeURIComponent(fromCode) + '&select=code,data,updated_at');
    return fetch(url, { headers: headers(), cache: 'no-store' }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ' ' + String(t).slice(0, 140)); });
      return res.json();
    }).then(function (arr) {
      var row = (Array.isArray(arr) && arr.length) ? arr[0] : null;
      var srcKeys = (row && row.data && row.data.keys) || null;
      if (!srcKeys || !Object.keys(srcKeys).length) return 'empty';

      var now = Date.now();
      var keys = {}, n = 0, k;
      for (k in srcKeys) {
        if (!isSyncKey(k) || typeof srcKeys[k] !== 'string') continue;
        keys[k] = startsWith(k, 'pkm.shared.dex.v1.')
          ? markDexRestore(srcKeys[k], lsGet(k), now)
          : srcKeys[k];
      }
      applying = true;
      try {
        for (k in keys) {
          if (lsGet(k) === keys[k]) continue;
          lsSet(k, keys[k]);
          n++;
        }
      } finally { applying = false; dirty = {}; }

      var nowIso = new Date(now).toISOString();
      var payload = {
        code: c.code,
        data: { v: 1, keys: keys, pushedAt: nowIso, device: deviceTag(), restoredFrom: fromCode, restoredAt: nowIso },
        updated_at: nowIso
      };
      return putRow(payload).then(function () {
        var m = metaLoad(c.code);
        m.remoteAt = nowIso;
        m.hash = hashOf(keys);
        m.lastPushAt = now;
        m.lastSyncAt = now;
        syncSeen(m, keys);
        metaSave(m);
        S.lastAt = now;
        setState('ok', '되돌렸어요 (' + n + '개)');
        try { if (bc) bc.postMessage({ t: 'pushed', code: c.code }); } catch (e) { /* */ }
        return n ? 'restored' : 'same';
      });
    }).catch(function (e) {
      lastRestoreErr = errMsg(e);
      setState('error', lastRestoreErr);
      return 'error';
    });
  }

  /* ---------- 적용(받기) ---------- */
  var applying = false;
  var dirty = {};          /* 이 기기에서 방금 바뀐 키 */
  function applyKeys(keys) {
    var changed = 0;
    applying = true;
    try {
      for (var k in keys) {
        if (!isSyncKey(k)) continue;
        var val = keys[k];
        if (typeof val !== 'string') continue;
        if (dirty[k]) continue;                  /* 방금 사용자가 만진 키는 건드리지 않는다 */
        if (lsGet(k) === val) continue;
        lsSet(k, val);
        changed++;
      }
    } finally { applying = false; }
    /* 받아 둔 도감 상태를 '본 것'으로 기억해야 나중에 뺀 포켓몽을 정확히 가려낼 수 있다 */
    try {
      var m = metaLoad(cfg().code);
      syncSeen(m, keys);
      metaSave(m);
    } catch (e) { /* */ }
    return changed;
  }

  /* ---------- 상태 · 구독자 ---------- */
  var S = {
    state: 'idle',        /* idle | syncing | ok | error | empty */
    msg: '',
    lastAt: null,
    code: null,
    changedAt: 0
  };
  var subs = [];
  function emit() {
    S.changedAt = Date.now();
    for (var i = 0; i < subs.length; i++) { try { subs[i](S); } catch (e) { /* */ } }
    try { document.dispatchEvent(new CustomEvent('pkmcloud:state', { detail: S })); } catch (e) { /* */ }
  }
  function setState(st, msg) { S.state = st; S.msg = msg || ''; emit(); }

  /* ---------- Push ---------- */
  var pushing = false;
  /* 통합 도감은 '합칩'으로 올린다 — 한 기기가 예전 상태로 덮어써도 잡은 포켓몽은 사라지지 않는다.
     단, 이 기기에서 일부러 뺀(아빠 PIN) 것은 meta.seen 과 비교해 '뺄 것'으로 확실이 처리한다. */
  function dexIds(raw) {
    var v = jp(raw, null);
    return (v && Array.isArray(v.ids)) ? v.ids.slice() : [];
  }
  /* { id: 시각 } 맵 정리 — 문자열 키·양수 시각만 남긴다 */
  function stampMap(o) {
    var out = {};
    if (o && typeof o === 'object') {
      for (var k in o) {
        var t = Number(o[k]);
        if (k && isFinite(t) && t > 0) out[String(k)] = t;
      }
    }
    return out;
  }
  function mergeStamps(a, b) {
    var out = stampMap(a), add = stampMap(b);
    for (var k in add) out[k] = Math.max(out[k] || 0, add[k]);
    return out;
  }
  /* 🎁 아빠 선물 회복권 — 슬롯별로 '마지막으로 바뀐 시각(at)'이 더 최근인 쪽을 쓴다.
     선물(+3)도 회복 사용(-1)도 at 을 갱신하므로, 낡은 기기가 예전 장수를 올려도
     방금 선물한 3장을 지우지 않고, 이미 쓴 회복권이 되살아나지도 않는다. */
  var GIFT_KEY = 'pkm.agit.healBonus.v1';
  var GIFT_SLOTS = ['p1', 'p2', 'guest'];
  function giftNum(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.round(n) : 0;
  }
  function mergeGift(remoteRaw, localRaw) {
    var r = jp(remoteRaw, null) || {}, l = jp(localRaw, null) || {};
    var ra = (r && r.at && typeof r.at === 'object') ? r.at : {};
    var la = (l && l.at && typeof l.at === 'object') ? l.at : {};
    var rs = (r && r.seen && typeof r.seen === 'object') ? r.seen : {};
    var ls = (l && l.seen && typeof l.seen === 'object') ? l.seen : {};
    var out = { v: 1, p1: 0, p2: 0, guest: 0, at: {}, seen: {} };
    for (var i = 0; i < GIFT_SLOTS.length; i++) {
      var s = GIFT_SLOTS[i];
      var rv = giftNum(r[s]), lv = giftNum(l[s]);
      var rt = giftNum(ra[s]), lt = giftNum(la[s]);
      var useLocal = lt > rt || (lt === rt && lv >= rv);
      out[s] = useLocal ? lv : rv;
      var at = Math.max(rt, lt);
      if (at > 0) out.at[s] = at;
      var seen = Math.max(giftNum(rs[s]), giftNum(ls[s]));
      if (seen > 0) out.seen[s] = Math.min(seen, at || seen);
    }
    /* 남은 장수가 0이고 바뀐 적도 없으면 키를 굳이 남기지 않는다 */
    var any = out.p1 || out.p2 || out.guest;
    for (var kk in out.at) { any = 1; break; }
    return any ? JSON.stringify(out) : '';
  }
  /* 🪙 코인 지갑 — 프로필(arin·jian·guest)별로 '마지막으로 바뀐 시각(at)'이 더 최근인 쪽을 쓴다.
     게임 1판 +10 · 카드팩 구매 -50 이 모두 at 을 갱신하므로,
     낡은 기기가 예전 코인을 올려도 방금 번 코인을 지우지 않고,
     방금 쓴 코인이 되살아나지도 않는다. 카드가 전혀 없는 쪽(at 없음)이면 기록이 있는 쪽을 남긴다. */
  var COIN_KEY = 'pkm.coins.v1';
  var COIN_IDS = ['arin', 'jian', 'guest'];
  function coinNum(v) { var n = Number(v); return isFinite(n) && n >= 0 ? Math.round(n) : null; }
  function mergeCoins(remoteRaw, localRaw) {
    var r = jp(remoteRaw, null) || {}, l = jp(localRaw, null) || {};
    var rc = (r && r.coins && typeof r.coins === 'object') ? r.coins : {};
    var lc = (l && l.coins && typeof l.coins === 'object') ? l.coins : {};
    var ra = (r && r.at && typeof r.at === 'object') ? r.at : {};
    var la = (l && l.at && typeof l.at === 'object') ? l.at : {};
    var out = { v: 1, coins: {}, at: {} };
    var any = false;
    for (var i = 0; i < COIN_IDS.length; i++) {
      var id = COIN_IDS[i];
      var rv = coinNum(rc[id]), lv = coinNum(lc[id]);
      var rt = Number(ra[id]) > 0 ? Number(ra[id]) : 0;
      var lt = Number(la[id]) > 0 ? Number(la[id]) : 0;
      var v, t;
      if (lv == null && rv == null) continue;
      if (lv == null) { v = rv; t = rt; }
      else if (rv == null) { v = lv; t = lt; }
      else if (lt > rt) { v = lv; t = lt; }
      else if (rt > lt) { v = rv; t = rt; }
      else { v = Math.max(rv, lv); t = rt; }
      out.coins[id] = v;
      if (t > 0) out.at[id] = t;
      any = true;
    }
    return any ? JSON.stringify(out) : '';
  }
  function mergeDex(remoteRaw, localRaw, prevIds) {
    var r = jp(remoteRaw, {}) || {}, l = jp(localRaw, {}) || {};
    var rIds = Array.isArray(r.ids) ? r.ids : [];
    var lIds = Array.isArray(l.ids) ? l.ids : [];
    var prev = (prevIds || []).map(String);
    var prevSet = {}, localSet = {};
    prev.forEach(function (id) { prevSet[id] = 1; });
    lIds.forEach(function (id) { localSet[String(id)] = 1; });
    /* '뻐다'라고 부를 수 있는 경우는, 이 기기가 마지막으로 본 목록의 '일부만' 빠진 때뿐이다.
       (예전 상태·다른 기기 기록이 통째로 들어오면 그건 뻔 것이 아니라 '아직 못 받은 것' → 합친다) */
    var subset = lIds.every(function (id) { return prevSet[String(id)]; });
    var guessed = subset ? prev.filter(function (id) { return !localSet[id]; }) : [];

    /* 🗑 아빠 PIN 으로 지운 기록(removed) · 🎁 다시 잡은 기록(caughtAt).
       이 두 기록이 있으면 '이 기기가 마지막으로 본 목록'과 상관없이 지운 것이 지워진 채로 남는다. */
    var rem = mergeStamps(r.removed, l.removed);
    var cau = mergeStamps(r.caughtAt, l.caughtAt);
    var rReset = Number(r.resetAt) || 0, lReset = Number(l.resetAt) || 0;
    var resetAt = Math.max(rReset, lReset);

    /* 지운 시각보다 더 최근의 '다시 잡음'이 없으면 지워진 것으로 본다 */
    function dead(id) {
      var s = String(id), t = rem[s] || 0;
      if (!t) return false;
      return (cau[s] || 0) <= t;
    }

    var seenK = {}, out = [];
    function add(id, fromResetSide, fresh) {
      var s = String(id);
      if (!s || seenK[s]) return;
      if (dead(id)) return;
      if (guessed.indexOf(s) >= 0) return;
      /* 🗑 도감 초기화(resetAt)가 있으면, 초기화한 기기의 목록이거나 그 뒤에 다시 잡은 것만 살린다.
         (아직 초기화를 못 받은 낡은 기기가 예전 목록을 올려도 되살아나지 않게)
         '그 뒤에 잡은 것'은 다시 잡은 시각(caughtAt)이 있거나, 이 기기가 마지막으로 본 목록에 없던 것이다. */
      if (resetAt && !fromResetSide && (cau[s] || 0) <= resetAt && !fresh) return;
      seenK[s] = 1; out.push(id);
    }
    var rTrust = resetAt > 0 && rReset === resetAt;
    var lTrust = resetAt > 0 && lReset === resetAt;
    rIds.forEach(function (id) { add(id, rTrust, false); });
    lIds.forEach(function (id) { add(id, lTrust, !prevSet[String(id)]); });

    var counts = {};
    [r.counts, l.counts].forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      for (var kk in c) counts[kk] = Math.max(Number(counts[kk] || 0), Number(c[kk]) || 0);
    });
    /* 날짜(가장 이른 날)·과목(합집합)도 잃지 않게 함께 합친다 */
    var dates = {}, subjects = {};
    [r, l].forEach(function (side) {
      var d = side.dates, s = side.subjects;
      if (d && typeof d === 'object') {
        for (var dk in d) {
          if (!d[dk]) continue;
          if (!dates[dk] || d[dk] < dates[dk]) dates[dk] = d[dk];
        }
      }
      if (s && typeof s === 'object') {
        for (var sk in s) {
          if (!Array.isArray(s[sk])) continue;
          var cur = subjects[sk] || [];
          s[sk].forEach(function (v) { if (cur.indexOf(v) < 0) cur.push(v); });
          subjects[sk] = cur;
        }
      }
    });
    /* 도감에 없는 포켓몬의 잡은 횟수·날짜·과목은 남기지 않는다 — 🗑 도감 초기화·낱개 삭제 뒤
       다시 잡았을 때 '예전 기록'이 되살아나지 않게. */
    for (var ck in counts) { if (!seenK[ck]) delete counts[ck]; }
    for (var dk2 in dates) { if (!seenK[dk2]) delete dates[dk2]; }
    for (var sk2 in subjects) { if (!seenK[sk2]) delete subjects[sk2]; }

    var vv = (l && l.v) || (r && r.v) || 2;
    var merged = { ids: out, counts: counts, v: vv };
    if (Object.keys(dates).length) merged.dates = dates;
    if (Object.keys(subjects).length) merged.subjects = subjects;
    /* 초기화 표시는 클라우드에 남겨 둔다 — 아직 초기화를 못 받은 기기가 예전 목록을
       올려도 위 가지에서 '옛 목록은 버린다'로 판단할 수 있게. */
    if (resetAt) merged.resetAt = resetAt;
    /* 지운 기록도 클라우드에 남겨 둔다 — 낡은 기기·구버전 탭이 예전 목록을 올려도 즉시 걸러지게.
       단 초기화(resetAt)가 더 최근이면 그 전 삭제 기록은 의미가 없어 버린다. */
    var remOut = {}, cauOut = {};
    for (var rk in rem) {
      if (resetAt && rem[rk] <= resetAt) continue;
      remOut[rk] = rem[rk];
    }
    for (var ak in cau) {
      if (!remOut[ak]) continue;                 /* 지운 적 있는 포켓몬만 기억한다(저장값이 늘어나지 않게) */
      cauOut[ak] = cau[ak];
    }
    if (Object.keys(remOut).length) merged.removed = remOut;
    if (Object.keys(cauOut).length) merged.caughtAt = cauOut;
    return JSON.stringify(merged);
  }
  function push(opts) {
    opts = opts || {};
    var c = cfg();
    if (!c.code) return Promise.resolve('nocode');
    if (pushing) return Promise.resolve('busy');
    var local = collectLocal();
    if (!opts.force && !hasMeaningfulLocal(local)) {
      setState('ok', '이 기기는 아직 비어 있어요');
      return Promise.resolve('skip-empty');
    }
    pushing = true;
    setState('syncing', '올리는 중…');
    return getRow().then(function (row) {
      var m0 = metaLoad(c.code);
      var seen = (m0 && m0.seen) || {};
      var remoteKeys = (row && row.data && row.data.keys) || {};
      var keys = {};
      var k;
      for (k in remoteKeys) if (typeof remoteKeys[k] === 'string') keys[k] = remoteKeys[k];
      var sent = 0;
      for (k in local) {
        if (remoteKeys[k] != null && isBlankish(k, local[k])) continue;   /* 빈 값으로 덮지 않는다 */
        if (startsWith(k, 'pkm.shared.dex.v1.') && remoteKeys[k] != null) {
          keys[k] = mergeDex(remoteKeys[k], local[k], seen[k]);
        } else if (k === GIFT_KEY && remoteKeys[k] != null) {
          var mg = mergeGift(remoteKeys[k], local[k]);
          keys[k] = mg || local[k];
        } else if (k === COIN_KEY && remoteKeys[k] != null) {
          var mc = mergeCoins(remoteKeys[k], local[k]);
          keys[k] = mc || local[k];
        } else {
          keys[k] = local[k];
        }
        sent++;
      }
      if (row) {
        var same = hashOf(keys) === hashOf(remoteKeys);
        if (same) {
          m0.remoteAt = row.updated_at; m0.hash = hashOf(remoteKeys); m0.lastSyncAt = Date.now();
          syncSeen(m0, keys);
          metaSave(m0);
          convergeLocal(keys, remoteKeys);
          setState('ok', '이미 같아요');
          return 'same';
        }
      }
      var nowIso = new Date().toISOString();
      var payload = {
        code: c.code,
        data: { v: 1, keys: keys, pushedAt: nowIso, device: deviceTag() },
        updated_at: nowIso
      };
      return putRow(payload, !!opts.keepalive).then(function () {
        var m = metaLoad(c.code);
        m.remoteAt = nowIso;
        m.hash = hashOf(keys);
        m.lastPushAt = Date.now();
        m.lastSyncAt = Date.now();
        syncSeen(m, keys);
        metaSave(m);
        dirty = {};
        convergeLocal(keys, remoteKeys);   /* 합쳐진 결과를 이 기기에도 되돌려 놓는다 */
        S.lastAt = Date.now();
        setState('ok', '올렸어요 (' + sent + '개)');
        try { if (bc) bc.postMessage({ t: 'pushed', code: c.code }); } catch (e) { /* */ }
        return 'pushed';
      });
    }).catch(function (e) {
      setState('error', errMsg(e));
      return 'error';
    }).then(function (r) { pushing = false; return r; });
  }

  /* 올린 뒤 로컬도 합쳐진 값으로 맞춘다(도감만) — 서버에 없는 포켓몽이 화면에만 남는 일을 막는다 */
  function convergeLocal(keys, remoteKeys) {
    applying = true;
    try {
      for (var k in keys) {
        if (!startsWith(k, 'pkm.shared.dex.v1.') && k !== GIFT_KEY && k !== COIN_KEY) continue;
        if (typeof keys[k] !== 'string') continue;
        if (lsGet(k) !== keys[k]) lsSet(k, keys[k]);
      }
    } finally { applying = false; }
  }
  function syncSeen(m, keys) {
    m.seen = m.seen || {};
    for (var k in keys) {
      if (!startsWith(k, 'pkm.shared.dex.v1.')) continue;
      m.seen[k] = dexIds(keys[k]).map(Number);
    }
  }

  function errMsg(e) {
    var s = String((e && e.message) || e || '');
    if (/HTTP 401|Invalid API key/i.test(s)) return '키 오류 (401)';
    if (/HTTP 40[34]/.test(s)) return '권한 오류';
    if (/Failed to fetch|NetworkError|load failed/i.test(s)) return '인터넷 연결 없음';
    return '동기화 실패';
  }

  function deviceTag() {
    try {
      var u = navigator.userAgent || '';
      if (/iPad|Tablet/i.test(u)) return 'tablet';
      if (/Mobile|Android|iPhone/i.test(u)) return 'phone';
      return 'pc';
    } catch (e) { return 'device'; }
  }

  /* ---------- Pull ---------- */
  var pulling = false;
  function pull(opts) {
    opts = opts || {};
    var c = cfg();
    if (!c.code) return Promise.resolve('nocode');
    if (pulling) return Promise.resolve('busy');
    pulling = true;
    setState('syncing', '받는 중…');
    return getRow().then(function (row) {
      if (!row) {
        var m0 = metaLoad(c.code);
        if (m0.remoteAt || m0.hash) { m0.remoteAt = null; m0.hash = null; metaSave(m0); }
        setState('empty', '클라우드에 아직 없어요');
        return 'noRow';
      }
      var remoteKeys = (row.data && row.data.keys) || {};
      var rh = hashOf(remoteKeys);
      var m = metaLoad(c.code);
      var remoteT = row.updated_at ? Date.parse(row.updated_at) : 0;
      var knownT = m.remoteAt ? Date.parse(m.remoteAt) : 0;
      /* 처음 연결(이 기기는 이 코드로 한 번도 맞춘 적 없음) — 더 많은 쪽을 남긴다.
         폰(기본 이름·적은 도감)이 먼저 열려도 태블릿의 진짜 기록을 덮지 않는다. */
      if (!m.remoteAt && hasMeaningfulLocal()) {
        var localSnap = collectLocal();
        if (scoreOf(localSnap) > scoreOf(remoteKeys)) {
          setState('ok', '이 기기 내용을 올렸어요');
          return push();
        }
      }
      var isNew = (rh !== m.hash) && (!m.remoteAt || !knownT || remoteT > knownT + 1000);
      var changed = 0;
      if (isNew || opts.force) changed = applyKeys(remoteKeys);
      m = metaLoad(c.code);                 /* applyKeys 가 기록한 seen 을 덮어쓰지 않도록 다시 읽는다 */
      syncSeen(m, remoteKeys);
      m.remoteAt = row.updated_at || new Date().toISOString();
      m.hash = rh;
      m.lastPullAt = Date.now();
      if (changed || isNew) m.lastSyncAt = Date.now();
      metaSave(m);
      S.lastAt = Date.now();
      if (changed) {
        setState('ok', '받았어요 (' + changed + '개)');
        notifyApplied(changed, opts);
      } else {
        setState('ok', isNew ? '최신 상태예요' : '이미 같아요');
      }
      return changed ? 'applied' : (isNew ? 'same' : 'upToDate');
    }).catch(function (e) {
      setState('error', errMsg(e));
      return 'error';
    }).then(function (r) { pulling = false; return r; });
  }

  /* 데이터가 새로 들어왔을 때 화면 갱신 — 페이지 고유 렌더러에 알리고, 필요하면 한 번 새로고침 */
  function notifyApplied(n, opts) {
    try { window.dispatchEvent(new CustomEvent('pkmcloud:applied', { detail: { count: n } })); } catch (e) { /* */ }
    try { document.dispatchEvent(new Event('pkmcloud:refresh')); } catch (e) { /* */ }
    /* 페이지들이 이미 그려 둔 화면을 다시 그리게 pageshow 를 한 번 흉내 낸다 */
    try { window.dispatchEvent(new Event('pageshow')); } catch (e) { /* */ }
    if (opts && opts.noReload) return;
    reloadSoon();
  }
  function reloadSoon() {
    try {
      var last = Number(sessionStorage.getItem('pkm.cloud.reloadAt') || 0);
      if (Date.now() - last < 20000) return;          /* 20초 안에 두 번은 새로고침하지 않는다(루프 방지) */
      sessionStorage.setItem('pkm.cloud.reloadAt', String(Date.now()));
    } catch (e) { return; }
    setTimeout(function () { try { location.reload(); } catch (e) { /* */ } }, 420);
  }

  /* ---------- 자동 저장(디바운스) ---------- */
  var tPush = null;
  function markDirty(k) {
    dirty[k] = 1;
    if (tPush) clearTimeout(tPush);
    tPush = setTimeout(function () { tPush = null; push(); }, 500);
  }
  function installHook() {
    if (window.__pkmSyncHooked) return;
    window.__pkmSyncHooked = true;
    try {
      var proto = Storage.prototype;
      var orig = proto.setItem;
      proto.setItem = function (k, v) {
        var r = orig.apply(this, arguments);
        try {
          if (this === window.localStorage && !applying && isSyncKey(String(k))) markDirty(String(k));
        } catch (e) { /* */ }
        return r;
      };
    } catch (e) { /* 훅을 못 걸어도 주기 점검으로 동작한다 */ }
  }

  /* ---------- 주기 점검 · 이벤트 ---------- */
  var bc = null;
  try { if (window.BroadcastChannel) bc = new BroadcastChannel('pkm-cloud'); } catch (e) { bc = null; }

  var lastAuto = 0;
  function autoPull(minGapMs) {
    if (document.hidden) return;
    if (Date.now() - lastAuto < (minGapMs || 0)) return;
    lastAuto = Date.now();
    /* 게임 도중에 화면이 새로고침되지 않도록 — 주기 점검은 조용히 반영만 한다 */
    pull({ noReload: true }).then(function (r) {
      if (r === 'noRow') { /* 클라우드가 비었는데 이 기기에 내용이 있으면 올린다 */ push(); }
    });
  }

  function boot() {
    installHook();
    var c = cfg();
    S.code = c.code;
    emit();
    pull({ noReload: false }).then(function (r) {
      if (r === 'noRow') {
        if (hasMeaningfulLocal()) push();
      } else if (r === 'upToDate' || r === 'same') {
        /* 이 기기에만 있는 내용(다른 기기 클라우드에 없는 키·값)이 있으면 올려 준다 */
        pushUpOnly();
      }
    });
  }

  /* 로컬에만 있는 '의미 있는' 키가 있을 때만 조용히 올린다 */
  function pushUpOnly() {
    var c = cfg();
    if (!hasMeaningfulLocal()) return Promise.resolve('skip-empty');
    return getRow().then(function (row) {
      var remoteKeys = (row && row.data && row.data.keys) || {};
      var local = collectLocal();
      var extra = 0;
      for (var k in local) {
        if (isBlankish(k, local[k])) continue;
        if (remoteKeys[k] !== local[k]) extra++;
      }
      if (extra) return push();
      return 'nochange';
    }).catch(function () { return 'error'; });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { boot(); });
    } else { setTimeout(boot, 0); }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (tPush) { clearTimeout(tPush); tPush = null; push({ keepalive: true }); }
      } else { autoPull(15000); }
    });
    window.addEventListener('pagehide', function () {
      if (tPush) { clearTimeout(tPush); tPush = null; push({ keepalive: true }); }
    });
    window.addEventListener('online', function () { autoPull(1000); });
    setInterval(function () { autoPull(90000); }, 30000);
    if (bc) bc.onmessage = function (e) { if (e && e.data && e.data.t === 'pushed' && e.data.code === cfg().code) autoPull(1000); };
  }

  /* ============================================================
     UI — 홈(pokemon-battle.html)의 ☁️ 가족 동기화 배지 · 설정 모달
     <script src="./pokemon-sync.js" data-ui="badge"></script> 로 켠다.
     ============================================================ */
  var CSS = [
    '.pkms-bar{display:flex;justify-content:center;margin:2px auto 12px;max-width:100%}',
    '.pkms-badge{display:inline-flex;align-items:center;gap:7px;max-width:100%;',
    'padding:7px 12px;border-radius:999px;border:2px solid #bce08a;background:rgba(255,255,255,.9);',
    'box-shadow:0 3px 0 rgba(70,120,30,.18);color:#2c5a17;font-weight:900;',
    'font-size:clamp(11px,3vw,13px);letter-spacing:-.02em;cursor:pointer;line-height:1.25}',
    '.pkms-badge:active{transform:translateY(2px);box-shadow:none}',
    '.pkms-badge .ci{font-size:1.05em;line-height:1}',
    '.pkms-badge .cd{font-weight:900;color:#8a4b00}',
    '.pkms-badge .st{color:#5c7a34;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46vw}',
    '.pkms-badge .dot{width:8px;height:8px;border-radius:50%;background:#9ec97a;flex:0 0 8px}',
    '.pkms-badge[data-s="syncing"] .dot{background:#ffb300;animation:pkmsPulse 1s infinite}',
    '.pkms-badge[data-s="ok"] .dot{background:#2fbf4a}',
    '.pkms-badge[data-s="error"] .dot{background:#e0473a}',
    '.pkms-badge[data-s="empty"] .dot{background:#c9c9b8}',
    '@keyframes pkmsPulse{0%,100%{opacity:.35}50%{opacity:1}}',
    '.pkms-modal{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:14px;',
    'background:rgba(18,48,10,.45);backdrop-filter:blur(2px)}',
    '.pkms-modal[hidden]{display:none}',
    '.pkms-sheet{width:min(430px,100%);max-height:86dvh;overflow:auto;background:#fffdf3;',
    'border:2.5px solid #cfe6a6;border-radius:18px;box-shadow:0 12px 30px rgba(20,60,10,.3);',
    'font-family:"Apple SD Gothic Neo","Noto Sans KR",system-ui,-apple-system,sans-serif;color:#22400f}',
    '.pkms-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:13px 14px 10px;',
    'border-bottom:2px solid #eef6dd;position:sticky;top:0;background:#fffdf3;border-radius:18px 18px 0 0}',
    '.pkms-head h2{margin:0;font-size:clamp(15px,4.2vw,18px);letter-spacing:-.03em}',
    '.pkms-x{width:30px;height:30px;flex:0 0 30px;border-radius:50%;background:#f1f9e2;border:1.5px solid #cfe6a6;',
    'font-weight:900;color:#5c7a34;font-size:14px;cursor:pointer}',
    '.pkms-body{padding:10px 14px 16px;font-size:clamp(11.5px,3.2vw,13px);font-weight:800;color:#3f5227;line-height:1.65}',
    '.pkms-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dashed #e6f0d2}',
    '.pkms-row:last-of-type{border-bottom:0}',
    '.pkms-row .lb{color:#5c7a34;flex:1 1 auto;min-width:0}',
    '.pkms-row .vl{color:#22400f;font-weight:900;text-align:right;overflow-wrap:anywhere}',
    '.pkms-code{font-size:1.25em;letter-spacing:.14em;color:#8a4b00}',
    '.pkms-btns{display:flex;flex-direction:column;gap:8px;margin:12px 0 4px}',
    '.pkms-btn{width:100%;padding:12px 10px;border-radius:14px;border:2px solid #79c94a;cursor:pointer;',
    'font-weight:900;font-size:clamp(12.5px,3.5vw,14px);letter-spacing:-.02em;',
    'background:linear-gradient(180deg,#d9f7bd,#a8e86b);color:#10340a;box-shadow:0 3px 0 rgba(70,120,30,.28)}',
    '.pkms-btn:active{transform:translateY(2px);box-shadow:none}',
    '.pkms-btn.ghost{background:linear-gradient(180deg,#fff,#f4f4e8);border-color:#dcdcd0;color:#5c7a34;',
    'box-shadow:0 3px 0 rgba(120,120,100,.2)}',
    '.pkms-btn.mini{width:auto;padding:7px 12px;font-size:clamp(11px,3vw,12.5px);border-radius:11px}',
    '.pkms-note{margin:9px 0 0;font-size:clamp(10.5px,2.9vw,12px);color:#6b8547;font-weight:800;line-height:1.6}',
    '.pkms-warn{margin:8px 0 0;padding:8px 10px;border-radius:11px;background:#fff3d6;border:1.5px solid #f0d59a;color:#8a4b00;font-size:clamp(10.5px,2.9vw,12px)}',
    '.pkms-in{width:100%;padding:10px 12px;border-radius:12px;border:2px solid #d9e9bd;background:#fff;',
    'font-family:inherit;font-weight:900;font-size:15px;color:#22400f;letter-spacing:.2em;text-align:center}',
    '.pkms-in:focus{outline:none;border-color:#79c94a;box-shadow:0 0 0 3px rgba(120,200,70,.25)}',
    '.pkms-in.txt{letter-spacing:0;text-align:left;font-size:12.5px;font-weight:700}',
    '.pkms-lb{margin:10px 2px 4px;font-size:clamp(11px,3vw,12.5px);color:#5c7a34;font-weight:900}',
    '.pkms-adv{margin-top:12px;border-top:2px solid #eef6dd;padding-top:6px}',
    '.pkms-adv summary{cursor:pointer;color:#6b8547;font-weight:900;font-size:clamp(11px,3vw,12.5px);padding:6px 0}',
    '.pkms-msg{margin:8px 0 0;min-height:14px;font-size:clamp(10.5px,2.9vw,12px);font-weight:900;color:#5c7a34}',
    '.pkms-msg.bad{color:#c0392b}',
    /* ⏪ 이전 백업 불러오기 */
    '.pkms-backups{margin-top:12px;border-top:2px solid #eef6dd;padding-top:8px}',
    '.pkms-backups .pkms-lb{margin:2px 2px 4px}',
    '.pkms-slot{display:flex;align-items:center;gap:7px;padding:7px 0;border-bottom:1px dashed #e6f0d2;flex-wrap:wrap}',
    '.pkms-slot:last-of-type{border-bottom:0}',
    '.pkms-slot .nm{font-weight:900;color:#22400f;flex:1 1 auto;min-width:88px;font-size:clamp(11.5px,3.2vw,13px)}',
    '.pkms-slot .at{font-weight:900;color:#5c7a34;font-size:clamp(10.5px,2.9vw,12px);flex:0 0 auto}',
    '.pkms-slot .at[data-empty="1"]{color:#b6bfa4}',
    '.pkms-slot .pkms-btn.mini{flex:0 0 auto}',
    '.pkms-toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,14px);z-index:2147482500;',
    'padding:11px 16px;border-radius:14px;background:rgba(34,64,15,.94);color:#fff;font-weight:900;',
    'font-size:clamp(12px,3.2vw,13.5px);max-width:min(340px,88vw);text-align:center;line-height:1.45;',
    'opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;',
    'font-family:"Apple SD Gothic Neo","Noto Sans KR",system-ui,-apple-system,sans-serif;letter-spacing:-.02em}',
    '.pkms-toast[data-on="1"]{opacity:1;transform:translate(-50%,0)}',
    '.pkms-toast.bad{background:rgba(150,32,20,.95)}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('pkmsCss')) return;
    var s = document.createElement('style');
    s.id = 'pkmsCss';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmtTime(t) {
    if (!t) return '아직 없음';
    try {
      var d = new Date(t);
      var k = new Date(d.getTime() + 9 * 3600 * 1000);
      var hh = k.getUTCHours(), mm = k.getUTCMinutes();
      var ap = hh < 12 ? '오전' : '오후';
      var h12 = hh % 12; if (h12 === 0) h12 = 12;
      return (Date.now() - t < 86400000 ? '오늘 ' : '') + ap + ' ' + h12 + ':' + String(mm).padStart(2, '0');
    } catch (e) { return '—'; }
  }

  var badgeEl = null, stEl = null;
  function badgeText(s) {
    if (s.state === 'syncing') return '동기화 중…';
    if (s.state === 'error') return s.msg || '오류';
    if (s.state === 'empty') return '아직 비었어요';
    if (s.state === 'ok' && s.lastAt) return fmtTime(s.lastAt) + ' 동기화';
    if (s.msg) return s.msg;
    return '자동 동기화';
  }
  function paintBadge() {
    if (!badgeEl) return;
    badgeEl.setAttribute('data-s', S.state);
    badgeEl.querySelector('.cd').textContent = S.code || cfg().code;
    if (stEl) stEl.textContent = badgeText(S);
    badgeEl.setAttribute('aria-label', '가족 동기화 코드 ' + (S.code || cfg().code) + ' · ' + badgeText(S));
  }

  function mountBadge() {
    if (badgeEl || !document.body) return;
    injectCSS();
    var bar = h('div', 'pkms-bar');
    badgeEl = h('button', 'pkms-badge');
    badgeEl.type = 'button';
    badgeEl.innerHTML = '<span class="ci">☁️</span><span>가족 동기화</span>' +
      '<span class="cd">' + esc(S.code || cfg().code) + '</span><span class="dot"></span>' +
      '<span class="st"></span>';
    stEl = badgeEl.querySelector('.st');
    badgeEl.addEventListener('click', openModal);
    bar.appendChild(badgeEl);
    var hero = document.querySelector('.wrap > .hero') || document.querySelector('header.hero');
    var host = document.querySelector('.wrap') || document.body;
    if (hero && hero.parentNode) hero.parentNode.insertBefore(bar, hero.nextSibling);
    else host.insertBefore(bar, host.firstChild);
    paintBadge();
  }

  /* ---------- 모달 ---------- */
  var modalEl = null, bodyEl = null;
  function openModal() {
    injectCSS();
    if (!modalEl) modalEl = buildModal();
    document.body.appendChild(modalEl);
    modalEl.hidden = false;
    renderMain();
  }
  function closeModal() { if (modalEl) modalEl.hidden = true; }
  function buildModal() {
    var m = h('div', 'pkms-modal');
    m.hidden = true;
    m.innerHTML =
      '<div class="pkms-sheet" role="dialog" aria-modal="true" aria-labelledby="pkmsTitle">' +
      '<div class="pkms-head"><h2 id="pkmsTitle">☁️ 가족 동기화</h2><button class="pkms-x" type="button" aria-label="닫기">✕</button></div>' +
      '<div class="pkms-body"></div></div>';
    bodyEl = m.querySelector('.pkms-body');
    m.querySelector('.pkms-x').addEventListener('click', closeModal);
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    return m;
  }
  function msg(t, bad) {
    var el = bodyEl.querySelector('.pkms-msg');
    if (!el) return;
    el.textContent = t || '';
    el.className = 'pkms-msg' + (bad ? ' bad' : '');
  }
  function renderMain() {
    var c = cfg();
    var m = metaLoad(c.code);
    bodyEl.innerHTML =
      '<div class="pkms-row"><span class="lb">가족 코드</span><span class="vl pkms-code">' + esc(c.code) + '</span></div>' +
      '<div class="pkms-row"><span class="lb">상태</span><span class="vl">' + esc(badgeText(S)) + '</span></div>' +
      '<div class="pkms-row"><span class="lb">마지막 동기화</span><span class="vl">' + esc(fmtTime(m.lastSyncAt)) + '</span></div>' +
      '<div class="pkms-msg"></div>' +
      '<div class="pkms-btns">' +
      '<button class="pkms-btn" type="button" data-a="push">☁️ 지금 클라우드로 올리기</button>' +
      '<button class="pkms-btn ghost" type="button" data-a="pull">⬇️ 지금 클라우드에서 받기</button>' +
      '</div>' +
      slotSectionHTML() +
      '<div class="pkms-btns">' +
      '<button class="pkms-btn mini ghost" type="button" data-a="code">🔑 가족 코드 바꾸기</button>' +
      '</div>' +
      '<p class="pkms-note">같은 코드를 쓰는 기기끼리 도감·이름·마을·아이템·판수가 자동으로 맞춰져요.<br>' +
      '태블릿에서 <b>지금 올리기</b>를 한 번 누른 뒤 폰에서 열면 바로 받아집니다.</p>' +
      '<details class="pkms-adv"><summary>⚙️ 고급 (주소 · 키)</summary>' +
      '<div class="pkms-lb">Supabase URL</div><input class="pkms-in txt" id="pkmsUrl" value="' + esc(c.url) + '" spellcheck="false">' +
      '<div class="pkms-lb">공개 키 (publishable)</div><input class="pkms-in txt" id="pkmsKey" value="' + esc(c.key) + '" spellcheck="false">' +
      '<div class="pkms-btns"><button class="pkms-btn mini ghost" type="button" data-a="savecfg">저장</button></div>' +
      '</details>';
    wiring();
    loadSlots().then(paintSlotTimes);
  }

  /* ---------- ⏪ 이전 백업 불러오기 ---------- */
  function slotSectionHTML() {
    var rows = SLOTS.map(function (s) {
      return '<div class="pkms-slot">' +
        '<span class="nm">' + s.name + '</span>' +
        '<span class="at" data-slot-at="' + s.s + '" data-empty="2">확인 중…</span>' +
        '<button class="pkms-btn mini ghost" type="button" data-slot-btn="' + s.s + '">불러오기</button>' +
        '</div>';
    }).join('');
    return '<div class="pkms-backups">' +
      '<div class="pkms-lb">⏪ 이전 백업 불러오기</div>' + rows +
      '<p class="pkms-note" style="margin-top:6px">매일 아침 10시 · 오후 4시 · 밤 12시에 자동으로 저장해 둬요.<br>' +
      '불러오면 그 시점의 도감·마을 기록으로 가족 모두 되돌려요.</p>' +
      '</div>';
  }
  function paintSlotTimes() {
    if (!bodyEl) return;
    SLOTS.forEach(function (s) {
      var el = bodyEl.querySelector('[data-slot-at="' + s.s + '"]');
      if (!el) return;
      var m = slotMeta[s.s];
      var at = m && m.at;
      el.textContent = at ? fmtSlotAt(at) : '저장 없음';
      el.setAttribute('data-empty', at ? '0' : '1');
    });
  }
  function toast(t, bad) {
    try {
      var el = document.getElementById('pkmsToast');
      if (!el) {
        el = h('div', 'pkms-toast');
        el.id = 'pkmsToast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
      }
      el.textContent = t;
      el.className = 'pkms-toast' + (bad ? ' bad' : '');
      el.setAttribute('data-on', '1');
      if (toast.__t) clearTimeout(toast.__t);
      toast.__t = setTimeout(function () { el.setAttribute('data-on', '0'); }, 2600);
    } catch (e) { /* */ }
  }
  function slotByKey(s) {
    for (var i = 0; i < SLOTS.length; i++) if (SLOTS[i].s === s) return SLOTS[i];
    return null;
  }
  function openRestore(s) {
    var slot = slotByKey(s);
    if (!slot) return;
    if (!slotReady) {
      toast('백업 목록을 불러오는 중…');
      loadSlots().then(paintSlotTimes);
      return;
    }
    if (slotMeta[s] === null) { toast('이 슬롯에는 아직 백업이 없어요', true); return; }
    renderRestore(slot);
  }
  function renderRestore(slot) {
    var at = slotMeta[slot.s] && slotMeta[slot.s].at;
    bodyEl.innerHTML =
      '<div class="pkms-lb" style="margin-top:0">⏪ ' + slot.name + ' 백업</div>' +
      '<div class="pkms-row"><span class="lb">저장 시각</span><span class="vl" data-slot-at="' + slot.s + '">' + esc(fmtSlotAt(at)) + '</span></div>' +
      '<p class="pkms-note" style="margin-top:8px;color:#8a4b00">이 시점의 도감·마을 기록으로 되돌릴까요?<br>' +
      '이 기기와 가족 클라우드가 함께 그 시점으로 맞춰져요.</p>' +
      '<div class="pkms-lb">아빠 PIN (4자리)</div>' +
      '<input class="pkms-in" id="pkmsRestorePin" inputmode="numeric" maxlength="4" type="password" placeholder="••••">' +
      '<div class="pkms-msg"></div>' +
      '<div class="pkms-btns">' +
      '<button class="pkms-btn" type="button" data-a="dorestore">⏪ 이 시점으로 되돌리기</button>' +
      '<button class="pkms-btn ghost" type="button" data-a="back">← 돌아가기</button></div>' +
      '<p class="pkms-note">되돌리면 지금 도감에 있는 포켓몬 중 그 시점에 없던 것은 사라져요.<br>' +
      '다음 백업은 다음 아침 10시 · 오후 4시 · 밤 12시에 자동 저장돼요.</p>';
    bodyEl.querySelector('[data-a="back"]').addEventListener('click', renderMain);
    var pinEl = bodyEl.querySelector('#pkmsRestorePin');
    if (pinEl) pinEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') bodyEl.querySelector('[data-a="dorestore"]').click(); });
    bodyEl.querySelector('[data-a="dorestore"]').addEventListener('click', function () {
      var btn = this;
      var pin = ((pinEl && pinEl.value) || '').replace(/\D/g, '');
      var realPin = (lsGet(K_PIN) || '').replace(/\D/g, '');
      if (pin.length !== 4) { msg('PIN 4자리를 넣어 주세요', true); return; }
      if (pin !== (realPin || '0623')) { msg('아빠 PIN이 맞지 않아요', true); return; }
      btn.disabled = true;
      msg('되돌리는 중…');
      restoreSlot(slot.suffix).then(function (r) {
        btn.disabled = false;
        if (r === 'restored' || r === 'same') {
          toast('⏪ ' + slot.name + ' 시점으로 되돌렸어요');
          msg('되돌렸어요 · 화면을 새로 고칩니다');
          setTimeout(function () { notifyApplied(1); }, 520);
        } else if (r === 'empty') {
          toast('이 슬롯에는 아직 백업이 없어요', true);
          loadSlots().then(function () { renderMain(); });
        } else {
          msg(lastRestoreErr || '되돌리지 못했어요', true);
        }
      });
    });
  }
  function wiring() {
    var p = bodyEl.querySelector('[data-a="push"]');
    if (p) p.addEventListener('click', function () {
      p.disabled = true; msg('올리는 중…');
      push({ force: false }).then(function (r) {
        p.disabled = false;
        if (r === 'pushed') { msg('클라우드에 올렸어요 ✔'); renderMain(); }
        else if (r === 'skip-empty') msg('이 기기에 올릴 내용이 아직 없어요', true);
        else if (r === 'same') msg('이미 클라우드와 같아요');
        else if (r === 'error') msg(S.msg || '실패했어요', true);
        else renderMain();
      });
    });
    var q = bodyEl.querySelector('[data-a="pull"]');
    if (q) q.addEventListener('click', function () {
      if (!confirm('클라우드에 있는 내용으로 이 기기를 맞출까요?\n(이 기기에서 아직 안 올린 최근 변경은 사라질 수 있어요)')) return;
      q.disabled = true; msg('받는 중…');
      pull({ force: true }).then(function (r) {
        q.disabled = false;
        if (r === 'applied') { msg('받았어요 · 화면을 새로 고칩니다'); }
        else if (r === 'upToDate' || r === 'same') msg('이미 최신이에요');
        else if (r === 'noRow') msg('클라우드에 아직 내용이 없어요', true);
        else msg(S.msg || '실패했어요', true);
      });
    });
    var cb = bodyEl.querySelector('[data-a="code"]');
    if (cb) cb.addEventListener('click', renderCode);
    var sv = bodyEl.querySelector('[data-a="savecfg"]');
    if (sv) sv.addEventListener('click', function () {
      var u = bodyEl.querySelector('#pkmsUrl').value.trim();
      var k = bodyEl.querySelector('#pkmsKey').value.trim();
      if (u) lsSet(K_URL, u); else lsDel(K_URL);
      if (k) lsSet(K_KEY, k); else lsDel(K_KEY);
      msg('저장했어요 · 다시 연결합니다');
      setTimeout(function () { pull(); }, 200);
    });
    var sbs = bodyEl.querySelectorAll('[data-slot-btn]');
    for (var i = 0; i < sbs.length; i++) {
      (function (el) {
        el.addEventListener('click', function () { openRestore(el.getAttribute('data-slot-btn')); });
      })(sbs[i]);
    }
  }
  function renderCode() {
    bodyEl.innerHTML =
      '<p class="pkms-note" style="margin-top:0">가족 코드는 숫자 4자리예요. 폰과 태블릿에 <b>같은 코드</b>를 넣으면 서로 맞춰집니다.</p>' +
      '<div class="pkms-lb">새 가족 코드 (4자리)</div>' +
      '<input class="pkms-in" id="pkmsNewCode" inputmode="numeric" maxlength="4" placeholder="0623">' +
      '<div class="pkms-lb">아빠 PIN (4자리)</div>' +
      '<input class="pkms-in" id="pkmsPin" inputmode="numeric" maxlength="4" type="password" placeholder="••••">' +
      '<div class="pkms-msg"></div>' +
      '<div class="pkms-btns"><button class="pkms-btn" type="button" data-a="applycode">저장하고 다시 연결</button>' +
      '<button class="pkms-btn ghost" type="button" data-a="back">← 돌아가기</button></div>' +
      '<p class="pkms-note">코드를 바꾸면 이 기기는 새 코드의 클라우드와만 맞춰져요. 기존 도감은 이 기기에 그대로 남습니다.</p>';
    bodyEl.querySelector('[data-a="back"]').addEventListener('click', renderMain);
    bodyEl.querySelector('[data-a="applycode"]').addEventListener('click', function () {
      var nc = (bodyEl.querySelector('#pkmsNewCode').value || '').replace(/\D/g, '');
      var pin = (bodyEl.querySelector('#pkmsPin').value || '').replace(/\D/g, '');
      var realPin = (lsGet(K_PIN) || '').replace(/\D/g, '');
      if (!/^\d{4}$/.test(nc)) { msg('코드는 숫자 4자리로 넣어 주세요', true); return; }
      if (pin !== (realPin || '0623')) { msg('아빠 PIN이 맞지 않아요', true); return; }
      if (nc === cfg().code) { msg('지금 쓰는 코드와 같아요'); return; }
      lsSet(K_CODE, nc);
      lsDel(K_META);
      S.code = nc;
      paintBadge();
      msg('코드를 ' + nc + '로 바꿨어요');
      pull({ noReload: true }).then(function (r) {
        if (r === 'noRow' && hasMeaningfulLocal()) push();
        setTimeout(renderMain, 350);
      });
    });
  }

  /* ---------- 화면에 붙이기 ---------- */
  function mountUI() {
    injectCSS();
    function go() {
      mountBadge();
      if (!mountBadge.__sub) {
        mountBadge.__sub = true;
        subs.push(paintBadge);
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
    document.addEventListener('pkmcloud:state', paintBadge);
  }
  try {
    var me = document.currentScript;
    if (me && /(^|\s)badge(\s|$)/.test(me.getAttribute('data-ui') || '')) mountUI();
  } catch (e) { /* */ }

  /* ---------- 바깥에 공개 ---------- */
  window.PkmSync = {
    version: VERSION,
    pull: pull,
    push: push,
    state: function () { return S; },
    cfg: cfg,
    hasMeaningfulLocal: hasMeaningfulLocal,
    isSyncKey: isSyncKey,
    collectLocal: collectLocal,
    mergeDex: mergeDex,          /* 검증용 — 지운 기록·다시 잡은 기록 합치기 규칙 */
    restoreSlot: restoreSlot,    /* ⏪ 이전 백업 복원 — '_am' | '_pm' | '_night' */
    loadSlots: loadSlots,        /* 3슬롯 최근 저장 시각 읽기 */
    slots: function () { return { meta: slotMeta, ready: slotReady, list: SLOTS }; },
    setCode: function (c) { lsSet(K_CODE, String(c)); lsDel(K_META); S.code = String(c); paintBadge(); },
    open: openModal,
    deleteCode: delRow,
    getRow: getRow,
    debug: function () { return { cfg: cfg(), meta: metaLoad(cfg().code), state: S, keys: Object.keys(collectLocal()) }; }
  };
})();
