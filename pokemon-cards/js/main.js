/* main.js — 부트스트랩 */
(function () {
  'use strict';
  const P = window.PKC, D = window.PKData, U = window.PKUI, A = window.PKCAudio, C = window.PKCCloud;
  const $ = P.$;

  const TABS = ['home', 'shop', 'dex', 'battle', 'more'];
  const PROF_IDS = ['arin', 'jian', 'guest'];
  let wantTab = '';

  /* ?profile=arin|jian|guest&tab=shop|dex|battle — 배틀 월드의 🪙/🃏 버튼이 이 주소로 들어온다 */
  function applyUrl() {
    let q = null;
    try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
    if (!q) return;
    const pf = String(q.get('profile') || '').toLowerCase();
    if (PROF_IDS.indexOf(pf) >= 0) P.state.active = pf;
    const tab = String(q.get('tab') || '').toLowerCase();
    if (TABS.indexOf(tab) >= 0) wantTab = tab;
    p.hint = q.get('from') || '';
  }
  const p = { hint: '' };

  function activeTab() {
    const b = document.querySelector('.tab.active');
    return b ? b.dataset.tab : 'home';
  }
  /* 클라우드에서 코인·카드가 새로 들어오면 지금 보고 있는 화면만 다시 그린다.
     (배틀 도중에 화면이 리셋되지 않도록 배틀 탭은 코인 표시만 갱신) */
  function refreshScreen() {
    const t = activeTab();
    if (t === 'battle') { U.refreshHeader(); return; }
    U.go(t);
  }

  /* 화면을 다시 그리기 전에 스크롤 위치를 붙잡아 두고 되돌린다.
     (다시 그리면 브라우저가 맨 위로 올려 버린다 — "동기화중 뜨면 새로고침처럼 위로 올라가서")
     이미지가 늦게 붙어 높이가 바뀌는 경우까지 따라가도록 세 번 되돌린다. */
  function holdScroll(fn) {
    const y = window.scrollY || window.pageYOffset || 0;
    const inner = P.$$('.open-stage, .modal-body')
      .filter(e => e.scrollTop > 0)
      .map(e => [e, e.scrollTop]);
    fn();
    const put = () => {
      try { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, y); }
      inner.forEach(pair => { try { pair[0].scrollTop = pair[1]; } catch (e) { /* */ } });
    };
    put();
    requestAnimationFrame(put);
    setTimeout(put, 140);
  }

  function paintCloud(st) {
    const chip = $('#cloudChip');
    const txt = $('#cloudTxt');
    if (!chip || !txt) return;
    chip.dataset.s = st.state || 'idle';
    let label = '가족 동기화';
    if (st.state === 'syncing') label = '동기화 중…';
    else if (st.state === 'ok') label = st.lastAt ? '가족 동기화 · 방금' : '가족 동기화';
    else if (st.state === 'error') label = st.msg || '오프라인';
    txt.textContent = label;
    chip.setAttribute('title', '가족 코드 ' + ((C && C.cfg().code) || '0623') + ' · ' + label);
  }

  async function boot() {
    P.load();
    applyUrl();
    U.refreshHeader();

    // 화면 골격 먼저
    $('#screen-home').innerHTML = '<div class="loading"><div class="spinner"></div>카드를 준비하고 있어요…</div>';

    try {
      await D.loadIndex();
    } catch (e) {
      $('#screen-home').innerHTML = '<div class="empty">데이터를 불러오지 못했어요.<br>인터넷 연결을 확인하고 새로고침해 주세요.</div>';
      return;
    }

    P.$$('.tab').forEach(b => b.addEventListener('click', () => {
      A.unlock(); A.sfx.tap();
      U.go(b.dataset.tab);
    }));
    $('#brandBtn').addEventListener('click', () => U.go('home'));
    $('#pfChip').addEventListener('click', () => U.go('more'));
    $('#coinChip').addEventListener('click', () => U.go('shop'));

    /* 📳 진동 켜기/끄기 — 기기마다 따로 기억한다(클라우드로 보내지 않음) */
    const vb = $('#vibBtn');
    if (vb) vb.addEventListener('click', () => {
      const on = P.setVib(!P.vibOn());
      A.unlock();
      U.refreshHeader();
      if (on) { try { A.sfx.tap(); } catch (e) { /* */ } P.haptic(14); }
      P.toast(on ? '📳 진동 켜짐' : '📴 진동 꺼짐');
    });

    $('#soundBtn').addEventListener('click', () => {
      const s = P.state.settings;
      if (!s.sfx) { s.sfx = true; s.bgm = true; }
      else if (s.bgm) { s.bgm = false; }
      else { s.sfx = false; }
      A.unlock(); A.applySettings(); P.save();
      U.refreshHeader();
      P.toast(s.sfx ? (s.bgm ? '🔊 소리 켜짐 (BGM 포함)' : '🔈 효과음만') : '🔇 음소거');
    });

    /* ☁️ 가족 클라우드 — 첫 동기화를 기다렸다가 그린다(최대 2.5초). 실패해도 그대로 쓴다. */
    if (C) {
      C.onState(paintCloud);
      paintCloud(C.state);
      try {
        await Promise.race([
          C.boot(),
          new Promise(r => setTimeout(r, 2500))
        ]);
      } catch (e) { /* 오프라인이어도 로컬로 동작 */ }
      /* 다른 기기의 변경이 실제로 내려왔을 때만 온다 — 변경이 없으면 cloud.js 가 부르지 않는다.
         다시 그리면서 맨 위로 올라가지 않도록 스크롤 위치를 붙잡고 그린다. */
      document.addEventListener('pkccloud:applied', () => {
        holdScroll(() => { U.refreshHeader(); refreshScreen(); });
      });
    }

    U.checkTrophies(P.state.active, true);
    await U.renderHome();
    if (wantTab && wantTab !== 'home') U.go(wantTab);
    else if (p.hint === 'shop') U.go('shop');
    // 최애 카드 데이터 미리 확보
    P.me().fav.forEach(id => window.PKDex.ensureCard(id).then(c => { if (c) U.renderHome(); }));

    // 첫 사용 안내
    if (!localStorage.getItem('pkc.welcomed')) {
      setTimeout(() => {
        localStorage.setItem('pkc.welcomed', '1');
        P.modal({
          title: '👋 환영해요!',
          body: '<p style="font-size:14px;line-height:1.75;margin:0">' +
            '아린 · 지안 · 게스트 모두 <b>100코인</b>으로 시작해요.<br>' +
            '카드팩을 뜯어 <b>도감</b>을 채우고, 모은 카드로 <b>★12 코스트 배틀</b>을 즐겨 보세요!<br>' +
            '<span class="muted">배틀 월드에서 게임 <b>1판마다 +10코인</b>이 여기로 바로 들어와요.</span><br>' +
            '<span class="muted">이제 <b>썬&문 · XY · BW</b> 클래식 팩까지 모두 뜯을 수 있어요.</span><br><br>' +
            '<span class="muted">위쪽 사람 아이콘을 누르면 프로필을 바꿀 수 있어요. 아빠는 <b>내정보 → 아빠 관리자</b>에서 코인·티켓·카드를 선물할 수 있어요. (PIN 0623)</span></p>',
          buttons: [{ label: '좋아요!', kind: 'gold' }]
        });
      }, 600);
    }

    // 서비스워커
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
