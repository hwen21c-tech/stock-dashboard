/* ============================================================
   포켓몬 배틀 월드 — 가족 전용 4자리 PIN 잠금
   4개 페이지(런처 · 산수 · 한글 · 영어) 공통. <head>에서 가장 먼저 실행.
   ─ 기본 PIN 0623 / sessionStorage['pkm.family.unlocked.v1']='1' 이면 통과
     (앱을 닫으면 지워져 다음에 열 때 다시 PIN을 묻는다)
   ─ 잠금 상태에서는 화면·키보드 입력을 모두 막고, 해제 후 완전히 제거한다.
   ============================================================ */
(function () {
  'use strict';
  if (window.PKMLock && window.PKMLock.version) return;
  var STORE = 'pkm.family.unlocked.v1';
  var PIN_KEY = 'pkm.family.pin.v1';
  var DEFAULT_PIN = '0623';
  var el = null;
  var buf = '';
  var fails = 0;
  var locked = false;

  function read(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* */ }
  }
  function ssRead(k, d) {
    try { var v = sessionStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }
  function ssWrite(k, v) {
    try { sessionStorage.setItem(k, v); } catch (e) { /* */ }
  }
  function pin() {
    var p = read(PIN_KEY, DEFAULT_PIN);
    return /^\d{4}$/.test(p) ? p : DEFAULT_PIN;
  }
  /* 이전 버전(localStorage)으로 한 번 열어 둔 기록은 지운다 — 새로 열면 PIN부터 */
  try { localStorage.removeItem(STORE); } catch (e) { /* */ }
  function isUnlocked() { return ssRead(STORE, '') === '1'; }

  var CSS = [
    '.pkm-lock{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
    'padding:18px;background:radial-gradient(120% 90% at 50% 0%,#bff0ff 0%,#8fe0c8 38%,#57bd2f 72%,#2f7a1f 100%);',
    'font-family:"Apple SD Gothic Neo","Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif;',
    'touch-action:none;-webkit-user-select:none;user-select:none;overflow:hidden}',
    '.pkm-lock::before{content:"";position:absolute;inset:0;pointer-events:none;',
    'background-image:radial-gradient(rgba(255,255,255,.55) 2px,transparent 2px);background-size:26px 26px;opacity:.35}',
    '.pkm-card{position:relative;width:min(360px,100%);background:linear-gradient(180deg,#fffdf3,#f2ffe0);',
    'border:3px solid #cfe6a6;border-radius:24px;padding:18px 16px 14px;text-align:center;',
    'box-shadow:0 16px 40px rgba(20,60,10,.35),inset 0 1px 0 #fff}',
    '.pkm-card.bad{animation:pkmShake .42s cubic-bezier(.36,.07,.19,.97) both}',
    '@keyframes pkmShake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-7px)}40%,60%{transform:translateX(7px)}}',
    '.pkm-ball{position:relative;display:inline-block;width:58px;height:58px;border-radius:50%;',
    'background:linear-gradient(180deg,#ff7a5f 0%,#ef4433 46%,#2a2a2a 46%,#1c1c1c 54%,#f7f7f2 54%,#fff 100%);',
    'border:4px solid #222;box-shadow:0 5px 0 rgba(20,60,10,.25);animation:pkmBob 2.6s ease-in-out infinite}',
    '.pkm-ball::after{content:"";position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;',
    'border-radius:50%;background:#fff;border:4px solid #222}',
    '@keyframes pkmBob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-6px) rotate(4deg)}}',
    '.pkm-card h2{margin:8px 0 2px;font-size:clamp(17px,5vw,21px);font-weight:900;color:#2f4a16;letter-spacing:-.03em}',
    '.pkm-sub{margin:0;font-size:clamp(10.5px,3vw,12px);font-weight:800;color:#7d8a63}',
    '.pkm-dots{display:flex;justify-content:center;gap:12px;margin:12px 0 6px}',
    '.pkm-dots i{width:14px;height:14px;border-radius:50%;background:#e6f2d2;border:2px solid #cfe6a6;transition:.15s}',
    '.pkm-dots i.on{background:linear-gradient(180deg,#8ef06a,#3fc22a);border-color:#2ea11c;transform:scale(1.12)}',
    '.pkm-msg{margin:0 0 10px;min-height:16px;font-size:clamp(10px,2.9vw,11.5px);font-weight:900;color:#6b8547}',
    '.pkm-msg.bad{color:#c0392b}',
    '.pkm-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}',
    '.pkm-pad button{height:clamp(48px,13vw,58px);border-radius:16px;font-weight:900;font-size:clamp(18px,5.4vw,22px);',
    'color:#2f4a16;background:linear-gradient(180deg,#fff,#eaf8d0);border:2.5px solid #cfe7a2;',
    'box-shadow:0 3px 0 rgba(70,120,30,.3);transition:transform .06s}',
    '.pkm-pad button:active{transform:translateY(3px);box-shadow:0 1px 0 rgba(70,120,30,.3)}',
    '.pkm-pad button.wide{grid-column:span 1;font-size:clamp(14px,4vw,17px);color:#5c7a34;background:linear-gradient(180deg,#fff,#f4f4e8);border-color:#dcdcd0}',
    '.pkm-pad button.blank{visibility:hidden}',
    '.pkm-foot{margin:10px 0 0;font-size:10px;font-weight:800;color:#93a87a}',
    '.pkm-lock.gone{opacity:0;transform:scale(1.02);transition:opacity .28s ease,transform .28s ease;pointer-events:none}',
  ].join('');

  function injectStyle() {
    if (document.getElementById('pkmLockStyle')) return;
    var st = document.createElement('style');
    st.id = 'pkmLockStyle';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function dots() {
    var n = buf.length;
    var out = '';
    for (var i = 0; i < 4; i += 1) out += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return out;
  }

  function paint() {
    if (!el) return;
    var d = el.querySelector('.pkm-dots');
    if (d) d.innerHTML = dots();
  }

  function msg(text, bad) {
    if (!el) return;
    var m = el.querySelector('.pkm-msg');
    if (!m) return;
    m.textContent = text;
    m.className = 'pkm-msg' + (bad ? ' bad' : '');
  }

  function press(d) {
    if (!locked) return;
    if (buf.length >= 4) return;
    buf += d;
    paint();
    try { beep(660 + buf.length * 60); } catch (e) { /* */ }
    if (buf.length === 4) setTimeout(check, 90);
  }
  function back() {
    if (!locked) return;
    buf = buf.slice(0, -1);
    paint();
  }

  function beep(f) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!beep.ctx) beep.ctx = new AC();
    var ctx = beep.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.14);
  }

  function check() {
    if (buf === pin()) {
      ssWrite(STORE, '1');
      locked = false;
      msg('반가워요! 들어가요 🎉', false);
      if (el) {
        el.classList.add('gone');
        var node = el;
        el = null;
        setTimeout(function () {
          if (node && node.parentNode) node.parentNode.removeChild(node);
          var st = document.getElementById('pkmLockStyle');
          if (st && st.parentNode) st.parentNode.removeChild(st);
        }, 320);
      }
      try { beep(1180); } catch (e) { /* */ }
      try { document.documentElement.style.overflow = ''; } catch (e) { /* */ }
      return;
    }
    fails += 1;
    buf = '';
    paint();
    if (el) {
      el.querySelector('.pkm-card').classList.remove('bad');
      void el.offsetWidth;
      el.querySelector('.pkm-card').classList.add('bad');
    }
    if (fails >= 5) {
      msg('PIN을 5번 틀렸어요. 잠시 뒤 다시 해 보세요.', true);
      if (el) el.querySelectorAll('.pkm-pad button').forEach(function (b) { b.disabled = true; });
      setTimeout(function () {
        fails = 0;
        if (!el) return;
        el.querySelectorAll('.pkm-pad button').forEach(function (b) { b.disabled = false; });
        msg('가족 PIN 4자리를 눌러 주세요', false);
        paint();
      }, 8000);
    } else {
      msg('PIN이 달라요. 다시 눌러 주세요 (' + fails + '/5)', true);
    }
    try { beep(220); } catch (e) { /* */ }
  }

  function mount() {
    if (el || !locked) return;
    injectStyle();
    var box = document.createElement('div');
    box.className = 'pkm-lock';
    box.id = 'pkmLock';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '가족 전용 PIN 잠금');
    var keys = '';
    [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (n) {
      keys += '<button type="button" data-d="' + n + '" aria-label="' + n + '">' + n + '</button>';
    });
    keys += '<button type="button" class="wide" data-act="back" aria-label="한 자리 지우기">⌫</button>'
      + '<button type="button" data-d="0" aria-label="0">0</button>'
      + '<button type="button" class="blank" tabindex="-1" aria-hidden="true"></button>';
    box.innerHTML = '<div class="pkm-card">'
      + '<span class="pkm-ball" aria-hidden="true"></span>'
      + '<h2>가족 전용 놀이터</h2>'
      + '<p class="pkm-sub">우리 가족만 들어올 수 있어요</p>'
      + '<div class="pkm-dots" aria-hidden="true">' + dots() + '</div>'
      + '<p class="pkm-msg">가족 PIN 4자리를 눌러 주세요</p>'
      + '<div class="pkm-pad">' + keys + '</div>'
      + '<p class="pkm-foot">🔒 가족 PIN은 앱을 만든 분이 정한 4자리예요</p>'
      + '</div>';
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      if (b.dataset.d !== undefined) press(b.dataset.d);
      else if (b.dataset.act === 'back') back();
    });
    var root = document.body || document.documentElement;
    root.appendChild(box);
    el = box;
    try { document.documentElement.style.overflow = 'hidden'; } catch (e) { /* */ }
  }

  function lock() {
    locked = true;
    buf = '';
    var body = document.body || document.documentElement;
    var old = document.getElementById('pkmLock');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    el = null;
    mount();
    paint();
    void body;
  }

  /* 잠금 상태에서는 게임 키보드 단축키(1~4)·클릭이 새어나가지 않게 막는다 */
  function guard(e) {
    if (!locked) return;
    var mine = el && e.target && el.contains(e.target);
    if (e.type === 'keydown') {
      if (mine) return;
      e.stopPropagation();
      e.preventDefault();
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      return;
    }
    if (mine) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }
  ['keydown', 'keypress', 'keyup', 'touchstart', 'pointerdown', 'click'].forEach(function (ev) {
    window.addEventListener(ev, guard, true);
  });

  var params = {};
  try {
    (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
  } catch (e) { /* */ }

  var needLock = params.lock === '1' || !isUnlocked();

  if (needLock) {
    locked = true;
    /* head에서 즉시 막아 본문이 잠깐이라도 보이지 않게 한다 */
    mount();
    document.addEventListener('DOMContentLoaded', function () {
      if (!locked) return;
      if (!el) mount();
      else if (document.body && el.parentNode !== document.body) document.body.appendChild(el);
    });
  }

  window.PKMLock = {
    version: '1.0',
    isLocked: function () { return locked; },
    isUnlocked: isUnlocked,
    lock: lock,
    unlock: function () { ssWrite(STORE, '1'); locked = false; },
    reset: function () {
      try { sessionStorage.removeItem(STORE); } catch (e) { /* */ }
      try { localStorage.removeItem(STORE); } catch (e) { /* */ }
    },
    setPin: function (p) {
      if (/^\d{4}$/.test(String(p || ''))) { write(PIN_KEY, String(p)); return true; }
      return false;
    },
    press: press,
    back: back,
    state: function () { return { locked: locked, buf: buf, fails: fails }; },
  };
})();
