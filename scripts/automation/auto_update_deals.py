#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
특가 레이더 정기 동기화 파이프라인.

이전 버전은 상단 뱃지의 시각만 바꿨다. 이 버전은
  data/latest_scanned_deals.json (실측 스캔 결과) 을 읽어
  deploy_repo/deals.html 의 travelDeals / kidsDeals 배열 자체를 최신 스캔 결과로 교체한다.

  · 핀 고정된 상품은 브라우저 localStorage(fdr_pinned_deals_v1)에 남아 있어
    배열이 통째로 교체돼도 사라지지 않는다(비고정 상품만 교체됨).
  · 교체 후 esprima 문법 검사 · <div> 밸런스 · 중복 ID · 링크 HTTP 상태를 검증한다.

사용법
  python3 scripts/auto_update_deals.py                       # 교체 + 검증
  python3 scripts/auto_update_deals.py --check-links         # 링크 HTTP 200 까지 확인
  python3 scripts/auto_update_deals.py --dry-run             # 파일 쓰지 않고 검증만
  python3 scripts/auto_update_deals.py --push "메시지"        # 검증 통과 시 git commit & push
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys

# 저장소 루트(deploy_repo 체크아웃). 개발 작업 환경에서는 SYNC_REPO_ROOT 로 넘긴다.
ROOT = os.environ.get("SYNC_REPO_ROOT") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEALS_PATH = os.path.join(ROOT, "deals.html")
SCAN_PATH = os.path.join(ROOT, "data", "latest_scanned_deals.json")

TRAVEL_REQUIRED = ["id", "type", "theme", "theme_label", "source", "source_badge",
                   "source_color", "title", "region", "deal_price", "discount",
                   "family_saved", "price_level_text", "benefit_pills",
                   "season_reason", "family_fit", "link", "link_label", "search_kw"]
KIDS_REQUIRED = ["id", "category", "cat_label", "source", "source_badge", "source_color",
                 "title", "location", "target_age", "price_info", "benefit_tag",
                 "family_saved", "price_level_text", "unit_price", "tips",
                 "highlights", "link", "link_label", "search_kw"]


def log(msg):
    print(msg, flush=True)


def load_scan():
    if not os.path.exists(SCAN_PATH):
        log(f"[FAIL] 스캔 결과 파일이 없습니다: {SCAN_PATH}")
        return None
    with open(SCAN_PATH, encoding="utf-8") as f:
        data = json.load(f)
    for key in ("travelDeals", "kidsDeals"):
        if not isinstance(data.get(key), list) or not data[key]:
            log(f"[FAIL] {key} 가 비어 있습니다. 빈 목록으로 교체하면 화면이 비므로 중단합니다.")
            return None
    return data


def validate_scan(data):
    errors = []
    travel, kids = data["travelDeals"], data["kidsDeals"]

    if len(travel) < 5:
        errors.append(f"여행 특가가 {len(travel)}건뿐입니다(최소 5건 기대)")
    if len(kids) < 5:
        errors.append(f"키즈 특가가 {len(kids)}건뿐입니다(최소 5건 기대)")

    ids = []
    for kind, items, required in (("travel", travel, TRAVEL_REQUIRED), ("kids", kids, KIDS_REQUIRED)):
        for it in items:
            for field in required:
                if field not in it:
                    errors.append(f"{kind}:{it.get('id', '?')} 필수 필드 누락 — {field}")
            link = (it.get("link") or "").strip()
            if not link.startswith("https://"):
                errors.append(f"{kind}:{it.get('id', '?')} 링크가 https 가 아닙니다 — {link!r}")
            title = (it.get("title") or "").strip()
            if not title:
                errors.append(f"{kind}:{it.get('id', '?')} 제목이 비었습니다")
            ids.append((kind, it.get("id")))
            if kind == "kids":
                if not isinstance(it.get("unit_price"), (int, float)) or it.get("unit_price", 0) <= 0:
                    errors.append(f"kids:{it.get('id')} unit_price 는 0보다 큰 숫자여야 합니다")
    seen = {}
    for kind, i in ids:
        key = f"{kind}::{i}"
        if key in seen:
            errors.append(f"중복 ID: {key}")
        seen[key] = True
    # 제목 완전 중복도 막는다(고정 병합 시 같은 카드가 두 번 보이는 원인)
    titles = {}
    for kind, items in (("travel", travel), ("kids", kids)):
        for it in items:
            t = re.sub(r"\s+", "", it.get("title", ""))
            if t in titles:
                errors.append(f"중복 제목: {it.get('title')}")
            titles[t] = True
    return errors


def _http_code(url):
    """실제 브라우저와 같은 UA/리다이렉트로 상태코드를 잰다.

    일부 여행 사이트는 urllib 의 기본 요청 형태를 봇으로 보고 403 을 주므로
    curl 이 있으면 curl 로 잰다(브라우저·curl 실측과 같은 결과).
    """
    ua = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
    if shutil.which("curl"):
        res = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                              "-L", "--max-time", "25", "-A", ua, url],
                             capture_output=True, text=True)
        out = (res.stdout or "").strip()
        return int(out) if out.isdigit() else "ERR"
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status
    except Exception as exc:  # noqa: BLE001
        return getattr(exc, "code", "ERR")


def check_links(data):
    hard_bad = []
    soft_bad = []
    for kind, items in (("travel", data["travelDeals"]), ("kids", data["kidsDeals"])):
        for it in items:
            url = it["link"]
            code = _http_code(url)
            if code == 200:
                mark = "OK "
            elif code in (401, 403, 429):
                # 사이트가 자동 요청을 막는 경우(브라우저 실측으로는 열림) — 경고만 남긴다
                mark = "WARN"
                soft_bad.append((it["id"], code, url))
            else:
                mark = "BAD"
                hard_bad.append((it["id"], code, url))
            log(f"  [{mark}] {code} {kind}:{it['id']} {url[:90]}")
    if soft_bad:
        log(f"  [경고] 자동 요청 차단 {len(soft_bad)}건(403/429) — 브라우저에서는 열리는지 따로 확인해야 합니다")
    return hard_bad


def js_syntax_errors(html):
    try:
        import esprima
    except ImportError:
        return ["esprima 미설치: JS 문법 검사를 건너뛰었습니다"]
    errors = []
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", html, flags=re.S)
    for idx, code in enumerate(scripts):
        if not code.strip():
            continue
        if re.search(r'type="(?!text/javascript|application/javascript)', code[:200]):
            continue
        try:
            esprima.parseScript(code)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"script[{idx}] {type(exc).__name__}: {exc}")
    return errors


def replace_arrays(html, data):
    travel_json = json.dumps(data["travelDeals"], ensure_ascii=False, separators=(", ", ": "))
    kids_json = json.dumps(data["kidsDeals"], ensure_ascii=False, separators=(", ", ": "))

    new_travel = "    var travelDeals = " + travel_json + ";"
    new_kids = "    var kidsDeals = " + kids_json + ";"

    lines = html.split("\n")
    hit = {"travel": 0, "kids": 0, "meta": 0}
    for i, line in enumerate(lines):
        if line.startswith("    var travelDeals = ["):
            lines[i] = new_travel
            hit["travel"] += 1
        elif line.startswith("    var kidsDeals = ["):
            lines[i] = new_kids
            hit["kids"] += 1
    if hit["travel"] != 1 or hit["kids"] != 1:
        raise SystemExit(f"[FAIL] 배열 라인을 찾지 못했습니다: {hit}")

    meta = {
        "scannedAt": data.get("scanned_at", ""),
        "source": data.get("source", ""),
        "travel": len(data["travelDeals"]),
        "kids": len(data["kidsDeals"]),
        "total": len(data["travelDeals"]) + len(data["kidsDeals"]),
    }
    meta_line = "    var DEALS_SCAN_META = " + json.dumps(meta, ensure_ascii=False) + ";"
    out = []
    inserted = False
    for line in lines:
        if line.startswith("    var DEALS_SCAN_META = "):
            out.append(meta_line)
            hit["meta"] += 1
            inserted = True
            continue
        out.append(line)
    if not inserted:
        # 없으면 kidsDeals 바로 다음 줄에 넣는다
        final = []
        for line in out:
            final.append(line)
            if line.startswith("    var kidsDeals = ") and not inserted:
                final.append(meta_line)
                inserted = True
        out = final
        hit["meta"] = 1
    return "\n".join(out), hit


def update_sync_badge(html, scanned_at, counts):
    now_kst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    stamp = scanned_at or now_kst.strftime("%Y-%m-%d %H:%M")
    curr_hm = now_kst.strftime("%H:%M")
    if curr_hm < "09:30":
        slot_badge = "🌅 아침 특가 & 카톡 톡딜 모니터링"
    elif curr_hm < "14:00":
        slot_badge = "⚡ 10시 타임어택 실시간 감지"
    elif curr_hm < "20:00":
        slot_badge = "🚀 오후 여행 & 키즈 핫딜 가동"
    else:
        slot_badge = "🌙 야간 패밀리 특가 점검 완료"
    new_badge = ('<span id="dealsLastSync" style="font-size: 10.5px; color: #34d399; font-weight:700;">'
                 f'최근 동기화: {stamp} 🟢 [{slot_badge}] · 여행 {counts[0]} · 키즈 {counts[1]}건 교체</span>')
    html, n = re.subn(r'<span id="dealsLastSync"[^>]*>.*?</span>', new_badge, html, count=1)
    if n != 1:
        log("[WARN] 동기화 뱃지(dealsLastSync)를 찾지 못했습니다")
    return html


def structural_checks(html):
    errors = []
    opens, closes = html.count("<div"), html.count("</div>")
    if opens != closes:
        errors.append(f"<div> 불균형: {opens} open vs {closes} close")
    if "<div" not in html:
        errors.append("<div 태그가 없습니다")
    errors.extend(js_syntax_errors(html))
    ids = re.findall(r'"id": "([^"]+)"', html)
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        errors.append(f"HTML 내 중복 ID: {dupes}")
    return errors


def git_push(message):
    repo = ROOT
    cmds = [
        ["git", "-C", repo, "add", "deals.html"],
        ["git", "-C", repo, "commit", "-m", message],
        ["git", "-C", repo, "push", "origin", "main"],
    ]
    for cmd in cmds:
        res = subprocess.run(cmd, capture_output=True, text=True)
        log(f"$ {' '.join(cmd[3:])} → {res.returncode}")
        if res.stdout.strip():
            log(res.stdout.strip()[:500])
        if res.returncode != 0:
            log(res.stderr.strip()[:800])
            return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-links", action="store_true", help="상품 링크 HTTP 200 확인")
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 검증만")
    ap.add_argument("--push", default="", help="검증 통과 시 git commit & push (커밋 메시지)")
    args = ap.parse_args()

    if not os.path.exists(DEALS_PATH):
        log(f"[FAIL] 파일 없음: {DEALS_PATH}")
        return 1
    data = load_scan()
    if data is None:
        return 1

    errors = validate_scan(data)
    if errors:
        log("[FAIL] 스캔 데이터 검증 실패")
        for e in errors:
            log("  - " + e)
        return 1
    log(f"[ok] 스캔 데이터 검증: 여행 {len(data['travelDeals'])}건 · 키즈 {len(data['kidsDeals'])}건")

    if args.check_links:
        log("[..] 링크 HTTP 확인")
        bad = check_links(data)
        if bad:
            log(f"[FAIL] 열리지 않는 링크 {len(bad)}건 — 교체를 중단합니다")
            for i, code, url in bad:
                log(f"  - {i} ({code}) {url}")
            return 1
        log("[ok] 모든 상품 링크 200 (403/429 로 막힌 건은 경고로만 남김)")

    html = open(DEALS_PATH, encoding="utf-8").read()
    before_ids = set(re.findall(r'"id": "([^"]+)"', html))

    html, hit = replace_arrays(html, data)
    log(f"[ok] 배열 교체: travelDeals×{hit['travel']} kidsDeals×{hit['kids']} DEALS_SCAN_META×{hit['meta']}")
    html = update_sync_badge(html, data.get("scanned_at", ""),
                             (len(data["travelDeals"]), len(data["kidsDeals"])))

    errors = structural_checks(html)
    if errors:
        log("[FAIL] 구조/문법 검증 실패 — 파일을 쓰지 않습니다")
        for e in errors:
            log("  - " + e)
        return 1
    log("[ok] 구조 검증: <div> 밸런스 일치 · esprima 문법 에러 0 · 중복 ID 0")

    new_ids = set(re.findall(r'"id": "([^"]+)"', html))
    log(f"[info] 이전 등록 {len(before_ids)}건 → 이번 스캔 {len(new_ids)}건"
        f" (고정 상품은 브라우저 localStorage 에 남아 계속 표시됩니다)")

    if args.dry_run:
        log("[dry-run] 파일을 쓰지 않고 종료합니다")
        return 0

    with open(DEALS_PATH, "w", encoding="utf-8") as f:
        f.write(html)
    log(f"[ok] 저장: {DEALS_PATH}")

    if args.push:
        if git_push(args.push):
            log("[ok] GitHub Pages 푸시 완료")
        else:
            log("[FAIL] 푸시 실패")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
