#!/usr/bin/env python3
import re
import json
import urllib.request
import xml.etree.ElementTree as ET

def fetch_fchart_candles(code, count=120):
    url = f"https://fchart.stock.naver.com/sise.nhn?symbol={code}&timeframe=day&count={count}&requestType=0"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        resp = urllib.request.urlopen(req, timeout=10).read().decode('euc-kr', errors='ignore')
        root = ET.fromstring(resp)
        candles = []
        prev_close = None
        for item in root.findall('.//item'):
            parts = item.attrib['data'].split('|')
            if len(parts) >= 6:
                d_str = f"{parts[0][:4]}-{parts[0][4:6]}-{parts[0][6:8]}"
                o = int(parts[1])
                h = int(parts[2])
                l = int(parts[3])
                c = int(parts[4])
                v = int(parts[5])
                ratio = round(((c - prev_close) / prev_close) * 100, 2) if prev_close else 0.0
                prev_close = c
                candles.append({
                    "date": d_str,
                    "open": o,
                    "high": h,
                    "low": l,
                    "close": c,
                    "vol": v,
                    "ratio": ratio
                })
        return candles
    except Exception as e:
        print(f"Error fetching candles for {code}: {e}")
        return []

def main():
    html_path = "index.html"
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    # 1. Clean up ticker bar KOSPI & KOSDAQ
    # Look for \g<1> in ticker items
    ticker_kospi = (
        '<div class="ticker-item" style="cursor: pointer; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.03);" '
        'onclick="openIndexChart(\'코스피 (KOSPI)\', \'5,342.73pt (-0.61%)\', \'거래대금 14.8조 원\', '
        '\'외국인 +3,702억 순매수 vs 기관 -6,887억 차익 실현. 코스피 5,342선 마감.\', \'kospi\')">\n'
        '      <span class="label">코스피 📈</span><span class="val down">5,342.73 (-0.61%)</span>\n'
        '    </div>'
    )
    ticker_kosdaq = (
        '<div class="ticker-item" style="cursor: pointer; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.03);" '
        'onclick="openIndexChart(\'코스닥 (KOSDAQ)\', \'696.53pt (-1.22%)\', \'거래대금 11.2조 원\', '
        '\'개인 +3,078억 순매수 vs 외인 -3,527억 순매도. 코스닥 696선 마감.\', \'kosdaq\')">\n'
        '      <span class="label">코스닥 📈</span><span class="val down">696.53 (-1.22%)</span>\n'
        '    </div>'
    )

    # Replace broken ticker item 1 (kospi)
    html = re.sub(
        r'<div class="ticker-item"[^>]*onclick="openIndexChart\(\'코스피[\s\S]*?</div>',
        ticker_kospi,
        html,
        count=1
    )
    # Replace broken ticker item 2 (kosdaq)
    html = re.sub(
        r'<div class="ticker-item"[^>]*onclick="openIndexChart\(\'코스닥[\s\S]*?</div>',
        ticker_kosdaq,
        html,
        count=1
    )

    # 2. Clean up supply strip cards
    supply_frg = (
        '<div class="supply-card" style="cursor: pointer; padding: 5px 6px; display: flex; align-items: center; justify-content: space-between; overflow: hidden; white-space: nowrap;" '
        'onclick="openSupplyChart(\'코스피 외국인 누적 수급 추이\', \'코스피 외인 +3,702억 원 순매수\', \'외인 순매수 지속\', \'09:00 차익 출회 이후 순매수 전환, 15:30 외인 +3,702억 방어 마감.\', \'supply_flow\')">\n'
        '      <span class="title">외국인</span><span class="amount buy">+3,702억</span>\n'
        '    </div>'
    )
    supply_inst = (
        '<div class="supply-card" style="cursor: pointer; padding: 5px 6px; display: flex; align-items: center; justify-content: space-between; overflow: hidden; white-space: nowrap;" '
        'onclick="openSupplyChart(\'코스피 기관 누적 수급 추이\', \'코스피 기관 -6,887억 원 순매도\', \'옵션만기 차익 출회\', \'금융투자 -7,450억 차익 매물 출회 속 연기금 +820억 방어.\', \'supply_flow\')">\n'
        '      <span class="title">기관</span><span class="amount sell">-6,887억</span>\n'
        '    </div>'
    )
    html = re.sub(
        r'<div class="supply-card"[^>]*onclick="openSupplyChart\(\'코스피 외국인 누적 수급 추이[\s\S]*?</div>',
        supply_frg,
        html,
        count=1
    )
    html = re.sub(
        r'<div class="supply-card"[^>]*onclick="openSupplyChart\(\'코스피 기관 누적 수급 추이[\s\S]*?</div>',
        supply_inst,
        html,
        count=1
    )

    # 3. Clean up supply tab cards (ssc-top \g<1> replacement)
    # The pattern in supply cards is:
    # <!-- 종목명 -->\s*<div class="supply-stock-card"[^>]*>\s*<div class="ssc-top">\\g<1>([^<]+)</div>
    def fix_ssc_top(m):
        comment_name = m.group(1).strip()
        val = m.group(2).strip()
        # Clean val from extra tags
        val = re.sub(r'</span>\s*\)\s*</span>', '', val).strip()
        val = re.sub(r'</span>', '', val).strip()
        # Determine up or down
        cls = "up" if "+" in val else "down"
        return f'<!-- {comment_name} -->\n          <div class="supply-stock-card"{m.group(3)}>\n            <div class="ssc-top"><span class="ssc-name">{comment_name}</span><span class="ssc-price {cls}">{val}</span></div>'

    html = re.sub(
        r'<!-- ([^>]+) -->\s*<div class="supply-stock-card"([^>]*)>\s*<div class="ssc-top">\s*\\g<1>([^<]+(?:</span>\)*)?)</div>',
        fix_ssc_top,
        html
    )

    # Clean any remaining \g<1>
    remaining_g = re.findall(r'\\g<[0-9]+>', html)
    print(f"Remaining \\g<1> count after initial pass: {len(remaining_g)}")
    if remaining_g:
        # Check where they are
        for m in re.finditer(r'.{0,50}\\g<[0-9]+>.{0,50}', html):
            print(f"Found dangling g: {m.group(0)}")

    # 4. Fetch and update RAW_STOCKS (RNZone) with today's 2026-11-12 candles
    rn_stocks_info = [
        {"name": "삼성SDI", "code": "006400", "category": "upper", "upperRN": 500000, "lowerRN": 300000},
        {"name": "삼성바이오로직스", "code": "207940", "category": "upper", "upperRN": 1500000, "lowerRN": 1000000},
        {"name": "삼성물산", "code": "028260", "category": "upper", "upperRN": 300000, "lowerRN": 200000},
        {"name": "기아", "code": "000270", "category": "upper", "upperRN": 100000, "lowerRN": 75000},
        {"name": "SK스퀘어", "code": "402340", "category": "near_lower", "upperRN": 1000000, "lowerRN": 750000},
        {"name": "리노공업", "code": "058470", "category": "near_lower", "upperRN": 75000, "lowerRN": 50000},
        {"name": "원익IPS", "code": "240810", "category": "near_lower", "upperRN": 100000, "lowerRN": 75000},
        {"name": "하나마이크론", "code": "067310", "category": "touch_lower", "upperRN": 40000, "lowerRN": 30000},
        {"name": "피에스케이홀딩스", "code": "031980", "category": "touch_lower", "upperRN": 200000, "lowerRN": 150000},
        {"name": "SK하이닉스", "code": "000660", "category": "touch_lower", "upperRN": 1500000, "lowerRN": 1200000},
        {"name": "카카오뱅크", "code": "323410", "category": "touch_lower", "upperRN": 40000, "lowerRN": 30000}
    ]

    new_raw_stocks = []
    for info in rn_stocks_info:
        candles = fetch_fchart_candles(info["code"], count=100)
        if not candles:
            print(f"Warning: Failed to fetch candles for {info['name']}")
            continue
        latest = candles[-1]
        p = latest["close"]
        r = latest["ratio"]
        buy1 = int(info["lowerRN"] * 1.04)
        buy2 = int(buy1 * 0.80)
        tgt_min = int(buy1 * 1.07)
        tgt_max = int(buy1 * 1.20)
        new_raw_stocks.append({
            "name": info["name"],
            "code": info["code"],
            "category": info["category"],
            "price": p,
            "changeRatio": r,
            "upperRN": info["upperRN"],
            "lowerRN": info["lowerRN"],
            "buy1": buy1,
            "buy2": buy2,
            "targetMin": tgt_min,
            "targetMax": tgt_max,
            "candles": candles
        })
        print(f"Fetched {info['name']} latest candle: {latest['date']} close={p} ({r:+.2f}%)")

    # Replace RAW_STOCKS in html
    raw_stocks_json = json.dumps(new_raw_stocks, ensure_ascii=False)
    html = re.sub(
        r'const RAW_STOCKS = \[[\s\S]*?\];\s*let currentCategory',
        lambda m: f"const RAW_STOCKS = {raw_stocks_json};\n        let currentCategory",
        html,
        count=1
    )

    # 5. Fetch and update STOCKS (Jongbe Master) with today's 2026-11-12 candles
    jongbe_info = [
        {"name": "주성엔지니어링", "code": "036930", "track": "shin", "reason": "코스닥 압도적 1위 거래대금 3,752억 유입! 옵션만기 기관 차익 매물을 168,000원 지지선에서 성공적으로 흡수하며 장마감.", "entry": "15:18~15:20 170,000원 지지 확인 후 종가(170,800원) 진입.", "target": "익일 09:00 시초가 갭 +3% 분할 익절 (176,000~178,000원)", "stop": "핵심 지지선 168,000원 이탈 시 칼손절", "badge": "⚡ 신정재: 3,750억 코스닥 대금 1위"},
        {"name": "코리아써키트", "code": "007810", "track": "shin", "reason": "정부 1조 CXL 인터페이스 투자 및 반도체 수출 호조 속 2,760억 대량 거래대금 유입 양봉 마감.", "entry": "15:18~15:20 매도 잔량 우위 확인 후 종가(88,200원) 진입.", "target": "익일 시초가 +5~8% (93,000~95,000원)", "stop": "85,000원 이탈 시 칼손절", "badge": "⚡ 신정재: 2,760억 CXL 기판 대장"},
        {"name": "심텍", "code": "222800", "track": "shin", "reason": "거래대금 3,343억 폭발. FC-BGA 및 패키징 기판 가동률 턴어라운드 장대양봉 안착.", "entry": "15:19 마감 동시호가 직전 종가(122,900원) 진입.", "target": "128,000~130,000원 (+5~7%)", "stop": "118,000원 이탈 시 칼손절", "badge": "⚡ 신정재: 3,340억 PCB 실질 대금 1위"},
        {"name": "티엘비", "code": "356860", "track": "shin", "reason": "CXL 2.0 메모리 기판 대장주. 2,048억 대량 자금 흡수하며 +7.97% 2차 시세 분출 안착.", "entry": "눌림목 확인 후 종가(41,300원) 진입.", "target": "44,500~46,000원 (+8~11%)", "stop": "39,500원 이탈 시 칼손절", "badge": "⚡ 신정재: 2,048억 CXL 2차 분출"},
        {"name": "에코프로비엠", "code": "247540", "track": "shin", "reason": "코스닥 2차전지 반등 속 기관 숏커버링 매수 유입, 윗꼬리 억제된 양봉 마감.", "entry": "15:18 저점 지지 확인 후 종가 진입.", "target": "익일 시초가 +3~5%", "stop": "당일 저가 이탈 시 칼손절", "badge": "⚡ 신정재: 1,850억 2차전지 반등"},
        {"name": "한화에어로스페이스", "code": "012450", "track": "kang", "reason": "신고가 장대양봉 이후 4거래일 연속 음봉 조정(4음 출현). 거래량이 직전 대비 1/4 토막으로 세력 이탈 전무.", "entry": "20일선 지지 확인 후 15:10 양봉 종가 매수.", "target": "전고점 돌파 +20~30% 대시세 추종", "stop": "20일선 최종 이탈 시 칼손절", "badge": "🏆 강창권: 4음 1양 완벽 눌림목"},
        {"name": "LIG넥스원", "code": "079550", "track": "kang", "reason": "이라크 천궁-II 수출 모멘텀 및 3분기 호실적 반영 후 5일간 완만한 눌림목 조정.", "entry": "5일선 회복 양봉 확인 후 종가 매수.", "target": "+15~25% 스윙 홀딩", "stop": "직전 저점 이탈 시 손절", "badge": "🏆 강창권: 방산 대장 눌림목"},
        {"name": "와이지엔터테인먼트", "code": "122870", "track": "kang", "reason": "베이비몬스터 글로벌 투어 모멘텀 속 20일선 지지 4일 음봉 후 첫 반등 양봉 출현.", "entry": "종가(15:15) 분할 매수 진입.", "target": "+15~20% 전고점 회복", "stop": "20일선 이탈 시 손절", "badge": "🏆 강창권: 엔터 바닥 턴어라운드"},
        {"name": "파마리서치", "code": "214450", "track": "kang", "reason": "리쥬란 글로벌 수출 고성장 지속 속 외국인 대량 매집 후 4음봉 숨고르기 완성.", "entry": "20일선 반등 양봉 시 종가 진입.", "target": "+20% 신고가 갱신", "stop": "20일선 이탈 시 손절", "badge": "🏆 강창권: 의료기기 1위 눌림목"},
        {"name": "리가켐바이오", "code": "141080", "track": "kang", "reason": "ADC 플랫폼 기술수출 기대감 속 거래량 급감 5일선 지지 양봉 반등 성공.", "entry": "15:10 종가 진입.", "target": "+20~30% 스윙", "stop": "5일선 이탈 시 손절", "badge": "🏆 강창권: 바이오 대장 눌림목"}
    ]

    new_jongbe_stocks = []
    for info in jongbe_info:
        candles = fetch_fchart_candles(info["code"], count=100)
        if not candles:
            print(f"Warning: Failed to fetch candles for {info['name']}")
            continue
        latest = candles[-1]
        p = latest["close"]
        r = latest["ratio"]
        new_jongbe_stocks.append({
            "name": info["name"],
            "code": info["code"],
            "track": info["track"],
            "price": p,
            "changeRatio": r,
            "candles": candles,
            "reason": info["reason"],
            "entry": info["entry"],
            "target": info["target"],
            "stop": info["stop"],
            "badge": info["badge"]
        })
        print(f"Fetched Jongbe {info['name']} latest candle: {latest['date']} close={p} ({r:+.2f}%)")

    jongbe_json = json.dumps(new_jongbe_stocks, ensure_ascii=False)
    html = re.sub(
        r'const STOCKS = \[[\s\S]*?\];\s*let currentTrack',
        lambda m: f"const STOCKS = {jongbe_json};\n    let currentTrack",
        html,
        count=1
    )

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print("rebuild_all_tabs_clean: index.html updated successfully!")

if __name__ == "__main__":
    main()
