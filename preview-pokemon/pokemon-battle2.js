/* ============================================================
   포켓몬 배틀 2탄 — 3게임(산수·한글·영어) 공통 확장 모듈
   ─ 타입별 배경 · 파트너 · 공격/피격 모션 · 진화 · 콤보
   ─ 일일 미션 · 오답 복습 · 몬스터볼 · 이로치 · 울음소리 · 타이머 OFF · 랭크
   게임 본체(math/hangul/english-pokemon.html)의 전역 함수를 감싸서(post-hook)
   화면과 저장소만 덧붙인다. 본체 로직·문제 생성은 건드리지 않는다.
   ============================================================ */
(function () {
  'use strict';
  if (window.__PB2_LOADED__) return;
  window.__PB2_LOADED__ = true;
  if (typeof S === 'undefined' || typeof GAME === 'undefined' || typeof Profiles === 'undefined') return;

  /* ---------- 0. 작은 도구 ---------- */
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const warn = (m, e) => { try { console.warn('[pb2]', m, e || ''); } catch (_) { /* */ } };
  const LSK = {
    partner: (s) => 'pkm.partner.v1.' + s,
    balls: (s) => 'pkm.balls.v1.' + s,
    shiny: (s) => 'pkm.shiny.v1.' + s,
    mission: (s) => 'pkm.mission.v1.' + s,
    buff: (s) => 'pkm.buff.v1.' + s,
    timer: (s) => 'pkm.timer.v1.' + s,
  };
  function lsGet(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* */ }
  }
  function slotId() {
    try { return slotFor(GAME, Profiles.data.active) || 'p1'; } catch (e) { return 'p1'; }
  }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  const ART2 = (id) => 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/' + id + '.png';
  const SHINY_ART = (id) => 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/shiny/' + id + '.png';
  const SHINY_SPR = (id) => 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/' + id + '.png';
  const CRY = (id) => 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/' + id + '.ogg';

  /* ---------- 1. 타입 → 배경 테마 ---------- */
  const THEME_OF = {
    물: 'lake', 얼음: 'lake',
    불꽃: 'volcano', 드래곤: 'volcano',
    전기: 'power', 강철: 'power',
    에스퍼: 'ruins', 고스트: 'ruins', 악: 'ruins',
    바위: 'canyon', 땅: 'canyon', 격투: 'canyon',
    비행: 'sky', 페어리: 'sky',
    풀: 'forest', 벌레: 'forest', 독: 'forest', 노말: 'forest',
  };
  const THEME_NAME = {
    lake: '에메랄드 호수', volcano: '붉은 화산', power: '밤하늘 발전소',
    ruins: '보랏빛 유적', canyon: '황토 협곡', sky: '구름 꽃밭', forest: '상록수 숲',
  };
  function themeFor(p) {
    const t = (p && p.types && p.types[0]) || '노말';
    return THEME_OF[t] || 'forest';
  }

  /* ---------- 2. 타입 → 공격 이펙트 ---------- */
  const ATK = {
    물: { k: 'water', n: '물대포', f: 560 }, 얼음: { k: 'ice', n: '냉동빔', f: 900 },
    불꽃: { k: 'fire', n: '화염방사', f: 320 }, 드래곤: { k: 'dragon', n: '드래곤브레스', f: 200 },
    전기: { k: 'elec', n: '백만볼트', f: 1200 }, 강철: { k: 'steel', n: '메탈클로', f: 700 },
    에스퍼: { k: 'psychic', n: '염동력', f: 1000 }, 고스트: { k: 'ghost', n: '섀도볼', f: 240 },
    악: { k: 'dark', n: '악의파동', f: 180 }, 바위: { k: 'rock', n: '스톤샤워', f: 260 },
    땅: { k: 'ground', n: '모래뿌리기', f: 200 }, 비행: { k: 'flying', n: '제비반환', f: 1400 },
    페어리: { k: 'fairy', n: '문포스', f: 1500 }, 풀: { k: 'grass', n: '잎날가르기', f: 760 },
    벌레: { k: 'bug', n: '벌레먹기', f: 620 }, 독: { k: 'poison', n: '독찌르기', f: 420 },
    노말: { k: 'normal', n: '몸통박치기', f: 500 }, 격투: { k: 'fight', n: '인파이트', f: 380 },
  };
  const atkOf = (t) => ATK[t] || ATK.노말;

  /* ---------- 3. 확장 상태 ---------- */
  const PB = {
    partnerId: 0,
    combo: 0,
    bestCombo: 0,
    balls: { super: 2, hyper: 0, master: 0 },
    ball: 'poke',
    wrong: [],
    shiny: new Set(),
    evo: {},
    rv: null,
    audio: null,
    cryAt: 0,
  };
  const EVO_RATE = 0.5;
  const SHINY_RATE = 0.015;

  function partner() {
    try { return Partner.pokemon(); } catch (e) { return null; }
  }
  function partnerType() { const p = Partner.pokemon(); return (p && p.types && p.types[0]) || '노말'; }

  /* ---------- 4. 저장소(프로필 슬롯 공유) ---------- */
  const Partner = {
    key() { return LSK.partner(slotId()); },
    /* 잡은 포켓몬만 파트너가 될 수 있다 */
    caught(id) {
      try { return !!(id && byId(id) && S.dex && S.dex.ids && S.dex.ids.has(Number(id))); } catch (e) { return false; }
    },
    pokemon() { try { return Partner.caught(PB.partnerId) ? byId(PB.partnerId) : null; } catch (e) { return null; } },
    load() {
      const raw = lsGet(Partner.key(), null);
      const id = Number(raw);
      if (Partner.caught(id)) { PB.partnerId = id; return; }
      /* 잡은 적 없는 포켓몬이 저장돼 있으면 지운다 */
      if (Number.isFinite(id) && id > 0) lsSet(Partner.key(), 0);
      PB.partnerId = 0;
      /* 아직 파트너가 없으면 처음 잡은 몬스터를 자동 등록 (잡은 게 없으면 파트너 없음) */
      let first = 0;
      try {
        const dates = (S.dex && S.dex.dates) || {};
        const ids = Array.from((S.dex && S.dex.ids) || []).filter((n) => byId(n));
        ids.sort((a, b) => String(dates[a] || '9999').localeCompare(String(dates[b] || '9999')) || a - b);
        if (ids.length) first = ids[0];
      } catch (e) { /* */ }
      if (first) {
        PB.partnerId = first;
        lsSet(Partner.key(), first);
      }
    },
    set(id) {
      if (!Partner.caught(id)) return false;
      PB.partnerId = Number(id);
      lsSet(Partner.key(), PB.partnerId);
      UI.partner();
      UI.detailPartnerBtn();
      return true;
    },
  };

  const Balls = {
    load() {
      const b = lsGet(LSK.balls(slotId()), null) || {};
      PB.balls = {
        super: Number.isFinite(b.super) ? Math.max(0, b.super) : 2,
        hyper: Number.isFinite(b.hyper) ? Math.max(0, b.hyper) : 0,
        master: Number.isFinite(b.master) ? Math.max(0, b.master) : 0,
      };
    },
    save() { lsSet(LSK.balls(slotId()), PB.balls); },
    add(add, quiet) {
      Object.keys(add).forEach((k) => { PB.balls[k] = Math.max(0, (PB.balls[k] || 0) + add[k]); });
      Balls.save();
      UI.renderBalls();
      if (!quiet) {
        const parts = Object.keys(add).filter((k) => add[k] > 0)
          .map((k) => BALLS[k].name + ' ×' + add[k]);
        if (parts.length) UI.toast(parts.join(' · ') + ' 획득!', 'good', 1500);
      }
    },
    take(k) {
      if (k === 'poke') return true;
      if (!PB.balls[k]) return false;
      PB.balls[k] -= 1;
      Balls.save();
      UI.renderBalls();
      return true;
    },
  };
  const BALLS = {
    poke: { name: '몬스터볼', dmg: 1 },
    super: { name: '슈퍼볼', dmg: 2 },
    hyper: { name: '하이퍼볼', dmg: 3 },
    master: { name: '마스터볼', dmg: 0 },
  };
  const ballDmg = () => (BALLS[PB.ball] ? BALLS[PB.ball].dmg : 1);

  const Shiny = {
    load() {
      const a = lsGet(LSK.shiny(slotId()), []);
      PB.shiny = new Set(Array.isArray(a) ? a.filter((n) => Number.isFinite(n)) : []);
    },
    has(id) { return PB.shiny.has(id); },
    add(id) {
      PB.shiny.add(id);
      lsSet(LSK.shiny(slotId()), Array.from(PB.shiny));
    },
  };

  const TimerPref = {
    off() { return lsGet(LSK.timer(slotId()), 'on') === 'off'; },
    set(off) {
      lsSet(LSK.timer(slotId()), off ? 'off' : 'on');
      if (off) { try { cancelAnimationFrame(S.raf); } catch (e) { /* */ } }
      UI.timer();
      if (!off) { try { startTimer(); } catch (e) { /* */ } }
      else { try { renderTimer(); } catch (e) { /* */ } }
    },
  };

  const Mission = {
    get() {
      const today = todayKey();
      let m = lsGet(LSK.mission(slotId()), null);
      if (!m || typeof m !== 'object' || m.date !== today) m = { date: today, done: {}, reward: false };
      return m;
    },
    save(m) { lsSet(LSK.mission(slotId()), m); },
    mark(game) {
      const m = Mission.get();
      m.done[game] = true;
      const all = ['math', 'hangul', 'english'].every((g) => m.done[g]);
      let rewarded = false;
      if (all && !m.reward) { m.reward = true; rewarded = true; }
      Mission.save(m);
      UI.missionBadge();
      if (rewarded) Mission.reward();
      return rewarded;
    },
    reward() {
      lsSet(LSK.buff(slotId()), { date: todayKey(), legend: true });
      Balls.add({ super: 2, hyper: 1 }, true);
      UI.missionRewardNote();
      UI.toast('🎉 오늘의 미션 완료! 전설 확률 UP + 볼 보상!', 'good', 2600);
      try { Sound.fanfare(); } catch (e) { /* */ }
    },
    buffOn() {
      const b = lsGet(LSK.buff(slotId()), null);
      return !!(b && b.date === todayKey() && b.legend);
    },
  };

  function legendBoost() {
    if (!Mission.buffOn()) return null;
    if (Math.random() > 0.05) return null;   /* 미션 버프 전설 확률 12% → 5% */
    const pool = POKEMON.filter((p) => !p.form && (p.leg || p.myth));
    if (!pool.length) return null;
    const p = pick(pool);
    return Object.assign({}, p, { level: rand(20, 50), cp: rand(400, 900) });
  }

  /* ---------- 5. 울음소리 ---------- */
  /* 🔊 볼륨 분리 — 울음소리는 '발음·효과음' 쪽 크기를 따른다(설정 없으면 예전 그대로) */
  function voiceLevel() {
    try { return window.PKMAudio ? window.PKMAudio.voice() : 1; } catch (e) { return 1; }
  }
  function playCry(id, force) {
    try {
      if (typeof Sound !== 'undefined' && Sound.muted) return;
      const now = Date.now();
      if (!force && now - PB.cryAt < 2500) return;
      PB.cryAt = now;
      const a = PB.audio || (PB.audio = new Audio());
      a.pause();
      a.src = CRY(id);
      a.volume = 0.5 * voiceLevel();
      const pr = a.play();
      if (pr && pr.catch) pr.catch(() => { /* 자동재생 차단 등은 조용히 무시 */ });
    } catch (e) { /* */ }
  }

  /* ---------- 6. 화면 구성 ---------- */
  const UI = {
    toast(msg, kind, ms) { try { toast(msg, kind || 'info', ms || 1300); } catch (e) { /* */ } },

    stage() {
      const stage = q('#stage');
      if (!stage || q('#pb2Bg')) return;
      const bg = document.createElement('div');
      bg.className = 'pb2-bg';
      bg.id = 'pb2Bg';
      bg.setAttribute('data-theme', 'forest');
      bg.setAttribute('aria-hidden', 'true');
      bg.innerHTML = '<i class="pb2-sky"></i><i class="pb2-far"></i><i class="pb2-mid"></i>'
        + '<i class="pb2-ground"></i><i class="pb2-motes" id="pb2Motes"></i>';
      stage.insertBefore(bg, stage.firstChild);
      try { if (window.POK_ART) window.POK_ART.battle(bg); } catch (e) { /* */ }

      const banner = document.createElement('div');
      banner.className = 'pb2-banner';
      banner.id = 'pb2Banner';
      banner.hidden = true;
      banner.innerHTML = '<b id="pb2BannerText"></b>';
      stage.appendChild(banner);

      const evo = document.createElement('div');
      evo.className = 'pb2-evo';
      evo.id = 'pb2Evo';
      evo.hidden = true;
      evo.setAttribute('aria-hidden', 'true');
      evo.innerHTML = '<i class="pb2-pillar"></i><i class="pb2-ring"></i><i class="pb2-ring"></i><i class="pb2-ring"></i>';
      stage.appendChild(evo);

      const shinyLight = document.createElement('div');
      shinyLight.className = 'pb2-shinylight';
      shinyLight.id = 'pb2ShinyLight';
      shinyLight.hidden = true;
      shinyLight.setAttribute('aria-hidden', 'true');
      stage.appendChild(shinyLight);

      const p = document.createElement('div');
      p.className = 'pb2-partner';
      p.id = 'pb2Partner';
      p.setAttribute('role', 'button');
      p.tabIndex = 0;
      p.setAttribute('aria-label', '파트너 포켓몬 바꾸기');
      p.innerHTML = '<b class="pb2-combo" id="pb2Combo" hidden></b>'
        + '<img id="pb2PartnerImg" alt="" decoding="async">'
        + '<span class="pb2-pname" id="pb2PartnerName">파트너 없음</span>'
        + '<span class="pb2-pswap" aria-hidden="true">🔄</span>';
      p.addEventListener('click', (e) => {
        e.stopPropagation();
        try { Sound.ensure(); Sound.click(); } catch (_) { /* */ }
        UI.partnerModal();
      });
      p.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); UI.partnerModal(); }
      });
      stage.appendChild(p);
    },

    balls() {
      const controls = q('.controls');
      if (!controls || q('#pb2Balls')) return;
      const host = document.createElement('div');
      host.className = 'pb2-balls';
      host.id = 'pb2Balls';
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label', '몬스터볼 선택');
      controls.insertBefore(host, controls.firstChild);
      host.addEventListener('click', (e) => {
        const b = e.target.closest('.pb2-ball');
        if (!b) return;
        const k = b.dataset.ball;
        try { Sound.ensure(); Sound.click(); } catch (_) { /* */ }
        if (k === 'master') { instantCapture(); return; }
        if (k !== 'poke' && !PB.balls[k]) {
          UI.toast(BALLS[k].name + '이 없어요 — 미션·복습·콤보로 모아요!', 'info', 1600);
          return;
        }
        PB.ball = k;
        UI.renderBalls();
      });
      UI.renderBalls();
    },

    renderBalls() {
      const host = q('#pb2Balls');
      if (!host) return;
      if (PB.ball !== 'poke' && !PB.balls[PB.ball]) PB.ball = 'poke';
      const rows = [
        ['poke', '기본', '1칸', ''],
        ['super', '슈퍼', '2칸', PB.balls.super],
        ['hyper', '하이퍼', '3칸', PB.balls.hyper],
        ['master', '마스터', '즉시', PB.balls.master],
      ];
      host.innerHTML = rows.map(([k, nm, dmg, ct]) =>
        '<button class="pb2-ball' + (PB.ball === k ? ' on' : '') + (k !== 'poke' && !ct ? ' dim' : '')
        + '" data-ball="' + k + '" aria-label="' + BALLS[k].name + '">'
        + '<i class="dot"></i><span class="nm">' + nm + '</span>'
        + '<span class="dmg">' + dmg + '</span>'
        + (k === 'poke' ? '' : '<span class="ct">×' + ct + '</span>')
        + '</button>').join('');
    },

    partner() {
      const img = q('#pb2PartnerImg');
      const nm = q('#pb2PartnerName');
      const host = q('#pb2Partner');
      const p = partner();
      if (host) {
        host.classList.toggle('empty', !p);
        host.setAttribute('data-type', (p && p.types && p.types[0]) || '');
        host.title = p ? (p.name + ' · 눌러서 파트너 바꾸기') : '눌러서 파트너 고르기';
        host.setAttribute('aria-label', p ? p.name + ' 파트너 · 눌러서 바꾸기' : '파트너 없음 · 눌러서 고르기');
      }
      if (img) {
        if (p) {
          img.style.display = '';
          img.onerror = () => { img.onerror = null; img.src = ART2(p.id); };
          img.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + p.id + '.png';
          img.alt = p.name;
        } else {
          img.style.display = 'none';
          img.removeAttribute('src');
          img.alt = '';
        }
      }
      if (nm) nm.textContent = p ? p.name : '파트너 없음';
    },

    partnerModal() {
      const grid = q('#pb2PartnerGrid');
      if (!grid) return;
      const ids = Array.from((S.dex && S.dex.ids) || []).filter((n) => byId(n));
      if (!ids.length) {
        UI.toast('먼저 몬스터를 잡으면 파트너로 삼을 수 있어요!', 'info', 1800);
        return;
      }
      ids.sort((a, b) => a - b);
      grid.innerHTML = ids.map((id) => {
        const p = byId(id);
        return '<button class="pb2-pcard' + (id === PB.partnerId ? ' on' : '') + '" data-id="' + id + '">'
          + '<img loading="lazy" decoding="async" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + id + '.png" alt="">'
          + '<span>' + esc(p.name) + '</span></button>';
      }).join('');
      const note = q('#pb2PartnerNote');
      if (note) note.textContent = '잡은 ' + ids.length + '마리 중에서 고를 수 있어요';
      try { openModal('pb2PartnerModal'); } catch (e) { /* */ }
    },

    missionBtn() {
      const menu = q('#menu');
      if (!menu || q('#pb2MissionBtn')) return;
      const b = document.createElement('button');
      b.className = 'mbtn';
      b.id = 'pb2MissionBtn';
      b.innerHTML = '<span class="ico">🎯</span><span class="txt">미션</span><span class="badge" id="pb2MissionBadge">0/3</span>';
      menu.appendChild(b);
      b.addEventListener('click', () => {
        try { Sound.ensure(); Sound.click(); } catch (_) { /* */ }
        UI.missionModal();
      });
    },

    missionBadge() {
      const el = q('#pb2MissionBadge');
      if (!el) return;
      const m = Mission.get();
      const n = ['math', 'hangul', 'english'].filter((g) => m.done[g]).length;
      el.innerHTML = n + '<span class="mb-all">/3</span>';
      el.style.background = n >= 3 ? '#2ea11c' : '';
      el.title = '오늘의 미션 ' + n + '/3';
    },

    rank() {
      const chip = q('#profileChip');
      if (!chip) return;
      let el = q('#pb2Rank');
      if (!el) {
        el = document.createElement('b');
        el.id = 'pb2Rank';
        el.className = 'pb2-rank';
        const caret = chip.querySelector('.caret');
        if (caret) chip.insertBefore(el, caret); else chip.appendChild(el);
      }
      const n = (S.dex && S.dex.ids) ? S.dex.ids.size : 0;
      const r = rankOf(n);
      el.innerHTML = '<span class="re">' + r.emoji + '</span><span class="rt">' + r.label + '</span>';
      el.title = '트레이너 랭크 ' + r.emoji + ' ' + r.label + ' · 잡은 ' + n + '마리';
    },

    theme(p) {
      const bg = q('#pb2Bg');
      const stage = q('#stage');
      if (!bg || !stage) return;
      const key = themeFor(p);
      if (bg.dataset.theme === key) return;
      bg.dataset.theme = key;
      stage.classList.toggle('pb2-themed', key !== 'forest');
      bg.setAttribute('aria-label', THEME_NAME[key] + ' 배경');
      UI.motes(key);
      try { if (window.POK_ART) window.POK_ART.battle(bg); } catch (e) { /* */ }
    },

    motes(key) {
      const host = q('#pb2Motes');
      if (!host) return;
      host.innerHTML = '';
      const style = {
        lake: { n: 12, w: [3, 6], c: '#e8fdff', a: 'pb2-down', d: [3.4, 6.5] },
        volcano: { n: 16, w: [3, 6], c: '#ffb347', a: 'pb2-up', d: [2.6, 5.2] },
        power: { n: 10, w: [2, 4], c: '#ffe873', a: 'pb2-twinkle', d: [1.8, 3.6] },
        ruins: { n: 14, w: [3, 6], c: '#e2b6ff', a: 'pb2-twinkle', d: [2.2, 4.4] },
        canyon: { n: 10, w: [3, 6], c: '#ffe6b0', a: 'pb2-drift', d: [4.5, 8] },
        sky: { n: 12, w: [5, 9], c: '#ffc0e0', a: 'pb2-down', d: [5, 9] },
        forest: { n: 8, w: [3, 5], c: '#f5ffcf', a: 'pb2-drift', d: [5, 9] },
      }[key] || { n: 8, w: [3, 5], c: '#fff', a: 'pb2-up', d: [4, 7] };
      for (let i = 0; i < style.n; i += 1) {
        const s = document.createElement('i');
        s.className = 'pb2-mote';
        const w = style.w[0] + Math.random() * (style.w[1] - style.w[0]);
        s.style.cssText = 'left:' + (Math.random() * 100).toFixed(1) + '%;top:'
          + (style.a === 'pb2-up' ? (55 + Math.random() * 42) : style.a === 'pb2-down' ? (Math.random() * 30) : (Math.random() * 80))
          + '%;width:' + w.toFixed(1) + 'px;height:' + w.toFixed(1) + 'px;background:' + style.c
          + ';animation:' + style.a + ' ' + (style.d[0] + Math.random() * (style.d[1] - style.d[0])).toFixed(2)
          + 's linear ' + (Math.random() * 4).toFixed(2) + 's infinite';
        host.appendChild(s);
      }
    },

    banner(kind, text, ms) {
      const b = q('#pb2Banner');
      const t = q('#pb2BannerText');
      if (!b || !t) return;
      b.hidden = false;
      b.dataset.kind = kind || 'evo';
      b.style.animation = 'none';
      void b.offsetWidth;
      b.style.animation = '';
      t.textContent = text;
      clearTimeout(UI._bt);
      UI._bt = setTimeout(() => { b.hidden = true; }, ms || 2400);
    },

    evo(p) {
      const el = q('#pb2Evo');
      if (!el) return;
      const t = (p && p.types && p.types[0]) || '노말';
      el.dataset.el = atkOf(t).k;
      el.hidden = false;
      el.querySelectorAll('.pb2-ring, .pb2-pillar').forEach((n) => {
        n.style.animation = 'none';
        void n.offsetWidth;
        n.style.animation = '';
      });
      clearTimeout(UI._et);
      UI._et = setTimeout(() => { el.hidden = true; }, 1600);
    },

    shinyLight(on) {
      const el = q('#pb2ShinyLight');
      if (el) el.hidden = !on;
    },

    combo() {
      const el = q('#pb2Combo');
      if (!el) return;
      if (PB.combo >= 2) {
        el.hidden = false;
        el.textContent = '🔥 ×' + PB.combo;
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
      } else {
        el.hidden = true;
      }
    },

    timer() {
      const strip = q('.timerstrip');
      const off = TimerPref.off();
      if (strip) strip.classList.toggle('pb2-notimer', off);
      const num = q('#timerNum');
      const fill = q('#timerFill');
      const bar = q('#timerBar');
      if (off) {
        if (fill) fill.style.transform = 'scaleX(1)';
        if (num) num.textContent = '⏱️ OFF';
        if (bar) bar.classList.remove('warn', 'crit');
      }
    },

    timerGrid() {
      const body = q('#settingsModal .sheet-body');
      if (!body || q('#pb2TimerGrid')) return;
      const h = document.createElement('h3');
      h.className = 'sect';
      h.textContent = '⏱️ 시간제한 (30초)';
      const g = document.createElement('div');
      g.className = 'pb2-timgrid';
      g.id = 'pb2TimerGrid';
      g.innerHTML = '<button data-timer="on"><b>⏱️ 켜기</b><span>30초 안에 풀어요 · 기본</span></button>'
        + '<button data-timer="off"><b>🐢 끄기</b><span>천천히 모드 · 시간 압박 없음</span></button>';
      const note = body.querySelector('.setnote');
      if (note) { body.insertBefore(g, note); body.insertBefore(h, g); }
      else { body.appendChild(h); body.appendChild(g); }
      g.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-timer]');
        if (!b) return;
        try { Sound.ensure(); Sound.click(); } catch (_) { /* */ }
        const off = b.dataset.timer === 'off';
        TimerPref.set(off);
        UI.paintTimerGrid();
        UI.toast(off ? '🐢 천천히 모드 — 시간제한 없이 풀어요' : '⏱️ 시간제한 30초 켜짐', 'info', 1500);
      });
    },

    paintTimerGrid() {
      const off = TimerPref.off();
      qa('#pb2TimerGrid button').forEach((b) => {
        b.classList.toggle('on', (b.dataset.timer === 'off') === off);
      });
    },

    /* 🔊 소리 크기 — 배경음과 단어 발음·효과음을 따로 (⚙️ 설정 안에서 바로 조절) */
    audioGrid() {
      const body = q('#settingsModal .sheet-body');
      if (!body || q('#pb2AudioBlock')) return;
      if (!window.PKMAudio) return;
      const h = document.createElement('h3');
      h.className = 'sect';
      h.id = 'pb2AudioTitle';
      h.textContent = '🔉 소리 크기';
      const box = document.createElement('div');
      box.className = 'pb2-audiogrid';
      box.id = 'pb2AudioBlock';
      const note = body.querySelector('.setnote');
      if (note) { body.insertBefore(box, note); body.insertBefore(h, box); }
      else { body.appendChild(h); body.appendChild(box); }
      try {
        window.PKMAudio.renderInto(box, { note: '🔊 버튼은 전체 끄기 · 길게 누르면 이 창을 바로 열 수 있어요' });
      } catch (e) { warn('audio grid', e); }
    },

    missionModal() {
      const list = q('#pb2MissionList');
      if (!list) return;
      const m = Mission.get();
      const rows = [
        ['math', '⚡', '산수 배틀'],
        ['hangul', '📖', '한글 배틀'],
        ['english', '🔤', '영어 배틀'],
      ];
      list.innerHTML = rows.map(([g, ic, nm]) =>
        '<div class="pb2-mrow' + (m.done[g] ? ' done' : '') + '">'
        + '<span class="mi">' + ic + '</span>'
        + '<span class="mt">' + nm + '<small>' + (m.done[g] ? '오늘 클리어!' : '몬스터 1마리 잡기 (한 판)') + '</small></span>'
        + '<span class="mk">' + (m.done[g] ? '✅' : '⬜') + '</span></div>').join('');
      const rw = q('#pb2MissionReward');
      if (rw) {
        const buff = Mission.buffOn();
        rw.innerHTML = '<span class="' + (m.reward ? '' : 'off') + '">' + (m.reward ? '🎉 전설 확률 UP (오늘)' : '전설 확률 UP') + '</span>'
          + '<span class="' + (m.reward ? '' : 'off') + '">슈퍼볼 ×2</span>'
          + '<span class="' + (m.reward ? '' : 'off') + '">하이퍼볼 ×1</span>'
          + (buff ? '<span>지금 적용 중!</span>' : '');
      }
      UI.missionBadge();
      try { openModal('pb2MissionModal'); } catch (e) { /* */ }
    },

    missionRewardNote() {
      const modal = q('#catchModal');
      if (!modal) return;
      const body = modal.querySelector('.body');
      if (!body || body.querySelector('.pb2-missiondone')) return;
      const d = document.createElement('div');
      d.className = 'pb2-mreward pb2-missiondone';
      d.innerHTML = '<span>🎉 오늘의 미션 완료!</span><span>전설 UP</span><span>슈퍼볼 ×2</span><span>하이퍼볼 ×1</span>';
      const row = body.querySelector('.btnrow');
      if (row) body.insertBefore(d, row); else body.appendChild(d);
    },

    detailPartnerBtn() {
      const foot = q('#detailModal .sheet-foot');
      if (!foot) return;
      if (!q('#pb2PartnerBtn')) {
        const b = document.createElement('button');
        b.id = 'pb2PartnerBtn';
        b.className = 'pb2-pbtn';
        b.addEventListener('click', () => {
          try { Sound.ensure(); Sound.click(); } catch (_) { /* */ }
          const id = Number(UI._detailId);
          if (!id) return;
          if (!S.dex.ids.has(id)) { UI.toast('아직 잡지 못한 몬스터예요', 'info', 1100); return; }
          Partner.set(id);
          const p = byId(id);
          UI.toast('🤝 ' + (p ? p.name : '포켓몬') + ' 파트너 지정!', 'good', 1500);
          playCry(id, true);
        });
        foot.appendChild(b);
      }
      const btn = q('#pb2PartnerBtn');
      const id = Number(UI._detailId);
      const on = id && id === PB.partnerId;
      btn.textContent = on ? '⭐ 지금 파트너' : '🤝 파트너로 지정';
      btn.classList.toggle('on', !!on);

      if (!q('#pb2CryBtn')) {
        const c = document.createElement('button');
        c.id = 'pb2CryBtn';
        c.className = 'pb2-crybtn';
        c.textContent = '🔊 울음소리';
        c.addEventListener('click', () => {
          const iid = Number(UI._detailId);
          if (iid) playCry(iid, true);
        });
        foot.insertBefore(c, btn);
      }

      let sm = q('#pb2ShinyTag');
      if (id && Shiny.has(id)) {
        if (!sm) {
          sm = document.createElement('span');
          sm.id = 'pb2ShinyTag';
          sm.className = 'detrank';
          sm.style.cssText = 'color:#c98a10;background:#fff6d2;border:1.5px solid #e8c25a;border-radius:999px;padding:1px 8px;font-weight:900;font-size:11px';
          const meta = q('#detailModal .detmeta');
          if (meta) meta.appendChild(sm);
        }
        sm.textContent = '✨ 이로치';
      } else if (sm) {
        sm.remove();
      }
    },

    reviewBtn(modalId) {
      const body = q('#' + modalId + ' .body');
      if (!body) return;
      let b = body.querySelector('.pb2-reviewbtn');
      if (!PB.wrong.length) { if (b) b.remove(); return; }
      if (!b) {
        b = document.createElement('button');
        b.className = 'pb2-reviewbtn';
        b.addEventListener('click', () => Review.open());
        body.appendChild(b);
      }
      b.textContent = '📝 틀린 ' + PB.wrong.length + '문제 복습하기';
    },

    modals() {
      if (q('#pb2MissionModal')) return;
      const mk = document.createElement('div');
      mk.className = 'modal';
      mk.id = 'pb2MissionModal';
      mk.hidden = true;
      mk.innerHTML = '<div class="sheet">'
        + '<div class="sheet-head"><h2>🎯 오늘의 미션</h2>'
        + '<button class="x" data-pb2close="pb2MissionModal">✕</button></div>'
        + '<div class="sheet-body">'
        + '<p class="pb2-mnote">산수·한글·영어에서 각각 <b>1마리</b> 이상 잡으면 오늘의 미션 완료!<br>보상은 하루 한 번, 자정에 새로 시작해요.</p>'
        + '<div class="pb2-mission-list" id="pb2MissionList"></div>'
        + '<div class="pb2-mreward" id="pb2MissionReward"></div>'
        + '</div>'
        + '<div class="sheet-foot pb2-setfoot"><button class="pb2-confirm" data-pb2close="pb2MissionModal">확인</button></div>'
        + '</div>';

      const rk = document.createElement('div');
      rk.className = 'modal';
      rk.id = 'pb2ReviewModal';
      rk.hidden = true;
      rk.innerHTML = '<div class="sheet">'
        + '<div class="sheet-head"><h2>📝 틀린 문제 복습</h2>'
        + '<button class="x" data-pb2close="pb2ReviewModal">✕</button></div>'
        + '<div class="sheet-body" id="pb2ReviewBody"></div>'
        + '<div class="sheet-foot" id="pb2ReviewFoot" hidden>'
        + '<button class="pb2-confirm" id="pb2ReviewGo">계속 모험 ⚡</button></div>'
        + '</div>';

      const pk = document.createElement('div');
      pk.className = 'modal';
      pk.id = 'pb2PartnerModal';
      pk.hidden = true;
      pk.innerHTML = '<div class="sheet">'
        + '<div class="sheet-head"><h2>🤝 파트너 고르기</h2>'
        + '<button class="x" data-pb2close="pb2PartnerModal">✕</button></div>'
        + '<div class="sheet-body">'
        + '<p class="pb2-mnote" id="pb2PartnerNote">잡은 포켓몬 중에서 고를 수 있어요</p>'
        + '<div class="pb2-pgrid" id="pb2PartnerGrid"></div>'
        + '</div>'
        + '<div class="sheet-foot pb2-setfoot"><button class="pb2-confirm" data-pb2close="pb2PartnerModal">닫기</button></div>'
        + '</div>';

      document.body.appendChild(mk);
      document.body.appendChild(rk);
      document.body.appendChild(pk);
      pk.addEventListener('click', (e) => {
        const card = e.target.closest('.pb2-pcard');
        if (card) {
          const id = Number(card.dataset.id);
          try { Sound.ensure(); Sound.click(); } catch (_) { /* */ }
          if (Partner.set(id)) {
            const p = byId(id);
            UI.toast('🤝 ' + (p ? p.name : '포켓몬') + ' 파트너!', 'good', 1400);
            playCry(id, true);
            pk.hidden = true;
            try { syncPause(); } catch (_) { /* */ }
          }
          return;
        }
        if (e.target === pk) { pk.hidden = true; try { syncPause(); } catch (_) { /* */ } }
      });
      [mk, rk].forEach((m) => {
        m.addEventListener('click', (e) => {
          if (e.target === m) { m.hidden = true; try { syncPause(); } catch (_) { /* */ } }
        });
      });
      qa('[data-pb2close]', mk.parentNode).forEach((b) => {
        b.addEventListener('click', () => {
          const m = document.getElementById(b.dataset.pb2close);
          if (m) { m.hidden = true; try { syncPause(); } catch (_) { /* */ } }
        });
      });
      q('#pb2ReviewGo').addEventListener('click', () => {
        try { Sound.click(); } catch (_) { /* */ }
        ['pb2ReviewModal', 'catchModal', 'faintModal'].forEach((id) => {
          const m = document.getElementById(id);
          if (m) m.hidden = true;
        });
        PB.wrong = [];
        try { newEncounter({}); } catch (e) { /* */ }
      });
    },
  };

  /* ---------- 6-2. 🎫 위시 소환권 UI ---------- */
  UI.tickets = function () {
    const el = q('#pb2TicketBadge');
    const btn = q('#pb2TicketBtn');
    const n = Tickets.count();
    if (el) {
      el.textContent = n;
      el.style.background = n > 0 ? '#e08a12' : '';
    }
    if (btn) {
      btn.classList.toggle('pb2-dim', n <= 0);
      btn.title = n > 0
        ? '✨ 위시 소환권 ' + n + '장 — 원하는 포켓몬을 바로 소환!'
        : '도감 10마리마다 소환권 1장 (지금 ' + dexCount() + '마리)';
      btn.setAttribute('aria-label', '위시 소환권 ' + n + '장');
    }
    const go = q('#pb2SummonGo');
    if (go) {
      const ok = n > 0 && !!UI._summonPick;
      go.disabled = !ok;
      go.textContent = n > 0 ? '🎫 1장으로 소환' : '🎫 소환권이 없어요';
      go.classList.toggle('off', !ok);
    }
  };

  UI.ticketBtn = function () {
    if (Tickets.isGuest()) return;
    const menu = q('#menu');
    if (!menu || q('#pb2TicketBtn')) return;
    const b = document.createElement('button');
    b.className = 'mbtn';
    b.id = 'pb2TicketBtn';
    b.innerHTML = '<span class="ico">🎫</span><span class="txt">소환권</span><span class="badge" id="pb2TicketBadge">0</span>';
    menu.appendChild(b);
    b.addEventListener('click', () => {
      try { Sound.ensure(); Sound.click(); } catch (_) { /* */ }
      UI.summonModal();
    });
    UI.tickets();
  };

  UI.summonRender = function () {
    const grid = q('#pb2SummonGrid');
    if (!grid) return;
    const qEl = q('#pb2SummonQ');
    const gEl = q('#pb2SummonGen');
    const tEl = q('#pb2SummonType');
    const qv = (qEl && qEl.value ? qEl.value : '').trim().toLowerCase();
    const gen = gEl ? gEl.value : '';
    const ty = tEl ? tEl.value : '';
    let list = (typeof POKEMON !== 'undefined' && Array.isArray(POKEMON)) ? POKEMON.slice() : [];
    if (gen === 'form') list = list.filter((p) => p && p.form);
    else if (gen) list = list.filter((p) => p && !p.form && String(p.gen) === gen);
    if (ty) list = list.filter((p) => p && (p.types || []).indexOf(ty) >= 0);
    if (qv) {
      list = list.filter((p) => p && (
        String(p.name || '').toLowerCase().indexOf(qv) >= 0
        || String(p.num || '') === qv
        || ('#' + p.id) === qv
      ));
    }
    const MAX = 150;
    const shown = list.slice(0, MAX);
    const pick = Number(UI._summonPick) || 0;
    grid.innerHTML = shown.length ? shown.map((p) =>
      '<button class="pb2-pcard' + (p.id === pick ? ' on' : '') + '" data-id="' + p.id + '" title="' + esc(p.name) + '">'
      + '<img loading="lazy" decoding="async" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + p.id + '.png" alt="">'
      + '<span>' + esc(p.name) + '</span></button>').join('')
      : '<div class="pb2-sumempty">찾는 포켓몬이 없어요 — 이름을 다시 확인해 주세요</div>';
    const cnt = q('#pb2SummonCount');
    if (cnt) {
      cnt.textContent = list.length + '마리'
        + (list.length > MAX ? ' · 앞 ' + MAX + '마리만 보여요 (검색으로 좁혀 보세요)' : '');
    }
    UI.tickets();
  };

  UI.summonModal = function () {
    if (Tickets.isGuest()) {
      UI.toast('게스트 연습 모드에서는 소환권을 쓸 수 없어요', 'info', 1800);
      return;
    }
    try { Tickets.sync(true); } catch (e) { /* */ }
    let m = q('#pb2SummonModal');
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal';
      m.id = 'pb2SummonModal';
      m.hidden = true;
      const typeList = (typeof TYPES !== 'undefined' && Array.isArray(TYPES)) ? TYPES : [];
      m.innerHTML = '<div class="sheet">'
        + '<div class="sheet-head"><h2>✨ 위시 소환권</h2>'
        + '<button class="x" data-pb2sumclose="1">✕</button></div>'
        + '<div class="sheet-body">'
        + '<p class="pb2-mnote" id="pb2SummonNote">원하는 포켓몬 <b>1마리</b>를 골라 바로 소환! 전설·환상·특별폼도 모두 가능해요.</p>'
        + '<div class="pb2-sumrow">'
        + '<input id="pb2SummonQ" class="pb2-sumin" type="search" inputmode="search" autocomplete="off" placeholder="이름 검색 (예: 피카츄)" aria-label="포켓몬 이름 검색">'
        + '<select id="pb2SummonGen" class="pb2-sumsel" aria-label="세대"><option value="">모든 세대</option>'
        + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => '<option value="' + g + '">' + g + '세대</option>').join('')
        + '<option value="form">특별폼</option></select>'
        + '<select id="pb2SummonType" class="pb2-sumsel" aria-label="타입"><option value="">모든 타입</option>'
        + typeList.map((t) => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('')
        + '</select>'
        + '</div>'
        + '<div class="pb2-sumnote" id="pb2SummonCount"></div>'
        + '<div class="pb2-pgrid pb2-sumgrid" id="pb2SummonGrid"></div>'
        + '</div>'
        + '<div class="sheet-foot pb2-setfoot"><button class="pb2-confirm" id="pb2SummonGo" disabled>🎫 1장으로 소환</button></div>'
        + '</div>';
      document.body.appendChild(m);
      const close = () => { m.hidden = true; try { syncPause(); } catch (_) { /* */ } };
      m.addEventListener('click', (e) => {
        if (e.target === m) close();
        const x = e.target.closest('[data-pb2sumclose]');
        if (x) { try { Sound.click(); } catch (_) { /* */ } close(); }
      });
      const grid = q('#pb2SummonGrid', m);
      if (grid) {
        grid.addEventListener('click', (e) => {
          const card = e.target.closest('.pb2-pcard');
          if (!card) return;
          const id = Number(card.dataset.id);
          UI._summonPick = (UI._summonPick === id) ? 0 : id;
          try { Sound.ensure(); Sound.click(); } catch (_) { /* */ }
          qa('.pb2-pcard', grid).forEach((c) => c.classList.toggle('on', Number(c.dataset.id) === UI._summonPick));
          UI.tickets();
        });
      }
      const field = (sel, ev) => {
        const el = q(sel, m);
        if (!el) return;
        const run = sel === '#pb2SummonQ'
          ? () => { clearTimeout(UI._sumT); UI._sumT = setTimeout(() => UI.summonRender(), 130); }
          : () => UI.summonRender();
        ['input', ev].forEach((t) => el.addEventListener(t, run));
      };
      field('#pb2SummonQ', 'change');
      field('#pb2SummonGen', 'change');
      field('#pb2SummonType', 'change');
      const go = q('#pb2SummonGo', m);
      if (go) {
        go.addEventListener('click', () => {
          if (!UI._summonPick) return;
          try { Sound.ensure(); Sound.click(); } catch (_) { /* */ }
          const id = UI._summonPick;
          if (Summon.go(id)) {
            UI._summonPick = 0;
            m.hidden = true;
            try { syncPause(); } catch (_) { /* */ }
          }
        });
      }
    }
    if (!(Number(UI._summonPick) > 0)) UI._summonPick = 0;
    const note = q('#pb2SummonNote');
    if (note) {
      const n = Tickets.count();
      note.innerHTML = n > 0
        ? '원하는 포켓몬 <b>1마리</b>를 골라 바로 소환! <b>보유 ' + n + '장</b>'
        : '소환권이 <b>0장</b>이에요. 도감 <b>' + dexCount() + '마리</b> — 10마리마다 1장씩 받아요.';
    }
    UI.summonRender();
    try { openModal('pb2SummonModal'); } catch (e) { m.hidden = false; }
  };

  /* ---------- 7. 랭크 ---------- */
  function josaOf(name) {
    try { return josa(name, '이', '가'); } catch (e) { return '가'; }
  }

  function rankOf(n) {
    if (n >= 100) return { emoji: '👑', label: '마스터' };
    if (n >= 30) return { emoji: '🥇', label: '골드' };
    if (n >= 10) return { emoji: '🥈', label: '실버' };
    return { emoji: '🌱', label: '초보' };
  }

  /* ---------- 8. 공격/피격 모션 ---------- */
  function fire(fromEl, toEl, type, opts) {
    const o = opts || {};
    const fx = q('#fx');
    if (!fx || !fromEl || !toEl) return;
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const x0 = a.left + a.width * (o.back ? 0.35 : 0.55);
    const y0 = a.top + a.height * 0.5;
    const x1 = b.left + b.width * 0.5;
    const y1 = b.top + b.height * 0.5;
    const atk = atkOf(type);
    const el = document.createElement('div');
    el.className = 'pb2-proj';
    el.dataset.el = atk.k;
    el.style.left = x0.toFixed(1) + 'px';
    el.style.top = y0.toFixed(1) + 'px';
    el.innerHTML = '<i class="core"></i><i class="tr"></i><i class="tr"></i><i class="tr"></i>';
    fx.appendChild(el);
    qa('.tr', el).forEach((t, i) => {
      t.style.transform = 'translate(' + (-9 * (i + 1)) + 'px,' + ((i % 2 ? 1 : -1) * 4) + 'px)';
    });
    const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
    const arc = -Math.min(70, Math.abs(x1 - x0) * 0.14);
    const dur = o.slow ? 470 : 360;
    try {
      el.animate([
        { transform: 'translate(0,0) rotate(0deg) scale(.7)', opacity: 0 },
        { transform: 'translate(' + (x1 - x0) * 0.5 + 'px,' + ((y1 - y0) * 0.5 + arc) + 'px) rotate(' + ang + 'deg) scale(1)', opacity: 1, offset: 0.5 },
        { transform: 'translate(' + (x1 - x0) + 'px,' + (y1 - y0) + 'px) rotate(' + ang + 'deg) scale(1.1)', opacity: 1 },
      ], { duration: dur, easing: 'cubic-bezier(.3,.05,.5,1)' }).finished
        .then(() => {
          el.remove();
          try { burst(x1, y1, o.strong ? 22 : 14, o.strong ? 120 : 80, { el: atk.k }); } catch (e) { /* */ }
          if (o.onHit) { try { o.onHit(); } catch (e) { /* */ } }
        })
        .catch(() => el.remove());
    } catch (e) { el.remove(); }
    try {
      Sound.ensure();
      Sound.tone(atk.f, 0.12, 'triangle', 0.05, 0, o.back ? atk.f * 0.6 : atk.f * 1.6);
    } catch (e) { /* */ }
    return el;
  }

  function partnerAttack(crit) {
    const p = q('#pb2Partner');
    const w = q('#wildWrap');
    if (!p || !w) return;
    const pr = p.getBoundingClientRect();
    const wr = w.getBoundingClientRect();
    const dx = (wr.left + wr.width * 0.5) - (pr.left + pr.width * 0.5);
    const dy = (wr.top + wr.height * 0.55) - (pr.top + pr.height * 0.5);
    try {
      p.animate([
        { transform: 'translate(0,0) scale(1)' },
        { transform: 'translate(' + dx * 0.26 + 'px,' + dy * 0.26 + 'px) scale(1.08)', offset: 0.34 },
        { transform: 'translate(' + dx * 0.56 + 'px,' + dy * 0.56 + 'px) scale(1.05)', offset: 0.52 },
        { transform: 'translate(0,0) scale(1)' },
      ], { duration: 560, easing: 'cubic-bezier(.25,1.3,.4,1)' });
    } catch (e) { /* */ }
    setTimeout(() => {
      fire(p, w, partnerType(), {
        strong: !!crit,
        onHit: () => {
          try { hitWild(); } catch (e) { /* */ }
          w.classList.remove('pb2-flash');
          void w.offsetWidth;
          w.classList.add('pb2-flash');
          setTimeout(() => w.classList.remove('pb2-flash'), 460);
        },
      });
    }, 110);
    p.classList.remove('pb2-jump');
    setTimeout(() => { p.classList.add('pb2-jump'); }, 300);
    setTimeout(() => p.classList.remove('pb2-jump'), 900);
  }

  /* 야생 포켓몬: 앞으로 돌진(lunge) → 타입 투사체 → 내 파트너 피격 */
  function wildAttack() {
    const p = q('#pb2Partner');
    const w = q('#wildWrap');
    if (!p || !w) return;
    const t = (S.wild && S.wild.types && S.wild.types[0]) || '노말';
    const pr = p.getBoundingClientRect();
    const wr = w.getBoundingClientRect();
    const dx = (pr.left + pr.width * 0.55) - (wr.left + wr.width * 0.5);
    const dy = (pr.top + pr.height * 0.5) - (wr.top + wr.height * 0.55);
    try {
      w.animate([
        { transform: 'translate(0,0) scale(1)' },
        { transform: 'translate(' + dx * 0.1 + 'px,' + dy * 0.1 + 'px) scale(.97)', offset: 0.16 },
        { transform: 'translate(' + dx * 0.34 + 'px,' + dy * 0.34 + 'px) scale(1.1)', offset: 0.55 },
        { transform: 'translate(0,0) scale(1)' },
      ], { duration: 660, easing: 'cubic-bezier(.3,1.25,.4,1)' });
    } catch (e) { /* */ }
    setTimeout(() => {
      fire(w, p, t, {
        back: true, slow: true, strong: true,
        onHit: () => {
          p.classList.remove('pb2-hurt');
          void p.offsetWidth;
          p.classList.add('pb2-hurt');
          setTimeout(() => p.classList.remove('pb2-hurt'), 680);
          try { flashScreen(); } catch (e) { /* */ }
        },
      });
    }, 230);
  }

  /* ---------- 8-2. ✨ 타격·포획 이펙트 강화 ----------
     페이지(산수·한글·영어)의 burst()/hitWild()/shakeScreen() 을 갈아끼워
     세 과목 모두 같은 연출을 쓰게 된다. 그림이 없어도 그대로 동작한다. */
  const FX_PAL = {
    water: ['#e8fdff', '#7fe0ff', '#2196f3', '#ffffff'],
    ice: ['#ffffff', '#d9f7ff', '#8fe4ff', '#bfe9ff'],
    fire: ['#fff9c4', '#ffd166', '#ff7f2a', '#ff3d00'],
    elec: ['#fffde0', '#ffe873', '#ffc400', '#ffffff'],
    grass: ['#f2ffd0', '#b6f07a', '#4caf50', '#2e7d32'],
    psychic: ['#ffe3ff', '#f7a8ff', '#c04de0', '#ffffff'],
    ghost: ['#f0d8ff', '#b98cff', '#7b2fff', '#4a0a7a'],
    dark: ['#ded0ff', '#9a7bff', '#5a1fa8', '#1b0b2e'],
    rock: ['#f7ecc9', '#d9bd82', '#a87c3c', '#6d4a1c'],
    ground: ['#f7e6c0', '#e0c48a', '#b07f2f', '#7a5520'],
    flying: ['#ffffff', '#d8f0ff', '#9ad8ff', '#5aa8d8'],
    fairy: ['#ffe6f2', '#ffb3d9', '#ff5fa2', '#c2185b'],
    dragon: ['#ece2ff', '#c9a8ff', '#7a4dff', '#3a1f8a'],
    steel: ['#ffffff', '#e2e8f0', '#a8b4c4', '#6b7787'],
    fight: ['#ffe3cf', '#ff9a6b', '#e5493a', '#8a1a10'],
    normal: ['#ffffff', '#fff3c4', '#ffd166', '#c9a227'],
    bug: ['#f6ffd8', '#c8ee7a', '#8bc34a', '#4f8a1f'],
    poison: ['#fbe0ff', '#e2a8ff', '#a040a0', '#5a0a5a'],
    gold: ['#ffffff', '#fff6c4', '#ffd166', '#ffab00'],
  };
  /* 별 모양이 더 잘 어울리는 타입 */
  const FX_STARRY = { fire: 1, elec: 1, dragon: 1, steel: 1, fairy: 1, psychic: 1, gold: 1 };
  const FX_RAINBOW = ['#ffffff', '#fff6c4', '#ffd166', '#ff9ad0', '#9be8ff', '#c6f78a', '#ffb86b'];

  const FX = {
    layer() { return q('#fx') || document.body; },

    keyOf() {
      try { return (atkOf(partnerType()).k) || 'normal'; } catch (e) { return 'normal'; }
    },

    palOf(key) { return FX_PAL[key] || FX_PAL.normal; },

    /* 작은 조각 하나를 날려 보낸다 */
    unit() { return Math.max(0.85, Math.min(1.9, (window.innerWidth || 420) / 460)); },

    dot(host, x, y, pal, n, spread, starry) {
      const p = document.createElement('span');
      const star = starry && Math.random() < 0.62;
      const u = this.unit();
      p.className = 'pb2-pt' + (star ? ' star' : '');
      const size = (star ? 9 + Math.random() * 13 : 5 + Math.random() * 10) * u;
      const c = pal[n % pal.length];
      p.style.cssText = 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;'
        + 'width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;'
        + 'background:' + c + ';box-shadow:0 0 ' + (5 + size * 0.55).toFixed(0) + 'px ' + c;
      host.appendChild(p);
      const ang = (Math.PI * 2 * n) / Math.max(1, spread) + Math.random() * 0.8;
      const dist = spread * (0.45 + Math.random() * 0.95);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist * 0.86 - spread * 0.16;
      const rot = Math.random() * 720 - 360;
      const dur = 520 + Math.random() * 560;
      try {
        p.animate([
          { transform: 'translate(-50%,-50%) scale(.35) rotate(0deg)', opacity: 0 },
          { transform: 'translate(calc(-50% + ' + (dx * 0.34).toFixed(1) + 'px), calc(-50% + ' + (dy * 0.34).toFixed(1) + 'px)) scale(1.06) rotate(' + (rot * 0.4).toFixed(0) + 'deg)', opacity: 1, offset: 0.26 },
          { transform: 'translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + (dy + 16).toFixed(1) + 'px)) scale(.22) rotate(' + rot.toFixed(0) + 'deg)', opacity: 0 },
        ], { duration: dur, easing: 'cubic-bezier(.15,.6,.3,1)' }).finished
          .then(() => p.remove()).catch(() => p.remove());
      } catch (e) { p.remove(); }
    },

    ring(x, y, color, from, to, dur) {
      const r = document.createElement('span');
      r.className = 'pb2-ring';
      from = from * this.unit();
      r.style.cssText = 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;'
        + 'width:' + (from * 2).toFixed(1) + 'px;height:' + (from * 2).toFixed(1) + 'px;'
        + 'margin:' + (-from).toFixed(1) + 'px 0 0 ' + (-from).toFixed(1) + 'px;'
        + 'border-width:' + Math.max(2, from * 0.22).toFixed(1) + 'px;border-color:' + color + ';color:' + color;
      this.layer().appendChild(r);
      const sc = Math.max(0.1, to / Math.max(1, from));
      try {
        r.animate([
          { transform: 'scale(.32)', opacity: 0.95 },
          { transform: 'scale(' + sc.toFixed(2) + ')', opacity: 0 },
        ], { duration: dur || 620, easing: 'cubic-bezier(.1,.7,.3,1)' }).finished
          .then(() => r.remove()).catch(() => r.remove());
      } catch (e) { r.remove(); }
    },

    spark(x, y, size) {
      const s = document.createElement('span');
      s.className = 'pb2-spark';
      const w = (size || 120) * this.unit();
      s.style.cssText = 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;'
        + 'width:' + w + 'px;height:' + w + 'px;margin:' + (-w / 2) + 'px 0 0 ' + (-w / 2) + 'px';
      this.layer().appendChild(s);
      try {
        s.animate([
          { transform: 'scale(.25)', opacity: 0 },
          { transform: 'scale(.9)', opacity: 1, offset: 0.22 },
          { transform: 'scale(1.35)', opacity: 0 },
        ], { duration: 300, easing: 'ease-out' }).finished
          .then(() => s.remove()).catch(() => s.remove());
      } catch (e) { s.remove(); }
    },

    /* 데미지 숫자(-1) 팝업 */
    dmg(x, y, text, hurt) {
      const d = document.createElement('span');
      d.className = 'pb2-dmg' + (hurt ? ' hurt' : '');
      d.textContent = text || '−1';
      d.style.left = x.toFixed(1) + 'px';
      d.style.top = y.toFixed(1) + 'px';
      this.layer().appendChild(d);
      setTimeout(() => d.remove(), 1000);
      return d;
    },

    /* 효과 굉장했다! 띠 */
    strong(x, y, text) {
      const b = document.createElement('span');
      b.className = 'pb2-strong';
      b.textContent = text || '효과 굉장했다!';
      b.style.left = x.toFixed(1) + 'px';
      b.style.top = y.toFixed(1) + 'px';
      this.layer().appendChild(b);
      setTimeout(() => b.remove(), 1250);
      return b;
    },

    quake(strength) {
      const targets = [q('#app'), q('#stage'), q('.stage'), q('#vs')].filter(Boolean);
      targets.forEach((el) => {
        el.classList.remove('pb2-quake');
        void el.offsetWidth;
        el.classList.add('pb2-quake');
        setTimeout(() => el.classList.remove('pb2-quake'), 560);
      });
      void strength;
    },

    /* 페이지의 burst(x,y,n,spread) 를 대신하는 본체 */
    burst(x, y, n, spread, opts) {
      const o = opts || {};
      const count = Math.max(4, Math.min(64, Math.round(n === undefined ? 18 : n)));
      const sp = Math.max(24, spread === undefined ? 110 : spread);
      const capture = !o.small && count >= 30;
      const key = o.el || this.keyOf();
      const pal = o.pal || (capture ? FX_RAINBOW : this.palOf(key));
      const starry = capture || !!FX_STARRY[key];
      const host = this.layer();
      for (let i = 0; i < count; i += 1) this.dot(host, x, y, pal, i, sp, starry);
      if (!o.small) {
        this.ring(x, y, pal[2] || '#ffffff', 12, sp * 1.15, 620);
        if (count >= 14) this.ring(x, y, '#ffffff', 8, sp * 1.7, 720);
        this.spark(x, y, Math.round(sp * 0.85));
      }
      if (capture) {
        /* 포획 성공 — 황금·무지개 별빛 폭발 + 찰칵 */
        this.ring(x, y, '#ffd166', 18, sp * 2.2, 820);
        for (let i = 0; i < 22; i += 1) this.dot(host, x, y, FX_RAINBOW, i, sp * 1.7, true);
        const c = document.createElement('span');
        c.className = 'pb2-catchburst';
        const w = sp * 1.25;
        c.style.cssText = 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;width:' + w.toFixed(0) + 'px;height:' + w.toFixed(0) + 'px;margin:' + (-w / 2).toFixed(0) + 'px 0 0 ' + (-w / 2).toFixed(0) + 'px';
        host.appendChild(c);
        try {
          c.animate([{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.3 }, { transform: 'scale(1.5)', opacity: 0 }],
            { duration: 780, easing: 'ease-out' }).finished.then(() => c.remove()).catch(() => c.remove());
        } catch (e) { c.remove(); }
        this.dmg(x, y - Math.max(44, sp * 0.5), '찰칵!', false);
      }
    },

    /* 페이지의 hitWild() 를 대신하는 본체 — 피격 흔들림 + -1 + 효과 굉장했다! */
    hitWild() {
      const w = q('#wildWrap');
      if (!w) return;
      w.classList.remove('pb2-impact');
      void w.offsetWidth;
      w.classList.add('pb2-impact');
      setTimeout(() => w.classList.remove('pb2-impact'), 680);
      const r = w.getBoundingClientRect();
      const cx = r.left + r.width * 0.5;
      const cy = r.top + r.height * 0.5;
      let strong = false;
      try { strong = !!superHit(); } catch (e) { strong = false; }
      this.dmg(cx + r.width * 0.18, cy - r.height * 0.22, '−1', false);
      if (strong) this.strong(cx, cy - r.height * 0.52);
      this.quake(strong ? 2 : 1);
    },

    /* 페이지 전역 함수 갈아끼우기 */
    attach() {
      const self = this;
      const wrapBurst = window.burst;
      if (typeof wrapBurst === 'function' && !wrapBurst.__pb2fx) {
        const fn = function (x, y, n, spread, opts) {
          try { self.burst(x, y, n, spread, opts); } catch (e) { warn('burst', e); }
        };
        fn.__pb2fx = true;
        window.burst = fn;
      }
      const origHit = window.hitWild;
      if (typeof origHit === 'function' && !origHit.__pb2fx) {
        const fn = function () { try { self.hitWild(); } catch (e) { warn('hitWild', e); } };
        fn.__pb2fx = true;
        window.hitWild = fn;
      }
      const origShake = window.shakeScreen;
      if (typeof origShake === 'function' && !origShake.__pb2fx) {
        const fn = function () {
          try { self.quake(2); } catch (e) { /* */ }
          return origShake.apply(this, arguments);
        };
        fn.__pb2fx = true;
        window.shakeScreen = fn;
      }
      /* 몬스터볼이 흔들릴 때마다(1·2·3) 공 주변에 작은 스파크
         (페이지의 Sound 는 top-level const 라 window 에는 없고 이름으로만 닿는다) */
      try {
        let snd = null;
        try { snd = Sound; } catch (e0) { snd = window.Sound || null; }
        if (snd && typeof snd.shake === 'function' && !snd.shake.__pb2fx) {
          const orig = snd.shake;
          const fn = function () {
            const out = orig.apply(snd, arguments);
            try {
              const flyer = document.querySelector('.captureflyer');
              if (flyer) {
                const r = flyer.getBoundingClientRect();
                self.burst(r.left + r.width / 2, r.top + r.height / 2, 6, 40, { pal: FX_PAL.gold, small: true });
              }
            } catch (e) { /* */ }
            return out;
          };
          fn.__pb2fx = true;
          snd.shake = fn;
        }
      } catch (e) { /* */ }
    },
  };

  /* ---------- 9. 정답/오답 처리 ---------- */
  function snapshotQuestion() {
    const el = q('#question');
    const extra = q('#qExtra');
    const choices = qa('#choices .choice')
      .filter((b) => b.style.display !== 'none' && b.offsetParent !== null)
      .map((b) => {
        const vEl = b.querySelector('.v');
        let ok;
        if (b.dataset && b.dataset.ok !== undefined) ok = b.dataset.ok === '1';
        else if (S.q && S.q.ans !== undefined) ok = String(S.q.ans).trim() === (vEl || b).textContent.trim();
        else ok = b.classList.contains('correct');
        return { v: ((vEl || b).textContent || '').trim(), ok: !!ok };
      });
    return {
      q: el ? el.innerHTML : '',
      extra: extra && !extra.hidden ? extra.innerHTML : '',
      choices,
    };
  }

  function recordWrong(snap) {
    if (!snap || !snap.choices || !snap.choices.length) return;
    if (!snap.choices.some((c) => c.ok)) return;
    const key = snap.q + '|' + snap.choices.map((c) => c.v).join(',');
    if (PB.wrong.some((w) => w.key === key)) return;
    const ans = (S.q && (S.q.answer || S.q.ans)) ? String(S.q.answer || S.q.ans) : '';
    PB.wrong.push({ key, q: snap.q, extra: snap.extra, choices: snap.choices, ans });
    if (PB.wrong.length > 12) PB.wrong.shift();
  }

  /* ---------- 3탄 공통 헬퍼 (선언 끌어올림) ---------- */
  function superHit() {
    try {
      if (!window.POK3 || !S.wild) return false;
      const p = partner();
      if (!p || !p.types) return false;
      return !!window.POK3.strongPair(p.types, S.wild.types || []);
    } catch (e) { return false; }
  }

  function bossSyncCount() {
    try {
      if (!S.wild || !S.wild.__boss) return;
      const qc = q('#qCount');
      if (qc) qc.textContent = S.solved + ' / ' + 7;
    } catch (e) { /* */ }
  }

  function applyDamage(extra) {
    if (!(extra > 0)) return;
    const before = S.foeHP;
    S.foeHP = Math.max(0, S.foeHP - extra);
    if (S.foeHP !== before) {
      try { renderHp(q('#foeHp'), S.foeHP); bumpHp(q('#foeHp')); } catch (e) { /* */ }
      try { hitWild(); } catch (e) { /* */ }
    }
  }

  const TIME_NOW = () => Date.now();
  /* 짧은 응원 목소리 — 3연속 정답 같은 순간에 가끔 한마디
     · 음소거면 재생하지 않는다 · 실패(네트워크·재생 거부)는 조용히 무시한다 */
  const Cheer = {
    words: ['최고야!', '멋져!', '와 대단해!'],
    audio: null,
    last: 0,
    idx: 0,
    muted() { try { return !!(Sound && Sound.muted); } catch (e) { return false; } },
    unlock() {
      if (this.audio) return;
      try {
        const a = new Audio();
        a.preload = 'auto';
        this.audio = a;
      } catch (e) { this.audio = null; }
    },
    play() {
      if (this.muted()) return false;
      const now = TIME_NOW();
      if (now - this.last < 7000) return false;
      this.last = now;
      this.unlock();
      if (!this.audio) return false;
      const w = this.words[this.idx % this.words.length];
      this.idx += 1;
      try {
        const a = this.audio;
        a.onerror = () => { /* 조용히 무시 */ };
        a.onstalled = a.onerror;
        a.volume = 0.92 * voiceLevel();
        a.src = '/api/tts?lang=ko&text=' + encodeURIComponent(w);
        const pr = a.play();
        if (pr && pr.catch) pr.catch(() => { /* 자동재생 차단은 무시 */ });
        return true;
      } catch (e) { return false; }
    },
  };

  const AnswerHook = {
    attach() {
      const orig = window.answer;
      if (typeof orig !== 'function' || orig.__pb2) return;
      const wrapped = function (idx) {
        const active = S.screen === 'battle' && !S.locked && !!S.q;
        try { if (q('#pb2Banner') && q('#pb2Banner').dataset.kind === 'combo') q('#pb2Banner').hidden = true; } catch (e) { /* */ }
        const snap = active ? snapshotQuestion() : null;
        const asked = active ? S.q : null;      /* 이 문제가 바뀌기 전에 붙잡아 둔다 */
        const btn = qa('#choices .choice')[idx];
        const r = orig.apply(this, arguments);
        if (!active || !btn) return r;
        const ok = btn.classList.contains('correct');
        try {
          if (ok) {
            PB.combo += 1;
            if (PB.combo > PB.bestCombo) PB.bestCombo = PB.combo;
            const crit = PB.combo > 0 && PB.combo % 3 === 0;
            /* 3탄: 파트너 타입이 야생에게 유리하면 한 칸 더 */
            const se = superHit();
            applyDamage(ballDmg() - 1 + (crit ? 1 : 0) + (se ? 1 : 0));
            bossSyncCount();
            partnerAttack(crit || se);
            UI.combo();
            if (se) {
              UI.banner('super', '💥 효과가 굉장했다! +1칸', 1600);
              try { flashScreen(); } catch (e) { /* */ }
            }
            if (crit) {
              Balls.add({ super: 1 }, true);
              UI.banner('combo', '🔥 ' + PB.combo + ' 콤보 크리티컬! HP 2칸!', 1200);
              /* 3연속 정답 순간에 가끔 짧은 응원 한마디 */
              if (Math.random() < 0.6) Cheer.play();
            }
            /* 복습 문제를 맞혔으면 오답 노트에서 졸업 */
            if (asked && asked.__review) {
              if (Weak.graduate(asked.__review)) {
                UI.toast('🎓 오답 졸업! 이제 이 문제는 자신 있어요', 'good', 2000);
                try { Sound.fanfare(); } catch (e) { /* */ }
                try { WeakBadge.paint(); } catch (e) { /* */ }
              }
            }
          } else {
            PB.combo = 0;
            UI.combo();
            recordWrong(snap);
            /* 오답 노트에 쌓기 — 복습으로 다시 나온 문제는 틀린 횟수만 올린다 */
            try {
              if (asked && asked.__review) Weak.bump(asked.__review);
              else if (asked) Weak.add(asked);
              WeakBadge.paint();
            } catch (e) { warn('weak add', e); }
            try { Streak.reset(); } catch (e) { /* */ }
            wildAttack();
          }
        } catch (e) { warn('answer hook', e); }
        return r;
      };
      wrapped.__pb2 = true;
      window.answer = wrapped;
    },
  };

  const TimeoutHook = {
    attach() {
      const orig = window.onTimeout;
      if (typeof orig !== 'function' || orig.__pb2) return;
      const wrapped = function () {
        const active = S.screen === 'battle';
        const snap = active ? snapshotQuestion() : null;
        const asked = active ? S.q : null;
        if (active && TimerPref.off()) return;
        const r = orig.apply(this, arguments);
        if (!active) return r;
        try {
          PB.combo = 0;
          UI.combo();
          recordWrong(snap);
          if (asked && asked.__review) Weak.bump(asked.__review);
          else if (asked) Weak.add(asked);
          try { WeakBadge.paint(); } catch (e) { /* */ }
          try { Streak.reset(); } catch (e) { /* */ }
          wildAttack();
        } catch (e) { warn('timeout hook', e); }
        return r;
      };
      wrapped.__pb2 = true;
      window.onTimeout = wrapped;
    },
  };

  /* ---------- 10. 등장(진화·이로치·배경·파트너·울음) ---------- */
  /* 이미 잡은 포켓몬 재등장 확률 — 도감 수에 따라 동적으로.
     · 도감 5마리 이하: 10%  (새 얼굴 90% — 도감이 금방 차오르게)
     · 6~19마리:       25%
     · 20마리 이상:    40%  (2회 포획→진화 조건도 자연스럽게)
     게임 본체의 pickWild 를 부르되, 그 순간의 풀(POKEMON)만 잠시 바꿔서
     본체 규칙(전설 확률 · 최근 등장 제외 · 폼 제외)은 그대로 지키게 한다. */
  const RECATCH_TIERS = [
    { max: 5, rate: 0.10 },
    { max: 19, rate: 0.25 },
    { max: Infinity, rate: 0.40 },
  ];
  function recatchRate(n) {
    const k = RECATCH_TIERS.find((t) => n <= t.max) || RECATCH_TIERS[RECATCH_TIERS.length - 1];
    return k.rate;
  }

  /* ---------- 10-1. 낮·밤·주말 생태계 (KST) ---------- */
  /* 완전 차단이 아니라, 그 시간대에 어울리는 타입이 조금 더 자주 나오게 한다.
     가중치는 "같은 몬스터를 풀에 한 번 더 넣기" 방식이라 본체 pickWild 의
     확률 규칙(전설·미포획 우선)을 건드리지 않는다. */
  const ECO_DAY = { '풀': 1, '노말': 1, '벌레': 1, '비행': 1 };
  const ECO_NIGHT = { '고스트': 1, '악': 1, '에스퍼': 1, '전기': 1 };
  const ECO_WEEKEND = { '드래곤': 1, '강철': 1, '페어리': 1 };
  function kstNow() {
    const d = new Date();
    return new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + (9 * 3600000));
  }
  function kstHour() { return kstNow().getHours(); }
  function isNightKST() { const h = kstHour(); return h < 6 || h >= 18; }
  function isWeekendKST() { const g = kstNow().getDay(); return g === 0 || g === 6; }
  function ecoTag() {
    return (isWeekendKST() ? '주말·' : '') + (isNightKST() ? '밤' : '낮');
  }
  function ecoWeight(p) {
    const ts = (p && p.types) || [];
    const t0 = ts[0] || '';
    const t1 = ts[1] || '';
    const table = isNightKST() ? ECO_NIGHT : ECO_DAY;
    let extra = 0;
    if (table[t0] || table[t1]) extra += 1;
    if (isWeekendKST() && (ECO_WEEKEND[t0] || ECO_WEEKEND[t1])) extra += 1;
    return 1 + Math.min(extra, 2);
  }
  /* 가중치만큼 같은 항목을 반복해 넣은 풀 — pickWild 는 균등 추첨이므로 이걸로 확률이 바뀐다 */
  function ecoPool(list) {
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      const w = ecoWeight(p);
      for (let k = 0; k < w; k += 1) out.push(p);
    }
    return out.length ? out : list;
  }

  let basePickOrigin = null;   /* 게임 본체의 순수한 pickWild (검증용) */
  function pickWildRecatch(orig, args, opts) {
    const o = opts || {};
    try {
      if (typeof POKEMON === 'undefined' || !Array.isArray(POKEMON) || !POKEMON.length) return orig.apply(null, args);
      const ids = (typeof S !== 'undefined' && S && S.dex && S.dex.ids) ? S.dex.ids : null;
      /* 전설·환상 쿨다운 중이면 일반 몬스터 풀만 남긴다 */
      const plain = POKEMON.filter((p) => p && !p.form && (!o.noRare || !(p.leg || p.myth)));
      if (!plain.length) return orig.apply(null, args);
      const base = ecoPool(plain);
      const saved = POKEMON;
      /* 아직 아무것도 못 잡았으면 생태계 가중치만 적용하고 본체에 넘긴다 */
      if (!ids || !ids.size) {
        try { POKEMON = base; return orig.apply(null, args); } finally { POKEMON = saved; }
      }
      const owned = base.filter((p) => ids.has(p.id));
      const uncaught = base.filter((p) => !ids.has(p.id));
      /* 한쪽이 비어 있으면 섞을 것이 없다(본체가 알아서 고른다) */
      if (!owned.length || !uncaught.length) {
        try { POKEMON = base; return orig.apply(null, args); } finally { POKEMON = saved; }
      }
      /* 직전에 나온 포켓몬은 다시 고르지 않는다.
         도감에 1마리(예: 콘치 #118)만 있으면 owned = [콘치] 라서
         본체 pickWild 의 excludeId 가 무력화되고 콘치만 연속 등장하던 버그 수정. */
      const excludeId = args && args[0];
      const ownedAvail = owned.filter((p) => String(p.id) !== String(excludeId));
      const rate = recatchRate(ids.size);
      try {
        POKEMON = (ownedAvail.length > 0 && Math.random() < rate) ? ownedAvail : uncaught;
        return orig.apply(null, args);
      } finally {
        POKEMON = saved;
      }
    } catch (e) {
      warn('recatch', e);
      try { return orig.apply(null, args); } catch (e2) { throw e2; }
    }
  }

  /* ---------- 10-2. 전설·환상·보스 쿨다운 (5판에 최대 1마리) ---------- */
  /* 희귀(전설·환상·보스)가 한 번 나오면 그 뒤 4판은 추가 희귀 스폰을 막는다.
     → 최근 5판 안에 희귀는 최대 1마리. 새로고침해도 이어지게 프로필 슬롯에 저장. */
  const K_RARE = (s) => 'pkm.rare.v1.' + s;
  const RARE_COOLDOWN = 4;
  const RARE_HIST_MAX = 12;
  const Rare = {
    hist: [],
    key() { return K_RARE(slotId()); },
    load() {
      const a = lsGet(this.key(), []);
      this.hist = Array.isArray(a) ? a.slice(-RARE_HIST_MAX).map(Boolean) : [];
    },
    save() { lsSet(this.key(), this.hist.slice(-RARE_HIST_MAX)); },
    isRare(p) { return !!(p && (p.__boss || p.leg || p.myth)); },
    /* 최근 4판(=이번 판 포함 5판)에 희귀가 있었으면 쿨다운 중 */
    cooling() { return this.hist.slice(-RARE_COOLDOWN).some(Boolean); },
    left() {
      const win = this.hist.slice(-RARE_COOLDOWN);
      let idx = -1;
      for (let i = win.length - 1; i >= 0; i -= 1) { if (win[i]) { idx = i; break; } }
      return idx < 0 ? 0 : RARE_COOLDOWN - idx;
    },
    record(p) {
      this.hist.push(this.isRare(p));
      if (this.hist.length > RARE_HIST_MAX) this.hist.shift();
      this.save();
    },
    clear() { this.hist = []; this.save(); },
  };

  /* ---------- 10-3. 무실수 연승 보상 ---------- */
  /* 틀리거나 도망치지 않고 연속으로 잡으면 다음 판의 진화·이로치 확률이 조금씩 오른다.
     연승 1회당 진화 +6%(상한 +30%), 이로치 +2%(상한 +6%). 틀리면 바로 0으로. */
  const K_STREAK = (s) => 'pkm.streak.v1.' + s;
  const EVO_BONUS_PER = 0.06;
  const EVO_BONUS_CAP = 0.30;
  const SHINY_BONUS_PER = 0.02;
  const SHINY_BONUS_CAP = 0.06;
  const Streak = {
    n: 0,
    key() { return K_STREAK(slotId()); },
    load() {
      const o = lsGet(this.key(), null);
      this.n = Math.max(0, Math.min(50, Math.floor(Number(o && o.n) || 0)));
    },
    save() { lsSet(this.key(), { n: this.n, date: todayKey() }); },
    reset() { if (!this.n) return 0; this.n = 0; this.save(); return 0; },
    up() { this.n += 1; this.save(); return this.n; },
    evoBonus() { return Math.min(EVO_BONUS_CAP, this.n * EVO_BONUS_PER); },
    shinyBonus() { return Math.min(SHINY_BONUS_CAP, this.n * SHINY_BONUS_PER); },
    clear() { this.n = 0; this.save(); },
  };

  /* ---------- 10-4. 🎫 위시 소환권 — 도감 10마리마다 1장 ---------- */
  /* 도감 포획 수가 10, 20, 30 … 마일스톤을 새로 넘을 때마다 1장.
     게스트 슬롯은 제외하고, 첫째·둘째는 각자 도감 기준으로 따로 받는다. */
  const K_TICKET = (s) => 'pkm.ticket.v1.' + s;
  const MILESTONE_STEP = 10;
  const Tickets = {
    data: { granted: [], n: 0 },
    key() { return K_TICKET(slotId()); },
    isGuest() { try { return slotId() === 'guest'; } catch (e) { return false; } },
    load() {
      const o = lsGet(this.key(), null);
      this.data = {
        granted: (o && Array.isArray(o.granted)) ? o.granted.map(Number).filter(Number.isFinite) : [],
        n: Math.max(0, Math.floor(Number(o && o.n) || 0)),
      };
      return this.data;
    },
    save() {
      this.data.granted = this.data.granted.slice(-60);
      lsSet(this.key(), { granted: this.data.granted.slice(), n: this.data.n });
    },
    count() { return this.data.n; },
    /* 마일스톤 동기화 — 새로 넘은 만큼만 지급. got = 이번에 받은 장수 */
    sync(silent) {
      if (this.isGuest()) return 0;
      this.load();
      const total = dexCount();
      let got = 0;
      if (!this.data.granted.length) {
        /* 처음 쓰는 친구: 이미 10마리 이상이면 한 번만 지급 */
        if (total >= MILESTONE_STEP) {
          this.data.granted.push(Math.floor(total / MILESTONE_STEP) * MILESTONE_STEP);
          this.data.n += 1;
          got = 1;
        }
      } else {
        const top = Math.max.apply(null, this.data.granted);
        for (let m = top + MILESTONE_STEP; m <= total; m += MILESTONE_STEP) {
          this.data.granted.push(m);
          this.data.n += 1;
          got += 1;
        }
      }
      if (got) {
        this.save();
        if (!silent) {
          UI.toast('🎫 도감 ' + total + '마리 달성! ✨ 위시 소환권 ' + (got > 1 ? got + '장' : '1장') + ' 받았어요', 'good', 2800);
          try { Sound.fanfare(); } catch (e) { /* */ }
        }
      }
      UI.tickets();
      return got;
    },
    take() {
      this.load();
      if (this.data.n <= 0) return false;
      this.data.n -= 1;
      this.save();
      UI.tickets();
      return true;
    },
    clear() { this.data = { granted: [], n: 0 }; this.save(); UI.tickets(); },
  };

  /* 소환권으로 고른 포켓몬을 다음 등장으로 넘기는 한 칸짜리 우편함 */
  const Summon = {
    next: null,
    set(id) {
      const p = byId(Number(id));
      if (!p) return false;
      this.next = p;
      return true;
    },
    peek() { return this.next; },
    clear() { this.next = null; },
    /* 선택한 포켓몬으로 바로 새 배틀 */
    go(id) {
      if (this.isGuest()) return false;
      if (['battle', 'caught', 'fainted'].indexOf(S.screen) < 0) {
        UI.toast('배틀 중에만 소환할 수 있어요', 'info', 1400);
        return false;
      }
      if (!Tickets.count()) { UI.toast('소환권이 없어요 — 도감 10마리마다 1장!', 'info', 1800); return false; }
      if (!this.set(id)) { UI.toast('그 포켓몬을 찾지 못했어요', 'info', 1200); return false; }
      if (!Tickets.take()) { this.clear(); return false; }
      const p = byId(Number(id));
      UI.toast('✨ ' + (p ? p.name : '포켓몬') + ' 소환!', 'good', 1600);
      try { ['pb2SummonModal', 'catchModal', 'faintModal'].forEach((m) => { const el = document.getElementById(m); if (el) el.hidden = true; }); } catch (e) { /* */ }
      try { syncPause(); } catch (e) { /* */ }
      try { newEncounter({}); } catch (e) { warn('summon', e); this.clear(); return false; }
      return true;
    },
    isGuest() { return Tickets.isGuest(); },
  };

  const SpawnHook = {
    attach() {
      const origPick = window.pickWild;
      if (typeof origPick === 'function' && !origPick.__pb2) {
        basePickOrigin = origPick;
        const pickW = function (excludeId) {
          /* 소환권으로 고른 포켓몬이 있으면 그것부터 */
          try {
            const wish = Summon.peek();
            if (wish) {
              Summon.clear();
              return Object.assign({}, wish, {
                level: rand(6, 30), cp: rand(80, 460), __wish: true,
                shiny: Math.random() < (SHINY_RATE + Streak.shinyBonus() * 0.5),
              });
            }
          } catch (e) { warn('pickWild wish', e); }
          const cooling = Rare.cooling();   /* 최근 5판에 희귀 등장 → 이번 판은 일반만 */
          try {
            if (!cooling) {
              const boss = rollBoss(excludeId);
              if (boss) return boss;
            }
          } catch (e) { warn('pickWild boss', e); }
          try {
            const evo = SpawnHook.rollEvo(excludeId);
            if (evo) return evo;
            if (!cooling) {
              const boost = legendBoost();
              if (boost) return boost;
            }
          } catch (e) { warn('pickWild pre', e); }
          const w = pickWildRecatch(origPick, arguments, { noRare: cooling });
          try {
            if (w && Math.random() < (SHINY_RATE + Streak.shinyBonus())) w.shiny = true;
          } catch (e) { /* */ }
          return w;
        };
        pickW.__pb2 = true;
        window.pickWild = pickW;
      }

      const origNew = window.newEncounter;
      if (typeof origNew === 'function' && !origNew.__pb2) {
        const newEnc = function (opts) {
          PB.combo = 0;
          PB.wrong = [];
          try { WeakServe.reset(); } catch (e) { warn('weak reset', e); }
          const o = opts || {};
          const r = origNew.apply(this, arguments);
          const after = () => {
            try { SpawnHook.onEncounter(o); } catch (e) { warn('onEncounter', e); }
          };
          if (r && typeof r.then === 'function') r.then(after, after); else after();
          return r;
        };
        newEnc.__pb2 = true;
        window.newEncounter = newEnc;
      }
    },

    /* 도망치면 연승이 끝난다 */
    attachFlee() {
      const orig = window.fleeWild;
      if (typeof orig !== 'function' || orig.__pb2) return;
      const wrapped = function () {
        try { Streak.reset(); } catch (e) { /* */ }
        return orig.apply(this, arguments);
      };
      wrapped.__pb2 = true;
      window.fleeWild = wrapped;
    },

    rollEvo(excludeId) {
      if (!S.dex || !S.dex.counts) return null;
      if (!PB.evo || !Object.keys(PB.evo).length) return null;
      if (Math.random() > EVO_RATE + Streak.evoBonus()) return null;
      const cands = [];
      Object.keys(S.dex.counts).forEach((k) => {
        const id = Number(k);
        if (!(S.dex.counts[k] >= 2)) return;
        if (!byId(id)) return;
        const nexts = PB.evo[String(id)];
        if (!nexts) return;
        nexts.forEach((n) => {
          if (n !== excludeId && byId(n) && !byId(n).form) cands.push({ from: id, to: n });
        });
      });
      if (!cands.length) return null;
      const c = pick(cands);
      const t = byId(c.to);
      return Object.assign({}, t, {
        level: rand(4, 12), cp: rand(20, 220), evolved: true, evoFrom: c.from,
        shiny: Math.random() < (SHINY_RATE + Streak.shinyBonus()),
      });
    },

    onEncounter(o) {
      const p = S.wild;
      if (!p) return;
      try { Rare.record(p); } catch (e) { warn('rare record', e); }
      UI.theme(p);
      UI.partner();
      UI.renderBalls();
      UI.rank();
      UI.combo();
      UI.timer();
      const wrap = q('#wildWrap');
      if (wrap) wrap.classList.remove('pb2-shiny-fallback');
      SpawnHook.applyShiny(p);
      if (p.evolved) {
        UI.banner('evo', '🔥 진화 포켓몬 출현!!', 2600);
        UI.evo(p);
      } else if (p.shiny) {
        UI.banner('shiny', '✨ 이로치!', 2400);
      }
      if (p.__boss) applyBoss();
      else {
        const st = q('#stage');
        if (st) st.classList.remove('pb3-boss');
        bossChip();
      }
      try { if (o && o.silent) return; } catch (e) { /* */ }
      if (p.evolved || p.shiny) { try { flashScreen(); } catch (e) { /* */ } }
      setTimeout(() => playCry(p.id), 260);
    },

    applyShiny(p) {
      const wrap = q('#wildWrap');
      UI.shinyLight(!!(p && p.shiny));
      if (!wrap || !p || !p.shiny) return;
      wrap.classList.add('pb2-shiny-fallback');
      const img = new Image();
      img.onload = () => {
        try {
          const art = q('#wildArt');
          const spr = q('#wildSprite');
          if (art) { art.onerror = null; art.src = SHINY_ART(p.id); art.style.display = ''; art.style.opacity = '1'; }
          if (spr) { spr.onerror = null; spr.src = SHINY_SPR(p.id); }
          wrap.classList.remove('pb2-shiny-fallback');
        } catch (e) { /* */ }
      };
      img.onerror = () => { /* 공식 이미지가 없으면 hue-rotate 폴백 유지 */ };
      img.src = SHINY_ART(p.id);
    },
  };

  /* ---------- 11. 포획 · 전투불능 ---------- */
  const CaptureHook = {
    attach() {
      const orig = window.captureSequence;
      if (typeof orig === 'function' && !orig.__pb2) {
        const cap = function () {
          const used = PB.ball;
          try {
            if (used !== 'poke') Balls.take(used);
          } catch (e) { /* */ }
          const r = orig.apply(this, arguments);
          const after = () => {
            try { CaptureHook.after(used); } catch (e) { warn('afterCapture', e); }
          };
          if (r && typeof r.then === 'function') r.then(after, after); else after();
          return r;
        };
        cap.__pb2 = true;
        window.captureSequence = cap;
      }
      const origF = window.faint;
      if (typeof origF === 'function' && !origF.__pb2) {
        const f = function () {
          try { Streak.reset(); } catch (e) { /* */ }
          const r = origF.apply(this, arguments);
          const after = () => {
            try { UI.reviewBtn('faintModal'); } catch (e) { /* */ }
            try { QuotaLock.onPlay('faint'); } catch (e) { warn('quota faint', e); }
            try { Stamp.mark(); } catch (e) { warn('stamp faint', e); }
          };
          if (r && typeof r.then === 'function') r.then(after, after); else after();
          return r;
        };
        f.__pb2 = true;
        window.faint = f;
      }
    },

    after(used) {
      if (PB.ball !== 'poke') PB.ball = 'poke';
      const hadPartner = !!Partner.pokemon();
      if (S.wild) {
        if (S.wild.shiny) {
          Shiny.add(S.wild.id);
          UI.toast('✨ 이로치 ' + S.wild.name + ' 도감 등록!', 'good', 2200);
        }
        playCry(S.wild.id);
      }
      /* 잡은 포켓몬만 파트너 · 파트너가 없으면 방금 잡은 몬스터를 자동 등록 */
      if (!hadPartner && S.wild && Partner.caught(S.wild.id)) {
        Partner.set(S.wild.id);
        UI.toast('🐣 ' + S.wild.name + josaOf(S.wild.name) + ' 첫 파트너가 되었어요!', 'good', 2000);
      } else {
        UI.partner();
      }
      Mission.mark(GAME);
      UI.renderBalls();
      UI.rank();
      /* 무실수 연승 — 이번 판에 한 번도 틀리지 않았으면 +1, 틀렸으면 0으로 */
      try {
        if (!PB.wrong.length) {
          const n = Streak.up();
          if (n >= 3 && n % 3 === 0) {
            UI.toast('🔥 ' + n + '연승! 다음 판 진화·이로치 확률이 올라가요', 'good', 1900);
          }
        } else {
          Streak.reset();
        }
      } catch (e) { warn('streak', e); }
      /* 도감 10마리 마일스톤 → ✨ 위시 소환권 1장 */
      try { Tickets.sync(); } catch (e) { warn('ticket sync', e); }
      UI.reviewBtn('catchModal');
      const dexm = q('#dexModal');
      if (dexm && !dexm.hidden) { try { renderDex(false); } catch (e) { /* */ } }
      try { bossClear(); } catch (e) { warn('bossClear', e); }
      try { checkRankUp(); } catch (e) { warn('rankUp', e); }
      try { maybeDropItem(); } catch (e) { warn('dropItem', e); }
      /* 공정 횟수 — 포획 1마리 = 1판 (게스트 제외) */
      try { QuotaLock.onPlay('capture'); } catch (e) { warn('quota capture', e); }
      /* 🗓️ 출석 도장 — 오늘 한 판 놀았으니 오늘 칸에 도장 */
      try { Stamp.mark(); } catch (e) { warn('stamp', e); }
      void used;
    },
  };

  function instantCapture() {
    if (S.screen !== 'battle' || S.locked) { UI.toast('지금은 쓸 수 없어요', 'info', 1100); return; }
    if (!PB.balls.master) { UI.toast('마스터볼이 없어요 — 미션·복습 보상으로 모아요!', 'info', 1700); return; }
    PB.ball = 'master';
    UI.toast('🟣 마스터볼! 즉시 포획!', 'good', 1400);
    try { Sound.throwBall(); } catch (e) { /* */ }
    try { captureSequence(); } catch (e) { warn('master', e); }
  }

  /* ---------- 12. 도감 · 상세 · 프로필 확장 ---------- */
  const DexHook = {
    attach() {
      const origDex = window.renderDex;
      if (typeof origDex === 'function' && !origDex.__pb2) {
        const r = function () {
          const out = origDex.apply(this, arguments);
          try { DexHook.mark(); } catch (e) { warn('dex mark', e); }
          try { DexHook.sortCaught(); } catch (e) { warn('dex sort', e); }
          return out;
        };
        r.__pb2 = true;
        window.renderDex = r;
      }
      const origDetail = window.openDetail;
      if (typeof origDetail === 'function' && !origDetail.__pb2) {
        const d = function (id) {
          UI._detailId = id;
          const out = origDetail.apply(this, arguments);
          try { UI.detailPartnerBtn(); } catch (e) { warn('detail', e); }
          return out;
        };
        d.__pb2 = true;
        window.openDetail = d;
      }
      const origBadge = window.renderDexBadge;
      if (typeof origBadge === 'function' && !origBadge.__pb2) {
        const b = function () {
          const out = origBadge.apply(this, arguments);
          try { UI.rank(); } catch (e) { /* */ }
          return out;
        };
        b.__pb2 = true;
        window.renderDexBadge = b;
      }
      const origReset = window.doReset;
      if (typeof origReset === 'function' && !origReset.__pb2) {
        const dr = function () {
          const out = origReset.apply(this, arguments);
          try { Partner.load(); UI.partner(); UI.rank(); } catch (e) { /* */ }
          /* 도감을 비우면 소환권·연승·희귀 쿨다운도 같이 처음으로 */
          try { Rare.clear(); Streak.clear(); UI.tickets(); } catch (e) { warn('reset ext', e); }
          return out;
        };
        dr.__pb2 = true;
        window.doReset = dr;
      }
      const origOpenSettings = window.openSettings;
      if (typeof origOpenSettings === 'function' && !origOpenSettings.__pb2) {
        const s = function () {
          const out = origOpenSettings.apply(this, arguments);
          try { UI.paintTimerGrid(); UI.audioGrid(); } catch (e) { /* */ }
          return out;
        };
        s.__pb2 = true;
        window.openSettings = s;
      }
    },

    /* 잡은 포켓몬을 항상 목록 맨 앞으로 — 못 잡은 ??? 는 그 뒤에 */
    sortCaught() {
      const grid = q('#dexGrid');
      if (!grid) return;
      const cells = qa('.dexcell', grid);
      if (cells.length < 2) return;
      const ids = (S.dex && S.dex.ids) || new Set();
      const owns = (c) => ids.has(Number(c.dataset.id));
      const mine = [];
      const rest = [];
      cells.forEach((c) => { (owns(c) ? mine : rest).push(c); });
      if (!mine.length || !rest.length) return;
      const order = mine.concat(rest);
      let same = true;
      for (let i = 0; i < order.length; i += 1) {
        if (cells[i] !== order[i]) { same = false; break; }
      }
      if (same) return;
      const frag = document.createDocumentFragment();
      order.forEach((c) => frag.appendChild(c));
      grid.appendChild(frag);
    },

    mark() {
      const grid = q('#dexGrid');
      if (!grid) return;
      qa('.dexcell', grid).forEach((cell) => {
        const id = Number(cell.dataset.id);
        const on = id && Shiny.has(id);
        cell.classList.toggle('pb2-shiny', !!on);
        let m = cell.querySelector('.pb2-shinymark');
        if (on && !m) {
          m = document.createElement('span');
          m.className = 'pb2-shinymark';
          m.textContent = '✨';
          cell.appendChild(m);
        } else if (!on && m) {
          m.remove();
        }
      });
    },
  };

  /* ---------- 13. 타이머 · 설정 확인 ---------- */
  const TimerHook = {
    attach() {
      const origStart = window.startTimer;
      if (typeof origStart === 'function' && !origStart.__pb2) {
        const st = function () {
          if (TimerPref.off()) {
            try { cancelAnimationFrame(S.raf); } catch (e) { /* */ }
            try { renderTimer(); } catch (e) { /* */ }
            return undefined;
          }
          return origStart.apply(this, arguments);
        };
        st.__pb2 = true;
        window.startTimer = st;
      }
      const origRender = window.renderTimer;
      if (typeof origRender === 'function' && !origRender.__pb2) {
        const rt = function () {
          const out = origRender.apply(this, arguments);
          try { if (TimerPref.off()) UI.timer(); } catch (e) { /* */ }
          return out;
        };
        rt.__pb2 = true;
        window.renderTimer = rt;
      }
    },

    confirm() {
      const btn = q('#pb2SetConfirm');
      if (!btn || btn.__pb2) return;
      btn.__pb2 = true;
      btn.addEventListener('click', () => {
        try { Sound.ensure(); Sound.click(); } catch (e) { /* */ }
        try { closeModal('settingsModal'); } catch (e) { /* */ }
        UI.toast('설정을 저장했어요 ✅', 'good', 1400);
        try {
          if (S.screen === 'battle' && !S.locked) {
            renderAll();
            UI.timer();
          }
        } catch (e) { /* */ }
      });
    },
  };

  /* ---------- 14. 복습 ---------- */
  const Review = {
    open() {
      if (!PB.wrong.length) return;
      PB.rv = { i: 0, right: 0, items: PB.wrong.slice() };
      try { openModal('pb2ReviewModal'); } catch (e) { /* */ }
      Review.paint();
    },

    paint() {
      const body = q('#pb2ReviewBody');
      const foot = q('#pb2ReviewFoot');
      if (!body) return;
      const rv = PB.rv;
      if (!rv) return;
      if (foot) foot.hidden = true;
      const it = rv.items[rv.i];
      if (!it) { Review.finish(); return; }
      body.innerHTML = '<div class="pb2-rv">'
        + '<div class="pb2-rvhead"><b>📝 ' + (rv.i + 1) + ' / ' + rv.items.length + '</b>'
        + '<span>' + '🔥'.repeat(Math.min(3, rv.right)) + '</span></div>'
        + '<div class="pb2-rvq">' + it.q + '</div>'
        + (it.extra ? '<div class="pb2-rvq" style="font-size:clamp(15px,4vw,20px)">' + it.extra + '</div>' : '')
        + '<div class="pb2-rvchoices" id="pb2RvChoices">'
        + it.choices.map((c, i) => '<button data-i="' + i + '">' + c.v + '</button>').join('')
        + '</div>'
        + '<div class="pb2-rvmsg" id="pb2RvMsg">정답을 골라 보세요!</div>'
        + '</div>';
      qa('#pb2RvChoices button').forEach((b) => {
        b.addEventListener('click', () => {
          const idx = Number(b.dataset.i);
          Review.pick(idx);
        });
      });
    },

    pick(idx) {
      const rv = PB.rv;
      if (!rv) return;
      const it = rv.items[rv.i];
      if (!it) return;
      const btns = qa('#pb2RvChoices button');
      if (btns.some((b) => b.disabled)) return;
      const chosen = it.choices[idx];
      const msg = q('#pb2RvMsg');
      btns.forEach((b, i) => {
        b.disabled = true;
        if (it.choices[i].ok) b.classList.add('ok');
      });
      if (chosen && chosen.ok) {
        rv.right += 1;
        if (msg) msg.textContent = '✅ 맞았어요!';
        try { Sound.correct(); } catch (e) { /* */ }
      } else {
        if (chosen && btns[idx]) btns[idx].classList.add('no');
        if (msg) {
          msg.className = 'pb2-rvmsg bad';
          const ansTxt = (it.choices.find((c) => c.ok) || {}).v || it.ans || '';
          msg.textContent = '❌ 정답은 「' + ansTxt + '」';
        }
        try { Sound.wrong(); } catch (e) { /* */ }
      }
      setTimeout(() => {
        if (!PB.rv) return;
        PB.rv.i += 1;
        Review.paint();
      }, 1050);
    },

    finish() {
      const rv = PB.rv;
      const body = q('#pb2ReviewBody');
      const foot = q('#pb2ReviewFoot');
      if (!body || !rv) return;
      const all = rv.right === rv.items.length;
      const reward = all ? 'hyper' : 'super';
      if (!rv.done) {
        rv.done = true;
        Balls.add(reward === 'hyper' ? { hyper: 1 } : { super: 1 }, true);
      }
      body.innerHTML = '<div class="pb2-rvdone">'
        + '<div class="big">' + (all ? '🎉' : '💪') + '</div>'
        + '<h3>' + (all ? '복습 완벽해요!' : '복습 완료!') + '</h3>'
        + '<p>' + rv.items.length + '문제 중 <b>' + rv.right + '문제</b> 정답 · 보너스 '
        + (reward === 'hyper' ? '하이퍼볼 ×1' : '슈퍼볼 ×1') + '</p>'
        + '<p style="color:#8a7a3a">복습한 문제는 이제 자신 있어요!</p>'
        + '</div>';
      if (foot) foot.hidden = false;
      try { Sound.fanfare(); } catch (e) { /* */ }
      UI.renderBalls();
    },
  };

  /* ============================================================
     15. 3탄 — 💥 타입 상성 · 👑 주말 보스 레이드 · 🏅 등급 승급 · 🎁 마을 아이템
     ============================================================ */
  /* 주말 보스 레이드 — 24% 는 너무 자주 나와서 8% 로 낮춘다(전설 쿨다운과 같이 동작) */
  const BOSS_RATE = 0.08;
  /* 깜짝 선물: 기본 11% → 한 번도 안 틀린 완벽한 판이면 최대 30% */
  const DROP_BASE = 0.11;
  const DROP_MAX = 0.30;
  const BOSS_HP = 7;
  const RANKS = [
    { at: 0, emoji: '🌱', label: '초보' },
    { at: 10, emoji: '🥈', label: '실버' },
    { at: 30, emoji: '🥇', label: '골드' },
    { at: 100, emoji: '👑', label: '마스터' },
  ];
  const K_BOSS = (s) => 'pkm.boss.v1.' + s;
  const K_RANK = (s) => 'pkm.rank.v1.' + s;
  const K_INV = (s) => 'pkm.village.inv.v1.' + s;

  function rankIdx(n) {
    let i = 0;
    RANKS.forEach((r, k) => { if (n >= r.at) i = k; });
    return i;
  }
  function dexCount() {
    try { return (S.dex && S.dex.ids) ? S.dex.ids.size : 0; } catch (e) { return 0; }
  }
  function isWeekend() {
    const g = kstNow().getDay();   /* KST 기준 — 기기 시간대와 상관없이 토·일 */
    return g === 0 || g === 6;
  }
  function bossMode() {
    if (!window.POK3) return false;
    try { if (slotId() === 'guest') return true; } catch (e) { /* */ }
    return isWeekend();
  }
  /* 주말·게스트 테스트 모드에서 일정 확률로 7칸짜리 보스 등장 */
  function rollBoss(excludeId) {
    if (!bossMode()) return null;
    if (Math.random() > BOSS_RATE) return null;
    let pool = [];
    try {
      pool = POKEMON.filter((p) => p && p.id !== excludeId
        && (p.leg || p.myth || (p.tag && String(p.tag).indexOf('거다이맥스') >= 0)));
    } catch (e) { return null; }
    if (!pool.length) return null;
    const caught = (S.dex && S.dex.ids) || new Set();
    const uncaught = pool.filter((p) => !caught.has(p.id));
    const p = pick(uncaught.length && Math.random() < 0.72 ? uncaught : pool);
    return Object.assign({}, p, { level: rand(40, 72), cp: rand(900, 1600), __boss: true });
  }

  function bossStage() {
    const stage = q('#stage');
    if (!stage || q('#pb3BossChip')) return;
    const chip = document.createElement('div');
    chip.className = 'pb3-bosschip';
    chip.id = 'pb3BossChip';
    chip.hidden = true;
    chip.innerHTML = '<b>👑</b><span id="pb3BossChipText">주말 보스</span>';
    stage.appendChild(chip);
  }

  function bossChip() {
    bossStage();
    const chip = q('#pb3BossChip');
    const txt = q('#pb3BossChipText');
    if (!chip) return;
    const on = !!(S.wild && S.wild.__boss);
    const rec = lsGet(K_BOSS(slotId()), { count: 0 });
    const n = (rec && rec.count) || 0;
    if (on) {
      chip.hidden = false;
      chip.classList.add('live');
      if (txt) txt.textContent = '주말 보스 레이드 · ' + BOSS_HP + '칸';
    } else if (n > 0) {
      chip.hidden = false;
      chip.classList.remove('live');
      if (txt) txt.textContent = '보스 뱃지 ×' + n;
    } else {
      chip.hidden = true;
      chip.classList.remove('live');
    }
  }

  function applyBoss() {
    const p = S.wild;
    if (!p || !p.__boss) return;
    S.foeHP = BOSS_HP;
    try { renderHp(q('#foeHp'), BOSS_HP, BOSS_HP); } catch (e) { warn('boss hp', e); }
    const qc = q('#qCount');
    if (qc) qc.textContent = '0 / ' + BOSS_HP;
    bossChip();
    UI.banner('boss', '👑 주말 보스 레이드! ' + (p.short || p.name), 3200);
    try {
      const stage = q('#stage');
      if (stage) {
        stage.classList.remove('pb3-boss');
        void stage.offsetWidth;
        stage.classList.add('pb3-boss');
      }
      flashScreen();
      Sound.ensure();
      Sound.tone(150, 0.5, 'sawtooth', 0.08, 60, 300);
    } catch (e) { /* */ }
    setTimeout(() => playCry(p.id, true), 320);
  }

  function bossClear() {
    const p = S.wild;
    if (!p || !p.__boss) return;
    const rec = lsGet(K_BOSS(slotId()), { count: 0, last: '' });
    rec.count = (rec.count || 0) + 1;
    rec.last = todayKey();
    lsSet(K_BOSS(slotId()), rec);
    bossChip();
    UI.toast('👑 주말 보스 뱃지 획득! (×' + rec.count + ')', 'good', 2800);
  }

  function rankStage() {
    if (q('#pb3RankUp')) return;
    const el = document.createElement('div');
    el.className = 'pb3-rankup';
    el.id = 'pb3RankUp';
    el.hidden = true;
    el.setAttribute('aria-live', 'assertive');
    el.innerHTML = '<div class="ru-in">'
      + '<div class="ru-k">트레이너 등급 승급</div>'
      + '<div class="ru-row"><span class="ru-from" id="pb3RuFrom">🥈 실버</span>'
      + '<span class="ru-flash">✨</span>'
      + '<span class="ru-to" id="pb3RuTo">🥇 골드 승급!!</span></div>'
      + '<div class="ru-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>'
      + '</div>';
    (document.body || document.documentElement).appendChild(el);
  }

  function showRankUp(from, to) {
    rankStage();
    const el = q('#pb3RankUp');
    const f = q('#pb3RuFrom');
    const t = q('#pb3RuTo');
    if (!el || !RANKS[from] || !RANKS[to]) return;
    if (f) f.textContent = RANKS[from].emoji + ' ' + RANKS[from].label;
    if (t) t.textContent = RANKS[to].emoji + ' ' + RANKS[to].label + ' 승급!!';
    el.hidden = false;
    el.classList.remove('play');
    void el.offsetWidth;
    el.classList.add('play');
    try { Sound.fanfare(); } catch (e) { /* */ }
    try { flashScreen(); } catch (e) { /* */ }
    try {
      const st = q('#stage');
      if (st) {
        const r = st.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2, 30, 200);
      }
    } catch (e) { /* */ }
    clearTimeout(showRankUp._t);
    showRankUp._t = setTimeout(() => { el.hidden = true; el.classList.remove('play'); }, 3800);
  }

  /* 등급 승급 감시 — 처음 저장될 때는 조용히 지금 등급을 기준으로 삼는다 */
  function checkRankUp() {
    const n = dexCount();
    const cur = rankIdx(n);
    const key = K_RANK(slotId());
    const seen = lsGet(key, null);
    if (typeof seen !== 'number') { lsSet(key, cur); return; }
    if (cur > seen) {
      lsSet(key, cur);
      showRankUp(seen, cur);
    }
  }
  function initRankSeen() {
    const key = K_RANK(slotId());
    if (typeof lsGet(key, null) !== 'number') lsSet(key, rankIdx(dexCount()));
  }

  function grantVillageItem(n) {
    const out = [];
    if (!window.POK3) return out;
    const keys = window.POK3.itemKeys();
    const inv = lsGet(K_INV(slotId()), {}) || {};
    for (let i = 0; i < (n || 1); i += 1) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      inv[k] = (inv[k] || 0) + 1;
      out.push(window.POK3.item(k));
    }
    lsSet(K_INV(slotId()), inv);
    return out;
  }

  /* 이번 판이 얼마나 완벽했는지 — 연속 정답(콤보)이 살아 있을수록 확률이 올라간다 */
  function dropChance() {
    const solved = Math.max(0, S.solved || 0);
    const combo = Math.max(0, PB.combo || 0);
    const acc = solved ? Math.min(1, combo / solved) : 0;
    const prog = Math.min(1, solved / MAXHP);
    return DROP_BASE + (DROP_MAX - DROP_BASE) * acc * (0.45 + 0.55 * prog);
  }

  /* 선물 상자 내용물 — 마을 꾸미기 아이템 60% · 슈퍼볼 28% · 하이퍼볼 12% */
  function rollGift() {
    const r = Math.random();
    if (r < 0.6) {
      const got = grantVillageItem(1);
      const it = got && got[0];
      return it ? { emoji: it.emoji, name: it.name } : null;
    }
    if (r < 0.88) {
      Balls.add({ super: 1 }, true);
      return { emoji: '🔵', name: '슈퍼볼 1개' };
    }
    Balls.add({ hyper: 1 }, true);
    return { emoji: '🟡', name: '하이퍼볼 1개' };
  }

  /* 포획할 때마다 확률로 깜짝 선물 상자 → 아이템 또는 볼 */
  function maybeDropItem() {
    if (!window.POK3) return;
    if (Math.random() >= dropChance()) return;
    const got = rollGift();
    if (!got) return;
    setTimeout(() => {
      UI.toast('🎁 깜짝 선물 상자! ' + got.emoji + ' ' + got.name + ' 획득', 'good', 3000);
    }, 1100);
  }

  /* ---------- 가족 PIN 확인 (도감 초기화 · 카드 삭제) ---------- */
  const PIN_KEY = 'pkm.family.pin.v1';
  const PinGate = {
    el: null,
    buf: '',
    fails: 0,
    onOk: null,
    build() {
      if (this.el || q('#pb3Pin')) return;
      const box = document.createElement('div');
      box.className = 'pb3-pin';
      box.id = 'pb3Pin';
      box.hidden = true;
      box.innerHTML = '<div class="pin-card" role="dialog" aria-modal="true" aria-label="가족 PIN 확인">'
        + '<div class="pin-head"><b id="pb3PinTitle">가족 PIN</b>'
        + '<button class="pin-x" id="pb3PinClose" aria-label="닫기">✕</button></div>'
        + '<p class="pin-desc" id="pb3PinDesc">가족 PIN 4자리를 눌러 주세요</p>'
        + '<div class="pin-dots" id="pb3PinDots"><i></i><i></i><i></i><i></i></div>'
        + '<p class="pin-msg" id="pb3PinMsg"> </p>'
        + '<div class="pin-pad" id="pb3PinPad"></div>'
        + '</div>';
      (document.body || document.documentElement).appendChild(box);
      const pad = q('#pb3PinPad', box);
      let keys = '';
      [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((n) => { keys += '<button type="button" data-d="' + n + '">' + n + '</button>'; });
      keys += '<button type="button" class="wide" data-act="back">⌫</button>'
        + '<button type="button" data-d="0">0</button>'
        + '<button type="button" class="blank" tabindex="-1" aria-hidden="true"></button>';
      pad.innerHTML = keys;
      pad.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        try { Sound.ensure(); } catch (err) { /* */ }
        if (b.dataset.d !== undefined) this.press(b.dataset.d);
        else if (b.dataset.act === 'back') this.back();
      });
      const x = q('#pb3PinClose', box);
      if (x) x.addEventListener('click', () => this.close());
      box.addEventListener('click', (e) => { if (e.target === box) this.close(); });
      this.el = box;
    },
    pin() {
      const raw = (function () { try { return localStorage.getItem(PIN_KEY); } catch (e) { return null; } })();
      return /^\d{4}$/.test(raw || '') ? raw : '0623';
    },
    dots() {
      const host = q('#pb3PinDots');
      if (!host) return;
      Array.prototype.forEach.call(host.children, (d, i) => d.classList.toggle('on', i < this.buf.length));
    },
    open(mode, title, desc, onOk) {
      this.build();
      this.mode = mode;
      this.buf = '';
      this.fails = 0;
      this.onOk = onOk;
      const t = q('#pb3PinTitle');
      const d = q('#pb3PinDesc');
      const m = q('#pb3PinMsg');
      if (t) t.textContent = title || '가족 PIN';
      if (d) d.textContent = desc || '가족 PIN 4자리를 눌러 주세요';
      if (m) { m.className = 'pin-msg'; m.textContent = ' '; }
      if (this.el) this.el.hidden = false;
      this.dots();
    },
    close() {
      if (this.el) this.el.hidden = true;
      this.buf = '';
      this.onOk = null;
      this.dots();
    },
    press(d) {
      if (this.buf.length >= 4) return;
      this.buf += d;
      this.dots();
      try { Sound.tone(660 + this.buf.length * 60, 0.07, 'triangle', 0.04); } catch (e) { /* */ }
      if (this.buf.length === 4) setTimeout(() => this.check(), 90);
    },
    back() { this.buf = this.buf.slice(0, -1); this.dots(); },
    check() {
      const m = q('#pb3PinMsg');
      if (this.buf === this.pin()) {
        const fn = this.onOk;
        this.close();
        try { Sound.tone(1180, 0.16, 'triangle', 0.05); } catch (e) { /* */ }
        if (fn) { try { fn(); } catch (e) { warn('pin ok', e); } }
        return;
      }
      this.fails += 1;
      this.buf = '';
      this.dots();
      if (m) {
        m.className = 'pin-msg bad';
        m.textContent = this.fails >= 5
          ? 'PIN을 5번 틀렸어요. 잠시 뒤 다시 해 보세요.'
          : 'PIN이 달라요. 다시 눌러 주세요 (' + this.fails + '/5)';
      }
      try { Sound.tone(220, 0.16, 'sawtooth', 0.05, 120); } catch (e) { /* */ }
      if (this.fails >= 5) {
        const pad = q('#pb3PinPad');
        if (pad) qa('button', pad).forEach((b) => { b.disabled = true; });
        setTimeout(() => {
          this.fails = 0;
          if (pad) qa('button', pad).forEach((b) => { b.disabled = false; });
          if (m) { m.className = 'pin-msg'; m.textContent = ' '; }
        }, 7000);
      }
    },
  };

  /* 도감 초기화는 PIN을 통과해야 실행된다 */
  const ResetGate = {
    attach() {
      const orig = window.doReset;
      if (typeof orig !== 'function' || orig.__pb3) return;
      const wrapped = function () {
        const p = (function () { try { return Profiles.active(); } catch (e) { return { name: '이 친구' }; } })();
        PinGate.open('reset', '🧹 도감 초기화', p.name + '의 도감을 초기화하려면 가족 PIN 4자리를 눌러 주세요', () => {
          try { orig.apply(this, arguments); } catch (e) { warn('doReset', e); }
        });
      };
      wrapped.__pb3 = true;
      window.doReset = wrapped;
    },
  };

  /* 도감 카드 600ms 길게 누르기 → 그 포켓몬 1마리만 삭제 (PIN 필요) */
  const DexDelete = {
    bind() {
      const grid = q('#dexGrid');
      if (!grid || grid.__pb3) return;
      grid.__pb3 = true;
      let timer = 0;
      let fired = false;
      let startX = 0;
      let startY = 0;
      const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
      grid.addEventListener('pointerdown', (e) => {
        const cell = e.target.closest ? e.target.closest('.dexcell') : null;
        if (!cell) return;
        const id = Number(cell.dataset.id);
        if (!id || !S.dex || !S.dex.ids || !S.dex.ids.has(id)) return;
        fired = false;
        startX = e.clientX || 0;
        startY = e.clientY || 0;
        clear();
        timer = setTimeout(() => {
          timer = 0;
          fired = true;
          DexDelete.ask(id);
        }, 600);
      }, true);
      grid.addEventListener('pointermove', (e) => {
        if (!timer) return;
        if (Math.abs((e.clientX || 0) - startX) > 9 || Math.abs((e.clientY || 0) - startY) > 9) clear();
      }, true);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
        grid.addEventListener(ev, () => { clear(); }, true);
      });
      grid.addEventListener('click', (e) => {
        if (!fired) return;
        fired = false;
        e.preventDefault();
        e.stopPropagation();
      }, true);
    },

    ask(id) {
      const p = byId(id);
      if (!p) return;
      const nm = p.short || p.name;
      PinGate.open('delete', '🗑️ ' + nm + ' 도감에서 지우기',
        nm + '을(를) 도감에서 지우려면 가족 PIN 4자리를 눌러 주세요', () => DexDelete.run(id));
    },

    run(id) {
      const p = byId(id);
      if (!p) return;
      try {
        S.dex.ids.delete(id);
        delete S.dex.counts[id];
        delete S.dex.dates[id];
        delete S.dex.subjects[id];
        /* 🗑 지운 시각을 남긴다 — 다른 기기·낡은 탭이 예전 목록을 올려도 되살아나지 않게 */
        if (!S.dex.removed || typeof S.dex.removed !== 'object') S.dex.removed = {};
        S.dex.removed[String(id)] = Date.now();
        if (S.dex.caughtAt) delete S.dex.caughtAt[String(id)];
        Profiles.saveDex(Profiles.data.active, S.dex);
      } catch (e) { warn('dex delete', e); }
      /* 파트너였다면 파트너도 비운다 */
      try {
        if (PB.partnerId === id) {
          PB.partnerId = 0;
          lsSet(Partner.key(), 0);
          Partner.load();
          UI.partner();
        }
      } catch (e) { warn('partner clear', e); }
      /* 마을에 놓여 있었다면 그 자리도 정리 */
      try {
        const vkey = 'pkm.village.v1.' + slotId();
        const v = lsGet(vkey, null);
        if (v && Array.isArray(v.poke)) {
          const before = v.poke.length;
          v.poke = v.poke.filter((x) => Number(x.id) !== Number(id));
          if (v.poke.length !== before) lsSet(vkey, v);
        }
      } catch (e) { warn('village clear', e); }
      try { renderDex(false); renderDexBadge(); } catch (e) { /* */ }
      try { UI.rank(); UI.combo(); } catch (e) { /* */ }
      UI.toast('🗑️ ' + (p.short || p.name) + '을(를) 도감에서 지웠어요', 'info', 1900);
    },
  };

  /* ============================================================
     16. 공정 횟수 제한 — 아빠 PIN(0623) 관리
     ─ 첫째(p1)·둘째(p2)의 오늘 판수를 한국시간 날짜별로 저장
     ─ 🧪 게스트는 테스트용이라 언제나 제한 없음(집계도 하지 않음)
     ─ 몫을 다 채우면 잠금 오버레이 · 아빠 PIN 으로만 초기화/추가
     ============================================================ */
  const QK = 'pkm.quota.v1';
  const QUOTA_DEFAULT = 5;
  const QUOTA_OPTS = [3, 5, 10, 0];        // 0 = 무제한
  const SLOT_ROLE = { p1: '첫째', p2: '둘째', guest: '게스트' };

  /* 기기 시간대와 상관없이 한국시간 날짜로 센다 */
  function kstDate(t) {
    const d = new Date((t == null ? Date.now() : t) + 9 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  const quotaLimitOf = (v) => (QUOTA_OPTS.indexOf(Number(v)) >= 0 ? Number(v) : QUOTA_DEFAULT);

  const Quota = {
    /* 이 게임의 프로필 → 같은 아이를 가리키는 공통 열쇠(p1·p2·guest)
       ─ 이름에 '아린·첫째·둘째·게스트'가 있으면 이름으로
       ─ 이름을 바꿔 두었어도, 같은 게임의 다른 프로필이 패턴에 맞으면 반대편으로
         (한글 게임은 기본 프로필 순서가 뒤집혀 있어 이 보정이 필요하다) */
    keyOfProfile(profId) {
      let name = '';
      try {
        const p = Profiles.get(profId);
        name = (p && p.name) || '';
      } catch (e) { /* */ }
      const pat = slotFromName(name);
      if (pat) return pat;
      try {
        const list = (Profiles.data && Profiles.data.list) || [];
        const others = list.filter((x) => x && x.id !== profId)
          .map((x) => slotFromName(x.name || ''))
          .filter((s) => s === 'p1' || s === 'p2');
        if (others.length === 1) return others[0] === 'p1' ? 'p2' : 'p1';
      } catch (e) { /* */ }
      try {
        const map = (typeof SLOT_BY_DEFAULT !== 'undefined' && SLOT_BY_DEFAULT[GAME]) || null;
        if (map && map[profId]) return map[profId];
      } catch (e) { /* */ }
      return slotId();
    },
    kid() {
      try { return Quota.keyOfProfile(Profiles.data.active); } catch (e) { return slotId(); }
    },
    read() {
      const raw = lsGet(QK, null);
      const o = (raw && typeof raw === 'object') ? raw : {};
      const plays = (o.plays && typeof o.plays === 'object') ? o.plays : {};
      const out = { v: 1, date: typeof o.date === 'string' ? o.date : kstDate(), limit: quotaLimitOf(o.limit), plays };
      /* 날짜가 바뀌면 오늘 판수는 0부터 */
      if (out.date !== kstDate()) {
        out.date = kstDate();
        out.plays = {};
        lsSet(QK, out);
      }
      return out;
    },
    write(o) { lsSet(QK, o); return o; },
    limit() { return Quota.read().limit; },
    isGuest(slot) { return String(slot) === 'guest'; },
    count(slot) {
      const o = Quota.read();
      return Math.max(0, Number((o.plays || {})[slot]) || 0);
    },
    blocked(slot) {
      if (Quota.isGuest(slot)) return false;
      const o = Quota.read();
      if (!o.limit) return false;
      return Quota.count(slot) >= o.limit;
    },
    add(slot, n) {
      if (Quota.isGuest(slot)) return { slot: slot, count: 0, limit: Quota.limit(), blocked: false, guest: true };
      const o = Quota.read();
      o.plays = o.plays || {};
      o.plays[slot] = Math.max(0, (Number(o.plays[slot]) || 0) + (n === undefined ? 1 : n));
      Quota.write(o);
      return { slot: slot, count: o.plays[slot], limit: o.limit, blocked: !!o.limit && o.plays[slot] >= o.limit, guest: false };
    },
    setLimit(n) {
      const o = Quota.read();
      o.limit = quotaLimitOf(n);
      Quota.write(o);
      return o.limit;
    },
    reset(slot) {
      const o = Quota.read();
      o.plays = o.plays || {};
      o.plays[slot] = 0;
      Quota.write(o);
      return 0;
    },
    remain(slot) {
      const o = Quota.read();
      if (!o.limit) return Infinity;
      return Math.max(0, o.limit - Quota.count(slot));
    },
    roleOf(slot) { return SLOT_ROLE[slot] || '친구'; },
    otherSlot(slot) { return String(slot) === 'p2' ? 'p1' : 'p2'; },
    profileIdOf(slot) {
      try {
        const list = (Profiles.data && Profiles.data.list) || [];
        const p = list.find((x) => x && Quota.keyOfProfile(x.id) === slot);
        return p ? p.id : '';
      } catch (e) { return ''; }
    },
    text(slot) {
      const o = Quota.read();
      const n = Quota.count(slot);
      return o.limit ? n + '/' + o.limit + '판' : n + '판 (무제한)';
    },
    summary() {
      const o = Quota.read();
      return { date: o.date, limit: o.limit, p1: Quota.count('p1'), p2: Quota.count('p2') };
    },
  };

  /* 잠금 오버레이 — 몫을 다 채우면 배틀 화면 위로 올라온다 */
  const QuotaLock = {
    el: null,
    timer: 0,
    build() {
      if (this.el || q('#pkmQuota')) { this.el = q('#pkmQuota'); return; }
      const box = document.createElement('div');
      box.className = 'modal pkq';
      box.id = 'pkmQuota';
      box.hidden = true;
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', '오늘 판수 잠금');
      box.innerHTML = '<div class="pkq-sheet">'
        + '<div class="pkq-badge" aria-hidden="true">🔒</div>'
        + '<h2 id="pkqTitle">오늘 몫을 다 채웠어요</h2>'
        + '<p class="pkq-sub" id="pkqSub">이제 다른 친구 차례예요</p>'
        + '<div class="pkq-rows" id="pkqRows"></div>'
        + '<div class="pkq-acts" id="pkqActs">'
        + '<button type="button" class="pkq-main" data-act="switch" id="pkqSwitch">➡️ 둘째 차례로 바꾸기</button>'
        + '<button type="button" class="pkq-pin" data-act="pin">🔓 아빠 PIN (횟수 초기화·추가)</button>'
        + '<a class="pkq-home" href="./pokemon-battle.html">🏠 처음 화면으로</a>'
        + '</div>'
        + '<div class="pkq-admin" id="pkqAdmin" hidden>'
        + '<p class="pkq-adminh">🔓 아빠 확인 완료 — 어떻게 할까요?</p>'
        + '<button type="button" class="pkq-adm" data-adm="reset">🔁 오늘 횟수 0으로 초기화</button>'
        + '<button type="button" class="pkq-adm" data-adm="more1">➕ 한 판 더 ( +1 )</button>'
        + '<button type="button" class="pkq-adm" data-adm="more5">➕ 5판 더 추가</button>'
        + '</div>'
        + '</div>';
      (document.body || document.documentElement).appendChild(box);
      box.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        e.preventDefault();
        try { Sound.ensure(); } catch (err) { /* */ }
        if (b.dataset.act === 'switch') this.toOther();
        else if (b.dataset.act === 'pin') this.openPin();
        else if (b.dataset.adm) this.admin(b.dataset.adm);
      });
      this.el = box;
    },

    rowsHtml() {
      const me = Quota.kid();
      return ['p1', 'p2'].map((s) => {
        const full = Quota.blocked(s);
        const mine = s === me;
        return '<div class="pkq-row' + (full ? ' done' : '') + (mine ? ' me' : '') + '">'
          + '<span class="who">' + (mine ? '👉 ' : '') + Quota.roleOf(s) + '</span>'
          + '<span class="cnt">' + Quota.text(s) + '</span>'
          + '<span class="st">' + (full ? '🔒 오늘 완료' : '남은 ' + Quota.remain(s) + '판') + '</span>'
          + '</div>';
      }).join('') + '<p class="pkq-note">🧪 게스트는 테스트용이라 횟수 제한이 없어요</p>';
    },

    refresh() {
      this.build();
      if (!this.el) return;
      const slot = Quota.kid();
      if (Quota.isGuest(slot) || !Quota.blocked(slot)) { this.hide(); return; }
      const other = Quota.otherSlot(slot);
      const lim = Math.max(1, Quota.limit());
      const t = q('#pkqTitle');
      const s = q('#pkqSub');
      const sw = q('#pkqSwitch');
      if (t) t.textContent = '🔒 ' + Quota.roleOf(slot) + ' 오늘 ' + Quota.count(slot) + '/' + lim + '판 완료!';
      if (s) {
        s.textContent = Quota.blocked(other)
          ? Quota.roleOf(other) + '도 오늘 몫을 다 채웠어요 — 내일 다시 만나요!'
          : '이제 ' + Quota.roleOf(other) + ' 차례예요';
      }
      if (sw) {
        sw.textContent = '➡️ ' + Quota.roleOf(other) + ' 차례로 바꾸기';
        sw.hidden = false;
      }
      const rows = q('#pkqRows');
      if (rows) rows.innerHTML = this.rowsHtml();
      const adm = q('#pkqAdmin');
      const acts = q('#pkqActs');
      if (adm) adm.hidden = true;
      if (acts) acts.hidden = false;
      if (this.el.hidden) {
        this.el.hidden = false;
        try { Sound.tone(420, 0.12, 'triangle', 0.05); } catch (e) { /* */ }
        setTimeout(() => { try { Sound.tone(300, 0.16, 'triangle', 0.05); } catch (e) { /* */ } }, 150);
      }
      try { if (typeof syncPause === 'function') syncPause(); } catch (e) { /* */ }
    },

    show() { this.refresh(); return !!(this.el && !this.el.hidden); },

    hide() {
      if (this.el) this.el.hidden = true;
      const adm = q('#pkqAdmin');
      const acts = q('#pkqActs');
      if (adm) adm.hidden = true;
      if (acts) acts.hidden = false;
      try { if (typeof syncPause === 'function') syncPause(); } catch (e) { /* */ }
    },

    /* 판이 끝났을 때(포획·전투불능) 한 판으로 센다 — 게스트는 세지 않는다 */
    onPlay(kind) {
      const slot = Quota.kid();
      if (Quota.isGuest(slot)) return false;
      const r = Quota.add(slot, 1);
      if (!r.blocked) return false;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        try {
          /* 결과 창을 잠깐 보여 준 뒤 잠그기 */
          this.refresh();
        } catch (e) { warn('quota show', e); }
      }, kind === 'faint' ? 900 : 1700);
      return true;
    },

    toOther() {
      const mine = Quota.kid();
      const other = Quota.otherSlot(mine);
      const id = Quota.profileIdOf(other);
      this.hide();
      if (!id) { UI.toast('다른 친구 프로필을 찾지 못했어요', 'info', 1600); return; }
      try {
        if (typeof chooseProfile === 'function') chooseProfile(id);
        else if (typeof applyProfile === 'function') applyProfile(id, {});
      } catch (e) { warn('quota switch', e); }
      const nm = Quota.roleOf(other);
      UI.toast(nm + ' 차례예요! ' + Quota.text(other) + ' 남았어요', 'good', 1800);
      setTimeout(() => { try { this.refresh(); } catch (e) { /* */ } }, 420);
    },

    openPin() {
      PinGate.open('quota', '🔓 아빠 횟수 관리',
        Quota.roleOf(Quota.kid()) + '의 오늘 판수를 초기화하거나 더 추가하려면 아빠 PIN 4자리를 눌러 주세요',
        () => {
          const adm = q('#pkqAdmin');
          const acts = q('#pkqActs');
          if (adm) adm.hidden = false;
          if (acts) acts.hidden = true;
          try { Sound.tone(1180, 0.16, 'triangle', 0.05); } catch (e) { /* */ }
        });
    },

    admin(kind) {
      const slot = Quota.kid();
      if (kind === 'reset') Quota.reset(slot);
      else if (kind === 'more1') Quota.add(slot, -1);
      else if (kind === 'more5') Quota.add(slot, -5);
      UI.toast(kind === 'reset' ? '🔁 오늘 횟수를 0으로 맞췄어요'
        : '➕ ' + Quota.roleOf(slot) + ' 오늘 ' + Quota.text(slot) + ' — 더 놀 수 있어요!', 'good', 2000);
      this.hide();
      setTimeout(() => { try { this.refresh(); } catch (e) { /* */ } }, 260);
      /* 결과 창이 떠 있으면 그대로, 아니면 새 판을 시작할 수 있게 둔다 */
    },

    /* 현재 프로필이 잠겼는지 보고, 잠겼으면 올린다 */
    check() {
      this.build();
      const slot = Quota.kid();
      if (Quota.isGuest(slot) || !Quota.blocked(slot)) { this.hide(); return false; }
      this.refresh();
      return true;
    },

    attach() {
      this.build();
      /* ESC 로는 닫히지 않게 (게임 쪽 ESC 핸들러 차단) */
      window.addEventListener('keydown', (e) => {
        if (!this.el || this.el.hidden) return;
        if (e.key === 'Escape' || e.key === 'Esc') {
          e.stopPropagation();
          e.preventDefault();
        }
      }, true);
      setTimeout(() => { try { this.check(); } catch (e) { warn('quota init', e); } }, 700);
    },
  };

  /* 보스 7칸 HP 가 보이도록 renderHp 를 7칸까지 그리게 바꾼다 */
  function installHp() {
    const orig = window.renderHp;
    if (typeof orig !== 'function' || orig.__pb3) return;
    const wrapped = function (el, hp, cap) {
      try {
        if (!el) return orig.apply(this, arguments);
        const max = el.id === 'myHp' ? MAXHP : (S.wild && S.wild.__boss ? BOSS_HP : MAXHP);
        const seg = Math.max(2, Math.min(max, cap || max));
        if (el.children.length !== seg) {
          el.innerHTML = '';
          for (let i = 0; i < seg; i += 1) el.appendChild(document.createElement('i'));
        }
        Array.prototype.forEach.call(el.children, (c, i) => { c.className = i < hp ? 'on' : ''; });
        el.classList.remove('warn', 'crit');
        if (hp <= 1) el.classList.add('crit');
        else if (hp <= 2) el.classList.add('warn');
        return undefined;
      } catch (e) { return orig.apply(this, arguments); }
    };
    wrapped.__pb3 = true;
    window.renderHp = wrapped;
  }

  /* ---------- 15. 데이터 · 초기화 ---------- */
  function loadEvoMap() {
    fetch('./evo-map.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => { if (o && o.next) PB.evo = o.next; })
      .catch(() => { /* 진화 데이터 없으면 진화 등장만 생략 */ });
  }

  function loadAll() {
    Partner.load();
    Balls.load();
    Shiny.load();
    try { Rare.load(); } catch (e) { warn('rare load', e); }
    try { Streak.load(); } catch (e) { warn('streak load', e); }
    try { Tickets.load(); } catch (e) { warn('ticket load', e); }
    try { Weak.load(); } catch (e) { warn('weak load', e); }
  }

  /* ============================================================
     17. 🔁 오답 노트(약점 덱) · 🗓️ 주간 출석 스탬프
     ─ 오답: 프로필별 pkm.wrong.v1.<slot>
         문제 객체(S.q)를 통째로 저장해 세 게임(산수·한글·영어)의
         기존 렌더러를 그대로 다시 쓴다 — 문제·보기·힌트·듣기가 그대로 재현된다.
     ─ 다음 판에 1~2문제를 2번째·4번째 문제로 다시 내고(🔁 복습! 배지),
         맞히면 그 문제는 오답 노트에서 졸업(삭제)된다.
     ─ 스탬프: 프로필별 pkm.stamp.v1.<slot> — 그 주 월~일,
         하루 한 판(포획 또는 기절)이면 오늘 칸에 도장.
         3일 슈퍼볼 ×2 · 5일 하이퍼볼 ×1 · 7일 마스터볼 ×1 자동 지급(주 1회).
     ============================================================ */
  const K_WRONG = (s) => 'pkm.wrong.v1.' + s;
  const K_STAMP = (s) => 'pkm.stamp.v1.' + s;
  const WRONG_MAX = 20;
  const REVIEW_AT = [2, 4];        /* 한 판에서 복습 문제가 나가는 순번(질문 기준) */

  function cloneQ(src) {
    try {
      const o = JSON.parse(JSON.stringify(src));
      delete o.__review;
      return o;
    } catch (e) { return null; }
  }
  function ansTextOf(src) {
    if (!src) return '';
    if (src.answer != null) return String(src.answer);
    if (src.ans != null) return String(src.ans);
    const c = (src.choices || []).find((x) => x && x.ok === true);
    return c ? String(c.t || c.v || '') : '';
  }

  const Weak = {
    items: [],
    key() { return K_WRONG(slotId()); },
    load() {
      const o = lsGet(this.key(), null);
      const list = (o && Array.isArray(o.items)) ? o.items : [];
      this.items = list.filter((it) => it && it.id && it.q).slice(-WRONG_MAX);
      return this.items;
    },
    save() {
      lsSet(this.key(), { v: 1, items: this.items.slice(-WRONG_MAX), updated: kstDate() });
    },
    count() { return this.items.length; },
    /* 같은 문제인지 — 과목 + 문제 본문(수식·낱말)이 같으면 같은 문제로 본다 */
    idOf(src) {
      const body = String((src && (src.text || src.qhtml || src.say)) || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      return GAME + '|' + body;
    },
    add(src) {
      if (!src || src.__review) return null;
      const q = cloneQ(src);
      if (!q || !Weak.usable(q)) return null;
      const id = this.idOf(q);
      if (!id) return null;
      const hit = this.items.find((it) => it.id === id);
      if (hit) {
        hit.wrong = Math.min(99, (Number(hit.wrong) || 1) + 1);
        hit.at = kstDate();
        this.save();
        return hit;
      }
      this.items.push({ id, subj: GAME, q, ans: ansTextOf(q), wrong: 1, at: kstDate() });
      if (this.items.length > WRONG_MAX) this.items.shift();
      this.save();
      return this.items[this.items.length - 1];
    },
    /* 저장한 문제를 이 과목 화면에서 그대로 다시 낼 수 있는지 — 보기·정답이 온전해야 한다 */
    usable(q) {
      if (!q || !Array.isArray(q.choices) || !q.choices.length) return false;
      if (GAME === 'math') {
        if (q.ans === undefined || q.ans === null) return false;
        return q.choices.some((c) => String(c) === String(q.ans));
      }
      return q.choices.filter((c) => c && c.ok === true).length === 1;
    },
    /* 다시 낼 수 없는 문제(예전 버전 저장분)는 조용히 버린다 */
    drop(id) {
      const i = this.items.findIndex((x) => x.id === id);
      if (i < 0) return false;
      this.items.splice(i, 1);
      this.save();
      return true;
    },
    bump(id) {
      const it = this.items.find((x) => x.id === id);
      if (!it) return null;
      it.wrong = Math.min(99, (Number(it.wrong) || 1) + 1);
      it.at = kstDate();
      this.save();
      return it;
    },
    /* 복습에서 맞히면 졸업 — 오답 노트에서 지운다 */
    graduate(id) {
      const i = this.items.findIndex((x) => x.id === id);
      if (i < 0) return false;
      this.items.splice(i, 1);
      this.save();
      return true;
    },
    clear() { this.items = []; this.save(); },
  };

  /* 이번 판에 어떤 복습 문제를 몇 번째에 낼지 정하고, 차례가 되면 하나씩 내준다 */
  const WeakServe = {
    plan: [],
    asked: 0,
    reset() {
      this.plan = [];
      this.asked = 0;
      try {
        /* 같은 과목 문제만 다시 낸다 — 저장한 문제 객체는 그 과목 화면(렌더러)에서만 그대로 그려진다 */
        const pool = Weak.items.filter((it) => it.subj === GAME);
        const n = pool.length;
        if (!n) return;
        for (let i = pool.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
        }
        /* 쌓인 오답이 4개 이상이면 2문제, 그보다 적으면 1문제 */
        this.plan = pool.slice(0, n >= 4 ? 2 : 1).map((it) => it.id);
      } catch (e) { warn('weak plan', e); }
    },
    take() {
      this.asked += 1;
      if (!this.plan.length) return null;
      if (REVIEW_AT.indexOf(this.asked) < 0) return null;
      const id = this.plan.shift();
      const it = Weak.items.find((x) => x.id === id);
      if (!it) return null;
      if (!Weak.usable(it.q)) { Weak.drop(id); return null; }   /* 모양이 깨진 예전 저장분은 건너뛴다 */
      const Q = cloneQ(it.q);
      if (!Q) return null;
      Q.__review = it.id;
      return Q;
    },
  };

  /* 문제 머리의 태그 자리를 복습 배지로 잠깐 바꿔 쓴다(레이아웃을 건드리지 않는다) */
  const ReviewTag = {
    def: '',
    el() { return q('#qTag') || q('.qhead .tag'); },
    remember() {
      const el = this.el();
      if (el && el.textContent && el.textContent !== '🔁 복습!') this.def = el.textContent;
    },
    paint() {
      const el = this.el();
      if (!el) return;
      const on = !!(S.q && S.q.__review);
      if (on) {
        if (el.textContent !== '🔁 복습!') el.textContent = '🔁 복습!';
        el.classList.add('pb2-rvtag');
      } else {
        el.classList.remove('pb2-rvtag');
        if (el.textContent === '🔁 복습!') el.textContent = this.def || '문제';
      }
    },
  };

  const WeakHook = {
    attach() {
      /* 문제 생성 — 복습 차례면 저장해 둔 문제를 그대로 돌려준다 */
      const origMQ = window.makeQuestion;
      if (typeof origMQ === 'function' && !origMQ.__pb2w) {
        const mq = function () {
          try {
            const rv = WeakServe.take();
            if (rv) return rv;
          } catch (e) { warn('weak take', e); }
          return origMQ.apply(this, arguments);
        };
        mq.__pb2w = true;
        window.makeQuestion = mq;
      }
      /* 문제를 화면에 그린 뒤 배지 */
      const origNew = window.newQuestion;
      if (typeof origNew === 'function' && !origNew.__pb2n) {
        const nq = function () {
          const out = origNew.apply(this, arguments);
          try { ReviewTag.paint(); } catch (e) { warn('rv tag', e); }
          return out;
        };
        nq.__pb2n = true;
        window.newQuestion = nq;
      }
      /* 출전 화면에 복습 개수 한 줄 */
      const origPrep = window.renderPrep;
      if (typeof origPrep === 'function' && !origPrep.__pb2p) {
        const rp = function () {
          const out = origPrep.apply(this, arguments);
          try { WeakBadge.paint(); } catch (e) { warn('rv prep', e); }
          return out;
        };
        rp.__pb2p = true;
        window.renderPrep = rp;
      }
    },
  };

  /* 출전 화면(누가 놀까요 → 준비)에 '🔁 복습 N' 한 줄 */
  const WeakBadge = {
    paint() {
      const quota = q('#prepQuota');
      if (!quota) return;
      let el = q('#pb2RvPq');
      let slot = slotId();
      try { slot = Quota.keyOfProfile(prepTarget()) || slot; } catch (e) { /* */ }
      let n = 0;
      try {
        n = slot === slotId() ? Weak.count() : ((lsGet(K_WRONG(slot), null) || {}).items || []).length;
      } catch (e) { n = 0; }
      if (!n) { if (el) el.hidden = true; return; }
      if (!el) {
        el = document.createElement('span');
        el.id = 'pb2RvPq';
        el.className = 'pq pb2-rvpq';
        quota.parentNode.insertBefore(el, quota.nextSibling);
      }
      el.hidden = false;
      el.textContent = '🔁 복습 ' + n;
      el.title = '틀린 문제 ' + n + '개 — 다음 판에 다시 나와요';
    },
  };

  /* ---------- 🗓️ 주간 출석 스탬프 ---------- */
  function kstDay() {
    const p = kstDate().split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  }
  /* 그 주 월요일(월~일 7칸) — 날짜 키는 KST 기준 YYYY-MM-DD */
  function weekInfo() {
    const d = kstDay();
    const idx = (d.getUTCDay() + 6) % 7;            /* 0=월 … 6=일 */
    const mon = new Date(d.getTime() - idx * 86400000);
    const days = [];
    for (let i = 0; i < 7; i += 1) days.push(new Date(mon.getTime() + i * 86400000).toISOString().slice(0, 10));
    return { key: days[0], idx, days, today: kstDate() };
  }
  const STAMP_LABEL = ['월', '화', '수', '목', '금', '토', '일'];
  /* 3·5·7일 보상 — 한 주에 한 번씩 */
  const STAMP_GIFTS = [
    { at: 3, add: { super: 2 }, name: '슈퍼볼 ×2' },
    { at: 5, add: { hyper: 1 }, name: '하이퍼볼 ×1' },
    { at: 7, add: { master: 1 }, name: '마스터볼 ×1' },
  ];

  function stampRead(slot) {
    const w = weekInfo();
    const raw = lsGet(K_STAMP(slot || slotId()), null);
    const out = (raw && raw.week === w.key && raw.days && typeof raw.days === 'object')
      ? { v: 1, week: w.key, days: raw.days, gave: (raw.gave && typeof raw.gave === 'object') ? raw.gave : {}, updated: raw.updated || '' }
      : { v: 1, week: w.key, days: {}, gave: {}, updated: '' };
    return out;
  }
  function stampCount(o, w) {
    let n = 0;
    w.days.forEach((k) => { if (o.days[k]) n += 1; });
    return n;
  }

  const Stamp = {
    state(slot) {
      const w = weekInfo();
      const o = stampRead(slot);
      return { week: w.key, idx: w.idx, days: w.days, marks: o.days, count: stampCount(o, w), gave: o.gave, today: w.today };
    },
    /* 오늘 도장 — 이미 찍혀 있으면 아무 일도 하지 않는다 */
    mark(quiet) {
      const slot = slotId();
      const w = weekInfo();
      const o = stampRead(slot);
      const today = w.today;
      let fresh = false;
      if (!o.days[today]) {
        o.days[today] = 1;
        o.updated = today;
        fresh = true;
      }
      const n = stampCount(o, w);
      const gifts = [];
      STAMP_GIFTS.forEach((g) => {
        if (n < g.at || o.gave[g.at]) return;
        o.gave[g.at] = 1;
        gifts.push(g);
      });
      if (fresh || gifts.length) lsSet(K_STAMP(slot), o);
      if (fresh && !quiet) {
        UI.toast('🗓️ 오늘 출석 도장! 이번 주 ' + n + '/7', 'good', 1700);
      }
      gifts.forEach((g) => {
        try { Balls.add(g.add, true); } catch (e) { warn('stamp gift', e); }
        UI.toast('🎁 ' + g.at + '일 출석 보상 — ' + g.name, 'good', 2400);
        try { Sound.fanfare(); } catch (e) { /* */ }
      });
      return { count: n, fresh, gifts: gifts.map((g) => g.name) };
    },
  };

  function init() {
    installHp();
    PinGate.build();
    ResetGate.attach();
    DexDelete.bind();
    QuotaLock.attach();
    /* 첫 터치에서 응원 목소리용 <audio> 를 한 번 열어 둔다(모바일 자동재생 차단 대비) */
    try {
      const warm = () => { try { Cheer.unlock(); } catch (e) { /* */ } };
      window.addEventListener('pointerdown', warm, { once: true, capture: true });
      window.addEventListener('touchstart', warm, { once: true, capture: true });
    } catch (e) { /* */ }
    UI.stage();
    bossStage();
    rankStage();
    UI.balls();
    UI.missionBtn();
    UI.ticketBtn();
    UI.modals();
    UI.timerGrid();
    UI.audioGrid();
    UI.rank();
    loadAll();
    initRankSeen();
    bossChip();
    UI.partner();
    UI.missionBadge();
    UI.timer();
    UI.paintTimerGrid();
    try { Tickets.sync(true); } catch (e) { warn('ticket init', e); }
    try { SpawnHook.attachFlee(); } catch (e) { warn('flee hook', e); }
    /* 🔁 오답 노트 — 문제 생성 · 배지 · 출전 화면 연결 */
    try { WeakHook.attach(); } catch (e) { warn('weak hook', e); }
    try { ReviewTag.remember(); } catch (e) { /* */ }
    TimerHook.attach();
    AnswerHook.attach();
    TimeoutHook.attach();
    SpawnHook.attach();
    CaptureHook.attach();
    try { FX.attach(); } catch (e) { warn('fx', e); }
    DexHook.attach();
    TimerHook.confirm();
    loadEvoMap();
    try { SpawnHook.onEncounter({ silent: true }); } catch (e) { warn('init encounter', e); }
    /* 프로필을 바꾸면 그 친구의 파트너·볼·랭크로 다시 그린다 */
    const origApply = window.applyProfile;
    if (typeof origApply === 'function' && !origApply.__pb2) {
      const a = function () {
        const out = origApply.apply(this, arguments);
        try {
          loadAll();
          UI.partner();
          UI.renderBalls();
          UI.rank();
          UI.missionBadge();
          UI.timer();
          initRankSeen();
          bossChip();
          try { WeakServe.reset(); } catch (e) { /* */ }
          try { Tickets.sync(true); } catch (e) { warn('ticket switch', e); }
          try { QuotaLock.check(); } catch (e) { warn('quota switch', e); }
        } catch (e) { warn('applyProfile', e); }
        return out;
      };
      a.__pb2 = true;
      window.applyProfile = a;
    }
    /* 출전 화면이 이미 그려져 있으면 복습 개수 한 줄도 맞춘다 */
    try { WeakBadge.paint(); } catch (e) { /* */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* 검증·디버그용 최소 공개 API */
  window.PB2 = {
    state: PB,
    partnerId: () => PB.partnerId,
    setPartner(id) { return Partner.set(id); },
    partnerModal() { UI.partnerModal(); },
    caughttle() { return Array.from((S.dex && S.dex.ids) || []); },
    balls: () => Object.assign({}, PB.balls),
    grant(add) { Balls.add(add, true); },
    combo: () => PB.combo,
    wrong: () => PB.wrong.slice(),
    shiny: () => Array.from(PB.shiny),
    mission: () => Mission.get(),
    timerOff: () => TimerPref.off(),
    theme: () => (q('#pb2Bg') ? q('#pb2Bg').dataset.theme : ''),
    rank: () => rankOf((S.dex && S.dex.ids) ? S.dex.ids.size : 0),
    forceSpawn(opts) {
      const o = opts || {};
      if (o.dex) {
        Object.keys(o.dex).forEach((id) => {
          S.dex.ids.add(Number(id));
          S.dex.counts[Number(id)] = o.dex[id];
        });
      }
      PB.evo = PB.evo || {};
      const orig = window.pickWild;
      window.pickWild = function () {
        const t = byId(o.id) || byId(25);
        return Object.assign({}, t, { level: 5, cp: 50, evolved: !!o.evolved, shiny: !!o.shiny });
      };
      newEncounter({ silent: true });
      window.pickWild = orig;
    },
    fireAt(type, back) {
      const p = q('#pb2Partner');
      const w = q('#wildWrap');
      if (back) fire(w, p, type || '불꽃', { back: true });
      else fire(p, w, type || '불꽃', {});
    },
    cry(id) { playCry(id || (S.wild && S.wild.id) || 25, true); },
    openMission() { UI.missionModal(); },
    openReview() { Review.open(); },
    reviewState() { return PB.rv; },
    /* 7탄 검증용 — 🔁 오답 노트 · 🗓️ 주간 스탬프 */
    weak: {
      count: () => Weak.count(),
      list: () => Weak.items.map((it) => ({ subj: it.subj, ans: it.ans, wrong: it.wrong, id: it.id })),
      plan: () => WeakServe.plan.slice(),
      asked: () => WeakServe.asked,
      current: () => (S.q && S.q.__review) || '',
      tag: () => { const el = q('#qTag') || q('.qhead .tag'); return el ? el.textContent : ''; },
      add(src) { const it = Weak.add(src); return it ? it.id : ''; },
      clear() { Weak.clear(); WeakServe.reset(); },
      /* 검증용 — 지금 판의 다음 복습 차례를 바로 앞당긴다 */
      forceNext() { WeakServe.asked = REVIEW_AT[0] - 1; return WeakServe.plan.slice(); },
    },
    stamp: {
      state: (slot) => Stamp.state(slot),
      key: (slot) => K_STAMP(slot || slotId()),
      mark: () => Stamp.mark(),
      week: () => weekInfo(),
    },
    markMission(g) { return Mission.mark(g || GAME); },
    /* 6탄 검증용 — 배경 아트·이펙트 */
    art: () => (q('#pb2Bg') ? q('#pb2Bg').dataset.art || '' : ''),
    fx: {
      burst(x, y, n, spread, opts) { FX.burst(x, y, n, spread, opts); },
      hit() { FX.hitWild(); },
      palette: (t) => FX.palOf(atkOf(t || '노말').k),
      alive() { return q('#fx') ? q('#fx').childElementCount : -1; },
    },
    settingsConfirm() { const b = q('#pb2SetConfirm'); if (b) b.click(); },
    /* 3탄 검증용 */
    bossMode: () => bossMode(),
    bossRecord: () => lsGet(K_BOSS(slotId()), { count: 0 }),
    forceBoss(id) {
      const t = byId(id || 150) || byId(25);
      const orig = window.pickWild;
      window.pickWild = function () { return Object.assign({}, t, { level: 50, cp: 1200, __boss: true }); };
      try { newEncounter({ silent: false }); } finally { window.pickWild = orig; }
    },
    itemInv: () => lsGet(K_INV(slotId()), {}),
    dropChance: () => dropChance(),
    rollGift: () => rollGift(),
    grantItem(n) { return grantVillageItem(n || 1).map((x) => x && x.k); },
    superHit: () => superHit(),
    showRankUp(a, b) { showRankUp(a === undefined ? 0 : a, b === undefined ? 1 : b); },
    pin: {
      open(mode, title, desc, fn) { PinGate.open(mode, title, desc, fn); },
      press(d) { PinGate.press(d); },
      state() { return { open: PinGate.el ? !PinGate.el.hidden : false, buf: PinGate.buf, fails: PinGate.fails, mode: PinGate.mode }; },
      close() { PinGate.close(); },
    },
    deleteCaught(id) { DexDelete.ask(id); },
    dexCount: () => dexCount(),
    rankIdx: () => rankIdx(dexCount()),
    /* 4탄 검증용 — 공정 횟수 & 재등장 확률 */
    quota: {
      state: () => Quota.summary(),
      kid: () => Quota.kid(),
      keyOf: (profId) => Quota.keyOfProfile(profId),
      plays: () => Quota.read().plays,
      limit: () => Quota.limit(),
      text: (slot) => Quota.text(slot || Quota.kid()),
      blocked: (slot) => Quota.blocked(slot || Quota.kid()),
      setLimit(n) { const v = Quota.setLimit(n); QuotaLock.refresh(); return v; },
      add(n) { const r = Quota.add(Quota.kid(), n === undefined ? 1 : n); QuotaLock.check(); return r; },
      reset(slot) { const v = Quota.reset(slot || Quota.kid()); QuotaLock.check(); return v; },
      onPlay: (kind) => QuotaLock.onPlay(kind || 'capture'),
      open: () => QuotaLock.show(),
      hide: () => QuotaLock.hide(),
      openPin: () => QuotaLock.openPin(),
      isOpen: () => !!(QuotaLock.el && !QuotaLock.el.hidden),
      admin(kind) { QuotaLock.admin(kind); return Quota.read(); },
      clear() { try { lsSet(QK, { v: 1, date: kstDate(), limit: QUOTA_DEFAULT, plays: {} }); } catch (e) { /* */ } },
      date: () => kstDate(),
    },
    recatchRate: () => recatchRate(dexCount()),
    /* 7탄 검증용 — 등장 밸런스·희귀 쿨다운·연승·생태계·소환권 */
    balance: {
      recatchRate: () => recatchRate(dexCount()),
      bossRate: () => BOSS_RATE,
      legendRate: () => (typeof LEGEND_RATE === 'number' ? LEGEND_RATE : null),
      legendBoostRate: () => 0.05,
      eco: () => ({
        tag: ecoTag(), night: isNightKST(), weekend: isWeekendKST(), hour: kstHour(),
        dayTypes: Object.keys(ECO_DAY), nightTypes: Object.keys(ECO_NIGHT), weekendTypes: Object.keys(ECO_WEEKEND),
      }),
      ecoWeight: (id) => ecoWeight(byId(id)),
      rareCooling: () => Rare.cooling(),
      rareLeft: () => Rare.left(),
      rareHist: () => Rare.hist.slice(),
      resetRare: () => { Rare.clear(); return Rare.hist.length; },
    },
    streak: {
      n: () => Streak.n,
      evoBonus: () => Streak.evoBonus(),
      shinyBonus: () => Streak.shinyBonus(),
      up: () => Streak.up(),
      reset: () => Streak.reset(),
      evoRate: () => EVO_RATE + Streak.evoBonus(),
    },
    tickets: {
      state: () => ({ n: Tickets.count(), granted: Tickets.data.granted.slice(), dex: dexCount(), guest: Tickets.isGuest() }),
      sync: (silent) => Tickets.sync(!!silent),
      open: () => UI.summonModal(),
      pick(id) { UI.summonModal(); UI._summonPick = Number(id) || 0; UI.summonRender(); return UI._summonPick; },
      go: (id) => Summon.go(Number(id)),
      grant(n) {
        Tickets.load();
        Tickets.data.n = Math.max(0, Number(n) || 0);
        Tickets.save();
        UI.tickets();
        return Tickets.count();
      },
      /* 검증·수습용 — 이 슬롯의 소환권 기록을 처음 상태로 */
      reset() { Tickets.clear(); return { n: Tickets.count(), granted: Tickets.data.granted.slice() }; },
    },
    /* 등장 시뮬레이션 — pickWild 를 n번 돌리며 희귀 쿨다운까지 그대로 적용한다 */
    simSpawn(n) {
      const out = [];
      const N = Math.max(1, Math.min(600, Number(n) || 100));
      for (let i = 0; i < N; i += 1) {
        let p = null;
        try { p = window.pickWild(out.length ? out[out.length - 1].id : -1); } catch (e) { break; }
        if (!p) break;
        try { Rare.record(p); } catch (e) { /* */ }
        out.push({
          id: p.id, name: p.name, type: (p.types || [])[0] || '',
          boss: !!p.__boss, leg: !!p.leg, myth: !!p.myth, evo: !!p.evolved, shiny: !!p.shiny,
        });
      }
      return out;
    },
    cheer: {
      play: () => Cheer.play(),
      words: () => Cheer.words.slice(),
      lastAt: () => Cheer.last,
      muted: () => Cheer.muted(),
      lastSrc: () => { try { return Cheer.audio ? Cheer.audio.src : ''; } catch (e) { return ''; } },
    },
    /* 🔊 볼륨 분리 검증용 */
    audio: {
      state: () => (window.PKMAudio ? window.PKMAudio.state() : null),
      openSettings() { UI.audioGrid(); try { openModal('settingsModal'); } catch (e) { /* */ } },
      cryVolume() { return PB.audio ? PB.audio.volume : null; },
      cheerVolume() { return Cheer.audio ? Cheer.audio.volume : null; },
    },
    /* 검증용 — 보스·진화·전설 보정 없이, 재등장 섞기만 적용된 기본 등장 */
    basePick(n) {
      const out = [];
      if (!basePickOrigin) return out;
      for (let i = 0; i < (n || 200); i += 1) {
        try { out.push(pickWildRecatch(basePickOrigin, [-1])); } catch (e) { break; }
      }
      return out.map((p) => (p && p.id) || 0);
    },
  };
})();
