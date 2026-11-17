/* ============================================================================
   TCG 사운드 엔진 — 순수 Web Audio API 합성 (외부 음원 0개)
   멀티레이어: 필터드 노이즈 + 하모닉 오실레이터 + 엔벨로프 + 리버브 IR + 컴프레서
   ========================================================================== */
(function () {
  class SoundEngine {
    constructor() {
      this.ctx = null; this.ready = false;
      this.sfxVol = 0.75; this.bgmVol = 0.30; this.muted = false; this.bgmOn = true;
      this._bgmTimer = null; this._step = 0; this._nextNote = 0;
      this._last = {};
    }
    // ---------------------------------------------------------------- init
    init() {
      if (this.ready) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = this.ctx = new AC();
      // master chain: sfx/bgm -> master -> compressor -> destination
      this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18; this.comp.knee.value = 22;
      this.comp.ratio.value = 3.5; this.comp.attack.value = 0.004; this.comp.release.value = 0.20;
      this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol;
      this.bgm = ctx.createGain(); this.bgm.gain.value = 0;
      this.sfx.connect(this.master); this.bgm.connect(this.master);
      this.master.connect(this.comp); this.comp.connect(ctx.destination);

      // reverb (synthesised hall impulse)
      this.verb = ctx.createConvolver();
      this.verb.buffer = this._makeIR(2.1, 2.6);
      this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.42;
      this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
      // sfx send
      this.sfxSend = ctx.createGain(); this.sfxSend.gain.value = 0.30;
      this.sfx.connect(this.sfxSend); this.sfxSend.connect(this.verb);

      // noise buffers
      this.white = this._noiseBuffer(2.4, 'white');
      this.pink = this._noiseBuffer(2.4, 'pink');
      this.brown = this._noiseBuffer(2.4, 'brown');
      this.ready = true;
      return ctx;
    }
    unlock() {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }
    get t() { return this.ctx ? this.ctx.currentTime : 0; }

    _noiseBuffer(sec, kind) {
      const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      if (kind === 'white') { for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
      else if (kind === 'pink') {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        }
      } else {
        let last = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      }
      return buf;
    }
    _makeIR(sec, decay) {
      const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2);
        }
      }
      return buf;
    }
    // ---------------------------------------------------------------- primitives
    _pan(node, p) {
      if (!this.ctx.createStereoPanner) return node;
      const s = this.ctx.createStereoPanner(); s.pan.value = Math.max(-1, Math.min(1, p));
      node.connect(s); return s;
    }
    tone(o) {
      if (!this.ready) return;
      const ctx = this.ctx, t0 = this.t + (o.delay || 0);
      const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f0, t0);
      if (o.f1 != null) {
        if (o.exp === false) osc.frequency.linearRampToValueAtTime(o.f1, t0 + o.dur);
        else osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
      }
      if (o.detune) osc.detune.value = o.detune;
      const g = ctx.createGain();
      const a = o.attack != null ? o.attack : 0.005, dur = o.dur || 0.2;
      const peak = (o.gain != null ? o.gain : 0.2);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
      if (o.hold) g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + a + o.hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let node = osc;
      if (o.filter) {
        const f = ctx.createBiquadFilter(); f.type = o.filter.type || 'lowpass';
        f.frequency.setValueAtTime(o.filter.f0, t0);
        if (o.filter.f1) f.frequency.exponentialRampToValueAtTime(o.filter.f1, t0 + dur);
        f.Q.value = o.filter.q != null ? o.filter.q : 1;
        node.connect(f); node = f;
      }
      if (o.shaper) {
        const ws = ctx.createWaveShaper(); const k = o.shaper;
        const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
        ws.curve = curve; node.connect(ws); node = ws;
      }
      node.connect(g);
      const out = this._pan(g, o.pan || 0);
      out.connect(this.sfx);
      if (o.verb) { const vg = ctx.createGain(); vg.gain.value = o.verb; out.connect(vg); vg.connect(this.verb); }
      osc.start(t0); osc.stop(t0 + dur + 0.05);
      return osc;
    }
    noise(o) {
      if (!this.ready) return;
      const ctx = this.ctx, t0 = this.t + (o.delay || 0);
      const src = ctx.createBufferSource();
      src.buffer = o.buf === 'pink' ? this.pink : o.buf === 'brown' ? this.brown : this.white;
      src.loop = true;
      src.playbackRate.value = o.rate || 1;
      const dur = o.dur || 0.2;
      const f = ctx.createBiquadFilter();
      f.type = o.type || 'bandpass';
      f.frequency.setValueAtTime(o.f0 || 2000, t0);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t0 + dur);
      f.Q.value = o.q != null ? o.q : 1;
      const g = ctx.createGain();
      const peak = o.gain != null ? o.gain : 0.2, a = o.attack != null ? o.attack : 0.004;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let node = src; node.connect(f); node = f;
      node.connect(g);
      const out = this._pan(g, o.pan || 0);
      out.connect(this.sfx);
      if (o.verb) { const vg = ctx.createGain(); vg.gain.value = o.verb; out.connect(vg); vg.connect(this.verb); }
      src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.03);
    }
    // ---------------------------------------------------------------- SFX
    click() { this.tone({ type: 'triangle', f0: 880, f1: 1250, dur: 0.06, gain: 0.12 }); this.noise({ f0: 4200, q: 1.6, dur: 0.04, gain: 0.05 }); }
    tap() { this.tone({ type: 'square', f0: 520, f1: 760, dur: 0.05, gain: 0.07, filter: { type: 'lowpass', f0: 2600 } }); }

    shuffle() {
      for (let i = 0; i < 14; i++) {
        const d = i * 0.045 + Math.random() * 0.012;
        this.noise({ delay: d, f0: 1500 + Math.random() * 2600, f1: 900 + Math.random() * 2600, q: 2.4, dur: 0.075, gain: 0.10 + Math.random() * 0.06, pan: (Math.random() - 0.5) * 0.5 });
      }
      this.noise({ f0: 700, f1: 2600, q: 0.8, dur: 0.55, gain: 0.05, type: 'bandpass', verb: 0.2 });
    }
    draw() {
      this.noise({ f0: 1200, f1: 5200, q: 1.1, dur: 0.16, gain: 0.16, pan: 0.12 });
      this.noise({ delay: 0.13, f0: 2600, f1: 1400, q: 2.2, dur: 0.08, gain: 0.10 });
      this.tone({ type: 'triangle', f0: 1500, f1: 2100, dur: 0.07, gain: 0.035, delay: 0.12 });
    }
    place() {
      this.tone({ type: 'sine', f0: 170, f1: 58, dur: 0.20, gain: 0.34, shaper: 1.5 });
      this.noise({ type: 'lowpass', f0: 900, f1: 180, q: 0.8, dur: 0.14, gain: 0.20 });
      this.noise({ delay: 0.02, f0: 3200, q: 3.5, dur: 0.05, gain: 0.05 });
    }
    flipCard() { this.noise({ f0: 900, f1: 4800, q: 1.3, dur: 0.12, gain: 0.13 }); this.tone({ type: 'triangle', f0: 640, f1: 420, dur: 0.09, gain: 0.06, delay: 0.08 }); }

    energy(type) {
      const scales = {
        Fire: [392, 523.25, 659.25], Water: [349.23, 440, 587.33], Lightning: [523.25, 659.25, 987.77],
        Psychic: [440, 554.37, 659.25], Fighting: [196, 261.63, 392], Colorless: [329.63, 440, 523.25],
        Grass: [392, 493.88, 587.33], Metal: [415.3, 523.25, 622.25], Darkness: [233.08, 293.66, 349.23]
      }[type] || [392, 523, 659];
      scales.forEach((f, i) => {
        this.tone({ type: 'triangle', f0: f, dur: 0.30, gain: 0.13, delay: i * 0.045, filter: { type: 'lowpass', f0: 3600 }, verb: 0.35 });
        this.tone({ type: 'sine', f0: f * 2, dur: 0.22, gain: 0.05, delay: i * 0.045 + 0.01 });
      });
      this.noise({ f0: 4000, f1: 9000, q: 2.0, dur: 0.28, gain: 0.06, type: 'highpass' });
      if (type === 'Fire') this.noise({ f0: 420, f1: 1200, q: 0.9, dur: 0.20, gain: 0.06, buf: 'pink' });
    }
    ability() {
      [880, 1174.66, 1567.98, 2093].forEach((f, i) => {
        this.tone({ type: 'sine', f0: f, dur: 0.75 - i * 0.08, gain: 0.10 - i * 0.012, delay: i * 0.055, verb: 0.7, attack: 0.01 });
      });
      this.noise({ f0: 5200, f1: 9000, q: 1.4, dur: 0.6, gain: 0.035, type: 'highpass', verb: 0.5 });
      this.tone({ type: 'triangle', f0: 220, f1: 330, dur: 0.5, gain: 0.06, verb: 0.4 });
    }
    heal() {
      this.tone({ type: 'sine', f0: 1046.5, dur: 0.5, gain: 0.10, verb: 0.6 });
      this.tone({ type: 'sine', f0: 1568, dur: 0.6, gain: 0.07, delay: 0.09, verb: 0.6 });
      this.noise({ f0: 6000, f1: 10000, q: 1.2, dur: 0.4, gain: 0.03, type: 'highpass' });
    }
    evolve() {
      for (let i = 0; i < 7; i++) {
        this.tone({ type: 'triangle', f0: 300 * Math.pow(1.22, i), dur: 0.16, gain: 0.07, delay: i * 0.05, verb: 0.5 });
      }
      this.noise({ f0: 1200, f1: 9000, q: 1.0, dur: 0.55, gain: 0.09, type: 'bandpass' });
      this.tone({ type: 'sine', f0: 60, f1: 120, dur: 0.4, gain: 0.16 });
    }
    status(kind) {
      if (kind === 'burn') { this.noise({ f0: 1800, f1: 600, q: 0.7, dur: 0.45, gain: 0.11, buf: 'pink' }); this.tone({ type: 'sawtooth', f0: 140, f1: 90, dur: 0.3, gain: 0.05 }); }
      else if (kind === 'poison') { for (let i = 0; i < 4; i++) this.tone({ type: 'sine', f0: 220 + i * 60, f1: 480 + i * 60, dur: 0.12, gain: 0.08, delay: i * 0.09 }); }
      else if (kind === 'paralyze') { for (let i = 0; i < 5; i++) this.noise({ delay: i * 0.05, f0: 5000 + Math.random() * 4000, q: 4, dur: 0.05, gain: 0.09, type: 'bandpass' }); }
      else if (kind === 'sleep') { this.tone({ type: 'sine', f0: 520, f1: 300, dur: 0.6, gain: 0.07, verb: 0.5 }); this.tone({ type: 'sine', f0: 390, f1: 240, dur: 0.7, gain: 0.05, delay: 0.15, verb: 0.5 }); }
      else if (kind === 'confuse') { [523, 622, 466, 700].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.18, gain: 0.07, delay: i * 0.08 })); }
    }
    // type-specific attack impact
    attack(type, power) {
      const p = Math.min(1.4, 0.55 + (power || 60) / 260);
      if (type === 'Fire') {
        this.noise({ type: 'lowpass', f0: 2600, f1: 320, q: 1.2, dur: 0.55, gain: 0.22 * p, buf: 'pink' });
        this.noise({ f0: 900, f1: 3400, q: 0.7, dur: 0.35, gain: 0.14 * p, buf: 'white' });
        this.tone({ type: 'sawtooth', f0: 120, f1: 45, dur: 0.45, gain: 0.16 * p, filter: { type: 'lowpass', f0: 900 } });
        for (let i = 0; i < 6; i++) this.noise({ delay: 0.05 + i * 0.06, f0: 2000 + Math.random() * 3000, q: 3, dur: 0.05, gain: 0.05, type: 'bandpass' });
      } else if (type === 'Water') {
        this.noise({ type: 'bandpass', f0: 3200, f1: 500, q: 0.9, dur: 0.5, gain: 0.22 * p });
        this.tone({ type: 'sine', f0: 320, f1: 90, dur: 0.35, gain: 0.14 * p });
        for (let i = 0; i < 7; i++) this.tone({ type: 'sine', f0: 500 + Math.random() * 900, f1: 1600 + Math.random() * 1400, dur: 0.09, gain: 0.05, delay: 0.05 + Math.random() * 0.35 });
        this.noise({ f0: 600, f1: 200, q: 0.8, dur: 0.4, gain: 0.12 * p, buf: 'brown' });
      } else if (type === 'Lightning') {
        this.noise({ f0: 6000, f1: 1200, q: 2.5, dur: 0.16, gain: 0.22 * p, type: 'highpass' });
        this.tone({ type: 'square', f0: 1800, f1: 90, dur: 0.18, gain: 0.12 * p, filter: { type: 'lowpass', f0: 6000 }, shaper: 4 });
        this.noise({ delay: 0.03, f0: 300, f1: 90, q: 0.6, dur: 0.4, gain: 0.20 * p, buf: 'brown' });
        for (let i = 0; i < 5; i++) this.tone({ type: 'square', f0: 2200 + Math.random() * 2600, dur: 0.03, gain: 0.05, delay: 0.05 + i * 0.05 });
      } else if (type === 'Psychic') {
        this.tone({ type: 'sine', f0: 160, f1: 900, dur: 0.5, gain: 0.14 * p, verb: 0.6 });
        this.tone({ type: 'triangle', f0: 660, f1: 220, dur: 0.55, gain: 0.10 * p, verb: 0.5 });
        this.noise({ f0: 4000, f1: 800, q: 1.6, dur: 0.45, gain: 0.10 * p, verb: 0.4 });
        this.tone({ type: 'sine', f0: 60, dur: 0.4, gain: 0.14 * p });
      } else if (type === 'Fighting') {
        this.tone({ type: 'sine', f0: 140, f1: 48, dur: 0.30, gain: 0.28 * p, shaper: 2.2 });
        this.noise({ type: 'lowpass', f0: 1400, f1: 160, q: 0.8, dur: 0.26, gain: 0.22 * p });
        this.noise({ delay: 0.04, f0: 260, f1: 80, q: 0.6, dur: 0.4, gain: 0.14 * p, buf: 'brown' });
      } else {
        this.tone({ type: 'sine', f0: 220, f1: 70, dur: 0.24, gain: 0.20 * p });
        this.noise({ f0: 1800, f1: 400, q: 1.1, dur: 0.22, gain: 0.14 * p });
      }
    }
    crit() {
      this.tone({ type: 'sine', f0: 110, f1: 38, dur: 0.55, gain: 0.36, shaper: 3 });
      this.noise({ type: 'lowpass', f0: 900, f1: 120, q: 0.9, dur: 0.45, gain: 0.22, buf: 'brown' });
      this.noise({ f0: 5000, f1: 1200, q: 1.5, dur: 0.2, gain: 0.10, type: 'highpass' });
      this.tone({ type: 'square', f0: 880, f1: 220, dur: 0.12, gain: 0.06, shaper: 2 });
    }
    coinFlip() {
      this.noise({ f0: 1200, f1: 5200, q: 1.2, dur: 0.30, gain: 0.10, type: 'bandpass' });
      this.tone({ type: 'sine', f0: 2400, dur: 0.05, gain: 0.05, delay: 0.01 });
      this.tone({ type: 'sine', f0: 3000, dur: 0.05, gain: 0.04, delay: 0.09 });
      this.tone({ type: 'sine', f0: 2600, dur: 0.05, gain: 0.035, delay: 0.17 });
    }
    coinLand(heads) {
      const f = heads ? 1760 : 1320;
      this.tone({ type: 'sine', f0: f, dur: 0.55, gain: 0.13, verb: 0.5 });
      this.tone({ type: 'sine', f0: f * 2.02, dur: 0.35, gain: 0.06, delay: 0.01 });
      this.tone({ type: 'triangle', f0: f / 2, dur: 0.3, gain: 0.05 });
      this.noise({ f0: 4200, q: 4, dur: 0.06, gain: 0.07 });
      if (heads) this.tone({ type: 'triangle', f0: 1174, dur: 0.3, gain: 0.05, delay: 0.12 });
    }
    packRip() {
      for (let i = 0; i < 9; i++) {
        this.noise({ delay: i * 0.035, f0: 2200 + i * 320, f1: 1400 + i * 420, q: 3.2, dur: 0.05, gain: 0.09 + Math.random() * 0.05, type: 'bandpass' });
      }
      this.noise({ f0: 500, f1: 3000, q: 0.7, dur: 0.4, gain: 0.07, buf: 'pink' });
    }
    fanfare() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
      notes.forEach((f, i) => {
        this.tone({ type: 'sawtooth', f0: f, dur: 0.42, gain: 0.075, delay: i * 0.075, filter: { type: 'lowpass', f0: 5200 }, verb: 0.5 });
        this.tone({ type: 'sine', f0: f * 2, dur: 0.3, gain: 0.04, delay: i * 0.075 });
      });
      this.noise({ f0: 6000, f1: 11000, q: 1.2, dur: 0.7, gain: 0.05, type: 'highpass', delay: 0.2, verb: 0.6 });
      this.tone({ type: 'triangle', f0: 261.63, dur: 1.0, gain: 0.08, delay: 0.35, verb: 0.6 });
    }
    ko() {
      this.tone({ type: 'sawtooth', f0: 700, f1: 60, dur: 0.7, gain: 0.16, filter: { type: 'lowpass', f0: 2200 } });
      this.noise({ f0: 3000, f1: 200, q: 0.8, dur: 0.7, gain: 0.18 });
      this.tone({ type: 'sine', f0: 50, dur: 0.8, gain: 0.22, shaper: 2 });
    }
    win() {
      [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.52], [1046.5, 0.64]].forEach(([f, d]) =>
        this.tone({ type: 'triangle', f0: f, dur: 0.45, gain: 0.11, delay: d, verb: 0.5 }));
    }
    lose() {
      [[440, 0], [392, 0.16], [349.23, 0.32], [293.66, 0.5]].forEach(([f, d]) =>
        this.tone({ type: 'sine', f0: f, dur: 0.5, gain: 0.11, delay: d, verb: 0.45 }));
    }
    // ---------------------------------------------------------------- BGM
    startBGM() {
      this.init();
      if (!this.ready || !this.bgmOn) return;
      if (this._bgmTimer) return;
      this.bgm.gain.cancelScheduledValues(this.t);
      this.bgm.gain.setValueAtTime(this.bgm.gain.value, this.t);
      this.bgm.gain.linearRampToValueAtTime(this.muted ? 0 : this.bgmVol, this.t + 1.2);
      this._step = 0; this._nextNote = this.t + 0.1;
      this._bgmTimer = setInterval(() => this._scheduleBGM(), 90);
    }
    stopBGM() {
      if (!this._bgmTimer) return;
      this.bgm.gain.cancelScheduledValues(this.t);
      this.bgm.gain.linearRampToValueAtTime(0, this.t + 0.5);
      clearInterval(this._bgmTimer); this._bgmTimer = null;
    }
    _scheduleBGM() {
      if (!this.ready) return;
      const ctx = this.ctx, spb = 60 / 108 / 2; // 8th notes @108bpm
      while (this._nextNote < ctx.currentTime + 0.35) {
        const s = this._step % 32, t = this._nextNote;
        const bass = [110, 110, 146.83, 110, 98, 98, 130.81, 98];
        const scale = [0, 3, 5, 7, 10, 12, 15, 12]; // minor pentatonic-ish
        const root = s < 16 ? 220 : 196;
        // bass on beats
        if (s % 4 === 0) this._bgmNote('triangle', bass[(s / 4) % 8], t, spb * 1.6, 0.16, 260);
        // arpeggio
        const n = scale[(s * 3) % 8];
        this._bgmNote('sawtooth', root * Math.pow(2, n / 12), t, spb * 0.85, 0.045, 1800);
        if (s % 8 === 4) this._bgmNote('sine', root * Math.pow(2, (n + 12) / 12), t, spb * 1.2, 0.035, 3000);
        // hat
        if (s % 2 === 1) {
          const src = ctx.createBufferSource(); src.buffer = this.white; src.loop = true;
          const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.05, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
          src.connect(f); f.connect(g); g.connect(this.bgm);
          src.start(t, Math.random()); src.stop(t + 0.06);
        }
        // kick
        if (s % 8 === 0) {
          const o = ctx.createOscillator(); o.type = 'sine';
          o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.22, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
          o.connect(g); g.connect(this.bgm); o.start(t); o.stop(t + 0.2);
        }
        this._step++; this._nextNote += spb;
      }
    }
    _bgmNote(type, f, t, dur, gain, cutoff) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(cutoff, t); fl.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(fl); fl.connect(g); g.connect(this.bgm);
      o.start(t); o.stop(t + dur + 0.02);
    }
    // ---------------------------------------------------------------- controls
    setSfx(v) { this.sfxVol = v; if (this.ready) this.sfx.gain.value = this.muted ? 0 : v; }
    setBgm(v) { this.bgmVol = v; if (this.ready && this._bgmTimer) this.bgm.gain.value = this.muted ? 0 : v; }
    setMuted(m) {
      this.muted = m;
      if (!this.ready) return;
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.t, 0.05);
    }
  }
  window.SFX = new SoundEngine();
})();
