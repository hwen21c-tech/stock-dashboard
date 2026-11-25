/* ============================================================================
 * 🛡️ DART 실시간 공시 레이더 — 8번 탭 배너 · 상단 DART 레이더 모달 (/api/dart-live)
 * ----------------------------------------------------------------------------
 *  · /api/dart-live 가 ok:true 면 관심 종목·위험 키워드 공시를 실시간으로 그린다.
 *  · ok:false (DART_API_KEY_NOT_SET · 키 오류 · DART 장애) 면 화면을 지우지 않고
 *    '실시간 조회에 실패했다'는 사실만 그대로 밝힌다(옛 정적 스캔 문구는 쓰지 않는다).
 *  · 접수일·공시명·종목코드는 DART 응답 그대로 쓰고, 유형은 공시명 키워드 분류값이다.
 * ==========================================================================*/
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  var HAS_DOM = typeof document !== 'undefined';
  var URL_DART = '/api/dart-live';
  var POLL_MS = 180 * 1000; // 3분 (서버 캐시 90초)

  var state = { polling: false, ok: null, lastAt: null, lastBody: null, timer: null, reqId: 0 };

  /* -------------------------------- 유틸 -------------------------------- */

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nowHms() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  var KIND_STYLE = {
    risk: { bg: 'rgba(244,63,94,0.16)', color: '#fb7185', border: 'rgba(244,63,94,0.45)', icon: '🚨', text: '위험' },
    watch: { bg: 'rgba(251,191,36,0.16)', color: '#fbbf24', border: 'rgba(251,191,36,0.45)', icon: '⚠️', text: '주목' },
    info: { bg: 'rgba(56,189,248,0.14)', color: '#7dd3fc', border: 'rgba(56,189,248,0.4)', icon: '•', text: '일반' }
  };

  function kindBadge(it) {
    var st = KIND_STYLE[it.kind] || KIND_STYLE.info;
    return '<span style="font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px; background:' + st.bg +
      '; color:' + st.color + '; border:1px solid ' + st.border + '; white-space:nowrap;">' +
      st.icon + ' ' + esc(st.text) + (it.kindLabel && it.kind !== 'info' ? ' · ' + esc(it.kindLabel) : '') + '</span>';
  }

  function itemRow(it, opts) {
    opts = opts || {};
    var who = it.interestName
      ? esc(it.interestName) + ' <span style="font-size:9.5px; color:#64748b; font-weight:700;">' + esc(it.stockCode || '') + '</span>'
      : esc(it.corpName || '—');
    var meta = [];
    if (it.rceptDate) meta.push(it.rceptDate);
    if (it.filerName) meta.push(it.filerName);
    if (it.interestGroups && it.interestGroups.length) meta.push('감시군 ' + it.interestGroups.join('·'));
    var link = it.url
      ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()"' +
        ' style="font-size:10px; background:rgba(16,185,129,0.15); color:#6ee7b7; border:1px solid rgba(16,185,129,0.4);' +
        ' padding:2px 6px; border-radius:4px; text-decoration:none; font-weight:800; white-space:nowrap;">🔗 DART 원문</a>'
      : '';
    var reason = it.reportNm + ' · ' + (it.rceptDate || '—') + ' 접수' +
      (it.filerName ? ' · 제출인 ' + it.filerName : '') +
      (it.kind !== 'info' ? ' · 유형: ' + it.kindLabel + ' (공시명 키워드 자동 분류)' : '');
    var onclick = 'openDartDoc(\'' + esc(String(it.corpName || '').replace(/['"\\]/g, '')) + '\', \'' +
      esc(String(it.reportNm || '').replace(/['"\\]/g, '')) + '\', \'' + esc(it.url || '') + '\')';
    if (!opts.compact) {
      return '<div data-live="1" style="background:#131d2e; border:1px solid rgba(255,255,255,0.06); border-left:3px solid ' +
        (KIND_STYLE[it.kind] || KIND_STYLE.info).border + '; border-radius:6px; padding:7px 9px; margin-bottom:5px;">' +
        '<div style="display:flex; justify-content:space-between; gap:6px; align-items:flex-start;">' +
          '<div style="min-width:0;">' +
            '<div style="font-size:11.5px; font-weight:800; color:#fff;">' + who + '</div>' +
            '<div style="font-size:10.5px; color:#cbd5e1; margin-top:2px; line-height:1.4;">' + esc(it.reportNm) + '</div>' +
            '<div style="font-size:9.5px; color:#64748b; margin-top:2px;">' + esc(meta.join(' · ')) + '</div>' +
          '</div>' +
          '<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">' + kindBadge(it) + link + '</div>' +
        '</div>' +
        '<div style="display:none;">' + esc(reason) + '</div>' +
      '</div>';
    }
    return '<div data-live="1" onclick="' + esc(onclick) + '" title="' + esc(reason) + '"' +
      ' style="display:flex; justify-content:space-between; gap:6px; align-items:center; padding:5px 8px; margin-bottom:4px;' +
      ' background:#131d2e; border-radius:5px; border-left:2px solid ' + (KIND_STYLE[it.kind] || KIND_STYLE.info).border + '; cursor:pointer;">' +
      '<span style="font-size:10.5px; color:#e2e8f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
        '<strong>' + esc(it.interestName || it.corpName || '—') + '</strong> ' + esc(it.reportNm) + '</span>' +
      '<span style="font-size:9.5px; color:#94a3b8; white-space:nowrap;">' + esc(it.rceptDate || '') + '</span>' +
    '</div>';
  }

  /* ----------------------------- 화면 반영 ----------------------------- */

  // DART 는 한 번에 100건까지만 준다 — 유형별로 얼마나 봤는지 숨기지 않고 그대로 보여준다
  function coverageHtml(body) {
    var cov = (body && body.coverage) || [];
    if (!cov.length) return '';
    var rows = cov.map(function (c) {
      var done = c.complete === true;
      return '<div style="display:flex; justify-content:space-between; gap:8px; font-size:10px; color:' +
        (c.error ? '#fb7185' : done ? '#94a3b8' : '#fbbf24') + '; padding:1px 0;">' +
        '<span>' + esc(c.label) + (c.pages > 1 ? ' · ' + c.pages + 'p' : '') + '</span>' +
        '<span>' + (c.error ? '실패' : (c.fetched + ' / ' + (c.totalCount === null ? '?' : c.totalCount) + '건' + (done ? ' 전수' : ' 일부'))) + '</span></div>';
    }).join('');
    return '<div style="margin-top:6px; padding:6px 8px; background:rgba(0,0,0,0.25); border-radius:5px;">' +
      '<div style="font-size:10px; font-weight:800; color:#94a3b8; margin-bottom:2px;">📋 스캔 범위 (DART 100건/page 한도)</div>' +
      rows +
    '</div>';
  }

  function bannerEls() {
    return {
      title: document.getElementById('dartRadarTitle'),
      body: document.getElementById('dartRadarBody'),
      list: document.getElementById('dartLiveList'),
      banner: document.getElementById('dartRadarBanner')
    };
  }

  function modalEls() {
    return {
      host: document.getElementById('dartLiveSection'),
      verdict: document.getElementById('dartVerdict')
    };
  }

  function setStateNote(text, color) {    var el = bannerEls();
    if (!el.banner) return;
    var note = document.getElementById('dartKeyState');
    if (!note) {
      note = document.createElement('span');
      note.id = 'dartKeyState';
      note.style.cssText = 'font-size:10px; margin-left:6px; font-weight:800;';
      if (el.body && el.body.parentNode) el.body.parentNode.insertBefore(note, el.body.nextSibling);
      else el.banner.appendChild(note);
    }
    note.textContent = text;
    note.style.color = color || '#94a3b8';
    note.setAttribute('data-live', '1');
  }

  function applyFallback(body) {
    var reason = (body && body.reason) || 'UNKNOWN';
    var msg = reason === 'DART_API_KEY_NOT_SET'
      ? 'DART_API_KEY 미설정 — 실시간 조회 불가'
      : reason === 'DART_KEY_INVALID'
        ? 'DART 키 오류 — 실시간 조회 불가'
        : '실시간 DART 공시 조회 실패';
    setStateNote('[' + msg + ']', '#fbbf24');
    var b = bannerEls();
    if (b.body) {
      var btxt = '실시간 DART 공시 조회에 실패했습니다 — 잠시 후 다시 시도하세요. (' + esc(msg) + ')';
      if (b.body.innerHTML !== btxt) b.body.innerHTML = btxt;
      b.body.setAttribute('data-live', '1');
    }
    var m = modalEls();
    if (m.host) {
      var keyIssue = (reason === 'DART_API_KEY_NOT_SET' || reason === 'DART_KEY_INVALID');
      var html = '<div style="background:rgba(251,191,36,0.08); border:1px solid rgba(251,191,36,0.35); border-radius:8px;' +
        ' padding:9px 11px; margin-bottom:12px; font-size:11px; color:#fde68a; line-height:1.5;">' +
        '⚠️ 실시간 DART 공시 조회에 실패했습니다 — 잠시 후 다시 시도하세요.' +
        '<br><span style="color:#94a3b8; font-size:10px;">원인: ' + esc(body && body.message ? body.message : msg) +
        ' · 3분마다 자동으로 다시 조회합니다.</span>' +
        (keyIssue ? '<br><span style="color:#94a3b8; font-size:10px;">해결: Vercel 프로젝트 → Settings → Environment Variables → DART_API_KEY 추가 후 재배포.</span>' : '') +
        '</div>';
      if (m.host.getAttribute('data-sig') !== html) {
        m.host.innerHTML = html;
        m.host.setAttribute('data-sig', html);
      }
      m.host.setAttribute('data-live', '1');
    }
    state.ok = false;
  }

  function applyLive(body) {
    var items = body.items || [];
    var counts = body.counts || {};
    var stamp = nowHms();
    var b = bannerEls();

    if (b.title) {
      b.title.textContent = 'DART 전자공시 실시간 조회 (최근 ' + (body.lookbackDays || 7) + '일 · 관심 ' + (body.interestCount || 0) + '종목)';
    }
    if (b.body) {
      var riskTxt = counts.risk > 0
        ? '<strong style="color:#fb7185;">위험 공시 ' + counts.risk + '건</strong>'
        : '<strong style="color:#34d399;">위험 공시 0건(클린 🟢)</strong>';
      var scopeTxt = body.riskClassesComplete
        ? ''
        : ' <span style="font-size:9.5px; color:#fbbf24;">(위험유형 추가 페이지 미확인)</span>';
      b.body.innerHTML =
        '스캔 ' + (counts.fetched || 0) + '건 → 공시 ' + (counts.matched || 0) + '건 · ' + riskTxt +
        ' · 주목 ' + (counts.watch || 0) + '건 · 일반 ' + (counts.info || 0) + '건' + scopeTxt +
        ' <span style="font-size:10px; color:#6ee7b7; margin-left:6px;">[⚡ ' + stamp + ' DART OpenAPI 실시간]</span>' +
        (counts.interestRisk > 0 ? ' <span style="font-size:10px; color:#fbbf24;">— 관심종목 위험 공시는 아래 목록 확인</span>' : '');
    }
    setStateNote('', '#94a3b8');

    if (b.list) {
      var html = '';
      if (!items.length) {
        html = '<div style="font-size:10.5px; color:#94a3b8; padding:6px 8px;">최근 ' + (body.lookbackDays || 7) +
          '일 관심종목·주요 키워드 공시가 없습니다 (DART 조회 ' + stamp + ').</div>';
      } else {
        html = items.slice(0, 6).map(function (it) { return itemRow(it, { compact: true }); }).join('');
      }
      html += '<div style="font-size:9.5px; color:#64748b; margin-top:3px;">' +
        '※ DART OpenAPI list.json · 공시 유형은 공시명 키워드 자동 분류 · 전체 보기는 🚨 DART 공시 레이더에서</div>';
      if (b.list.getAttribute('data-sig') !== html) {
        b.list.innerHTML = html;
        b.list.setAttribute('data-sig', html);
      }
      b.list.setAttribute('data-live', '1');
    }

    var m = modalEls();
    if (m.host) {
      // 위험만 잔뜩 보이지 않도록 유형별로 나눠 보여준다(위험 6 · 주목 4 · 일반 2)
      var byKind = { risk: [], watch: [], info: [] };
      items.forEach(function (it) { (byKind[it.kind] || byKind.info).push(it); });
      var shown = byKind.risk.slice(0, 6).concat(byKind.watch.slice(0, 4), byKind.info.slice(0, 2));
      var rows = shown.length
        ? shown.map(function (it) { return itemRow(it, { compact: false }); }).join('')
        : '<div style="font-size:11px; color:#94a3b8; padding:8px;">최근 ' + (body.lookbackDays || 7) + '일 해당 공시 없음.</div>';
      var more = items.length > shown.length
        ? '<div style="font-size:10px; color:#94a3b8; margin-top:4px;">표시 ' + shown.length + '건 / 전체 ' + items.length + '건 — 나머지는 유형별로 순위상 뒤에 있습니다.</div>'
        : '';
      var mhtml =
        '<div style="background:rgba(16,185,129,0.07); border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:10px 12px; margin-bottom:14px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:7px; gap:8px; flex-wrap:wrap;">' +
          '<span style="font-size:12px; font-weight:800; color:#34d399;">📡 DART 실시간 공시 (최근 ' + (body.lookbackDays || 7) + '일 · 관심 ' + (body.interestCount || 0) + '종목)</span>' +
          '<span id="dartLiveStamp" style="font-size:10px; color:#6ee7b7; font-weight:800;">⚡ ' + stamp + ' 조회 · 스캔 ' + (counts.fetched || 0) + '건</span>' +
        '</div>' +
        rows +
        more +
        coverageHtml(body) +
        '<div style="font-size:10px; color:#64748b; margin-top:5px; line-height:1.5;">' +
          '※ DART OpenAPI list.json 응답만 표시합니다. 유형(위험/주목)은 공시명 키워드로 자동 분류한 것이고 본문 해석이 아닙니다.<br>' +
          '※ DART 는 한 번에 100건까지만 주므로 최신 공시 + 주요사항보고(B) + 지분공시(D) 를 나눿 스캔합니다. 관심종목을 corp_code 로 직접 조회한 것이 아니므로, 스캔 범위 밖 공시는 이 목록에 없을 수 있습니다.' +
        '</div>' +
        '</div>';
      if (m.host.getAttribute('data-sig') !== mhtml) {
        m.host.innerHTML = mhtml;
        m.host.setAttribute('data-sig', mhtml);
      }
      m.host.setAttribute('data-live', '1');
    }
    if (m.verdict) {
      var txt = counts.interestRisk > 0
        ? '🎯 실시간 DART 조회 결과: 관심 ' + (counts.interest || 0) + '건 중 위험 공시 ' + counts.interestRisk + '건 — 아래 실시간 목록 확인'
        : '🎯 실시간 DART 조회 결과: 스캔 범위 내 관심 종목 위험 공시 0건 (최근 ' + (body.lookbackDays || 7) + '일 · 스캔 ' + (counts.fetched || 0) + '건 중 관심 ' + (counts.interest || 0) + '건)';
      var cur = (m.verdict.textContent || '').replace(/\s+/g, ' ').trim();
      if (cur !== txt) m.verdict.textContent = txt;
      m.verdict.style.color = counts.interestRisk > 0 ? '#fb7185' : '#34d399';
      m.verdict.setAttribute('data-live', '1');
    }

    state.ok = true;
    state.lastAt = stamp;
    state.lastBody = body;
  }

  /* -------------------------------- 폴링 -------------------------------- */

  function poll(fresh) {
    if (!HAS_DOM || state.polling) return;
    state.polling = true;
    state.reqId += 1;
    var reqId = state.reqId;
    fetch(URL_DART + (fresh ? '?fresh=1' : ''), { cache: 'no-store' })
      .then(function (res) {
        return res.text().then(function (t) {
          var json = null;
          try { json = JSON.parse(t); } catch (e) { json = null; }
          return { status: res.status, body: json };
        });
      })
      .then(function (out) {
        state.polling = false;
        if (reqId !== state.reqId) return;
        var body = out.body;
        if (!body) { applyFallback({ reason: 'NO_RESPONSE' }); return; }
        if (body.ok === true) applyLive(body);
        else applyFallback(body);
      })
      .catch(function () {
        state.polling = false;
        applyFallback({ reason: 'NETWORK_ERROR' });
      });
  }

  /* ------------------------- 기존 모달 열기 훅 ------------------------- */

  function patchOpenModal() {
    if (typeof root.openDartModal !== 'function') return false;
    if (root.openDartModal.__dartPatched) return true;
    var orig = root.openDartModal;
    var patched = function () {
      try { poll(false); } catch (e) { /* noop */ }
      return orig.apply(this, arguments);
    };
    patched.__dartPatched = true;
    root.openDartModal = patched;
    return true;
  }

  // 공시 한 건 클릭 → DART 원문 새 탭
  root.openDartDoc = function (corpName, reportNm, url) {
    if (url) {
      try { window.open(url, '_blank', 'noopener'); return; } catch (e) { /* noop */ }
    }
    try { window.alert((corpName || '') + ' ' + (reportNm || '') + '\n\nDART 원문 링크가 없는 공시입니다.'); } catch (e) { /* noop */ }
  };

  function start() {
    if (!HAS_DOM) return;
    if (!patchOpenModal()) {
      var tries = 0;
      var t = setInterval(function () {
        tries += 1;
        if (patchOpenModal() || tries > 20) clearInterval(t);
      }, 250);
    }
    poll(false);
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () {
      if (document.hidden) return;
      poll(false);
    }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll(false);
    });
  }

  var api = {
    poll: poll,
    start: start,
    applyLive: applyLive,
    applyFallback: applyFallback,
    itemRow: itemRow,
    state: state,
    __kind: KIND_STYLE
  };
  root.DartLive = api;

  if (HAS_DOM) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})();
