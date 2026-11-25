#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""특가 레이더 자동 검증·갱신 (GitHub Actions · 하루 3회)

기존 피클 스케줄(`✈️ 특가 레이더 정기 자동 동기화`)이 하던 일을 그대로 옮긴 실행기.

  1) 등록 상품 전부를 카카오 예약하기 공개 API/상세 화면에서 다시 확인한다.
       · 숙소  : /api/product/public/accommodation/availableRooms (4인 → 2인 순)
       · 티켓  : /detail/ticketStore/{id} 의 __NEXT_DATA__ (매장 대표 최저가·판매상태)
  2) 판매 종료(ON_SALE 아님)·응답 없음 항목은 카드에서 뺀다.
  3) 가격이 바뀐 항목은 숫자 필드와 그 숫자를 담은 문장을 실측값으로 다시 쓴다.
     가격이 그대로면 사람이 쓴 소개 문장을 건드리지 않고 '재확인' 한 줄만 남긴다.
  4) 새 상품은 search_kw + 발굴 키워드로 검색해 할인율 높은 것만 추려 추가한다.
  5) auto_update_deals.py 로 deals.html 배열 교체·검증 → 커밋·푸시는 워크플로우가 한다.

원칙: 확인하지 못한 값은 만들지 않는다. 모르는 필드는 비우거나 None 으로 둔다.

사용법
  python3 scripts/automation/deals_refresh.py                # 전체 갱신
  python3 scripts/automation/deals_refresh.py --limit 6      # 앞 6건만(점검)
  python3 scripts/automation/deals_refresh.py --no-discover  # 신규 발굴 생략
  python3 scripts/automation/deals_refresh.py --dry-run      # 파일 쓰지 않음
"""
from __future__ import annotations

import argparse
import html as htmllib
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
REPO_ROOT = os.environ.get("SYNC_REPO_ROOT") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_PATH = os.path.join(REPO_ROOT, "data", "latest_scanned_deals.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")

SEARCH_API = ("https://booking.kakao.com/api/productSearch/public/v2/search"
              "?query={q}&alarmTalk=false")
ROOMS_API = ("https://booking.kakao.com/api/product/public/accommodation/availableRooms"
             "?accommodationId={pid}&numberOfAdults={adults}&numberOfChildren=0&includeSecret=false")
TICKET_PAGE = "https://booking.kakao.com/detail/ticketStore/{pid}"
DETAIL_LINK = {"accommodation": "https://booking.kakao.com/detail/accommodation/%s",
               "ticket": "https://booking.kakao.com/detail/ticketStore/%s"}

# 신규 발굴 키워드 — 회차마다 앞에서부터 돌아가며 쓴다(전체를 매번 긁지 않는다).
DISCOVERY = [
    "동탄 키즈카페", "수원 키즈카페", "용인 키즈카페", "화성 키즈카페", "오산 키즈카페",
    "동탄 실내놀이터", "수원 실내놀이터", "분당 실내놀이터", "광교 키즈", "평택 키즈",
    "동탄 박물관", "수원 박물관", "국립중앙박물관", "어린이 박물관", "실내 동물원",
    "에버랜드", "레고랜드", "서울랜드", "키자니아", "아쿠아리움 할인",
    "스키장 리조트", "리프트권 할인", "눈썰매", "실내 스키장", "겨울 온천",
    "가평 풀빌라", "가평 키즈풀빌라", "양평 키즈펜션", "태안 키즈", "춘천 풀빌라",
    "제주 호텔", "부산 호캉스", "경주 호캉스", "강릉 호캉스", "여수 호캉스",
    "12월 호텔 특가", "12월 리조트 특가", "크리스마스 호텔", "겨울방학 키즈", "연말 가족여행",
]

NEW_TRAVEL_CAP = 3          # 회차당 새 숙소 상품 상한
NEW_KIDS_CAP = 3            # 회차당 새 티켓 상품 상한
CANDIDATE_VERIFY_CAP = 24   # 신규 후보 상세 확인 상한(시간 보호)
DISCOVERY_KEYWORD_CAP = 26  # 회차당 검색 키워드 상한
MIN_NEW_RATE = 30           # 신규 상품 최소 할인율(%)
MAX_SCAN_NOTES = 8

ICON_OK, ICON_MID = "🟢", "🟡"


# ────────────────────────────────────────────────────────── 유틸
def log(msg):
    print(msg, flush=True)


def now_kst():
    return datetime.now(KST)


def stamp_short(dt):
    return dt.strftime("%Y-%m-%d %H:%M")


def money(v):
    if v in (None, "", 0):
        return "-"
    try:
        return "{:,}원".format(int(v))
    except (TypeError, ValueError):
        return "-"


def wan(v):
    """1만원 단위 축약(카드 지면 절약)."""
    try:
        n = int(v)
    except (TypeError, ValueError):
        return "-"
    if n >= 10000:
        return "{:,}만원".format(round(n / 10000)) if n % 10000 == 0 else "{:,}원".format(n)
    return "{:,}원".format(n)


def _get(url, timeout=25, tries=3, as_json=True, referer="https://booking.kakao.com/"):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/json, text/html;q=0.9,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
                "Referer": referer,
            })
            with urllib.request.urlopen(req, timeout=timeout) as res:
                body = res.read().decode("utf-8", "replace")
            return json.loads(body) if as_json else body
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.5 + attempt * 2)
    log("  ! 요청 실패 %s — %s" % (url[:110], type(last).__name__))
    return None


def parse_link(item):
    link = item.get("link") or ""
    m = re.search(r"/detail/accommodation/(\d+)", link)
    if m:
        return "accommodation", m.group(1)
    m = re.search(r"/detail/ticketStore/(\d+)", link)
    if m:
        return "ticket", m.group(1)
    return None, None


# ────────────────────────────────────────────────────────── 실측
def fetch_rooms(pid):
    """숙소 객실 목록 — 4인 기준으로 먼저, 판매 중인 객실이 없으면 2인 기준으로 다시."""
    items, adults = [], 4
    for adults in (4, 2):
        data = _get(ROOMS_API.format(pid=pid, adults=adults))
        items = []
        if isinstance(data, list):
            for r in data:
                occ = r.get("occupancy") or {}
                items.append({
                    "name": (r.get("name") or "").strip(),
                    "sale": r.get("salesPrice"),
                    "original": r.get("originalPrice"),
                    "rate": r.get("discountRate"),
                    "status": r.get("productSaleStatus"),
                    "std": occ.get("standard"),
                    "max": occ.get("maximum"),
                    "postfix": r.get("pricePostfix") or "",
                    "desc": r.get("description") or "",
                })
        if any(i["status"] == "ON_SALE" and i["sale"] for i in items):
            break
    return {"kind": "accommodation", "pid": pid, "adults": adults, "rooms": items}


def fetch_ticket(pid):
    """티켓 매장 대표 최저가 — 상세 페이지 __NEXT_DATA__ 의 매장 노드."""
    body = _get(TICKET_PAGE.format(pid=pid), as_json=False)
    if not body:
        return {"kind": "ticket", "pid": pid, "store": None, "rooms": []}
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', body, re.S)
    store = None
    if m:
        try:
            node = json.loads(m.group(1))
            for q in (((node.get("props") or {}).get("pageProps") or {})
                      .get("dehydratedState") or {}).get("queries") or []:
                data = ((q.get("state") or {}).get("data") or {})
                if isinstance(data, dict) and "salesPrice" in data:
                    store = data
                    break
        except Exception:  # noqa: BLE001
            store = None
    return {"kind": "ticket", "pid": pid, "store": store, "rooms": []}


def four_total(room):
    """4인 가족이 묵을 때의 총액(객실가 + 기준인원 초과 요금). 계산 근거가 없으면 None."""
    sale, std, fee = room.get("sale"), room.get("std"), room.get("extra")
    if not sale:
        return None
    if std and std >= 4:
        return sale
    if std and fee:
        return sale + (4 - std) * fee
    return None


def keep_prev_price_room(on, prev_price):
    """이전 카드와 같은 가격의 객실이 아직 판매 중이면 그 객실을 유지한다.
    (가격이 그대로인데 더 싼/비싼 다른 객실로 갈아타 카드가 흔들리는 것을 막는다.)"""
    want = (prev_price or "").strip()
    if not want:
        return None
    for r in on:
        if money(r.get("sale")) == want:
            return r
    return None


def pick_best(on):
    """4인 가족 기준 최저가 객실 — 4인을 받을 수 있는 객실 중 4인 총액이 가장 싼 것."""
    fits = [r for r in on if (r.get("max") or 0) >= 4] or on
    def key(r):
        t = four_total(r)
        return (t if t is not None else r["sale"]) + (0 if (r.get("max") or 0) >= 4 else 100000000)
    return sorted(fits, key=key)[0]


def extra_person_fee(desc):
    """객실 설명에서 '기준 인원 초과 1인 추가요금'을 읽는다(없으면 None)."""
    text = desc or ""
    for pat in (r"인원추가\s*요금[^0-9]{0,20}성인\s*([\d,]{3,})",
                r"기준\s*인원\s*외\s*추가\s*비용[^0-9]{0,20}([\d,]{3,})",
                r"1인\s*(?:1박당|추가)[^0-9]{0,10}([\d,]{3,})"):
        m = re.search(pat, text)
        if m:
            try:
                return int(m.group(1).replace(",", ""))
            except ValueError:
                continue
    return None


def measure(item):
    """등록 상품 1건 실측."""
    kind, pid = parse_link(item)
    if kind == "accommodation":
        m = fetch_rooms(pid)
        for r in m["rooms"]:
            r["extra"] = extra_person_fee(r.get("desc"))
        on = [r for r in m["rooms"] if r["status"] == "ON_SALE" and r["sale"]]
        if on:
            best = (keep_prev_price_room(on, item.get("deal_price")) or pick_best(on))
            m.update({"ok": True, "best": best, "on_count": len(on),
                      "total_rooms": len(m["rooms"]),
                      "extra": best.get("extra")})
        else:
            m.update({"ok": False, "best": None, "on_count": 0, "total_rooms": len(m["rooms"])})
        return m
    if kind == "ticket":
        m = fetch_ticket(pid)
        st = m["store"] or {}
        ok = bool(st.get("salesPrice")) and st.get("productSaleStatus") == "ON_SALE"
        m.update({"ok": ok, "best": {
            "name": st.get("name"), "sale": st.get("salesPrice"),
            "original": st.get("originalPrice"), "rate": st.get("discountRate"),
            "status": st.get("productSaleStatus")}} if ok else {"ok": False, "best": None})
        if not ok:
            m["ok"] = False
            m["best"] = None
        return m
    return {"kind": None, "ok": None, "best": None, "rooms": []}


# ────────────────────────────────────────────────────────── 문장 조립
def travel_fields_from(meas, prev, stamp):
    """숙소 상품 — 실측값으로 숫자 필드와 그 숫자를 담은 문장을 다시 쓴다."""
    best = meas["best"]
    sale, orig, rate = best["sale"], best["original"], best["rate"] or 0
    std, mx = best.get("std"), best.get("max")
    name = (best.get("name") or "").strip()
    extra = meas.get("extra")
    basis = "{}인 기준{}".format(std, "·최대 %s인" % mx if mx else "") if std else ""

    # 4인 가족 환산
    four = None
    if std is not None:
        if std >= 4:
            four = sale
        elif extra and std < 4:
            four = sale + (4 - std) * extra

    if four is not None:
        four_text = ("4인이면 %s" % money(four)) if four != sale else "4인 기준 인원추가 없음"
    else:
        four_text = "4인 추가요금은 예약화면 확인"

    out = {}
    out["normal_price"] = money(orig) if orig else ""
    out["deal_price"] = money(sale)
    out["discount"] = ("-%d%% (정상가 %s)" % (rate, money(orig))) if orig and rate else "카톡 최저가"
    out["family_saved"] = ("정상가 %s → %s (1박 · %s%s, %s)"
                           % (money(orig) if orig else "-", money(sale),
                              (name[:26] + " · ") if name else "", basis,
                              four_text))
    out["price_level_text"] = ("%d%% 할인 · %s인 기준 %s (%s) %s"
                               % (rate, std or 1, money(sale),
                                  "4인 환산 %s" % money(four) if four and four != sale else four_text,
                                  ICON_OK if rate >= 30 else ICON_MID))
    pills = []
    short_name = (name.split("(")[0].strip() or name)[:26]
    if name:
        pills.append("%s %s~%s" % (short_name, money(sale), (" (%s)" % basis) if basis else ""))
    if four is not None and four != sale:
        pills.append("4인 가족 %s%s" % (money(four), " (1인 %s 추가)" % money(extra) if extra else ""))
    elif four is not None:
        pills.append("4인 기준 인원추가 없음")
    if rate:
        pills.append("%d%% 할인%s" % (rate, " · 정상가 %s" % money(orig) if orig else ""))
    out["benefit_pills"] = pills[:3]
    out["season_reason"] = (
        "%s 상세 API 실측: %s(%s)이 %s~/1박(정상가 %s%s)으로 판매 중입니다. "
        "이 숙소는 판매 중인 객실 %d개 중 이 객실이 최저가입니다.%s"
        % (stamp, name or "객실", basis or "객실 기준", money(sale),
           money(orig) if orig else "-", " · %d%% 할인" % rate if rate else "",
           meas.get("on_count") or 0,
           (" 4인 가족이면 %s입니다." % money(four)) if four else " 4인 추가요금은 예약 화면에서 확인해야 합니다."))
    notes = ["%s %s~ / 1박 (정상가 %s · %s) — %s"
             % (name[:30] or "객실", money(sale), money(orig) if orig else "-",
                "%d%%" % rate if rate else "-", stamp)]
    if four is not None and four != sale:
        notes.append("4인 투숙 시 %s (기준 %s인 초과 1인 %s)" % (money(four), std, money(extra)))
    notes.append("판매 중인 객실 %d개 / 조회 %d개 · 판매상태 ON_SALE"
                 % (meas.get("on_count") or 0, meas.get("total_rooms") or 0))
    out["scan_notes"] = notes
    out["pax_included"] = std if std else prev.get("pax_included")
    out["room_basis"] = True
    return out


def patch_title_rate(title, rate):
    """제목 끝 '(… N% 할인)' 의 할인율만 실측값으로 바꾼다(문구는 그대로)."""
    if not title or not rate:
        return title
    if re.search(r"\d+% 할인", title):
        return re.sub(r"\d+% 할인", "%d%% 할인" % rate, title)
    return title


def travel_fields_from_ticket(meas, prev, stamp):
    """여행 목록에 들어 있는 티켓 상품(리프트권·입장권 등) — 매장 대표 최저가 기준."""
    st = meas["store"] or {}
    unit, normal, rate = st.get("salesPrice"), st.get("originalPrice"), st.get("discountRate") or 0
    name = (st.get("name") or "").strip()
    out = {
        "normal_price": money(normal) if normal else "",
        "deal_price": money(unit),
        "discount": ("-%d%% (정상가 %s)" % (rate, money(normal))) if (normal and rate) else "카톡 최저가",
        "family_saved": ("정상가 %s → %s (1인)" % (money(normal), money(unit))) if normal
        else ("1인 %s (실측 판매가)" % money(unit)),
        "price_level_text": ("%d%% 할인 · 1인 %s %s" % (rate, money(unit), ICON_OK if rate >= 30 else ICON_MID))
        if rate else ("1인 %s" % money(unit)),
        "benefit_pills": [p for p in [
            "%s 1인 %s~" % (name[:24], money(unit)) if name else "",
            "정상가 %s (%d%% 할인)" % (money(normal), rate) if normal and rate else "",
        ] if p][:3],
        "season_reason": ("%s 상세 화면 실측: %s이 1인 %s~%s으로 판매 중입니다."
                          % (stamp, name or "상품", money(unit),
                             "(정상가 %s · %d%% 할인)" % (money(normal), rate) if normal and rate else "")),
        "scan_notes": ["%s 1인 %s~%s — %s 확인"
                       % (name[:30] or "상품", money(unit),
                          " (정상가 %s · %d%%)" % (money(normal), rate) if normal and rate else "", stamp)],
        "pax_included": 1,
        "room_basis": False,
    }
    return out


def kids_fields_from(meas, prev, stamp):
    st = meas["store"] or {}
    unit, normal, rate = st.get("salesPrice"), st.get("originalPrice"), st.get("discountRate") or 0
    four_n = (normal * 4) if normal else None
    four_u = (unit * 4) if unit else None
    if normal and rate:
        price_info = "1인 정상 %s → 카톡 특가 %s~ (%d%% 할인)" % (money(normal), money(unit), rate)
        benefit_tag = "%d%% 할인 · %s" % (rate, (st.get("name") or "")[:20])
    else:
        price_info = "카톡 특가 1인 %s~" % money(unit)
        benefit_tag = "카톡 예약가 · %s" % (st.get("name") or "")[:20]
    out = {
        "unit_price": unit,
        "normal_unit_price": normal,
        "price_info": price_info,
        "benefit_tag": benefit_tag.strip(" ·"),
        "family_saved": ("4인 %s → %s (%s 절약)"
                         % (money(four_n) if four_n else "-", money(four_u) if four_u else "-",
                            money((normal - unit) * 4) if (normal and unit) else "-")),
        "price_level_text": ("1인 %s~%s" % (money(unit), (" · %d%% 할인" % rate) if rate else "")),
        "scan_notes": ["%s %s~ / 1인%s — %s 확인"
                       % ((st.get("name") or "티켓")[:30], money(unit),
                          (" (정상가 %s · %d%%)" % (money(normal), rate)) if (normal and rate) else "",
                          stamp)],
        "tips": ("%s 실측: %s이 1인 %s~(정상가 %s · %d%% 할인)으로 판매 중입니다. "
                 "가격 뒤 '~'는 권종·시간대에 따라 달라질 수 있다는 표시입니다."
                 % (stamp, (st.get("name") or "상품"), money(unit),
                    money(normal) if normal else "-", rate)),
    }
    return out


def refresh_item(item, meas, stamp, list_kind="travel"):
    """등록 상품 갱신 — 가격이 그대로면 소개 문장은 그대로 두고 재확인 한 줄만 남긴다."""
    kind = meas["kind"]
    if list_kind == "kids":
        new = kids_fields_from(meas, item, stamp)
    elif kind == "accommodation":
        new = travel_fields_from(meas, item, stamp)
    else:
        new = travel_fields_from_ticket(meas, item, stamp)

    if list_kind == "travel":
        prev_price, new_price = item.get("deal_price"), new.get("deal_price")
        changed = (prev_price or "") != (new_price or "")
    else:
        prev_price, new_price = item.get("unit_price"), new.get("unit_price")
        pn, nn = item.get("normal_unit_price") or 0, new.get("normal_unit_price") or 0
        changed = bool(prev_price) != bool(new_price) or (prev_price or 0) != (new_price or 0) or pn != nn
        prev_price = ("%s원" % prev_price) if prev_price else item.get("price_info")
        new_price = ("%s원" % new_price) if new_price else new.get("price_info")

    out = dict(item)
    if not changed:
        # 숫자가 그대로면 사람이 쓴 카드 문구를 그대로 둔다 — 새 값은 숫자 필드와 재확인 한 줄만.
        for k in ("unit_price", "normal_unit_price", "deal_price", "normal_price",
                  "pax_included", "room_basis"):
            if new.get(k) not in (None, ""):
                out[k] = new[k]
        out["scan_notes"] = (["%s 재확인: 판매중(ON_SALE) · 카드 가격 그대로" % stamp]
                             + [n for n in (item.get("scan_notes") or [])])[:MAX_SCAN_NOTES]
        out["_changed"] = False
        return out
    out.update(new)
    if new.get("discount"):
        mm = re.search(r"-(\d+)%", new["discount"])
        if mm:
            out["title"] = patch_title_rate(item.get("title"), int(mm.group(1)))
    elif item.get("unit_price") and new.get("unit_price"):
        pass
    out["scan_notes"] = (["%s 가격 변동: %s → %s" % (stamp, prev_price or "-", new_price or "-")]
                         + (item.get("scan_notes") or []))[:MAX_SCAN_NOTES]
    out["_changed"] = changed
    return out


# ────────────────────────────────────────────────────────── 신규 발굴
CAT_MAP = {
    "KIDS_CAFE": ("kids_cafe", "🧸 키즈카페"),
    "THEME_PARK": ("themepark", "🎡 테마파크"),
    "AMUSEMENT_PARK": ("themepark", "🎡 테마파크"),
    "AQUARIUM": ("themepark", "🐠 아쿠아리움"),
    "MUSEUM": ("museum", "🏛️ 박물관·전시"),
    "EXHIBITION": ("museum", "🏛️ 박물관·전시"),
    "ZOO": ("themepark", "🦁 동물원"),
    "SPA": ("themepark", "♨️ 스파·온천"),
}


def search(q):
    data = _get(SEARCH_API.format(q=urllib.parse.quote(q)))
    rows = []
    if isinstance(data, list):
        for section in data:
            for p in (section.get("products") or []):
                rows.append(p)
    return rows


def product_link(p):
    st = (p.get("storeType") or "").upper()
    if st == "ACCOMMODATION":
        return DETAIL_LINK["accommodation"] % p.get("id"), "accommodation"
    if st == "TICKET_STORE":
        return DETAIL_LINK["ticket"] % p.get("id"), "ticket"
    return None, None


def cat_of(p):
    for c in (p.get("secondCategories") or []):
        code = (c.get("code") or "").upper()
        if code in CAT_MAP:
            return CAT_MAP[code]
    for c in (p.get("firstCategories") or []):
        code = (c.get("code") or "").upper()
        if code in CAT_MAP:
            return CAT_MAP[code]
    return None


def theme_of(name):
    n = name or ""
    if "풀빌라" in n or "키즈" in n:
        return "family", "🎡 키즈풀빌라"
    if "리조트" in n or "온천" in n or "스파" in n:
        return "resort", "🌴 온천·힐링"
    if "스키" in n or "눈썰매" in n:
        return "snow", "❄️ 눈꽃·스키"
    return "family", "🏨 패밀리 숙소"


def new_travel_item(p, meas, kw, stamp):
    best = meas["best"]
    theme, theme_label = theme_of(p.get("name"))
    region = " · ".join([x for x in [p.get("region"), p.get("city")] if x])
    item = {
        "id": "tr_kakao_%s" % p.get("id"),
        "type": "domestic",
        "theme": theme,
        "theme_label": theme_label,
        "source": "💬 카카오톡 예약하기",
        "source_badge": "💬 카톡 예약하기 숙소",
        "source_color": "#fee500",
        "title": "🇰🇷 %s %s (%d%% 할인)" % ((p.get("name") or "")[:40],
                                          (best.get("name") or "1박")[:14], best.get("rate") or 0),
        "region": ("국내 · " + region) if region else "국내",
        "flight_type": "자차 이동",
        "peak_price": "",
        "rating": "",
        "review_count": "",
        "link": DETAIL_LINK["accommodation"] % p.get("id"),
        "link_label": "💬 카톡 예약하기 [%s] 바로가기" % (p.get("name") or "")[:20],
        "search_kw": kw,
        "family_fit": ("%s · %s" % (p.get("shortIntroduce") or "", p.get("displayRegionD3") or "")).strip(" ·"),
        "tips": None,
    }
    item.update(travel_fields_from(meas, item, stamp))
    return item


def new_kids_item(p, meas, kw, stamp):
    st = meas["store"] or {}
    cat, cat_label = cat_of(p) or ("themepark", "🎡 테마파크")
    op = p.get("operationTime") or {}
    hours = ""
    if op.get("start") and op.get("end"):
        hours = "%s~%s" % (op["start"], op["end"])
    item = {
        "id": "kd_kakao_%s" % p.get("id"),
        "category": cat,
        "cat_label": cat_label,
        "source": "💬 카카오톡 예약하기",
        "source_badge": "💬 카톡 예약하기 %s" % cat_label.split(" ", 1)[-1],
        "source_color": "#fee500",
        "title": "%s %s (1인 %s~)" % (cat_label.split(" ", 1)[-1], (p.get("name") or "")[:34],
                                      money(st.get("salesPrice"))),
        "location": p.get("displayRegionD3") or p.get("displayRegion") or "",
        "target_age": "전 연령",
        "rating": "",
        "review_count": "",
        "child_only": False,
        "highlights": " · ".join([x for x in [p.get("shortIntroduce") or "",
                                              ("운영 %s" % hours) if hours else ""] if x]),
        "link": DETAIL_LINK["ticket"] % p.get("id"),
        "link_label": "💬 카톡 예약하기 [%s] 바로가기" % (p.get("name") or "")[:20],
        "search_kw": kw,
        "season_reason": None,
    }
    item.update(kids_fields_from(meas, item, stamp))
    return item


def discover(data, stamp, known, limit_verify=CANDIDATE_VERIFY_CAP, round_no=0):
    """search_kw + 발굴 키워드로 새 상품 후보를 찾아 실측 후 추가."""
    kws = []
    for it in data["travelDeals"] + data["kidsDeals"]:
        k = (it.get("search_kw") or "").strip()
        if k and k not in kws:
            kws.append(k)
    start = (round_no * DISCOVERY_KEYWORD_CAP) % max(1, len(DISCOVERY))
    rot = DISCOVERY[start:] + DISCOVERY[:start]
    for k in rot:
        if len(kws) >= DISCOVERY_KEYWORD_CAP + 8:
            break
        if k not in kws:
            kws.append(k)

    found, seen = [], set()
    for kw in kws:
        rows = search(kw)
        time.sleep(0.2)
        for p in rows:
            link, kind = product_link(p)
            if not link or kind is None:
                continue
            key = "%s:%s" % (kind, p.get("id"))
            if key in known or key in seen:
                continue
            if (p.get("productSaleStatus") or "") != "ON_SALE":
                continue
            if kind == "ticket" and not cat_of(p):
                continue
            seen.add(key)
            found.append((kw, kind, p, link))
        if len(found) >= limit_verify:
            break

    log("· 신규 후보 %d건 (미등록·판매중) — 상세 확인 시작" % len(found))
    travels, kids = [], []
    for kw, kind, p, link in found[:limit_verify]:
        m = measure({"link": link})
        if not m.get("ok") or not m["best"]:
            continue
        rate = m["best"].get("rate") or 0
        if rate < MIN_NEW_RATE:
            continue
        if kind == "accommodation":
            travels.append((rate, new_travel_item(p, m, kw, stamp)))
        else:
            kids.append((rate, new_kids_item(p, m, kw, stamp)))
        time.sleep(0.2)

    travels.sort(key=lambda x: -x[0])
    kids.sort(key=lambda x: -x[0])
    added_t = [it for _, it in travels[:NEW_TRAVEL_CAP]]
    added_k = [it for _, it in kids[:NEW_KIDS_CAP]]
    for it in added_t + added_k:
        log("  + 신규 %s (%s)" % (it["title"][:56], it["deal_price"] if "deal_price" in it else it.get("price_info")))
    return added_t, added_k


# ────────────────────────────────────────────────────────── 본체
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="앞 N건만 확인(점검용)")
    ap.add_argument("--no-discover", action="store_true", help="신규 발굴 생략")
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않음")
    ap.add_argument("--no-apply", action="store_true", help="deals.html 반영 생략")
    args = ap.parse_args()

    started = now_kst()
    stamp = stamp_short(started)
    if not os.path.exists(DATA_PATH):
        log("[FAIL] 스캔 기준 파일이 없습니다: %s" % DATA_PATH)
        return 1
    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)

    travel, kids = data.get("travelDeals") or [], data.get("kidsDeals") or []
    log("■ 특가 검증 시작 %s — 등록 여행 %d · 키즈 %d" % (stamp, len(travel), len(kids)))

    work = [(kind, it) for kind, lst in (("travel", travel), ("kids", kids)) for it in lst]
    if args.limit:
        work = work[: args.limit]

    results = {}

    def run(pair):
        kind, it = pair
        k, pid = parse_link(it)
        if not k:
            return kind, it, {"kind": None, "ok": None, "best": None, "rooms": []}
        return kind, it, measure(it)

    with ThreadPoolExecutor(max_workers=4) as ex:
        for kind, it, m in ex.map(run, work):
            results[it["id"]] = (kind, it, m)

    failed = sum(1 for v in results.values() if v[2].get("ok") is None or
                 (v[2].get("ok") is False and v[2].get("kind") in ("accommodation", "ticket")))
    log("· 실측 완료 — 판매중 %d / 판매종료·실패 %d" %
        (sum(1 for v in results.values() if v[2].get("ok")), failed))
    if results and failed >= max(5, len(results) // 2):
        log("[FAIL] 절반 이상이 실측 실패 — 사이트 구조 변경/차단 가능성이 있어 갱신을 중단합니다")
        return 2

    def rebuild(lst, list_kind):
        out, dropped = [], []
        for it in lst:
            if it["id"] not in results:
                out.append(it)
                continue
            _, _, m = results[it["id"]]
            if m.get("kind") is None:
                out.append(it)          # 해외 등 자동 실측 대상 아님 → 그대로 둔다
                continue
            if not m.get("ok"):
                dropped.append(it)
                continue
            out.append(refresh_item(it, m, stamp, list_kind))
        return out, dropped

    new_travel, drop_t = rebuild(travel, "travel")
    new_kids, drop_k = rebuild(kids, "kids")
    for it in drop_t + drop_k:
        log("  - 판매 종료/응답없음 제외: %s" % (it.get("title") or it.get("id"))[:60])

    known = {"%s:%s" % (parse_link(it)[0] or "", parse_link(it)[1] or "") for it in travel + kids}
    added_t, added_k = ([], [])
    if not args.no_discover and not args.limit:
        round_no = (started.hour + started.day) % len(DISCOVERY)
        added_t, added_k = discover(data, stamp, known, round_no=round_no)
        new_travel = added_t + new_travel
        new_kids = added_k + new_kids

    prev_map = {it["id"]: it for it in travel + kids}
    def _num(it):
        return it.get("deal_price") or it.get("unit_price")
    changed = sum(1 for it in new_travel + new_kids
                  if it["id"] in prev_map and _num(prev_map[it["id"]]) != _num(it))

    for it in new_travel + new_kids:
        it.pop("_changed", None)
    data["travelDeals"] = new_travel
    data["kidsDeals"] = new_kids
    data["scanned_at"] = stamp
    data["source"] = ("카카오톡 예약하기(booking.kakao.com) 공개 API 실측 — 등록 상품 %d건 재확인"
                      % len(results))
    data["counts"] = {"travel": len(new_travel), "kids": len(new_kids)}
    data["note"] = ("%s 회차 자동 검증: 판매 종료 %d건 제외 · 가격 변동 %d건 · 신규 반영 %d건. "
                    "확인하지 못한 값은 비워 두었습니다."
                    % (stamp, len(drop_t) + len(drop_k), changed, len(added_t) + len(added_k)))
    log("· 여행 %d건 · 키즈 %d건 (제외 %d · 가격변동 %d · 신규 %d)"
        % (len(new_travel), len(new_kids), len(drop_t) + len(drop_k), changed,
           len(added_t) + len(added_k)))

    if args.dry_run:
        log("[dry-run] 파일을 쓰지 않습니다")
        return 0

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    log("· 저장 %s" % DATA_PATH)

    if args.no_apply:
        return 0

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "auto_update_deals.py")
    env = dict(os.environ, SYNC_REPO_ROOT=REPO_ROOT)
    res = subprocess.run([sys.executable, script, "--check-links"], env=env)
    if res.returncode != 0:
        log("[FAIL] deals.html 반영 실패 — 검증 로그를 확인하세요")
        return res.returncode
    log("[ok] deals.html 반영 완료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
