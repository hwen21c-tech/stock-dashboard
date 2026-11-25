#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""💾 관제탑 일별 자동 아카이브 생성기 (자정 23:59 브리핑 종료 후 실행)

무엇을 하나
  - 관제탑 화면이 실제로 들고 있는 값(임베디드 MANJU_DATA·테마 JSON·수급 JSON·브리핑 원문)에서
    그날의 코스피/코스닥 종가·등락률, 야간선물, 외인·기관 수급, 주도 테마 Top 3, 만쥬 픽,
    브리핑 타임라인을 읽어 서버 아카이브로 남긴다.
  - 남기는 곳(같은 내용 2벌 — 정적 GitHub Pages / 동적 Vercel):
      deploy_repo/data/archives/YYYY-MM-DD.json      + deploy_repo/data/archives/index.json
      sd_live/public/data/archives/YYYY-MM-DD.json   + sd_live/public/data/archives/index.json
  - 관제탑 `📁 보관함`(openHistoryModal)이 ./data/archives/index.json 을 읽어
    브라우저 localStorage 수동 저장분과 날짜 역순으로 병합해 보여 준다.

원칙
  - 값이 없으면 지어내지 않는다. 없으면 null 로 두고 missing[] 에 이유를 적는다.
  - 모든 값에 어디서 읽었는지(source)를 붙인다.

사용법
  python3 scripts/archive_daily_snapshot.py                     # 오늘(KST). 00~04시면 전일
  python3 scripts/archive_daily_snapshot.py --date 2026-11-19   # 특정 날짜
  python3 scripts/archive_daily_snapshot.py --dry-run           # 파일 쓰지 않고 결과만 출력
  python3 scripts/archive_daily_snapshot.py --only deploy_repo  # 한쪽만 기록
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

KST = dt.timezone(dt.timedelta(hours=9), "KST")
WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]

DEPLOY_ROOT = os.path.join(ROOT, "deploy_repo")
LIVE_ROOT = os.path.join(ROOT, "sd_live", "public")

PATH_INDEX_HTML = ["deploy_repo/index.html", "sd_live/public/index.html"]
PATH_THEMES = ["sd_live/public/data/last-dynamic-themes.json",
               "deploy_repo/data/last-dynamic-themes.json"]
PATH_STOCK_EASY_THEMES = ["sd_live/public/data/stockeasy_live_themes.json"]
PATH_SUPPLY = ["sd_live/public/data/supply-latest.json"]
PATH_LATEST_BRIEFING = ["deploy_repo/data/latest-briefing.json",
                        "sd_live/public/data/latest-briefing.json"]
BRIEFING_DIR = os.path.join(ROOT, "briefings")
ARCHIVE_MAX = 400


# ----------------------------------------------------------------- 유틸
def kst_now():
    return dt.datetime.now(KST)


def resolve_target_date(date_arg):
    """--date 가 없으면 KST 기준 오늘. 00:00~04:00 사이라면 '방금 끝난 날'의 결산이므로 전일."""
    if date_arg:
        return dt.datetime.strptime(date_arg, "%Y-%m-%d").date()
    now = kst_now()
    if now.hour < 4:
        return (now - dt.timedelta(days=1)).date()
    return now.date()


def date_label(d):
    return "%04d-%02d-%02d(%s)" % (d.year, d.month, d.day, WEEKDAY_KO[d.weekday()])


def read_text(rel):
    p = os.path.join(ROOT, rel)
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return None


def read_json(rel):
    txt = read_text(rel)
    if not txt:
        return None
    try:
        return json.loads(txt)
    except Exception:
        return None


def first_json(cands):
    for rel in cands:
        d = read_json(rel)
        if d:
            return d, rel
    return None, None


def fmt_num(v, digits=2):
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except Exception:
        return None
    s = "{:,.{d}f}".format(f, d=digits)
    return s


def fmt_pct(v):
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except Exception:
        return None
    return ("+" if f > 0 else "") + "%.2f%%" % f


def fmt_eok(v):
    """억 원 정수 표기 (-4,086억) — 부호 유지."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except Exception:
        return None
    return "{:+,.0f}억".format(f).replace("+0억", "0억")


def extract_js_object(src, marker):
    """`window.MANJU_DATA = {...}` 처럼 마커 뒤 첫 '{' 부터 짝이 맞는 '}' 까지 떼어 JSON 파싱."""
    i = src.find(marker)
    if i < 0:
        return None
    j = src.find("{", i + len(marker))
    if j < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for k in range(j, len(src)):
        c = src[k]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(src[j:k + 1])
                    except Exception:
                        return None
    return None


# ----------------------------------------------------------------- 수집
def collect_indices(src, missing):
    """코스피/코스닥 종가·등락률 — MANJU_DATA.mood (관제탑이 실제 렌더에 쓰는 값)."""
    out = {"kospi": None, "kosdaq": None}
    mood = None
    for rel in PATH_INDEX_HTML:
        s = read_text(rel)
        if not s:
            continue
        data = extract_js_object(s, "window.MANJU_DATA = ")
        if data and isinstance(data.get("mood"), dict):
            mood = data["mood"]
            out["source"] = rel + " · window.MANJU_DATA.mood"
            break

    if mood:
        for key, name in (("kospi", "코스피"), ("kosdaq", "코스닥")):
            m = mood.get(key) or {}
            if m.get("price") is None:
                missing.append("%s 지수 값 없음(MANJU_DATA.mood.%s)" % (name, key))
                continue
            out[key] = {
                "name": name,
                "value": fmt_num(m.get("price")),
                "pct": fmt_pct(m.get("pct")),
                "raw": m.get("price"),
                "pctRaw": m.get("pct"),
                "status": m.get("status") or "",
                "asOf": m.get("at") or "",
                "closeDate": (m.get("at") or "")[:10] or None,
                "source": "MANJU_DATA.mood.%s" % key,
            }

    # 폴백: 최신 브리핑 JSON 의 indices 배열 (브리핑이 남긴 확정 종가)
    if not out["kospi"] or not out["kosdaq"]:
        brief, brel = first_json(PATH_LATEST_BRIEFING)
        for item in (brief or {}).get("indices", []) or []:
            nm = (item.get("name") or "").strip()
            if nm == "코스피" and not out["kospi"]:
                out["kospi"] = {"name": "코스피", "value": item.get("value"), "pct": item.get("change"),
                                "raw": None, "pctRaw": None, "status": "", "asOf": (brief or {}).get("updatedAt", ""),
                                "source": brel + " · indices(폴백)"}
            if nm == "코스닥" and not out["kosdaq"]:
                out["kosdaq"] = {"name": "코스닥", "value": item.get("value"), "pct": item.get("change"),
                                 "raw": None, "pctRaw": None, "status": "", "asOf": (brief or {}).get("updatedAt", ""),
                                 "source": brel + " · indices(폴백)"}
        out["source"] = out.get("source") or brel + " · indices(폴백)"
    return out


def collect_night(mood_src, missing):
    """야간선물·나스닥선물·원/달러 — 관제탑 mood 에 있는 그대로(추정 금지)."""
    out = {}
    s = read_text(mood_src) if mood_src else None
    mood = extract_js_object(s, "window.MANJU_DATA = ") if s else None
    if not mood or not isinstance(mood.get("mood"), dict):
        missing.append("야간선물: MANJU_DATA 를 읽지 못함")
        return out
    m = mood["mood"]

    nf = m.get("nightFuture") or {}
    if nf.get("value") is not None:
        out["nightFutures"] = {
            "value": fmt_num(nf.get("value")),
            "pct": fmt_pct(nf.get("pct")),
            "raw": nf.get("value"),
            "pctRaw": nf.get("pct"),
            "label": nf.get("label") or "",
            "source": "MANJU_DATA.mood.nightFuture",
        }
    else:
        missing.append("야간선물 값 없음(MANJU_DATA.mood.nightFuture)")

    nq = m.get("nq") or {}
    if nq.get("price") is not None:
        out["nasdaqFutures"] = {
            "value": fmt_num(nq.get("price")),
            "pct": fmt_pct(nq.get("pct")),
            "asOf": nq.get("as_of_kst") or "",
            "symbol": nq.get("symbol") or "",
            "source": "MANJU_DATA.mood.nq",
        }
    fx = m.get("fx") or {}
    if fx.get("price") is not None:
        out["fx"] = {
            "value": fmt_num(fx.get("price")),
            "pct": fmt_pct(fx.get("pct")),
            "asOf": fx.get("date") or "",
            "source": "MANJU_DATA.mood.fx",
        }
    return out


def collect_supply(mood_src, target, missing):
    """외인·기관 수급 — 코스피 확정치(MANJU_DATA.mood.supply). 코스닥은 구조화 값이 없으면 미확인."""
    out = {}
    s = read_text(mood_src) if mood_src else None
    mood = extract_js_object(s, "window.MANJU_DATA = ") if s else None
    sup = ((mood or {}).get("mood") or {}).get("supply") or {}
    ymd = target.strftime("%Y%m%d")
    if sup and str(sup.get("bizdate") or "") == ymd:
        out = {
            "basis": "%s-%s-%s" % (ymd[:4], ymd[4:6], ymd[6:]),
            "confirmed": True,
            "foreignKospi": sup.get("foreign"),
            "instKospi": sup.get("organ"),
            "personalKospi": sup.get("personal"),
            "foreignKospiText": fmt_eok(sup.get("foreign")),
            "instKospiText": fmt_eok(sup.get("organ")),
            "personalKospiText": fmt_eok(sup.get("personal")),
            "text": "코스피 외인 %s · 기관 %s · 개인 %s" % (
                fmt_eok(sup.get("foreign")) or "—",
                fmt_eok(sup.get("organ")) or "—",
                fmt_eok(sup.get("personal")) or "—"),
            "source": "MANJU_DATA.mood.supply (bizdate %s)" % sup.get("bizdate"),
        }
    elif sup:
        missing.append("수급 기준일 불일치( mood %s ≠ %s ) — 확정치로 쓰지 않음" % (sup.get("bizdate"), ymd))
    else:
        missing.append("수급 값 없음(MANJU_DATA.mood.supply)")

    # 보조: 종목별 수급 스캔이 그날 기준으로 돌았는지만 확인(없으면 missing 에 남김)
    supj, supl = first_json(PATH_SUPPLY)
    if supj:
        out["scanBasis"] = supj.get("basisLabel") or supj.get("basisDate")
        out["scanConfirmed"] = bool(supj.get("confirmed"))
        out["scanSource"] = supl
        if str(supj.get("basisDate") or "") != ymd:
            missing.append("종목별 수급 스캔 기준일(%s)이 아카이브 날짜(%s)와 다름" %
                           (supj.get("basisDate"), ymd))
    return out


def collect_themes(target, missing):
    """주도 테마 Top 3 — 테마맵 확정 데이터(asOfDate 일치) 우선, 없으면 실시간 테마보드."""
    ymd = target.strftime("%Y%m%d")
    themes, basis, source = [], None, None

    d, rel = first_json(PATH_THEMES)
    if d and str(d.get("asOfDate") or "") == ymd:
        basis = d.get("basisLong") or d.get("shortLabel")
        source = rel
        for t in (d.get("themes") or [])[:3]:
            themes.append({
                "rank": t.get("rank"),
                "name": t.get("name"),
                "top4Avg": t.get("top4Avg"),
                "avgPct": t.get("avgPct"),
                "sumValueText": t.get("sumValueText"),
                "riseRatio": t.get("riseRatio"),
                "leader": ((t.get("stocks") or [{}])[0] or {}).get("name"),
                "leaderPct": ((t.get("stocks") or [{}])[0] or {}).get("changePct"),
            })
    elif d:
        missing.append("테마맵 기준일(%s)이 아카이브 날짜(%s)와 달라 확정 테마로 쓰지 않음" %
                       (d.get("asOfDate"), ymd))

    if not themes:
        d2, rel2 = first_json(PATH_STOCK_EASY_THEMES)
        if d2 and d2.get("themes"):
            source = rel2 + " · 실시간 테마보드(기준일 미표기)"
            basis = d2.get("fetchedAt")
            for t in d2["themes"][:3]:
                themes.append({
                    "rank": t.get("rank"),
                    "name": t.get("name"),
                    "top4Avg": None,
                    "avgPct": None,
                    "sumValueText": None,
                    "riseRatio": None,
                    "leader": ((t.get("stocks") or [{}])[0] or {}).get("name"),
                    "leaderPct": ((t.get("stocks") or [{}])[0] or {}).get("changePct"),
                })
    if not themes:
        missing.append("주도 테마 데이터 없음")
    return {"themes": themes, "basis": basis, "source": source}


def collect_manju(target, missing):
    """만쥬 픽 — 관제탑 만쥬 탭 카드(data-manju-code)에서 순위/관찰 항목만 뽑는다."""
    picks, note = [], None
    for rel in PATH_INDEX_HTML:
        s = read_text(rel)
        if not s:
            continue
        blocks = re.split(r'<div class="manju-item"', s)
        seen = set()
        for b in blocks[1:]:
            m = re.search(r'data-manju-code="(\d{6})"', b[:400])
            if not m:
                continue
            code = m.group(1)
            rank = re.search(r'<span class="mi-rank"[^>]*>([^<]*)</span>', b)
            title = re.search(r'<span class="mi-title">([^<]*)</span>', b)
            price = re.search(r'<span class="mi-price"[^>]*>([^<]*)</span>', b)
            tgt = re.search(r'<div class="mi-target"[^>]*>(.*?)</div>', b, re.S)
            rank_txt = clean_html(rank.group(1)) if rank else ""
            if ("순위" not in rank_txt) and ("관찰" not in rank_txt):
                continue
            if code in seen:
                continue
            seen.add(code)
            picks.append({
                "rank": rank_txt,
                "code": code,
                "name": clean_html(title.group(1)) if title else code,
                "price": clean_html(price.group(1)) if price else None,
                "plan": clean_html(tgt.group(1)) if tgt else None,
                "source": rel + " · 만쥬 탭 카드",
            })
            if len(picks) >= 4:
                break
        if picks:
            mm = re.search(r'확정 비중:\s*<span>([^<]*)</span>', s)
            if mm:
                note = clean_html(mm.group(1))
            break
    if not picks:
        missing.append("만쥬 픽 카드(data-manju-code)를 찾지 못함")
    return {"manjuPicks": picks, "manjuNote": note}


def clean_html(t):
    if t is None:
        return None
    t = re.sub(r"<[^>]+>", " ", t)
    t = (t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
          .replace("&quot;", '"').replace("&#x27;", "'").replace("&#39;", "'").replace("&nbsp;", " "))
    return re.sub(r"\s+", " ", t).strip()


def collect_briefings(target, missing):
    """당일 브리핑 타임라인 — briefings/YYYY-MM-DD_HHMM.md 의 첫 줄(제목)을 시간순으로."""
    if not os.path.isdir(BRIEFING_DIR):
        missing.append("briefings 디렉터리 없음")
        return []
    pat = re.compile(r"^%s_(\d{4})\.md$" % target.strftime("%Y-%m-%d"))
    rows = []
    for fn in os.listdir(BRIEFING_DIR):
        m = pat.match(fn)
        if not m:
            continue
        t = m.group(1)
        head = ""
        try:
            with open(os.path.join(BRIEFING_DIR, fn), encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        head = line.strip()
                        break
        except Exception:
            pass
        rows.append({"time": t[:2] + ":" + t[2:], "slot": t,
                     "title": summarize_briefing_title(head), "file": "briefings/" + fn})
    rows.sort(key=lambda r: r["time"])
    if not rows:
        missing.append("당일 브리핑 원문(briefings/%s_*.md) 없음" % target.strftime("%Y-%m-%d"))
    return rows


def summarize_briefing_title(head):
    """'📈 [19:30 애프터마켓 …] 2026년 … · 연오랑 · ★야간선물 …' → '19:30 애프터마켓 … · ★야간선물 …'"""
    if not head:
        return ""
    s = head
    m = re.match(r"^[^\[]*\[([^\]]+)\]\s*(.*)$", s)
    if m:
        slot = m.group(1).strip()
        rest = m.group(2)
        parts = [p.strip() for p in rest.split("·")]
        tail = [p for p in parts if p and ("연오랑" not in p) and not re.match(r"^\d{4}년", p)]
        head_part = " · ".join(tail).strip(" *")
        return (slot + (" · " + head_part if head_part else "")).strip()
    return s.strip(" *")[:160]


# ----------------------------------------------------------------- 조립
def build_archive(target):
    missing = []
    mood_rel = None
    for rel in PATH_INDEX_HTML:
        s = read_text(rel)
        if s and "window.MANJU_DATA = " in s:
            mood_rel = rel
            break

    indices = collect_indices(mood_rel, missing)
    night = collect_night(mood_rel, missing)
    supply = collect_supply(mood_rel, target, missing)
    theme_pack = collect_themes(target, missing)
    manju = collect_manju(target, missing)
    briefs = collect_briefings(target, missing)

    md = "%02d/%02d" % (target.month, target.day)
    k = indices.get("kospi") or {}
    q = indices.get("kosdaq") or {}
    close_date = k.get("closeDate") or q.get("closeDate")
    same_day = bool(close_date) and close_date == target.strftime("%Y-%m-%d")
    if close_date and not same_day:
        missing.append("지수가 직전 정규장(%s) 종가입니다 — %s 마감값이 아닙니다" % (close_date, target.strftime("%Y-%m-%d")))
    if same_day:
        title = "%s 마감 — 코스피 %s (%s) / 코스닥 %s (%s)" % (
            md, k.get("value") or "—", k.get("pct") or "—",
            q.get("value") or "—", q.get("pct") or "—")
    else:
        title = "%s 아카이브 — 직전 정규장(%s) 종가 코스피 %s (%s) / 코스닥 %s (%s)" % (
            md, (close_date[5:7] + "/" + close_date[8:10]) if close_date else "미확인",
            k.get("value") or "—", k.get("pct") or "—",
            q.get("value") or "—", q.get("pct") or "—")

    now = kst_now()
    archive = {
        "schema": 1,
        "date": target.strftime("%Y-%m-%d"),
        "label": date_label(target),
        "kind": "auto",
        "badge": "🤖 자정 자동저장",
        "savedAt": now.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "generatedBy": "scripts/archive_daily_snapshot.py",
        "title": title,
        "closeDate": close_date,
        "closeMatchesDate": same_day,
        "summaryLine": build_summary_line(indices, night, supply, theme_pack, manju),
        "indices": indices,
        "nightFutures": night.get("nightFutures"),
        "nightFuturesNote": "생성 시점에 관제탑이 표기한 야간선물 값입니다. 세션 진행 중이면 진행 값, 마감 뒤면 마감 확정값입니다.",
        "nasdaqFutures": night.get("nasdaqFutures"),
        "fx": night.get("fx"),
        "supply": supply,
        "themes": theme_pack["themes"],
        "themeBasis": theme_pack["basis"],
        "themeSource": theme_pack["source"],
        "manjuPicks": manju["manjuPicks"],
        "manjuNote": manju["manjuNote"],
        "briefings": briefs,
        "briefingCount": len(briefs),
        "missing": missing,
        "note": "자정 23:59 브리핑 종료 후 관제탑 값 그대로 남긴 자동 아카이브입니다. 값이 없으면 null/— 이며 추정치를 넣지 않습니다.",
    }
    return archive


def build_summary_line(indices, night, supply, theme_pack, manju):
    bits = []
    k, q = indices.get("kospi"), indices.get("kosdaq")
    if k:
        bits.append("코스피 %s (%s)" % (k.get("value"), k.get("pct")))
    if q:
        bits.append("코스닥 %s (%s)" % (q.get("value"), q.get("pct")))
    nf = night.get("nightFutures")
    if nf:
        bits.append("야간선물 %s (%s)" % (nf.get("value"), nf.get("pct")))
    if supply.get("text"):
        bits.append(supply["text"])
    th = theme_pack.get("themes") or []
    if th:
        bits.append("주도테마 " + ", ".join([t.get("name") or "—" for t in th[:3]]))
    mp = manju.get("manjuPicks") or []
    if mp:
        bits.append("만쥬 " + " · ".join(["%s %s" % (p.get("rank"), p.get("name")) for p in mp[:3]]))
    return " · ".join(bits)


def compact_entry(a):
    return {
        "date": a["date"],
        "label": a.get("label"),
        "kind": "auto",
        "badge": a.get("badge"),
        "savedAt": a.get("savedAt"),
        "title": a.get("title"),
        "closeDate": a.get("closeDate"),
        "closeMatchesDate": a.get("closeMatchesDate"),
        "kospi": (a.get("indices") or {}).get("kospi"),
        "kosdaq": (a.get("indices") or {}).get("kosdaq"),
        "nightFutures": a.get("nightFutures"),
        "supply": a.get("supply"),
        "themes": a.get("themes") or [],
        "themeBasis": a.get("themeBasis"),
        "manjuPicks": a.get("manjuPicks") or [],
        "manjuNote": a.get("manjuNote"),
        "briefingCount": a.get("briefingCount", 0),
        "missing": a.get("missing") or [],
        "path": "data/archives/%s.json" % a["date"],
    }


def write_outputs(archive, only=None):
    written = []
    roots = []
    if only in (None, "deploy_repo"):
        roots.append(DEPLOY_ROOT)
    if only in (None, "sd_live"):
        roots.append(LIVE_ROOT)

    for root in roots:
        adir = os.path.join(root, "data", "archives")
        os.makedirs(adir, exist_ok=True)
        dpath = os.path.join(adir, "%s.json" % archive["date"])
        with open(dpath, "w", encoding="utf-8") as f:
            json.dump(archive, f, ensure_ascii=False, indent=1)
        written.append(dpath)

        ipath = os.path.join(adir, "index.json")
        index = {"schema": 1, "updatedAt": archive["savedAt"], "count": 0, "latest": None, "entries": []}
        if os.path.exists(ipath):
            try:
                with open(ipath, encoding="utf-8") as f:
                    prev = json.load(f)
                if isinstance(prev, dict) and isinstance(prev.get("entries"), list):
                    index = prev
                elif isinstance(prev, list):
                    index["entries"] = prev
            except Exception:
                pass
        entries = [e for e in index.get("entries", []) if e.get("date") != archive["date"]]
        entries.append(compact_entry(archive))
        entries.sort(key=lambda e: e.get("date", ""), reverse=True)
        entries = entries[:ARCHIVE_MAX]
        index.update({
            "schema": 1,
            "updatedAt": archive["savedAt"],
            "count": len(entries),
            "latest": entries[0]["date"] if entries else None,
            "entries": entries,
        })
        with open(ipath, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=1)
        written.append(ipath)
    return written


def main():
    ap = argparse.ArgumentParser(description="관제탑 일별 자동 아카이브 생성")
    ap.add_argument("--date", help="YYYY-MM-DD (기본: KST 오늘, 00~04시엔 전일)")
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 결과만 출력")
    ap.add_argument("--only", choices=["deploy_repo", "sd_live"], help="한쪽 트리에만 기록")
    ap.add_argument("--force", action="store_true", help="장 마감일과 날짜가 달라도 그대로 기록")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    target = resolve_target_date(args.date)
    archive = build_archive(target)

    if args.dry_run:
        print(json.dumps(archive, ensure_ascii=False, indent=1))
        return 0

    # 휴장일·주말(지수가 직전 정규장 그대로)에는 같은 결산을 또 만들지 않는다.
    #  평일인데 마감값이 전일 그대로면(데이터 지연) 기록은 남기되 '직전 정규장' 라벨을 단다.
    if not archive["closeMatchesDate"] and not args.force and target.weekday() >= 5:
        cd = archive.get("closeDate")
        if cd:
            dup = os.path.join(DEPLOY_ROOT, "data", "archives", cd + ".json")
            dup2 = os.path.join(LIVE_ROOT, "data", "archives", cd + ".json")
            if os.path.exists(dup) or os.path.exists(dup2):
                if not args.quiet:
                    print("⏭️ 건너뜀 — %s(휴장일)는 직전 정규장(%s) 종가 그대로이고 그 날짜 아카이브가 이미 있습니다."
                          % (archive["date"], cd))
                return 0

    written = write_outputs(archive, args.only)
    if not args.quiet:
        print("✅ 아카이브 %s (%s)" % (archive["date"], archive["label"]))
        print("   " + archive["title"])
        if archive["missing"]:
            print("   ⚠️ 미확인: " + " / ".join(archive["missing"]))
        for p in written:
            print("   → " + os.path.relpath(p, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
