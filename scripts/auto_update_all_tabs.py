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
