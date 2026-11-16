/*!
 * content-engine.js — 올인원 콘텐츠 스튜디오 생성 엔진 (v1.1 · 에디토리얼)
 * ------------------------------------------------------------------
 * 브라우저(window.CS_ENGINE)와 서버(api/content-studio.js 의 require)가
 * 같은 파일을 쓰는 UMD 모듈이다. (Vercel 은 public/ 도 함수 번들에 포함한다)
 *
 * 원칙 — "없는 사실은 만들지 않는다"
 *  - 주식·특가 모드: /api/stock-live · /api/tabs-live · deals.html 의 실측 데이터만 문장 재료로 쓴다.
 *  - 유튜브 모드: 실제 자막 문장에서 뽑은 문장만 쓴다(추출 요약). 자막이 없으면 요약을 지어내지 않는다.
 *  - 자유 주제 모드: 사용자가 넣은 키워드·메모 문장만 쓴다. 빈 자리는 [ ] 로 남긴다.
 *  - LLM API 키 없이 도는 규칙 기반 엔진이므로, 문장은 '실데이터 + 템플릿 조합'이다.
 *
 * v1.1 에서 달라진 것
 *  1) 제목 3안 — 궁금증/반전형 · 숫자/팩트형 · 핵심 요약형 (blog.titleSet)
 *  2) 글 호흡 — 도입 훅(hook) → 핵심 표(table) → 실전 포인트(points) → 마무리 한 줄(closing)
 *  3) 네이버·티스토리 붙여넣기용 리치 HTML(contentToHtml) + 본문 되편집(parseBlogMarkdown)
 *  4) 쇼츠 대본 구조화(hook / cuts / cta + 자막·나레이션) + make_shorts_mp4.py 스펙 JSON(shortsSpec)
 *  ※ 수치·종목·가격은 여전히 실측값만 쓴다. 표에 들어가는 '해석' 열은 사실이 아니라 읽는 법이다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CS_ENGINE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.1.0';

  /* ============================================================
   * 0. 공통 유틸
   * ============================================================ */
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  function num(n, digits) {
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '-';
    const d = digits === undefined ? 2 : digits;
    return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: d });
  }

  function pct(n, digits) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
    const v = Number(n);
    const d = digits === undefined ? 2 : digits;
    return (v > 0 ? '+' : '') + v.toFixed(d) + '%';
  }

  function arrow(n) {
    const v = Number(n);
    if (Number.isNaN(v)) return '·';
    return v > 0 ? '▲' : (v < 0 ? '▼' : '–');
  }

  function won(n) {
    if (n === null || n === undefined || n === '') return '-';
    return num(n, 0) + '원';
  }

  function clamp(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (!n || t.length <= n) return t;
    return t.slice(0, n - 1).trim() + '…';
  }

  function has(v) { return v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v)); }

  /** 조사 선택 — 마지막 글자의 받침 여부 (원/은, 가/이 …) */
  function josa(word, withBatchim, noBatchim) {
    const s = String(word == null ? '' : word).trim();
    if (!s) return noBatchim;
    const c = s.charCodeAt(s.length - 1);
    if (c >= 0xAC00 && c <= 0xD7A3) return ((c - 0xAC00) % 28) ? withBatchim : noBatchim;
    return noBatchim;
  }

  /** ' · ' 로 이어진 긴 문장을 항목 단위로 끊어 max 자 안에서 자른다 */
  function oneLine(text, max) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const lim = max || 30;
    if (t.length <= lim) return t;
    const parts = t.split(' · ');
    if (parts.length > 1) {
      let out = '';
      for (let i = 0; i < parts.length; i++) {
        const next = out ? out + ' · ' + parts[i] : parts[i];
        if (next.length > lim && out) break;
        out = next;
      }
      if (out) return out;
    }
    return clamp(t, lim);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function kstNow(now) {
    const base = now ? new Date(now) : new Date();
    const kst = new Date(base.getTime() + 9 * 3600 * 1000);
    return {
      date: kst,
      y: kst.getUTCFullYear(),
      m: kst.getUTCMonth() + 1,
      d: kst.getUTCDate(),
      hh: kst.getUTCHours(),
      mm: kst.getUTCMinutes(),
      dow: kst.getUTCDay(),
      label: `${kst.getUTCFullYear()}.${pad2(kst.getUTCMonth() + 1)}.${pad2(kst.getUTCDate())}(${WEEKDAYS[kst.getUTCDay()]})`,
      short: `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`,
      time: `${pad2(kst.getUTCHours())}:${pad2(kst.getUTCMinutes())}`
    };
  }

  function dedupe(arr) {
    const seen = new Set();
    const out = [];
    arr.forEach(function (v) {
      const k = String(v).trim();
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(k);
    });
    return out;
  }

  /* ============================================================
   * 1. 한국어 문장·단어 처리
   * ============================================================ */
  const STOP = new Set(('그 저 것 수 등 및 그리고 그래서 그러나 하지만 그런데 그러면 이렇게 저렇게 그렇게 ' +
    '우리 너희 여러분 이 그 저 그것 이것 저것 있다 없다 합니다 입니다 됩니다 하는 있는 없는 위한 통해 대해 ' +
    '때 경우 정도 부분 생각 얘기 이야기 지금 오늘 어제 내일 정말 진짜 너무 아주 매우 계속 다시 먼저 사실 ' +
    '근데 뭐 좀 잘 안 못 더 덜 왜 어떤 무슨 누가 언제 어디 어떻게 왜냐하면 따라서 또한 즉 예를 들어 ' +
    '합니다입니다 그리고 또 혹은 또는 하지만 그래도 그거 저거 여기 저기 요즘 최근 현재 바로 함께 같이 ' +
    '보다 이제 그게 저게 이거 그거 사실상 약간 조금 많이 가장 첫 번째 두 번째 세 번째 마지막 ' +
    '하는데 하니까 하면 하고 해서 했다 한다 됐다 되는 되고 되어 이라 이라는 라는 이라는 걸 거를 게 ' +
    '에서 으로 로써 부터 까지 만큼 보다 처럼 이랑 랑 과 와 은 는 이 가 을 를 의 에 도 만 ' +
    '만한 위한 통한 대한 관한 많은 적은 새로운 다른 같은 이런 그런 저런 좋은 좋다 한다 했다 된다 ' +
    '하면 하기 위해 통해 대하 거의 아직 이미 또한 점 것들 분들').split(/\s+/));

  function normalizeText(raw) {
    return String(raw || '')
      .replace(/\r\n?/g, '\n')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/\[(음악|박수|웃음|웃음소리|음향|효과음|자막|광고|BGM|Music)\]/gi, ' ')
      .replace(/\((음악|박수|웃음|웃음소리|음향|효과음|자막|광고|BGM|Music)\)/gi, ' ')
      .replace(/[ \t\u00a0]+/g, ' ')
      .trim();
  }

  /** "00:01:23.400 --> 00:01:25.000" 같은 타임코드 줄 추출 */
  function parseTimecode(line) {
    const src = String(line);
    // 1) hh:mm:ss,mmm  /  mm:ss.mmm  /  hh:mm:ss.mmm
    let m = src.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?[.,](\d{1,3})/);
    if (m) {
      const h = Number(m[1]), mi = Number(m[2]);
      if (m[3] !== undefined) return h * 3600 + mi * 60 + Number(m[3]) + Number('0.' + m[4]);
      return h * 60 + mi + Number('0.' + m[4]);
    }
    // 2) 소수점 없는 mm:ss / hh:mm:ss  ("00:12 문장" 형태)
    m = src.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s|$)/);
    if (m) {
      return m[3] === undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    return null;
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h > 0) return `${h}:${pad2(m)}:${pad2(ss)}`;
    return `${pad2(m)}:${pad2(ss)}`;
  }

  /** SRT / VTT / YouTube 스크립트(타임스탬프+문장) 모두 받아 세그먼트로 */
  function parseTranscript(raw) {
    const src = String(raw || '').replace(/\r\n?/g, '\n');
    const segments = [];
    if (!src.trim()) return { segments: segments, text: '' };

    // VTT/SRT 블록 형태
    const blocks = src.split(/\n{2,}/);
    let usedCue = false;
    blocks.forEach(function (block) {
      const lines = block.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return;
      let ti = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/-->/.test(lines[i])) { ti = i; break; }
      }
      if (ti === -1) return;
      const start = parseTimecode(lines[ti]);
      const body = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, ' ').trim();
      if (!body) return;
      usedCue = true;
      segments.push({ t: start === null ? null : start, text: body });
    });

    // YouTube 스크립트 패널 복사본: "0:12\n문장" 또는 "0:12 문장"
    if (!usedCue) {
      src.split('\n').forEach(function (line) {
        const t = line.trim();
        if (!t) return;
        const m = t.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/);
        if (m && m[2]) segments.push({ t: parseTimecode(m[1]), text: m[2] });
        else segments.push({ t: null, text: t });
      });
    }

    // 한 줄로 붙어 들어온 경우(세그먼트 없음) → 통짜 문장으로
    const text = segments.map(function (s) { return s.text; }).join(' ').replace(/\s+/g, ' ').trim();
    return { segments: segments, text: text };
  }

  function tokenize(text) {
    const out = [];
    const src = String(text || '');
    const re = /[가-힣]{2,}|[A-Za-z]{2,}|\d+(?:[.,]\d+)?%?/g;
    let m;
    while ((m = re.exec(src))) {
      let w = m[0];
      if (/^\d/.test(w)) { out.push(w); continue; }
      if (STOP.has(w)) continue;
      // 한 글자 조사 제거(간단 처리): '코스피는' → '코스피'
      w = w.replace(/(은|는|이|가|을|를|의|에|에서|으로|로|와|과|도|만|보다|처럼|께서|에게|에는|에도|부터|까지|이라|라는|라고|라고는)$/, '');
      if (w.length < 2 || STOP.has(w)) continue;
      // 서술어 어미로 끝나는 활용형은 키워드에서 뺀다('마감했습니다' → 제외)
      if (/(습니다|합니다|입니다|됩니다|했다|한다|된다|이다|였다|이며|하며|하다|되다)$/.test(w)) continue;
      out.push(w);
    }
    return out;
  }

  function keywordRank(textOrTokens, limit) {
    const tokens = Array.isArray(textOrTokens) ? textOrTokens : tokenize(textOrTokens);
    const freq = Object.create(null);
    tokens.forEach(function (w) {
      const key = String(w);
      freq[key] = (freq[key] || 0) + 1;
    });
    return Object.keys(freq)
      .map(function (w) { return { w: w, n: freq[w] }; })
      .filter(function (x) { return x.w.length >= 2; })
      .sort(function (a, b) { return b.n - a.n || b.w.length - a.w.length; })
      .slice(0, limit || 12);
  }

  function splitSentences(text) {
    const src = normalizeText(text);
    const parts = src.split(/(?<=[.!?。！？])\s+|\n+/);
    const out = [];
    parts.forEach(function (p) {
      let t = p.trim();
      if (!t) return;
      // 한국어 어미로 문장 나누기(마침표 없는 자막 대응)
      const chunks = t.split(/(?<=다\.|요\.|죠\.|까\?|니다\.|세요\.|어요\.)\s*/);
      chunks.forEach(function (c) {
        const s = c.trim();
        if (s.length < 6) return;
        // (음악) (웃음) 같은 효과음 큐는 요약 재료에서 제외
        if (/^[\(\[][^\)\]]{0,40}[\)\]]$/.test(s)) return;
        if (/^[^\w가-힣]*$/.test(s)) return;
        out.push(s);
      });
    });
    return out;
  }

  const CUE_STRONG = /(핵심|중요|포인트|결론|정리하면|요약|반드시|꼭|주의|위험|기회|때문에|이유는|첫째|둘째|셋째|결국|사실은)/;
  const CUE_WEAK = /^(그래서|그런데|그러면|그리고|또|자|이제|여기서|근데)\s/;

  /** 추출 요약: 문장 점수 → 중복 제거 → 시간순 상위 N개 */
  function summarizeText(input, options) {
    // summarizeText({text, segments, maxLines}) 또는 summarizeText(text, {maxLines}) 둘 다 지원
    const opts = (typeof input === 'string')
      ? Object.assign({ text: input }, options || {})
      : Object.assign({}, input || {}, options || {});
    const maxLines = opts.maxLines || 5;
    let sentences = [];

    if (opts.segments && opts.segments.length) {
      const segs = opts.segments.filter(function (s) { return s && s.text; });
      const total = segs.length || 1;
      segs.forEach(function (s, i) {
        splitSentences(s.text).forEach(function (sent) {
          sentences.push({ text: sent, t: s.t, pos: i / total, order: sentences.length });
        });
      });
    } else {
      const list = splitSentences(opts.text || '');
      list.forEach(function (sent, i) {
        sentences.push({ text: sent, t: null, pos: list.length ? i / list.length : 0 });
      });
    }

    if (!sentences.length) return [];

    const tokens = [];
    sentences.forEach(function (s) { tokens.push.apply(tokens, tokenize(s.text)); });
    const freq = Object.create(null);
    tokens.forEach(function (w) { freq[w] = (freq[w] || 0) + 1; });
    const maxFreq = Math.max.apply(null, Object.keys(freq).map(function (k) { return freq[k]; }).concat([1]));

    sentences.forEach(function (s) {
      const words = tokenize(s.text);
      let score = 0;
      words.forEach(function (w) { score += (freq[w] || 0) / maxFreq; });
      score = score / Math.sqrt(Math.max(4, words.length));
      // 숫자·퍼센트·금액: 사실 밀도가 높은 문장
      const numbers = (s.text.match(/\d+(?:[.,]\d+)?\s*(?:%|퍼센트|억|조|만|원|배|개|명|위|년|월|일|분|초)?/g) || []).length;
      score += Math.min(1.2, numbers * 0.16);
      if (CUE_STRONG.test(s.text)) score += 0.35;
      if (CUE_WEAK.test(s.text)) score -= 0.1;
      // 위치: 도입부와 결론부 가중
      if (s.pos < 0.12) score += 0.25;
      if (s.pos > 0.82) score += 0.3;
      const len = s.text.length;
      if (len < 12) score -= 0.3;
      if (len > 140) score -= 0.25;
      s.score = score;
    });

    const ranked = sentences.slice().sort(function (a, b) { return b.score - a.score; });
    const picked = [];
    ranked.forEach(function (cand) {
      if (picked.length >= maxLines) return;
      const cw = new Set(tokenize(cand.text));
      let tooClose = false;
      picked.forEach(function (p) {
        const pw = new Set(tokenize(p.text));
        let inter = 0;
        cw.forEach(function (w) { if (pw.has(w)) inter++; });
        const jac = inter / Math.max(1, Math.min(cw.size, pw.size));
        if (jac > 0.55) tooClose = true;
      });
      if (tooClose) return;
      picked.push(cand);
    });

    // 시간순 정렬 유지(자막이 있으면 타임스탬프 순)
    if (picked.length && picked[0].t !== null && picked[0].t !== undefined) {
      picked.sort(function (a, b) {
        const dt = (a.t || 0) - (b.t || 0);
        return dt !== 0 ? dt : (a.order || 0) - (b.order || 0);
      });
    }
    return picked.map(function (p) {
      return { text: clamp(p.text, 220), t: p.t === undefined ? null : p.t, score: p.score };
    });
  }

  /** 상위 키워드로 문단 제목 만들기 */
  function headingFor(texts) {
    const rank = keywordRank(texts.join(' '), 3).map(function (x) { return x.w; });
    return rank.length ? rank.join(' · ') : '이야기';
  }

  /* ============================================================
   * 2. 제목 3안 · 표 · 공통 빌더
   * ============================================================ */
  const TITLE_KINDS = {
    curiosity: { label: '궁금증/반전형', badge: '①' },
    numbers: { label: '숫자/팩트형', badge: '②' },
    summary: { label: '핵심 요약형', badge: '③' }
  };

  function makeTitleSet(list) {
    const out = [];
    list.forEach(function (x) {
      if (!x || !x.text) return;
      const meta = TITLE_KINDS[x.kind] || { label: '제목', badge: '·' };
      out.push({ kind: x.kind, label: meta.label, badge: meta.badge, text: clamp(x.text, 72) });
    });
    return out;
  }

  function tableOf(headers, rows, note) {
    const body = (rows || []).filter(function (r) {
      return (r || []).some(function (c) { return c !== null && c !== undefined && String(c).trim() !== ''; });
    });
    if (!body.length) return null;
    return { headers: headers || [], rows: body, note: note || '' };
  }

  /** 첫 문단이 너무 길면 문장 경계에서 두 덩이로 끊어 준다(모바일 가독성) */
  function paraSplit(text, limit) {
    const t = String(text || '').trim();
    if (!t) return [];
    const lim = limit || 110;
    if (t.length <= lim) return [t];
    const parts = t.split(/(?<=[.!?])\s+/);
    if (parts.length < 2) return [t];
    const out = [];
    let cur = '';
    parts.forEach(function (p) {
      if (cur && (cur + ' ' + p).length > lim) { out.push(cur.trim()); cur = p; }
      else cur = cur ? cur + ' ' + p : p;
    });
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function buildHashtags(seed, mode) {
    const base = {
      stock: ['#주식', '#코스피', '#코스닥', '#국내증시', '#주도테마', '#매매일지', '#시황', '#투자공부'],
      deals: ['#동탄', '#동탄나들이', '#가족나들이', '#키즈카페', '#여행특가', '#주말나들이', '#4인가족', '#특가'],
      video: ['#유튜브요약', '#영상정리', '#핵심요약', '#쇼츠', '#정보정리'],
      topic: ['#블로그', '#콘텐츠', '#정보공유', '#글쓰기']
    }[mode] || ['#콘텐츠'];
    const extra = (seed || []).slice(0, 6).map(function (w) {
      const t = String(w).replace(/[^\w가-힣]/g, '');
      if (!t || /^[\d]+$/.test(t)) return '';     // 숫자만으로 된 태그는 만들지 않는다
      return t.length >= 2 ? '#' + t : '';
    });
    return dedupe(base.concat(extra)).slice(0, 12);
  }

  function buildSeoMeta(content) {
    const mode = content.mode;
    const kst = kstNow();
    const kw = content.keywords && content.keywords.length ? content.keywords.slice(0, 3).join(' · ') : '콘텐츠';
    let meta = '';
    if (mode === 'stock') meta = `${kst.short} 국내 증시 마감 정리 — ${clamp(content.headline, 55)}. 주도 테마·신고가·상한가·주요 뉴스까지 실측 데이터로 정리했습니다.`;
    else if (mode === 'deals') meta = `${clamp(content.headline, 60)} — 동탄 4인 가족 기준 가격·주차·이동 시간까지 한 번에 비교했습니다.`;
    else if (mode === 'video') meta = `${clamp(content.headline, 60)} — 영상에서 실제로 말한 내용만 추려 5줄 요약과 정리글로 만들었습니다.`;
    else meta = `${clamp(content.headline, 60)} — ${kw} 핵심만 정리한 글.`;
    return clamp(meta, 155);
  }

  function buildCta(mode) {
    if (mode === 'stock') return '오늘 시황이 도움이 됐다면 구독·알림 설정해 두세요. 매 거래일 마감 후 실제 수치로 정리해 올립니다. (본 글은 정보 정리이며 투자 권유가 아닙니다. 투자 판단과 책임은 투자자 본인에게 있습니다.)';
    if (mode === 'deals') return '이번 주말 계획 세우실 때 저장해 두고 예약 화면에서 가격·운영시간을 한 번 더 확인하세요. 새 특가가 확인되면 다시 정리해 올립니다.';
    if (mode === 'video') return '영상 전체가 궁금하시면 원본 링크를 확인해 보세요. 다른 영상도 링크만 주시면 같은 방식으로 정리해 드립니다.';
    return '궁금한 점이나 추가로 정리했으면 하는 부분은 댓글로 남겨 주세요.';
  }

  /* ============================================================
   * 3. 쇼츠 대본 — [0~3초 훅] / 핵심 컷 / [마무리 CTA]
   * ============================================================ */
  function srtTime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${pad2(h)}:${pad2(m)}:${pad2(ss)},${String(ms).padStart(3, '0')}`;
  }

  function rangeLabel(start, end) {
    return `${start}~${end}초`;
  }

  /**
   * buildShortsScript({
   *   hook:   {caption, narration} | '문장',
   *   cuts:   [{caption, narration, query}] | ['문장'],
   *   cta:    {caption, narration} | '문장',
   *   hashtags, total, mode, kicker, sourceText
   * })
   */
  function buildShortsScript(opts) {
    const o = opts || {};
    const total = o.total || 50;

    function pair(v, fallbackCaption, fallbackNarration) {
      if (v && typeof v === 'object') {
        return {
          caption: clamp(v.caption || v.text || fallbackCaption || '', 90),
          narration: clamp(v.narration || v.caption || v.text || fallbackNarration || '', 150),
          query: v.query || ''
        };
      }
      const s = clamp(v || fallbackCaption || '', 120);
      return { caption: s, narration: s, query: '' };
    }

    const hook = pair(o.hook, '지금 확인해야 할 내용, 50초로 정리합니다.', '지금 확인해야 할 내용을 50초로 정리합니다.');
    const rawCuts = (o.cuts || o.blocks || []).filter(Boolean).slice(0, 4);
    const cta = pair(o.cta, '자세한 내용은 고정 댓글 링크에서 확인하세요.', '자세한 내용은 고정 댓글 링크에서 확인하세요.');

    const hookSec = 3;
    const ctaSec = 8;
    const bodyBudget = Math.max(12, total - hookSec - ctaSec);
    const each = Math.max(6, Math.floor(bodyBudget / Math.max(1, rawCuts.length)));

    const timeline = [];
    let acc = 0;
    timeline.push({ role: '후킹', caption: hook.caption, narration: hook.narration, query: hook.query, start: 0, end: hookSec });
    acc = hookSec;
    rawCuts.forEach(function (c, i) {
      const p = pair(c, `핵심 ${i + 1}`, `핵심 ${i + 1}`);
      timeline.push({
        role: `컷 ${i + 1}`,
        caption: clamp(p.caption, 90),
        narration: clamp(p.narration, 150),
        query: p.query || '',
        start: acc,
        end: acc + each
      });
      acc += each;
    });
    timeline.push({ role: 'CTA', caption: cta.caption, narration: cta.narration, query: cta.query, start: acc, end: acc + ctaSec });
    acc += ctaSec;

    const hookItem = timeline[0];
    const ctaItem = timeline[timeline.length - 1];
    const cuts = timeline.slice(1, timeline.length - 1).map(function (c, i) {
      return {
        i: i + 1,
        role: c.role,
        range: rangeLabel(c.start, c.end),
        start: c.start, end: c.end,
        caption: c.caption,
        narration: c.narration,
        query: c.query,
        label: fmtTime(c.start)
      };
    });

    // SRT — 읽는 속도보다 자막이 길면 문장 단위로 쪼갠다
    const srtLines = [];
    timeline.forEach(function (t, idx) {
      const cap = String(t.caption || '').replace(/\*\*/g, '');
      const chunks = cap.length > 40 ? splitSentenceChunks(cap, 34) : [cap];
      const span = Math.max(1, (t.end - t.start) / Math.max(1, chunks.length));
      chunks.forEach(function (c, j) {
        const s = t.start + span * j;
        srtLines.push(`${srtLines.length + 1}\n${srtTime(s)} --> ${srtTime(s + span - 0.05)}\n${c}\n`);
      });
    });

    const plain = [`■ 50초 쇼츠 대본 (${acc}초)`, '']
      .concat([
        `[${rangeLabel(hookItem.start, hookItem.end)} 훅]`,
        `  자막: ${stripMd(hookItem.caption)}`,
        `  나레이션: ${stripMd(hookItem.narration)}`
      ])
      .concat(cuts.map(function (c) {
        return [`[${c.range} 컷 ${c.i}]`, `  자막: ${stripMd(c.caption)}`, `  나레이션: ${stripMd(c.narration)}`].join('\n');
      }))
      .concat([
        `[${rangeLabel(ctaItem.start, ctaItem.end)} 마무리 CTA]`,
        `  자막: ${stripMd(ctaItem.caption)}`,
        `  나레이션: ${stripMd(ctaItem.narration)}`
      ])
      .concat(['', '■ 해시태그', (o.hashtags || []).join(' ')]);

    return {
      total: acc,
      hook: {
        range: rangeLabel(hookItem.start, hookItem.end),
        start: hookItem.start, end: hookItem.end,
        caption: hookItem.caption, narration: hookItem.narration
      },
      cuts: cuts,
      cta: {
        range: rangeLabel(ctaItem.start, ctaItem.end),
        start: ctaItem.start, end: ctaItem.end,
        caption: ctaItem.caption, narration: ctaItem.narration
      },
      // 구버전 호환(타임라인 배열)
      blocks: timeline.map(function (t) {
        return { start: t.start, end: t.end, role: t.role, text: stripMd(t.caption), label: fmtTime(t.start) };
      }),
      srt: srtLines.join('\n'),
      plain: plain.join('\n'),
      hashtags: o.hashtags || []
    };
  }

  function splitSentenceChunks(text, size) {
    const s = String(text || '').trim();
    if (s.length <= size) return [s];
    const words = s.split(' ');
    const out = [];
    let cur = '';
    words.forEach(function (w) {
      if (cur && (cur + ' ' + w).length > size) { out.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) out.push(cur);
    return out;
  }

  function stripMd(s) {
    return String(s == null ? '' : s).replace(/\*\*/g, '').replace(/~~/g, '').replace(/\s+/g, ' ').trim();
  }

  /* ---- make_shorts_mp4.py 스펙 ---- */
  const KICKERS = { stock: 'MARKET CLOSE', deals: 'WEEKEND PICKS', video: 'VIDEO SUMMARY', topic: 'NOTE' };
  const SHORT_ACCENTS = { stock: '#38BDF8', deals: '#34D399', video: '#F472B6', topic: '#C084FC' };
  const PIXABAY = {
    stock: ['stock market chart', 'seoul city skyline night', 'finance graph screen', 'trader monitor numbers'],
    deals: ['family theme park', 'kids playing indoor playground', 'hotel resort pool', 'weekend family travel'],
    video: ['person talking podcast', 'laptop typing notes', 'city timelapse lights', 'audio waveform'],
    topic: ['writing notebook desk', 'coffee laptop morning', 'bookshelf reading', 'calendar planning']
  };

  /** 자막용 숫자 강조 — 이미 ** 강조가 있으면 건드리지 않는다 */
  function emphasizeNumbers(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return t;
    if (t.indexOf('**') !== -1) return t;
    let used = 0;
    return t.replace(/-?\d[\d,]*(?:\.\d+)?\s*(?:%|퍼센트|원|억|조|만|개|곳|명|배|분|초|줄)?/g, function (m) {
      if (!m || used >= 2) return m;
      used++;
      return '**' + m + '**';
    });
  }

  /** TTS 가 읽기 좋게 — 마크다운·괄호·기호 정리 */
  function ttsClean(text) {
    return stripMd(text)
      .replace(/[\[\]]/g, ' ')
      .replace(/[·•]/g, ', ')
      .replace(/[▲▼–]/g, ' ')
      .replace(/%/g, '퍼센트')
      .replace(/\s*,\s*(?=\d{3}\b)/g, ',')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitTitleLines(text, maxLines, maxChars) {
    const words = stripMd(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    words.forEach(function (w) {
      if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    const out = lines.slice(0, maxLines);
    if (lines.length > maxLines) out[maxLines - 1] = clamp(out[maxLines - 1] + ' ' + lines.slice(maxLines).join(' '), maxChars + 2);
    // 한 줄로 다 들어가도 두 줄이면 길이를 반반으로 나눈다(쇼츠 상단 타이틀 균형)
    if (out.length === 1 && maxLines >= 2 && out[0].length > maxChars) {
      const ws = out[0].split(' ');
      if (ws.length > 1) {
        let best = 1, bestDiff = Infinity;
        for (let i = 1; i < ws.length; i++) {
          const diff = Math.abs(ws.slice(0, i).join(' ').length - ws.slice(i).join(' ').length);
          if (diff < bestDiff) { bestDiff = diff; best = i; }
        }
        return [ws.slice(0, best).join(' '), ws.slice(best).join(' ')];
      }
    }
    return out.map(function (l) { return l.length > maxChars + 4 ? clamp(l, maxChars + 3) : l; });
  }

  /** studio.html → [🎬 쇼츠 JSON 복사] 로 나가는 스펙 (scripts/make_shorts_mp4.py) */
  function shortsSpec(content) {
    if (!content || !content.shorts) return null;
    const sh = content.shorts;
    const mode = content.mode || 'topic';
    const mainTitle = (content.blog && content.blog.titles && content.blog.titles[0]) || content.headline || '쇼츠';
    const plainTitle = stripMd(content.shortsTitle || mainTitle);
    const videoTitle = plainTitle.length <= 32 ? plainTitle : clamp(stripMd(content.headline || plainTitle), 32);
    const timeline = [sh.hook].concat(sh.cuts || []).concat([sh.cta]);
    const pool = PIXABAY[mode] || PIXABAY.topic;
    const spec = {
      title: clamp(videoTitle, 40),
      kicker: (content.kicker || KICKERS[mode] || 'NOTE'),
      accent: (content.accent || SHORT_ACCENTS[mode] || '#FFC53D'),
      layout: 'letterbox',
      title_lines: splitTitleLines(videoTitle, 2, 16),
      source_text: clamp(stripMd((content.source && (content.source.short || content.source.label)) || ''), 28),
      tts_lang: 'ko',
      bgm_volume: 0.12,
      cuts: timeline.map(function (c, i) {
        const cap = emphasizeNumbers(c.caption);
        const cut = {
          text: cap,
          tts_text: ttsClean(c.narration || c.caption),
          pixabay_query: c.query || pool[i % pool.length]
        };
        if (i === 0) cut.hook = clamp(stripMd(c.caption), 22);
        return cut;
      })
    };
    return spec;
  }

  /* ============================================================
   * 4. Markdown · 리치 HTML (네이버/티스토리 붙여넣기)
   * ============================================================ */
  function sectionToMd(s) {
    const lines = [];
    lines.push(`## ${stripMd(s.h2)}`);
    lines.push('');
    if (s.lead) { lines.push(`**${stripMd(s.lead)}**`); lines.push(''); }
    (s.paras || []).forEach(function (p) {
      if (!p) return;
      lines.push(p);
      lines.push('');
    });
    if (s.table && s.table.rows && s.table.rows.length) {
      const heads = s.table.headers || [];
      if (heads.length) {
        lines.push('| ' + heads.join(' | ') + ' |');
        lines.push('| ' + heads.map(function () { return '---'; }).join(' | ') + ' |');
      }
      s.table.rows.forEach(function (r) {
        lines.push('| ' + r.map(function (c) { return stripMd(String(c == null ? '' : c)).replace(/\|/g, '/'); }).join(' | ') + ' |');
      });
      lines.push('');
      if (s.table.note) { lines.push(`*${stripMd(s.table.note)}*`); lines.push(''); }
    }
    if (s.items && s.items.length) {
      s.items.forEach(function (it) { lines.push(`- ${stripMd(it)}`); });
      lines.push('');
    }
    return lines;
  }

  function contentToMarkdown(content) {
    if (!content || !content.blog) return '';
    const b = content.blog;
    const lines = [];
    lines.push(`# ${stripMd((b.titles && b.titles[0]) || content.headline || '제목')}`);
    lines.push('');
    if (content.source && content.source.label) {
      lines.push(`> 출처: ${content.source.label}${content.source.asOf ? ' · 기준 ' + content.source.asOf : ''}`);
      lines.push('');
    }
    (b.hook ? paraSplit(b.hook) : []).forEach(function (p) { lines.push(p); lines.push(''); });
    (b.sections || []).forEach(function (s) { lines.push.apply(lines, sectionToMd(s)); });
    if (b.points && b.points.length) {
      lines.push('## 실전 포인트 — 이렇게 쓰세요');
      lines.push('');
      b.points.forEach(function (p, i) {
        lines.push(`${i + 1}. **${stripMd(p.t)}** — ${stripMd(p.d)}`);
      });
      lines.push('');
    }
    lines.push('## 마무리');
    lines.push('');
    if (b.closing) { lines.push(stripMd(b.closing)); lines.push(''); }
    if (b.cta) { lines.push(b.cta); lines.push(''); }
    if (b.tags && b.tags.length) lines.push(b.tags.join(' '));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* -------- 리치 HTML (붙여넣기용 인라인 스타일) -------- */
  const S = {
    p: 'margin:0 0 16px;font-size:16px;line-height:1.85;color:#222;letter-spacing:-0.01em;word-break:keep-all',
    h2: 'margin:32px 0 14px;padding:0 0 8px 12px;border-left:4px solid #2563eb;font-size:20px;line-height:1.4;font-weight:700;color:#111;letter-spacing:-0.02em;word-break:keep-all',
    lead: 'margin:0 0 14px;font-size:16px;line-height:1.8;font-weight:700;color:#1d4ed8;word-break:keep-all',
    li: 'margin:0 0 8px;font-size:15.5px;line-height:1.75;color:#222;word-break:keep-all',
    hr: 'border:none;border-top:1px solid #e5e7eb;margin:32px 0',
    quote: 'margin:0 0 20px;padding:12px 16px;background:#f8fafc;border-left:3px solid #94a3b8;color:#475569;font-size:14px;line-height:1.7',
    tbl: 'width:100%;border-collapse:collapse;margin:0 0 12px;font-size:14.5px;line-height:1.6',
    th: 'border:1px solid #cbd5e1;background:#f1f5f9;padding:9px 10px;font-weight:700;color:#0f172a;text-align:left',
    td: 'border:1px solid #dbe3ec;padding:9px 10px;color:#1f2937;vertical-align:top',
    note: 'margin:0 0 20px;font-size:13px;color:#64748b;line-height:1.6',
    point: 'margin:0 0 12px;padding:12px 14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;font-size:15.5px;line-height:1.75;color:#222',
    pointT: 'display:block;font-weight:700;color:#1d4ed8;margin-bottom:4px',
    closing: 'margin:0 0 18px;padding:16px;background:#eef2ff;border-radius:8px;font-size:16px;line-height:1.8;font-weight:700;color:#1e293b;word-break:keep-all',
    cta: 'margin:0 0 14px;font-size:14px;line-height:1.7;color:#64748b',
    tag: 'margin:6px 0 0;font-size:14px;color:#2563eb;line-height:1.7'
  };

  function paraHtml(text) {
    return paraSplit(text).map(function (p) { return `<p style="${S.p}">${esc(p)}</p>`; }).join('\n');
  }

  function tableHtml(t) {
    if (!t || !t.rows || !t.rows.length) return '';
    const heads = t.headers || [];
    let h = `<table style="${S.tbl}">`;
    if (heads.length) {
      h += '<thead><tr>' + heads.map(function (c) { return `<th style="${S.th}">${esc(c)}</th>`; }).join('') + '</tr></thead>';
    }
    h += '<tbody>' + t.rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) {
        const label = heads[i] ? ` data-label="${esc(heads[i])}"` : '';
        return `<td${label} style="${S.td}">${esc(c)}</td>`;
      }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
    if (t.note) h += `<p style="${S.note}">* ${esc(t.note)}</p>`;
    return h;
  }

  /** opts: {includeTitle=false, includeTags=true} */
  function contentToHtml(content, opts) {
    if (!content || !content.blog) return '';
    const o = opts || {};
    const b = content.blog;
    const out = [];
    if (o.includeTitle) out.push(`<h1 style="font-size:26px;line-height:1.4;font-weight:800;color:#0f172a;margin:0 0 16px;letter-spacing:-0.03em;word-break:keep-all">${esc(stripMd(b.titles[0]))}</h1>`);
    if (content.source && content.source.label) {
      out.push(`<p style="${S.quote}">출처: ${esc(content.source.label)}${content.source.asOf ? ' · 기준 ' + esc(content.source.asOf) : ''}</p>`);
    }
    if (b.hook) out.push(paraHtml(b.hook));
    (b.sections || []).forEach(function (s) {
      out.push(`<h2 style="${S.h2}">${esc(stripMd(s.h2))}</h2>`);
      if (s.lead) out.push(`<p style="${S.lead}">${esc(stripMd(s.lead))}</p>`);
      (s.paras || []).forEach(function (p) { if (p) out.push(paraHtml(p)); });
      const tbl = tableHtml(s.table);
      if (tbl) out.push(tbl);
      if (s.items && s.items.length) {
        out.push('<ul style="margin:0 0 20px;padding-left:20px">' + s.items.map(function (it) {
          return `<li style="${S.li}">${esc(stripMd(it))}</li>`;
        }).join('') + '</ul>');
      }
    });
    if (b.points && b.points.length) {
      out.push(`<hr style="${S.hr}">`);
      out.push(`<h2 style="${S.h2}">실전 포인트 — 이렇게 쓰세요</h2>`);
      b.points.forEach(function (p, i) {
        out.push(`<div style="${S.point}"><span style="${S.pointT}">${i + 1}. ${esc(stripMd(p.t))}</span>${esc(stripMd(p.d))}</div>`);
      });
    }
    out.push(`<hr style="${S.hr}">`);
    out.push(`<h2 style="${S.h2}">마무리</h2>`);
    if (b.closing) out.push(`<p style="${S.closing}">${esc(stripMd(b.closing))}</p>`);
    if (b.cta) out.push(`<p style="${S.cta}">${esc(b.cta)}</p>`);
    if (o.includeTags !== false && b.tags && b.tags.length) out.push(`<p style="${S.tag}">${esc(b.tags.join(' '))}</p>`);
    return out.join('\n');
  }

  /** 붙여넣기용 평문(서식 없는 에디터 대비) */
  function contentToPlain(content) {
    const b = content.blog;
    const out = [];
    if (b.hook) out.push(stripMd(b.hook));
    (b.sections || []).forEach(function (s) {
      out.push('[ ' + stripMd(s.h2) + ' ]');
      if (s.lead) out.push(stripMd(s.lead));
      (s.paras || []).forEach(function (p) { if (p) out.push(stripMd(p)); });
      if (s.table && s.table.rows) {
        if (s.table.headers) out.push(s.table.headers.join(' | '));
        s.table.rows.forEach(function (r) { out.push(r.join(' | ')); });
      }
      (s.items || []).forEach(function (it) { out.push('· ' + stripMd(it)); });
      out.push('');
    });
    if (b.points && b.points.length) {
      out.push('[ 실전 포인트 ]');
      b.points.forEach(function (p, i) { out.push(`${i + 1}. ${stripMd(p.t)} — ${stripMd(p.d)}`); });
      out.push('');
    }
    if (b.closing) out.push('[ 마무리 ]', stripMd(b.closing));
    if (b.cta) out.push(stripMd(b.cta));
    if (b.tags && b.tags.length) out.push(b.tags.join(' '));
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** 편집기에서 돌려받은 markdown → blog 구조 복원 */
  function parseBlogMarkdown(md, base) {
    const src = String(md || '').replace(/\r\n?/g, '\n');
    const blog = Object.assign({}, (base && base.blog) || {});
    const sections = [];
    const points = [];
    const closingBuf = [];
    let hookParas = [];
    let cur = null;
    let mode = 'body';           // body | points | closing
    let title = '';
    let tableBuf = [];

    function flushTable() {
      if (!cur || !tableBuf.length) { tableBuf = []; return; }
      const rows = tableBuf.map(function (line) {
        return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
      }).filter(function (r) {
        return !r.every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ''; });
      });
      if (!rows.length) { tableBuf = []; return; }
      const headers = rows.shift();
      cur.table = { headers: headers, rows: rows, note: '' };
      tableBuf = [];
    }

    src.split('\n').forEach(function (raw) {
      const line = raw.replace(/\s+$/, '');
      if (/^#\s+/.test(line)) { title = line.replace(/^#\s+/, '').trim(); return; }
      if (/^##\s+/.test(line)) {
        flushTable();
        const h = line.replace(/^##\s+/, '').trim();
        if (/^실전\s*포인트/.test(h)) { mode = 'points'; cur = null; return; }
        if (/^마무리$/.test(h)) { mode = 'closing'; cur = null; return; }
        mode = 'body';
        cur = { h2: h, paras: [], items: [] };
        sections.push(cur);
        return;
      }
      if (/^>\s?/.test(line)) return;        // 출처 줄은 무시(원본 유지)
      if (/^\|/.test(line)) { if (mode === 'body' && cur) tableBuf.push(line); return; }
      if (/^\*[^*].*\*$/.test(line.trim()) && cur && cur.table && !cur.table.note) {
        cur.table.note = line.trim().replace(/^\*\s?/, '').replace(/\*$/, '').trim();
        return;
      }
      flushTable();
      if (!line.trim()) return;
      if (mode === 'points') {
        const m = line.match(/^(\d+)\.\s*\*\*(.+?)\*\*\s*[—–-]\s*(.*)$/) || line.match(/^(\d+)\.\s*(.+)$/);
        if (m) points.push({ t: stripMd(m[2]), d: stripMd(m[3] || '') });
        return;
      }
      if (mode === 'closing') {
        closingBuf.push(line.trim());
        return;
      }
      if (/^-\s+/.test(line) && cur) { cur.items.push(line.replace(/^-\s+/, '').trim()); return; }
      if (/^\*\*.+\*\*$/.test(line) && cur && !cur.lead) { cur.lead = line.replace(/\*\*/g, '').trim(); return; }
      if (/^#/.test(line)) return;
      if (cur) cur.paras.push(line.trim());
      else hookParas.push(line.trim());
    });
    flushTable();

    // 마무리 블록: [한 줄 결론] → [CTA] → [태그] 순서로 되살린다
    if (closingBuf.length) {
      const body = closingBuf.slice();
      const last = body[body.length - 1] || '';
      if (/^#[^\s#]+(\s+#[^\s#]+)*$/.test(last)) {
        blog.tags = last.split(/\s+/).filter(Boolean);
        body.pop();
      }
      blog.closing = (body.shift() || '').trim();
      blog.cta = body.join(' ').trim();
    }

    blog.titles = blog.titles || [];
    if (title) blog.titles[0] = title;
    blog.hook = hookParas.join(' ');
    blog.sections = sections;
    if (points.length) blog.points = points;
    return { blog: blog, title: title };
  }

  function shortsToText(shorts) {
    if (!shorts) return '';
    if (shorts.plain) return shorts.plain;
    return [`■ 50초 쇼츠 대본 (${shorts.total}초)`, ''].concat(
      (shorts.blocks || []).map(function (b) { return `[${b.label} · ${b.role}] ${b.text}`; }),
      ['', '■ 해시태그', (shorts.hashtags || []).join(' ')]
    ).join('\n');
  }

  function finishContent(content) {
    const b = content.blog;
    if (!b.titleSet && b.titles) {
      b.titleSet = makeTitleSet(b.titles.map(function (t, i) {
        return { kind: ['summary', 'curiosity', 'numbers'][i] || 'summary', text: t };
      }));
    }
    // 제목 3안은 후보일 뿐 — 사용자가 고른 제목(b.titles[0])은 건드리지 않는다
    if (b.titleSet && b.titleSet.length && (!b.titles || !b.titles.length)) {
      b.titles = b.titleSet.map(function (t) { return t.text; });
    }
    b.metaDesc = buildSeoMeta(content);
    b.cta = b.cta || buildCta(content.mode);
    b.tags = b.tags && b.tags.length ? b.tags : buildHashtags(content.keywords || [], content.mode);
    content.shorts.hashtags = b.tags;
    content.shorts.plain = shortsToText(content.shorts);
    content.blog.markdown = contentToMarkdown(content);
    content.blog.plain = contentToPlain(content);
    content.shorts.spec = shortsSpec(content);
    content.shorts.json = content.shorts.spec ? JSON.stringify(content.shorts.spec, null, 2) : '';
    content.generatedAt = kstNow().label + ' ' + kstNow().time;
    content.engine = 'content-engine ' + VERSION;
    return content;
  }

  /* ============================================================
   * 5. 📈 주식 관제탑 모드
   * ============================================================ */
  function themeName(t) {
    return String((t && t.name) || '').split(' ·')[0].trim();
  }

  function themeLine(theme) {
    const top = (theme.stocks || []).slice(0, 2).map(function (s) {
      return `${s.name} ${num(s.price, 0)}원(${pct(s.changePct)})`;
    });
    return `${theme.name} — 평균 ${pct(theme.avgPct)}, 합산 거래대금 ${theme.sumValueText || num(theme.sumValue, 0) + '원'}${top.length ? ' · 대표 ' + top.join(', ') : ''}`;
  }

  function buildFromStocks(payload) {
    const live = payload.live || {};
    const tabs = payload.tabs || {};
    const kst = kstNow();
    const indices = live.indices || [];
    const kospi = indices.find(function (i) { return i.key === 'KOSPI'; }) || indices[0] || {};
    const kosdaq = indices.find(function (i) { return i.key === 'KOSDAQ'; }) || indices[1] || {};
    const fx = live.fx || {};
    const futures = (live.futures || [])[0] || {};
    const themes = (tabs.themes || []).slice(0, 3);
    const allThemes = (tabs.themes || []).slice(0, 5);
    const high52 = (tabs.high52 && tabs.high52.byValue) || [];
    const upper = tabs.upperLimit || {};
    const confirmed = upper.confirmed || [];
    const near = upper.near || [];
    const news = (tabs.news || []).slice(0, 3);
    const sessionLabel = tabs.sessionLabel || '';
    const basis = tabs.generatedAtLabel || live.generatedAtKst || '';
    const isWeekend = kst.dow === 0 || kst.dow === 6;
    const rise = has(kospi.changePct) ? Number(kospi.changePct) >= 0 : null;

    const headlineBase = `코스피 ${num(kospi.price)} ${arrow(kospi.changePct)} ${pct(kospi.changePct)}`;
    const headline = isWeekend ? `${kst.short} 주말 결산 — ${headlineBase}` : `${kst.short} 국내 증시 마감 — ${headlineBase}`;
    const topTheme = themes[0] ? themeName(themes[0]) : '';

    const pills = [
      `코스피 ${num(kospi.price)} (${pct(kospi.changePct)})`,
      `코스닥 ${num(kosdaq.price)} (${pct(kosdaq.changePct)})`,
      fx.price ? `원/달러 ${num(fx.price, 1)}원` : '',
      futures.price ? `나스닥선물 ${num(futures.price)} (${pct(futures.changePct)})` : ''
    ].filter(Boolean);

    const facts = [];
    if (kospi.price) facts.push({ k: '코스피', v: `${num(kospi.price)} (${pct(kospi.changePct)}) · 거래대금 ${kospi.valueText || '-'}` });
    if (kosdaq.price) facts.push({ k: '코스닥', v: `${num(kosdaq.price)} (${pct(kosdaq.changePct)}) · 거래대금 ${kosdaq.valueText || '-'}` });
    if (fx.price) facts.push({ k: '원/달러', v: `${num(fx.price, 1)}원 (${pct(fx.changePct)})` });
    if (futures.price) facts.push({ k: futures.name || '나스닥 선물', v: `${num(futures.price)} (${pct(futures.changePct)})` });
    themes.forEach(function (t, i) { facts.push({ k: `주도 테마 ${i + 1}`, v: t.name + ' · 평균 ' + pct(t.avgPct) + ' · ' + (t.sumValueText || '') }); });
    if (confirmed.length) facts.push({ k: '상한가 확정', v: confirmed.map(function (s) { return `${s.name} ${pct(s.changePct)}`; }).join(', ') });
    if (near.length) facts.push({ k: '상한가 임박', v: near.map(function (s) { return `${s.name} ${pct(s.changePct)}`; }).join(', ') });
    if (high52.length) facts.push({ k: '52주 신고가', v: `${(tabs.high52.counts ? (tabs.high52.counts.KOSPI + tabs.high52.counts.KOSDAQ) : high52.length)}종목 · 대표 ${high52.slice(0, 3).map(function (s) { return s.name; }).join(', ')}` });

    /* ---- 5줄 요약: 실측 수치만 ---- */
    const summary = [];
    if (kospi.price) {
      summary.push(`코스피는 ${num(kospi.price)}(${pct(kospi.changePct)})로 ${rise ? '상승' : '하락'} 마감했습니다. 거래대금은 ${kospi.valueText || '-'}입니다.`);
    }
    if (kosdaq.price) {
      summary.push(`코스닥은 ${num(kosdaq.price)}(${pct(kosdaq.changePct)})를 기록했습니다. 거래대금은 ${kosdaq.valueText || '-'}입니다.`);
    }
    if (themes.length) {
      summary.push(`주도 테마 1위는 ${themes[0].name}로, 평균 ${pct(themes[0].avgPct)}에 합산 거래대금 ${themes[0].sumValueText || '-'}를 기록했습니다.`);
    }
    if (confirmed.length || near.length) {
      summary.push(`${confirmed.length ? '상한가 확정 ' + confirmed.length + '종목(' + confirmed.slice(0, 3).map(function (s) { return s.name; }).join(', ') + ')' : ''}${confirmed.length && near.length ? ', ' : ''}${near.length ? '상한가 임박 ' + near.length + '종목(' + near.slice(0, 3).map(function (s) { return s.name; }).join(', ') + ')' : ''}이 거래대금 100억 이상 기준으로 잡혔습니다.`);
    } else {
      summary.push('거래대금 100억 이상 · +25% 기준을 통과한 상한가·임박 종목은 없었습니다.');
    }
    const fxLine = fx.price
      ? `원/달러는 ${num(fx.price, 1)}원(${pct(fx.changePct)})${futures.price ? `, ${futures.name || '나스닥 선물'}은 ${num(futures.price)}(${pct(futures.changePct)})` : ''}입니다.`
      : '';
    if (news.length) {
      summary.push(`주요 뉴스는 "${clamp(news[0].title, 62)}"(${news[0].press || '언론사'}) 등이며 ${news[0].impactDirection || '중립'}(${news[0].impactLevel || '-'}) 신호로 분류됐습니다. ${fxLine}`.trim());
    } else {
      summary.push(('특이 뉴스가 수집되지 않았습니다. ' + fxLine).trim());
    }

    /* ---- 표 1: 지수·환율 ---- */
    const t1Rows = [];
    if (kospi.price) t1Rows.push(['코스피', `${num(kospi.price)} (${pct(kospi.changePct)})`, kospi.valueText || '-', '대형주 방향']);
    if (kosdaq.price) t1Rows.push(['코스닥', `${num(kosdaq.price)} (${pct(kosdaq.changePct)})`, kosdaq.valueText || '-', '중소형 온도']);
    if (fx.price) t1Rows.push(['원/달러', `${num(fx.price, 1)}원 (${pct(fx.changePct)})`, '-', '외국인 수급 변수']);
    if (futures.price) t1Rows.push([futures.name || '나스닥 선물', `${num(futures.price)} (${pct(futures.changePct)})`, '-', '밤사이 해외 방향']);

    /* ---- 표 2: 주도 테마 ---- */
    const t2Rows = allThemes.map(function (t) {
      const reps = (t.stocks || []).slice(0, 2).map(function (s) { return s.name; }).join(', ');
      return [clamp(themeName(t), 14), pct(t.avgPct), t.sumValueText || num(t.sumValue, 0) + '원', reps || '-'];
    });

    /* ---- 본문 ---- */
    const sections = [];

    sections.push({
      h2: '먼저 숫자부터 — 오늘 시장 온도',
      lead: '지수는 방향만 알려 줍니다. 온도는 거래대금과 같이 봐야 정확합니다.',
      paras: [
        `${isWeekend ? '주말 휴장이라 직전 거래일 종가' : '오늘'} 기준으로 코스피는 ${num(kospi.price)}(${pct(kospi.changePct)}), 코스닥은 ${num(kosdaq.price)}(${pct(kosdaq.changePct)})입니다. ${rise === null ? '' : rise ? '지수가 올라도 거래대금이 줄면 상승이 버티기 어렵습니다.' : '지수가 밀려도 거래대금이 붙는 곳은 따로 있습니다.'}`,
        fx.price ? `환율은 원/달러 ${num(fx.price, 1)}원(${pct(fx.changePct)})${futures.price ? `, ${futures.name || '나스닥 선물'}은 ${num(futures.price)}(${pct(futures.changePct)})` : ''}로 움직였습니다. 이 두 숫자는 다음 날 아침 수급의 출발점이 됩니다.` : '환율·해외 지표는 이번 수집에서 확인되지 않았습니다.'
      ],
      items: [],
      table: tableOf(['구분', '오늘 수치', '거래대금', '읽는 법'], t1Rows, `기준 ${basis || kst.label + ' ' + kst.time} · 출처: 네이버 증권 폴링 + 야후 선물`)
    });

    if (allThemes.length) {
      sections.push({
        h2: '돈이 몰린 곳 — 주도 테마',
        lead: '등락률 순서와 거래대금 순서가 다를 때, 진짜 자금은 후자에 있습니다.',
        paras: [
          `오늘 상위 테마는 ${allThemes.slice(0, 3).map(function (t) { return themeName(t); }).join(', ')} 순으로 정렬됐습니다. 평균 등락률이 높아도 거래대금이 얇으면 다음 날 되돌림이 나오기 쉽고, 반대로 등락률은 작아도 대금이 두꺼우면 자리가 남아 있습니다.`
        ],
        items: themes.map(function (t) { return themeLine(t); }),
        table: tableOf(['테마', '평균 등락률', '합산 거래대금', '대표 종목'], t2Rows, '테마별 1~4등 합산 거래대금 기준(관제탑 실시간 집계)')
      });
    }

    if (high52.length || confirmed.length || near.length) {
      sections.push({
        h2: '신고가 · 상한가 — 대금이 붙은 종목만',
        lead: '기준을 통과한 종목만 남겼습니다. 통과하지 못한 종목은 관찰로 따로 봅니다.',
        paras: [
          `52주 신고가는 ${tabs.high52 && tabs.high52.counts ? `${tabs.high52.counts.KOSPI}개(코스피) · ${tabs.high52.counts.KOSDAQ}개(코스닥)` : high52.length + '종목'}가 잡혔습니다. 상한가 판정은 거래대금 100억 이상 · 상승률 +25% 이상 기준을 통과한 종목만 인정합니다.`
        ],
        items: []
          .concat(confirmed.slice(0, 5).map(function (s) { return `상한가 확정: ${s.name}(${s.code}) ${pct(s.changePct)} · 거래대금 ${s.valueText || '-'}`; }))
          .concat(near.slice(0, 5).map(function (s) { return `상한가 임박: ${s.name}(${s.code}) ${pct(s.changePct)} · 거래대금 ${s.valueText || '-'}`; }))
          .concat(high52.slice(0, 5).map(function (s) { return `52주 신고가: ${s.name}(${s.code}) ${pct(s.changePct)} · 거래대금 ${s.valueText || '-'}`; }))
      });
    }

    if (news.length) {
      sections.push({
        h2: '오늘의 뉴스, 숫자와 함께',
        lead: '기사 제목·요약에서 뽑은 키워드로 영향도와 테마를 자동 분류했습니다.',
        paras: [
          `가장 눈에 띈 기사는 "${clamp(news[0].title, 60)}"(${news[0].press || '언론사'})이고, ${news[0].impactDirection || '중립'} · ${news[0].impactLevel || '-'} 신호로 분류됐습니다. 뉴스는 재료일 뿐이고, 실제 매매는 거래대금이 붙는지로 확인하는 편이 안전합니다.`
        ],
        items: news.map(function (n) {
          return `${n.title} (${n.press || ''} ${n.time || ''}) — ${n.impactDirection || '중립'} · ${n.impactLevel || '-'}${n.impactNote ? ' · ' + n.impactNote : ''}`;
        })
      });
    }

    const points = [];
    points.push({
      t: '테마가 이틀 연속 가는지 본다',
      d: `하루 반짝한 테마는 다음 날 시초에 물량이 나옵니다. ${topTheme ? topTheme + '가' : '같은 테마가'} 내일도 상위에 있으면 자금이 남아 있다는 신호로 읽습니다.`
    });
    points.push({
      t: '상한가 종목의 다음 날 시초가',
      d: confirmed.length
        ? `오늘 확정된 ${confirmed.slice(0, 3).map(function (s) { return s.name; }).join(', ')}의 다음 날 시초 갭과 거래대금을 봅니다. 시초에 크게 뜨고 대금이 줄면 추격은 피하는 편이 안전합니다.`
        : '오늘 기준을 통과한 상한가 종목이 없었습니다. 내일은 조건(거래대금 100억 · +25%)을 넘는 종목이 나오는지부터 보세요.'
    });
    points.push({
      t: '환율·선물로 밤사이 방향',
      d: fx.price
        ? `원/달러 ${num(fx.price, 1)}원, ${futures.price ? (futures.name || '나스닥 선물') + ' ' + pct(futures.changePct) : '해외 선물'} — 이 두 개가 다음 날 아침 수급의 출발점입니다.`
        : '환율·선물 데이터가 없어 이 항목은 확인 후 판단하세요.'
    });

    const closing = topTheme
      ? `한 줄로 정리하면, 오늘은 '${topTheme}'에 자금이 몰린 날입니다. 내일은 그 테마가 이어지는지, 그리고 거래대금이 따라오는지 딱 두 가지만 확인하세요.`
      : `한 줄로 정리하면, 오늘은 테마가 뚜렷하지 않은 날입니다. 내일은 거래대금이 붙는 첫 테마가 나오는지부터 확인하세요.`;

    const titleSet = makeTitleSet([
      { kind: 'curiosity', text: `코스피 ${pct(kospi.changePct)}, 지수보다 먼저 봐야 할 건 따로 있었습니다` },
      { kind: 'numbers', text: `${kst.short} 마감 — 코스피 ${num(kospi.price)}(${pct(kospi.changePct)}) · 코스닥 ${num(kosdaq.price)}(${pct(kosdaq.changePct)}) · 주도테마 ${allThemes.length}곳` },
      { kind: 'summary', text: `${kst.short} 국내 증시 정리 — ${topTheme ? topTheme + ' 주도' : '테마 혼조'}${high52.length ? `, 신고가 ${(tabs.high52 && tabs.high52.counts) ? tabs.high52.counts.KOSPI + tabs.high52.counts.KOSDAQ : high52.length}종목` : ''}` }
    ]);

    const hook = rise === null
      ? `오늘 시장은 ${num(kospi.price)}에서 마무리됐습니다. 숫자보다 먼저 볼 것은 '어디에 돈이 남아 있었는가'입니다. 결과부터 보시죠.`
      : `코스피가 ${num(kospi.price)}(${pct(kospi.changePct)})로 마감했습니다. 지수만 보면 ${rise ? '상승' : '하락'}으로 끝나지만, 장 안에서 실제로 돈이 움직인 곳은 따로 있습니다. 아래 표부터 보시면 오늘 시장 온도가 잡힙니다.`;

    /* ---- 쇼츠 ---- */
    const hookCap = '오늘 돈이 몰린 곳은?';
    const cuts = [];
    if (kospi.price) {
      cuts.push({
        caption: `코스피 **${num(kospi.price)}** · 코스닥 **${num(kosdaq.price)}**`,
        narration: `코스피는 ${num(kospi.price)}, 코스닥은 ${num(kosdaq.price)}로 마감했습니다.`
      });
    }
    if (themes[0]) {
      cuts.push({
        caption: `1위 테마 **${themeName(themes[0])}** 평균 ${pct(themes[0].avgPct)}`,
        narration: `오늘 가장 돈이 몰린 테마는 ${themeName(themes[0])}, 평균 ${pct(themes[0].avgPct)}입니다.`
      });
    }
    if (confirmed.length) {
      cuts.push({
        caption: `상한가 확정 **${confirmed[0].name}** 외 ${Math.max(0, confirmed.length - 1)}종목`,
        narration: `상한가 확정은 ${confirmed.slice(0, 2).map(function (s) { return s.name; }).join(', ')}입니다. 거래대금 100억을 넘긴 종목만 셌습니다.`
      });
    } else if (high52.length) {
      cuts.push({
        caption: `52주 신고가 **${high52[0].name}** 등 ${high52.length}종목`,
        narration: `52주 신고가는 ${high52.slice(0, 2).map(function (s) { return s.name; }).join(', ')} 등 ${high52.length}종목입니다.`
      });
    }
    if (!cuts.length) {
      cuts.push({ caption: `거래대금 **${kospi.valueText || '-'}**`, narration: `코스피 거래대금은 ${kospi.valueText || '집계되지 않았습니다'}.` });
    }

    const content = {
      mode: 'stock',
      kicker: KICKERS.stock,
      shortsTitle: `코스피 ${num(kospi.price)} ${pct(kospi.changePct)} 마감`,
      source: {
        label: '주식 관제탑 실시간 (/api/stock-live · /api/tabs-live)',
        short: '주식 관제탑 실시간',
        url: '/index.html',
        asOf: basis
      },
      headline: headline,
      subline: themes.length ? `주도 테마 ${themeName(themes[0])} · ${pct(themes[0].avgPct)}` : '',
      pills: pills,
      facts: facts,
      keywords: themes.map(function (t) { return themeName(t); }).concat(['코스피', '코스닥']),
      summary: summary,
      blog: {
        titleSet: titleSet,
        titles: titleSet.map(function (t) { return t.text; }),
        hook: hook,
        sections: sections,
        points: points,
        closing: closing,
        cta: buildCta('stock'),
        tags: []
      },
      shorts: buildShortsScript({
        hook: { caption: hookCap, narration: `오늘 코스피는 ${num(kospi.price)}, ${pct(kospi.changePct)} 마감했습니다. 어디에 돈이 몰렸는지 50초로 정리합니다.` },
        cuts: cuts,
        cta: { caption: '내일 아침 체크 3가지', narration: '내일 아침에는 테마 지속성, 상한가 종목의 시초가, 환율과 선물 방향 세 가지만 확인하세요.' },
        hashtags: buildHashtags(themes.map(function (t) { return themeName(t); }), 'stock'),
        total: 50
      }),
      notices: [
        { level: 'info', text: `기준 시각: ${basis || '-'} · 출처: 네이버 증권 폴링 + 야후 선물` },
        sessionLabel ? { level: 'info', text: `세션 상태: ${sessionLabel}` } : null,
        isWeekend ? { level: 'warn', text: '주말 휴장 — 직전 거래일 종가 기준입니다. 실시간 시세가 아닙니다.' } : null,
        { level: 'warn', text: '수급(외국인·기관) 금액과 주간/야간 선물 일부는 확정치 또는 내장 값이며, 실시간 체결이 아닙니다.' }
      ].filter(Boolean)
    };
    return finishContent(content);
  }

  /* ============================================================
   * 6. 🎡 특가 레이더 모드
   * ============================================================ */
  function dealPriceNumber(d) {
    const txt = String(dealPriceText(d) || '').replace(/,/g, '');
    const m = txt.match(/(\d{3,})/);
    if (m) return Number(m[1]);
    return Number(d.unit_price) || 0;
  }

  /** 표시용 가격 문구 — '정상 8,000원 → 카톡 특가 7,000원 (12% 할인)' 같은 문장에서 실제 특가만 */
  function dealPriceText(d) {
    const raw = String(d.deal_price || '').trim();
    if (/^[\d,]{3,}\s*원/.test(raw)) return raw;
    const info = String(d.price_info || '').trim();
    const arrow = info.split(/→/);
    const cand = arrow.length > 1 ? arrow[arrow.length - 1] : info;
    const matches = String(cand).match(/[\d,]{3,}\s*원~?/g) || String(raw).match(/[\d,]{3,}\s*원~?/g);
    if (matches && matches.length) return matches[matches.length - 1].replace(/\s+/g, '');
    if (info) return clamp(info.replace(/\s+/g, ' '), 40);
    return raw || '-';
  }

  /** '동탄 4인 가족' 눈높이 순서: 국내 체험/테마파크 → 국내 숙소 → 해외 */
  function pickFamilyDeals(deals, limit) {
    const A = [], B = [], C = [];
    const seen = new Set();
    (deals || []).forEach(function (d) {
      const key = String((d && d.title) || '').replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) return;   // 같은 상품이 중복으로 들어오면 한 번만
      seen.add(key);
      const overseas = /overseas/.test(String(d.type || ''));
      const lodging = /stay|resort|snow|city/.test(String(d.theme || ''))
        && !/themepark|kids_cafe|museum/.test(String(d.category || ''))
        || /호텔|리조트|풀빌라|글램핑|펜션|콘도|룸온리/.test(String(d.title || ''));
      if (overseas) C.push(d);
      else if (lodging) B.push(d);
      else A.push(d);
    });
    const quotaA = Math.min(A.length, Math.max(3, limit - 2));
    const out = A.slice(0, quotaA);
    if (out.length < limit) out.push.apply(out, B.slice(0, 1));
    if (out.length < limit) out.push.apply(out, C.slice(0, 1));
    if (out.length < limit) out.push.apply(out, A.slice(quotaA).concat(B.slice(1), C.slice(1)).slice(0, limit - out.length));
    return out.slice(0, limit || 5);
  }

  function titleOf(d) {
    return clamp(String((d && d.title) || '').replace(/^[^\w가-힣]+/, ''), 60);
  }

  /** 제목·자막용 짧은 이름 — 괄호(지점·층·기준)를 덜어낸다 */
  function shortTitle(d) {
    const raw = String((d && d.title) || '')
      .replace(/^[^\w가-힣]+/, '')
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s*（[^）]*）/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return clamp(raw || titleOf(d), 24);
  }

  /** 위치를 짧게 — 도로명까지 다 넣으면 표가 깨진다 */
  function shortPlace(d) {
    const raw = String(d.region || d.location || '-').replace(/\s+/g, ' ').trim();
    if (!raw) return '-';
    if (raw.length <= 20) return raw;
    const parts = raw.split(' ');
    return parts.slice(0, 3).join(' ');
  }

  /** 스캔 팁 문장을 문장 경계에서 자른다 */
  function tipOf(d) {
    const t = String((d && d.tips) || '')
      .replace(/^★\s*실측 확인:\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    const cut = t.split(/(?<=[.!?])\s/)[0] || t;
    return clamp(cut, 90);
  }

  function buildFromDeals(payload) {
    const deals = payload.deals || {};
    const travel = deals.travelDeals || [];
    const kids = deals.kidsDeals || [];
    const meta = deals.meta || {};
    const kst = kstNow();
    const isWeekend = kst.dow === 0 || kst.dow === 6;
    const top = pickFamilyDeals(kids.concat(travel), 5);
    const kidsTop = pickFamilyDeals(kids, 3);
    const travelTop = pickFamilyDeals(travel, 2);

    const prices = top.map(dealPriceNumber).filter(function (n) { return n > 0; });
    const minPrice = prices.length ? Math.min.apply(null, prices) : 0;
    const maxPrice = prices.length ? Math.max.apply(null, prices) : 0;
    const firstPrice = top[0] ? dealPriceText(top[0]) : '';

    const headline = `동탄 4인 가족 ${isWeekend ? '이번 주말' : '다음 주말'} 이 가격에 가볼 만한 곳 ${top.length}곳`;
    const pills = top.slice(0, 4).map(function (d) { return clamp(titleOf(d), 22); });

    const facts = top.map(function (d) {
      return { k: clamp(titleOf(d), 26), v: `${dealPriceText(d)} · ${d.region || d.location || ''}` };
    });

    const summary = [];
    top.slice(0, 4).forEach(function (d) {
      const price = dealPriceText(d);
      const benefit = String(d.benefit_tag || d.discount || '').replace(/\s+/g, ' ').trim();
      const dup = benefit && price.indexOf(benefit) === -1 ? ' · ' + clamp(benefit, 26) : '';
      summary.push(`${clamp(titleOf(d), 40)} — ${price}${dup}, ${d.region || d.location || ''}`);
    });
    if (meta.scannedAt) summary.push(`가격은 ${meta.scannedAt} 실측 스캔 기준이며, 예약 화면에서 날짜·인원에 따라 달라질 수 있습니다.`);

    /* ---- 표: 비교 ---- */
    const rows = top.map(function (d) {
      const where = shortPlace(d);
      const memo = d.family_fit ? oneLine(d.family_fit, 30) : (d.benefit_tag ? oneLine(d.benefit_tag, 28) : (tipOf(d) ? oneLine(tipOf(d), 30) : '-'));
      return [shortTitle(d), dealPriceText(d), where, memo];
    });

    const sections = [
      {
        h2: '이번 주말, 이 가격이면 갈 만합니다',
        lead: '판매 화면에서 실제로 확인된 가격만 담았습니다. 확인되지 않은 평점·할인율은 비워 뒀습니다.',
        paras: [
          `${meta.scannedAt ? meta.scannedAt + ' 스캔 기준으로 ' : ''}여행 ${travel.length}건 · 키즈 ${kids.length}건 중에서 4인 가족 기준으로 ${top.length}곳을 골랐습니다. 가격은 1인권과 4인 기준이 섞여 있으니 표의 가격 옆 조건을 꼭 같이 보세요.`,
          isWeekend
            ? '오늘 바로 움직인다면 이동 시간과 주차 조건부터 확인하세요. 동탄 기준 자차 40분~1시간 30분이면 당일 코스로 충분합니다.'
            : '주말 예약은 금요일 저녁에 마감되는 경우가 많습니다. 날짜를 먼저 잡아 두면 가격이 덜 흔들립니다.'
        ],
        items: [],
        table: tableOf(['장소', '가격', '위치', '한 줄 포인트'], rows, clamp(meta.scannedAt ? `실측 스캔 ${meta.scannedAt} · ${meta.source || ''}` : '실측 스캔 기준', 110))
      },
      {
        h2: '아이와 가기 좋은 곳 — 키즈·실내',
        lead: '날씨 영향을 덜 받고, 미취학·초등이 함께 놀기 좋은 곳부터 정리했습니다.',
        paras: [],
        items: kidsTop.map(function (d) {
          return `${clamp(titleOf(d), 44)} — ${dealPriceText(d)} · ${d.location || ''}${d.tips ? ' · ' + tipOf(d) : ''}`;
        })
      },
      {
        h2: '1박으로 쉬어가는 코스',
        lead: '숙소는 4인 기준 객실인지, 조식·부대시설이 포함인지까지 확인해야 실제 결제 금액이 맞습니다.',
        paras: [],
        items: travelTop.map(function (d) {
          return `${clamp(titleOf(d), 44)} — ${dealPriceText(d)} · ${d.region || ''}${d.family_fit ? ' · ' + clamp(d.family_fit, 60) : ''}`;
        })
      },
      {
        h2: '예약 전 체크리스트',
        lead: '가격은 실측 시점 기준입니다. 결제 직전 화면에서 이 다섯 가지만 다시 보세요.',
        paras: [],
        items: [
          '이용일·시간 지정 여부 (당일 취소 불가 상품이 많습니다)',
          '인원 기준 — 4인 기준인지, 1인권이라 4장 필요한지',
          '주차 무료 시간과 초과 요금',
          '현장 결제 항목(수영장·바베큐 등)이 따로 있는지',
          '36개월 미만 무료 여부·키 제한'
        ]
      }
    ];

    const points = [
      { t: '인원 기준을 먼저 맞춘다', d: '1인권 상품은 4장을 사야 하고, 패밀리룸은 4인 기준인지 초과 요금이 붙는지 확인해야 합니다. 표의 가격은 상품 표기 기준입니다.' },
      { t: '주말·공휴일 가격을 따로 본다', d: '같은 상품도 날짜를 바꾸면 가격이 달라집니다. 예약 화면에서 이용일을 먼저 넣고 가격을 확인하세요.' },
      { t: '취소 규정과 현장 결제', d: '당일 취소 불가 상품이 많습니다. 수영장·바베큐처럼 현장에서 따로 내는 항목이 있으면 총액이 달라집니다.' }
    ];

    const closing = top[0]
      ? `한 줄로 정리하면, ${shortTitle(top[0])}부터 확인하세요. ${firstPrice}${josa(firstPrice, '은', '는')} 스캔 시점 가격이니 예약 화면이 마지막 기준입니다.`
      : '한 줄로 정리하면, 이번 주말은 예약 화면에서 날짜를 먼저 넣고 가격을 확인하는 것부터 시작하세요.';

    const titleSet = makeTitleSet([
      { kind: 'curiosity', text: top[1] ? `${shortTitle(top[0])} vs ${shortTitle(top[1])} — 4인 가족에게 유리한 쪽은?` : (top[0] ? `${shortTitle(top[0])}, 정말 이 가격에 갈 수 있을까?` : '동탄 4인 가족, 이번 주말 어디 갈까?') },
      { kind: 'numbers', text: `동탄 4인 가족 특가 ${top.length}곳 — 최저 ${won(minPrice)}부터` },
      { kind: 'summary', text: `${kst.short} 가족 나들이 정리 — 가격·위치·주차 한 번에 비교` }
    ]);

    const hook = top.length
      ? `이번 주말, 아이 둘 데리고 나가려면 결국 '가격 · 이동 시간 · 주차' 세 가지에서 갈립니다. 실제 판매 화면에서 확인된 ${top.length}곳을 표로 먼저 비교해 보세요.`
      : '이번 스캔에서 4인 가족 기준으로 바로 추천할 특가를 찾지 못했습니다.';

    const cutItems = top.slice(0, 3).map(function (d) {
      return {
        caption: `${shortTitle(d)} **${dealPriceText(d)}**`,
        narration: `${shortTitle(d)}, ${dealPriceText(d)}입니다.`
      };
    });
    if (!cutItems.length) cutItems.push({ caption: '이번 주 스캔 결과 확인', narration: '이번 주 스캔 결과를 확인해 보세요.' });
    cutItems.push({
      caption: '가격은 예약 화면이 마지막 기준',
      narration: '가격은 스캔 시점 기준이니 예약 화면에서 날짜와 인원을 넣고 한 번 더 확인하세요.'
    });

    const content = {
      mode: 'deals',
      kicker: KICKERS.deals,
      shortsTitle: `동탄 4인 가족 ${isWeekend ? '주말' : '주말'} 나들이 ${top.length}곳`,
      source: {
        label: '패밀리 특가 레이더 (/deals.html 실측 스캔)',
        short: '패밀리 특가 레이더',
        url: '/deals.html',
        asOf: meta.scannedAt || ''
      },
      headline: headline,
      subline: top[0] ? `${clamp(titleOf(top[0]), 28)} ${dealPriceText(top[0])}` : '',
      pills: pills,
      facts: facts,
      keywords: ['동탄', '가족나들이', '키즈카페', '여행특가', '주말나들이'],
      summary: summary.slice(0, 5),
      blog: {
        titleSet: titleSet,
        titles: titleSet.map(function (t) { return t.text; }),
        hook: hook,
        sections: sections,
        points: points,
        closing: closing,
        cta: buildCta('deals'),
        tags: []
      },
      shorts: buildShortsScript({
        hook: top[0]
          ? { caption: `이번 주말 **${top.length}곳** 골랐습니다`, narration: `이번 주말 동탄에서 4인 가족이 갈 만한 곳 ${top.length}곳, 가격부터 비교합니다.` }
          : { caption: '이번 주 동탄 가족 나들이', narration: '이번 주 동탄 가족 나들이 특가를 정리했습니다.' },
        cuts: cutItems,
        cta: { caption: '저장해 두고 예약 전 확인', narration: '마음에 드는 곳은 저장해 두고, 예약 화면에서 가격과 운영 시간을 꼭 확인하세요.' },
        hashtags: buildHashtags(['동탄', '가족나들이', '키즈카페'], 'deals'),
        total: 50
      }),
      notices: [
        meta.scannedAt ? { level: 'info', text: `실측 스캔: ${meta.scannedAt} · ${meta.source || ''}` } : null,
        { level: 'warn', text: '가격·운영시간은 실측 시점 기준입니다. 결제 화면에서 날짜·인원에 따라 달라집니다.' },
        { level: 'warn', text: '확인되지 않은 평점·후기·할인율은 비워 두었습니다(추정값을 넣지 않았습니다).' }
      ].filter(Boolean)
    };
    return finishContent(content);
  }

  /* ============================================================
   * 7. ▶️ 유튜브 요약 모드
   * ============================================================ */
  function buildFromVideo(payload) {
    const video = payload.video || {};
    const parsed = parseTranscript(payload.transcript || '');
    const kst = kstNow();
    const title = video.title || '유튜브 영상';
    const channel = video.channel || '';
    const points = summarizeText({ segments: parsed.segments, text: parsed.text, maxLines: 5 });
    const hasTranscript = points.length >= 1 && (parsed.text || '').length >= 60;

    if (!hasTranscript) {
      const titleSetNone = makeTitleSet([
        { kind: 'curiosity', text: `${clamp(title, 40)} — 자막이 없어 요약을 만들지 않았습니다` },
        { kind: 'numbers', text: `${clamp(title, 40)} · 자막 미확인` },
        { kind: 'summary', text: `${clamp(title, 44)} — 영상 정보만 확인` }
      ]);
      return finishContent({
        mode: 'video',
        kicker: KICKERS.video,
        ok: false,
        source: { label: '유튜브', short: '유튜브', url: video.url || '', asOf: kst.label },
        headline: title,
        subline: channel,
        pills: channel ? [channel] : [],
        facts: [],
        keywords: tokenize(title).slice(0, 5),
        summary: [],
        blog: { titleSet: titleSetNone, titles: titleSetNone.map(function (t) { return t.text; }), hook: '', sections: [], points: [], closing: '', cta: buildCta('video'), tags: [] },
        shorts: buildShortsScript({ hook: { caption: title, narration: title }, cuts: [], cta: { caption: '자막이 필요합니다', narration: '자막이 없어 대본을 만들지 않았습니다.' }, total: 50 }),
        notices: [{ level: 'warn', text: '자막이 없어 요약을 만들지 않았습니다. 가짜 요약은 생성하지 않습니다.' }],
        reason: 'no_captions'
      });
    }

    const allText = parsed.text;
    const rankAll = keywordRank(allText, 14);
    const key3 = rankAll.slice(0, 3).map(function (x) { return x.w; });
    const summary = points.map(function (p) {
      return (p.t !== null && p.t !== undefined ? `[${fmtTime(p.t)}] ` : '') + p.text;
    });

    const headline = clamp(title, 60);
    const subline = channel ? `${channel} · ${fmtTime(video.duration || 0)}` : '';
    const pills = [channel || '', key3.join(' · ')].filter(Boolean);

    /* 구간별 정리: 타임라인 3분할 + 각 구간의 핵심 문장 */
    const thirds = [[], [], []];
    const segs = parsed.segments.filter(function (s) { return s && s.text; });
    const dur = video.duration || (segs.length ? segs[segs.length - 1].t : 0) || 0;
    points.forEach(function (p) {
      const t = p.t === null || p.t === undefined ? 0 : p.t;
      const idx = Math.min(2, Math.floor((t / Math.max(1, dur)) * 3));
      thirds[idx].push(p);
    });

    const sections = [];
    sections.push({
      h2: '영상 한 줄 결론',
      lead: '영상에서 가장 먼저 남는 문장 하나입니다.',
      paras: [points[0].text],
      items: []
    });
    sections.push({
      h2: '핵심 5줄 요약',
      lead: '영상에서 실제로 말한 문장 중 핵심만 시간 순으로 추렸습니다.',
      paras: [],
      items: points.map(function (p, i) {
        return `${i + 1}. ${p.text}${p.t !== null && p.t !== undefined ? ` (${fmtTime(p.t)})` : ''}`;
      })
    });

    const partNames = ['도입 — 문제 제기', '본론 — 근거와 사례', '정리 — 결론과 시사점'];
    const pickedText = new Set(points.map(function (p) { return p.text; }));
    thirds.forEach(function (group, i) {
      const from = dur ? dur * i / 3 : 0;
      const to = dur ? dur * (i + 1) / 3 : Infinity;
      const extras = [];
      segs.forEach(function (s) {
        if (s.t === null || s.t === undefined) return;
        if (dur && (s.t < from || s.t >= to)) return;
        splitSentences(s.text).forEach(function (sent) {
          if (pickedText.has(sent)) return;
          if (sent.length < 18 || sent.length > 150) return;
          if (extras.indexOf(sent) !== -1) return;
          extras.push(sent);
        });
      });
      if (!group.length && !extras.length) return;
      const range = dur ? ` (${fmtTime(from)}~${fmtTime(to)})` : '';
      sections.push({
        h2: `${partNames[i]}${range}`,
        lead: '',
        paras: []
          .concat(group.length ? [group.map(function (p) { return p.text; }).join(' ')] : [])
          .concat(extras.slice(0, 2)),
        items: []
      });
    });

    const kwRows = rankAll.slice(0, 6).map(function (x) { return [x.w, x.n + '회']; });
    sections.push({
      h2: '키워드로 다시 보기',
      lead: '자막 전체에서 가장 자주 나온 단어입니다. 영상의 무게중심이 어디인지 보여 줍니다.',
      paras: [],
      items: [],
      table: tableOf(['키워드', '언급'], kwRows, `자막 ${parsed.segments.length ? parsed.segments.length + '구간' : '전문'} · ${(parsed.text || '').length.toLocaleString()}자 기준`)
    });

    sections.push({
      h2: '이 영상에서 확인해야 할 점',
      lead: '요약은 자막 추출이라, 화면에만 나온 숫자는 빠져 있을 수 있습니다.',
      paras: [
        `영상은 ${channel || '해당 채널'}에서 ${video.duration ? fmtTime(video.duration) + ' 분량으로 ' : ''}다뤘습니다. 자막에서 뽑은 내용이라 영상에 없는 해석이나 추정은 넣지 않았습니다.`
      ],
      items: []
    });

    const pointsOut = [
      { t: '말한 문장과 해석을 구분한다', d: '이 글의 요약은 자막에 실제로 있는 문장입니다. 해석이 필요한 부분은 따로 표시해 두고 읽으세요.' },
      { t: '숫자는 영상 화면과 대조한다', d: '자막은 숫자를 잘못 인식하는 경우가 있습니다. 중요한 수치는 영상 화면이나 설명란에서 한 번 더 확인하세요.' },
      { t: '자막 오인식 구간을 확인한다', d: `자동 생성 자막${video.captionSource ? '(' + video.captionSource + ')' : ''}은 고유명사를 흔히 틀립니다. 종목명·제품명은 원본에서 확인하는 편이 안전합니다.` }
    ];

    const closing = points[0]
      ? `한 줄로 정리하면, 이 영상의 핵심은 "${clamp(points[0].text, 70)}"입니다.`
      : `한 줄로 정리하면, ${clamp(title, 30)}의 핵심은 자막에 담긴 그대로입니다.`;

    const titleSet = makeTitleSet([
      { kind: 'curiosity', text: `이 영상에서 진짜 중요한 말은 ${points.length}문장이었습니다` },
      { kind: 'numbers', text: `${fmtTime(video.duration || 0)} 영상 → 핵심 ${points.length}줄 · 구간 ${segs.length}개 정리` },
      { kind: 'summary', text: `${clamp(title, 40)} — 자막에서 직접 뽑은 핵심 정리` }
    ]);

    const hook = `"${clamp(title, 46)}"${channel ? ' (' + channel + ')' : ''} 영상에서 실제로 말한 문장만 골랐습니다. 자막 ${segs.length ? segs.length + '구간' : '전문'}에서 남은 핵심은 ${points.length}줄입니다.`;

    const hookPoint = points[0] ? points[0].text : title;
    const cutSource = points.slice(1, 4).map(function (p) {
      return { caption: clamp(p.text, 46), narration: p.text };
    });
    if (!cutSource.length) cutSource.push({ caption: clamp(title, 40), narration: title });

    const content = {
      mode: 'video',
      kicker: KICKERS.video,
      shortsTitle: clamp(title, 28),
      ok: true,
      source: {
        label: `유튜브 — ${channel || '채널 미확인'}`,
        short: channel ? '유튜브 · ' + channel : '유튜브',
        url: video.url || '',
        asOf: video.fetchedAt || kst.label
      },
      headline: headline,
      subline: subline,
      pills: pills,
      facts: [
        { k: '영상 제목', v: title },
        { k: '채널', v: channel || '-' },
        { k: '길이', v: video.duration ? fmtTime(video.duration) : '-' },
        { k: '자막', v: `${parsed.segments.length ? parsed.segments.length + '구간' : '전문'} · ${(video.captionSource || '직접 입력/붙여넣기')}` }
      ],
      keywords: key3,
      summary: summary,
      blog: {
        titleSet: titleSet,
        titles: titleSet.map(function (t) { return t.text; }),
        hook: hook,
        sections: sections,
        points: pointsOut,
        closing: closing,
        cta: buildCta('video'),
        tags: []
      },
      shorts: buildShortsScript({
        hook: { caption: `핵심은 **${points.length}문장**`, narration: `${channel ? channel + ' 영상, ' : ''}자막에서 핵심 ${points.length}문장만 뽑았습니다.` },
        cuts: cutSource,
        cta: { caption: '영상 전체는 고정 댓글 링크', narration: '영상 전체가 궁금하면 고정 댓글의 원본 링크를 확인하세요.' },
        hashtags: buildHashtags(key3, 'video'),
        total: 50
      }),
      notices: [
        { level: 'info', text: `자막 ${parsed.segments.length ? parsed.segments.length + '개 구간' : '전문'}에서 추출 요약 — 영상에 없는 내용은 생성하지 않았습니다.` },
        video.captionSource ? { level: 'info', text: `자막 출처: ${video.captionSource}` } : null,
        video.duration ? { level: 'info', text: `영상 길이: ${fmtTime(video.duration)}` } : null
      ].filter(Boolean)
    };
    return finishContent(content);
  }

  /* ============================================================
   * 8. ✍️ 자유 주제/키워드 모드
   * ============================================================ */
  function buildFromTopic(payload) {
    const keyword = clamp(payload.keyword || '', 60);
    const memo = String(payload.memo || '').trim();
    const kst = kstNow();
    const points = memo ? summarizeText({ text: memo, maxLines: 5 }) : [];
    const templates = payload.template || 'info';

    if (!keyword) return null;

    const summary = points.length
      ? points.map(function (p) { return p.text; })
      : [`키워드: ${keyword}`, '메모가 비어 있어 뼈대만 만들었습니다. [ ] 자리에 실제 내용을 채우면 그대로 발행할 수 있습니다.'];

    const sections = [];
    sections.push({
      h2: '왜 이 주제인가',
      lead: memo ? '메모로 주신 내용에서 출발합니다.' : '확인된 내용만으로 뼈대를 잡았습니다.',
      paras: points.length
        ? paraSplit(points[0].text)
        : [`${keyword}에 대해 정리합니다. 이 글은 메모로 받은 내용만으로 작성됐고, 확인되지 않은 수치나 사례는 넣지 않았습니다.`],
      items: []
    });

    if (points.length > 1) {
      sections.push({
        h2: '핵심 정리',
        lead: '메모에서 뽑은 핵심 문장을 순서대로 정리했습니다.',
        paras: [],
        items: points.slice(1).map(function (p) { return p.text; })
      });
    } else {
      sections.push({
        h2: '핵심 정리',
        lead: '아래 네 칸을 채우면 글이 됩니다.',
        paras: [],
        items: [
          `① ${keyword}이 중요한 이유 — [한 문장]`,
          '② 실제 사례·수치 — [확인한 자료 1개]',
          '③ 내 경험·의견 — [직접 겪은 내용]',
          '④ 주의할 점 — [반대 의견이나 한계]'
        ]
      });
    }

    sections.push({
      h2: '적용 방법',
      lead: templates === 'review' ? '직접 써 본 기준으로 좋았던 점과 아쉬웠던 점을 나눠 씁니다.' : '한 번에 다 하기보다 작은 단위로 나눠 시도하고, 결과를 기록해 두세요.',
      paras: [
        templates === 'review'
          ? `${keyword}를 직접 써 본 기준으로 정리합니다. 좋았던 점과 아쉬웠던 점을 나눠 쓰면 읽는 사람이 판단하기 쉽습니다.`
          : `${keyword}를 실제로 써먹으려면 순서를 정해 두는 게 좋습니다. 아래 단계는 뼈대이니 상황에 맞게 고쳐 쓰세요.`
      ],
      items: templates === 'review'
        ? ['장점 — [ ]', '아쉬운 점 — [ ]', '이런 분께 추천 — [ ]']
        : ['1단계 — [ ]', '2단계 — [ ]', '3단계 — [ ]']
    });

    sections.push({
      h2: '구성안 — 이 순서로 쓰면 읽힙니다',
      lead: '발행 전에 이 표대로 목차를 한 번 점검하세요.',
      paras: [],
      items: [],
      table: tableOf(['파트', '넣을 내용', '분량'], [
        ['도입', `${keyword} — 독자가 겪는 상황 한 문장`, '2~3줄'],
        ['핵심', '[확인한 사실] + [내 기준]', '3~5문단'],
        ['사례', '[직접 겪은 내용] 또는 [자료 1개]', '1~2문단'],
        ['마무리', '한 줄 결론 + 다음 행동', '2줄']
      ], '표는 글 구성 계획입니다. 빈 칸은 확인 후 채우세요.')
    });

    const pointsOut = [
      { t: '첫 문단에서 약속을 먼저 한다', d: `"${keyword}를 읽고 나면 무엇을 알게 되는지"를 첫 세 문장 안에 넣으세요. 독자는 그 약속을 보고 끝까지 읽습니다.` },
      { t: '확인한 것과 추측을 섞지 않는다', d: '수치·사례는 출처가 있는 것만 쓰고, 추측은 "제 생각에는"처럼 표시를 남기면 신뢰가 올라갑니다.' },
      { t: '한 문단 한 가지', d: '문단이 길어지면 끊으세요. 모바일에서는 3~4줄이 한 덩어리로 읽힙니다.' }
    ];

    const closing = `${keyword} — 오늘은 여기까지 정리했습니다. [ ] 자리만 채우면 그대로 발행할 수 있습니다.`;

    const titleSet = makeTitleSet([
      { kind: 'curiosity', text: `${keyword} — 어디서부터 손대야 할까요?` },
      { kind: 'numbers', text: points.length ? `메모 ${points.length}문장으로 만든 ${keyword} 초안` : `${keyword} 글, 4단 구성으로 잡았습니다` },
      { kind: 'summary', text: `${keyword} 정리 노트 — 구성·포인트·주의점` }
    ]);

    const hook = points.length
      ? `메모로 주신 ${points.length}문장을 기준으로 ${keyword} 글을 잡았습니다. 도입에서 약속하고, 확인된 내용만 표로 정리하고, 마지막에 한 줄로 닫는 구조입니다.`
      : `${keyword}로 글을 쓰려면 순서가 먼저입니다. 메모가 비어 있어 뼈대만 잡았고, [ ] 자리를 채우면 그대로 발행할 수 있습니다.`;

    const content = {
      mode: 'topic',
      kicker: KICKERS.topic,
      shortsTitle: clamp(keyword, 26),
      source: { label: '자유 주제 입력', short: '직접 입력', url: '', asOf: kst.label + ' ' + kst.time },
      headline: keyword,
      subline: memo ? clamp(memo, 50) : '메모 없이 뼈대만 생성',
      pills: keyword ? [keyword] : [],
      facts: points.length ? [{ k: '메모 문장', v: points.length + '문장에서 추출' }] : [{ k: '입력', v: '키워드만' }],
      keywords: tokenize(keyword + ' ' + memo).slice(0, 5),
      summary: summary,
      blog: {
        titleSet: titleSet,
        titles: titleSet.map(function (t) { return t.text; }),
        hook: hook,
        sections: sections,
        points: pointsOut,
        closing: closing,
        cta: buildCta('topic'),
        tags: []
      },
      shorts: buildShortsScript({
        hook: { caption: `${keyword}`, narration: `${keyword}, 이 순서로 정리하면 됩니다.` },
        cuts: points.length
          ? points.slice(0, 3).map(function (p) { return { caption: clamp(p.text, 44), narration: p.text }; })
          : [
            { caption: '① 왜 이 주제인가', narration: '첫째, 왜 이 주제를 다루는지 한 문장으로 말합니다.' },
            { caption: '② 확인한 근거', narration: '둘째, 확인한 근거와 수치를 넣습니다.' },
            { caption: '③ 실제 적용', narration: '셋째, 실제로 어떻게 쓰는지 설명합니다.' }
          ],
        cta: { caption: '자세한 내용은 고정 댓글 링크', narration: '자세한 내용은 고정 댓글 링크에서 확인하세요.' },
        hashtags: buildHashtags([keyword], 'topic'),
        total: 50
      }),
      notices: [
        points.length
          ? { level: 'info', text: `메모 ${points.length}문장에서 추출 — 없는 사실은 넣지 않았습니다.` }
          : { level: 'warn', text: '메모가 비어 있어 뼈대만 만들었습니다. [ ] 자리를 채워 주세요.' }
      ]
    };
    return finishContent(content);
  }

  /* ============================================================
   * 9. 📅 요일별 추천
   * ============================================================ */
  function weekdayPlan(now) {
    const kst = kstNow(now);
    const dow = kst.dow;
    const dayName = WEEKDAYS[dow];
    let plan;
    if (dow >= 1 && dow <= 4) {
      plan = {
        kind: '장중·마감 시황',
        chips: [
          { label: '📈 오늘 마감 시황 정리', mode: 'stock', keyword: '' },
          { label: '🔥 주도 테마 3곳만 보기', mode: 'stock', keyword: '주도테마' },
          { label: '👑 상한가·신고가 체크', mode: 'stock', keyword: '상한가' },
          { label: '✍️ 관심 종목 메모 정리', mode: 'topic', keyword: '오늘의 관심종목' }
        ],
        note: `${dayName}요일 — 장 마감(15:30) 후 시황 글을 쓰기 좋은 날입니다. 관제탑 숫자를 그대로 원고로 바꿉니다.`
      };
    } else if (dow === 5) {
      plan = {
        kind: '주간 결산',
        chips: [
          { label: '🏁 이번 주 주도주 결산', mode: 'stock', keyword: '주간결산' },
          { label: '📊 이번 주 테마 3곳 정리', mode: 'stock', keyword: '주간테마' },
          { label: '🎡 주말 나들이 특가 5곳', mode: 'deals', keyword: '' },
          { label: '✍️ 한 주 회고 메모', mode: 'topic', keyword: '한 주 회고' }
        ],
        note: `${dayName}요일 — 한 주를 결산하는 글(주간 주도주·테마)과 주말 나들이 특가를 함께 준비하기 좋은 날입니다.`
      };
    } else {
      plan = {
        kind: '가족 나들이',
        chips: [
          { label: '🎡 동탄 4인 가족 나들이 5곳', mode: 'deals', keyword: '' },
          { label: '❄️ 눈썰매·스키 특가', mode: 'deals', keyword: '눈썰매' },
          { label: '🏛️ 비 오는 날 실내 코스', mode: 'deals', keyword: '실내' },
          { label: '✍️ 아이와 다녀온 곳 후기', mode: 'topic', keyword: '동탄 아이와 가볼 만한 곳' }
        ],
        note: `${dayName}요일 — 아이와 다녀온 곳 후기나 주말 나들이 코스 글이 잘 먹히는 날입니다. 특가 레이더 데이터를 그대로 재료로 씁니다.`
      };
    }
    return { dow: dow, dayName: dayName, label: kst.label, plan: plan };
  }

  /* ============================================================
   * export
   * ============================================================ */
  return {
    VERSION: VERSION,
    weekdayPlan: weekdayPlan,
    kstNow: kstNow,
    normalizeText: normalizeText,
    parseTranscript: parseTranscript,
    summarizeText: summarizeText,
    keywordRank: keywordRank,
    buildFromStocks: buildFromStocks,
    buildFromDeals: buildFromDeals,
    buildFromVideo: buildFromVideo,
    buildFromTopic: buildFromTopic,
    _debug: { splitSentences: splitSentences, tokenize: tokenize },
    buildHashtags: buildHashtags,
    contentToMarkdown: contentToMarkdown,
    contentToHtml: contentToHtml,
    contentToPlain: contentToPlain,
    parseBlogMarkdown: parseBlogMarkdown,
    shortsSpec: shortsSpec,
    shortsToText: shortsToText,
    makeTitleSet: makeTitleSet,
    finishContent: finishContent,
    fmtTime: fmtTime,
    num: num,
    pct: pct,
    clamp: clamp,
    esc: esc,
    stripMd: stripMd
  };
});
