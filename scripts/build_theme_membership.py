#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
네이버 증권 테마 전체(약 265개)의 구성종목을 모아 '종목 → 소속 테마' 색인을 만든다.

왜 필요한가
  · 체커(checker.html)가 "이 종목이 오늘 주도 테마인지"를 판정하려면 종목의 소속 테마를 알아야 한다.
  · 네이버 API 는 테마→종목(구성종목)만 주고, 종목→테마 역방향 API 가 없다.
  · 그래서 테마 목록(5페이지) + 테마별 구성종목(265회)을 한 번 모아 역색인을 만든다.
  · 테마 '구성'은 자주 바뀌지 않으므로 하루 1회(또는 필요할 때)만 갱신하면 충분하다.
    (매일 바뀌는 '테마 순위·등락률'은 API 가 실시간으로 네이버 랭킹을 읽어 계산한다.)

출력
  · data/theme-membership.json (양쪽 저장소 deploy_repo/data, sd_live/public/data)
    {
      "schema": "fox-theme-membership/v1",
      "updatedAt": "2026-11-22T10:00:00+09:00",
      "themeCount": 265,
      "stockCount": 1523,
      "themes": [{ "no": 506, "name": "탈모 치료", "stockCount": 29, "changeRate": "..." }],
      "byCode": { "180640": [{ "no": 70, "name": "한진그룹" }] }
    }

원칙
  · 응답에 있는 값만 쓴다. 실패한 테마는 errors 에 남기고 목록에서 뺀다(빈 테마를 만들지 않는다).
  · 스팩·ETF·우선주만으로 구성된 테마는 그대로 둔다(테마 이름을 바꾸지 않는다).
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": "https://m.stock.naver.com/",
}
THEME_LIST = "https://m.stock.naver.com/api/stocks/theme"
THEME_DETAIL = "https://m.stock.naver.com/api/stocks/theme/"
KST = timezone(timedelta(hours=9))


def get_json(url, timeout=12, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.4 * (i + 1))
    raise last


def list_themes(page_size=60):
    out = []
    page = 1
    while True:
        d = get_json(f"{THEME_LIST}?page={page}&pageSize={page_size}")
        groups = d.get("groups") or []
        out.extend(groups)
        total = int(d.get("totalCount") or 0)
        if not groups or len(out) >= total:
            break
        page += 1
        if page > 12:
            break
    return out


def theme_detail(no):
    d = get_json(f"{THEME_DETAIL}{no}?page=1&pageSize=100")
    stocks = d.get("stocks") or []
    info = d.get("groupInfo") or {}
    return {
        "no": no,
        "name": info.get("name") or "",
        "codes": [s.get("itemCode") for s in stocks if s and s.get("itemCode")],
        "names": {s.get("itemCode"): s.get("stockName") for s in stocks if s and s.get("itemCode")},
    }


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_paths = [
        os.path.join(root, "deploy_repo", "data", "theme-membership.json"),
        os.path.join(root, "sd_live", "public", "data", "theme-membership.json"),
    ]

    groups = list_themes()
    print(f"테마 목록: {len(groups)}개", flush=True)

    errors = []
    themes = []
    by_code = {}

    def work(g):
        no = g.get("no")
        try:
            return theme_detail(no)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{g.get('name')}({no}): {e}")
            return None

    with ThreadPoolExecutor(max_workers=8) as ex:
        for i, res in enumerate(ex.map(work, groups), 1):
            if i % 25 == 0:
                print(f"  {i}/{len(groups)} …", flush=True)
            if not res:
                continue
            if not res["codes"]:
                continue
            themes.append({"no": res["no"], "name": res["name"], "stockCount": len(res["codes"])})
            for code in res["codes"]:
                by_code.setdefault(code, []).append({"no": res["no"], "name": res["name"]})

    # 중복 제거(같은 테마가 두 번 들어오는 경우 방지)
    for code, lst in by_code.items():
        seen = set()
        uniq = []
        for t in lst:
            if t["no"] in seen:
                continue
            seen.add(t["no"])
            uniq.append(t)
        by_code[code] = uniq

    body = {
        "schema": "fox-theme-membership/v1",
        "updatedAt": datetime.now(KST).isoformat(timespec="seconds"),
        "source": "m.stock.naver.com 테마 목록 + 테마별 구성종목 (익명 공개 응답)",
        "themeCount": len(themes),
        "stockCount": len(by_code),
        "errors": errors[:20],
        "themes": sorted(themes, key=lambda t: t["no"]),
        "byCode": dict(sorted(by_code.items())),
    }
    text = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    for p in out_paths:
        if not os.path.isdir(os.path.dirname(p)):
            continue
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"저장: {p} ({len(text)/1024:.1f}KB)", flush=True)
    print(f"테마 {len(themes)} · 종목 {len(by_code)} · 실패 {len(errors)}", flush=True)
    if errors:
        print("실패 예:", errors[:3], flush=True)


if __name__ == "__main__":
    sys.exit(main())
