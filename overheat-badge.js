/*!
 * overheat-badge.js — 관제탑 단기과열 · 시장경보 배지 엔진
 * -----------------------------------------------------------------------------
 * 목적
 *   ① 공식 경보  : 네이버 금융 「관리·거래정지·경보」(KRX 지정 현황) 목록을 그대로 표시
 *                  → /api/stock-live?mode=alerts  (투자주의 · 투자경고 · 투자위험 · 거래정지)
 *   ② 계산 배지  : 내장 일봉 DB(window.DAILY_500_CANDLES)의 실측 종가로
 *                  5거래일 누적 ≥ +30% / 20거래일 누적 ≥ +50% 를 계산해 표시
 *                  → 공식 지정이 아니므로 색·아이콘·툴팁에서 명확히 구분한다.
 *
 * 정직 원칙
 *   - 일봉 데이터가 없는 종목에는 계산 배지를 절대 붙이지 않는다(추정 금지).
 *   - 공식 목록에 없는 종목에는 경보 배지를 붙이지 않는다(추측 금지).
 *   - 배지에는 판정 기준일(마지막 일봉 날짜)을 함께 남긴다.
 *
 * 적용 범위 (2026-11-15 사용자 지정)
 *   1번 주도맵 · 2번 수급 · 3번 NXT/시간외 · 5번 RN존 · 6번 만쥬 · 7번 종가배팅 + 종목 상세 모달
 *   (4번 브리핑 · 8번 뉴스 · 9번 일정은 비대상)
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : null;
  if (!root || !root.document) return;

  var CFG = {
    tabs: ['tabOverview', 'tabSupply', 'tabAftermarket', 'tabRnzone', 'tabManju', 'tabJongbe'],
    chg5: 30,
    chg20: 50,
    alertUrl: '/api/stock-live?mode=alerts',
    alertTtlMs: 10 * 60 * 1000,
    lsKey: 'sd_overheat_exclude_v1',
    // 종목명이 들어가는 후보 노드(카드마다 실제로 쓰는 클래스 + 굵은 이름)
    candSel: '[data-pm-code],.st-name,.ssc-name,.card-name,.pm-q,strong,b',
    cardSel: [
      '.stock-tile',
      '.supply-stock-card',
      '.stock-card',
      '.manju-item',
      '.af-card',
      '.nxt-card',
      '[onclick*="openDetail("]',
    ].join(','),
  };

  var CSS = [
    '.oh-chip{display:inline-flex;align-items:center;gap:2px;margin-left:3px;padding:0 4px;',
    'border-radius:4px;font-size:9px;font-weight:900;line-height:1.5;white-space:nowrap;',
    'vertical-align:middle;letter-spacing:-.2px;cursor:help;text-decoration:none;',
    'max-width:calc(100% - 3px);overflow:hidden;text-overflow:ellipsis}',
    '.oh-flagged{min-width:0}',
    '.oh-chip.oh-caution{background:#78350f;color:#fde68a;border:1px solid #b45309}',
    '.oh-chip.oh-warning{background:#7f1d1d;color:#fecaca;border:1px solid #dc2626}',
    '.oh-chip.oh-danger{background:#450a0a;color:#fca5a5;border:1px solid #ef4444}',
    '.oh-chip.oh-halt{background:#111827;color:#cbd5e1;border:1px solid #475569}',
    '.oh-chip.oh-calc{background:rgba(192,132,252,.14);color:#e9d5ff;border:1px dashed #a855f7}',
    '.oh-exclude .oh-flagged{opacity:.28;filter:grayscale(.65);transition:opacity .15s}',
    '.oh-toggle.tab-btn{position:relative}',
    '.oh-toggle.on{background:rgba(168,85,247,.2);border-color:#a855f7;color:#e9d5ff;font-weight:800}',
    '.oh-modal-box{margin:8px 0 10px;padding:8px 10px;border-radius:8px;background:#0f172a;',
    'border:1px solid rgba(251,146,60,.45);font-size:11px;line-height:1.55;color:#cbd5e1}',
    '.oh-modal-box .ohb-head{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:4px;',
    'font-size:11.5px;font-weight:800;color:#fdba74}',
    '.oh-modal-box .ohb-note{font-size:9.5px;color:#94a3b8;margin-top:3px;line-height:1.5}',
  ].join('');

  function injectCss() {
    if (document.getElementById('ohBadgeCss')) return;
    var st = document.createElement('style');
    st.id = 'ohBadgeCss';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------------------- 데이터 인덱스 ---------------------------- */

  var IDX = { seriesByCode: {}, nameToCode: {}, seriesByName: {}, built: false, lastBars: 0 };

  function isCode(k) {
    return /^[0-9A-Z]{6}$/.test(k) && /[0-9]/.test(k);
  }

  function buildIndex() {
    if (IDX.built) return;
    var db = root.DAILY_500_CANDLES || {};
    var codes = root.stockCodes || {};
    Object.keys(db).forEach(function (k) {
      var arr = db[k];
      if (!arr || !arr.length) return;
      if (isCode(k)) IDX.seriesByCode[k] = arr;
      else IDX.seriesByName[k] = arr;
      IDX.lastBars++;
    });
    Object.keys(codes).forEach(function (nm) {
      IDX.nameToCode[nm] = codes[nm];
    });
    Object.keys(IDX.seriesByName).forEach(function (nm) {
      if (!IDX.nameToCode[nm]) {
        // DB에만 이름 키로 들어있는 종목은 코드를 모르므로 이름 자체를 키로 쓴다
        IDX.nameToCode[nm] = nm;
      }
    });
    IDX.built = true;
  }

  function seriesFor(key) {
    if (!key) return null;
    if (IDX.seriesByCode[key]) return IDX.seriesByCode[key];
    if (IDX.seriesByName[key]) return IDX.seriesByName[key];
    var code = IDX.nameToCode[key];
    if (code && IDX.seriesByCode[code]) return IDX.seriesByCode[code];
    return null;
  }

  function codeFor(name) {
    if (!name) return null;
    if (IDX.nameToCode[name]) return IDX.nameToCode[name];
    if (isCode(name)) return name;
    return null;
  }

  /** 일봉 실측 5거래일·20거래일 누적 등락률 (계산값) */
  function compute(series) {
    if (!series || series.length < 21) return null;
    var n = series.length;
    var c0 = series[n - 1][4];
    var c5 = series[n - 6][4];
    var c20 = series[n - 21][4];
    if (!(c0 > 0) || !(c5 > 0) || !(c20 > 0)) return null;
    return {
      chg5: (c0 / c5 - 1) * 100,
      chg20: (c0 / c20 - 1) * 100,
      baseDate: String(series[n - 1][0]),
      bars: n,
    };
  }

  function overheatFor(key) {
    return compute(seriesFor(key));
  }

  function dateLabel(yyyymmdd) {
    if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || '—';
    return yyyymmdd.slice(2, 4) + '/' + yyyymmdd.slice(4, 6) + '/' + yyyymmdd.slice(6, 8);
  }

  /* ---------------------------- 공식 경보 목록 ---------------------------- */

  var ALERT = { at: 0, byCode: {}, counts: null, ok: false, asOf: null, error: null, loading: false };

  function loadAlerts(force) {
    var now = Date.now();
    if (!force && ALERT.at && now - ALERT.at < CFG.alertTtlMs) return Promise.resolve(ALERT);
    if (ALERT.loading) return ALERT.promise || Promise.resolve(ALERT);
    ALERT.loading = true;
    ALERT.promise = fetch(CFG.alertUrl + (force ? '&fresh=1' : ''), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.ok !== true) throw new Error((d && d.message) || 'alerts failed');
        ALERT.byCode = d.byCode || {};
        ALERT.byName = {};
        Object.keys(ALERT.byCode).forEach(function (c) {
          var r = ALERT.byCode[c];
          if (r && r.name) ALERT.byName[r.name] = r;
        });
        ALERT.counts = d.counts || null;
        ALERT.asOf = d.generatedAtKst || null;
        ALERT.ok = true;
        ALERT.error = null;
        ALERT.at = Date.now();
        return ALERT;
      })
      .catch(function (e) {
        ALERT.error = String((e && e.message) || e);
        ALERT.ok = false;
        return ALERT;
      })
      .then(function (a) {
        ALERT.loading = false;
        decorateAll();
        return a;
      });
    return ALERT.promise;
  }

  function alertFor(codeOrName) {
    if (!codeOrName) return null;
    if (ALERT.byCode[codeOrName]) return ALERT.byCode[codeOrName];
    if (ALERT.byName && ALERT.byName[codeOrName]) return ALERT.byName[codeOrName];
    return null;
  }

  /* ------------------------------- 배지 생성 ------------------------------- */

  var ALERT_STYLE = {
    '투자주의': { cls: 'oh-caution', ico: '⚠️', short: '투자주의' },
    '투자경고': { cls: 'oh-warning', ico: '🚨', short: '투자경고' },
    '투자위험': { cls: 'oh-danger', ico: '🔥', short: '투자위험' },
  };

  function makeChip(cls, text, title) {
    var s = document.createElement('span');
    s.className = 'oh-chip ' + cls;
    s.setAttribute('data-oh-chip', '1');
    s.textContent = text;
    if (title) s.title = title;
    return s;
  }

  /** 공식 경보 칩 (KRX 지정 현황) */
  function officialChips(a) {
    var out = [];
    if (!a) return out;
    var st = a.alertLabel ? ALERT_STYLE[a.alertLabel] : null;
    if (st) {
      out.push(
        makeChip(
          st.cls,
          st.ico + ' ' + st.short,
          '공식 지정 (네이버 금융 관리·거래정지·경보 · KRX) · ' + a.alertLabel +
            (a.price != null ? ' · 기준가 ' + Number(a.price).toLocaleString('ko-KR') + '원' : '') +
            (a.changePct != null ? ' (' + (a.changePct > 0 ? '+' : '') + a.changePct + '%)' : '')
        )
      );
    }
    if (a.tradeStop) {
      out.push(
        makeChip(
          'oh-halt',
          '⛔ 거래정지',
          '공식 지정 (거래정지)' + (a.haltDate ? ' · 정지일 ' + dateLabel(a.haltDate) : '')
        )
      );
    }
    return out;
  }

  /** 일봉 계산 단기과열 칩 */
  function calcChips(oh) {
    var out = [];
    if (!oh) return out;
    var base = '일봉 실측 계산(공식 지정 아님) · ' + dateLabel(oh.baseDate) + ' 종가 기준 · ' +
      '5일 ' + signPct(oh.chg5) + ' / 20일 ' + signPct(oh.chg20);
    if (oh.chg20 >= CFG.chg20) {
      out.push(makeChip('oh-calc', '📈20일' + signPct(oh.chg20), base + ' · 20일 누적 급등 기준(+' + CFG.chg20 + '%)'));
    }
    if (oh.chg5 >= CFG.chg5) {
      out.push(makeChip('oh-calc', '📈5일' + signPct(oh.chg5), base + ' · 단기과열 기준(5일 +' + CFG.chg5 + '%)'));
    }
    return out;
  }

  function signPct(v) {
    var r = Math.round(v * 10) / 10;
    return (r > 0 ? '+' : '') + r.toFixed(1) + '%';
  }

  /* ------------------------------- 노드 해석 ------------------------------- */

  function clean(t) {
    return String(t || '').replace(/\s+/g, ' ').trim();
  }

  /** 이름/코드 후보 뽑기 */
  function resolveKey(el) {
    if (el.getAttribute('data-oh-key')) return { key: el.getAttribute('data-oh-key'), text: clean(el.textContent) };
    var code = el.getAttribute('data-pm-code') || el.getAttribute('data-code') || null;
    var txt = clean(el.textContent);
    if (code && isCode(code)) return { key: code, text: txt };

    // ① "금호건설 (002990)" / "금호건설(002990) 11,210원"
    var m = txt.match(/([0-9A-Z]{6})\s*[\)）]/);
    var namePart = '';
    if (m) {
      var before = txt.slice(0, txt.indexOf(m[1]));
      before = before.replace(/[\s\(（]+$/, '');
      if (before) {
        var nm = matchByText(before);
        if (nm) return { key: nm, text: before, code: m[1] };
        return { key: m[1], text: before };
      }
    }

    // ② "코리아써키트 007810" (괄호 없는 코드)
    var m2 = txt.match(/^(.{1,22}?)\s+([0-9A-Z]{6})(?:\s|$)/);
    if (m2) {
      var nm2 = matchByText(m2[1]);
      return { key: nm2 || m2[2], text: m2[1], code: m2[2] };
    }

    // ③ 이름만 있는 경우 — 가격·등락률·꼬리표를 떼고 매칭
    var k = matchByText(txt);
    if (k) return { key: k, text: txt };
    return null;
  }

  /** 이름 문자열에서 가격·등락률·괄호 설명을 떼고 알려진 종목명을 찾는다 */
  function matchByText(raw) {
    var t = clean(raw);
    if (!t) return null;
    t = t.replace(/^[★☆•·\-–—※\s]+/, '');
    t = t.replace(/\s*[\d,]+(?:\.\d+)?\s*원[\s\S]*$/, ''); // "34,150원 (+8.93%)"
    t = t.replace(/\s*[+\-]?[\d.,]+\s*%[\s\S]*$/, '');
    t = t.replace(/\s*[\[【][^\]】]*[\]】]\s*$/, '');
    t = t.replace(/\s*[\(（][^\)）]*[\)）]\s*$/, '');
    t = t.replace(/\s*[\(（][^\)）]*[\)）]\s*$/, '');
    t = t.trim();
    if (!t) return null;
    var tries = [t];
    // "지니언스 AI 보안 대장" 처럼 뒤에 설명이 붙은 경우 앞부분만으로도 시도
    var toks = t.split(' ');
    for (var n = Math.min(4, toks.length - 1); n >= 1; n--) tries.push(toks.slice(0, n).join(' '));
    for (var i = 0; i < tries.length; i++) {
      var c = codeFor(tries[i]);
      if (c) return c;
      // 이름 앞부분에 종목명이 붙어 있는 경우("★ 금호건설")까지는 위에서 제거됨
    }
    return null;
  }

  function isCandidate(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute('data-oh-chip')) return false;
    if (el.closest('[data-oh-chip]')) return false;
    if (el.children.length > 2) return false; // 이름 + 아이콘 정도만
    var t = clean(el.textContent);
    if (!t || t.length > 30) return false;
    return true;
  }

  /** 배지가 붙은 이름 노드에서 '흐리게' 처리할 카드 컨테이너 찾기 */
  function findCard(el) {
    var node = el;
    for (var d = 0; d < 5 && node && node !== document.body; d++) {
      if (node.matches && node.matches(CFG.cardSel)) {
        // 카드 안에 다른 종목 이름이 2개 이상이면 큰 패널로 보고 건너뛴다
        var others = node.querySelectorAll('[data-oh-key]');
        if (others.length <= 2) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /* ------------------------------- 데코레이션 ------------------------------- */

  var STATS = { chips: 0, official: 0, calc: 0, nodes: 0, flagged: 0, missingData: 0 };
  var decorating = false;

  function targets() {
    var list = [];
    CFG.tabs.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) list.push(el);
    });
    return list;
  }

  function decorateWithin(scope) {
    if (!scope) return 0;
    var nodes;
    try {
      nodes = scope.querySelectorAll(CFG.candSel);
    } catch (e) {
      return 0;
    }
    var added = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('data-oh-chip') || (el.closest && el.closest('[data-oh-chip]'))) continue;

      var knownKey = el.getAttribute('data-oh-key');
      var r = knownKey ? { key: knownKey } : resolveKey(el);
      if (!r || !r.key) continue;

      // 아직 배지가 없는 노드만 후보 검사 (이미 칩이 있으면 보강 단계로)
      if (!knownKey && !isCandidate(el)) continue;

      var code = isCode(r.key) ? r.key : codeFor(r.key);
      var oh = overheatFor(r.key);
      var a = alertFor(code) || alertFor(r.key);

      // 실시간 렌더가 노드 내용을 다시 그리면 칩이 지워지므로 속성이 아니라 실제 칩으로 판단한다
      var wantOff = !el.querySelector('.oh-chip:not(.oh-calc)');
      var wantCalc = !el.querySelector('.oh-chip.oh-calc');
      var off = wantOff ? officialChips(a) : [];
      var cal = wantCalc ? calcChips(oh) : [];

      if (!off.length && !cal.length) {
        el.setAttribute('data-oh-key', r.key);
        continue;
      }

      off.concat(cal).forEach(function (c) { el.appendChild(c); });
      el.setAttribute('data-oh-key', r.key);
      added++;

      var card = findCard(el) || el;
      card.classList.add('oh-flagged');
    }
    return added;
  }

  function decorateAll() {
    if (decorating) return;
    buildIndex();
    decorating = true;
    try {
      STATS = { chips: 0, official: 0, calc: 0, nodes: 0, flagged: 0, missingData: 0 };
      targets().forEach(function (t) { decorateWithin(t); });
      recomputeStats();
      updateToggle();
    } finally {
      decorating = false;
    }
  }

  /** 배지 개수는 DOM에서 다시 센다(재스캔 때 이미 배지가 붙은 노드는 건너뛰므로) */
  function recomputeStats() {
    var chips = 0, official = 0, calc = 0, nodes = 0;
    targets().forEach(function (t) {
      var list = t.querySelectorAll('.oh-chip');
      for (var i = 0; i < list.length; i++) {
        chips++;
        if (list[i].classList.contains('oh-calc')) calc++;
        else official++;
      }
      nodes += t.querySelectorAll('[data-oh-key]').length;
    });
    STATS.chips = chips;
    STATS.official = official;
    STATS.calc = calc;
    STATS.nodes = nodes;
    STATS.flagged = document.querySelectorAll('.oh-flagged').length;
  }

  /* --------------------------------- 토글 --------------------------------- */

  function isExcluded() {
    try {
      return localStorage.getItem(CFG.lsKey) === '1';
    } catch (e) {
      return false;
    }
  }

  function applyToggle(on) {
    document.body.classList.toggle('oh-exclude', !!on);
    var btn = document.getElementById('ohToggle');
    if (btn) {
      btn.classList.toggle('on', !!on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function updateToggle() {
    var btn = document.getElementById('ohToggle');
    if (!btn) return;
    var n = STATS.flagged;
    btn.textContent = (isExcluded() ? '📈 과열 제외 중' : '📈 과열 제외') + (n ? ' · ' + n : '');
    btn.title =
      '켜면 단기과열·시장경보가 붙은 종목을 흐리게 표시합니다. ' +
      '현재 ' + STATS.official + '개 공식 경보 칩 · ' + STATS.calc + '개 일봉 계산 칩.';
  }

  function toggleExclude() {
    var on = !isExcluded();
    try {
      localStorage.setItem(CFG.lsKey, on ? '1' : '0');
    } catch (e) {}
    applyToggle(on);
    updateToggle();
  }

  function injectToggle() {
    if (document.getElementById('ohToggle')) return;
    var bar = document.querySelector('.view-tabs');
    if (!bar) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'ohToggle';
    btn.className = 'tab-btn oh-toggle';
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = '📈 과열 제외';
    btn.addEventListener('click', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      toggleExclude();
    });
    bar.appendChild(btn);
    applyToggle(isExcluded());
    updateToggle();
  }

  /* ------------------------------- 상세 모달 ------------------------------- */

  function modalKey(title) {
    var t = clean(title);
    if (!t) return null;
    var br = t.match(/^(.{1,24}?)\s*\[/);
    if (br) t = br[1];
    // "삼성전자 [외인 1위]" / "17:30 1차 탐색 결과 (11/13)" 같은 제목에서 종목명만 집는다
    var key = codeFor(t);
    if (key) return key;
    var names = Object.keys(IDX.nameToCode).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < names.length; i++) {
      var nm = names[i];
      if (nm && nm.length >= 2 && t.indexOf(nm) !== -1) return IDX.nameToCode[nm];
    }
    return null;
  }

  function decorateModal(title) {
    var box = document.getElementById('ohModalBox');
    if (box && box.parentNode) box.parentNode.removeChild(box);
    var key = modalKey(title);
    if (!key) return;
    var code = isCode(key) ? key : codeFor(key);
    var a = alertFor(code);
    var oh = overheatFor(key);
    if (!a && !oh) return;

    var host = document.getElementById('modalRiskBox') || document.getElementById('modalDesc');
    if (!host || !host.parentNode) return;

    var wrap = document.createElement('div');
    wrap.id = 'ohModalBox';
    wrap.className = 'oh-modal-box';
    var head = document.createElement('div');
    head.className = 'ohb-head';
    head.textContent = (a || (oh && (oh.chg5 >= CFG.chg5 || oh.chg20 >= CFG.chg20))) ? '🚦 단기과열 · 시장경보' : '🚦 단기과열 점검';

    var chips = officialChips(a).concat(calcChips(oh));
    chips.forEach(function (c) { head.appendChild(c); });
    wrap.appendChild(head);

    if (!chips.length) {
      var okLine = document.createElement('div');
      okLine.style.color = '#86efac';
      okLine.textContent = '✅ 공식 경보 없음 · 일봉 ' + (oh ? dateLabel(oh.baseDate) : '—') + ' 기준 5일/20일 누적 과열 기준 미달';
      wrap.appendChild(okLine);
    }

    var note = document.createElement('div');
    note.className = 'ohb-note';
    var parts = [];
    if (a) parts.push('공식 경보: 네이버 금융 관리·거래정지·경보 목록(KRX 지정 현황)');
    if (oh) {
      parts.push(
        '계산: 일봉 실측 ' + dateLabel(oh.baseDate) + ' 종가 기준 5일 ' + signPct(oh.chg5) +
          ' / 20일 ' + signPct(oh.chg20) + ' (기준 5일 +' + CFG.chg5 + '%·20일 +' + CFG.chg20 + '%)'
      );
    } else {
      parts.push('이 종목은 내장 일봉 데이터가 없어 계산 배지를 표시하지 않습니다(추정 금지)');
    }
    note.textContent = parts.join(' · ');
    wrap.appendChild(note);

    host.parentNode.insertBefore(wrap, host);

    // 기존 모달의 'KRX 시장경보 진단'은 일부 종목만 손으로 써 둔 문장이라,
    // 공식 지정이 확인된 종목에서는 그 문장이 '안전 🟢'이라고 말해도 모순이 생긴다 → 공식 값으로 교체한다.
    if (a) overrideRiskBox(a);
  }

  function overrideRiskBox(a) {
    try {
      var badge = document.getElementById('modalRiskBadge');
      var krxTxt = document.getElementById('modalKrxTxt');
      var riskBox = document.getElementById('modalRiskBox');
      var st = a.alertLabel ? ALERT_STYLE[a.alertLabel] : null;
      var label = a.tradeStop ? '거래정지' : (st ? st.short : a.alertLabel || '시장경보');
      var ico = a.tradeStop ? '⛔' : (st ? st.ico : '⚠️');
      if (riskBox) {
        riskBox.style.display = 'block';
        riskBox.style.background = 'rgba(245,158,11,0.10)';
        riskBox.style.borderColor = 'rgba(245,158,11,0.4)';
      }
      if (badge) {
        badge.className = 'krx-warn';
        badge.innerHTML = ico + ' ' + label;
      }
      if (krxTxt) {
        krxTxt.innerHTML =
          '<span style="color:#fbbf24">네이버 금융 「관리·거래정지·경보」(KRX 지정 현황) 기준 <b>' + label +
          '</b> 종목입니다.' +
          (a.haltDate ? ' 정지일 ' + dateLabel(a.haltDate) + '.' : '') +
          '</span> <span style="color:#94a3b8">— 추격 매수 주의. 판정 근거는 공식 목록이며, 이 화면의 일봉 계산 배지와는 별개입니다.</span>';
      }
    } catch (e) {}
  }

  function hookOpenDetail() {
    if (typeof root.openDetail !== 'function' || root.openDetail.__ohHooked) return;
    var orig = root.openDetail;
    var wrapped = function () {
      var res;
      try {
        res = orig.apply(this, arguments);
      } catch (e) {
        throw e;
      }
      try {
        decorateModal(arguments[0]);
      } catch (e) {}
      return res;
    };
    wrapped.__ohHooked = true;
    root.openDetail = wrapped;
  }

  /* ------------------------------ 실시간 반영 ------------------------------ */

  /** /api/stock-live 페이로드에 실린 공식 상태(거래정지 등)를 배지 소스에 합친다 */
  function ingestLive(payload) {
    if (!payload || !payload.stocks || !payload.stocks.length) return;
    var changed = 0;
    payload.stocks.forEach(function (s) {
      if (!s || !s.code) return;
      var alerts = s.marketAlerts || [];
      var halt = s.tradeStop && String(s.tradeStop).toUpperCase().indexOf('TRADING') === -1;
      if (!alerts.length && !halt) return;
      var prev = ALERT.byCode[s.code] || {};
      var next = {
        code: s.code,
        name: s.name || prev.name,
        alertLabel: prev.alertLabel || null,
        alertType: prev.alertType || null,
        grade: prev.grade || 0,
        tradeStop: true,
        price: s.price != null ? s.price : prev.price,
        changePct: s.changePct != null ? s.changePct : prev.changePct,
        haltDate: prev.haltDate || null,
      };
      ALERT.byCode[s.code] = next;
      changed++;
    });
    if (changed) decorateAll();
  }

  function hookLive() {
    var LE = root.LiveExtra;
    if (!LE || typeof LE.applyLive !== 'function' || LE.applyLive.__ohHooked) return;
    var orig = LE.applyLive;
    var wrapped = function (payload) {
      var r = orig.apply(this, arguments);
      try {
        ingestLive(payload);
      } catch (e) {}
      return r;
    };
    wrapped.__ohHooked = true;
    LE.applyLive = wrapped;
  }

  /* --------------------------------- 관측 --------------------------------- */

  var pending = null;
  function observe() {
    if (!root.MutationObserver) return;
    var mo = new MutationObserver(function (muts) {
      if (decorating) return;
      var touched = false;
      for (var i = 0; i < muts.length && !touched; i++) {
        var m = muts[i];
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType !== 1) continue;
            if (n.getAttribute && n.getAttribute('data-oh-chip')) continue;
            touched = true;
            break;
          }
          // 실시간 갱신이 노드 내용을 다시 그리면 우리 칩이 '지워진다' → 그때도 다시 붙인다
          if (!touched) {
            for (var k = 0; k < m.removedNodes.length; k++) {
              var rn = m.removedNodes[k];
              if (rn.nodeType === 1 && rn.getAttribute && rn.getAttribute('data-oh-chip')) {
                touched = true;
                break;
              }
            }
          }
        }
      }
      if (!touched) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(function () {
        pending = null;
        decorateAll();
      }, 350);
    });
    targets().forEach(function (t) {
      mo.observe(t, { childList: true, subtree: true });
    });
  }

  /* --------------------------------- 초기화 --------------------------------- */

  function init() {
    injectCss();
    buildIndex();
    injectToggle();
    hookOpenDetail();
    hookLive();
    decorateAll();
    loadAlerts(false);
    observe();
    // 늦게 채워지는 탭(지연 렌더) 대비 몇 차례 더 훑는다
    [600, 1800, 4000, 9000].forEach(function (ms) {
      setTimeout(function () {
        decorateAll();
        hookOpenDetail();
      }, ms);
    });
    // 실시간 갱신이 잦은 탭에서 배지가 지워져도 30초 안에 복구된다
    setInterval(function () {
      if (!document.hidden) decorateAll();
    }, 30000);
  }

  function api() {
    return {
      version: '1.0.0',
      decorateAll: decorateAll,
      compute: compute,
      overheatFor: overheatFor,
      seriesFor: seriesFor,
      codeFor: codeFor,
      alertFor: alertFor,
      loadAlerts: loadAlerts,
      toggleExclude: toggleExclude,
      decorateModal: decorateModal,
      ingestLive: ingestLive,
      stats: function () {
        return JSON.parse(JSON.stringify(STATS));
      },
      state: function () {
        return {
          index: {
            seriesByCode: Object.keys(IDX.seriesByCode).length,
            seriesByName: Object.keys(IDX.seriesByName).length,
            names: Object.keys(IDX.nameToCode).length,
          },
          alerts: { ok: ALERT.ok, at: ALERT.at, total: Object.keys(ALERT.byCode).length, counts: ALERT.counts, error: ALERT.error },
          excluded: isExcluded(),
          thresholds: { chg5: CFG.chg5, chg20: CFG.chg20 },
        };
      },
      _cfg: CFG,
    };
  }

  root.OhBadge = api();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
