/* ============================================================================
   TCG VFX 레이어 — Canvas 2D 파티클 + DOM 데미지 팝업 (pointer-events:none)
   ========================================================================== */
(function () {
  const T = {
    fire: { colors: ['#ffd24a', '#ff8a2b', '#ff4d2e', '#ffe9a8'], size: [3, 9], life: [0.45, 0.95], grav: -0.045, shape: 'circle', glow: 1 },
    water: { colors: ['#8fd6ff', '#3da5ff', '#1c6fd0', '#d9f2ff'], size: [3, 8], life: [0.4, 0.85], grav: 0.16, shape: 'drop', glow: 1 },
    lightning: { colors: ['#fff9b0', '#ffd23d', '#8fe7ff', '#ffffff'], size: [2, 5], life: [0.2, 0.5], grav: 0, shape: 'spark', glow: 1.4 },
    psychic: { colors: ['#e0a6ff', '#b46bff', '#7a3cff', '#ffe6ff'], size: [2, 7], life: [0.5, 1.1], grav: -0.01, shape: 'star', glow: 1.2 },
    fighting: { colors: ['#ffd9a8', '#e08b3a', '#8a4a1e', '#fff2e0'], size: [4, 11], life: [0.35, 0.8], grav: 0.10, shape: 'shard', glow: 0.8 },
    colorless: { colors: ['#ffffff', '#d8e0ea', '#a8b6c8'], size: [3, 8], life: [0.35, 0.7], grav: 0.08, shape: 'circle', glow: 0.7 },
    spark: { colors: ['#fff3a8', '#ffd23d', '#ffffff'], size: [2, 6], life: [0.3, 0.8], grav: 0.02, shape: 'spark', glow: 1.2 },
    heal: { colors: ['#b9ffd2', '#63e6a0', '#eafff2'], size: [3, 7], life: [0.6, 1.1], grav: -0.06, shape: 'circle', glow: 1.1 }
  };

  class VFX {
    constructor() {
      this.canvas = null; this.ctx = null; this.ps = []; this.rays = []; this.raf = null;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
    }
    mount() {
      if (this.canvas) return;
      const c = document.createElement('canvas');
      c.id = 'vfxLayer'; c.setAttribute('aria-hidden', 'true');
      document.body.appendChild(c);
      this.canvas = c; this.ctx = c.getContext('2d');
      this.resize();
      window.addEventListener('resize', () => this.resize());
      const pop = document.createElement('div'); pop.id = 'fxPopups';
      document.body.appendChild(pop);
    }
    resize() {
      if (!this.canvas) return;
      const w = window.innerWidth, h = window.innerHeight;
      this.canvas.width = Math.floor(w * this.dpr);
      this.canvas.height = Math.floor(h * this.dpr);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.w = w; this.h = h;
    }
    _loop() {
      if (this.raf) return;
      const step = () => {
        this.raf = requestAnimationFrame(step);
        this._draw();
        if (!this.ps.length && !this.rays.length) { cancelAnimationFrame(this.raf); this.raf = null; }
      };
      this.raf = requestAnimationFrame(step);
    }
    _spawn(x, y, t, n, spread, speed) {
      const cfg = T[t] || T.colorless;
      for (let i = 0; i < n && this.ps.length < 420; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = (speed || 3) * (0.35 + Math.random() * 0.9);
        this.ps.push({
          x, y, vx: Math.cos(ang) * sp * (spread || 1), vy: Math.sin(ang) * sp * (spread || 1) - (cfg.grav < 0 ? 0.6 : 0),
          life: 0, max: cfg.life[0] + Math.random() * (cfg.life[1] - cfg.life[0]),
          size: cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0]),
          col: cfg.colors[(Math.random() * cfg.colors.length) | 0], shape: cfg.shape, grav: cfg.grav, glow: cfg.glow,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.25
        });
      }
    }
    burst(type, x, y, opts) {
      opts = opts || {};
      this.mount();
      this._spawn(x, y, type, opts.count || 42, opts.spread || 1, opts.speed || 4.2);
      if (opts.ring) this.rays.push({ x, y, r: 4, max: opts.ring, life: 0, dur: 0.45, col: (T[type] || T.colorless).colors[1], w: 3 });
      if (opts.flash) this.flash(opts.flash);
      this._loop();
    }
    ring(x, y, max, col, dur) {
      this.mount();
      this.rays.push({ x, y, r: 4, max: max || 90, life: 0, dur: dur || 0.45, col: col || '#b46bff', w: 3 });
      this._loop();
    }
    flash(intensity) {
      this.mount();
      let f = document.getElementById('fxFlash');
      if (!f) { f = document.createElement('div'); f.id = 'fxFlash'; document.body.appendChild(f); }
      f.style.opacity = '0';
      f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      clearTimeout(this._flashT);
      this._flashT = setTimeout(() => { f.classList.remove('go'); f.style.opacity = '0'; }, 520);
    }
    shake(power) {
      const el = document.getElementById('app') || document.body;
      el.classList.remove('shake-sm', 'shake-md', 'shake-lg');
      void el.offsetWidth;
      el.classList.add(power >= 3 ? 'shake-lg' : power >= 2 ? 'shake-md' : 'shake-sm');
      setTimeout(() => el.classList.remove('shake-sm', 'shake-md', 'shake-lg'), 620);
    }
    popup(x, y, text, cls) {
      this.mount();
      const host = document.getElementById('fxPopups');
      const d = document.createElement('div');
      d.className = 'dmg-pop ' + (cls || '');
      d.textContent = text;
      d.style.left = x + 'px'; d.style.top = y + 'px';
      host.appendChild(d);
      setTimeout(() => d.remove(), 1250);
    }
    cardFlash(el) {
      if (!el) return;
      el.classList.remove('hitflash'); void el.offsetWidth; el.classList.add('hitflash');
    }
    ko(el, type) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      el.classList.add('ko-out');
      this.burst(type || 'colorless', cx, cy, { count: 60, speed: 7, ring: 150, flash: 0.4 });
      // shards of the card
      for (let i = 0; i < 26 && this.ps.length < 460; i++) {
        this.ps.push({
          x: cx + (Math.random() - 0.5) * r.width, y: cy + (Math.random() - 0.5) * r.height,
          vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 7 - 1,
          life: 0, max: 0.7 + Math.random() * 0.7, size: 4 + Math.random() * 9,
          col: ['#e8e8f0', '#b9c0cc', '#8f96a3', '#ffffff'][(Math.random() * 4) | 0],
          shape: 'shard', grav: 0.28, glow: 0.5, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.5
        });
      }
      this._loop();
    }
    packBurst(el) {
      const r = el ? el.getBoundingClientRect() : { left: this.w / 2, top: this.h / 2, width: 0, height: 0 };
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      this.mount();
      for (let i = 0; i < 18; i++) {
        this.rays.push({ x: cx, y: cy, r: 10, max: 160 + Math.random() * 200, life: -i * 0.02, dur: 0.7, col: ['#ffe9a8', '#fff6c9', '#ffd23d'][i % 3], w: 5, ang: (i / 18) * 6.28 });
      }
      this.burst('spark', cx, cy, { count: 80, speed: 8, ring: 220, flash: 0.6 });
    }
    _draw() {
      const ctx = this.ctx; if (!ctx) return;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      // rays
      for (let i = this.rays.length - 1; i >= 0; i--) {
        const r = this.rays[i];
        r.life += 0.016;
        if (r.life < 0) continue;
        const p = r.life / r.dur;
        if (p >= 1) { this.rays.splice(i, 1); continue; }
        const rad = 4 + (r.max - 4) * (1 - Math.pow(1 - p, 2));
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.strokeStyle = r.col; ctx.lineWidth = r.w * (1 - p) + 0.5;
        ctx.shadowColor = r.col; ctx.shadowBlur = 14;
        if (r.ang != null) {
          ctx.beginPath();
          ctx.moveTo(r.x + Math.cos(r.ang) * rad * 0.35, r.y + Math.sin(r.ang) * rad * 0.35);
          ctx.lineTo(r.x + Math.cos(r.ang) * rad, r.y + Math.sin(r.ang) * rad);
          ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, 6.2832); ctx.stroke();
        }
        ctx.restore();
      }
      // particles
      for (let i = this.ps.length - 1; i >= 0; i--) {
        const p = this.ps[i];
        p.life += 0.016;
        if (p.life >= p.max) { this.ps.splice(i, 1); continue; }
        p.vy += p.grav; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        const k = 1 - p.life / p.max;
        ctx.save();
        ctx.globalAlpha = Math.max(0, k);
        ctx.fillStyle = p.col; ctx.strokeStyle = p.col;
        if (p.glow) { ctx.shadowColor = p.col; ctx.shadowBlur = 10 * p.glow * k; }
        const s = p.size * (0.5 + k * 0.7);
        switch (p.shape) {
          case 'spark':
            ctx.lineWidth = Math.max(1, s * 0.5);
            ctx.beginPath(); ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2); ctx.stroke();
            break;
          case 'drop':
            ctx.beginPath(); ctx.ellipse(p.x, p.y, s * 0.55, s * 1.25, Math.atan2(p.vy, p.vx), 0, 6.2832); ctx.fill();
            break;
          case 'star':
            ctx.beginPath();
            for (let k2 = 0; k2 < 8; k2++) {
              const a = p.rot + k2 * Math.PI / 4, rr = k2 % 2 ? s * 0.36 : s;
              ctx[k2 ? 'lineTo' : 'moveTo'](p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
            }
            ctx.closePath(); ctx.fill();
            break;
          case 'shard':
            ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.beginPath(); ctx.moveTo(-s, -s * 0.5); ctx.lineTo(s, -s * 0.2); ctx.lineTo(s * 0.4, s);
            ctx.closePath(); ctx.fill();
            break;
          default:
            ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, 6.2832); ctx.fill();
        }
        ctx.restore();
      }
    }
  }
  window.VFX = new VFX();
})();
