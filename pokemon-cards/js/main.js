/* main.js — 부트스트랩 */
(function () {
  'use strict';
  const P = window.PKC, D = window.PKData, U = window.PKUI, A = window.PKCAudio;
  const $ = P.$;

  async function boot() {
    P.load();
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
    $('#soundBtn').addEventListener('click', () => {
      const s = P.state.settings;
      if (!s.sfx) { s.sfx = true; s.bgm = true; }
      else if (s.bgm) { s.bgm = false; }
      else { s.sfx = false; }
      A.unlock(); A.applySettings(); P.save();
      U.refreshHeader();
      P.toast(s.sfx ? (s.bgm ? '🔊 소리 켜짐 (BGM 포함)' : '🔈 효과음만') : '🔇 음소거');
    });

    U.checkTrophies(P.state.active, true);
    await U.renderHome();
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
