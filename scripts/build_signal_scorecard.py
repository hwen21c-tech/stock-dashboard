#!/usr/bin/env python3
"""
🎯 어제 시그널 성적표 — 자동 복기 데이터 생성기

브리핑(briefings/*.md)과 피클 초안(data/content_auto_latest.json)에서
"우리가 짚은 종목(대금 300억↑)·지수 기준선(지지/저항)"만 뽑아,
그 시그널이 향한 거래일의 실제 시세(네이버 일봉 OHLC)와 비교해 기록한다.

원칙
- 브리핑·초안에 적힌 것만 채점한다. 없는 종목·기준선을 만들지 않는다.
- 시세는 네이버 일봉(siseJson) 실측만 쓴다. 받지 못한 값은 null + reason.
- 판정은 기계적 규칙이다(사람의 해석을 넣지 않는다).
    · 종목: 시그널 다음 거래일 종가가 전일 종가보다 높으면 '상승', 낮으면 '하락'.
             브리핑에 적힌 가격이 있으면 그 가격 위 종가 유지 여부를 '지지'로 함께 적는다.
    · 지수 지지선: 대상 거래일 종가 ≥ 지지선 → '유지', 아니면 '이탈'.
    · 지수 저항선: 대상 거래일 고가 ≥ 저항선 → '돌파', 아니면 '미달'.
- 대상 거래일이 아직 오지 않았으면(장전 전·휴장) verdict = '검증 대기'.
- 여러 번 돌려도 같은 결과가 나오도록 정렬 기준을 고정한다(멱등).

사용
    python3 scripts/build_signal_scorecard.py                    # 3일치 브리핑 + 최신 초안, 양쪽 저장소
    python3 scripts/build_signal_scorecard.py --days 5
    python3 scripts/build_signal_scorecard.py --dry-run
    python3 scripts/build_signal_scorecard.py --offline          # 네트워크 없이(기존 시세 캐시만)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KST = dt.timezone(dt.timedelta(hours=9))
BRIEF_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\.md$")
OUT_DIRS = [
    os.path.join(ROOT, "deploy_repo", "data"),
    os.path.join(ROOT, "sd_live", "public", "data"),
]
UA = "Mozilla/5.0 (Linux; Android 14) fox-signal-scorecard/1.0"

# 종목명이 아닌 말(대금 기사에 자주 섞이는 단어) — 후보에서 제외한다
NOT_STOCK = {
    "매출", "시총", "조달", "공모", "계약", "수주", "순매수", "순매도", "거래대금", "대금",
    "외국인", "기관", "개인", "자사주", "유상증자", "전환사채", "회사", "그룹", "지수",
    "코스피", "코스닥", "야간선물", "선물", "환율", "비중", "현금", "노출", "후보", "기준",
}
_INDEX_CACHE: dict[str, list[dict]] = {}
_CODE_CACHE: dict[str, str | None] = {}


# ---------------------------------------------------------------------------
# 네트워크(네이버) — 실패하면 조용히 None 을 돌려주고, 값을 만들지 않는다
# ---------------------------------------------------------------------------
def http_get(url: str, timeout: int = 15) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] GET 실패 {url[:90]} — {e}", file=sys.stderr)
        return None


def naver_daily(symbol: str, start: str, end: str) -> list[dict]:
    """네이버 일봉 OHLCV. start/end: YYYYMMDD. 실패 시 빈 배열."""
    key = f"{symbol}:{start}:{end}"
    if key in _INDEX_CACHE:
        return _INDEX_CACHE[key]
    url = (
        "https://api.finance.naver.com/siseJson.naver?symbol=" + urllib.parse.quote(symbol)
        + f"&requestType=1&startTime={start}&endTime={end}&timeframe=day"
    )
    txt = http_get(url)
    rows: list[dict] = []
    if txt:
        for m in re.finditer(
            r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)', txt
        ):
            d, o, h, l, c, v = m.groups()
            rows.append({
                "date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
                "open": float(o), "high": float(h), "low": float(l), "close": float(c),
                "volume": int(v),
            })
    _INDEX_CACHE[key] = rows
    return rows


def resolve_code(name: str) -> str | None:
    """종목명 → 종목코드 (네이버 자동완성). 실패하면 None."""
    name = name.strip()
    if not name:
        return None
    if name in _CODE_CACHE:
        return _CODE_CACHE[name]
    if re.fullmatch(r"\d{6}", name):
        _CODE_CACHE[name] = name
        return name
    url = (
        "https://m.stock.naver.com/front-api/search/autoComplete?query="
        + urllib.parse.quote(name) + "&target=stock"
    )
    txt = http_get(url, timeout=12)
    code = None
    if txt:
        try:
            j = json.loads(txt)
            items = (j.get("result") or {}).get("items") or []
            for it in items:
                if it.get("category") != "stock":
                    continue
                if str(it.get("name") or "").strip() != name:
                    continue
                c = str(it.get("code") or "")
                if re.fullmatch(r"\d{6}", c):
                    code = c
                    break
        except Exception:  # noqa: BLE001
            code = None
    _CODE_CACHE[name] = code
    return code


# ---------------------------------------------------------------------------
# 브리핑·초안 → 시그널 추출
# ---------------------------------------------------------------------------
STOCK_EOK_RE = re.compile(
    r"([가-힣A-Za-z0-9&.\-]{2,12})\s*(?:총\s*)?(?:대금|거래대금)?\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*억"
)
# '안랩 116,800원(+11.45%, 대금 1,035억)' 처럼 종목명이 금액보다 앞에 떨어진 표기
STOCK_PRICE_EOK_RE = re.compile(
    r"([가-힣A-Za-z0-9&.\-]{2,12})\s*[\d,]+\s*원\s*\([^)]{0,60}?대금\s*([\d,]+(?:\.\d+)?)\s*억"
)
# 금액이 재료(매출·계약·조달)를 가리키는 표기 — 거래대금이 아니므로 후보에서 뺀다
MATERIAL_AFTER_RE = re.compile(r"^\s*(?:\(|\[)?\s*(?:매출|수주|계약|조달|공모|시총|자사주|유상증자)")


def norm_num(s: str) -> float | None:
    try:
        return float(str(s).replace(",", ""))
    except ValueError:
        return None


def find_stock_eok(text: str) -> list[tuple[str, float]]:
    """'한미약품 948억' 형태에서 (종목명, 대금억) 후보만 뽑는다. 대금 300억↑만."""
    out: list[tuple[str, float]] = []
    seen: set[str] = set()
    for m in list(STOCK_PRICE_EOK_RE.finditer(text)) + list(STOCK_EOK_RE.finditer(text)):
        name = m.group(1).strip(" ·-|*〉>")
        eok = norm_num(m.group(2))
        if not name or eok is None or eok < 300:
            continue
        if name in NOT_STOCK or name in seen:
            continue
        # 한 글자·숫자로 시작하는 조각, 금액 단위가 섞인 조각은 종목이 아니다
        if len(name) < 2 or name.isdigit() or not re.search(r"[가-힣A-Za-z]", name):
            continue
        if any(u in name for u in ("조", "만", "억", "원", "천")):
            continue
        # 금액 뒤에 붙은 조각(예: '13조4,170억' → '4,170')을 종목명으로 읽지 않는다
        before = text[max(0, m.start() - 1):m.start()]
        if before and (before.isdigit() or before in "조만천,."):
            continue
        # 금액 뒤에 매출·계약 같은 설명이 붙으면 거래대금이 아니다
        after = text[m.end(0):m.end(0) + 14] if m.re is STOCK_EOK_RE else ""
        if after and MATERIAL_AFTER_RE.match(after):
            continue
        # 뒤에 '원'이 붙은 금액(예: '2,300억 원')은 대금일 수도, 재료 금액일 수도 있다.
        # 종목명이 실제 종목으로 확인되는 것만 남기므로 여기서는 후보만 유지한다.
        seen.add(name)
        out.append((name, eok))
    return out


def sig_day_and_target(brief_date: str, hh: int) -> tuple[str, str]:
    """(시그널 날짜, 채점 대상 거래일). 장전(~08:59)은 당일, 그 뒤는 다음 거래일 후보."""
    return brief_date, brief_date if hh < 9 else "NEXT"


def next_trading_day(rows: list[dict], after: str) -> str | None:
    for r in rows:
        if r["date"] > after:
            return r["date"]
    return None


LEVEL_AFTER_RE = re.compile(
    r"(지지|저항)(?:선)?[^0-9\n]{0,14}?([\d]{1,2},[\d]{3}(?:\.\d+)?|[\d]{4,7}(?:\.\d+)?)"
)
LEVEL_BEFORE_RE = re.compile(
    r"([\d]{1,2},[\d]{3}(?:\.\d+)?|[\d]{4,7}(?:\.\d+)?)\s*(?:\([^)]*\))?\s*(?:이|은|는|가|을|를)?\s*(?:다음|1차|2차|3차|주요)?\s*(지지|저항)"
)


def find_levels(text: str) -> list[tuple[float, str]]:
    """지지·저항 기준선 — '지지 4,943' / '4,800이 다음 지지' 두 표기를 모두 읽는다."""
    out: list[tuple[float, str]] = []
    seen: set[tuple[float, str]] = set()
    for ln in text.splitlines():
        cands: list[tuple[int, float, str]] = []
        for m in LEVEL_AFTER_RE.finditer(ln):
            v = norm_num(m.group(2))
            if v is not None and v >= 1000:
                cands.append((m.start(), v, "지지" if m.group(1).startswith("지지") else "저항"))
        for m in LEVEL_BEFORE_RE.finditer(ln):
            v = norm_num(m.group(1))
            if v is not None and v >= 1000:
                cands.append((m.start(), v, "지지" if m.group(2).startswith("지지") else "저항"))
        for _, v, kind in sorted(cands):
            k = (v, kind)
            if k in seen:
                continue
            seen.add(k)
            out.append(k)
    return out[:4]


def line_of(text: str, needle: str, width: int = 0) -> str:
    i = text.find(needle)
    if i < 0:
        return ""
    return text[i:i + width] if width else text[i:]


# ---------------------------------------------------------------------------
# 채점
# ---------------------------------------------------------------------------
def pct_change(prev_close: float | None, close: float | None) -> float | None:
    if not prev_close or close is None:
        return None
    return round((close - prev_close) / prev_close * 100, 2)


def evaluate_stock(name: str, code: str, target: str, signal_price: float | None,
                   all_rows: list[dict]) -> dict:
    rows = [r for r in all_rows if r["date"] <= target]
    if len(rows) < 2:
        return {"verdict": "검증 대기", "reason": "시세를 받지 못했습니다(네이버 일봉)" if not rows else "전일 종가 없음"}
    today, prev = rows[-1], rows[-2]
    chg = pct_change(prev["close"], today["close"])
    res: dict[str, Any] = {
        "tradeDate": today["date"],
        "prevClose": prev["close"],
        "open": today["open"], "high": today["high"], "low": today["low"], "close": today["close"],
        "changePct": chg,
    }
    if signal_price:
        res["signalPrice"] = signal_price
        res["heldPrice"] = bool(today["close"] >= signal_price)
    if chg is None:
        res["verdict"] = "검증 대기"
    elif chg > 0:
        res["verdict"] = "상승"
    elif chg < 0:
        res["verdict"] = "하락"
    else:
        res["verdict"] = "보합"
    return res


def evaluate_level(level: float, kind: str, target: str, all_rows: list[dict]) -> dict:
    rows = [r for r in all_rows if r["date"] <= target]
    if not rows:
        return {"verdict": "검증 대기", "reason": "지수 시세를 받지 못했습니다"}
    t = rows[-1]
    if kind == "지지":
        held = t["close"] >= level
        return {
            "tradeDate": t["date"], "close": t["close"], "low": t["low"], "high": t["high"],
            "held": held, "verdict": "유지" if held else "이탈",
            "gapPct": round((t["close"] - level) / level * 100, 2),
        }
    broke = t["high"] >= level
    return {
        "tradeDate": t["date"], "close": t["close"], "high": t["high"], "low": t["low"],
        "broke": broke, "verdict": "돌파" if broke else "미달",
        "gapPct": round((t["high"] - level) / level * 100, 2),
    }


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------
def load_supply() -> dict | None:
    """수급 상위(거래소 확정) — 증거 카드·스튜디오가 함께 쓰는 축약본."""
    for p in (os.path.join(ROOT, "sd_live", "public", "data", "supply-latest.json"),
              os.path.join(ROOT, "deploy_repo", "data", "supply-latest.json")):
        if not os.path.exists(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                j = json.load(f)
        except Exception:  # noqa: BLE001
            continue
        g = j.get("groups") or {}

        def rows(key: str, n: int = 3) -> list[dict]:
            out = []
            for r in (g.get(key) or [])[:n]:
                out.append({
                    "code": r.get("code"), "name": r.get("name"), "market": r.get("market"),
                    "pct": r.get("pct"), "foreignEok": r.get("foreignEok"),
                    "organEok": r.get("organEok"), "valueText": r.get("valueText"),
                })
            return out

        return {
            "basisLabel": j.get("basisLabel") or "",
            "basisDate": str(j.get("basisDate") or ""),
            "source": j.get("source") or "",
            "confirmed": bool(j.get("confirmed")),
            "foreignBuy": rows("foreignBuy"),
            "organBuy": rows("organBuy"),
            "foreignSell": rows("foreignSell"),
        }
    return None


def load_latest_draft() -> dict | None:
    for p in (os.path.join(ROOT, "sd_live", "public", "data", "content_auto_latest.json"),
              os.path.join(ROOT, "deploy_repo", "data", "content_auto_latest.json")):
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:  # noqa: BLE001
                continue
    return None


def draft_signals(j: dict) -> tuple[str, str, str, list[tuple[str, float]]]:
    """최신 슬롯 초안에서 (date, 슬롯키, 원문, 300억↑ 종목후보)를 뽑는다."""
    slot = j.get("latestSlot") or ""
    node = (j.get("slots") or {}).get(slot) or {}
    date = str(node.get("date") or j.get("date") or "")
    parts = []
    blog = node.get("blog") or {}
    shorts = node.get("shorts") or {}
    if blog.get("markdown"):
        parts.append(str(blog["markdown"]))
    if shorts.get("script"):
        parts.append(str(shorts["script"]))
    text = "\n".join(parts)
    return date, slot, text, find_stock_eok(text)


def main() -> int:
    ap = argparse.ArgumentParser(description="🎯 어제 시그널 성적표 생성")
    ap.add_argument("--briefings-dir", default=os.path.join(ROOT, "briefings"))
    ap.add_argument("--days", type=int, default=3, help="최근 며칠치 브리핑을 채점할지")
    ap.add_argument("--max-briefings", type=int, default=4)
    ap.add_argument("--out-dirs", nargs="*", default=OUT_DIRS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--offline", action="store_true", help="네트워크 없이(캐시만) — 시세를 못 받으면 검증 대기")
    args = ap.parse_args()

    if args.offline:
        global http_get
        http_get = lambda *a, **k: None  # noqa: E731

    # ① 브리핑 파일 목록(최신순)
    files: list[tuple[str, str, int, str]] = []
    if os.path.isdir(args.briefings_dir):
        for fn in os.listdir(args.briefings_dir):
            m = BRIEF_RE.match(fn)
            if not m:
                continue
            files.append((m.group(1), m.group(2) + m.group(3), int(m.group(2)), os.path.join(args.briefings_dir, fn)))
    files.sort(key=lambda x: (x[0], x[1]), reverse=True)
    cutoff = (dt.datetime.now(KST) - dt.timedelta(days=args.days)).date().isoformat()
    recent = [f for f in files if f[0] >= cutoff] or files[:2]
    # 날짜마다 '장전(첫 브리핑)'과 '마감(마지막 브리핑)'을 한 건씩 — 시간대가 겹치지 않게 골고루 채점한다
    by_date: dict[str, list[tuple[str, str, int, str]]] = {}
    for f in recent:
        by_date.setdefault(f[0], []).append(f)
    picked: list[tuple[str, str, int, str]] = []
    for d in sorted(by_date, reverse=True):
        day = sorted(by_date[d], key=lambda x: x[1])
        picked.append(day[0])
        if len(day) > 1 and len(picked) < args.max_briefings:
            picked.append(day[-1])
        if len(picked) >= args.max_briefings:
            break
    if not picked:
        picked = files[:2]

    # ② 지수 일봉 — 채점 대상일 계산용(최근 40일)
    today_kst = dt.datetime.now(KST).date()
    start = (today_kst - dt.timedelta(days=40)).strftime("%Y%m%d")
    end = today_kst.strftime("%Y%m%d")
    kospi = naver_daily("KOSPI", start, end)
    kosdaq = naver_daily("KOSDAQ", start, end)
    as_of = max([r["date"] for r in kospi] or [""])

    items: list[dict] = []
    pending_rows: list[dict] = []
    seen_keys: set[str] = set()

    def add_stock_item(src_label: str, src_path: str, sig_at: str, target: str,
                       name: str, eok: float | None, price: float | None = None) -> None:
        code = resolve_code(name)
        if not code:
            return
        rows = naver_daily(code, start, end)
        if not rows:
            return
        # 대상 거래일이 오늘/미래면 검증 대기
        target_day = target
        if target == "NEXT":
            target_day = next_trading_day(rows, sig_at[:10]) or "NEXT"
        key = f"stock:{code}:{sig_at[:10]}:{src_label}"
        if key in seen_keys:
            return
        seen_keys.add(key)
        ev = evaluate_stock(name, code, target_day, price, rows) if target_day != "NEXT" else \
            {"verdict": "검증 대기", "reason": "다음 거래일이 아직 오지 않았습니다"}
        item = {
            "id": key,
            "kind": "stock",
            "name": name,
            "code": code,
            "source": src_path,
            "sourceLabel": src_label,
            "signalAt": sig_at,
            "targetTradeDate": target_day if target_day != "NEXT" else None,
            "valueEok": eok,
            "verdict": ev.get("verdict"),
            "result": ev,
        }
        (items if ev.get("verdict") != "검증 대기" else pending_rows).append(item)

    def add_level_item(src_label: str, src_path: str, sig_at: str, target: str,
                       market: str, rows: list[dict], level: float, kind: str) -> None:
        target_day = target
        if target == "NEXT":
            target_day = next_trading_day(rows, sig_at[:10]) or "NEXT"
        key = f"level:{market}:{level}:{kind}:{sig_at[:10]}"
        if key in seen_keys:
            return
        seen_keys.add(key)
        ev = evaluate_level(level, kind, target_day, rows) if target_day != "NEXT" else \
            {"verdict": "검증 대기", "reason": "다음 거래일이 아직 오지 않았습니다"}
        item = {
            "id": key, "kind": "index", "market": market, "name": market,
            "source": src_path, "sourceLabel": src_label, "signalAt": sig_at,
            "targetTradeDate": target_day if target_day != "NEXT" else None,
            "level": level, "levelKind": kind,
            "verdict": ev.get("verdict"), "result": ev,
        }
        (items if ev.get("verdict") != "검증 대기" else pending_rows).append(item)

    # ③ 브리핑 채점
    for (d, hhmm, hh, path) in picked:
        try:
            text = open(path, encoding="utf-8").read()
        except Exception:  # noqa: BLE001
            continue
        rel = "briefings/" + os.path.basename(path)
        slot_label = ""
        m = re.match(r"^.*?\[(.+?)\]", text.splitlines()[0] if text else "")
        if m:
            slot_label = re.sub(r"\*+", "", m.group(1)).strip()
        sig_at = f"{d}T{hhmm[:2]}:{hhmm[2:]}:00+09:00"
        target = d if hh < 9 else "NEXT"

        # 지수 기준선 — '지지/저항' 문장에서만, 코스피 문맥 우선
        idx_text = "\n".join(ln for ln in text.splitlines() if "지지" in ln or "저항" in ln)
        for level, kind in [x for x in find_levels(idx_text) if x[1] == "지지"][:3]:
            rows = kospi if level >= 2000 else kosdaq
            add_level_item(slot_label or "브리핑", rel, sig_at, target, "코스피" if level >= 2000 else "코스닥", rows, level, kind)

        # 300억↑ 종목 — 대금 문맥이 있는 줄에서만
        for ln in text.splitlines():
            if not ("300억" in ln or "대금" in ln or "거래대금" in ln):
                continue
            for name, eok in find_stock_eok(ln):
                add_stock_item(slot_label or "브리핑", rel, sig_at, target, name, eok)

    # ④ 최신 초안 채점(초안 날짜 = 그날 실측)
    draft = load_latest_draft()
    if draft:
        date, slot, text, cands = draft_signals(draft)
        if date:
            # 초안은 '결산' 문서라, 채점일은 그 초안이 다룬 마지막 거래일이다(휴장일 초안이면 직전 거래일)
            review_day = max([r["date"] for r in kospi if r["date"] <= date], default=date)
            date = review_day
            sig_at = f"{date}T20:10:00+09:00"
            for name, eok in cands[:6]:
                add_stock_item("피클 초안(" + slot + ")", "data/content_auto_latest.json", sig_at, date, name, eok)
            # 초안의 지수 기준선은 '다음 거래일 대응선'이라 그날 시세로 채점하지 않는다(오해 방지).
            # 지수 채점은 브리핑이 건 기준선만 대상으로 한다.

    # ④-2 소스별 과다 추출 정리 — 종목은 대금 큰 순 5개, 기준선은 최대 3개만 남긴다
    def trim(rows: list[dict], per_src_stock: int, per_src_level: int) -> list[dict]:
        out: list[dict] = []
        bucket: dict[str, list[dict]] = {}
        for r in rows:
            bucket.setdefault(str(r.get("signalAt")), []).append(r)
        for key in sorted(bucket):
            grp = bucket[key]
            stocks = [r for r in grp if r["kind"] == "stock"]
            levels = [r for r in grp if r["kind"] == "index"]
            stocks.sort(key=lambda r: -(r.get("valueEok") or 0))
            out.extend(stocks[:per_src_stock])
            out.extend(levels[:per_src_level])
        return out

    items = trim(items, 5, 3)
    pending_rows = trim(pending_rows, 4, 2)

    # ⑤ 요약
    def tally(rows: list[dict]) -> dict:
        out = {"measured": 0, "up": 0, "down": 0, "held": 0, "broken": 0}
        for r in rows:
            v = r.get("verdict")
            out["measured"] += 1
            if v == "상승":
                out["up"] += 1
            elif v == "하락":
                out["down"] += 1
            elif v == "유지":
                out["held"] += 1
            elif v == "이탈":
                out["broken"] += 1
        return out

    t = tally(items)
    items.sort(key=lambda r: (str(r.get("signalAt")), r["kind"], r.get("name") or ""), reverse=True)
    pending_rows.sort(key=lambda r: (str(r.get("signalAt")), r.get("name") or ""), reverse=True)

    # 당일 대금 300억↑ 대장주(체커·증거카드용) — 측정된 종목 중 대금 있는 것
    leaders = [r for r in items if r["kind"] == "stock" and (r.get("valueEok") or 0) >= 300
               and r["result"].get("changePct") is not None and r["result"].get("tradeDate") == as_of]
    leaders.sort(key=lambda r: -(r.get("valueEok") or 0))

    headline_bits = []
    for r in leaders[:3]:
        headline_bits.append(f"{r['name']} {r['valueEok']:.0f}억 {r['result']['changePct']:+.2f}%")
    headline = (" · ".join(headline_bits)) if headline_bits else "채점할 300억↑ 종목이 아직 없습니다"

    data = {
        "schema": "fox-signal-scorecard/v1",
        "updatedAt": dt.datetime.now(KST).replace(microsecond=0).isoformat(),
        "asOfTradingDay": as_of,
        "basis": "네이버 일봉(OHLC) 실측 · 브리핑·초안에 적힌 종목·기준선만 채점(해석 없음)",
        "headline": headline,
        "summary": {
            "measured": t["measured"], "up": t["up"], "down": t["down"],
            "held": t["held"], "broken": t["broken"], "pending": len(pending_rows),
            "items": len(items) + len(pending_rows),
        },
        "items": items[:24],
        "pending": pending_rows[:12],
        "supply": load_supply(),
        "leaders": [
            {
                "name": r["name"], "code": r["code"], "valueEok": r.get("valueEok"),
                "changePct": r["result"].get("changePct"), "close": r["result"].get("close"),
                "tradeDate": r["result"].get("tradeDate"),
            }
            for r in leaders[:5]
        ],
        "meta": {
            "generator": "scripts/build_signal_scorecard.py",
            "rules": [
                "종목: 대상 거래일 종가가 전일 종가보다 높으면 '상승', 낮으면 '하락'.",
                "지수 지지선: 대상 거래일 종가 ≥ 지지선 → '유지', 아니면 '이탈'.",
                "지수 저항선: 대상 거래일 고가 ≥ 저항선 → '돌파', 아니면 '미달'.",
                "장전(~08:59) 브리핑은 당일, 그 뒤 브리핑·초안은 다음 거래일을 채점한다.",
                "대상 거래일이 아직 오지 않았거나 시세를 못 받으면 '검증 대기'로 남긴다.",
            ],
            "briefings": ["briefings/" + os.path.basename(f[3]) for f in picked],
        },
    }

    body = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    print(f"성적표 — 측정 {t['measured']}건(상승 {t['up']}·하락 {t['down']}·지지유지 {t['held']}·이탈 {t['broken']}) · 대기 {len(pending_rows)}건")
    print(f"  기준일 {as_of} · {headline}")
    for p in args.out_dirs:
        path = os.path.join(p, "signal_scorecard.json")
        if args.dry_run:
            print(f"[dry-run] {path} ({len(body):,} bytes)")
            continue
        os.makedirs(p, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        print(f" wrote {path} ({len(body):,} bytes)")

    # ⑥ 체커 폴백용 스냅샷 — 지수 + 성적표 종목의 최신 실측(OHLC·대금)
    snap_stocks = []
    for r in (leaders + [x for x in pending_rows if x["kind"] == "stock"])[:12]:
        code = r.get("code")
        if not code:
            continue
        rows = naver_daily(code, start, end)
        if not rows:
            continue
        last = rows[-1]
        prev = rows[-2] if len(rows) > 1 else None
        snap_stocks.append({
            "code": code, "name": r["name"],
            "tradeDate": last["date"], "open": last["open"], "high": last["high"],
            "low": last["low"], "close": last["close"],
            "changePct": pct_change(prev["close"], last["close"]) if prev else None,
            "valueEok": r.get("valueEok"),
        })
    snap = {
        "schema": "fox-stock-snapshot/v1",
        "updatedAt": data["updatedAt"],
        "basis": "네이버 일봉 마지막 거래일 종가(장 마감 후 스냅샷) · 실시간은 /api/stock-live",
        "tradeDate": as_of,
        "indices": [
            {
                "key": "KOSPI" if nm == "KOSPI" else "KOSDAQ",
                "name": "코스피" if nm == "KOSPI" else "코스닥",
                "price": r[-1]["close"], "open": r[-1]["open"], "high": r[-1]["high"], "low": r[-1]["low"],
                "changePct": pct_change(r[-2]["close"], r[-1]["close"]) if len(r) > 1 else None,
            }
            for nm, r in (("KOSPI", kospi), ("KOSDAQ", kosdaq)) if r
        ],
        "stocks": snap_stocks,
    }
    sbody = json.dumps(snap, ensure_ascii=False, indent=1) + "\n"
    for p in args.out_dirs:
        path = os.path.join(p, "stock_snapshot_latest.json")
        if args.dry_run:
            print(f"[dry-run] {path} ({len(sbody):,} bytes)")
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(sbody)
        print(f" wrote {path} ({len(sbody):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
