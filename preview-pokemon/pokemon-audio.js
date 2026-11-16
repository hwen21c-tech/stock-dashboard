/* ============================================================
   포켓몬 배틀 월드 — 🔊 소리 조절 (배경음 · 단어 발음/효과음 분리)
   ─ 기존 전체 음소거 버튼(🔊/🔇)은 그대로 두고, 그 위에 두 갈래 볼륨을 따로 둔다.
       ① 배경음(bgm)   = 배틀 BGM + 속성 환경음 / 마을 음악
       ② 발음·효과음(voice) = 단어 읽어주기(TTS) · 정답/오답 소리 · 울음소리 · 응원 목소리
   ─ 기기별 localStorage['pkm.audio.v1'] = {"v":1,"bgm":0~1,"voice":0~1}
     (아이 폰마다 취향이 다르므로 클라우드로 올리지 않는다 — pokemon-sync 의 NEVER 목록)
   ─ 기본값은 1(지금까지의 크기 그대로) — 이 파일이 없어도 게임은 예전과 똑같이 동작한다.
   ─ 화면 붙이는 곳
       · ⚙️ 설정 모달 안  : PKMAudio.renderInto(host)
       · 상단 사운드 팝업  : PKMAudio.openPanel()  (🔊 버튼을 길게 눌러도 열린다)
   ============================================================ */
(function () {
  'use strict';
  if (window.PKMAudio && window.PKMAudio.version) return;

  var VERSION = '1.0';
  var KEY = 'pkm.audio.v1';
  var DEF = { bgm: 1, voice: 1 };
  var STEPS = [
    { v: 0, label: '끄기' },
    { v: 0.4, label: '작게' },
    { v: 0.7, label: '보통' },
    { v: 1, label: '크게' }
  ];
  var ROWS = [
    { part: 'bgm', ic: '🎵', name: '배경음', sub: '음악·환경음' },
    { part: 'voice', ic: '🗣️', name: '단어 발음·효과음', sub: '읽어주기·정답 소리·울음소리' }
  ];

  var cfg = { bgm: DEF.bgm, voice: DEF.voice };
  var base = { bgmVol: null };            /* 배틀 페이지 BGM 의 원래 VOL(0.34)을 기억해 둔다 */
  var probe = { toneOrig: 0, toneScaled: 0 };
  var panel = null;
  var longPress = { t: 0, fired: false };
  var bound = { btn: null };

  function clamp(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    if (!isFinite(n)) return null;
    if (n <= 0) return 0;
    if (n >= 1) return 1;
    return n;
  }
  function load() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { o = null; }
    var b = clamp(o && o.bgm);
    var v = clamp(o && o.voice);
    cfg.bgm = b == null ? DEF.bgm : b;
    cfg.voice = v == null ? DEF.voice : v;
    return cfg;
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, bgm: cfg.bgm, voice: cfg.voice, at: new Date().toISOString() }));
    } catch (e) { /* */ }
  }

  /* ---------- 실제 소리에 반영 ---------- */
  function applyBgm() {
    var lvl = cfg.bgm;
    /* 마을 — 다리(window.PKMVillageAudio)를 통해 master gain 을 조절한다 */
    try {
      if (window.PKMVillageAudio && typeof window.PKMVillageAudio.bgmLevel === 'function') {
        window.PKMVillageAudio.bgmLevel(lvl);
        return;
      }
    } catch (e) { /* */ }
    /* 배틀(산수·한글·영어) — BGM.VOL 이 master 를 통과하는 값이라 여기에 곱한다 */
    try {
      if (typeof BGM !== 'undefined' && BGM && typeof BGM.VOL === 'number') {
        if (base.bgmVol == null) base.bgmVol = BGM.VOL;
        BGM.VOL = base.bgmVol * lvl;
        if (typeof BGM.applyGain === 'function') BGM.applyGain();
      }
    } catch (e) { /* */ }
  }
  function applyAll() { applyBgm(); }

  /* 효과음(비프) — 호출될 때마다 그 자리에서 voice 배율을 곱한다 */
  function hookTone(obj, name, defGain) {
    if (!obj || typeof obj[name] !== 'function' || obj[name].__pkma) return;
    var orig = obj[name];
    var wrapped = function (f, d, type, gain) {
      var g = (gain == null ? defGain : Number(gain));
      var scaled = g * cfg.voice;
      probe.toneOrig = g;
      probe.toneScaled = scaled;
      /* exponentialRamp 는 0 을 받지 못한다 — 0(끄기)은 사실상 무음인 하한으로 보낸다 */
      return orig.call(this, f, d, type, Math.max(0.0001, scaled), arguments[4], arguments[5]);
    };
    wrapped.__pkma = true;
    obj[name] = wrapped;
  }
  /* 단어 읽어주기 — <audio> 로 재생되는 TTS 음량 */
  function hookTts(obj) {
    if (!obj || typeof obj.say !== 'function' || obj.say.__pkma) return;
    var orig = obj.say;
    var wrapped = function () {
      var out = orig.apply(this, arguments);
      try { if (obj.audio) obj.audio.volume = cfg.voice; } catch (e) { /* */ }
      return out;
    };
    wrapped.__pkma = true;
    obj.say = wrapped;
    /* 기기 음성(speechSynthesis) 폴백도 같은 크기로 */
    try {
      var ss = window.speechSynthesis;
      if (ss && typeof ss.speak === 'function' && !ss.__pkma) {
        var speak = ss.speak.bind(ss);
        ss.speak = function (utt) {
          try { utt.volume = cfg.voice; } catch (e) { /* */ }
          return speak(utt);
        };
        ss.__pkma = true;
      }
    } catch (e) { /* */ }
  }

  function hookAll() {
    try { if (typeof Sound !== 'undefined' && Sound) hookTone(Sound, 'tone', 0.07); } catch (e) { /* */ }
    try { if (typeof TTS !== 'undefined' && TTS) hookTts(TTS); } catch (e) { /* */ }
  }

  /* ---------- 화면 ---------- */
  var CSS = [
    '.pkma-rows{display:flex;flex-direction:column;gap:9px}',
    '.pkma-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.pkma-lb{flex:1 1 118px;min-width:0;display:flex;flex-direction:column;line-height:1.25}',
    '.pkma-lb b{font-size:clamp(11.5px,3vw,13px);font-weight:900;color:#2f4a16;letter-spacing:-.02em}',
    '.pkma-lb small{font-size:clamp(9px,2.4vw,10.5px);font-weight:800;color:#7d8a63}',
    '.pkma-opts{flex:0 0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:4px}',
    '.pkma-opts button{min-width:42px;padding:6px 5px;border-radius:10px;font-weight:900;font-size:clamp(9.5px,2.5vw,11px);',
    'color:#5c7a34;background:linear-gradient(180deg,#fff,#eef7dc);border:1.5px solid #d6e7b6;box-shadow:0 2px 0 rgba(70,120,30,.16)}',
    '.pkma-opts button.on{color:#fff;background:linear-gradient(180deg,#7ecb3f,#4ea322);border-color:#3f8a1b;',
    'text-shadow:0 1px 1px rgba(0,0,0,.22)}',
    '.pkma-opts button:active{transform:translateY(1px)}',
    '.pkma-note{margin:9px 0 0;font-size:clamp(9px,2.4vw,10.5px);font-weight:800;color:#8a9a6a;line-height:1.5}',
    '.pkma-panel{position:fixed;z-index:2147482000;width:min(310px,calc(100vw - 16px));box-sizing:border-box;',
    'background:#fffdf3;border:2.5px solid #cbe79f;border-radius:16px;padding:11px 12px 12px;',
    'box-shadow:0 12px 30px rgba(20,60,10,.32);font-family:"Apple SD Gothic Neo","Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.pkma-panel[hidden]{display:none}',
    '.pkma-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}',
    '.pkma-head b{font-size:clamp(12px,3.2vw,13.5px);font-weight:900;color:#2f4a16;letter-spacing:-.02em}',
    '.pkma-x{width:26px;height:26px;border-radius:50%;background:#f1f9e2;border:1.5px solid #d6e7b6;',
    'font-weight:900;color:#5c7a34;font-size:12px;line-height:1}'
  ].join('');

  function style() {
    if (document.getElementById('pkmaStyle')) return;
    var st = document.createElement('style');
    st.id = 'pkmaStyle';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function stepsHtml(part) {
    return STEPS.map(function (s) {
      var on = Math.abs(cfg[part] - s.v) < 0.001;
      return '<button type="button" data-pkma="' + part + '" data-v="' + s.v + '" class="' + (on ? 'on' : '') + '"'
        + ' aria-pressed="' + (on ? 'true' : 'false') + '">' + s.label + '</button>';
    }).join('');
  }
  function rowsHtml() {
    return ROWS.map(function (r) {
      return '<div class="pkma-row" data-row="' + r.part + '">'
        + '<span class="pkma-lb"><b>' + r.ic + ' ' + r.name + '</b><small>' + r.sub + '</small></span>'
        + '<span class="pkma-opts" role="group" aria-label="' + r.name + ' 크기">' + stepsHtml(r.part) + '</span>'
        + '</div>';
    }).join('');
  }
  function paint(host) {
    if (!host) return;
    var opts = host.querySelectorAll('[data-pkma]');
    Array.prototype.forEach.call(opts, function (b) {
      var part = b.getAttribute('data-pkma');
      var on = Math.abs(cfg[part] - Number(b.getAttribute('data-v'))) < 0.001;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function paintAll() {
    paint(document);
  }

  function onPick(part, v, quiet) {
    var n = clamp(v);
    if (n == null || (part !== 'bgm' && part !== 'voice')) return;
    cfg[part] = n;
    save();
    applyAll();
    paintAll();
    if (quiet) return;
    /* 방금 고른 크기를 바로 들려준다 — 발음·효과음 쪽은 비프, 배경음은 흐르는 음악에 바로 반영 */
    try {
      if (part === 'voice' && typeof Sound !== 'undefined' && Sound && typeof Sound.click === 'function') {
        if (!Sound.muted) { Sound.ensure(); Sound.click(); }
      }
    } catch (e) { /* */ }
  }

  function bindHost(host) {
    if (!host || host.__pkmaBound) return;
    host.__pkmaBound = true;
    host.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-pkma]') : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      onPick(b.getAttribute('data-pkma'), b.getAttribute('data-v'));
    });
  }

  /* ⚙️ 설정 모달 같은 곳에 그대로 끼워 넣는 블록 */
  function renderInto(host, opts) {
    if (!host) return null;
    style();
    var box = host.querySelector ? host.querySelector('.pkma-rows') : null;
    if (!box) {
      box = document.createElement('div');
      box.className = 'pkma-rows';
      box.setAttribute('data-pkma-block', '1');
      box.innerHTML = rowsHtml();
      host.appendChild(box);
      var note = document.createElement('p');
      note.className = 'pkma-note';
      note.textContent = (opts && opts.note) || '🔊 버튼은 소리 전체 끄기예요 · 이 기기에만 저장돼요';
      host.appendChild(note);
    }
    bindHost(host);
    paint(host);
    return box;
  }

  /* 상단 사운드 팝업 — 🔊 버튼 아래에 붙는다 */
  function buildPanel() {
    if (panel) return panel;
    style();
    var el = document.createElement('div');
    el.className = 'pkma-panel';
    el.id = 'pkmaPanel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '소리 조절');
    el.hidden = true;
    el.innerHTML = '<div class="pkma-head"><b>🔉 소리 조절</b>'
      + '<button type="button" class="pkma-x" data-pkma-close="1" aria-label="닫기">✕</button></div>'
      + '<div class="pkma-body">' + rowsHtml() + '</div>'
      + '<p class="pkma-note">🔊 버튼은 소리 전체 끄기예요 · 이 기기에만 저장돼요</p>';
    (document.body || document.documentElement).appendChild(el);
    bindHost(el);
    el.addEventListener('click', function (e) {
      var x = e.target.closest ? e.target.closest('[data-pkma-close]') : null;
      if (x) { e.preventDefault(); closePanel(); }
    });
    panel = el;
    return el;
  }

  function anchor() {
    var btn = document.getElementById('muteBtn');
    if (!btn) return null;
    var r = btn.getBoundingClientRect();
    return { right: r.right, bottom: r.bottom };
  }

  function openPanel() {
    var el = buildPanel();
    paint(el);
    el.hidden = false;
    var at = anchor();
    var vw = window.innerWidth || document.documentElement.clientWidth || 360;
    var w = el.offsetWidth || 300;
    if (at) {
      var left = Math.max(8, Math.min(vw - w - 8, at.right - w));
      var top = at.bottom + 6;
      var vh = window.innerHeight || 640;
      if (top + el.offsetHeight > vh - 8) top = Math.max(8, at.bottom - el.offsetHeight - 6 - 40);
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.right = 'auto';
    } else {
      el.style.left = '8px';
      el.style.top = '64px';
      el.style.right = 'auto';
    }
    setTimeout(function () {
      document.addEventListener('pointerdown', outside, true);
    }, 0);
    return true;
  }
  function outside(e) {
    if (!panel || panel.hidden) return;
    if (panel.contains(e.target)) return;
    var btn = document.getElementById('muteBtn');
    if (btn && btn.contains(e.target)) return;
    closePanel();
  }
  function closePanel() {
    if (panel) panel.hidden = true;
    document.removeEventListener('pointerdown', outside, true);
    return true;
  }
  function togglePanel() { return panel && !panel.hidden ? closePanel() : openPanel(); }

  /* 🔊 버튼은 짧게 누르면 지금처럼 음소거, 길게(0.5초) 누르면 볼륨 팝업 */
  function bindLongPress() {
    var btn = document.getElementById('muteBtn');
    if (!btn || bound.btn === btn) return;
    bound.btn = btn;
    btn.addEventListener('pointerdown', function () {
      longPress.fired = false;
      clearTimeout(longPress.t);
      longPress.t = setTimeout(function () { longPress.fired = true; openPanel(); }, 500);
    });
    var cancel = function () { clearTimeout(longPress.t); };
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('pointercancel', cancel);
    btn.addEventListener('click', function (e) {
      if (!longPress.fired) return;
      longPress.fired = false;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
    btn.setAttribute('title', '짧게: 소리 끄기 · 길게: 볼륨 조절');
  }

  function bindVolBtn() {
    var btn = document.getElementById('volBtn');
    if (!btn || btn.__pkmaBind) return;
    btn.__pkmaBind = true;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openPanel();
    });
  }

  function init() {
    load();
    hookAll();
    applyAll();
    bindLongPress();
    bindVolBtn();
    paintAll();
  }

  window.PKMAudio = {
    version: VERSION,
    key: KEY,
    steps: STEPS.map(function (s) { return { v: s.v, label: s.label }; }),
    get: function (part) { return part === 'bgm' || part === 'voice' ? cfg[part] : { bgm: cfg.bgm, voice: cfg.voice }; },
    bgm: function () { return cfg.bgm; },
    voice: function () { return cfg.voice; },
    set: function (part, v) { onPick(part, v, true); return cfg[part]; },
    apply: applyAll,
    renderInto: renderInto,
    openPanel: openPanel,
    closePanel: closePanel,
    togglePanel: togglePanel,
    paint: paintAll,
    /* 검증용 — 지금 화면에 실제로 걸린 값 */
    state: function () {
      var out = {
        bgm: cfg.bgm,
        voice: cfg.voice,
        stored: null,
        panelOpen: !!(panel && !panel.hidden),
        muteBtn: (function () { var b = document.getElementById('muteBtn'); return b ? b.textContent.trim() : ''; })(),
        tone: { orig: probe.toneOrig, scaled: probe.toneScaled }
      };
      try { out.stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { out.stored = null; }
      try {
        if (typeof BGM !== 'undefined' && BGM && typeof BGM.VOL === 'number') {
          out.bgmVol = Math.round(BGM.VOL * 1000) / 1000;
          out.masterGain = BGM.master ? Math.round(BGM.master.gain.value * 1000) / 1000 : null;
          out.playing = !!BGM.playing;
        }
      } catch (e) { /* */ }
      try {
        if (window.PKMVillageAudio && typeof window.PKMVillageAudio.bgmState === 'function') {
          var vs = window.PKMVillageAudio.bgmState();
          out.village = vs;
          out.masterGain = vs.master == null ? null : Math.round(vs.master * 1000) / 1000;
          out.bgmVol = Math.round(vs.level * 1000) / 1000;
        }
      } catch (e) { /* */ }
      try {
        if (typeof TTS !== 'undefined' && TTS && TTS.audio) out.ttsVolume = Math.round(TTS.audio.volume * 100) / 100;
      } catch (e) { /* */ }
      return out;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
