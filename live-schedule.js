/* ============================================================================
 * 📅 증시 일정 — 오늘(KST) 기준 자동 정리 (11/16 추가)
 * ----------------------------------------------------------------------------
 *  1) D-DAY ~ D-3 임박 일정을 탭 최상단 '임박 핵심 일정' 영역에 고정한다.
 *     (D-0/D-1 은 크게, D-2/D-3 은 한 단계 작게 — 예: 11/18 엔비디아 실적, 11/19 수능일 10시 개장)
 *  2) 오늘보다 지난 일정은 '지난 일정 보기 (N건) ▸' 한 줄로 접어 둔다(기본 접힘).
 *  3) 날짜 계산은 전부 실행 시점의 KST 오늘 날짜로 한다 — 스캔 스크립트가 날짜를 못 박아도
 *     다음 날 자동으로 '지난 일정'으로 넘어간다.
 *  4) 값은 페이지에 이미 들어 있는 일정 데이터(window.calendarWeeksData)만 쓴다.
 *     없는 일정을 만들지 않는다(데이터가 없는 날은 그냥 비운다).
 * ==========================================================================*/
(function () {
  'use strict';

  var HAS_DOM = typeof document !== 'undefined';
  var HIGHLIGHT_DAYS = 3; // D-0 ~ D-3
  var state = { folds: {}, rendered: null, lastWeek: null };

  /* ------------------------------ 날짜 계산 ------------------------------ */

  function kstNow() {
    // 브라우저 시간대와 무관하게 KST(UTC+9) 기준 '오늘'을 구한다
    var now = new Date();
    var utc = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utc + 9 * 3600 * 1000);
  }

  function ymdLabel(m, d) {
    return m + '/' + (d < 10 ? '0' + d : d);
  }

  function parseMonthDay(text) {
    var m = String(text || '').match(/^(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (!m) return null;
    return { month: Number(m[1]), day: Number(m[2]) };
  }

  /** 오늘(KST) 대비 일수 차이 — 같은 해 기준, 연말/연초 넘어가면 보정 */
  function diffDays(month, day, today) {
    var y = today.getFullYear();
    var cand = new Date(y, month - 1, day);
    var base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var diff = Math.round((cand - base) / 86400000);
    if (diff < -200) {
      cand = new Date(y + 1, month - 1, day);
      diff = Math.round((cand - base) / 86400000);
    } else if (diff > 200) {
      cand = new Date(y - 1, month - 1, day);
      diff = Math.round((cand - base) / 86400000);
    }
    return diff;
  }

  function dayTag(diff) {
    if (diff === 0) return 'D-DAY';
    if (diff === 1) return 'D-1';
    if (diff === -1) return 'D+1';
    return diff > 0 ? 'D-' + diff : 'D+' + Math.abs(diff);
  }

  /* ------------------------------ 데이터 평탄화 ------------------------------ */

  function weekData() {
    var d = null;
    try {
      d = window.calendarWeeksData || null;
    } catch (e) {
      d = null;
    }
    return d && typeof d === 'object' ? d : null;
  }

  /** [{ week, label, month, day, diff, events[] }] — 페이지에 있는 일정만 */
  function flatDays(today) {
    var wd = weekData();
    if (!wd) return [];
    var out = [];
    Object.keys(wd)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .forEach(function (wk) {
        var w = wd[wk] || {};
        (w.days || []).forEach(function (d) {
          var md = parseMonthDay(d && d.date);
          if (!md) return;
          out.push({
            week: wk,
            label: String(d.date || '').replace(/\s*오늘\s*⭐?/, '').trim(),
            raw: String(d.date || ''),
            month: md.month,
            day: md.day,
            diff: diffDays(md.month, md.day, today),
            events: Array.isArray(d.events) ? d.events.slice() : [],
          });
        });
      });
    return out;
  }

  function todayWeek(today) {
    var days = flatDays(today);
    for (var i = 0; i < days.length; i += 1) {
      if (days[i].diff === 0) return days[i].week;
    }
    var next = days.filter(function (d) { return d.diff > 0; })[0];
    if (next) return next.week;
    return 2;
  }

  /* ------------------------------ 스타일 ------------------------------ */

  function injectCss() {
    if (!HAS_DOM || document.getElementById('schedCss')) return;
    var css = ''
      + '.sched-now{border:1px solid rgba(56,189,248,.45);border-radius:10px;background:linear-gradient(135deg,rgba(15,23,42,.96),rgba(30,41,59,.9));padding:11px 13px;margin:0 0 14px;}'
      + '.sched-now-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:7px;}'
      + '.sched-now-head b{font-size:12.5px;color:#7dd3fc;font-weight:900;}'
      + '.sched-now-head span{font-size:10px;color:#94a3b8;font-weight:700;}'
      + '.sched-now-row{display:flex;gap:7px;align-items:flex-start;padding:5px 0;border-top:1px dashed rgba(148,163,184,.18);}'
      + '.sched-now-row:first-of-type{border-top:0;}'
      + '.sched-d{flex:0 0 auto;min-width:44px;text-align:center;font-size:10px;font-weight:900;padding:2px 6px;border-radius:4px;white-space:nowrap;}'
      + '.sched-d.d0{background:#dc2626;color:#fff;}'
      + '.sched-d.d1{background:#b45309;color:#fef3c7;}'
      + '.sched-d.d2,.sched-d.d3{background:rgba(56,189,248,.16);color:#7dd3fc;border:1px solid rgba(56,189,248,.4);}'
      + '.sched-when{font-size:10px;color:#94a3b8;font-weight:800;white-space:nowrap;}'
      + '.sched-evs{font-size:11px;color:#e2e8f0;line-height:1.5;min-width:0;flex:1 1 200px;word-break:break-word;}'
      + '.sched-evs .sched-ev{display:block;padding:1px 0;}'
      + '.sched-past{margin:8px 0 2px;}'
      + '.sched-past-btn{width:100%;display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:7px;cursor:pointer;'
      + 'background:rgba(148,163,184,.10);border:1px solid rgba(148,163,184,.3);color:#cbd5e1;font-size:11px;font-weight:800;text-align:left;}'
      + '.sched-past-btn .sched-past-n{margin-left:auto;font-size:9.5px;color:#94a3b8;font-weight:700;}'
      + '.sched-past-body{display:none;}'
      + '.sched-past-body.open{display:block;}'
      + '.wz-day-card.past{opacity:.62;}'
      + '.cal-cell.sched-only-past{opacity:.48;}';
    var st = document.createElement('style');
    st.id = 'schedCss';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function stripTags(html) {
    return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  /* ------------------------------ 임박 일정 박스 ------------------------------ */

  function highlightHtml(today) {
    var days = flatDays(today);
    var near = days
      .filter(function (d) { return d.diff >= 0 && d.diff <= HIGHLIGHT_DAYS && d.events.length; })
      .sort(function (a, b) { return a.diff - b.diff; });
    if (!near.length) {
      var nxt = days.filter(function (d) { return d.diff > 0 && d.events.length; })[0];
      return '<div class="sched-now">' +
        '<div class="sched-now-head"><b>⭐ 임박 핵심 일정</b><span>' +
        esc(ymdLabel(today.getMonth() + 1, today.getDate()) + ' 기준 · 오늘~D-3') + '</span></div>' +
        '<div class="sched-evs" style="color:#94a3b8;">' +
        (nxt ? '오늘~D-3 안에 등록된 일정이 없습니다. 다음 일정은 ' + esc(nxt.label) + '입니다.' : '일정 데이터가 없습니다.') +
        '</div></div>';
    }
    var rows = near.map(function (d) {
      var evs = d.events.map(function (ev) {
        return '<span class="sched-ev">· ' + ev + '</span>';
      }).join('');
      return '<div class="sched-now-row">' +
        '<span class="sched-d d' + Math.min(d.diff, 3) + '">' + esc(dayTag(d.diff)) + '</span>' +
        '<span class="sched-when">' + esc(d.label) + '</span>' +
        '<span class="sched-evs">' + evs + '</span>' +
        '</div>';
    }).join('');
    return '<div class="sched-now">' +
      '<div class="sched-now-head"><b>⭐ 임박 핵심 일정 (D-DAY ~ D-3)</b>' +
      '<span>' + esc(ymdLabel(today.getMonth() + 1, today.getDate()) + ' 기준 자동 고정 · 오늘 이후로 자동 이동') + '</span></div>' +
      rows +
      '</div>';
  }

  /* ------------------------------ 주간 확대 뷰 재작성 ------------------------------ */

  function dayCardHtml(d) {
    var evs = d.events.map(function (ev) {
      return '<div class="wz-event-item">' + ev + '</div>';
    }).join('');
    return '<div class="wz-day-card' + (d.diff < 0 ? ' past' : '') + '">' +
      '<div class="wz-day-header">' +
      '<span>📅 ' + esc(d.label) + (d.diff === 0 ? ' · 오늘 ⭐' : ' <span style="color:#7dd3fc;font-weight:800;">' + esc(dayTag(d.diff)) + '</span>') + '</span>' +
      '<span style="font-size:10px; color:#38bdf8;">' + (d.diff < 0 ? '지난 일정' : '주요 이벤트') + '</span>' +
      '</div>' + evs + '</div>';
  }

  function renderWeek(weekNum, opts) {
    if (!HAS_DOM) return 0;
    var today = kstNow();
    var wd = weekData();
    if (!wd) return 0;
    var wk = weekNum || todayWeek(today);
    var data = wd[wk] || wd[String(wk)];
    if (!data) return 0;
    state.lastWeek = wk;

    var days = flatDays(today).filter(function (d) { return d.week === wk; });
    var past = days.filter(function (d) { return d.diff < 0; });
    var nowFuture = days.filter(function (d) { return d.diff >= 0; });

    var pastCount = past.reduce(function (n, d) { return n + d.events.length; }, 0);
    var openPast = Boolean(state.folds['week' + wk]);

    var html = '';
    // 오늘~미래 일정 먼저
    html += nowFuture.map(dayCardHtml).join('');
    if (!nowFuture.length) {
      html += '<div class="wz-day-card"><div class="wz-day-header"><span>📅 ' +
        (pastCount > 0 ? '이 주차는 모두 지난 일정입니다' : '이번 주 남은 일정 없음') + '</span>' +
        '<span style="font-size:10px;color:#94a3b8;">' + (pastCount > 0 ? '아래 지난 일정 보기에서 펼쳐 볼 수 있습니다' : '다음 주차를 눌러 확인하세요') + '</span></div></div>';
    }
    // 지난 일정은 접어서 아래에
    if (pastCount > 0) {
      html += '<div class="sched-past">' +
        '<button type="button" class="sched-past-btn" data-sched-past="' + esc(String(wk)) + '">' +
        '<span>' + (openPast ? '▾' : '▸') + '</span>' +
        '<span>지난 일정 보기</span>' +
        '<span class="sched-past-n">(' + pastCount + '건 · 기본 접힘)</span>' +
        '</button>' +
        '<div class="sched-past-body' + (openPast ? ' open' : '') + '" data-sched-past-body="' + esc(String(wk)) + '">' +
        past.map(dayCardHtml).join('') +
        '</div></div>';
    }

    var titleEl = document.getElementById('wzTitle');
    if (titleEl) {
      var t = String(data.title || '');
      if (t.indexOf('지난 일정') < 0) t = t.replace('주요 증시 일정', '주요 증시 일정');
      titleEl.textContent = t;
    }
    var host = document.getElementById('wzContent');
    if (host) {
      host.innerHTML = html;
      host.setAttribute('data-sched', '1');
    }
    state.rendered = wk;
    return days.length;
  }

  /* ------------------------------ 월간 달력 오늘 표시 ------------------------------ */

  function paintTodayCell(today) {
    if (!HAS_DOM) return 0;
    var grid = document.getElementById('calGrid');
    if (!grid) return 0;
    var titleEl = document.getElementById('calTitle');
    var title = titleEl ? titleEl.textContent || '' : '';
    var tm = title.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
    if (!tm) return 0;
    var year = Number(tm[1]);
    var month = Number(tm[2]);
    var cells = Array.prototype.slice.call(grid.querySelectorAll('.cal-cell'));
    var target = null;
    cells.forEach(function (c) {
      c.classList.remove('today', 'selected');
      var numEl = c.querySelector('.cal-date-num');
      if (!numEl) return;
      var n = Number((numEl.textContent || '').trim());
      if (!n) return;
      var other = c.classList.contains('other-month');
      var m = other ? (month === 12 ? 1 : month + 1) : month;
      var y = other && month === 12 ? year + 1 : year;
      var diff = Math.round((new Date(y, m - 1, n) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
      if (other && month === 1) {
        // 1월 달력의 앞쪽 '다른 달' 칸은 전년 12월
        var pm = 12;
        var py = year - 1;
        diff = Math.round((new Date(py, pm - 1, n) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
      }
      if (diff < 0) c.classList.add('sched-only-past');
      else c.classList.remove('sched-only-past');
      if (diff === 0) target = c;
    });
    if (target) {
      target.classList.add('today', 'selected');
      target.id = 'calCellToday';
      return 1;
    }
    return 0;
  }

  /* ------------------------------ 이벤트 ------------------------------ */

  function bind() {
    if (!HAS_DOM || document.body.getAttribute('data-sched-bind') === '1') return;
    document.body.setAttribute('data-sched-bind', '1');
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-sched-past]') : null;
      if (!btn) return;
      var wk = btn.getAttribute('data-sched-past');
      var body = document.querySelector('[data-sched-past-body="' + wk + '"]');
      var open = !state.folds['week' + wk];
      state.folds['week' + wk] = open;
      if (body) body.classList.toggle('open', open);
      var chev = btn.querySelector('span');
      if (chev) chev.textContent = open ? '▾' : '▸';
    });
  }

  function mountHighlight(today) {
    if (!HAS_DOM) return 0;
    var tab = document.getElementById('tabCalendar');
    if (!tab) return 0;
    var host = document.getElementById('schedNowHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'schedNowHost';
      tab.insertBefore(host, tab.firstChild);
    }
    var html = highlightHtml(today);
    if (host.getAttribute('data-sig') !== html) {
      host.innerHTML = html;
      host.setAttribute('data-sig', html);
    }
    host.setAttribute('data-live', '1');
    return 1;
  }

  function renderAll() {
    if (!HAS_DOM) return 0;
    var today = kstNow();
    injectCss();
    bind();
    var a = mountHighlight(today);
    paintTodayCell(today);
    // 원본 selectCalWeek 을 덮어쓴다(날짜 칸 클릭 · 탭 진입 모두 우리 렌더로)
    if (window.selectCalWeek && !window.selectCalWeek.__schedPatched) {
      var patched = function (weekNum) { return renderWeek(weekNum); };
      patched.__schedPatched = true;
      window.selectCalWeek = patched;
    }
    renderWeek(todayWeek(today));
    return a;
  }

  if (HAS_DOM) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(renderAll, 60); });
    } else {
      setTimeout(renderAll, 60);
    }
    // 다른 스크립트(자동 갱신·핫스왑)가 달력을 다시 그려도 오늘 기준 정리를 되돌린다
    setInterval(function () {
      if (document.hidden) return;
      var tab = document.getElementById('tabCalendar');
      if (!tab) return;
      var host = document.getElementById('schedNowHost');
      if (host && !host.getAttribute('data-live')) renderAll();
    }, 60000);
  }

  // 테스트(test_local.mjs)에서 순수 계산만 검증할 수 있게 노출
  window.ScheduleLive = {
    flatDays: flatDays,
    diffDays: diffDays,
    dayTag: dayTag,
    highlightHtml: highlightHtml,
    renderWeek: renderWeek,
    renderAll: renderAll,
    kstNow: kstNow,
    state: state
  };
})();
