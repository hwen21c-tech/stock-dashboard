#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_hot_items.py — 추천샵(picks.html) 실측 핫템 수집기

원칙
  · 가상 상품·추정 가격·가짜 링크 0건. 모든 값은 이 실행에서 실제로 받아온 응답에서만 만든다.
  · 국내 최저가 : 에누리 가격비교(price.enuri.com) 검색 → 상품 상세의 "최저가 판매처"(판매처·배송·구매링크)
                  판매처 구매링크(Redirect.jsp) 안내 HTML에서 목적지 몰의 상품 URL을 뽑아 compare.domestic.mallUrl 로
                  저장한다 → 카드의 [🛒 최저가 바로가기]가 에누리 카탈로그가 아니라 실제 쇼핑몰 상품 페이지로 직통
  · 해외직구가  : 알리익스프레스(ko.aliexpress.com) 검색 1페이지 상품(제목·USD 가격·이미지·상품 URL)
                  USD→KRW 환율은 open.er-api.com 실시간 고시(실패 시 frankfurter.app)
  · 소스가 막히면 그 항목은 만들지 않고 skipped 에 이유를 남긴다(가짜로 채우지 않는다).

사용
  python3 scripts/fetch_hot_items.py                 # 17건 수집 → 두 저장소 data/ 에 동시 저장
  python3 scripts/fetch_hot_items.py --mall-only     # 기존 JSON에 몰 직통 URL(mallUrl)만 보충
  python3 scripts/fetch_hot_items.py --limit 8       # 앞에서 8건만
  python3 scripts/fetch_hot_items.py --dry-run       # 저장 없이 표만 출력
  python3 scripts/fetch_hot_items.py --keyword 미니블렌더   # 한 항목만 확인

출력 파일
  deploy_repo/data/hot-items-latest.json
  sd_live/public/data/hot-items-latest.json
"""

import argparse
import datetime as dt
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.environ.get('SYNC_REPO_ROOT') or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# 이 저장소(deploy_repo) 안의 파일이 우선. sd_live 사본은 개발 작업 환경에서만 함께 쓴다.
_OUT_CANDS = [
    os.path.join(ROOT, 'data', 'hot-items-latest.json'),
    os.path.join(ROOT, 'deploy_repo', 'data', 'hot-items-latest.json'),
    os.path.join(ROOT, 'sd_live', 'public', 'data', 'hot-items-latest.json'),
]
OUT_PATHS = [p for p in _OUT_CANDS if os.path.isdir(os.path.dirname(p))]

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
KST = dt.timezone(dt.timedelta(hours=9))

# ─────────────────────────────────────────────────────────────
# 수집 대상 — 실제로 많이 찾는 생활·주방·육아·가전·캠핑 핫템
#   ko : 에누리 검색어 / en : 알리익스프레스 검색어 / no : 추천샵 번호(기존 #22 다음부터)
# ─────────────────────────────────────────────────────────────
KEYWORDS = [
    dict(no='23', cat='kitchen', emoji='🥤', ko='미니블렌더', en='portable mini blender usb',
         must=['블렌더'], deny=['커피', '원두', '칼날'],
         tags=['미니블렌더', '휴대용믹서', '인스타템']),
    dict(no='24', cat='kitchen', emoji='🍳', ko='에어프라이어 실리콘 용기', en='air fryer silicone liner',
         must=['에어프라이어'], deny=['종이', '일회용', '호일'],
         tags=['실리콘용기', '에어프라이어', '주방']),
    dict(no='25', cat='kitchen', emoji='☕', ko='전기포트', en='electric kettle stainless',
         must=['포트'], deny=['포트홀더', '받침대', '보온병'],
         tags=['전기포트', '무선포트', '주방가전']),
    dict(no='26', cat='kitchen', emoji='🥤', ko='텀블러', en='stainless steel tumbler vacuum',
         must=['텀블러'], deny=['뚜껑', '빨대', '스트로우', '홀더'],
         tags=['텀블러', '보온병', '스테인리스']),
    dict(no='27', cat='tech', emoji='🔦', ko='캠핑 랜턴', en='rechargeable camping lantern',
         must=['랜턴'], deny=['랜턴커버', '랜턴걸이', '스탠드'], maxPrice=30000,
         tags=['캠핑랜턴', '충전식랜턴', '캠핑']),
    dict(no='28', cat='family', emoji='🍽️', ko='유아 흡착 식판', en='baby suction plate silicone',
         must=['식판'], deny=['반려', '강아지', '고양이', '일회용'],
         tags=['아기식판', '흡착식판', '이유식']),
    dict(no='29', cat='family', emoji='🪥', ko='칫솔살균기', en='toothbrush holder uv',
         must=['살균기'], deny=['칫솔걸이', '칫솔컵', '젖병', '정수'], maxPrice=60000,
         tags=['칫솔살균기', '어린이칫솔', '위생']),
    dict(no='30', cat='tech', emoji='💧', ko='미니 가습기', en='mini humidifier usb',
         must=['가습기'], deny=['필터', '리필', '교체', '제습기'], maxPrice=100000,
         tags=['미니가습기', '무드등', '사무실']),
    dict(no='31', cat='tech', emoji='💆', ko='목어깨 마사지기', en='neck shoulder massager heated',
         must=['어깨'], deny=['안마의자', '발마사지', '쿠션'], maxPrice=150000,
         tags=['목마사지기', '넥마사지', '온열']),
    dict(no='32', cat='tech', emoji='📱', ko='차량용 무선충전 거치대', en='car wireless charger mount',
         must=['거치대'], deny=['자전거', '케이스', '파우치'],
         tags=['무선충전', '거치대', '차량용품']),
    dict(no='33', cat='tech', emoji='🔋', ko='보조배터리', en='power bank 20000mah',
         must=['보조배터리', '배터리팩'], deny=['케이스', '파우치', '거치대'],
         tags=['보조배터리', '고속충전', '대용량']),
    dict(no='34', cat='deal', emoji='🛏️', ko='전기요', en='electric heating blanket bed',
         must=['전기요'], deny=['전기요금', '커버', '매트커버'], maxPrice=80000,
         tags=['전기요', '온수매트', '겨울가전']),
    dict(no='35', cat='deal', emoji='🪑', ko='접이식 캠핑의자', en='folding camping chair',
         must=['의자'], deny=['의자커버', '방석', '쿠션'], maxPrice=100000,
         tags=['캠핑의자', '접이식의자', '캠핑']),
    dict(no='36', cat='kitchen', emoji='🧺', ko='빨래건조대', en='foldable clothes drying rack',
         must=['건조대'], deny=['식기건조대', '신발건조', '과일건조'], maxPrice=80000,
         tags=['빨래건조대', '접이식', '생활']),
    # ── IT·가성비 브랜드(11/22 추가) — 브랜드+모델번호가 양쪽(에누리·알리)에 실제로 적혀 있어
    #    '✅ 동일 모델' 판정이 진짜로 성립하는 품목. 규격(용량·출력)만 같은 상품은 similar로 내린다.
    dict(no='37', cat='tech', emoji='🖱️', ko='로지텍 MX Master 3S', en='Logitech MX Master 3S mouse',
         must=['Master 3S'], deny=['콤보', 'COMBO', '세트', '케이스', '파우치', '그립', '피트'],
         tags=['무선마우스', 'MX마스터', '로지텍']),
    dict(no='38', cat='tech', emoji='🎮', ko='로지텍 G304 무선마우스', en='Logitech G304 wireless mouse',
         must=['G304'], deny=['콤보', 'COMBO', '세트', '케이스', '파우치', '그립', '피트', '키스킨'],
         tags=['게이밍마우스', 'G304', '가성비']),
    dict(no='39', cat='tech', emoji='🎧', ko='로지텍 G435 무선 헤드셋', en='Logitech G435 wireless headset',
         must=['G435'], deny=['케이스', '파우치', '이어패드', '교체', '거치대'],
         tags=['게이밍헤드셋', '무선헤드셋', '로지텍']),
]

ENURI_SEARCH = 'https://price.enuri.com/search?keyword={q}&_rsc=1'
ENURI_CATALOG = 'https://price.enuri.com/catalog/{id}?_rsc=1'
# 에누리 '판매처 구매' 링크(Redirect.jsp)는 30x가 아니라 HTTP 200 안내 HTML이고,
# 그 안의 location.href 에 목적지 몰의 상품 URL이 그대로 들어 있다 → 카드의 [🛒 최저가 바로가기]는 이 URL로 직통.
MALL_SKIP = ('enuri.com', 'enuri.info', 'danuri.io', 'googletagmanager', 'google', 'facebook',
             'youtube', 'kakao', 'gscdn', 'doubleclick', 'w3.org', 'naver.net', 'pstatic',
             '11dims', 'daumcdn')
ALI_SEARCH = 'https://ko.aliexpress.com/w/wholesale-{q}.html'
FX_URLS = ['https://open.er-api.com/v6/latest/USD',
           'https://api.frankfurter.app/latest?from=USD&to=KRW']

EXCLUDE_CONDI = re.compile(r'중고|렌탈|임대|반납|해외구매|전시|리퍼')
# 본품이 아닌 부속품·소모품(교체용 램프, 전용 필터 등)은 핫템 카드에서 제외
EXCLUDE_PART = re.compile(r'전용|교체용|교체형|소모품|리필|부품|단체용|업소용|영업용')

# 카드에 쓸 수 없는 사진(광고 배지·상품 일부 확대)만 골라 쓴 수동 지정.
# 키는 에누리 상품명 그대로 — 상품이 바뀌면 자동으로 무시되고 자동 선택으로 돌아간다.
IMG_OVERRIDE = {
    # 대표컷이 제품 몸통만 크게 확대된 흰 상자 사진이라 상품을 알아볼 수 없음
    # → 같은 오투케어 '헤드형'(BS-3000) 카탈로그의 뚜껑 열린 정면 컷
    '메디슨 오투케어 헤드형 칫솔살균기':
        'https://img.danuri.io/catalog-image/612/247/116/04ed7008a348425b91b4920290e0f2ea.jpg',
    # 대표컷이 크림색 제품을 흰 바탕에 정면으로만 찍어 카드에서 형태가 거의 안 보임
    # → 포트 3개와 케이블이 함께 나온 같은 상품 컷
    '삼성전자 PD PPS 45W 보조배터리 EB-P4520 20000mAh':
        'https://img.danuri.io/catalog-image/972/284/042/d1530186f0fa490b86ceed35541fd34c.jpeg',
}

# 에누리 카탈로그가 직접 보관하는 대표 상품컷(판매처 광고 배지가 붙지 않은 원본)
CLEAN_IMG_RE = re.compile(
    r'https://photo3\.enuri\.info/data/images/service/(?:dnw/master|big|middle)/\d+/\d+\.(?:jpg|jpeg|png)')

CTX = ssl.create_default_context()


def log(*a):
    print(*a, flush=True)


def http_get(url, referer=None, timeout=25, tries=2):
    last = None
    for n in range(tries):
        try:
            headers = {
                'User-Agent': UA,
                'Accept': 'text/x-component, text/html, application/json, */*',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
                'RSC': '1',
            }
            if referer:
                headers['Referer'] = referer
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                return r.read().decode('utf-8', 'ignore')
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.8 + n)
    raise last


def extract_block(s, start, open_ch='{', close_ch='}'):
    """start 위치의 open_ch 부터 짝이 맞는 close_ch 까지 (문자열 내부 무시)."""
    depth, instr, esc = 0, False, False
    for i in range(start, len(s)):
        c = s[i]
        if instr:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                instr = False
        elif c == '"':
            instr = True
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return s[start:i + 1]
    return None


def json_after(s, key, open_ch='{'):
    i = s.find(key)
    if i < 0:
        return None
    j = s.find(open_ch, i + len(key))
    if j < 0:
        return None
    blob = extract_block(s, j, open_ch, ']' if open_ch == '[' else '}')
    if not blob:
        return None
    try:
        return json.loads(blob)
    except Exception:  # noqa: BLE001
        return None


def clean(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()


# ─────────────────────────────────────────────────────────────
# 1) 국내 최저가 — 에누리
# ─────────────────────────────────────────────────────────────
def enuri_candidates(query, limit=8):
    html = http_get(ENURI_SEARCH.format(q=urllib.parse.quote(query)), referer='https://price.enuri.com/')
    data = json_after(html, '"initProductList":')
    if not data or not isinstance(data.get('items'), list):
        return []
    out = []
    for it in data['items']:
        if not isinstance(it, dict) or it.get('type') == 'ad':
            continue
        pid = clean(it.get('id'))
        name = clean(it.get('name'))
        price = ((it.get('priceInfo') or {}).get('price')) or 0
        try:
            price = int(price)
        except (TypeError, ValueError):
            price = 0
        if not pid or pid == '0' or not name or price <= 0:
            continue      # id '0' 은 목록에 섞이는 빈 카드(상세 페이지 없음)
        if it.get('isSoldOut') or it.get('isRental'):
            continue
        if EXCLUDE_CONDI.search(clean(it.get('condiName'))):
            continue
        if EXCLUDE_PART.search(name):
            continue
        thumb = it.get('thumbnail') or {}
        out.append({
            'id': pid,
            'name': name,
            'condi': clean(it.get('condiName')),
            'listPrice': price,
            'img': thumb.get('imageUrl') or thumb.get('fallbackImageUrl') or '',
            'url': 'https://price.enuri.com' + (it.get('link') or '/catalog/' + pid),
            'description': clean(it.get('description')),
            'mallCount': int(it.get('mallCount') or 0),
            'rating': (it.get('rating') or {}).get('ratingValue'),
            'reviewCount': (it.get('rating') or {}).get('reviewCount'),
            'specs': it.get('specs') or [],
        })
        if len(out) >= limit:
            break
    return out


# ─────────────────────────────────────────────────────────────
# 1-b) 진짜 쇼핑몰 직통 URL (에누리 Redirect.jsp → 목적지 몰 상품 URL)
# ─────────────────────────────────────────────────────────────
def _canon_mall(url):
    """(몰 이름, 상품 직통 URL) — 몰마다 상품 식별자만 남긴 짧은 주소로 정규화."""
    try:
        host = urllib.parse.urlparse(url).netloc.lower()
    except Exception:  # noqa: BLE001
        return None, None
    if '11st.co.kr' in host:
        m = re.search(r'prdNo=(\d+)', url) or re.search(r'/products/(\d+)', url)
        return ('11번가', 'https://www.11st.co.kr/products/%s' % m.group(1)) if m else (None, None)
    if 'gmarket.co.kr' in host:
        m = (re.search(r'item-?[nN]o=(\d+)', url) or re.search(r'goodscode=(\d+)', url)
             or re.search(r'/vi/product/(\d+)', url))
        return ('G마켓', 'https://item.gmarket.co.kr/Item?goodscode=%s' % m.group(1)) if m else (None, None)
    if 'auction.co.kr' in host:
        # 옥션은 gate/pcs 주소 자체가 상품 진입점 — sub-id·service-code를 떼면 400이 나므로 원본 그대로 둔다
        m = re.search(r'item-?[nN]o=([A-Za-z]?\d+)', url)
        return ('옥션', url) if m else (None, None)
    if 'lotteon.com' in host:
        m = re.search(r'/p/product/([A-Za-z0-9]+)', url) or re.search(r'productNo=(\d+)', url)
        return ('롯데ON', 'https://www.lotteon.com/p/product/%s' % m.group(1)) if m else (None, None)
    if 'ssg.com' in host:
        m = re.search(r'itemId=(\d+)', url)
        return ('SSG.COM', 'https://www.ssg.com/item/itemView.ssg?itemId=%s' % m.group(1)) if m else (None, None)
    if 'smartstore.naver.com' in host or 'brand.naver.com' in host:
        # 스마트스토어는 스토어 ID가 노출되지 않아 에누리 inflow 관문 주소를 그대로 쓴다(도메인은 smartstore.naver.com).
        return ('네이버 스마트스토어', url) if 'inflow' in url else (None, None)
    if 'coupang.com' in host and '/vp/' in url:
        return '쿠팡', url
    return None, None


def _clean_query(url):
    """추적 파라미터(utm_*·bp_sub_id_* 등)를 떼고 상품 식별 파라미터만 남긴다."""
    try:
        p = urllib.parse.urlsplit(url)
    except Exception:  # noqa: BLE001
        return url
    keep = []
    for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True):
        if re.match(r'^(item-?no|goodscode|prdNo|itemId|productNo|spdtNo|sitmNo|id)$', k, re.I):
            keep.append((k, v))
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(keep), ''))


HOST_NAMES = {'ohou.se': '오늘의집', 'coupang.com': '쿠팡', 'g9.co.kr': 'G9', 'emart.ssg.com': 'SSG'}


def mall_direct(buy_url):
    """Redirect.jsp 안내 HTML에서 목적지 몰 상품 URL을 뽑는다(실패하면 None).
    1순위: 카드에 알려진 6개 몰 → 짧은 상품 주소로 정규화
    2순위: 그 밖의 몰(오늘의집 등) → 이동 대상 URL에서 추적 파라미터만 떼고 그대로
    """
    if not buy_url or 'Redirect.jsp' not in buy_url:
        return None
    try:
        html = http_get(buy_url, referer='https://price.enuri.com/', timeout=20, tries=2)
    except Exception as e:  # noqa: BLE001
        log('   · 몰 직통 조회 실패: %s' % e)
        return None
    loc = re.search(r'location(?:\.href)?\s*=\s*["\']([^"\']+)["\']', html)
    cands = ([loc.group(1)] if loc else []) + re.findall(r'https?://[^\s"\'<>()\\]+', html)
    for u in dict.fromkeys(cands):
        if any(s in u for s in MALL_SKIP):
            continue
        mall, direct = _canon_mall(u)
        if mall and direct:
            return {'mall': mall, 'url': direct}
    if loc:
        u = _clean_query(loc.group(1))
        host = urllib.parse.urlparse(u).netloc.lower()
        if host and not re.search(r'\.(jpg|jpeg|png|gif|webp)$', u, re.I):
            name = next((v for k, v in HOST_NAMES.items() if host.endswith(k)), host)
            return {'mall': name, 'url': u}
    return None


def image_ok(url):
    """실제로 내려받아지는 이미지인지 확인(에누리 페이지에 적힌 주소가 404인 경우가 있다)."""
    if not url:
        return False
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://price.enuri.com/'})
        with urllib.request.urlopen(req, timeout=15, context=CTX) as r:
            ctype = (r.headers.get('Content-Type') or '').lower()
            head = r.read(16)
        if head.startswith(b'\xff\xd8') or head.startswith(b'\x89PNG'):
            return True
        return 'image' in ctype
    except Exception:  # noqa: BLE001
        return False


def enuri_lowest(pid):
    html = http_get(ENURI_CATALOG.format(id=pid), referer='https://price.enuri.com/')
    sticky = json_after(html, '"initStickyTabsInfo":')
    if not sticky:
        return None
    try:
        price = int(sticky.get('price') or 0)
    except (TypeError, ValueError):
        price = 0
    if price <= 0:
        return None
    link = clean(sticky.get('purchaseLink'))
    # 카드 사진: 판매처 광고 배지·이벤트 문구가 붙은 썸네일보다
    # 에누리가 보관한 대표 상품컷을 먼저 쓴다.
    clean_img = ''
    for cand in dict.fromkeys(CLEAN_IMG_RE.findall(html)):
        if image_ok(cand):
            clean_img = cand
            break
    return {
        'price': price,
        'seller': clean(sticky.get('mallName')),
        'delivery': clean(sticky.get('deliveryText')),
        'buyUrl': link if link.startswith('http') else '',
        'saleStatus': clean(sticky.get('saleStatus')),
        'cleanImg': clean_img,
    }


def spec_highlights(specs, limit=3):
    """에누리 상세 스펙에서 화면에 보이는 값만 짧게 뽑는다(추측 금지)."""
    out = []

    def walk(node):
        if len(out) >= limit:
            return
        if isinstance(node, dict):
            label = clean(((node.get('label') or {}).get('raw')))
            vals = node.get('values') or []
            texts = []
            for v in vals:
                if isinstance(v, dict):
                    raw = clean(v.get('raw'))
                    if raw:
                        texts.append(raw)
                    walk(v)
            if texts and label:
                out.append(label + ' ' + '·'.join(texts[:2]))
            elif texts:
                out.extend(texts[:1])
        elif isinstance(node, list):
            for n in node:
                walk(n)

    walk(specs)
    # 중복·라벨-only 값 제거 ('[구성]' 같은 항목은 장점 문구가 아니다)
    seen, res = set(), []
    for s in out:
        s = clean(s)
        if not s or len(s) < 2 or s in seen:
            continue
        if re.fullmatch(r'\[[^\]]{1,12}\]', s):
            continue
        seen.add(s)
        res.append(s)
    return res[:limit]


# ─────────────────────────────────────────────────────────────
# 2) 해외직구가 — 알리익스프레스
# ─────────────────────────────────────────────────────────────
def ali_candidates(query, limit=12):
    slug = re.sub(r'[^a-z0-9]+', '-', query.lower()).strip('-')
    last = None
    for attempt in range(3):
        try:
            html = http_get(ALI_SEARCH.format(q=slug), referer='https://ko.aliexpress.com/', timeout=30, tries=1)
            break
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 + attempt * 2)
    else:
        raise last
    i = html.find('"itemList":')
    if i < 0:
        if 'punish' in html or 'x5secdata' in html:
            raise RuntimeError('알리익스프레스 봇 검사(punish) — 잠시 뒤 다시 시도')
        return []
    k = html.find('"content":[', i)
    if k < 0:
        return []
    arr = json_after(html[i:k + 200], '"content":', open_ch='[')
    if not arr:
        blob = extract_block(html, k + len('"content":'), '[', ']')
        try:
            arr = json.loads(blob) if blob else []
        except Exception:  # noqa: BLE001
            arr = []
    out = []
    for it in arr or []:
        if not isinstance(it, dict):
            continue
        pid = clean(it.get('productId'))
        title = clean((it.get('title') or {}).get('displayTitle'))
        prices = it.get('prices') or {}
        sale = prices.get('salePrice') or {}
        orig = prices.get('originalPrice') or {}
        try:
            usd = float(sale.get('minPrice') or 0)
        except (TypeError, ValueError):
            usd = 0.0
        try:
            usd_orig = float(orig.get('minPrice') or 0)
        except (TypeError, ValueError):
            usd_orig = 0.0
        if not pid or not title or usd <= 0:
            continue
        if ALI_PART_DENY.search(title):
            continue      # 케이스·파우치·교체용 등 부품은 비교 후보에서 제외
        img = clean((it.get('image') or {}).get('imgUrl'))
        if img.startswith('//'):
            img = 'https:' + img
        out.append({
            'productId': pid,
            'title': title,
            'usd': round(usd, 2),
            'usdOrig': round(usd_orig, 2),
            'img': img,
            'url': 'https://ko.aliexpress.com/item/%s.html' % pid,
            'rating': ((it.get('evaluation') or {}).get('starRating')),
            'sold': clean((it.get('trade') or {}).get('tradeDesc')),
        })
        if len(out) >= limit:
            break
    return out


STOP = set('the for with and set pack pcs pc new hot sale free shipping high quality '
           'portable mini usb'.split())
ALI_OFFTOPIC = ('pet ', 'dog', 'cat ', 'puppy', 'vase', 'for aquarium')


def tokens(s):
    return {t for t in re.findall(r'[a-z0-9]{3,}', str(s or '').lower()) if t not in STOP}


def pick_ali(cands, ko_name, en_query, domestic_price, fx):
    """국내 상품과 이름이 가장 겹치고, '같은 급' 가격대인 상위 매칭을 고른다.
    (알리 검색은 부속품·초저가형이 섞여 있어 순서만 믿으면 비교가 왜곡된다.)
    브랜드+모델번호가 실제로 맞는 후보가 하나라도 있으면 그 안에서만 고른다 —
    '✅ 동일 모델'이 가능한 상황에서 엉뚱한 유사품을 붙이지 않기 위해서(11/22)."""
    if not cands:
        return None
    exact_pool = [c for c in cands if classify_match(ko_name, c['title'])[0] == 'exact']
    if exact_pool and fx and domestic_price:
        # 정품 동일 모델이 국내가의 45% 미만으로 보이는 경우는 복제·리퍼·미개봉 아님이 많다
        # → '동일 모델'로 단정해 보여 주면 1/3 가격으로 오해하게 되므로 후보에서 내린다
        plausible = [c for c in exact_pool if c['usd'] * fx >= domestic_price * 0.45]
        exact_pool = plausible or exact_pool
    pool = exact_pool or cands
    kset = tokens(ko_name) | tokens(en_query)
    best, best_score = None, -1e9
    for idx, c in enumerate(pool):
        krw = c['usd'] * fx if fx else 0
        tset = tokens(c['title'])
        score = len(kset & tset) * 6 - idx * 0.6
        ratio = (krw / domestic_price) if (krw and domestic_price) else 0
        if 0.25 <= ratio <= 1.10:
            score += 30          # 같은 제품군일 가능성이 가장 큰 구간
        elif 0.15 <= ratio < 0.25:
            score += 5
        else:
            score -= 30          # 악세서리·초저가형이거나 국내가보다 훨씬 비쌈
        if krw and krw < 3000:
            score -= 20
        low_t = c['title'].lower()
        if any(w in low_t for w in ALI_OFFTOPIC) and not any(k in ko_name for k in ('반려', '강아지', '고양이', '펫')):
            score -= 40   # 반려동물용·꽃병 등 다른 용도 상품
        # 국내 상품이 단품인데 콤보·세트를 고르면 '동일 모델'로 오해된다
        if re.search(r'\b(combo|bundle|set)\b|\+', low_t) and not re.search(r'세트|콤보|combo|set|\+', ko_name.lower()):
            score -= 25
        if score > best_score:
            best, best_score = c, score
    return best


# ─────────────────────────────────────────────────────────────
# 2-b) 알리 매칭이 '동일 모델'인지 '유사 제품'인지 판정 (11/22)
#   exact   : 브랜드 + 핵심 모델번호/규격이 실제로 일치 → 카드에 '✅ 동일 모델'
#   similar : 같은 검색어로 찾은 다른 브랜드·유사 스펙 상품   → '🔎 유사 제품 비교'
#   (브랜드만 같거나 모델명만 같으면 동일 모델이 아니다 — 둘 다 맞아야 exact)
# ─────────────────────────────────────────────────────────────
ALI_BRAND_EN = {
    '테팔': 'tefal', '스탠리': 'stanley', '삼성전자': 'samsung', '삼성': 'samsung',
    '키친아트': 'kitchenart', '모윰': 'moyuum', '브리사': 'brisa', '필립스': 'philips',
    '한일의료기': 'hanil', '조아캠프': 'joacamp', '쿠쿠': 'cuckoo', '다이슨': 'dyson',
    '샤오미': 'xiaomi', '로지텍': 'logitech', '애플': 'apple', '테크닉스': 'technics',
    '리큐어': 'liquor', '락앤락': 'locknlock', '네이처하이크': 'naturehike', '카처': 'karcher',
    # IT·가성비 브랜드 보강(11/22) — 알리에서 같은 모델번호로 유통되는 브랜드
    '앤커': 'anker', '앙커': 'anker', '유그린': 'ugreen', '베이스어스': 'baseus',
    '레노버': 'lenovo', '벨킨': 'belkin', '조이트론': 'zotac', '로지텍코리아': 'logitech',
    '미지아': 'mijia', '레드미': 'redmi', '소니': 'sony', '보스': 'bose', '젠하이저': 'sennheiser',
}
MODEL_RE = re.compile(r'[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*')
SPEC_RE = re.compile(r'(\d+(?:[.,]\d+)?)\s*(mah|wh|ml|kg|mm|cm|w|l|v|inch|인치)\b', re.I)
# 규격 표기(20000mAh · 45W · 650ml · 18cm · 1.18L)는 모델번호로 보지 않는다
SPEC_TOKEN_RE = re.compile(
    r'^\d+(?:[.,]\d+)?(?:mah|wh|w|v|ml|l|kg|g|mm|cm|m|in|inch|gb|tb|hz|fps|개|매|팩|장|입|인치)$', re.I)
# 부품·악세서리(케이스·파우치·교체용 등)는 '동일 모델' 후보에서 제외 — 오탐 차단
ALI_PART_DENY = re.compile(
    r'\b(cases?|covers?|bags?|pouch(?:es)?|skins?|keycaps?|replacement|lids?|straws?|parts?|'
    r'grip\s*tape|battery\s+for|accessor(?:y|ies)|protector)\b|케이스|파우치|교체용|리필|보호필름', re.I)


def _squash(s):
    """비교용 — 소문자·영숫자만 남긴다(공백·하이픈·한글 제거)."""
    return re.sub(r'[^a-z0-9]', '', str(s or '').lower())


def _model_codes(name):
    """상품명에서 모델번호 후보(BL1501 · KAEP-6517 · EB-P4520 · PB2050ZM · GaN5 · 622 · 3S).
    규격(20000mAh · 45W · 650ml · 18cm · 1.18L)은 모델번호로 보지 않는다(11/22 짧은 코드 인식 보강)."""
    out, seen = [], set()
    for raw in re.findall(r'[A-Za-z0-9][A-Za-z0-9._\-]*', str(name or '')):
        tok = raw.strip('.-_')
        if not tok or not re.search(r'\d', tok):
            continue
        if SPEC_TOKEN_RE.match(tok):          # 20000mAh · 45W · 650ml · 1.18L
            continue
        key = _squash(tok)
        if len(key) < 2 or key in seen:
            continue
        if re.search(r'[a-z]', key):
            # 영문+숫자 코드 — 3S(2자) · GaN5(4자) · EB-P4520 · BL1501
            if len(key) == 2 and not re.search(r'[a-z]\d|\d[a-z]', key):
                continue
        else:
            # 숫자만 — 622 · 737 같은 2~4자리 모델번호(20000 같은 용량은 5자리라 제외)
            if not (2 <= len(key) <= 4) or re.fullmatch(r'\d+0{2,}', key):
                continue
        seen.add(key)
        out.append({'key': key, 'label': tok})
    return out


def _brand_of(dom_name, ali_title_squashed):
    """국내 상품명의 브랜드를 찾아 알리 제목에 있는지 본다 → (hit, 브랜드명)."""
    name = str(dom_name or '')
    for ko, en in sorted(ALI_BRAND_EN.items(), key=lambda kv: -len(kv[0])):
        if ko in name:
            key = _squash(en)
            return bool(key and key in ali_title_squashed), ko
    first = (name.split() or [''])[0]
    key = _squash(first)
    if len(key) >= 4 and re.search(r'[a-z]{3}', key) and key in ali_title_squashed:
        return True, first
    return False, ''


def _spec_tokens(name):
    """핵심 규격(1.18L · 20000mAh · 45W · 18cm)을 비교용 키로."""
    out = []
    for num, unit in SPEC_RE.findall(str(name or '')):
        u = unit.lower()
        if u == '인치':
            u = 'inch'
        key = _squash(num.replace(',', '.') + u)
        if key and key not in out:
            out.append(key)
    return out


def classify_match(dom_name, ali_title):
    """(matchType, matchBasis) — **브랜드 + 모델번호가 모두** 맞을 때만 exact.
    규격(용량·출력)만 같은 상품은 exact가 아니라 similar(동급/유사 비교)로 내린다(11/22 오탐 차단)."""
    name = str(dom_name or '')
    title = _squash(ali_title)
    brand_hit, brand_name = _brand_of(name, title)
    codes = _model_codes(name)
    code_hit = next((c for c in codes if c['key'] in title), None)
    if brand_hit and code_hit:
        return 'exact', '%s · 모델 %s 일치' % (brand_name, code_hit['label'])
    if brand_hit and codes:
        return 'similar', '브랜드만 일치 · 모델 %s 미확인' % codes[0]['label']
    if code_hit:
        return 'similar', '모델명만 일치 · 브랜드 미확인'
    if brand_hit:
        return 'similar', '브랜드만 일치 · 모델번호 없음'
    specs = _spec_tokens(name)
    spec_hit = [s for s in specs if s in title]
    if spec_hit and len(spec_hit) == len(specs):
        return 'similar', '규격만 일치(%s) · 동급 비교' % '·'.join(spec_hit)
    return 'similar', '브랜드·모델 미확인'


def fetch_fx():
    for u in FX_URLS:
        try:
            raw = http_get(u, timeout=15, tries=1)
            j = json.loads(raw)
            if 'rates' in j and j['rates'].get('KRW'):
                return float(j['rates']['KRW']), u
            if isinstance(j.get('conversion_rates'), dict) and j['conversion_rates'].get('KRW'):
                return float(j['conversion_rates']['KRW']), u
        except Exception:  # noqa: BLE001
            continue
    return None, None


# ─────────────────────────────────────────────────────────────
# 3) 한 항목 조립
# ─────────────────────────────────────────────────────────────
def rank_domestic(cands, cfg):
    """핫템다운 후보 고르기 — 이름/설명에 상품명 키워드가 있는 것만, 유통 폭·후기 많은 순.
    (관리자 화면의 '인기순' 1번은 프리미엄 모델이거나 부속품인 경우가 많다.)

    이름에 상품 종류 키워드(must)가 하나도 없는 검색결과는 **버린다**.
    예전에는 그런 경우 가격·유통만 보고 아무 상품이나 골라, 카드에 엉뚱한 상품과
    그 사진이 붙었다(11/22 사용자 지적). 맞는 상품이 없으면 그 항목은 건너뛴다."""
    must = cfg.get('must') or []
    deny = cfg.get('deny') or []
    hi = cfg.get('maxPrice') or 0
    picked = [c for c in cands if (not hi or c['listPrice'] <= hi)]
    picked = [c for c in picked
              if not any(d in (c['name'] + ' ' + c.get('description', '')) for d in deny)]
    hit = [c for c in picked if any(m in (c['name'] + ' ' + c.get('description', '')) for m in must)]
    if not hit:
        return []
    pool = hit

    def score(c):
        return (c['mallCount'] * 2
                + min(float(c['reviewCount'] or 0), 3000) / 12.0
                + (12 if any(m in c['name'] for m in must) else 0)
                - c['listPrice'] / 30000.0)

    return sorted(pool, key=score, reverse=True)


def build_item(cfg, fx, fx_src, now):
    doms = enuri_candidates(cfg['ko'])
    if not doms:
        return None, '에누리 검색 결과 없음'
    ranked = rank_domestic(doms, cfg)
    if not ranked:
        return None, '이름이 맞는 상품 없음(엉뚱한 상품 배제)'
    dom = None
    for cand in ranked[:4]:
        try:
            low = enuri_lowest(cand['id'])
        except Exception as e:  # noqa: BLE001
            log('   · 카탈로그 조회 실패(%s): %s' % (cand['id'], e))
            low = None
        if low and low['price'] > 0:
            dom = dict(cand)
            dom.update(low)
            break
        time.sleep(0.6)
    if not dom:
        return None, '에누리 상세 최저가 확인 실패'

    alis = []
    for qtry in (cfg['en'], cfg['en'].replace(' usb', ''), ' '.join(cfg['en'].split()[:2])):
        try:
            alis = ali_candidates(qtry)
        except Exception as e:  # noqa: BLE001
            log('   · 알리 검색 실패(%s): %s' % (qtry, e))
            alis = []
        if alis:
            break
        time.sleep(1.2)
    ali = pick_ali(alis, dom['name'], cfg['en'], dom['price'], fx) if alis else None

    pros = []
    if dom.get('description'):
        for part in re.split(r'\s*[|·]\s*', dom['description']):
            part = clean(part)
            if part and len(pros) < 3:
                pros.append(part)
    if len(pros) < 2:
        for sp in spec_highlights(dom.get('specs')):
            if sp not in pros:
                pros.append(sp)
            if len(pros) >= 3:
                break
    if not pros:
        pros = ['국내 최저가 %s원 · %s' % (format(dom['price'], ','), dom['seller'] or '판매처'),
                '가격은 수집 시점 실측값입니다']

    overseas = None
    diff_krw = diff_pct = 0
    cheaper = ''
    low_conf = False
    if ali:
        krw = int(round(ali['usd'] * fx))
        match_type, match_basis = classify_match(dom['name'], ali['title'])
        overseas = {
            'source': 'AliExpress',
            'title': ali['title'],
            'usd': ali['usd'],
            'usdOrig': ali['usdOrig'],
            'krw': krw,
            'url': ali['url'],
            'image': ali['img'],
            'rating': ali['rating'],
            'sold': ali['sold'],
            'matchType': match_type,      # exact | similar (카드의 ✅ 동일 모델 / 🔎 유사 제품 배지)
            'matchBasis': match_basis,    # 판정 근거(브랜드·모델 확인 여부)
        }
        diff_krw = dom['price'] - krw
        base = max(dom['price'], krw) or 1
        diff_pct = int(round(abs(diff_krw) / base * 100))
        cheaper = 'overseas' if diff_krw > 0 else ('domestic' if diff_krw < 0 else 'same')
        # 구성·옵션이 다른 저가형일 가능성이 큰 경우 표시용 플래그
        if krw and dom['price'] and krw < dom['price'] * 0.25:
            low_conf = True

    pass_msg = ('해외직구는 배송에 보통 7~14일 걸리고 교환·AS가 번거롭습니다. '
                '급하거나 AS가 필요하면 국내 최저가를, 시간이 남으면 직구를 고르세요.')
    if low_conf:
        pass_msg = ('직구가가 지나치게 낮게 잡힌 항목입니다. 구성·용량·옵션이 다른 '
                    '저가형일 수 있으니 상세 페이지에서 같은 모델인지 확인하세요.')

    md = mall_direct(dom.get('buyUrl') or '') or {}

    item = {
        'id': 'hot-' + cfg['no'],
        'no': cfg['no'],
        'cat': cfg['cat'],
        'name': dom['name'],
        'emoji': cfg['emoji'],
        'hot': True,
        'price': dom['price'],
        'snsPrice': 0,
        'store': dom['seller'] or '에누리 최저가',
        'img': (IMG_OVERRIDE.get(dom['name'])
                or dom.get('cleanImg')
                or dom['img']),
        'pros': pros[:3],
        'pass': pass_msg,
        'tags': cfg['tags'],
        'links': {
            'rocket': '',
            'direct': (overseas or {}).get('url', ''),
            'naver': dom['url'],
            'coupang': '',
            'naverBrand': '',
            'temu': '',
        },
        'compare': {
            'domestic': {
                'price': dom['price'],
                'seller': dom['seller'],
                'delivery': dom['delivery'],
                'mallCount': dom.get('mallCount') or 0,
                'rating': dom.get('rating'),
                'reviews': dom.get('reviewCount'),
                'url': dom['url'],
                'buyUrl': dom.get('buyUrl') or '',
                'mallUrl': md.get('url') or '',      # 진짜 쇼핑몰 상품 직통(11번가·G마켓·옥션·롯데ON·SSG·스마트스토어)
                'mallName': md.get('mall') or '',
            },
            'overseas': overseas,
            'fx': fx,
            'fxSource': fx_src,
            'diffKrw': diff_krw,
            'diffPct': diff_pct,
            'cheaper': cheaper,
            'lowConfidence': low_conf,
        },
        'source': {
            'domestic': '에누리 가격비교',
            'overseas': 'AliExpress' if overseas else '',
        },
        'measuredAt': now.isoformat(),
        'updatedAt': int(now.timestamp() * 1000),
        'createdAt': int(now.timestamp() * 1000),
        'sample': False,
    }
    return item, ''


def refresh_images(now):
    """기존 JSON의 상품·가격은 건드리지 않고 카드 사진만 다시 고른다.
    (광고 배지가 붙은 썸네일 → 에누리 대표 상품컷 / 수동 지정컷)"""
    src = OUT_PATHS[0]
    if not os.path.exists(src):
        log('기존 파일이 없습니다:', os.path.relpath(src, ROOT))
        return 1
    payload = json.load(open(src, encoding='utf-8'))
    changed = 0
    for it in payload.get('items', []):
        name = clean(it.get('name'))
        best = ''
        if IMG_OVERRIDE.get(name):
            best = IMG_OVERRIDE[name]
        else:
            link = clean(((it.get('links') or {}).get('naver')) or '')
            m = re.search(r'/catalog/(\d+)', link)
            if m:
                try:
                    html = http_get(ENURI_CATALOG.format(id=m.group(1)), referer='https://price.enuri.com/')
                    for cand in dict.fromkeys(CLEAN_IMG_RE.findall(html)):
                        if image_ok(cand):
                            best = cand
                            break
                except Exception as e:  # noqa: BLE001
                    log('   · 카탈로그 조회 실패(%s): %s' % (name[:24], e))
        if best and best != it.get('img'):
            log('   · %s\n     %s\n     → %s' % (name[:40], it.get('img'), best))
            it['img'] = best
            changed += 1
        time.sleep(0.6)
    if not changed:
        log('바꿀 사진이 없습니다.')
        return 0
    payload['imgFixedAt'] = now.isoformat()
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    for p in OUT_PATHS:
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text + '\n')
        log('저장:', os.path.relpath(p, ROOT))
    log('사진 교체: %d건' % changed)
    return 0


def retag_matches(now):
    """기존 JSON의 상품·가격은 그대로 두고, 알리 매칭의 동일/유사 판정만 다시 계산한다(네트워크 없음).
    판정 규칙이 바뀌면 이 모드로 14건 전수 재태깅한다."""
    src = OUT_PATHS[0]
    if not os.path.exists(src):
        log('기존 파일이 없습니다:', os.path.relpath(src, ROOT))
        return 1
    payload = json.load(open(src, encoding='utf-8'))
    changed = []
    for it in payload.get('items', []):
        ov = ((it.get('compare') or {}).get('overseas') or None)
        if not ov:
            continue
        mt, mb = classify_match(it.get('name') or '', ov.get('title') or '')
        if ov.get('matchType') != mt or ov.get('matchBasis') != mb:
            changed.append((it.get('id'), ov.get('matchType'), mt, mb))
            ov['matchType'] = mt
            ov['matchBasis'] = mb
    payload['matchTaggedAt'] = now.isoformat()
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    for p in OUT_PATHS:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text + '\n')
    for cid, before, after, basis in changed:
        log('   · %s  %s → %s  (%s)' % (cid, before, after, basis))
    log('동일/유사 재태깅: %d건 변경 / %d건' % (len(changed), len(payload.get('items', []))))
    return 0


def backfill_mall_urls(now):
    """기존 JSON의 상품·가격은 건드리지 않고, 판매처 구매링크에서 몰 직통 URL(mallUrl)만 채운다."""
    src = OUT_PATHS[0]
    if not os.path.exists(src):
        log('기존 파일이 없습니다:', os.path.relpath(src, ROOT))
        return 1
    payload = json.load(open(src, encoding='utf-8'))
    filled = 0
    for it in payload.get('items', []):
        dom = ((it.get('compare') or {}).get('domestic') or {})
        if not dom:
            continue
        md = mall_direct(dom.get('buyUrl') or '')
        if md and md.get('url'):
            dom['mallUrl'] = md['url']
            dom['mallName'] = md.get('mall') or dom.get('seller') or ''
            filled += 1
            log('   · %s → %s %s' % (it.get('name', '')[:34], dom['mallName'], md['url'][:70]))
        else:
            dom.setdefault('mallUrl', '')
            dom.setdefault('mallName', '')
            log('   ✗ %s — 몰 직통 확인 실패' % it.get('name', '')[:34])
        time.sleep(0.7)
    payload['mallFilledAt'] = now.isoformat()
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    for p in OUT_PATHS:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text + '\n')
        log('저장:', os.path.relpath(p, ROOT))
    log('몰 직통 URL: %d/%d건' % (filled, len(payload.get('items', []))))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--skip', type=int, default=0, help='앞에서 N건을 건너뛰고 수집(분할 실행용)')
    ap.add_argument('--keyword', default='')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--merge', action='store_true', help='기존 파일에서 같은 번호만 교체하고 나머지는 유지')
    ap.add_argument('--img-only', action='store_true',
                    help='기존 JSON의 상품은 그대로 두고 카드 사진(img)만 다시 고른다')
    ap.add_argument('--retag', action='store_true',
                    help='기존 JSON의 알리 매칭을 동일/유사로 다시 판정한다(네트워크 없음)')
    ap.add_argument('--mall-only', action='store_true',
                    help='기존 JSON의 판매처 구매링크에서 몰 직통 URL(mallUrl)만 채운다')
    args = ap.parse_args()

    now = dt.datetime.now(KST).replace(microsecond=0)
    if args.mall_only:
        return backfill_mall_urls(now)
    if args.retag:
        return retag_matches(now)
    if args.img_only:
        return refresh_images(now)
    fx, fx_src = fetch_fx()
    if not fx:
        log('!! 환율을 가져오지 못했습니다 — 직구 비교 없이 국내 최저가만 저장합니다.')
        fx = 0.0

    targets = KEYWORDS
    if args.keyword:
        targets = [k for k in KEYWORDS if args.keyword in k['ko'] or args.keyword in k['en']]
        if not targets:
            log('검색어에 맞는 대상이 없습니다:', args.keyword)
            return 1
    if args.skip:
        targets = targets[args.skip:]
    if args.limit:
        targets = targets[:args.limit]

    items, skipped = [], []
    for cfg in targets:
        log('[%s] %s …' % (cfg['no'], cfg['ko']))
        try:
            it, why = build_item(cfg, fx, fx_src, now)
        except Exception as e:  # noqa: BLE001
            it, why = None, '수집 실패: %s' % e
        if not it:
            skipped.append({'no': cfg['no'], 'q': cfg['ko'], 'reason': why})
            log('   ✗', why)
            continue
        items.append(it)
        ov = it['compare']['overseas']
        log('   ✓ %s | 국내 %s원 %s | 직구 %s' % (
            it['name'][:40], format(it['price'], ','), it['store'],
            ('%s원 ($%.2f)' % (format(ov['krw'], ','), ov['usd'])) if ov else '확인 실패'))
        time.sleep(2.0)

    if args.merge and not args.dry_run and os.path.exists(OUT_PATHS[0]):
        try:
            prev = json.load(open(OUT_PATHS[0], encoding='utf-8'))
            have = dict((str(x.get('no')), x) for x in prev.get('items', []))
            for it in items:
                have[str(it['no'])] = it
            merged = sorted(have.values(), key=lambda x: int(str(x.get('no') or 0)))
            items = merged
            log('병합: 기존 %d건 유지 + 이번 %d건 → 총 %d건'
                % (len(have) - len(targets), len(targets), len(items)))
        except Exception as e:  # noqa: BLE001
            log('병합 실패(이번 결과만 저장):', e)

    payload = {
        'ok': True,
        'generatedAt': now.isoformat(),
        'fx': {'usdKrw': fx, 'source': fx_src, 'at': now.isoformat()},
        'count': len(items),
        'sources': {
            'domestic': '에누리 가격비교 (price.enuri.com) — 상품 상세 최저가 판매처',
            'domesticDirect': ('카드의 [🛒 최저가 바로가기]는 compare.domestic.mallUrl '
                               '(에누리 Redirect.jsp 안내 HTML에서 뽑은 목적지 몰 상품 직통 URL — 11번가·G마켓·옥션·롯데ON·SSG·스마트스토어)'
                               '로 연결. mallUrl이 없으면 buyUrl → 에누리 카탈로그 순서로 대체'),
            'overseas': 'AliExpress (ko.aliexpress.com) — 검색 1페이지 상품',
            'match': ('compare.overseas.matchType — exact(브랜드+모델번호 일치만) / similar(유사·규격 동급). '
                      'matchBasis에 판정 근거. 케이스·파우치·교체용 등 부품은 후보에서 제외'),
            'note': '가격·배송은 수집 시점 실측값이며 판매처·옵션에 따라 달라집니다.',
        },
        'items': items,
        'skipped': skipped,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=1)

    if not args.dry_run:
        for p in OUT_PATHS:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8') as f:
                f.write(text + '\n')
            log('저장:', os.path.relpath(p, ROOT))
    log('완료: %d건 (건너뜀 %d)' % (len(items), len(skipped)))
    return 0 if items else 2


if __name__ == '__main__':
    sys.exit(main())
