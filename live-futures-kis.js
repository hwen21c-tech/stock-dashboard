/* ============================================================================
 * 🌙 정적 관제탑 전용 — 코스피200 주간선물(F) · 야간선물(CM) 실시간 시세
 * ----------------------------------------------------------------------------
 *  · 정적 페이지(GitHub Pages)에는 /api 서버리스가 없다. live-static-api.js 가
 *    '/api/...' 요청을 동적 오리진(6frm)으로 넘겨 주므로 그 경로로 받아 온다.
 *  · 값의 출처는 한투 KIS 국내선물옵션 현재가(FHMIF10000000) — 실측만 쓴다.
 *  · 상단 티커의 `주간선물` · `야간선물(코스피)` 두 칸과, 만쥬 시장분위기(MANJU_MOOD)의
 *    야간선물 축·지수 베팅 점수를 같은 값으로 맞춘다(동적 본체 live-api.js 와 같은 규칙).
 *  · 응답이 없거나 실패하면 화면을 지우지 않는다 — 정적 스냅샷 값을 그대로 둔다.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__futuresKisStarted) return;
  window.__futuresKisStarted = true;

  var URL = '/api/tabs-live';
  var POLL_MS = 60000;
  var timer = null;
  var lastAt = 0;

  function fnum(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function tickerTargets() {
    var bar = document.querySelector('.ticker-bar');
    if (!bar) return null;
    var items = Array.prototype.slice.call(bar.querySelectorAll('.ticker-item'));
    var day = null;
    var night = null;
    items.forEach(function (it) {
      var l = it.querySelector('.label');
      var t = l ? (l.textContent || '').replace(/\s+/g, '') : '';
      if (!day && t.indexOf('주간선물') >= 0) day = { item: it, label: l, val: it.querySelector('.val') };
      if (!night && t.indexOf('야간선물') >= 0 && t.indexOf('코스닥') < 0) {
        night = { item: it, label: l, val: it.querySelector('.val') };
      }
    });
    return { day: day, night: night };
  }

  function setBadge(t, text) {
    if (!t || !t.label || !text) return false;
    var b = t.label.querySelector('span');
    if (!b) {
      b = document.createElement('span');
      b.style.cssText =
        'font-size:8.5px;background:rgba(255,255,255,0.08);padding:1px 3px;border-radius:2px;color:#cbd5e1;';
      t.label.appendChild(b);
    }
    if (b.textContent !== text) b.textContent = text;
    return true;
  }

  function quoteDesc(q, label) {
    var bits = [];
    bits.push('한투 KIS 실전 국내선물옵션 시세(FHMIF10000000) · ' + (label || '') + ' ' + (q.code || ''));
    if (fnum(q.prevClose) !== null) bits.push('기준(전일) ' + q.prevClose.toFixed(2));
    if (fnum(q.open) !== null) bits.push('시 ' + q.open.toFixed(2));
    if (fnum(q.high) !== null) bits.push('고 ' + q.high.toFixed(2));
    if (fnum(q.low) !== null) bits.push('저 ' + q.low.toFixed(2));
    if (fnum(q.volume) !== null) bits.push('누적거래량 ' + Math.round(q.volume).toLocaleString('ko-KR') + '계약');
    if (fnum(q.openInterest) !== null) bits.push('미결제약정 ' + Math.round(q.openInterest).toLocaleString('ko-KR'));
    if (fnum(q.kospi200) !== null) bits.push('코스피200 현물 ' + q.kospi200.toFixed(2));
    bits.push('조회 ' + (q.asOfKst || '') + ' KST');
    return bits.join(' · ');
  }

  function paintTile(t, q, title, key, label) {
    if (!t || !t.item || !q || q.ok !== true) return 0;
    var price = fnum(q.price);
    if (price === null) return 0;
    var p = fnum(q.changePct);
    var txt = price.toFixed(2) + ' ' + (p === null ? '' : '(' + (p > 0 ? '+' : '') + p.toFixed(2) + '%)');
    var val = t.val;
    if (!val) {
      val = document.createElement('span');
      val.className = 'val';
      t.item.appendChild(val);
    }
    if (val.textContent !== txt) val.textContent = txt;
    val.className = p === null || p === 0 ? 'val' : p > 0 ? 'val up' : 'val down';
    setBadge(t, q.badge);
    t.item.setAttribute('title', quoteDesc(q, label));
    function clean(s) {
      return String(s == null ? '' : s).replace(/['"\\]/g, '').replace(/\s+/g, ' ').trim();
    }
    t.item.setAttribute(
      'onclick',
      "openIndexChart('" + clean(title) +
        "', '" + clean(price.toFixed(2) + 'pt ' + (p === null ? '' : '(' + (p > 0 ? '+' : '') + p.toFixed(2) + '%)')) +
        "', '" + clean((q.badge || '') + ' · ' + (label || '')) +
        "', '" + clean(quoteDesc(q, label)) +
        "', '" + clean(key) + "')"
    );
    return 1;
  }

  /* 만쥬 시장분위기 — auto_update_all_tabs.py 의 mj_market_mood 와 같은 가중치·식 */
  function moodWithFutures(nfValue, nfPct) {
    var D = window.MANJU_DATA;
    if (!D || !D.mood || typeof D.mood !== 'object') return null;
    if (fnum(nfPct) === null) return null;
    var mood = D.mood;
    mood.nightFuture = { value: fnum(nfValue), pct: nfPct, label: '한투 KIS 실시간(CM)' };

    function normPct(x) {
      return x == null ? null : Math.max(0, Math.min(1, (x / 3 + 1) / 2));
    }
    function normSupply(v) {
      return v == null ? null : Math.max(0, Math.min(1, (v / 10000 + 1) / 2));
    }
    var k = mood.kospi || {};
    var s = mood.supply || {};
    var sup = s.foreign != null && s.organ != null ? (s.foreign || 0) + (s.organ || 0) : null;
    var b = mood.breadth || {};
    var nq = mood.nq || {};
    var axes = [
      { name: '코스피 등락', x: normPct(k.pct), w: 0.3 },
      { name: '외인+기관 수급(코스피)', x: normSupply(sup), w: 0.25 },
      { name: '시장폭(상승 비율)', x: b.ratio != null ? b.ratio / 100 : null, w: 0.15 },
      { name: '야간선물(코스피200)', x: normPct(nfPct), w: 0.15 },
      { name: '나스닥100 선물', x: normPct(nq.pct), w: 0.15 }
    ];
    var wsum = 0;
    var acc = 0;
    var rows = [];
    axes.forEach(function (a) {
      if (a.x === null) {
        rows.push({ name: a.name, weight: a.w, score: null });
        return;
      }
      rows.push({ name: a.name, weight: a.w, score: Math.round(a.x * 100) });
      wsum += a.w;
      acc += a.x * a.w;
    });
    var close = wsum > 0 ? Math.round((acc / wsum) * 100) : null;
    mood.indexCloseScore = close;
    mood.indexDownScore = close === null ? null : 100 - close;
    mood.coverage = Math.round(wsum * 100);
    if (Array.isArray(mood.rows)) {
      mood.rows.forEach(function (r) {
        rows.forEach(function (n) {
          if (n.name !== r.name) return;
          r.score = n.score;
          if (n.name === '야간선물(코스피200)' && fnum(nfValue) !== null) {
            r.text = nfValue.toFixed(2) + 'pt (' + (nfPct > 0 ? '+' : '') + nfPct.toFixed(2) + '%)';
          }
        });
      });
    } else {
      mood.rows = rows;
    }
    return { closeScore: close, nightScore: rows[3].score };
  }

  function moodDom(closeScore, nightScore, nfValue, nfPct, live) {
    var header = null;
    var divs = document.querySelectorAll('div');
    for (var i = 0; i < divs.length; i += 1) {
      var t = (divs[i].textContent || '').trim();
      if (t.indexOf('🧭 만쥬 시장분위기') !== 0) continue;
      if (!header || t.length < (header.textContent || '').trim().length) header = divs[i];
    }
    if (!header) return 0;
    var block = header;
    for (var up = 0; up < 4; up += 1) {
      var parent = block.parentElement;
      if (!parent) break;
      block = parent;
      if ((block.textContent || '').indexOf('지수 종가베팅 점수') >= 0) break;
    }
    var blockText = block.textContent || '';
    if (blockText.indexOf('지수 종가베팅 점수') < 0 || blockText.length > 1600) return 0;
    var applied = 0;

    var all = block.querySelectorAll('div');
    for (var j = 0; j < all.length; j += 1) {
      var row = all[j];
      var txt = (row.textContent || '').replace(/^\s*·\s*/, '');
      if (txt.indexOf('야간선물(코스피200)') !== 0) continue;
      var spans = row.querySelectorAll('span');
      if (spans.length < 2) continue;
      var col = nightScore == null ? '#64748b' : nightScore >= 55 ? '#34d399' : nightScore >= 45 ? '#fbbf24' : '#f87171';
      spans[spans.length - 1].innerHTML =
        (fnum(nfValue) === null ? '—' : nfValue.toFixed(2) + 'pt (' + (nfPct > 0 ? '+' : '') + nfPct.toFixed(2) + '%)') +
        ' <b style="color:' + col + ';">' + (nightScore == null ? '—' : nightScore + '점') + '</b>';
      row.setAttribute('title', live ? '한투 KIS 야간선물(CM) 실시간' : '한투 KIS 야간선물 마감값');
      applied += 1;
      break;
    }

    var labels = block.querySelectorAll('div');
    for (var k = 0; k < labels.length; k += 1) {
      var lt = (labels[k].textContent || '').trim();
      if (lt.length > 34) continue;
      var isClose = lt.indexOf('지수 종가베팅 점수') >= 0;
      var isDown = lt.indexOf('지수 하방베팅 점수') >= 0;
      if (!isClose && !isDown) continue;
      var card = labels[k].parentElement;
      if (!card) continue;
      var numEl = card.children[1];
      if (!numEl) continue;
      var sc = isClose ? closeScore : closeScore == null ? null : 100 - closeScore;
      if (sc == null) continue;
      numEl.innerHTML = sc + '<span style="font-size:12px;color:#94a3b8;font-weight:700;"> / 100</span>';
      applied += 1;
    }
    return applied;
  }

  function apply(fk) {
    if (!fk || fk.ok !== true) return 0;
    var label = (fk.contract && fk.contract.label) || '코스피200 근월물';
    var t = tickerTargets();
    var applied = 0;
    if (t && fk.day) applied += paintTile(t.day, fk.day, '코스피200 주간선물 (' + label + ')', 'kospi200_day', label);
    if (t && fk.night) {
      applied += paintTile(
        t.night,
        fk.night,
        '코스피200 야간선물 (' + (fk.night.live ? '실시간' : '마감값') + ')',
        'kospi200_night',
        label
      );
    }
    var nq = fk.night && fk.night.ok ? fk.night : null;
    if (nq && fnum(nq.price) !== null) {
      var res = moodWithFutures(nq.price, fnum(nq.changePct));
      if (res) applied += moodDom(res.closeScore, res.nightScore, nq.price, fnum(nq.changePct), nq.live);
    }
    // 애프터마켓 탭 '선물·글로벌' 요약도 같은 실측값으로
    var afEl = document.getElementById('afFutText');
    if (afEl) {
      var seg = [];
      function push(name, q) {
        if (!q || fnum(q.price) === null) return;
        var p = fnum(q.changePct);
        seg.push(name + ' ' + q.price.toFixed(2) + (p === null ? '' : ' (' + (p > 0 ? '+' : '') + p.toFixed(2) + '%)') + (q.live ? ' 실시간' : ' ' + (q.badge || '마감')));
      }
      push('주간선물', fk.day && fk.day.ok ? fk.day : null);
      push('야간선물', fk.night && fk.night.ok ? fk.night : null);
      if (seg.length) {
        var txt = seg.join(' · ');
        if (afEl.textContent !== txt) afEl.textContent = txt;
        applied += 1;
      }
    }
    return applied;
  }

  function poll() {
    if (Date.now() - lastAt < 15000) return;
    lastAt = Date.now();
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    fetch(URL, ctrl ? { cache: 'no-store', signal: ctrl.signal } : { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (to) clearTimeout(to);
        var n = apply(body && body.futuresKis);
        try {
          console.log('[FuturesKis] ' + (body && body.generatedAtKst ? body.generatedAtKst : '') + ' 적용 ' + n + '칸',
            body && body.futuresKis ? { day: body.futuresKis.day && body.futuresKis.day.price, night: body.futuresKis.night && body.futuresKis.night.price } : null);
        } catch (e) { /* noop */ }
      })
      .catch(function () {
        if (to) clearTimeout(to);
        /* 실패 — 정적 스냅샷 값을 그대로 둔다 */
      });
  }

  function start() {
    poll();
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (document.hidden) return;
      poll();
    }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.FuturesKis = { poll: poll, apply: apply };
})();
