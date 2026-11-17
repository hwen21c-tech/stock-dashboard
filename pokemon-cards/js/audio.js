/* audio.js — 멀티레이어 Web Audio 엔진 (외부 음원 0) */
(function () {
  'use strict';
  let ctx = null, master = null, sfxBus = null, bgmBus = null, revBus = null, conv = null;
  let started = false, bgmTimer = null, step = 0, nextTime = 0;
  const S = () => window.PKC.state.settings;

  function now() { return ctx ? ctx.currentTime : 0; }

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
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
    bgmBus = ctx.createGain(); bgmBus.gain.value = 0.0; bgmBus.connect(master);
    conv = ctx.createConvolver(); conv.buffer = makeImpulse(2.6, 2.4);
    revBus = ctx.createGain(); revBus.gain.value = 0.45;
    conv.connect(revBus); revBus.connect(master);
    applySettings();
    return ctx;
  }

  function applySettings() {
    if (!ctx) return;
    const s = S();
    const v = typeof s.volume === 'number' ? s.volume : 0.7;
    master.gain.setTargetAtTime(s.sfx ? 0.9 : 0, now(), 0.05);
    bgmBus.gain.setTargetAtTime(s.bgm && s.sfx ? 0.16 * v : 0, now(), 0.25);
  }

  function unlock() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    startBgm();
  }

  function env(g, t0, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function tone(freq, t0, dur, type, peak, dest, slideTo, detune) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur * 0.9);
    if (detune) o.detune.value = detune;
    o.connect(g); g.connect(dest || sfxBus);
    env(g, t0, 0.008, dur, peak == null ? 0.25 : peak);
    o.start(t0); o.stop(t0 + dur + 0.08);
    return o;
  }

  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) {
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    return s;
  }

  function noiseBurst(t0, dur, f0, f1, q, peak, dest) {
    if (!ctx) return;
    const s = noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, f1), t0 + dur);
    bp.Q.value = q || 1.2;
    const g = ctx.createGain();
    s.connect(bp); bp.connect(g); g.connect(dest || sfxBus);
    env(g, t0, 0.006, dur, peak == null ? 0.3 : peak);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  /* ---------------- SFX ---------------- */
  const SFX = {
    tap() { init(); tone(520, now(), 0.06, 'sine', 0.12); },
    rip() {
      init(); const t = now();
      noiseBurst(t, 0.18, 500, 3200, 0.9, 0.35);
      noiseBurst(t + 0.14, 0.22, 2600, 700, 1.4, 0.3);
      for (let i = 0; i < 9; i++) {
        noiseBurst(t + 0.02 + i * 0.045, 0.05, 1800 + Math.random() * 2400, 900, 2.2, 0.16);
      }
      tone(180, t, 0.2, 'sawtooth', 0.08, sfxBus, 90);
    },
    whoosh() { init(); const t = now(); noiseBurst(t, 0.55, 300, 2600, 0.7, 0.22); },
    flip() {
      init(); const t = now();
      noiseBurst(t, 0.12, 1200, 4200, 1.6, 0.2);
      tone(880, t, 0.08, 'triangle', 0.14, sfxBus, 1400);
    },
    coin() {
      init(); const t = now();
      tone(1180, t, 0.09, 'square', 0.16); tone(1560, t + 0.07, 0.12, 'square', 0.14);
    },
    sparkle() {
      init(); const t = now();
      for (let i = 0; i < 6; i++) tone(1600 + Math.random() * 1800, t + i * 0.045, 0.16, 'sine', 0.09);
    },
    error() { init(); const t = now(); tone(300, t, 0.12, 'square', 0.16, sfxBus, 180); tone(200, t + 0.1, 0.16, 'square', 0.14, sfxBus, 120); },
    win() {
      init(); const t = now();
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.1, 0.3, 'triangle', 0.22));
      tone(1568, t + 0.42, 0.6, 'sine', 0.14);
    },
    lose() { init(); const t = now(); [440, 392, 330, 262].forEach((f, i) => tone(f, t + i * 0.12, 0.28, 'triangle', 0.18)); },
    fanfare(tier) {
      init(); const t = now() + 0.02;
      if (tier >= 5) {
        [523, 659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => {
          tone(f, t + i * 0.07, 0.42, 'triangle', 0.2);
          tone(f * 2, t + i * 0.07, 0.3, 'sine', 0.07);
        });
        noiseBurst(t, 0.9, 400, 5200, 1.0, 0.16);
        for (let i = 0; i < 10; i++) tone(2400 + Math.random() * 2200, t + 0.1 + i * 0.05, 0.2, 'sine', 0.05);
        tone(130, t, 0.9, 'sine', 0.12, sfxBus, 65);
      } else if (tier >= 4) {
        [523, 659, 880, 1046].forEach((f, i) => tone(f, t + i * 0.08, 0.36, 'triangle', 0.19));
        noiseBurst(t + 0.05, 0.5, 900, 3600, 1.1, 0.1);
      } else if (tier >= 2) {
        [784, 988, 1174].forEach((f, i) => tone(f, t + i * 0.09, 0.26, 'triangle', 0.16));
      } else {
        tone(660, t, 0.16, 'sine', 0.12);
        tone(880, t + 0.09, 0.2, 'sine', 0.1);
      }
    },
    typePop(ko) {
      init(); const t = now();
      const map = {
        '불꽃': () => { noiseBurst(t, 0.3, 900, 180, 0.8, 0.24); tone(220, t, 0.25, 'sawtooth', 0.1, sfxBus, 90); },
        '물': () => { tone(700, t, 0.28, 'sine', 0.18, sfxBus, 300); noiseBurst(t, 0.22, 1600, 500, 1.4, 0.1); },
        '번개': () => { for (let i = 0; i < 4; i++) tone(2200 - i * 300, t + i * 0.04, 0.07, 'square', 0.12); noiseBurst(t, 0.14, 3000, 1200, 1.8, 0.14); },
        '풀': () => { tone(500, t, 0.3, 'sine', 0.14, sfxBus, 760); tone(760, t + 0.06, 0.26, 'sine', 0.09); },
        '초': () => { tone(620, t, 0.5, 'sine', 0.12, sfxBus, 940); tone(930, t + 0.05, 0.5, 'sine', 0.08, sfxBus, 1240); },
        '격투': () => { tone(120, t, 0.26, 'square', 0.2, sfxBus, 70); noiseBurst(t, 0.18, 300, 120, 0.7, 0.16); },
        '악': () => { tone(180, t, 0.4, 'sawtooth', 0.14, sfxBus, 110); noiseBurst(t, 0.3, 500, 200, 0.6, 0.12); },
        '강철': () => { tone(1400, t, 0.3, 'square', 0.1); tone(2100, t + 0.03, 0.25, 'square', 0.07); },
        '드래곤': () => { tone(150, t, 0.55, 'sawtooth', 0.16, sfxBus, 60); tone(300, t + 0.06, 0.4, 'triangle', 0.1, sfxBus, 120); },
        '페어리': () => { [880, 1100, 1320, 1760].forEach((f, i) => tone(f, t + i * 0.05, 0.3, 'sine', 0.09)); },
        '무색': () => { tone(520, t, 0.18, 'triangle', 0.12); tone(700, t + 0.06, 0.2, 'triangle', 0.1); }
      };
      (map[ko] || map['무색'])();
    },
    levelUp() {
      init(); const t = now();
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.09, 0.5, 'triangle', 0.18));
      noiseBurst(t, 0.8, 600, 4000, 0.9, 0.1);
    }
  };

  /* ---------------- BGM ---------------- */
  const CHORDS = [
    [220.0, 261.63, 329.63],   // Am
    [174.61, 220.0, 261.63],   // F
    [196.0, 246.94, 293.66],   // G
    [130.81, 164.81, 196.0]    // C (low)
  ];
  const MELODY = [0, 3, 5, 7, 5, 3, 0, -2];

  function scheduleStep(t) {
    if (!ctx) return;
    const bar = Math.floor(step / 8) % 4;
    const idx = step % 8;
    const chord = CHORDS[bar];
    // pad
    if (idx === 0) {
      chord.forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f / 2;
        o.detune.value = (i - 1) * 7;
        const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 900; flt.Q.value = 0.6;
        const g = ctx.createGain();
        o.connect(flt); flt.connect(g); g.connect(bgmBus); g.connect(conv);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.5);
        g.gain.linearRampToValueAtTime(0.0001, t + 2.4);
        o.start(t); o.stop(t + 2.5);
      });
    }
    // arpeggio
    const scale = [0, 2, 4, 7, 9, 12, 9, 7];
    const base = chord[0] * 2;
    const semi = scale[idx] + (idx % 3 === 0 ? MELODY[bar] : 0);
    const f = base * Math.pow(2, semi / 12);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(); o.connect(g); g.connect(bgmBus); g.connect(conv);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.start(t); o.stop(t + 0.36);
    // soft kick
    if (idx % 4 === 0) {
      const k = ctx.createOscillator(); k.type = 'sine';
      k.frequency.setValueAtTime(120, t); k.frequency.exponentialRampToValueAtTime(50, t + 0.16);
      const kg = ctx.createGain();
      k.connect(kg); kg.connect(bgmBus);
      kg.gain.setValueAtTime(0.22, t); kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      k.start(t); k.stop(t + 0.22);
    }
    // hat
    if (idx % 2 === 0) {
      const s = noise(); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g2 = ctx.createGain();
      s.connect(hp); hp.connect(g2); g2.connect(bgmBus);
      g2.gain.setValueAtTime(0.05, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      s.start(t); s.stop(t + 0.08);
    }
    step++;
  }

  function startBgm() {
    init();
    if (!ctx || bgmTimer) return;
    step = 0; nextTime = ctx.currentTime + 0.15;
    bgmTimer = setInterval(() => {
      if (!ctx) return;
      if (ctx.state === 'suspended') return;
      const spb = 60 / 88 / 2; // 8th notes
      while (nextTime < ctx.currentTime + 0.6) {
        scheduleStep(nextTime);
        nextTime += spb;
      }
    }, 120);
    applySettings();
  }

  function toggleBgm(on) {
    init(); S().bgm = on; applySettings(); window.PKC.save();
    if (on) startBgm();
  }
  function toggleSfx(on) { init(); S().sfx = on; applySettings(); window.PKC.save(); }
  function setVolume(v) { init(); S().volume = v; applySettings(); window.PKC.save(); }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { if (ctx.state === 'running') ctx.suspend(); }
    else { ctx.resume(); }
  });

  window.PKCAudio = { init, unlock, sfx: SFX, toggleBgm, toggleSfx, setVolume, applySettings };
})();
