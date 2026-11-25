#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scan_review_campaigns.py — 체험단 5대 플랫폼 실데이터 수집기

대상
  1) 레뷰(REVU)        revu.net        → api.weble.net/v1/campaigns/trending (공개 JSON)
  2) 리뷰노트(RevuNote) reviewnote.co.kr → /campaigns (Next.js __NEXT_DATA__ JSON)
  3) 디너의여왕         dinnerqueen.net → /taste?page=N (서버렌더 HTML) + 상세 /taste/{id}
  4) 미블(MR블로그)     mrblog.net      → 홈페이지 공개 섹션(시선집중·프리미엄·마감임박)
  5) 강남맛집           xn--939au0g4vj8sq.net (강남맛집.net) → 접속 시도 후 차단 사유 기록

원칙
  · 지어낸 값 0건. 접근·파싱에 성공한 플랫폼의 실측 값만 기록한다.
  · 파싱하지 못한 필드는 null 로 두고, 왜 비었는지 meta.platforms[].note 에 남긴다.
  · D-day 문자열만 공개되는 플랫폼(미블)은 dday 원문을 그대로 저장하고,
    마감일은 'dday 역산'으로 표시(deadlineDerived=true)해 추정임을 드러낸다.

사용법
  python3 scripts/scan_review_campaigns.py                 # 수집 → deploy_repo/data/revu-campaigns.json
  python3 scripts/scan_review_campaigns.py --out X.json    # 출력 경로 변경
  python3 scripts/scan_review_campaigns.py --no-detail     # 디너의여왕 상세 페이지 생략(빠른 점검)
  python3 scripts/scan_review_campaigns.py --only revu,reviewnote
"""
from __future__ import annotations

import argparse
import html as htmllib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from review_normalize import (NORMALIZE_RULE, find_region,  # noqa: E402
                              normalize_rows)

KST = timezone(timedelta(hours=9))
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# GitHub Actions(deploy_repo 체크아웃)는 SYNC_REPO_ROOT=저장소 루트를 넘긴다.
# 작업 환경(개발)에서는 기존처럼 <workspace>/deploy_repo/data 를 기본 출력으로 쓴다.
REPO_ROOT = os.environ.get('SYNC_REPO_ROOT') or os.path.join(BASE_DIR, 'deploy_repo')
DEFAULT_OUT = os.path.join(REPO_ROOT, 'data', 'revu-campaigns.json')

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
HEADERS = {
    'User-Agent': UA,
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
}
TIMEOUT = 25
PAUSE = 0.35          # 상대 서버 예의용 최소 간격
MAX_DQ_PAGES = 6
MAX_DQ_DETAIL = 190
DQ_WORKERS = 4
NEW_CAP_PER_PLATFORM = 3   # NEW 뱃지 상한 — 회차 통째로 올리는 플랫폼에서 도배되지 않게 플랫폼별 최신 3건만

PLATFORMS = [
    ('revu', '레뷰'),
    ('reviewnote', '리뷰노트'),
    ('dinnerqueen', '디너의여왕'),
    ('mrblog', '미블'),
    ('gangnam', '강남맛집'),
    # [11/23] 무료 체험단 플랫폼 확장 — 실제 공개 목록이 긁히는 곳만 추가
    ('popomon', '포포몬'),
    ('ohmyblog', '오마이블로그'),
    ('themukja', '더먹자'),
    ('onepik', '원픽체험단'),
    ('reviewplace', '리뷰플레이스'),
    ('ringble', '링블'),
]

# 플랫폼별 수집 상한 — 전체 JSON 용량·로딩 속도를 지키기 위한 균형 상한
CAP_POPOMON = 70
CAP_OHMYBLOG = 60
CAP_THEMUKJA = 40
CAP_ONEPIK = 45
CAP_REVIEWPLACE = 40
CAP_RINGBLE = 40

SESSION = requests.Session()
SESSION.headers.update(HEADERS)
_TL = __import__('threading').local()


def _session():
    s = getattr(_TL, 's', None)                       # 스레드별 세션 (공유 세션은 동시 요청에서 병목)
    if s is None:
        s = requests.Session()
        s.headers.update(HEADERS)
        _TL.s = s
    return s


# ---------------------------------------------------------------- helpers
def log(msg):
    print(msg, flush=True)


def get(url, **kw):
    kw.setdefault('timeout', TIMEOUT)
    last = None
    for attempt in range(3):
        try:
            r = _session().get(url, **kw)
            return r
        except Exception as e:                      # noqa: BLE001
            last = e
            time.sleep(1.2 * (attempt + 1))
    raise last


def text_of(fragment):
    """태그 제거 후 공백 정리한 텍스트."""
    s = re.sub(r'<script[\s\S]*?</script>', ' ', fragment)
    s = re.sub(r'<style[\s\S]*?</style>', ' ', s)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = htmllib.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()


def clean(s):
    if s is None:
        return None
    s = htmllib.unescape(str(s))
    s = re.sub(r'\s+', ' ', s).strip()
    return s or None


def to_int(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    m = re.search(r'-?[\d,]+', str(v))
    if not m:
        return None
    try:
        return int(m.group(0).replace(',', ''))
    except ValueError:
        return None


def iso_date(s):
    """'2026-11-22' / '26.11.22' / '2026-11-22 10:00' → 'YYYY-MM-DD'."""
    if not s:
        return None
    s = str(s).strip()
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return '%s-%s-%s' % m.groups()
    m = re.match(r'(\d{2})\.(\d{2})\.(\d{2})', s)
    if m:
        y, mo, d = m.groups()
        return '20%s-%s-%s' % (y, mo, d)
    return None


def kst_date_from_utc(s):
    """'2026-11-30T14:59:59.999Z' → KST 기준 날짜."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except ValueError:
        return iso_date(s)
    return dt.astimezone(KST).strftime('%Y-%m-%d')


def cat_group(*cands):
    """플랫폼마다 다른 카테고리 표기를 공통 칩으로 정규화."""
    joined = ' '.join([str(c) for c in cands if c])
    table = [
        ('맛집', ['맛집', '음식점', '식당', '외식', '카페', '디저트', '베이커리', '식사권', '식사']),
        ('식품', ['식품', '가공식', '건강식', '음료', '주류', '농수산']),
        ('뷰티', ['뷰티', '화장품', '미용', '헤어', '네일', '피부', '다이어트']),
        ('생활', ['생활', '주방', '청소', '세탁', '인테리어', '반려', '펫']),
        ('디지털', ['디지털', '가전', '전자', 'IT', '컴퓨터', '모바일']),
        ('여가', ['여가', '여행', '숙박', '문화', '공연', '전시', '스포츠', '레저']),
        ('육아', ['육아', '유아', '아동', '키즈', '완구', '교육']),
        ('패션', ['패션', '의류', '잡화', '신발', '가방', '액세서리']),
        ('도서', ['도서', '책', '서적']),
    ]
    for group, keys in table:
        for k in keys:
            if k in joined:
                return group
    return '기타'


def dday_of(deadline, today):
    if not deadline:
        return None
    try:
        y, m, d = [int(x) for x in deadline.split('-')]
        return (datetime(y, m, d, tzinfo=KST).date() - today).days
    except Exception:                                # noqa: BLE001
        return None


def deadline_from_dday(days, today):
    if days is None:
        return None
    return (today + timedelta(days=days)).strftime('%Y-%m-%d')


def friendly_reason(e):
    """예외를 화면에 보여 줄 수문장으로 압축."""
    s = (type(e).__name__ + ': ' + str(e)).lower()
    if 'timeout' in s or 'connect' in s or 'max retries' in s:
        return '사이트 접속 시간 초과(네트워크·지역 차단 추정)'
    if '401' in s or '403' in s or 'auth' in s or 'login' in s:
        return '로그인 필요(비로그인 열람 차단)'
    if '404' in s:
        return '주소 변경 또는 페이지 삭제'
    if 'captcha' in s or 'cloudflare' in s or 'blocked' in s:
        return '봇 차단(WAF)'
    if 'json' in s or 'parse' in s or '찾지 못' in s:
        return '페이지 구조 변경(파싱 실패)'
    return '수집 실패'


def base_row(**kw):
    row = {
        'id': None, 'platform': None, 'platformName': None,
        'title': None, 'brand': None, 'category': None, 'categoryRaw': None, 'city': None,
        'media': '블로그', 'type': None, 'offer': None, 'price': None, 'priceNote': None,
        'applicants': None, 'capacity': None,
        'deadline': None, 'announce': None, 'registerFrom': None, 'registerBy': None,
        'openedAt': None,          # 모집(신청) 시작일 — 플랫폼이 공개한 값만 넣는다
        'dday': None, 'deadlineDerived': False,
        'missions': None, 'missionSummary': None, 'keywords': [],
        'flags': {'aiBanned': None, 'extraCost': None, 'visitRequired': None, 'faceRequired': None},
        'url': None, 'applyUrl': None, 'thumbnail': None,
        'note': None, 'caution': None, 'source': None,
        'isNew': None, 'newEvidence': None, 'newRank': None, 'firstSeen': None,
    }
    row.update(kw)
    return row


# ---------------------------------------------------------------- 1) REVU
def scan_revu():
    """api.weble.net 공개 트렌딩 API — 로그인 없이 접근 가능한 유일한 공개 목록."""
    url = 'https://api.weble.net/v1/campaigns/trending'
    r = get(url, headers={**HEADERS, 'Referer': 'https://www.revu.net/', 'Accept': 'application/json'})
    r.raise_for_status()
    data = r.json()
    items = data.get('items') or []
    rows, today = [], datetime.now(KST).date()

    for it in items:
        cid = it.get('id')
        if not cid:
            continue
        cats = [c for c in (it.get('category') or []) if c not in ('배송형', '방문형')]
        title = clean(it.get('item')) or clean(it.get('title'))
        reward = clean((it.get('campaignData') or {}).get('reward'))
        stats = it.get('campaignStats') or {}
        applicants = to_int(stats.get('requestCount'))
        capacity = to_int(it.get('reviewerLimit')) or to_int(it.get('orderQuantity'))
        deadline = iso_date(it.get('requestEndedOn'))
        announce = iso_date(it.get('entryAnnouncedOn'))
        reg_from = iso_date(it.get('postingStartedOn'))
        reg_by = iso_date(it.get('postingEndedOn'))
        media = (it.get('media') or '').lower()
        media_kr = {'blog': '블로그', 'instagram': '인스타그램', 'youtube': '유튜브',
                    'clip': '클립', 'reels': '릴스', 'tiktok': '틱톡'}.get(media, media or '블로그')
        ctype = '배송형' if '배송형' in (it.get('category') or []) else (
            '방문형' if '방문형' in (it.get('category') or []) else None)
        flags = {'aiBanned': None, 'extraCost': None,
                 'visitRequired': (ctype == '방문형') if ctype else None, 'faceRequired': None}
        if (it.get('campaignData') or {}).get('isPortraitRights'):
            flags['faceRequired'] = True
        rows.append(base_row(
            id=str(cid), title=title,
            brand=(re.match(r'\[([^\]]+)\]', title or '') or [None, None])[1] if title else None,
            category=cat_group(*(cats or [])), categoryRaw=', '.join(cats) or None,
            media=media_kr, type=ctype, offer=reward,
            applicants=applicants, capacity=capacity,
            deadline=deadline, announce=announce, registerFrom=reg_from, registerBy=reg_by,
            # 모집(신청) 시작일 — 레뷰 공개 API 의 requestStartedOn(모집 시작)을 그대로 쓴다
            openedAt=iso_date(it.get('requestStartedOn')) or iso_date(str(it.get('createdAt') or '')),
            flags=flags,
            url='https://www.revu.net/campaign/%s' % cid,
            applyUrl='https://www.revu.net/campaign/%s/request' % cid,
            thumbnail=it.get('thumbnail'),
            note='레뷰 공개 트렌딩 API 실측 · 신청 %s명 / 모집 %s명 (조회 시점 %s)' % (
                applicants if applicants is not None else '?',
                capacity if capacity is not None else '?',
                datetime.now(KST).strftime('%H:%M')),
            source='revu-api:trending',
        ))

    note = ('공개 API(/v1/campaigns/trending)는 비로그인 접근이 가능하지만 목록이 10건 고정입니다. '
            '전체 목록 API(/v1/campaigns)는 인증(401)이 필요해 비로그인 수집이 불가합니다.')
    return rows, note


# ---------------------------------------------------------------- 2) 리뷰노트
RN_JSON = re.compile(r'<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>')


def scan_reviewnote():
    url = 'https://www.reviewnote.co.kr/campaigns'
    r = get(url)
    r.raise_for_status()
    m = RN_JSON.search(r.text)
    if not m:
        raise RuntimeError('__NEXT_DATA__ 를 찾지 못했습니다 (페이지 구조 변경 의심)')
    data = json.loads(m.group(1))
    page = data['props']['pageProps']['data']
    objs = page.get('objects') or []
    rows, today = [], datetime.now(KST).date()

    for it in objs:
        cid = it.get('id')
        if not cid:
            continue
        title = clean(it.get('title'))
        cat = clean((it.get('category') or {}).get('title'))
        city = clean(it.get('city'))
        sort = it.get('sort') or ''
        ctype = {'DELIVERY': '배송형', 'VISIT': '방문형', 'PAYBACK': '페이백'}.get(sort, sort or None)
        ch = it.get('channel') or 'BLOG'
        media_kr = {'BLOG': '블로그', 'BLOG_CLIP': '블로그 클립', 'INSTAGRAM': '인스타그램',
                    'REELS': '릴스', 'YOUTUBE': '유튜브'}.get(ch, ch)
        offer = clean(it.get('offer'))
        deadline = kst_date_from_utc(it.get('applyEndAt'))
        reg_by = kst_date_from_utc(it.get('extendedReviewEndAt') or it.get('reviewEndAt'))
        reg_from = kst_date_from_utc(it.get('draftStartedOn')) if it.get('draftStartedOn') else None
        flags = {'aiBanned': None, 'extraCost': None,
                 'visitRequired': (ctype == '방문형') if ctype else None, 'faceRequired': None}
        rows.append(base_row(
            id=str(cid), title=title,
            brand=(clean(it.get('brand')) if it.get('brand') else None),
            category=cat_group(cat, title), categoryRaw=cat, city=city,
            media=media_kr, type=ctype, offer=offer,
            applicants=to_int(it.get('applicantCount')), capacity=to_int(it.get('infNum')),
            deadline=deadline, announce=None, registerFrom=reg_from, registerBy=reg_by,
            flags=flags,
            url='https://www.reviewnote.co.kr/campaigns/%s' % cid,
            applyUrl='https://www.reviewnote.co.kr/campaigns/%s' % cid,
            thumbnail=('https://image.reviewnote.co.kr/' + it['imageKey']) if it.get('imageKey') else None,
            note='리뷰노트 캠페인 목록 SSR 데이터 실측%s' % ((' · 지역 ' + city) if city else ''),
            source='reviewnote:campaigns-next-data',
        ))
    note = ('캠페인 목록 페이지 SSR(__NEXT_DATA__)에서 %d건 수집. 페이지네이션은 클라이언트 처리라 '
            '1페이지(전체 %s건) 응답에 전 목록이 포함됩니다.' % (len(rows), page.get('total_count')))
    return rows, note


# ---------------------------------------------------------------- 3) 디너의여왕
DQ_CARD = re.compile(r'<div class="qz-dq-card campaign[\s\S]*?(?=<div class="qz-dq-card campaign|<div class="swiper-slide">\s*$|$)')


def _dq_city(title):
    """디너의여왕 제목 앞머리 '[ 경기 화성 ]' 의 지역 표기를 city 로 — 없으면 None."""
    t = str(title or '')
    m = re.search(r'\[\s*([^\]\[]{2,20}?)\s*\]', t)
    if m and find_region(m.group(1)):
        return m.group(1).strip()
    return None


def _dq_list_page(page_no):
    url = 'https://dinnerqueen.net/taste' + (('?page=%d' % page_no) if page_no > 1 else '')
    r = get(url)
    r.raise_for_status()
    return r.text


def _dq_parse_list(html_text):
    out = []
    for block in DQ_CARD.findall(html_text):
        m = re.search(r'href="/taste/(\d+)"\s+title="([^"]*)"', block)
        if not m:
            continue
        cid, title_attr = m.group(1), htmllib.unescape(m.group(2))
        title_attr = re.sub(r'\s*신청하기$', '', title_attr).strip()

        tm = re.search(r'qz-body2-kr ellipsis color-title w-600[\s\S]*?<span[^>]*>([\s\S]*?)</span>\s*</p>', block)
        title = clean(text_of(tm.group(1))) if tm else title_attr

        om = re.search(r'qz-caption-kr color-placeholder ellipsis w-500[^>]*>([\s\S]*?)</p>', block)
        offer = clean(text_of(om.group(1))) if om else None

        dm = re.search(r'<strong class="w-800">([\s\S]*?)</strong>', block)
        dday_txt = clean(text_of(dm.group(1))) if dm else None
        dday_num = None
        if dday_txt:
            nm = re.search(r'(\d+)\s*일\s*남음', dday_txt)
            if nm:
                dday_num = int(nm.group(1))
            elif '오늘' in dday_txt or 'D-DAY' in dday_txt.upper():
                dday_num = 0

        am = re.search(r'신청\s*([\d,]+)</strong><span class="color-subtitle">/</span><span class="color-subtitle">([\d,]*)', block)
        applicants = to_int(am.group(1)) if am else None
        capacity = to_int(am.group(2)) if am else None

        badges = [clean(b) for b in re.findall(r'<strong[^>]*>([^<]{1,12})</strong>', block)]
        badges = [b for b in badges if b]
        types = [b for b in badges if b in ('배송', '맛집', '지역', '여가', '뷰티', '클립', '릴스', '페이백', '기자단', '기타', '배달')]
        ctype = ('배송형' if '배송' in types else
                 ('기자단' if '기자단' in types else ('방문형' if types else None)))
        media = '릴스' if '릴스' in types else ('클립' if '클립' in types else '블로그')
        thumb = re.search(r'<img[^>]+src="([^"]+)"', block)

        out.append({
            'id': cid, 'title': title, 'offer': offer, 'ddayText': dday_txt, 'ddayNum': dday_num,
            'applicants': applicants, 'capacity': capacity, 'types': types,
            'type': ctype, 'media': media, 'thumbnail': thumb.group(1) if thumb else None,
        })
    return out


def _dq_detail(cid):
    url = 'https://dinnerqueen.net/taste/%s' % cid
    r = get(url)
    if r.status_code != 200:
        return None
    h = r.text
    out = {'url': url}

    pm = re.search(r'<strong>(\d{2}\.\d{2}\.\d{2}) &ndash; (\d{2}\.\d{2}\.\d{2})</strong>', h)
    if not pm:
        pm = re.search(r'<strong>(\d{2}\.\d{2}\.\d{2}) – (\d{2}\.\d{2}\.\d{2})</strong>', h)
    if pm:
        out['deadlineFrom'] = iso_date(pm.group(1))
        out['deadline'] = iso_date(pm.group(2))

    am = re.search(r'mb-mr-b015">(\d{2}\.\d{2}\.\d{2})</p>', h)
    if am:
        out['announce'] = iso_date(am.group(1))

    rm = re.search(r'<p class="qz-body-kr--line mb-qz-body2-kr--line">(\d{2}\.\d{2}\.\d{2}) – (\d{2}\.\d{2}\.\d{2})</p>', h)
    if not rm:
        rm = re.search(r'<p class="qz-body-kr--line[^"]*">(\d{2}\.\d{2}\.\d{2}) – (\d{2}\.\d{2}\.\d{2})</p>', h)
    if rm:
        out['registerFrom'] = iso_date(rm.group(1))
        out['registerBy'] = iso_date(rm.group(2))

    cm = re.search(r'<strong><span class="apply_data[^"]*"[^>]*>([\d,]+)</span>\s*/\s*([\d,]+)명</strong>', h)
    if cm:
        out['applicants'] = to_int(cm.group(1))
        out['capacity'] = to_int(cm.group(2))

    om = re.search(r'>제공 내역</strong>([\s\S]{0,3000}?)</div>\s*</div>\s*</div>', h)
    if om:
        offer = clean(text_of(om.group(1)))
        if offer:
            offer = re.split(r'참여 전 필수|필수 확인사항|★\s*추가금액', offer)[0].strip(' -·')
            out['offer'] = offer[:200] or None

    kws = re.findall(r'<span class="hash-block">([^<]+)</span>', h)
    if kws:
        out['keywords'] = [clean(k) for k in kws if clean(k)]

    if '생성형 AI' in h or 'AI 작성' in h or '인공지능' in h:
        seg = h[max(0, h.find('생성형 AI') - 200): h.find('생성형 AI') + 200]
        out['aiMention'] = clean(text_of(seg))[:200]

    tm = re.search(r'<div class="dq-taste-detail__thumb[\s\S]*?<img[^>]+src="([^"]+)"', h)
    if tm:
        out['thumbnail'] = tm.group(1)
    return out

def scan_dinnerqueen(with_detail=True):
    seen, ordered, pages_read = set(), [], 0
    for p in range(1, MAX_DQ_PAGES + 1):
        try:
            h = _dq_list_page(p)
        except Exception as e:                       # noqa: BLE001
            log('  · 디너의여왕 page %d 실패: %s' % (p, e))
            break
        items = _dq_parse_list(h)
        pages_read += 1
        new = 0
        for it in items:
            if it['id'] in seen:
                continue
            seen.add(it['id'])
            ordered.append(it)
            new += 1
        log('  · 디너의여왕 page %d — %d건 (누적 %d)' % (p, new, len(ordered)))
        if new == 0:
            break
        time.sleep(PAUSE)

    rows, today = [], datetime.now(KST).date()
    detail_targets = ordered[:MAX_DQ_DETAIL] if with_detail else []
    details = {}
    if detail_targets:
        from concurrent.futures import ThreadPoolExecutor

        def _work(it):
            try:
                d = _dq_detail(it['id']) or {}
            except Exception as e:                   # noqa: BLE001
                log('  · 상세 실패 %s: %s' % (it['id'], e))
                d = {}
            time.sleep(0.18)
            return it['id'], d

        done = 0
        with ThreadPoolExecutor(max_workers=DQ_WORKERS) as ex:
            for cid, d in ex.map(_work, detail_targets):
                details[cid] = d
                done += 1
                if done % 30 == 0:
                    log('  · 디너의여왕 상세 %d/%d' % (done, len(detail_targets)))

    for it in ordered:
        det = details.get(it['id']) or {}
        deadline = det.get('deadline') or deadline_from_dday(it['ddayNum'], today)
        derived = not det.get('deadline') and it['ddayNum'] is not None
        rows.append(base_row(
            id=it['id'], title=it['title'],
            brand=(re.match(r'\[([^\]]+)\]', it['title'] or '') or [None, None])[1] if it['title'] else None,
            category=cat_group(*(it['types'] or []), it['title'], det.get('offer')),
            categoryRaw=', '.join(it['types'] or []) or None,
            city=_dq_city(it['title']),
            media=it['media'], type=it['type'],
            offer=det.get('offer') or it['offer'],
            applicants=det.get('applicants', it['applicants']),
            capacity=det.get('capacity', it['capacity']),
            deadline=deadline, announce=det.get('announce'),
            registerFrom=det.get('registerFrom'), registerBy=det.get('registerBy'),
            # 디너의여왕 상세의 '신청 기간 시작일'(deadlineFrom) — 회차 단위라 표시용으로만 쓴다
            openedAt=det.get('deadlineFrom'),
            dday=it['ddayText'], deadlineDerived=derived,
            keywords=det.get('keywords') or [],
            flags={'aiBanned': (True if det.get('aiMention') and '불가' in det.get('aiMention', '') else None),
                   'extraCost': None,
                   'visitRequired': (it['type'] == '방문형') if it['type'] else None,
                   'faceRequired': None},
            url=det.get('url') or ('https://dinnerqueen.net/taste/%s' % it['id']),
            applyUrl='https://dinnerqueen.net/taste/%s' % it['id'],
            thumbnail=det.get('thumbnail') or it.get('thumbnail'),
            note=('디너의여왕 목록 실측' + ('' if det else ' (상세 페이지 미수집)')),
            caution=det.get('aiMention') if det.get('aiMention') and '불가' in det.get('aiMention', '') else None,
            source='dinnerqueen:taste',
        ))
    note = ('캠페인 목록 %d페이지에서 %d건 수집. 마감일·발표일·리뷰기간·제공내역·필수 키워드는 '
            '상세 페이지(/taste/{id})에서 확인%s.' % (pages_read, len(rows),
                                                  '' if with_detail else ' — 이번 실행은 --no-detail 로 생략'))
    return rows, note


# ---------------------------------------------------------------- 4) 미블
MB_ITEM = re.compile(r'<a href="https://www\.mrblog\.net/campaigns/(\d+)" class="campaign_item"([\s\S]*?)</a>')


def scan_mrblog():
    r = get('https://www.mrblog.net/')
    r.raise_for_status()
    h = r.text
    rows, today, seen = [], datetime.now(KST).date(), set()

    for m in MB_ITEM.finditer(h):
        cid, block = m.group(1), m.group(2)
        if cid in seen:
            continue
        seen.add(cid)
        area = re.search(r'<span class="area">([\s\S]*?)</span>\s*<strong class="subject"', block)
        area_txt = clean(text_of(area.group(1))) if area else None
        subj = re.search(r'<strong class="subject">([\s\S]*?)</strong>', block)
        title = clean(text_of(subj.group(1))) if subj else None
        desc = re.search(r'<p class="desc">([\s\S]*?)</p>', block)
        offer = clean(text_of(desc.group(1))) if desc else None
        dd = re.search(r'<span class="d_day">([\s\S]*?)</span>', block)
        dday_txt = clean(text_of(dd.group(1))) if dd else None
        dday_num = None
        if dday_txt:
            nm = re.search(r'(\d+)\s*일\s*남음', dday_txt)
            if nm:
                dday_num = int(nm.group(1))
            elif '오늘' in dday_txt:
                dday_num = 0
        cur = re.search(r'<span class="current">신청\s*<strong>([\d,]+)명</strong>', block)
        cap = re.search(r'/\s*모집\s*([\d,]+)명', block)
        media = '클립' if '>클립<' in block else ('인스타그램' if 'instagram' in block else '블로그')
        thumb = re.search(r'<img src="([^"]+)"', block)
        if not title:
            continue
        deadline = deadline_from_dday(dday_num, today)
        rows.append(base_row(
            id=cid, title=title,
            brand=None,
            category=cat_group(area_txt, title, offer),
            categoryRaw=area_txt,
            city=(area_txt if find_region(area_txt) else None),
            media=media, type=None, offer=offer,
            applicants=to_int(cur.group(1)) if cur else None,
            capacity=to_int(cap.group(1)) if cap else None,
            deadline=deadline, announce=None, registerFrom=None, registerBy=None,
            dday=dday_txt, deadlineDerived=deadline is not None,
            flags={'aiBanned': None, 'extraCost': None, 'visitRequired': None, 'faceRequired': None},
            url='https://www.mrblog.net/campaigns/%s' % cid,
            applyUrl='https://www.mrblog.net/campaigns/%s' % cid,
            thumbnail=thumb.group(1) if thumb else None,
            note='미블 홈페이지 공개 섹션(시선집중·프리미엄·마감임박) 실측 · 지역 %s' % (area_txt or '미표기'),
            source='mrblog:home',
        ))
    note = ('홈페이지에 공개된 추천/마감임박 섹션만 수집(%d건). 목록(/campaigns)과 상세(/campaigns/{id})는 '
            '로그인 세션이 있어야 열려 비로그인 수집이 불가합니다. 마감일은 화면의 D-day 표기에서 역산.' % len(rows))
    return rows, note


# ---------------------------------------------------------------- 5) 강남맛집
def scan_gangnam():
    """접속 시도 후 결과를 정직하게 기록. (수집 실패 시 빈 목록)"""
    cands = ['https://xn--939au0g4vj8sq.net/cp/', 'https://xn--939au0g4vj8sq.net/',
             'http://xn--939au0g4vj8sq.net/']
    err = None
    for u in cands:
        try:
            r = get(u, timeout=12)
            if r.status_code < 400 and 'campaign' in r.text.lower():
                return _gangnam_parse(r.text), 'HTML 파싱'
            err = 'HTTP %s' % r.status_code
        except Exception as e:                       # noqa: BLE001
            err = type(e).__name__ + ': ' + str(e)[:120]
        time.sleep(PAUSE)
    raise RuntimeError('강남맛집.net 접속 실패 — %s' % err)


def _gangnam_parse(h):
    """강남맛집.net(그누보드 계열) 목록 파싱 — 사이트 응답이 열릴 때만 동작."""
    rows, today = [], datetime.now(KST).date()
    for m in re.finditer(r'href="[^"]*[?&]id=(\d+)"[^>]*>([\s\S]{0,400}?)</a>', h):
        cid = m.group(1)
        title = clean(text_of(m.group(2)))
        if not title or len(title) < 3:
            continue
        rows.append(base_row(
            id=cid, title=title, category=cat_group(title), media='블로그', type=None,
            url='https://xn--939au0g4vj8sq.net/cp/?id=%s' % cid,
            applyUrl='https://xn--939au0g4vj8sq.net/cp/?id=%s' % cid,
            source='gangnam:cp', note='강남맛집 목록 실측',
        ))
    return rows


# ---------------------------------------------------------------- 6) 포포몬
POP_API = 'https://popomon.com/api_p/main/fetch_getRenewalMainContent?cond1=&cond2='
POP_HEADERS = {'Referer': 'https://popomon.com/', 'Origin': 'https://popomon.com',
               'Accept': 'application/json, text/plain, */*'}
POP_TYPE = {'shipping': '배송형', 'visiting': '방문형', 'reporting': '기자단', 'buyReview': '페이백'}
POP_MEDIA = {
    'BLOG': '블로그', 'BLOG_CONTENT': '블로그', 'BLOG_RECEIPT': '블로그 구매평',
    'SMARTSTORE_BLOG': '스마트스토어 블로그', 'COUPANG_BLOG': '쿠팡 블로그',
    'BLOG_GOOGLEREVIEW': '블로그+구글리뷰', 'REELS': '릴스', 'REELS_CONTENT': '릴스',
    'INSTAGRAM': '인스타그램', 'INSTAGRAM_CONTENT': '인스타그램', 'TIKTOK_CONTENT': '틱톡',
    'CLIP': '클립', 'YOUTUBE': '유튜브', 'YOUTUBE_CONTENT': '유튜브',
}
POP_CAT = {'FOOD': '식품', 'RESTAURANT': '맛집', 'CAFE': '맛집', 'BEAUTY': '뷰티',
           'LIFE': '생활', 'LEISURE': '여가', 'ROOMS': '여가', 'FASHION': '패션',
           'DIGITAL': '디지털', 'KIDS': '육아'}


def _pop_token(title):
    """포포몬 제목 앞머리 '[경기/가평군]' '[배송]' '[여가/기자단]' 토큰."""
    m = re.match(r'\s*\[([^\]]{1,20})\]', str(title or ''))
    return m.group(1).strip() if m else None


def scan_popomon():
    """포포몬 홈페이지가 스스로 불러오는 공개 API(비로그인).

    전체 캠페인 목록(/campaign)은 로그인 후에만 렌더되어 비로그인 수집이 불가하고,
    홈 API가 내려 주는 신규·인기·플래티넘·오픈예정·카테고리 인기 목록만 담는다.
    """
    r = get(POP_API, headers={**HEADERS, **POP_HEADERS})
    r.raise_for_status()
    data = (r.json() or {}).get('data') or {}
    pool = {}

    def take(items):
        for it in items or []:
            if not isinstance(it, dict):
                continue
            cid = str(it.get('C_idx') or '').strip()
            if cid and cid not in pool:
                pool[cid] = it

    take((data.get('platinumCampaign') or {}).get('platinumCampaign') or [])
    take(data.get('newCampaign') or [])
    take(data.get('bestCampaign') or [])
    take(data.get('scheduleToOpen') or [])
    for blk in data.get('contentsData4_1') or []:
        take(blk.get('data') or [])

    rows = []
    for cid, it in list(pool.items())[:CAP_POPOMON]:
        title = clean(it.get('C_title'))
        if not title:
            continue
        tok = _pop_token(title)
        ctype = POP_TYPE.get(str(it.get('C_recruit_type') or '').strip())
        offer = clean(it.get('C_provision'))
        price = to_int(it.get('C_provision_price'))
        if price is not None and price <= 0:
            price = None
        rows.append(base_row(
            id=cid, title=title, brand=None,
            category=cat_group(POP_CAT.get(str(it.get('CT_type') or ''), ''), tok, title),
            categoryRaw=tok,
            city=(tok if tok and find_region(tok) else None),
            media=POP_MEDIA.get(str(it.get('CS_type') or ''), '블로그'),
            type=ctype, offer=offer, price=price,
            applicants=to_int(it.get('C_volunteer_count')),
            capacity=to_int(it.get('C_choice_count')),
            deadline=iso_date(it.get('C_regi_end_date')),
            announce=iso_date(it.get('C_choice_date')),
            registerFrom=iso_date(it.get('C_regi_start_date')),
            openedAt=iso_date(it.get('C_regi_start_date')),
            dday=None,
            flags={'aiBanned': None, 'extraCost': None,
                   'visitRequired': (ctype == '방문형') if ctype else None,
                   'faceRequired': None},
            url='https://popomon.com/campaign/%s' % cid,
            applyUrl='https://popomon.com/campaign/%s' % cid,
            thumbnail=clean(it.get('thumb_img')) or clean(it.get('C_thumb_img_path')),
            note='포포몬 홈 공개 API 실측 · 지원 %s명 / 모집 %s명' % (
                it.get('C_volunteer_count') or '?', it.get('C_choice_count') or '?'),
            source='popomon:main-api',
        ))
    note = ('홈페이지가 스스로 불러오는 공개 API(api_p/main)의 플래티넘·신규·인기·오픈예정·'
            '카테고리 인기 목록에서 %d건 수집. 전체 목록(/campaign)은 로그인 후에만 렌더되어 '
            '비로그인 수집이 불가합니다(robots.txt 도 /campaign 을 Disallow).' % len(rows))
    return rows, note


# ---------------------------------------------------------------- 7) 오마이블로그
OHMY_API = 'https://ohmyblog.co.kr/api/web/campaign/active'
OHMY_HEADERS = {'Referer': 'https://ohmyblog.co.kr/', 'Accept': 'application/json'}
OHMY_TYPE = {'A': '방문형', 'B': '배송형', 'C': '방문형', 'D': '기자단',
             'E': '방문형', 'F': '기자단'}
OHMY_MEDIA = {
    'NAVERBLOGPOST': '블로그', 'NAVERBLOGPOSTNAVERSHORTS': '블로그+네이버숏폼',
    'NAVERBLOGPOSTINSTAGRAMREELS': '블로그+릴스', 'INSTAGRAMREELS': '릴스',
    'NAVERSHORTS': '네이버숏폼', 'GENERAL': '블로그',
}


def scan_ohmyblog():
    """오마이블로그 공개 API — 비로그인 JSON 목록(전체 360건, 40~60건 상한)."""
    rows, page, seen = [], 1, set()
    total = None
    while len(rows) < CAP_OHMYBLOG and page <= 4:
        r = get(OHMY_API, params={'page': page, 'limit': 20},
                headers={**HEADERS, **OHMY_HEADERS})
        r.raise_for_status()
        js = r.json() or {}
        d = js.get('data') or {}
        items = d.get('campaigns') or []
        total = d.get('total') or total
        if not items:
            break
        for it in items:
            cid = str(it.get('app_seq') or '').strip()
            title = clean(it.get('app_title'))
            if not cid or not title or cid in seen:
                continue
            seen.add(cid)
            company = clean(it.get('app_companyName'))
            tok = None
            m = re.search(r'\[([^\]]{1,15})\]', company or '')
            if m:
                tok = m.group(1).strip()
            ctype = OHMY_TYPE.get(str(it.get('app_type') or '').strip())
            rows.append(base_row(
                id=cid, title=title, brand=company,
                category=cat_group(tok, title, it.get('supplyItem')),
                categoryRaw=(str(it.get('app_type_text') or '') or None),
                city=(tok if tok and find_region(tok) else None),
                media=OHMY_MEDIA.get(str(it.get('content_type') or ''), '블로그'),
                type=ctype, offer=clean(it.get('supplyItem')),
                price=(to_int(it.get('supportMoney')) or None),
                applicants=None,
                capacity=to_int(it.get('app_recruitCount')),
                deadline=iso_date(str(it.get('app_recruitEndDate') or '')[:10]),
                announce=None,
                registerFrom=iso_date(str(it.get('app_recruitStartDate') or '')[:10]),
                openedAt=iso_date(str(it.get('app_recruitStartDate') or '')[:10]),
                flags={'aiBanned': None, 'extraCost': None,
                       'visitRequired': (ctype == '방문형') if ctype else None,
                       'faceRequired': None},
                url='https://ohmyblog.co.kr/user/search?keyword=' + quote(title),
                applyUrl='https://ohmyblog.co.kr/user/search?keyword=' + quote(title),
                thumbnail=('https://ohmyblog.co.kr' + it['thumbnail']) if it.get('thumbnail') else None,
                note='오마이블로그 공개 API 실측 · 유형 %s · 상세는 앱에서 열립니다(제목 검색 링크)'
                     % (clean(it.get('app_type_text')) or '미표기'),
                source='ohmyblog:campaign-api',
            ))
            if len(rows) >= CAP_OHMYBLOG:
                break
        if len(items) < 20:
            break
        page += 1
        time.sleep(PAUSE)
    note = ('공개 API(/api/web/campaign/active)에서 진행 중 캠페인 %s건 중 %d건 수집. '
            '상세 페이지는 앱 전용이라 제목 검색 링크로 연결합니다.' % (total or '?', len(rows)))
    return rows, note


# ---------------------------------------------------------------- 8) 더먹자
TM_LIST = 'https://www.themukja.com/review_campaign_list.php'


def scan_themukja():
    """더먹자(수원·화성·평택 맛집 특화) 목록 HTML — 서버렌더 카드."""
    r = get(TM_LIST)
    r.raise_for_status()
    h = r.text
    rows, today, seen = [], datetime.now(KST).date(), set()
    for blk in re.split(r'<li>', h):
        m = re.search(r'review_campaign\.php\?cp_id=(\d+)', blk)
        if not m:
            continue
        cid = m.group(1)
        if cid in seen:
            continue
        area = re.search(r'<span class="area">([\s\S]*?)</span>', blk)
        name = re.search(r'<span class="it_name">([\s\S]*?)</span>', blk)
        desc = re.search(r'<span class="it_description">([\s\S]*?)</span>', blk)
        dday = re.search(r'<span class="dday">([\s\S]*?)</span>', blk)
        mojip = re.search(r'<span class="mojip">모집\s*<b[^>]*>([\d,]+)</b>', blk)
        thumb = re.search(r'<img[^>]+src="([^"]+)"[^>]*class="it_img"', blk)
        if not thumb:
            thumb = re.search(r'<img[^>]+class="it_img"[^>]+src="([^"]+)"', blk)
        title = clean(text_of(name.group(1))) if name else None
        if not title:
            continue
        seen.add(cid)
        area_txt = clean(text_of(area.group(1))) if area else None
        dday_txt = clean(text_of(dday.group(1))) if dday else None
        dday_num = None
        if dday_txt:
            nm = re.search(r'(\d+)', dday_txt)
            if nm:
                dday_num = int(nm.group(1))
            elif '오늘' in dday_txt:
                dday_num = 0
        sns = re.findall(r'class="sns ([a-z]+)"', blk)
        media = ('인스타그램' if 'insta' in sns else '유튜브' if 'youtube' in sns
                 else '클립' if 'clip' in sns else '블로그')
        deadline = deadline_from_dday(dday_num, today)
        thumb_url = thumb.group(1) if thumb else None
        if thumb_url and thumb_url.startswith('./'):
            thumb_url = 'https://www.themukja.com/' + thumb_url[2:]
        rows.append(base_row(
            id=cid, title=title, brand=None,
            category=cat_group(area_txt, title, clean(text_of(desc.group(1))) if desc else None),
            categoryRaw=area_txt,
            city=(area_txt if area_txt and find_region(area_txt) else None),
            media=media, type='방문형',
            offer=clean(text_of(desc.group(1))) if desc else None,
            applicants=None, capacity=to_int(mojip.group(1)) if mojip else None,
            deadline=deadline, announce=None, dday=dday_txt,
            deadlineDerived=deadline is not None,
            flags={'aiBanned': None, 'extraCost': None, 'visitRequired': True,
                   'faceRequired': None},
            url='https://www.themukja.com/review_campaign.php?cp_id=%s' % cid,
            applyUrl='https://www.themukja.com/review_campaign.php?cp_id=%s' % cid,
            thumbnail=thumb_url,
            note='더먹자 목록 실측 · 지역 %s · 모집 %s명' % (area_txt or '미표기',
                                                       mojip.group(1) if mojip else '?'),
            source='themukja:campaign-list',
        ))
        if len(rows) >= CAP_THEMUKJA:
            break
    note = ('목록 페이지(review_campaign_list.php)에서 %d건 수집. 수원·화성·평택 등 경기 남부 맛집 '
            '방문형 중심이며 마감일은 화면 D-day 표기에서 역산합니다.' % len(rows))
    return rows, note


# ---------------------------------------------------------------- 9) 원픽체험단
ONEPIK_LIST = 'https://onepik.kr/campaigns'
ONEPIK_TYPE = {'방문형': '방문형', '배송형': '배송형', '기자단': '기자단', '촬영형': '방문형'}


def scan_onepik():
    """원픽체험단 목록 HTML — 서버렌더 카드(21건/페이지)."""
    rows, today, seen, page = [], datetime.now(KST).date(), set(), 1
    while len(rows) < CAP_ONEPIK and page <= 4:
        r = get(ONEPIK_LIST, params={'page': page})
        r.raise_for_status()
        h = r.text
        for m in re.finditer(r'<a href="/campaigns/(\d+)" class="card">([\s\S]*?)</a>', h):
            cid, blk = m.group(1), m.group(2)
            if cid in seen:
                continue
            ti = re.search(r'<div class="title">([\s\S]*?)</div>', blk)
            title = clean(text_of(ti.group(1))) if ti else None
            if not title:
                continue
            seen.add(cid)
            badge = re.search(r'<span class="badge[^"]*">([^<]+)</span>', blk)
            ctype = ONEPIK_TYPE.get(clean(badge.group(1)) if badge else '', None)
            dd = re.search(r'<span class="deadline-badge"[^>]*>D-(\d+)</span>', blk)
            dday_num = int(dd.group(1)) if dd else 0 if '오늘' in blk[:200] else None
            promo = re.search(r'<div class="promo[^"]*">([\s\S]*?)</div>', blk)
            biz = re.search(r'<div class="biz-row">([\s\S]*?)</div>', blk)
            price = re.search(r'<div class="price">[^<]*<strong>([\d,]+)원</strong>', blk)
            ap = re.search(r'신청 <strong>([\d,]+)</strong>\s*/\s*([\d,]+)', blk)
            rg = re.search(r'📍\s*([^<\s]+)', blk)
            thumb = re.search(r'<img src="([^"]+)"', blk)
            thumb_url = None
            if thumb:
                thumb_url = htmllib.unescape(thumb.group(1))
                if thumb_url.startswith('/'):
                    thumb_url = 'https://onepik.kr' + thumb_url
            region = clean(rg.group(1)) if rg else None
            deadline = deadline_from_dday(dday_num, today)
            rows.append(base_row(
                id=cid, title=title, brand=clean(text_of(biz.group(1))) if biz else None,
                category=cat_group(region, title, promo.group(1) if promo else None),
                categoryRaw=(clean(badge.group(1)) if badge else None),
                city=region, media='블로그', type=ctype,
                offer=clean(text_of(promo.group(1))) if promo else None,
                price=(to_int(price.group(1)) if price else None),
                applicants=to_int(ap.group(1)) if ap else None,
                capacity=to_int(ap.group(2)) if ap else None,
                deadline=deadline, deadlineDerived=deadline is not None,
                flags={'aiBanned': None, 'extraCost': None,
                       'visitRequired': (ctype == '방문형') if ctype else None,
                       'faceRequired': None},
                url='https://onepik.kr/campaigns/%s' % cid,
                applyUrl='https://onepik.kr/campaigns/%s' % cid,
                thumbnail=thumb_url,
                note='원픽체험단 목록 실측 · 신청 %s / 모집 %s' % (
                    ap.group(1) if ap else '?', ap.group(2) if ap else '?'),
                source='onepik:campaigns',
            ))
            if len(rows) >= CAP_ONEPIK:
                break
        if len(rows) >= CAP_ONEPIK:
            break
        page += 1
        time.sleep(PAUSE)
    note = ('목록(/campaigns) 서버렌더 카드에서 최신 %d건 수집(전체 2,800여 건 중 최신순 상한). '
            '마감일은 화면 D-day 표기에서 역산. 우리동네체험단(wowdan.kr)은 같은 캠페인을 '
            '97%% 중복으로 제공해 중복 카드 방지를 위해 넣지 않았습니다.' % len(rows))
    return rows, note


# ---------------------------------------------------------------- 10) 리뷰플레이스
RP_LIST = 'https://www.reviewplace.co.kr/pr/'
RP_TYPE = {'제품': '배송형', '지역': '방문형', '기자단': '기자단', '구매평': '페이백'}
RP_MEDIA = [('클립', '클립'), ('인스타릴스', '인스타그램 릴스'), ('릴스', '릴스'),
            ('유튜브', '유튜브'), ('인스타', '인스타그램'), ('블로그', '블로그')]


def _rp_year_md(md):
    """'11.23' → '2026-11-23' (연말을 넘기는 12월→1월 보정)."""
    m = re.match(r'(\d{1,2})\.(\d{1,2})', str(md or ''))
    if not m:
        return None
    today = datetime.now(KST).date()
    mo, d = int(m.group(1)), int(m.group(2))
    y = today.year
    try:
        cand = datetime(y, mo, d, tzinfo=KST).date()
    except ValueError:
        return None
    if (today - cand).days > 60:
        try:
            cand = datetime(y + 1, mo, d, tzinfo=KST).date()
        except ValueError:
            return None
    return cand.strftime('%Y-%m-%d')


def _rp_detail(cid):
    r = get(RP_LIST, params={'id': cid})
    if r.status_code != 200:
        return {}
    x = text_of(r.text)
    out = {}
    m = re.search(r'모집기간\s*(\d{1,2}\.\d{1,2})\s*~\s*(\d{1,2}\.\d{1,2})', x)
    if m:
        out['deadline'] = _rp_year_md(m.group(2))
        out['registerFrom'] = _rp_year_md(m.group(1))
    m = re.search(r'리뷰어발표\s*(\d{1,2}\.\d{1,2})', x)
    if m:
        out['announce'] = _rp_year_md(m.group(1))
    m = re.search(r'제공내역\s*([\s\S]{1,300}?)(?:제목키워드|본문키워드|방문 및 예약안내|캠페인 안내|리뷰어 미션|진행방식|유의사항|★)', x)
    if m:
        out['offer'] = clean(m.group(1)).strip(' -*·')[:200]
    m = re.search(r'제목키워드\s*([\s\S]{1,200}?)#', x)
    if m:
        kws = [clean(k) for k in re.split(r'[,·]', m.group(1)) if clean(k)]
        out['keywords'] = kws[:8]
    if 'AI 사용 불가' in x or 'AI 사용 금지' in x or 'AI 생성' in x:
        out['aiBanned'] = True
    return out


def scan_reviewplace():
    """리뷰플레이스 목록(제품·지역 카테고리) + 상세의 모집기간·제공내역."""
    rows, today, seen = [], datetime.now(KST).date(), set()
    plan = [('제품', 2), ('지역', 2)]
    for ct1, pages in plan:
        for page in range(1, pages + 1):
            if len(rows) >= CAP_REVIEWPLACE:
                break
            r = get(RP_LIST, params={'ct1': ct1, 'page': page})
            r.raise_for_status()
            items = re.findall(r"<div class='item'><a href='/pr/\?id=(\d+)[^']*'>(.*?)</a></div>",
                               r.text, re.S)
            for cid, blk in items:
                if len(rows) >= CAP_REVIEWPLACE:
                    break
                if cid in seen:
                    continue
                ti = re.search(r"<p class='tit'>([\s\S]*?)</p>", blk)
                title = clean(text_of(ti.group(1))) if ti else None
                if not title:
                    continue
                seen.add(cid)
                tx = re.search(r"<p class='txt'>([\s\S]*?)</p>", blk)
                dd = re.search(r"class='date'>[\s\S]{0,60}?D</em>\s*-\s*(\d+)", blk)
                dday_num = int(dd.group(1)) if dd else None
                ap = re.search(r'<p>신청\s*([\d,]+)<span>\s*/\s*([\d,]+)명', blk)
                thumb = re.search(r'<img src="([^"]+)"', blk)
                media = '블로그'
                for key, label in RP_MEDIA:
                    if key in title:
                        media = label
                        break
                deadline = deadline_from_dday(dday_num, today)
                row = base_row(
                    id=cid, title=title, brand=None,
                    category=cat_group(title, tx.group(1) if tx else None),
                    categoryRaw=ct1, media=media,
                    type=RP_TYPE.get(ct1),
                    offer=clean(text_of(tx.group(1)))[:200] if tx else None,
                    applicants=to_int(ap.group(1)) if ap else None,
                    capacity=to_int(ap.group(2)) if ap else None,
                    deadline=deadline, deadlineDerived=deadline is not None,
                    flags={'aiBanned': None, 'extraCost': None,
                           'visitRequired': (RP_TYPE.get(ct1) == '방문형'),
                           'faceRequired': None},
                    url='https://www.reviewplace.co.kr/pr/?id=%s' % cid,
                    applyUrl='https://www.reviewplace.co.kr/pr/?id=%s' % cid,
                    thumbnail=thumb.group(1) if thumb else None,
                    note='리뷰플레이스 %s 목록 실측' % ct1,
                    source='reviewplace:list',
                )
                rows.append(row)
            time.sleep(PAUSE)

    # 상세에서 모집기간·제공내역·키워드 보강 (최대 40건, 4스레드)
    if rows:
        from concurrent.futures import ThreadPoolExecutor
        targets = rows[:CAP_REVIEWPLACE]

        def _work(row):
            try:
                d = _rp_detail(row['id'])
            except Exception:                        # noqa: BLE001
                d = {}
            time.sleep(0.15)
            return row['id'], d

        done = {}
        with ThreadPoolExecutor(max_workers=4) as ex:
            for cid, d in ex.map(_work, targets):
                done[cid] = d
        for row in rows:
            d = done.get(row['id']) or {}
            if d.get('deadline'):
                row['deadline'] = d['deadline']
                row['deadlineDerived'] = False
            if d.get('registerFrom'):
                row['registerFrom'] = d['registerFrom']
                row['openedAt'] = d['registerFrom']      # 모집기간 시작일
            if d.get('announce'):
                row['announce'] = d['announce']
            if d.get('offer'):
                row['offer'] = d['offer']
            if d.get('keywords'):
                row['keywords'] = d['keywords']
            if d.get('aiBanned'):
                row['flags']['aiBanned'] = True
                row['caution'] = 'AI 사용 불가 캠페인(상세 안내)'
            row['note'] = (row['note'] + ' · 상세 모집기간 확인') if d.get('deadline') else row['note']
    note = ('리뷰플레이스 목록(제품·지역) %d건 + 상세의 모집기간·발표일·제공내역·키워드 보강. '
            '마감일은 목록 D-day 역산, 상세에서 확인되면 상세 값 우선.' % len(rows))
    return rows, note


# ---------------------------------------------------------------- 11) 링블
RB_CAT = {'829': ('제품', '배송형'), '832': ('방문', '방문형'),
          '834': ('기자단', '기자단'), '1015': ('인스타', None), '833': ('유튜브', None)}
RB_PER_CAT = {'829': 20, '832': 16, '834': 8}


def _rb_ymd(y, mo, d):
    try:
        return datetime(int('20' + str(y)) if len(str(y)) == 2 else int(y),
                        int(mo), int(d)).strftime('%Y-%m-%d')
    except Exception:                                # noqa: BLE001
        return None


def _rb_detail(cid):
    r = get('https://ringble.co.kr/detail.php', params={'number': cid})
    if r.status_code != 200:
        return {}
    x = text_of(r.text)
    out = {}
    m = re.search(r'모집 기간\s*(\d{2})년\s*(\d{2})월\s*(\d{2})일[^~]*~\s*(\d{2})년\s*(\d{2})월\s*(\d{2})일', x)
    if m:
        out['registerFrom'] = _rb_ymd(m.group(1), m.group(2), m.group(3))
        out['deadline'] = _rb_ymd(m.group(4), m.group(5), m.group(6))
    m = re.search(r'당첨자 발표일\s*(\d{2})년\s*(\d{2})월\s*(\d{2})일', x)
    if m:
        out['announce'] = _rb_ymd(m.group(1), m.group(2), m.group(3))
    m = re.search(r'제공내역\s*([\s\S]{1,200}?)(?:유의사항|상세 URL|리뷰어 미션|필수 키워드)', x)
    if m:
        out['offer'] = clean(m.group(1))[:200]
    m = re.search(r'키워드\s*:\s*([^\n]{1,200}?)(?:위 키워드|$)', x)
    if m:
        out['keywords'] = [clean(k) for k in re.split(r',', m.group(1)) if clean(k)][:8]
    if 'AI 생성' in x and '불가' in x:
        out['aiBanned'] = True
    return out


def scan_ringble():
    """링블 — 카테고리별 목록(제품·방문·기자단) + 상세 모집기간."""
    rows, seen = [], set()
    for cat, (label, ctype) in RB_CAT.items():
        limit = RB_PER_CAT.get(cat)
        if not limit:
            continue
        r = get('https://ringble.co.kr/category.php', params={'category': cat})
        r.raise_for_status()
        h = r.text
        got = 0
        for blk in re.split(r"<td width='240' class='store_list_wrap'", h)[1:]:
            if got >= limit:
                break
            cid_m = re.search(r"detail\.php\?number=(\d+)", blk)
            if not cid_m:
                continue
            cid = cid_m.group(1)
            t2 = re.search(r"class=\"list_title\"[^>]*font-size:14px;\"[^>]*>([^<]{2,120})</a>", blk)
            if not t2:
                t2 = re.search(r"class=\"list_title\"[^>]*>([^<]{2,120})</a>", blk)
            title = clean(t2.group(1)) if t2 else None
            if not title or cid in seen:
                continue
            seen.add(cid)
            got += 1
            ap = re.search(r'신청\s*(\d+)</font>\s*/\s*<font[^>]*>모집\s*(\d+)', blk)
            dd = re.search(r"class=\"list_title\"[^>]*padding-left[^>]*>([^<]{2,14})</a>", blk)
            dday_txt = clean(dd.group(1)) if dd else None
            dday_num = None
            if dday_txt:
                nm = re.search(r'(\d+)\s*일', dday_txt)
                if nm:
                    dday_num = int(nm.group(1))
                elif '오늘' in dday_txt:
                    dday_num = 0
            thumb = re.search(r"<img src=\"([^\"]+)\"", blk)
            rows.append(base_row(
                id=cid, title=title, brand=None,
                category=cat_group(title), categoryRaw=label,
                city=None, media='블로그', type=ctype,
                applicants=to_int(ap.group(1)) if ap else None,
                capacity=to_int(ap.group(2)) if ap else None,
                deadline=deadline_from_dday(dday_num, datetime.now(KST).date()),
                dday=dday_txt,
                deadlineDerived=dday_num is not None,
                flags={'aiBanned': None, 'extraCost': None,
                       'visitRequired': (ctype == '방문형') if ctype else None,
                       'faceRequired': None},
                url='https://ringble.co.kr/detail.php?number=%s' % cid,
                applyUrl='https://ringble.co.kr/detail.php?number=%s' % cid,
                thumbnail=(('https://ringble.co.kr/' + thumb.group(1).lstrip('./'))
                           if thumb else None),
                note='링블 %s 카테고리 목록 실측 · 신청 %s / 모집 %s' % (
                    label, ap.group(1) if ap else '?', ap.group(2) if ap else '?'),
                source='ringble:category',
            ))
        time.sleep(PAUSE)

    if rows:
        from concurrent.futures import ThreadPoolExecutor

        def _work(row):
            try:
                d = _rb_detail(row['id'])
            except Exception:                        # noqa: BLE001
                d = {}
            time.sleep(0.15)
            return row['id'], d

        done = {}
        with ThreadPoolExecutor(max_workers=4) as ex:
            for cid, d in ex.map(_work, rows):
                done[cid] = d
        for row in rows:
            d = done.get(row['id']) or {}
            if d.get('deadline'):
                row['deadline'] = d['deadline']
                row['deadlineDerived'] = False
            if d.get('registerFrom'):
                row['registerFrom'] = d['registerFrom']
                row['openedAt'] = d['registerFrom']      # 모집 기간 시작일
            if d.get('announce'):
                row['announce'] = d['announce']
            if d.get('offer'):
                row['offer'] = d['offer']
            if d.get('keywords'):
                row['keywords'] = d['keywords']
            if d.get('aiBanned'):
                row['flags']['aiBanned'] = True
                row['caution'] = 'AI 생성 이미지 사용 불가 캠페인(상세 안내)'
    note = ('카테고리(제품·방문·기자단) 목록 %d건 + 상세의 모집기간·발표일·제공내역·키워드 보강. '
            '인스타·유튜브 카테고리는 유형(배송/방문) 표기가 없어 제외.' % len(rows))
    return rows, note


# ---------------------------------------------------------------- merge / write
def load_prev(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:                                # noqa: BLE001
        return None


def seen_path(out_path):
    return os.path.join(os.path.dirname(out_path), 'revu-seen.json')


def load_seen(path):
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:                                # noqa: BLE001
        return {}


def _iso_to_date(s):
    try:
        return datetime.strptime(str(s), '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None


def _int_id(r):
    s = str(r.get('id') or '').strip()
    return int(s) if s.isdigit() else None


NEW_RULE = (
    'NEW = 등록 시점이 확인된 것만. ① 플랫폼 id 가 숫자면 "플랫폼별 지금까지 본 가장 큰 id" 보다 큰 id 로 들어온 캠페인'
    '(직전 수집 이후 새로 등록), ② id 가 숫자가 아니면 상세의 모집 시작일(openedAt)이 48시간 이내인 캠페인. '
    '마감이 지난 캠페인은 제외. 플랫폼이 하루 회차를 통째로 올리는 곳(디너의여왕·리뷰노트·오마이블로그·'
    '리뷰플레이스·링블)은 회차 전체가 신규로 잡혀 예전처럼 NEW 가 도배되므로, 플랫폼별 최신 %d건만 NEW 로 '
    '표시하고 나머지는 마감임박(🔥 오늘마감 / ⏰ D-1~3) 뱃지로 보여준다.' % NEW_CAP_PER_PLATFORM)


def platform_baseline(prev):
    """직전 수집본에서 플랫폼별 '지금까지 본 가장 큰 id'."""
    base = {}
    meta = (prev or {}).get('meta') or {}
    for k, v in (meta.get('platformMaxId') or {}).items():
        try:
            base[k] = int(v)
        except (TypeError, ValueError):
            pass
    for r in (prev or {}).get('campaigns') or []:
        n = _int_id(r)
        if n is not None and n > base.get(r.get('platform'), -1):
            base[r['platform']] = n
    return base


def mark_new(rows, prev, today):
    """신규(NEW) 판별 — '등록 시점' 근거만 쓴다.

    예전에는 '직전 스냅샷에 없던 id' 를 모두 NEW 로 잡았는데, 디너의여왕·리뷰노트처럼 회차를 통째로
    교체하는 플랫폼과 상한(CAP_*) 윈도가 돌아가는 플랫폼 탓에 전체의 77%가 NEW 가 됐다.
    이제는 플랫폼별 최대 id 기준선(meta.platformMaxId)을 이어받아 '기준선보다 큰 id = 새로 등록된 것'
    만 신규로 보고, 플랫폼별 NEW_CAP_PER_PLATFORM 건으로 상한을 둔다.
    firstSeen/revu-seen.json 은 '처음 본 날' 표시용으로만 남긴다(신규 판별에 쓰지 않는다).
    """
    base = platform_baseline(prev)
    path = seen_path(CUR_OUT[0])
    seen = load_seen(path)
    prev_campaigns = (prev or {}).get('campaigns') or []
    prev_ids = {'%s:%s' % (c.get('platform') or 'revu', c.get('id')) for c in prev_campaigns}
    first_run = not prev_ids and not seen
    today_s = today.strftime('%Y-%m-%d')
    prev_day = iso_date(str(((prev or {}).get('meta') or {}).get('collectedAt') or '')) or None
    existing_s = prev_day if (prev_day and prev_day < today_s) else (today - timedelta(days=1)).strftime('%Y-%m-%d')

    # 1) '처음 본 날' 기록(표시용) + 등록 근거 판별
    by_plat = {}
    for r in rows:
        uid = '%s:%s' % (r['platform'], r['id'])
        if uid not in seen:
            seen[uid] = existing_s if (first_run or uid in prev_ids) else today_s
        r['firstSeen'] = seen[uid]
        r['isNew'] = False
        r['newEvidence'] = None
        r['newRank'] = None

        if not (r.get('ddayNum') is None or r['ddayNum'] >= 0):   # 마감이 지났으면 신규 아님
            continue
        n = _int_id(r)
        pbase = base.get(r['platform'])
        if n is not None and pbase is not None:
            ev = 'id' if n > pbase else None
        else:
            # 기준선이 없는 플랫폼(이번에 새로 추가)은 오늘 기준선만 잡고 신규로 세지 않는다
            opened = _iso_to_date(r.get('openedAt'))
            ev = 'opened' if (opened and today - timedelta(days=2) < opened <= today) else None
        if ev:
            r['newEvidence'] = ev
            by_plat.setdefault(r['platform'], []).append(r)

    # 2) 플랫폼별 상한 — 최신(가장 큰 id, 없으면 늦은 모집 시작일) 순으로 상위 N건만 NEW
    shown, raw, by_platform = 0, 0, {}
    for p, items in by_plat.items():
        items.sort(key=lambda x: ((_int_id(x) or 0), x.get('openedAt') or ''), reverse=True)
        for i, r in enumerate(items):
            r['newRank'] = i + 1
            if i < NEW_CAP_PER_PLATFORM:
                r['isNew'] = True
                shown += 1
        raw += len(items)
        by_platform[p] = {'raw': len(items), 'shown': min(len(items), NEW_CAP_PER_PLATFORM)}

    # 3) 다음 회차 기준선 — 플랫폼별 최대 id(단조 증가로만 갱신)
    max_ids = dict(base)
    for r in rows:
        n = _int_id(r)
        if n is not None and n > max_ids.get(r['platform'], -1):
            max_ids[r['platform']] = n

    # 오래된 기록 정리(30일) + 현재 목록에 없는 id 제거
    keep = {}
    limit_day = (today - timedelta(days=30)).strftime('%Y-%m-%d')
    live = {'%s:%s' % (r['platform'], r['id']) for r in rows}
    for uid, day in seen.items():
        if uid in live and day >= limit_day:
            keep[uid] = day
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(keep, f, ensure_ascii=False, indent=0)
    except Exception:                                # noqa: BLE001
        pass

    return {'shown': shown, 'raw': raw, 'byPlatform': by_platform, 'maxIds': max_ids}


CUR_OUT = [None]


def merge_revu_prev(prev, live_rows):
    """오늘 아침 상세 페이지에서 직접 확인한 레뷰 20건은 live 10건에 없는 것만 보존."""
    if not prev:
        return [], 0
    live_ids = {r['id'] for r in live_rows}
    keep = []
    for c in (prev.get('campaigns') or []):
        cid = str(c.get('id') or '')
        if not cid or cid in live_ids:
            continue
        if c.get('platform') not in (None, 'revu'):
            continue
        c = dict(c)
        c['platform'] = 'revu'
        c['platformName'] = '레뷰'
        c.setdefault('source', 'revu:manual-2026-11-20')
        c['retained'] = True
        keep.append(c)
    return keep, len(keep)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--no-detail', action='store_true')
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    only = [s for s in args.only.split(',') if s]

    started = datetime.now(KST)
    log('■ 체험단 스캔 시작 %s' % started.strftime('%Y-%m-%d %H:%M:%S KST'))

    all_rows, report = [], []

    def run(key, fn):
        if only and key not in only:
            return
        log('▶ %s' % key)
        try:
            rows, note = fn()
            for r in rows:
                r['platform'] = key
                r['platformName'] = dict(PLATFORMS)[key]
            all_rows.extend(rows)
            report.append({'key': key, 'name': dict(PLATFORMS)[key], 'status': 'ok',
                           'count': len(rows), 'note': note, 'reason': None})
            log('  ✓ %s %d건' % (key, len(rows)))
        except Exception as e:                       # noqa: BLE001
            report.append({'key': key, 'name': dict(PLATFORMS)[key], 'status': 'blocked',
                           'count': 0, 'note': '%s: %s' % (type(e).__name__, str(e)[:300]),
                           'reason': friendly_reason(e)})
            log('  ✗ %s 차단/실패 — %s' % (key, str(e)[:200]))

    run('revu', scan_revu)
    run('reviewnote', scan_reviewnote)
    run('dinnerqueen', lambda: scan_dinnerqueen(with_detail=not args.no_detail))
    run('mrblog', scan_mrblog)
    run('gangnam', scan_gangnam)
    run('popomon', scan_popomon)
    run('ohmyblog', scan_ohmyblog)
    run('themukja', scan_themukja)
    run('onepik', scan_onepik)
    run('reviewplace', scan_reviewplace)
    run('ringble', scan_ringble)

    # 레뷰 기존 실측분 보존
    prev = load_prev(args.out)
    prev_revu = [r for r in all_rows if r['platform'] == 'revu']
    kept, kept_n = merge_revu_prev(prev, prev_revu)
    if kept:
        all_rows.extend(kept)
        all_rows.sort(key=lambda r: (r['platform'], r.get('dday') if r.get('dday') is not None else 999))
        log('· 레뷰 기존 실측 %d건 보존' % kept_n)
        for rep in report:
            if rep['key'] == 'revu':
                rep['count'] = len(prev_revu) + kept_n
                rep['note'] += (' 오늘 아침 상세 페이지에서 직접 확인한 기존 실측 %d건을 합쳐 %d건으로 유지합니다.'
                                % (kept_n, rep['count']))

    today = datetime.now(KST).date()
    for r in all_rows:
        if not r.get('deadline') and r.get('dday'):
            pass
        r['ddayNum'] = dday_of(r.get('deadline'), today)
        if r.get('applicants') is not None and r.get('capacity'):
            r['rate'] = round(r['applicants'] / r['capacity'], 2)
        else:
            r['rate'] = None

    # 중복(플랫폼+id) 제거
    uniq, seen = [], set()
    for r in all_rows:
        k = '%s:%s' % (r['platform'], r['id'])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)

    # 유형 · 자부담 · 지역 정규화 — 한 곳(scripts/review_normalize.py)의 규칙을 그대로 적용
    normalize_rows(uniq)
    log('· 정규화 — 유형 %s' % ' / '.join('%s %d' % (t, sum(1 for r in uniq if r.get('type') == t))
                                        for t in ('배송형', '방문형', '페이백', '기자단', '미확인')))
    log('· 정규화 — 지역 %s' % ' / '.join(
        '%s %d' % (rg, sum(1 for r in uniq if r.get('region') == rg))
        for rg in ('서울', '경기', '인천', '강원', '충청', '전라', '경상', '제주', '전국·배송', '지역 미표기')))
    log('· 정규화 — 자부담 %d건' % sum(1 for r in uniq if (r.get('flags') or {}).get('extraCost') is True))

    blocked = [rep['name'] for rep in report if rep['status'] != 'ok']
    ok = [rep for rep in report if rep['status'] == 'ok']

    # 신규(NEW) 판별 — 플랫폼별 id 기준선 + 모집 시작일 근거, 플랫폼별 상한
    CUR_OUT[0] = args.out
    news = mark_new(uniq, prev, today)
    log('· NEW 뱃지 %d건 (등록 근거 %d건 중 플랫폼별 상위 %d건) — %s' % (
        news['shown'], news['raw'], NEW_CAP_PER_PLATFORM,
        ' / '.join('%s %d' % (k, v['shown']) for k, v in sorted(news['byPlatform'].items()))))

    notice_bits = []
    friendly = []
    for rep in report:
        if rep['status'] != 'ok':
            friendly.append({'name': rep['name'], 'key': rep['key'],
                             'reason': rep.get('reason') or '수집 실패'})
            notice_bits.append('%s은(는) 수집 실패 — %s' % (rep['name'], rep.get('reason') or '수집 실패'))
    notice_bits.append('레뷰는 공개 트렌딩 API 10건까지만 비로그인 조회가 가능하고 전체 목록 API는 인증이 필요합니다.')
    notice_bits.append('미블은 목록·상세가 로그인 필수여서 홈페이지 공개 섹션만 담았습니다. 마감일은 D-day 역산입니다.')
    notice_bits.append('포포몬은 홈 공개 API(플래티넘·신규·인기·오픈예정)만 수집합니다 — 전체 목록은 로그인 후에만 열립니다.')
    notice_bits.append('오마이블로그는 상세 페이지가 앱 전용이라 제목 검색 링크로 연결합니다.')

    out = {
        'meta': {
            'source': ' · '.join('%s %d건' % (rep['name'], rep['count']) for rep in report) or '수집 없음',
            'collectedAt': started.isoformat(timespec='seconds'),
            'count': len(uniq),
            'newCount': news['shown'],
            'newRawCount': news['raw'],
            'newCapPerPlatform': NEW_CAP_PER_PLATFORM,
            'newByPlatform': news['byPlatform'],
            'platformMaxId': news['maxIds'],
            'newRule': NEW_RULE,
            'normalizeRule': NORMALIZE_RULE,
            'platforms': report,
            'blocked': friendly,
            'notice': ' | '.join(notice_bits),
            'noticeShort': ('체험단 %d건 · %s 실측' % (
                len(uniq), '·'.join(rep['name'] for rep in ok))
                + (' · ' + ', '.join(blocked) + ' 차단' if blocked else '')),
            'blog': (prev or {}).get('meta', {}).get('blog') or {
                'name': 'Always smile', 'id': 'hwen21c',
                'url': 'https://blog.naver.com/hwen21c',
                'publicPostsRecent': None, 'lastPostDate': None,
                'lastPostNote': None,
            },
            'scanner': 'scripts/scan_review_campaigns.py',
        },
        'campaigns': uniq,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    tmp = args.out + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    os.replace(tmp, args.out)
    log('■ 완료 — %d건 → %s (%.1fs)' % (len(uniq), args.out,
                                      (datetime.now(KST) - started).total_seconds()))
    for rep in report:
        log('   %-12s %-6s %4d건  %s' % (rep['name'], rep['status'], rep['count'], rep['note'][:110]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
