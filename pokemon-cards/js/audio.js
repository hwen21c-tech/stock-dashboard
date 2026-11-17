/* audio.js — 프리미엄 Web Audio 멀티트랙 신스 엔진 (외부 음원 0)
   · 홈(상점·도감) 모험·아케이드 BGM  · 배틀 아레나 BGM  · 라운드 승/패 징글
   · 팩 뜯기 / 카드 리빌 / 속성 공격 / KO 효과음 */
(function () {
  'use strict';
  let ctx = null, master = null, sfxBus = null, revBus = null, conv = null;
  let bgmBase = null, bgmBattle = null;
  let started = false, timer = null, nextTime = 0, step = 0;
  let mode = 'home';            // 'home' | 'battle'
  const S = () => window.PKC.state.settings;

  function now() { return ctx ? ctx.currentTime : 0; }
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  function makeImpulse(sec, decay) {
    const rate = ctx.sampleRate, len = Math.max(1, Math.floor(rate * sec));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 8;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    comp.connect(ctx.destination);

    master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);

    bgmBase = ctx.createGain(); bgmBase.gain.value = 0; bgmBase.connect(master);
    bgmBattle = ctx.createGain(); bgmBattle.gain.value = 0; bgmBattle.connect(master);

    conv = ctx.createConvolver(); conv.buffer = makeImpulse(2.8, 2.6);
    revBus = ctx.createGain(); revBus.gain.value = 0.4;
    conv.connect(revBus); revBus.connect(master);

    applySettings();
    return ctx;
  }

  function applySettings() {
    if (!ctx) return;
    const s = S();
    const v = typeof s.volume === 'number' ? s.volume : 0.7;
    master.gain.setTargetAtTime(s.sfx ? 0.92 : 0, now(), 0.05);
    const on = s.bgm && s.sfx;
    bgmBase.gain.setTargetAtTime(on && mode === 'home' ? 0.24 * v : 0, now(), 0.3);
    bgmBattle.gain.setTargetAtTime(on && mode === 'battle' ? 0.3 * v : 0, now(), 0.3);
  }

  function unlock() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    startBgm();
  }

  /* ---------------- 기본 오실레이터 도구 ---------------- */
  function env(g, t0, a, d, peak, sus) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    if (sus) g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * sus), t0 + a + d * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function tone(freq, t0, dur, type, peak, dest, slideTo, detune) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur * 0.92);
    if (detune) o.detune.value = detune;
    o.connect(g); g.connect(dest || sfxBus);
    env(g, t0, 0.008, dur, peak == null ? 0.25 : peak);
    o.start(t0); o.stop(t0 + dur + 0.06);
    return o;
  }

  function filtTone(freq, t0, dur, type, peak, dest, cutoff, q, sweepTo) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = type || 'sawtooth';
    o.frequency.setValueAtTime(freq, t0);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff || 1400, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(80, sweepTo), t0 + dur);
    f.Q.value = q == null ? 1.2 : q;
    o.connect(f); f.connect(g); g.connect(dest || sfxBus);
    env(g, t0, 0.006, dur, peak == null ? 0.2 : peak);
    o.start(t0); o.stop(t0 + dur + 0.06);
    return o;
  }

  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 2);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    return s;
  }

  function noiseBurst(t0, dur, f0, f1, q, peak, dest, type) {
    if (!ctx) return;
    const s = noise();
    const bp = ctx.createBiquadFilter();
    bp.type = type || 'bandpass';
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t0 + dur);
    bp.Q.value = q || 1.2;
    const g = ctx.createGain();
    s.connect(bp); bp.connect(g); g.connect(dest || sfxBus);
    env(g, t0, 0.005, dur, peak == null ? 0.3 : peak);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  function kick(t0, dest, peak) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(132, t0);
    o.frequency.exponentialRampToValueAtTime(44, t0 + 0.16);
    o.connect(g); g.connect(dest || bgmBase);
    g.gain.setValueAtTime(peak == null ? 0.34 : peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    o.start(t0); o.stop(t0 + 0.24);
  }
  function snare(t0, dest, peak) {
    const s = noise(); const bp = ctx.createBiquadFilter(); const g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.9;
    s.connect(bp); bp.connect(g); g.connect(dest || bgmBase);
    g.gain.setValueAtTime(peak == null ? 0.16 : peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
    s.start(t0); s.stop(t0 + 0.17);
    tone(190, t0, 0.09, 'triangle', 0.09, dest || bgmBase);
  }
  function hat(t0, dest, open, peak) {
    const s = noise(); const hp = ctx.createBiquadFilter(); const g = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 7600;
    s.connect(hp); hp.connect(g); g.connect(dest || bgmBase);
    const d = open ? 0.11 : 0.045;
    g.gain.setValueAtTime(peak == null ? 0.07 : peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    s.start(t0); s.stop(t0 + d + 0.02);
  }
  function bell(t0, freq, dur, dest, peak) {
    if (!ctx) return;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o2.type = 'triangle';
    o.frequency.value = freq; o2.frequency.value = freq * 2.01;
    const g2 = ctx.createGain(); g2.gain.value = 0.32;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest || bgmBase); g.connect(conv);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak == null ? 0.14 : peak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0); o2.start(t0); o.stop(t0 + dur + 0.05); o2.stop(t0 + dur + 0.05);
  }

  /* ---------------- SFX ---------------- */
  const SFX = {
    tap() { init(); tone(560, now(), 0.055, 'sine', 0.1); },
    rip() {
      init(); const t = now();
      noiseBurst(t, 0.18, 520, 3400, 0.9, 0.34);
      noiseBurst(t + 0.13, 0.24, 2700, 720, 1.4, 0.3);
      for (let i = 0; i < 10; i++) noiseBurst(t + 0.02 + i * 0.042, 0.05, 1800 + Math.random() * 2600, 900, 2.2, 0.15);
      tone(180, t, 0.22, 'sawtooth', 0.08, sfxBus, 88);
    },
    whoosh() { init(); const t = now(); noiseBurst(t, 0.5, 280, 2800, 0.7, 0.2); },
    flip() {
      init(); const t = now();
      noiseBurst(t, 0.12, 1200, 4400, 1.6, 0.2);
      tone(880, t, 0.08, 'triangle', 0.13, sfxBus, 1420);
    },
    coin() {
      init(); const t = now();
      tone(1180, t, 0.09, 'square', 0.14); tone(1580, t + 0.07, 0.13, 'square', 0.12);
      bell(t + 0.02, 2350, 0.3, sfxBus, 0.05);
    },
    sparkle() {
      init(); const t = now();
      for (let i = 0; i < 7; i++) bell(t + i * 0.05, 1800 + Math.random() * 2200, 0.3, sfxBus, 0.05);
    },
    error() { init(); const t = now(); tone(300, t, 0.12, 'square', 0.15, sfxBus, 180); tone(200, t + 0.1, 0.16, 'square', 0.13, sfxBus, 120); },
    levelUp() {
      init(); const t = now();
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.09, 0.5, 'triangle', 0.16));
      noiseBurst(t, 0.8, 600, 4200, 0.9, 0.1);
    },
    /* 카드 리빌: 등급별 드라마 */
    reveal(tier) {
      init(); const t = now();
      const T = tier || 1;
      // 상승 라이저
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; f.type = 'lowpass';
      o.frequency.setValueAtTime(T >= 4 ? 180 : 240, t);
      o.frequency.exponentialRampToValueAtTime(T >= 4 ? 1500 : 900, t + 0.42);
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(4200, t + 0.45);
      o.connect(f); f.connect(g); g.connect(sfxBus);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(T >= 4 ? 0.13 : 0.08, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.start(t); o.stop(t + 0.6);
      // 충격
      const t2 = t + 0.46;
      if (T >= 5) {
        noiseBurst(t2, 0.7, 5200, 300, 0.7, 0.26, sfxBus, 'lowpass');
        kick(t2, sfxBus, 0.4);
        [523, 659, 784, 1046, 1318, 1568, 2093].forEach((fr, i) => bell(t2 + 0.02 + i * 0.06, fr, 1.1, sfxBus, 0.11));
        for (let i = 0; i < 12; i++) bell(t2 + 0.2 + i * 0.045, 2600 + Math.random() * 2600, 0.4, sfxBus, 0.035);
      } else if (T >= 4) {
        noiseBurst(t2, 0.5, 4200, 400, 0.8, 0.2, sfxBus, 'lowpass');
        kick(t2, sfxBus, 0.3);
        [523, 659, 880, 1046].forEach((fr, i) => bell(t2 + i * 0.07, fr, 0.7, sfxBus, 0.1));
      } else if (T >= 2) {
        noiseBurst(t2, 0.3, 3200, 800, 1.0, 0.13, sfxBus, 'lowpass');
        [784, 988, 1174].forEach((fr, i) => bell(t2 + i * 0.07, fr, 0.4, sfxBus, 0.07));
      } else {
        tone(660, t2, 0.16, 'sine', 0.1);
        tone(880, t2 + 0.08, 0.18, 'sine', 0.08);
      }
    },
    /* 라운드 승리/패배 징글 */
    roundWin() {
      init(); const t = now();
      [523, 659, 784].forEach((f, i) => tone(f, t + i * 0.075, 0.22, 'square', 0.11));
      tone(1046, t + 0.23, 0.42, 'triangle', 0.14);
      bell(t + 0.24, 1568, 0.7, sfxBus, 0.06);
    },
    roundLose() {
      init(); const t = now();
      tone(392, t, 0.2, 'triangle', 0.13, sfxBus, 330);
      tone(311, t + 0.16, 0.24, 'triangle', 0.12, sfxBus, 250);
      tone(233, t + 0.34, 0.5, 'sawtooth', 0.08, sfxBus, 160);
    },
    win() {
      init(); const t = now();
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.1, 0.3, 'triangle', 0.2));
      tone(1568, t + 0.42, 0.62, 'sine', 0.13);
    },
    lose() { init(); const t = now(); [440, 392, 330, 262].forEach((f, i) => tone(f, t + i * 0.12, 0.3, 'triangle', 0.16)); },
    /* 속성 공격 */
    attack(ko) {
      init(); const t = now() + 0.02;
      const map = {
        '불꽃': () => { noiseBurst(t, 0.34, 1100, 160, 0.75, 0.26, sfxBus, 'lowpass'); tone(230, t, 0.3, 'sawtooth', 0.11, sfxBus, 90); kick(t, sfxBus, 0.26); },
        '물': () => { tone(760, t, 0.3, 'sine', 0.16, sfxBus, 260); noiseBurst(t, 0.26, 1900, 420, 1.4, 0.14); },
        '번개': () => { for (let i = 0; i < 5; i++) tone(2400 - i * 320, t + i * 0.035, 0.07, 'square', 0.11); noiseBurst(t, 0.16, 3600, 1200, 1.8, 0.16); kick(t + 0.02, sfxBus, 0.22); },
        '풀': () => { for (let i = 0; i < 4; i++) tone(500 + i * 90, t + i * 0.05, 0.26, 'triangle', 0.1, sfxBus, 780 + i * 90); noiseBurst(t, 0.2, 2400, 900, 1.6, 0.1); },
        '초': () => { tone(620, t, 0.5, 'sine', 0.12, sfxBus, 980); tone(930, t + 0.05, 0.5, 'sine', 0.08, sfxBus, 1320); noiseBurst(t, 0.3, 1600, 600, 2.2, 0.08); },
        '격투': () => { tone(120, t, 0.3, 'square', 0.2, sfxBus, 62); noiseBurst(t, 0.2, 320, 110, 0.7, 0.18, sfxBus, 'lowpass'); kick(t, sfxBus, 0.32); },
        '악': () => { tone(180, t, 0.45, 'sawtooth', 0.14, sfxBus, 96); noiseBurst(t, 0.34, 620, 180, 0.6, 0.12, sfxBus, 'lowpass'); },
        '강철': () => { tone(1420, t, 0.3, 'square', 0.1); tone(2140, t + 0.03, 0.26, 'square', 0.07); noiseBurst(t, 0.16, 5200, 2600, 2.4, 0.1); },
        '드래곤': () => { tone(150, t, 0.6, 'sawtooth', 0.15, sfxBus, 56); tone(300, t + 0.06, 0.45, 'triangle', 0.1, sfxBus, 120); noiseBurst(t, 0.4, 800, 200, 0.9, 0.1, sfxBus, 'lowpass'); },
        '페어리': () => { [880, 1100, 1320, 1760, 2093].forEach((f, i) => bell(t + i * 0.05, f, 0.5, sfxBus, 0.06)); },
        '무색': () => { tone(520, t, 0.2, 'triangle', 0.12); tone(700, t + 0.06, 0.22, 'triangle', 0.1); kick(t, sfxBus, 0.18); }
      };
      (map[ko] || map['무색'])();
    },
    /* KO */
    koHit() {
      init(); const t = now();
      noiseBurst(t, 0.45, 2400, 180, 0.55, 0.3, sfxBus, 'lowpass');
      kick(t, sfxBus, 0.42);
      tone(150, t, 0.5, 'sawtooth', 0.14, sfxBus, 46);
      tone(72, t + 0.02, 0.7, 'sine', 0.2, sfxBus, 34);
      for (let i = 0; i < 3; i++) noiseBurst(t + 0.4 + i * 0.14, 0.22, 1600 - i * 400, 300, 1.0, 0.09);
    },
    /* 타이밍 바 미니게임 */
    barStart() {
      init(); const t = now();
      noiseBurst(t, 0.26, 320, 2600, 0.9, 0.11);
      tone(420, t, 0.36, 'sawtooth', 0.07, sfxBus, 940);
      tone(620, t + 0.06, 0.3, 'triangle', 0.055, sfxBus, 1280);
    },
    barTick(z) {
      init(); const t = now();
      const f = z >= 3 ? 1980 : z >= 2 ? 1560 : 1120;
      tone(f, t, 0.05, 'square', z >= 2 ? 0.06 : 0.04);
    },
    critHit(mult) {
      init(); const t = now();
      const T = mult || 1.5;
      noiseBurst(t, 0.2, 4200, 700, 1.1, 0.15);
      kick(t, sfxBus, T >= 2 ? 0.3 : 0.2);
      if (T >= 2.5) [523, 784, 1046, 1318, 1568, 2093].forEach((f, i) => bell(t + 0.02 + i * 0.05, f, 0.7, sfxBus, 0.08));
      else if (T >= 2) [523, 784, 1046, 1318].forEach((f, i) => bell(t + 0.02 + i * 0.06, f, 0.55, sfxBus, 0.07));
      else [659, 880].forEach((f, i) => bell(t + 0.01 + i * 0.06, f, 0.4, sfxBus, 0.06));
    },
    barMiss() {
      init(); const t = now();
      tone(300, t, 0.12, 'square', 0.09, sfxBus, 190);
      noiseBurst(t + 0.02, 0.16, 900, 260, 1.2, 0.08, sfxBus, 'lowpass');
    },
    /* 카드가 슬롯으로 날아가 붙는 소리 */
    slot() {
      init(); const t = now();
      noiseBurst(t, 0.14, 3000, 1400, 1.4, 0.08);
      tone(1200, t, 0.08, 'triangle', 0.08, sfxBus, 1900);
    },
    typePop(ko) {
      init(); const t = now();
      const map = {
        '불꽃': '#ff7648', '물': '#4bb8ff', '번개': '#ffd93d', '풀': '#4bd47a', '초': '#c07bff',
        '격투': '#e2703a', '악': '#8a6bb5', '강철': '#9fb4c7', '드래곤': '#6a7bff',
        '무색': '#c8cfe8', '페어리': '#ff9ad5'
      };
      if (map[ko]) noiseBurst(t, 0.2, 1200, 500, 1.2, 0.09);
      tone(520, t, 0.16, 'sine', 0.1);
      tone(780, t + 0.05, 0.2, 'sine', 0.08);
    }
  };

  /* ---------------- BGM 패턴 ---------------- */
  // 진행: I - V - vi - IV (C major) / 배틀: Am - F - G - E
  const BASE_CHORDS = [
    [261.63, 329.63, 392.00],  // C
    [392.00, 493.88, 587.33],  // G
    [440.00, 523.25, 659.26],  // Am
    [349.23, 440.00, 523.25]   // F
  ];
  // 멜로디 (16분음표 16칸 × 8마디, null=쉼)
  const BASE_MEL = [
    [null, null, 659.26, null, 783.99, null, 659.26, null, 587.33, null, 523.25, null, 587.33, null, null, null],
    [null, null, 783.99, null, 880.00, null, 783.99, null, 659.26, null, 587.33, null, 659.26, null, null, null],
    [null, 880.00, null, 783.99, null, 659.26, null, 587.33, 659.26, null, 783.99, null, 880.00, null, null, null],
    [null, null, 698.46, null, 659.26, null, 587.33, null, 523.25, null, 587.33, null, 659.26, null, null, null],
    [null, null, 659.26, null, 783.99, null, 659.26, null, 587.33, null, 523.25, null, 587.33, null, null, null],
    [null, null, 783.99, null, 880.00, null, 783.99, null, 659.26, null, 587.33, null, 659.26, null, null, null],
    [null, 880.00, null, 783.99, null, 659.26, null, 587.33, 659.26, null, 783.99, null, 880.00, null, null, null],
    [null, null, 783.99, null, 659.26, null, 587.33, null, 523.25, null, 587.33, null, 659.26, null, null, null]
  ];
  const BATTLE_CHORDS = [
    [220.00, 261.63, 329.63],  // Am
    [174.61, 220.00, 261.63],  // F
    [196.00, 246.94, 293.66],  // G
    [164.81, 207.65, 261.63]   // E
  ];
  const BATTLE_ARP = [
    [0, 7, 12, 7, 15, 7, 12, 19],
    [0, 5, 12, 5, 16, 5, 12, 17],
    [0, 7, 12, 7, 15, 7, 12, 19],
    [0, 4, 12, 4, 16, 4, 12, 14]
  ];

  let n8 = 0;      // 배틀 아르페지오 스텝

  function schedBase(t, i) {
    const bar = Math.floor(i / 16) % 8;
    const chord = BASE_CHORDS[bar % 4];
    // 패드
    if (i % 16 === 0) {
      chord.forEach((f, k) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), flt = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f / 2; o.detune.value = (k - 1) * 8;
        flt.type = 'lowpass'; flt.frequency.value = 1100; flt.Q.value = 0.7;
        o.connect(flt); flt.connect(g); g.connect(bgmBase); g.connect(conv);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.075, t + 0.35);
        g.gain.linearRampToValueAtTime(0.0001, t + 1.9);
        o.start(t); o.stop(t + 2.0);
      });
    }
    // 베이스 (8분 음표)
    if (i % 2 === 0) {
      const root = chord[0] / 2;
      const oct = (i % 8 === 4) ? 2 : 1;
      filtTone(root * oct, t, 0.18, 'square', 0.13, bgmBase, 900, 2.4, 380);
    }
    // 멜로디
    const f = BASE_MEL[bar] ? BASE_MEL[bar][i % 16] : null;
    if (f) {
      filtTone(f, t, 0.28, 'square', 0.085, bgmBase, 2800, 1.6, 1600);
      filtTone(f * 2, t + 0.005, 0.16, 'triangle', 0.035, bgmBase, 5000, 1.2);
      if (i % 8 === 0) bell(t, f * 2, 0.5, bgmBase, 0.045);
    }
    // 드럼
    if (i % 8 === 0) kick(t, bgmBase, 0.3);
    if (i % 8 === 4) kick(t, bgmBase, 0.2);
    if (i % 8 === 2 || i % 8 === 6) snare(t, bgmBase, 0.1);
    hat(t, bgmBase, i % 8 === 6, i % 2 === 0 ? 0.045 : 0.028);
    // 아르페지오 반짝임
    if (i % 4 === 2) {
      const scale = [0, 4, 7, 12, 16];
      const fr = chord[0] * 2 * Math.pow(2, scale[(i / 4 + bar) % 5 | 0] / 12);
      bell(t, fr, 0.28, bgmBase, 0.025);
    }
  }

  function schedBattle(t, i) {
    const bar = Math.floor(i / 16) % 4;
    const chord = BATTLE_CHORDS[bar];
    // 4분 킥 + 스네어 2·4
    if (i % 4 === 0) kick(t, bgmBattle, 0.4);
    if (i % 16 === 4 || i % 16 === 12) snare(t, bgmBattle, 0.19);
    if (i % 2 === 1) hat(t, bgmBattle, false, 0.03);
    if (i % 8 === 7) hat(t, bgmBattle, true, 0.05);
    // 오프비트 베이스
    if (i % 4 === 2) {
      const root = chord[0] / 2;
      filtTone(root * (i % 8 === 6 ? 2 : 1), t, 0.16, 'sawtooth', 0.16, bgmBattle, 700, 3.2, 260);
    }
    // 16분 아르페지오 리드
    const seq = BATTLE_ARP[bar];
    const fr = chord[0] * Math.pow(2, seq[i % 8] / 12);
    filtTone(fr * 2, t, 0.13, 'square', 0.055, bgmBattle, 4200, 2.2, 2400);
    if (i % 8 === 0) {
      // 리드 스탭
      filtTone(chord[1] * 2, t, 0.4, 'sawtooth', 0.06, bgmBattle, 3200, 1.4, 1600);
      bell(t, chord[2] * 2, 0.5, bgmBattle, 0.03);
    }
    // 긴장 패드
    if (i % 16 === 0) {
      chord.forEach((f, k) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), flt = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (k - 1) * 9;
        flt.type = 'lowpass'; flt.frequency.value = 1500; flt.Q.value = 1.1;
        o.connect(flt); flt.connect(g); g.connect(bgmBattle); g.connect(conv);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.055, t + 0.2);
        g.gain.linearRampToValueAtTime(0.0001, t + 1.4);
        o.start(t); o.stop(t + 1.5);
      });
    }
  }

  function startBgm() {
    init();
    if (!ctx || timer) return;
    step = 0; nextTime = ctx.currentTime + 0.12;
    timer = setInterval(() => {
      if (!ctx || ctx.state === 'suspended') return;
      const spb = (60 / (mode === 'battle' ? 148 : 116)) / 4;   // 16분 음표
      while (nextTime < ctx.currentTime + 0.24) {
        if (mode === 'battle') schedBattle(nextTime, step); else schedBase(nextTime, step);
        nextTime += spb; step++;
      }
    }, 60);
    applySettings();
  }

  function setMode(m) {
    init();
    if (mode === m) { applySettings(); return; }
    mode = m; n8 = 0;
    applySettings();
  }

  function toggleBgm(on) { init(); S().bgm = on; applySettings(); window.PKC.save(); if (on) startBgm(); }
  function toggleSfx(on) { init(); S().sfx = on; applySettings(); window.PKC.save(); }
  function setVolume(v) { init(); S().volume = v; applySettings(); window.PKC.save(); }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { if (ctx.state === 'running') ctx.suspend(); }
    else { ctx.resume(); }
  });

  window.PKCAudio = {
    init, unlock, sfx: SFX, toggleBgm, toggleSfx, setVolume, applySettings,
    setMode, get mode() { return mode; }
  };
})();
