#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""체험단 데이터 정규화 — 유형(type) · 자부담(extraCost) · 지역(region).

이 파일이 유일한 기준이다. 06:50 수집기(scripts/scan_review_campaigns.py)가 수집 직후
normalize_rows() 를 돌리고, scripts/normalize_revu_campaigns.py 는 이미 쌓인
deploy_repo/data/revu-campaigns.json 에 같은 규칙을 다시 적용한다.
revu-studio.html · review-zip.html 의 앱 보정 로직도 아래 규칙을 그대로 옮겨 쓴다.

규칙은 '플랫폼이 공개한 원문'만 근거로 삼는다(추정으로 값을 만들어 내지 않는다).
  · 유형      원본 type → categoryRaw 키워드 → flags.visitRequired → 지역명 → 미확인
  · 자부담    제공내역·제목·미션·주의 문구에 배송비/초과/자부담/본인부담/페이백 이 있으면 True
  · 지역      categoryRaw 의 지역 표기(미블) 우선, 방문형이면 제목의 지역 표기 → 권역 묶음
  · 얼굴노출  제목·제공내역·미션·주의 문구에 '얼굴 노출·공개·정면·사진', 셀카, 인물 촬영, 본인 출연,
              착용샷 같은 요건 문구가 있을 때만 → flags.faceRequired
              (플랫폼 초상권 동의 isPortraitRights 같은 기본 약관은 flags.portraitConsent 로만 남긴다.
               '얼굴 노출 선택'·'얼굴 모자이크'·'셀카봉'·'얼굴이 나온 이미지 활용' 같은 부정·선택 표현은 요건이 아니다)

[11/20] 권역을 8개(서울·경기·인천·강원·충청·전라·경상·제주)로 나눴다 — '경기도만', '강원도만'
처럼 광역 단위로 고를 수 있게. 예전 표기('경기·인천'·'영남'·'호남')는 다시 계산하면 각각
경기/인천 · 경상 · 전라가 된다.
"""

import re

REGION_ALL = '전국·배송'
REGION_UNKNOWN = '지역 미표기'

# meta.normalizeRule 로 데이터에 남기는 설명 (수집기·후처리가 같은 문구를 쓴다)
NORMALIZE_RULE = ('type = 원본 type → categoryRaw(기자단·원고료/페이백·구매평/배송) → 지역명 → 미확인, '
                  'flags.extraCost = 제공내역·제목·미션·주의 문구의 배송비·초과·자부담·본인부담·페이백 자동 감지, '
                  'flags.faceRequired = 문장 단위로 얼굴 노출·공개·정면/셀카/인물 촬영/본인 출연/착용샷 요건이 '
                  '있는 경우만(부정·선택 표현과 플랫폼 초상권 동의만 있는 경우는 제외, 동의는 flags.portraitConsent), '
                  'region = 플랫폼 지역(city) → categoryRaw 지역 표기 → 제목 지역 표기(방문형) → 전국·배송/지역 미표기')

# 노출 순서 — 권역 → 배송 → 미표기
REGION_ORDER = ['서울', '경기', '인천', '강원', '충청', '전라', '경상', '제주',
                REGION_ALL, REGION_UNKNOWN]

REGION_LABEL = {
    '서울': '📍 서울',
    '경기': '📍 경기',
    '인천': '📍 인천',
    '강원': '📍 강원',
    '충청': '📍 충청',
    '전라': '📍 전라',
    '경상': '📍 경상',
    '제주': '📍 제주',
    REGION_ALL: '📦 전국·배송',
    REGION_UNKNOWN: '❓ 지역 미표기',
}

# tier 1: 광역 단위·권역 이름 — 제목에 브랜드성 지명이 섞여도 이걸 먼저 믿는다
_T1 = {
    '서울': ['서울'],
    '경기': ['경기'],
    '인천': ['인천'],
    '충청': ['충청', '충북', '충남'],
    '강원': ['강원'],
    '경상': ['경상', '경남', '경북', '부산', '대구', '울산', '영남'],
    '전라': ['전라', '전남', '전북', '광주', '호남'],
    '제주': ['제주'],
}
# tier 2: 시 단위 + 제목에 자주 나오는 대표 상권
_T2 = {
    '서울': ['강남', '잠실', '종로', '홍대', '합정', '여의도', '성수', '건대', '노원',
             '마포', '용산', '서초', '송파', '강서', '관악', '신촌', '이태원', '압구정',
             '청담', '삼성동', '대치', '역삼', '선릉', '가로수길', '익선', '성신여대',
             '왕십리', '건국대', '건대입구', '상암', '목동', '사당', '신사', '논현', '한남'],
    '경기': ['수원', '성남', '분당', '판교', '용인', '화성', '동탄', '오산', '평택',
             '안양', '군포', '안산', '시흥', '광명', '부천', '김포', '파주', '고양',
             '일산', '남양주', '구리', '하남', '미사', '의정부', '이천', '여주',
             '과천', '의왕', '양주', '포천', '안성'],
    '인천': ['송도', '부평', '검단', '강화', '영종', '계양', '미추홀'],
    '충청': ['대전', '세종', '청주', '천안', '아산', '공주', '충주', '제천', '보령', '서산',
             '당진', '논산', '계룡'],
    '강원': ['춘천', '원주', '강릉', '속초', '동해', '태백', '삼척', '평창', '정선', '양양',
             '홍천', '횡성', '영월', '인제', '철원'],
    '경상': ['창원', '김해', '양산', '진주', '포항', '경주', '구미', '김천', '안동', '거제',
             '통영', '밀양', '사천', '영주', '영천', '상주', '문경', '경산', '마산', '진해',
             '울주', '거창', '함안', '남해', '하동', '의성', '봉화', '울진'],
    '전라': ['전주', '익산', '군산', '목포', '여수', '순천', '나주', '광양', '정읍', '남원',
             '김제', '완주', '진안', '무주', '장수', '임실', '순창', '고창', '부안', '담양',
             '곡성', '구례', '고흥', '보성', '화순', '장흥', '강진', '해남', '영암', '무안',
             '함평', '영광', '장성', '완도', '진도', '신안'],
    '제주': ['서귀포', '추자도', '애월', '중문', '협재', '성산', '표선', '조천', '구좌',
             '김녕', '함덕', '사계', '우도'],
}
# tier 3: 구·동 단위 (서울 구 이름 등)
_T3 = {
    '서울': ['성동', '광진', '동대문', '중랑', '성북', '강북', '도봉', '은평', '서대문',
             '양천', '구로', '금천', '영등포', '동작', '중구', '회기', '청량리', '신당',
             '명동', '공덕', '문래', '대림', '신도림', '화곡', '발산', '마곡', '고덕',
             '천호', '길동', '반포', '방배', '흑석', '노량진', '개포', '논현동', '도산',
             '안암', '한티', '상봉', '돈암', '미아', '수유', '창동', '방이', '문정', '가락',
             '둔촌', '신천', '잠원', '약수', '금호', '옥수', '뚝섬', '중곡', '군자', '장한평',
             '용답', '장안', '답십리', '면목', '중화', '월계', '공릉', '하계', '태릉',
             '연신내', '불광', '홍제', '무악', '충정로', '서소문', '충무로', '을지로',
             '양재', '가산', '당산', '디지털단지', '여의', '영등포구'],
    '경기': ['기흥', '수지', '죽전', '동백', '산본', '광교', '위례', '별내', '탄현',
             '중동', '상동', '동탄2', '병점', '향남', '봉담'],
    '인천': ['논현동', '구월', '만수', '부개', '작전'],
    '경상': ['해운대', '광안', '서면', '수영', '사상', '금정', '달서', '수성', '북구',
             '동래', '연제', '부산진', '영도', '기장'],
    '전라': ['상무', '첨단', '수완', '둔산', '유성'],
}

REGION_TOKENS = []          # (token, region, tier)
for _tier, _table in ((1, _T1), (2, _T2), (3, _T3)):
    for _region, _tokens in _table.items():
        for _tok in _tokens:
            REGION_TOKENS.append((_tok, _region, _tier))
# 같은 글자에서 더 긴 토큰이 이기도록 정렬(뒤에서 다시 정렬해도 되지만 조회 안정성)
REGION_TOKENS.sort(key=lambda x: (-len(x[0]), x[0]))

TYPE_ORDER = ['배송형', '방문형', '페이백', '기자단', '미확인']
TYPE_LABEL = {
    '배송형': '📦 배송형',
    '방문형': '🚗 방문형',
    '페이백': '💰 페이백',
    '기자단': '📰 기자단',
    '미확인': '❓ 미확인',
}
KNOWN_TYPES = ('배송형', '방문형', '페이백', '기자단')

COST_KEYWORDS = ('배송비', '초과', '자부담', '본인부담', '페이백', '추가비용')

# 플랫폼이 '지역' 필드로 주는 값 — 재택은 방문 없이 집으로 오는 배송 캠페인
CITY_ALL = ('재택', '전국', '전국배송', '전국 배송', '온라인')
# '배송비 포함'·'무료배송' 처럼 자부담이 없다고 밝힌 문구는 예외
COST_NEGATIONS = ('배송비 포함', '배송비포함', '배송비 무료', '무료배송', '배송비 없음',
                  '자부담 없음', '본인부담 없음', '추가금액 발생없음', '추가금 발생없음',
                  '추가비용 없음', '추가비용없음', '추가비용 발생없음')

# 얼굴 노출 "요건" — '얼굴' 한 글자만 보면 '얼굴or바디 케어' 같은 시술 문구까지 걸리므로
# 노출·공개·촬영을 뜻하는 결합어와 셀카·착용샷만 본다.
#  · '초상권'은 뺐다(11/28) — 대부분 캠페인의 기본 동의 약관 문구라 요건이 아니다.
#  · 플랫폼 필드(isPortraitRights 등)도 요건이 아니라 동의 여부이므로 faceRequired 로 쓰지 않는다
#    (flags.portraitConsent 에만 남긴다).
FACE_KEYWORDS = ('얼굴노출', '얼굴 노출', '얼굴공개', '얼굴 공개', '얼굴정면', '얼굴 정면',
                 '얼굴나오', '얼굴 나오', '얼굴이 나', '얼굴사진', '얼굴 사진', '얼굴포함', '얼굴 포함',
                 '얼굴출연', '얼굴 출연', '셀카', '셀피', 'selfie', '인물촬영', '인물 촬영',
                 '인물사진', '인물 사진', '본인출연', '본인 출연', '착용샷', '착용 컷', '착용컷',
                 '정면사진', '정면 사진', '프로필사진', '프로필 사진')
# 부정·선택·동의 표현 — 문장에서 이 표현을 먼저 지운 뒤에도 키워드가 남아야 요건으로 본다.
# (예: '얼굴 정면은 모자이크', '얼굴 노출 선택', '셀카봉', '얼굴이 나온 이미지는 홍보에 활용')
FACE_NEGATIONS = ('얼굴노출 없', '얼굴 노출 없', '얼굴공개 없', '얼굴 공개 없',
                  '얼굴없이', '얼굴 없이', '얼굴 필요없', '얼굴 필요 없', '얼굴 필요하지 않',
                  '얼굴미노출', '얼굴 미노출', '얼굴 제외', '얼굴제외', '얼굴가리', '얼굴 가리',
                  '얼굴안나', '얼굴 안 나', '얼굴 안나', '얼굴 비공개', '얼굴비공개',
                  '얼굴 미포함', '얼굴미포함', '얼굴 모자이크', '얼굴모자이크',
                  '얼굴 노출 불가', '얼굴노출 불가', '얼굴 공개 불가', '얼굴공개 불가',
                  '얼굴 노출 금지', '얼굴노출 금지', '얼굴 비노출', '얼굴비노출',
                  '얼굴 노출 선택', '얼굴노출 선택', '얼굴 공개 선택', '얼굴공개 선택',
                  '얼굴 노출 필수 아님', '얼굴 공개 필수 아님',
                  '모자이크 가능', '모자이크 진행', '모자이크 처리', '모자이크',
                  '셀카봉', '셀피봉',
                  '얼굴이 나온 이미지', '얼굴이 나온 사진', '얼굴 나온 이미지', '얼굴 나온 사진',
                  '얼굴이 포함된 이미지', '얼굴이 포함된 사진')
# 같은 문장(구)에 이 표현이 있으면 '선택 사항'으로 본다.
FACE_OPTIONAL = ('선택', '옵션', '희망', '필요시', '필요 시', '가능하면', '경우에 따라', 'optional',
                 '모자이크', '가림 처리')
FACE_SENT_SPLIT = re.compile(r'[.。!?·/|,;\n()\[\]{}★※•→]')


def find_region(text):
    """텍스트에서 권역을 찾는다. 광역(tier1) → 시(tier2) → 구·동(tier3) 순.
    같은 tier 안에서는 가장 앞에 나온 표기를 쓴다(예: '[ 경기 화성 ]' → 경기)."""
    s = str(text or '')
    if not s.strip():
        return None
    for tier in (1, 2, 3):
        best = None
        for tok, region, t in REGION_TOKENS:
            if t != tier:
                continue
            pos = s.find(tok)
            if pos < 0:
                continue
            key = (pos, -len(tok))
            if best is None or key < best[0]:
                best = (key, region)
        if best:
            return best[1]
    return None


def city_region(city):
    """플랫폼 지역 필드(예: 리뷰노트 city '경기')를 권역으로."""
    c = str(city or '').strip()
    if not c:
        return None
    if c in CITY_ALL:
        return REGION_ALL
    return find_region(c)


def _flags(row):
    f = row.get('flags')
    return f if isinstance(f, dict) else {}


def looks_local(text):
    """categoryRaw 가 지역 표기인지 — 미블은 '배송' 아니면 '성남 판교' 같은 지역명이다."""
    return find_region(text) is not None


def type_of(row):
    """플랫폼 공개 원문 기준 유형 판별 (앱의 typeOf() 와 같은 규칙)."""
    t = row.get('type')
    if t in KNOWN_TYPES:
        return t
    raw = str(row.get('categoryRaw') or '')
    if '기자단' in raw or '원고료' in raw:
        return '기자단'
    if '페이백' in raw or '구매평' in raw:
        return '페이백'
    if '배송' in raw:
        return '배송형'
    city = str(row.get('city') or '').strip()
    if city in CITY_ALL:
        return '배송형'
    f = _flags(row).get('visitRequired')
    if f is True:
        return '방문형'
    if f is False:
        return '배송형'
    if looks_local(raw):
        return '방문형'
    if raw.strip():
        return '방문형'
    return '미확인'


def _cost_text(row):
    bits = []
    for k in ('title', 'offer', 'missionSummary', 'caution'):
        v = row.get(k)
        if v:
            bits.append(str(v))
    m = row.get('missions')
    if isinstance(m, dict):
        bits.append(str(m.get('summary') or ''))
    return ' '.join(bits)


def _face_text(row):
    bits = []
    for k in ('title', 'offer', 'missionSummary', 'caution', 'note'):
        v = row.get(k)
        if v:
            bits.append(str(v))
    m = row.get('missions')
    if isinstance(m, dict):
        bits.append(str(m.get('summary') or ''))
    elif isinstance(m, list):
        bits.extend(str(x) for x in m if x)
    return ' '.join(bits)


def detect_face(row):
    """얼굴이 사진·영상에 나와야 하는 요건이면 True, 아니면 None(모른다 — 지어내지 않는다).

    문장(구) 단위로 본다: 그 구에 얼굴 키워드가 있고, 같은 구에 선택·부정 표현이 없을 때만 요건.
    """
    txt = _face_text(row)
    if not txt:
        return None
    probe = re.sub(r'\s+', ' ', str(txt))
    for raw in FACE_SENT_SPLIT.split(probe):
        clause = raw
        for neg in FACE_NEGATIONS:
            clause = clause.replace(neg, ' ')
        if not any(kw in clause for kw in FACE_KEYWORDS):
            continue
        if any(soft in raw for soft in FACE_OPTIONAL):
            continue
        return True
    return None


# ---------------------------------------------------------------- 상세 미션 문구 파싱
# 플랫폼 상세 페이지의 '리뷰어 미션'·'이용 안내' 문구에서 글자수·사진 장수·동영상·지도·
# 예약 안내를 뽑는다. 문구에 없는 값은 None 으로 둔다(지어내지 않는다).
_M_CHARS = (re.compile(r'([\d,]{2,6})\s*자\s*(?:이상|이상은|이상으로)'),
            re.compile(r'글자\s*수\s*(?:는|가)?\s*([\d,]{2,6})\s*자'),
            re.compile(r'([\d,]{2,6})\s*자\s*이상의\s*본문'))
_M_PHOTOS = (re.compile(r'사진\s*(?:은|이|를|:)?\s*([\d,]{1,3})\s*(?:장|개|컷)\s*(?:이상|이상의|이상,)'),
             re.compile(r'([\d,]{1,3})\s*(?:장|개|컷)\s*이상\s*(?:의\s*)?사진'),
             re.compile(r'최소\s*([\d,]{1,3})\s*(?:장|개|컷)'),
             re.compile(r'사진\s*([\d,]{1,3})\s*(?:장|개|컷)'),
             # '고화질 이미지 15장 이상' 처럼 사진이라는 단어 없이 장수만 적는 경우
             re.compile(r'([\d,]{1,3})\s*장\s*이상'))
_M_VIDEO = re.compile(r'동영상|영상\s*(?:첨부|삽입|촬영)|릴스|숏폼|유튜브')
_M_POSTS = re.compile(r'포스팅\s*([\d,]{1,2})\s*(?:건|개|회)|필수\s*포스팅\s*([\d,]{1,2})')
_M_MAPLINK = re.compile(r'지도\s*(?:삽입|첨부|적용)|네이버\s*지도')
_M_RESERVE = re.compile(r'예약|방문\s*최소|노쇼|방문\s*전|당일\s*취소|방문\s*인원|대리\s*체험\s*불가')
_M_AI = re.compile(r'생성형\s*AI|인공지능|AI\s*작성|AI\s*사용|ChatGPT|챗GPT')


def _first_int(patterns, text):
    for pat in patterns:
        m = pat.search(text)
        if m:
            for g in m.groups():
                if g:
                    try:
                        return int(str(g).replace(',', ''))
                    except ValueError:
                        continue
    return None


def parse_mission_text(text):
    """미션 문구 → {'chars','photos','video','posts','map','reserve'} (확인된 값만)."""
    t = str(text or '')
    if not t.strip():
        return None
    # 상세 페이지에 남은 주석 흔적 '1,100자 이상 --> 1,000자 이상' → 수정된 뒤 값만 남긴다
    t = re.sub(r'[\d,]+\s*(?:자|장|개|컷)\s*이상\s*-->\s*', ' ', t)
    out = {'chars': _first_int(_M_CHARS, t), 'photos': _first_int(_M_PHOTOS, t)}
    out['video'] = True if _M_VIDEO.search(t) else None
    out['posts'] = _first_int((_M_POSTS,), t)
    out['map'] = True if _M_MAPLINK.search(t) else None
    out['reserve'] = True if _M_RESERVE.search(t) else None
    return out if any(v for v in out.values()) else None


def mission_summary(missions, extra=None):
    """미션 dict → 카드·상세에 쓰는 한 줄 요약."""
    if not missions:
        return None
    bits = []
    if missions.get('posts'):
        bits.append('포스팅 %d건' % missions['posts'])
    if missions.get('chars'):
        bits.append('본문 %s자 이상' % format(missions['chars'], ','))
    if missions.get('photos'):
        bits.append('사진 %d장 이상' % missions['photos'])
    if missions.get('video'):
        bits.append('동영상 첨부')
    if missions.get('map'):
        bits.append('지도 삽입')
    if missions.get('reserve'):
        bits.append('방문 예약 필요')
    kws = missions.get('keywords') or []
    if kws:
        bits.append('필수 키워드 %d개' % len(kws))
    if extra:
        bits.append(str(extra))
    return ' · '.join(bits) if bits else None


def section_text(text, starts, ends, limit=700):
    """본문(text-of 로 편 텍스트)에서 시작 표지와 끝 표지 사이 문구를 잘라 낸다.

    starts/ends 는 표지 문자열 튜플. 시작 표지가 없으면 빈 문자열(지어내지 않는다).
    """
    x = str(text or '')
    i = -1
    for m in starts:
        p = x.find(m)
        if p >= 0 and (i < 0 or p < i):
            i = p
    if i < 0:
        return ''
    j = len(x)
    for m in ends:
        p = x.find(m, i + 1)
        if p > i and p < j:
            j = p
    return x[i:min(j, i + limit)].strip()


def build_missions(text, keywords=None, extra_bits=None):
    """미션 문구 하나로 missions dict + missionSummary 를 만든다(없으면 (None, None))."""
    m = parse_mission_text(text)
    kws = [str(k).strip() for k in (keywords or []) if str(k).strip()]
    if not m and not kws:
        return None, None
    out = dict(m or {})
    if kws:
        out['keywords'] = kws
    summ = mission_summary(out)
    if summ and extra_bits:
        summ = ' · '.join([summ] + [str(b) for b in extra_bits if b])
    return out, summ


def detect_extra_cost(row):
    """자부담 신호가 있으면 True, 없으면 None(모른다 — 지어내지 않는다)."""
    txt = _cost_text(row)
    if not txt:
        return None
    probe = txt
    for neg in COST_NEGATIONS:
        probe = probe.replace(neg, ' ')
    for kw in COST_KEYWORDS:
        if kw in probe:
            return True
    return None


def region_of(row, row_type=None):
    """권역 묶음 — 플랫폼 지역 필드(city) → categoryRaw 지역 표기 → (방문형이면) 제목."""
    t = row_type or type_of(row)
    reg = city_region(row.get('city'))
    if reg:
        return reg
    cat = str(row.get('categoryRaw') or '')
    reg = find_region(cat)
    if reg:
        return reg
    if t == '방문형':
        reg = find_region(str(row.get('title') or ''))
        if reg:
            return reg
        return REGION_UNKNOWN
    return REGION_ALL


def region_detail(row):
    """표기 원문(예: '화성 동탄', '경기 화성') — 검색·표시용."""
    cat = str(row.get('categoryRaw') or '').strip()
    if cat and find_region(cat) and '배송' not in cat:
        return cat
    title = str(row.get('title') or '')
    m = None
    for open_c, close_c in (('[', ']'), ('(', ')'), ('【', '】')):
        i = title.find(open_c)
        if i >= 0:
            j = title.find(close_c, i + 1)
            if j > i:
                m = title[i + 1:j].strip()
                break
    if m and find_region(m):
        return m
    city = str(row.get('city') or '').strip()
    if city and city not in CITY_ALL:
        return city
    return None


def normalize_row(row):
    """행 하나를 제자리에서 보정한다. 원본 type 이 이미 있으면 건드리지 않는다."""
    t = type_of(row)
    if row.get('type') not in KNOWN_TYPES:
        row['type'] = t
    flags = row.get('flags')
    if not isinstance(flags, dict):
        flags = {'aiBanned': None, 'extraCost': None, 'visitRequired': None, 'faceRequired': None}
        row['flags'] = flags
    if flags.get('visitRequired') is None:
        flags['visitRequired'] = (t == '방문형')
    if flags.get('extraCost') is not True:
        hit = detect_extra_cost(row)
        if hit:
            flags['extraCost'] = True
        elif flags.get('extraCost') is None:
            flags['extraCost'] = False if _cost_text(row) else None
    hit = detect_face(row)
    if hit:
        flags['faceRequired'] = True
    else:
        flags['faceRequired'] = False if _face_text(row) else None
    row['region'] = region_of(row, t)
    row['regionDetail'] = region_detail(row)
    return row


def normalize_rows(rows):
    for r in rows:
        normalize_row(r)
    return rows


def summarize(rows):
    import collections
    return {
        'type': collections.Counter(r.get('type') for r in rows),
        'region': collections.Counter(r.get('region') for r in rows),
        'extraCost': collections.Counter(str((r.get('flags') or {}).get('extraCost')) for r in rows),
        'faceRequired': collections.Counter(str((r.get('flags') or {}).get('faceRequired')) for r in rows),
    }


if __name__ == '__main__':
    import json
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else 'deploy_repo/data/revu-campaigns.json'
    data = json.load(open(path, encoding='utf-8'))
    s = summarize(data['campaigns'])
    for k, v in s.items():
        print(k, dict(v))
