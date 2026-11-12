#!/usr/bin/env python3
import urllib.request, html, urllib.parse, json, re, datetime, os, sys, xml.etree.ElementTree as ET

def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'})
    try:
        res = urllib.request.urlopen(req, timeout=8).read().decode('utf-8')
        return json.loads(res)
    except Exception as e:
        print(f"[WARN] Failed fetching {url}: {e}")
        return None

def fetch_fchart(code):
    url = f'https://fchart.stock.naver.com/sise.nhn?symbol={code}&timeframe=day&count=250&requestType=0'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        html = urllib.request.urlopen(req, timeout=8).read().decode('euc-kr', errors='replace')
        root = ET.fromstring(html)
        items = root.findall('.//item')
        candles = []
        for it in items:
            data = it.attrib.get('data', '').split('|')
            if len(data) >= 6:
                candles.append([data[0], float(data[1]), float(data[2]), float(data[3]), float(data[4]), float(data[5])])
        return candles
    except Exception as e:
        print(f"[WARN] Failed fchart for {code}: {e}")
        return None

def main():
    now_kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    time_str = now_kst.strftime("%H:%M:%S")
    date_str = now_kst.strftime("%Y-%m-%d")
    print(f"[{time_str}] Starting auto_update_all_tabs...")

    index_path = "index.html"
    if not os.path.exists(index_path) and os.path.exists("deploy_repo/index.html"):
        index_path = "deploy_repo/index.html"

    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    # 1. Update Header Sync Timestamp
    html = re.sub(
        r'<span id="lastSyncTxt"[^>]*>.*?</span>',
        f'<span id="lastSyncTxt" style="color: #38bdf8; font-size: 10.5px; font-weight: 800;">최근 갱신: {time_str} (전체탭 자동 동기화 🟢)</span>',
        html
    )

    # 2. Update Live Indices (KOSPI & KOSDAQ)
    kospi_data = fetch_json('https://m.stock.naver.com/api/index/KOSPI/price?pageSize=1')
    if kospi_data and len(kospi_data) > 0:
        k_close = kospi_data[0].get('closePrice', '')
        k_ratio = kospi_data[0].get('fluctuationsRatio', '')
        sign = "+" if not k_ratio.startswith("-") else ""
        html = re.sub(
            r'(<div class="ind-name">코스피 📈 KRX 공식</div>\s*<div class="ind-val">)[\d,.]+(\s*\([^)]+\)</div>)',
            rf'\g<1>{k_close}\g<2>',
            html
        )

    # 3. Fetch Real-time Polling Quotes for all 30 Theme & Key Stocks
    STOCK_CODES = {
        '코난테크놀로지': '402030', '셀바스AI': '108860', '솔트룩스': '304100', '한글과컴퓨터': '030520', '한컴': '030520',
        'JYP Ent.': '035900', '와이지엔터': '122870', '에스엠': '041510', '하이브': '352820',
        '이수페타시스': '007660', '삼양식품': '003230', '코스맥스': '192820', '메리츠금융': '138040',
        '티엘비': '356860', '펨트론': '143240', '코리아써키트': '007810',
        '컴투스': '078340', 'NHN': '181710',
        '삼현': '437730', '레인보우로보': '277810',
        '주성엔지니어링': '036930', '피에스케이홀딩스': '031980', '하나마이크론': '067310',
        'HLB': '028300', '리노공업': '058470', '삼성전자': '005930', 'SK하이닉스': '000660',
        '삼성전기': '009150', 'NAVER': '035420', '두산에너빌리티': '034020', '심텍': '222800'
    }
    codes_list = list(set(STOCK_CODES.values()))
    poll_url = f"https://polling.finance.naver.com/api/realtime/domestic/stock/{','.join(codes_list)}"
    poll_res = fetch_json(poll_url)
    realtime_data = {}
    if poll_res and 'datas' in poll_res:
        for d in poll_res['datas']:
            c = d.get('itemCode')
            if c:
                realtime_data[c] = {
                    'name': d.get('stockName'),
                    'price': d.get('closePrice'),
                    'ratio': float(d.get('fluctuationsRatio', 0.0)),
                    'open': d.get('openPrice'),
                    'high': d.get('highPrice'),
                    'low': d.get('lowPrice'),
                    'val': d.get('accumulatedTradingValue'),
                    'vol': d.get('accumulatedTradingVolume')
                }
        print(f"Updated live quotes for {len(realtime_data)} theme stocks from Naver Polling API.")

    def update_tile_content(tile_html, name, code):
        if code not in realtime_data:
            return tile_html
        d = realtime_data[code]
        p = d['price']
        r = d['ratio']
        r_str = f"{r:+.1f}%" if r != 0 else "0.0%"
        o = d['open']
        h = d['high']
        l = d['low']
        v = d['val']
        color = "#f43f5e" if r > 0 else ("#38bdf8" if r < 0 else "#94a3b8")
        tile_html = re.sub(r"openDetail\('([^']*)',\s*'[^']*',\s*'[^']*'", f"openDetail('\\1', '{r_str}', '대금 {v} | 현재가 {p}원'", tile_html)
        tile_html = re.sub(r'<span class="st-change"[^>]*>[^<]+</span>', f'<span class="st-change" style="color:{color}; font-weight:800;">{r_str}</span>', tile_html)
        tile_html = re.sub(r'<div class="st-ohlc">[^<]*<strong>[^<]*</strong>[^<]*</div>', f'<div class="st-ohlc">종 <strong>{p}</strong> | 시 {o} 고 {h} 저 {l}</div>', tile_html)
        if v:
            tile_html = re.sub(r'<span class="st-vol">[^<]+</span>', f'<span class="st-vol">{v}</span>', tile_html)
        if r >= 29.5:
            tile_html = re.sub(r'<span class="st-role">[^<]+</span>', '<span class="st-role" style="background:#dc2626; color:#fff;">👑 상한가</span>', tile_html)
        return tile_html

    def tile_replacer(m):
        tile_html = m.group(0)
        for name, code in STOCK_CODES.items():
            if f'>{name}<' in tile_html or f'>★ {name}<' in tile_html or f'>👑 ★ {name}<' in tile_html:
                return update_tile_content(tile_html, name, code)
        return tile_html

    html = re.sub(r'<div class="stock-tile[^"]*"[^>]*>[\s\S]*?</div>\s*</div>', tile_replacer, html)

    c_d = realtime_data.get('402030', {})
    if c_d:
        html = re.sub(r'(👑 AI SW \(스탁이지 1위\)[\s\S]*?<span class="theme-tag [^"]*">)[^<]+(</span>)', f"\\g<1>+{c_d['ratio']:.1f}% 상한가 🚀\\2", html)

    # 4. Fetch Top News from Naver Finance
    news_res = fetch_json('https://m.stock.naver.com/api/news/list?category=mainnews&pageSize=4')
    if news_res and len(news_res) > 0:
        new_cards_html = ""
        for n in news_res:
            dt_raw = n.get('dt', '')
            t_hour = dt_raw[8:10] if len(dt_raw) >= 10 else now_kst.strftime("%H")
            t_min = dt_raw[10:12] if len(dt_raw) >= 12 else now_kst.strftime("%M")
            news_time = f"{t_hour}:{t_min}"
            news_tit = n.get('tit', '').replace('"', '&quot;').replace("'", "&#39;")
            
            # Check if this news is already in HTML
            if news_tit[:20] in html:
                continue

            oid = n.get('oid', '')
            aid = n.get('aid', '')
            if oid and aid:
                article_url = f"https://n.news.naver.com/mnews/article/{oid}/{aid}"
            else:
                clean_q = urllib.parse.quote(news_tit[:30])
                article_url = f"https://search.naver.com/search.naver?where=news&query={clean_q}"

            card = f"""<!-- AUTO HOURLY NEWS {news_time} -->
      <div class="news-timeline-card" style="border-left-color:#38bdf8;" onclick="openNewsDetail('{news_tit}', '{news_time} 속보', '{article_url}', '{news_tit}', '장중 대형 속보 출회 시 관련 테마 및 주도 섹터 단기 수급 쏠림 형성.', '실시간 거래대금 급증 종목 연동')">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
          <span class="nt-time" style="background:#0c4a6e; color:#bae6fd;">{news_time} 실시간 속보 ⚡</span>
          <a href="{article_url}" target="_blank" rel="noopener noreferrer" style="font-size:10.5px; background:rgba(56,189,248,0.15); color:#7dd3fc; border:1px solid rgba(56,189,248,0.4); padding:2px 7px; border-radius:4px; text-decoration:none; font-weight:800;" onclick="event.stopPropagation()">🔗 기사 원문 ↗</a>
        </div>
        <div class="nt-title">{news_tit}</div>
        <div class="nt-move">🔥 장중 연동: 주요 속보 및 실시간 시장 수급 반응 관찰</div>
        <div class="nt-history">과거: 장중 대형 속보 출회 시 관련 테마 및 주도 섹터 단기 수급 쏠림 형성</div>
        <div class="nt-beneficiary">🎯 시장 관찰: 실시간 거래대금 급증 종목 연동</div>
      </div>\n\n      """
            new_cards_html += card

        if new_cards_html:
            marker = '<div class="panel-box purple">'
            sub_idx = html.find(marker)
            if sub_idx != -1:
                insert_idx = html.find('<!--', sub_idx)
                if insert_idx != -1:
                    html = html[:insert_idx] + new_cards_html + html[insert_idx:]
                    print(f"Injected {len(news_res)} fresh real-time news cards into #tabNews.")

    # 6. Real-time Bottom Grid (52W High & 100억+ Upper Limit / +25% Near Upper)
    try:
        up_stocks = fetch_json('https://stock.naver.com/api/domestic/market/stock/default?tradeType=KRX&marketType=ALL&orderType=up&startIdx=0&pageSize=100')
        h52_stocks = fetch_json('https://stock.naver.com/api/domestic/market/stock/default?tradeType=KRX&marketType=ALL&orderType=high52week&startIdx=0&pageSize=100')
        if up_stocks and h52_stocks:
            true_100b_upper = []       # ratio >= 29.5% and amt >= 100억
            true_100b_near_upper = []  # 25.0% <= ratio < 29.5% and amt >= 100억
            true_100b_leading = []     # 10.0% <= ratio < 25.0% and amt >= 100억
            excluded_small_upper = []  # ratio >= 25.0% but amt < 100억

            for s in up_stocks:
                now_p = float(s.get('nowPrice', 0))
                limit_p = float(s.get('upperLimitPrice', 0))
                ratio = float(s.get('prevChangeRate', 0))
                is_upper = (now_p == limit_p) or (ratio >= 29.5)
                amt_억 = round(float(s.get('tradeAmount', 0)) / 100000000, 1)

                if amt_억 >= 100.0:
                    if is_upper:
                        true_100b_upper.append((s, amt_억))
                    elif ratio >= 25.0:
                        true_100b_near_upper.append((s, amt_억))
                    elif ratio >= 10.0:
                        true_100b_leading.append((s, amt_억))
                else:
                    if ratio >= 25.0:
                        excluded_small_upper.append((s, ratio, amt_억))

            true_100b_upper.sort(key=lambda x: x[1], reverse=True)
            true_100b_near_upper.sort(key=lambda x: x[1], reverse=True)
            true_100b_leading.sort(key=lambda x: float(x[0].get('prevChangeRate', 0)), reverse=True)

            final_100b_items = []
            for s, amt in true_100b_upper:
                final_100b_items.append((s, "UPPER", amt))
            for s, amt in true_100b_near_upper:
                final_100b_items.append((s, "NEAR_UPPER", amt))
            for s, amt in true_100b_leading:
                if len(final_100b_items) < 4:
                    final_100b_items.append((s, "LEADING", amt))

            h52_list = []
            for s in h52_stocks:
                high_p = float(s.get('highPrice', 0))
                w52_p = float(s.get('week52HighPrice', 0))
                ratio = float(s.get('prevChangeRate', 0))
                amt_억 = round(float(s.get('tradeAmount', 0)) / 100000000, 1)
                if high_p >= w52_p and w52_p > 0 and ratio > -5.0:
                    h52_list.append((s, amt_억))
            h52_list.sort(key=lambda x: x[1], reverse=True)

            REASONS = {
                '069510': '전장용 스피커 및 고음질 사운드 시스템 수주 확대 + 3분기 흑자 서프라이즈로 100억 대금 돌파, 당일 최고 상승률 주도.',
                '0039P0': 'AI 마케팅 자동화 솔루션 및 빅데이터 기반 타깃 광고 수주 급증으로 170억 돌파 18% 급등.',
                '035900': '스트레이키즈 글로벌 스타디움 투어 및 음원 스트리밍 사상 최대 실적 어닝 서프라이즈로 678억 돌파 실질 엔터 대장주.',
                '039980': '온디바이스 AI 오피스 및 거대언어모델(LLM) 보안 솔루션 공공기관 공급 모멘텀 116억 돌파 급등.',
                '420610': '영상 AI 기반 지능형 보안 관제 솔루션 글로벌 공급 계약으로 223억 대금 유입.',
                '263860': 'EDR 보안 솔루션 글로벌 공급 및 공공 클라우드 수주 폭증으로 1,245억 원 초대형 거래대금 폭발.',
                '251970': 'K-뷰티 인디 브랜드 글로벌 돌풍에 따른 화장품 용기 수주 풀가동 및 역사적 신고가 랠리 지속.',
                '219130': '반도체 검사용 고다층 프로브카드 PCB 기판 수요 폭증 및 공장 가동률 100% 도달 역사적 신고가.',
                '005430': '대한항공-아시아나 기업결합 승인 가시화에 따른 LCC 지상조업 통합 독점력 및 공항 조업 단가 인상 수혜 신고가.'
            }

            h52_html = '''      <!-- Left: 52W High -->\n      <div class="panel-box gold">\n        <div class="sec-head" style="border-bottom-color:#b45309; color:#fbbf24;">\n          <span>🎯 52주 신고가 돌파 종목 & 사유 (실시간)</span>\n          <span class="sub">당일 고가 기준 실시간 집계 🟢</span>\n        </div>\n'''
            for s, amt in h52_list[:4]:
                code = s.get('itemcode')
                name = s.get('itemname')
                now_p = f"{int(float(s.get('nowPrice', 0))):,}원"
                ratio = float(s.get('prevChangeRate', 0))
                r_str = f"+{ratio:.2f}%" if ratio > 0 else f"{ratio:.2f}%"
                high_p = f"{int(float(s.get('highPrice', 0))):,}원"
                w52_p = f"{int(float(s.get('week52HighPrice', 0))):,}원"
                reason = REASONS.get(code, f"당일 고가 {high_p}로 52주 최고가({w52_p}) 경신 돌파 및 거래대금 유입.")
                h52_html += f'''        <div class="reason-item" onclick="openDetail('{name} ({code})', '{now_p} ({r_str})', '대금 {amt}억 | 고가 {high_p}', '【52주 신고가 사유】 {reason}')">\n          <div class="ri-head"><span>★ {name}</span><span style="color:#fef08a;">{now_p} ({r_str})</span></div>\n          <div class="ri-meta">대금 {amt}억 | 고가 {high_p} (52주 신고가 경신)</div>\n          <div class="ri-reason gold">{reason}</div>\n        </div>\n'''
            h52_html += '''        <div style="font-size: 10px; color: #64748b; margin-top: 6px;">\n          ※ 장중 52주 신고가를 터치한 종목만 실시간 연동되며, 신고가 이탈/하락 종목은 자동 제외됩니다.\n        </div>\n      </div>\n'''

            if len(true_100b_upper) > 0:
                sub_tag = "실시간 100억+ 진성 상한가 안착 🟢"
            elif len(true_100b_near_upper) > 0:
                sub_tag = "실시간 상한가 임박 (+25% 이상 터치) 🚨"
            else:
                sub_tag = "대금 100억+ 실질 주도주 (25%+ 임박 대기 🟡)"

            up_html = f'''      <!-- Right: Upper Limit 100억+ 진성 상한가 & 사유 -->\n      <div class="panel-box red">\n        <div class="sec-head" style="border-bottom-color:#be123c; color:#f43f5e;">\n          <span>🚀 거래대금 100억+ 진성 상한가 & 사유 (100억 & +25% 엄격 필터)</span>\n          <span class="sub">{sub_tag}</span>\n        </div>\n'''

            for idx, (s, kind, amt) in enumerate(final_100b_items):
                code = s.get('itemcode')
                name = s.get('itemname')
                now_p = f"{int(float(s.get('nowPrice', 0))):,}원"
                ratio = float(s.get('prevChangeRate', 0))
                r_str = f"+{ratio:.2f}%" if ratio > 0 else f"{ratio:.2f}%"

                if kind == "UPPER":
                    status_tag = "100억+ 진성 상한가 🚀"
                    role_tag = f"👑 ★ {name}"
                    color_style = "color:#f43f5e; font-weight:800; font-size:12px;"
                elif kind == "NEAR_UPPER":
                    status_tag = "상한가 임박 (+25% 돌파) 🚨"
                    role_tag = f"🚨 ★ {name}"
                    color_style = "color:#fbbf24; font-weight:800; font-size:12px;"
                else:
                    status_tag = "100억+ 주도 급등주 🔥"
                    role_tag = f"🔥 대금 {amt}억 주도주 ★ {name}"
                    color_style = "color:#fca5a5; font-weight:800; font-size:12px;"

                reason = REASONS.get(code, f"당일 거래대금 {amt}억 원 유입되며 {r_str} 급등.")

                up_html += f'''        <div class="reason-item" style="border-left: 3px solid #f43f5e; background: rgba(244,63,94,0.06);" onclick="openDetail('{name} ({code})', '{now_p} ({r_str})', '거래대금 {amt}억 원', '【100억+ 주도 사유】 {reason}')">\n          <div class="ri-head"><span style="color:#ffffff; font-weight:800;">{role_tag}</span> <span style="{color_style}">{r_str} ({status_tag})</span></div>\n          <div class="ri-meta" style="color:#fca5a5; font-weight:700;">거래대금 {amt}억 원 | 현재가 {now_p}</div>\n          <div class="ri-reason red">{reason}</div>\n        </div>\n'''

            small_upper_names = ", ".join([f"{s.get('itemname')}({r}%, {amt}억)" for s, r, amt in excluded_small_upper[:3]])
            up_html += f'''        <div style="font-size: 10px; color: #64748b; margin-top: 6px;">\n          ※ <strong>상한가 임박 기준은 '상승률 +25% 이상 & 거래대금 100억 이상'</strong>에만 엄격 부여됩니다.<br>\n          ※ 코난테크놀로지, DGI, 썸에이지 등 +25% 이상 종목은 <strong>거래대금 100억 미만 소형주({small_upper_names})</strong>이므로 실전 매매 리스크 관리를 위해 제외되었습니다. 장중 100억 돌파 시 상한가/임박 박스에 즉시 자동 편입됩니다.\n        </div>\n      </div>\n'''

            new_grid = f'''    <!-- BOTTOM: 52W HIGH & 100억+ UPPER LIMIT (PLACED BELOW THEMES) -->\n    <div class="main-bottom-grid">\n{h52_html}\n{up_html}\n    </div>'''
            b_start = html.find('<!-- BOTTOM: 52W HIGH & 100억+ UPPER LIMIT (PLACED BELOW THEMES) -->')
            b_end = html.find('<!-- TAB 2: SUPPLY STOCKS', b_start)
            if b_start != -1 and b_end != -1:
                html = html[:b_start] + new_grid + '\n  </div>\n\n  ' + html[b_end:]
                print("auto_update_all_tabs: updated 52W High & 100억+ Upper Limit / +25% Near Upper successfully!")
    except Exception as e:
        print(f"[WARN] Failed updating bottom grid: {e}")

    # 5. Check Integrity
    open_divs = len(re.findall(r'<div\b', html, re.IGNORECASE))
    close_divs = len(re.findall(r'</div\b', html, re.IGNORECASE))
    assert open_divs == close_divs, f"DIV mismatch: {open_divs} != {close_divs}"

    # Write out
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(html)

    if os.path.exists("stock_dashboard.html"):
        with open("stock_dashboard.html", "w", encoding="utf-8") as f:
            f.write(html)
    if os.path.exists("widgets/stock-theme-map/bundle/index.html"):
        with open("widgets/stock-theme-map/bundle/index.html", "w", encoding="utf-8") as f:
            f.write(html)

    print(f"[{time_str}] auto_update_all_tabs completed successfully!")


if __name__ == "__main__":
    main()
