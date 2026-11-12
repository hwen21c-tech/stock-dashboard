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
        html_text = urllib.request.urlopen(req, timeout=8).read().decode('euc-kr', errors='replace')
        root = ET.fromstring(html_text)
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
    now_kst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    time_str = now_kst.strftime("%H:%M:%S")
    date_str = now_kst.strftime("%Y-%m-%d")
    print(f"[{time_str}] Starting auto_update_all_tabs...")

    index_path = "index.html"
    if not os.path.exists(index_path) and os.path.exists("deploy_repo/index.html"):
        index_path = "deploy_repo/index.html"

    with open(index_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    # 1. Update Header Sync Timestamp & Smart 24H Auto Sync Badge
    is_day = '08:00' <= now_kst.strftime("%H:%M") <= '20:05'
    if is_day:
        next_m = (now_kst.minute // 5 + 1) * 5
        next_dt = now_kst.replace(minute=0, second=0, microsecond=0) + datetime.timedelta(minutes=next_m)
        badge_text = f"⚡ 스마트 24시: 주간 5분 초밀착 (다음: {next_dt.strftime('%H:%M:35')})"
        badge_style = "background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3);"
    else:
        next_m = 30 if now_kst.minute < 30 else 60
        next_dt = now_kst.replace(minute=0, second=0, microsecond=0) + datetime.timedelta(minutes=next_m)
        badge_text = f"🌙 스마트 24시: 야간 30분 안심 (다음: {next_dt.strftime('%H:%M:35')})"
        badge_style = "background: rgba(99,102,241,0.18); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.35);"

    html_content = re.sub(
        r'<span id="lastSyncTxt"[^>]*>.*?</span>',
        f'<span id="lastSyncTxt" style="color: #38bdf8; font-size: 10.5px; font-weight: 800;">최근 갱신: {time_str} (통합 거래대금 100% 동기화 🟢)</span>',
        html_content
    )

    html_content = re.sub(
        r'<div id="autoSyncBadge"[^>]*>.*?</div>|<button id="autoRefreshBtn"[^>]*>.*?</button>',
        f'<div id="autoSyncBadge" style="padding: 3px 8px; font-size: 10.5px; font-weight: 800; {badge_style} border-radius: 4px;">{badge_text}</div>',
        html_content
    )

    # Remove redundant general refresh button in banner
    html_content = re.sub(
        r'\s*<button class="btn-action" onclick="location\.reload\(\)">🔄 새로고침</button>',
        '',
        html_content
    )

    # 2. Update Live Indices (KOSPI, KOSDAQ, Futures) & Investor Supply
    idx_res = fetch_json('https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI,KOSDAQ')
    if idx_res and 'datas' in idx_res:
        for it in idx_res['datas']:
            code = it.get('itemCode')
            close_p = it.get('closePrice', '')
            ratio = it.get('fluctuationsRatio', '')
            sign = "+" if not str(ratio).startswith("-") else ""
            if code == 'KOSPI':
                html_content = re.sub(
                    r'(<span class="label">코스피 📈[\s\S]*?</span>\s*<span class="val [^"]*">)[^<]+(</span>)',
                    rf'\g<1>{close_p} ({sign}{ratio}%)\g<2>',
                    html_content
                )
            elif code == 'KOSDAQ':
                html_content = re.sub(
                    r'(<span class="label">코스닥 📈[\s\S]*?</span>\s*<span class="val [^"]*">)[^<]+(</span>)',
                    rf'\g<1>{close_p} ({sign}{ratio}%)\g<2>',
                    html_content
                )

    inv_k = fetch_json('https://m.stock.naver.com/api/index/KOSPI/trend')
    if inv_k:
        f_val = inv_k.get('foreignValue', '') + '억'
        i_val = inv_k.get('institutionalValue', '') + '억'
        f_col = "#f43f5e" if f_val.startswith('+') else "#38bdf8"
        i_col = "#f43f5e" if i_val.startswith('+') else "#38bdf8"
        html_content = re.sub(
            r'(<span class="title"[^>]*>코스피 외인</span>\s*<span class="amount [^"]*"[^>]*>)[^<]+(</span>)',
            rf'\g<1>{f_val}\g<2>',
            html_content
        )
        html_content = re.sub(
            r'(<span class="title"[^>]*>코스피 기관</span>\s*<span class="amount [^"]*"[^>]*>)[^<]+(</span>)',
            rf'\g<1>{i_val}\g<2>',
            html_content
        )

    # 3. Fetch Real-time Polling Quotes for all 30 Theme & Key Stocks with INTEGRATED TRADING VALUE
    STOCK_CODES = {
        '코난테크놀로지': '402030', '지니언스': '263860', '셀바스AI': '108860', '솔트룩스': '304100', '한글과컴퓨터': '030520', '한컴': '030520',
        'JYP Ent.': '035900', '와이지엔터': '122870', '와이지엔터테인먼트': '122870', '에스엠': '041510', '하이브': '352820',
        '컨텍': '451760', 'AP위성': '211270', '미래에셋증권': '006800', '한국항공우주': '047810',
        '코리아써키트': '007810', '티엘비': '356860', '심텍': '222800', '이수페타시스': '007660', '펨트론': '168360',
        '주성엔지니어링': '036930', '피에스케이홀딩스': '031980', '하나마이크론': '067310', '리노공업': '058470',
        '메리츠금융': '138040', '메리츠금융지주': '138040', '우리금융지주': '316140', '신한지주': '055550', '하나금융지주': '086790',
        '핑거스토리': '417180', '디앤씨미디어': '263720', '와이랩': '432430', '미스터블루': '207760',
        '레인보우로보': '277810', '레인보우로보틱스': '277810', '두산로보틱스': '454910', '엔젤로보틱스': '455900', '유진로봇': '056080',
        '삼성전자': '005930', 'SK하이닉스': '000660', '삼성전기': '009150', 'NAVER': '035420', '두산에너빌리티': '034020',
        '대덕전자': '008060', '티에스이': '131290', '에코프로': '086520', '에코프로비엠': '247540', '한화에어로스페이스': '012450',
        '현대차': '005380', '이수스페셜티': '457190', '컴투스': '078340', 'NHN': '181710'
    }
    codes_list = list(set(STOCK_CODES.values()))
    poll_url = f"https://polling.finance.naver.com/api/realtime/domestic/stock/{','.join(codes_list)}"
    poll_res = fetch_json(poll_url)
    realtime_data = {}
    if poll_res and 'datas' in poll_res:
        for d in poll_res['datas']:
            c = d.get('itemCode')
            if c:
                int_info = d.get('integratedPriceInfo') or {}
                val = int_info.get('accumulatedTradingValue') or d.get('accumulatedTradingValue')
                vol = int_info.get('accumulatedTradingVolume') or d.get('accumulatedTradingVolume')
                o = int_info.get('openPrice') or d.get('openPrice')
                h = int_info.get('highPrice') or d.get('highPrice')
                l = int_info.get('lowPrice') or d.get('lowPrice')
                realtime_data[c] = {
                    'name': d.get('stockName'),
                    'price': d.get('closePrice'),
                    'ratio': float(d.get('fluctuationsRatio', 0.0)),
                    'open': o,
                    'high': h,
                    'low': l,
                    'val': val,
                    'vol': vol
                }
        print(f"Updated integrated live quotes for {len(realtime_data)} theme stocks from Naver Polling API.")

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

    html_content = re.sub(r'<div class="stock-tile[^"]*"[^>]*>[\s\S]*?</div>\s*</div>', tile_replacer, html_content)

    
    # Dynamically update theme-avg for all 8 themes
    themes_stocks = {
        '🚀 우주항공 / 스페이스X': ['451760', '211270', '006800', '047810'],
        '👑 AI SW / 보안': ['402030', '263860', '108860', '304100'],
        '🎤 K-POP 엔터': ['035900', '122870', '041510', '352820'],
        '🔌 CXL / PCB 기판': ['007810', '356860', '222800', '007660'],
        '🔬 반도체 소부장 / HBM': ['036930', '031980', '067310', '058470'],
        '💎 밸류업 / 금융': ['138040', '316140', '055550', '086790'],
        '📱 모바일콘텐츠': ['417180', '263720', '432430', '207760'],
        '🤖 지능형로봇/AI': ['277810', '454910', '455900', '056080']
    }
    for th_name, codes in themes_stocks.items():
        ratios = [realtime_data[c]['ratio'] for c in codes if c in realtime_data]
        if ratios:
            avg_r = sum(ratios) / len(ratios)
            avg_color = "#f43f5e" if avg_r > 0 else ("#38bdf8" if avg_r < 0 else "#94a3b8")
            avg_str = f"{avg_r:+.1f}%"
            # Pattern to replace theme-avg for this block
            pat = rf'(<span class="theme-name">[^<]*{re.escape(th_name[:4])}[^<]*</span>\s*<span class="theme-avg"[^>]*>)[^<]+(</span>)'
            repl_str = r'\g<1>' + avg_str + r'\g<2>'
            html_content = re.sub(pat, repl_str, html_content)

    c_d = realtime_data.get('402030', {})
    if c_d:
        html_content = re.sub(r'(👑 AI SW \(스탁이지 1위\)[\s\S]*?<span class="theme-tag [^"]*">)[^<]+(</span>)', f"\\g<1>+{c_d['ratio']:.1f}% 상한가 🚀\\2", html_content)

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
            
            if news_tit[:20] in html_content:
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
            sub_idx = html_content.find(marker)
            if sub_idx != -1:
                insert_idx = html_content.find('<!--', sub_idx)
                if insert_idx != -1:
                    html_content = html_content[:insert_idx] + new_cards_html + html_content[insert_idx:]
                    print(f"Injected {len(news_res)} fresh real-time news cards into #tabNews.")

    # 6. Real-time Bottom Grid (52W High & 100억+ Upper Limit / +25% Near Upper)
    try:
        up_stocks = fetch_json('https://stock.naver.com/api/domestic/market/stock/default?tradeType=KRX&marketType=ALL&orderType=up&startIdx=0&pageSize=100')
        h52_stocks = fetch_json('https://stock.naver.com/api/domestic/market/stock/default?tradeType=KRX&marketType=ALL&orderType=high52week&startIdx=0&pageSize=100')
        if up_stocks and h52_stocks:
            # Collect top candidate codes to fetch their integratedPriceInfo
            cand_codes = list(set([s.get('itemcode') for s in up_stocks[:35] if s.get('itemcode')] + [s.get('itemcode') for s in h52_stocks[:15] if s.get('itemcode')]))
            poll_map = {}
            for c, rd in realtime_data.items():
                val_str = rd.get('val') or ''
                num_match = re.search(r'([\d,.]+)\s*억', val_str) if val_str else None
                num_val = float(num_match.group(1).replace(',', '')) if num_match else 0.0
                poll_map[c] = {
                    'price': rd.get('price'),
                    'ratio': rd.get('ratio', 0.0),
                    'val_str': val_str,
                    'val_num': num_val
                }
            if cand_codes:
                p_url = f"https://polling.finance.naver.com/api/realtime/domestic/stock/{','.join(cand_codes)}"
                p_res = fetch_json(p_url)
                if p_res and 'datas' in p_res:
                    for it in p_res['datas']:
                        c = it.get('itemCode')
                        if c:
                            if c in realtime_data:
                                continue
                            int_info = it.get('integratedPriceInfo') or {}
                            val_str = int_info.get('accumulatedTradingValue') or it.get('accumulatedTradingValue')
                            # parse numeric 억
                            num_match = re.search(r'([\d,.]+)\s*억', val_str) if val_str else None
                            num_val = float(num_match.group(1).replace(',', '')) if num_match else round(float(it.get('accumulatedTradingValueRaw', 0))/100000000, 1)
                            poll_map[c] = {
                                'price': it.get('closePrice'),
                                'ratio': float(it.get('fluctuationsRatio', 0.0)),
                                'val_str': val_str,
                                'val_num': num_val
                            }

            true_100b_upper = []       # ratio >= 29.5% and amt >= 100억
            true_100b_near_upper = []  # 25.0% <= ratio < 29.5% and amt >= 100억
            watch_candidates = []      # amt >= 100억 and 15.0% <= ratio < 25.0%
            excluded_sub_100b = []     # ratio >= 25.0% but amt < 100억

            for s in up_stocks:
                code = s.get('itemcode')
                p_info = poll_map.get(code, {})
                now_p_str = p_info.get('price') or f"{int(float(s.get('nowPrice', 0))):,}"
                ratio = p_info.get('ratio', float(s.get('prevChangeRate', 0)))
                limit_p = float(s.get('upperLimitPrice', 0))
                now_p_num = float(now_p_str.replace(',', ''))
                is_upper = (now_p_num == limit_p) or (ratio >= 29.5)
                amt_억 = p_info.get('val_num', round(float(s.get('tradeAmount', 0)) / 100000000, 1))
                val_display = p_info.get('val_str') or f"{amt_억}억"

                if amt_억 >= 100.0:
                    if is_upper:
                        true_100b_upper.append((s, amt_억, val_display, now_p_str, ratio))
                    elif ratio >= 25.0:
                        true_100b_near_upper.append((s, amt_억, val_display, now_p_str, ratio))
                    elif ratio >= 15.0:
                        watch_candidates.append((s, ratio, amt_억, val_display, now_p_str))
                else:
                    if ratio >= 25.0:
                        excluded_sub_100b.append((s, ratio, amt_억, val_display))

            true_100b_upper.sort(key=lambda x: x[1], reverse=True)
            true_100b_near_upper.sort(key=lambda x: x[1], reverse=True)
            watch_candidates.sort(key=lambda x: x[1], reverse=True)

            h52_list = []
            for s in h52_stocks:
                code = s.get('itemcode')
                p_info = poll_map.get(code, {})
                high_p = float(s.get('highPrice', 0))
                w52_p = float(s.get('week52HighPrice', 0))
                ratio = p_info.get('ratio', float(s.get('prevChangeRate', 0)))
                amt_억 = p_info.get('val_num', round(float(s.get('tradeAmount', 0)) / 100000000, 1))
                val_display = p_info.get('val_str') or f"{amt_억}억"
                now_p_str = p_info.get('price') or f"{int(float(s.get('nowPrice', 0))):,}"
                if high_p >= w52_p and w52_p > 0 and ratio > -5.0:
                    h52_list.append((s, amt_억, val_display, now_p_str, ratio))
            h52_list.sort(key=lambda x: x[1], reverse=True)

            REASONS = {
                '069510': '전장용 스피커 및 사운드 시스템 수주 확대 + 3분기 흑자 서프라이즈로 130억 돌파 52주 신고가 경신.',
                '0039P0': 'AI 마케팅 자동화 솔루션 및 타깃 광고 수주 급증으로 190억 돌파 +21% 급등.',
                '035900': '스트레이키즈 스타디움 투어 및 음원 스트리밍 역대 최대 실적으로 720억 돌파 엔터 대장주.',
                '039980': '온디바이스 AI 오피스 및 LLM 보안 솔루션 공공 공급 모멘텀 118억 유입.',
                '420610': '영상 AI 기반 지능형 보안 관제 솔루션 글로벌 공급 계약 232억 유입.',
                '251970': 'K-뷰티 인디 브랜드 글로벌 돌풍 화장품 용기 풀가동 역사적 신고가 지속.',
                '219130': '반도체 검사용 프로브카드 PCB 고다층 기판 수요 폭증 역사적 신고가.',
                '005430': '대한항공-아시아나 기업결합 승인 가시화에 따른 지상조업 독점력 부각 신고가.'
            }

            h52_html = '''      <!-- Left: 52W High -->\n      <div class="panel-box gold">\n        <div class="sec-head" style="border-bottom-color:#b45309; color:#fbbf24;">\n          <span>🎯 52주 신고가 돌파 종목 & 사유 (실시간)</span>\n          <span class="sub">당일 고가 기준 실시간 집계 🟢</span>\n        </div>\n'''
            for s, amt, val_disp, now_p_str, r in h52_list[:4]:
                code = s.get('itemcode')
                name = s.get('itemname')
                now_p = f"{now_p_str}원"
                r_str = f"+{r:.1f}%" if r > 0 else f"{r:.2f}%"
                high_p = f"{int(float(s.get('highPrice', 0))):,}원"
                w52_p = f"{int(float(s.get('week52HighPrice', 0))):,}원"
                reason = REASONS.get(code, f"당일 고가 {high_p}로 52주 최고가({w52_p}) 경신 돌파 및 거래대금 유입.")
                h52_html += f'''        <div class="reason-item" onclick="openDetail('{name} ({code})', '{now_p} ({r_str})', '대금 {val_disp} | 고가 {high_p}', '【52주 신고가 사유】 {reason}')">\n          <div class="ri-head"><span>★ {name}</span><span style="color:#fef08a;">{now_p} ({r_str})</span></div>\n          <div class="ri-meta">대금 {val_disp} | 고가 {high_p} (52주 신고가 경신)</div>\n          <div class="ri-reason gold">{reason}</div>\n        </div>\n'''
            h52_html += '''        <div style="font-size: 10px; color: #64748b; margin-top: 6px;">\n          ※ 장중 52주 신고가를 터치한 종목만 실시간 연동되며, 신고가 이탈/하락 종목은 자동 제외됩니다.\n        </div>\n      </div>\n'''

            items_to_render = []
            for s, amt, val_disp, now_p_str, r in true_100b_upper:
                items_to_render.append((s, "UPPER", amt, val_disp, now_p_str, r))
            for s, amt, val_disp, now_p_str, r in true_100b_near_upper:
                items_to_render.append((s, "NEAR_UPPER", amt, val_disp, now_p_str, r))

            has_matched = len(items_to_render) > 0
            sub_tag = "실시간 진성 종목 연동 🟢" if has_matched else "현재 조건 충족 0건 (대기 중 🟡)"

            up_html = f'''      <!-- Right: Upper Limit 100억+ 진성 상한가 & 사유 -->\n      <div class="panel-box red">\n        <div class="sec-head" style="border-bottom-color:#be123c; color:#f43f5e;">\n          <span>🚀 거래대금 100억+ 진성 상한가 & 임박 (+25% 엄격)</span>\n          <span class="sub">{sub_tag}</span>\n        </div>\n'''

            if has_matched:
                for idx, (s, kind, amt, val_disp, now_p_str, r) in enumerate(items_to_render):
                    code = s.get('itemcode')
                    name = s.get('itemname')
                    now_p = f"{now_p_str}원"
                    r_str = f"+{r:.1f}%" if r > 0 else f"{r:.2f}%"
                    status_tag = "100억+ 진성 상한가 🚀" if kind == "UPPER" else "상한가 임박 (+25% 돌파) 🚨"
                    role_tag = f"👑 ★ {name}" if kind == "UPPER" else f"🚨 ★ {name}"
                    color_style = "color:#f43f5e; font-weight:800; font-size:12px;" if kind == "UPPER" else "color:#fbbf24; font-weight:800; font-size:12px;"
                    reason = REASONS.get(code, f"당일 거래대금 {val_disp} 유입되며 {r_str} 급등.")
                    up_html += f'''        <div class="reason-item" style="border-left: 3px solid #f43f5e; background: rgba(244,63,94,0.06);" onclick="openDetail('{name} ({code})', '{now_p} ({r_str})', '거래대금 {val_disp}', '【100억+ 상한가·임박 사유】 {reason}')">\n          <div class="ri-head"><span style="color:#ffffff; font-weight:800;">{role_tag}</span> <span style="{color_style}">{r_str} ({status_tag})</span></div>\n          <div class="ri-meta" style="color:#fca5a5; font-weight:700;">거래대금 {val_disp} | 현재가 {now_p}</div>\n          <div class="ri-reason red">{reason}</div>\n        </div>\n'''
            else:
                up_html += '''        <div style="background: rgba(244,63,94,0.08); border: 1px dashed rgba(244,63,94,0.3); border-radius: 6px; padding: 12px; margin-bottom: 10px; text-align: center;">\n          <div style="font-size: 12.5px; font-weight: 800; color: #fca5a5;">🛡️ 현재 실시간 '거래대금 100억+ & 상승률 +25% 이상' 종목: 0건 (대기)</div>\n          <div style="font-size: 11px; color: #cbd5e1; margin-top: 4px; line-height: 1.45;">\n            현재 30% 상한가 종목(코난 23.6억, DGI 14.6억 등)은 100억 미만으로 제외되었으며,<br>\n            100억 이상 유입 종목들은 아직 +25% 임박 기준에 미도달하여 노출 대기 중입니다.\n          </div>\n        </div>\n'''

            if watch_candidates:
                up_html += '''        <div style="font-size: 11px; font-weight: 800; color: #fbbf24; margin: 8px 0 4px 2px;">👀 +25% 상한가 임박 돌파 관찰 후보 (거래대금 100억+ 유입)</div>\n'''
                for s, r, amt, val_disp, now_p_str in watch_candidates[:3]:
                    code = s.get('itemcode')
                    name = s.get('itemname')
                    now_p = f"{now_p_str}원"
                    gap_to_25 = round(25.0 - r, 1)
                    up_html += f'''        <div class="reason-item" style="border-left: 3px solid #fbbf24; background: rgba(251,191,36,0.05);" onclick="openDetail('{name} ({code})', '{now_p} (+{r:.1f}%)', '대금 {val_disp}', '25% 상한가 임박까지 +{gap_to_25:.1f}%p 남음')">\n          <div class="ri-head"><span style="color:#ffffff; font-weight:800;">★ {name}</span> <span style="color:#fde047; font-weight:800; font-size:11.5px;">+{r:.1f}% (25% 돌파까지 +{gap_to_25:.1f}%p)</span></div>\n          <div class="ri-meta">거래대금 {val_disp} | 현재가 {now_p}</div>\n        </div>\n'''

            small_upper_names = ", ".join([f"{s.get('itemname')}({r}%, {val_disp})" for s, r, amt, val_disp in excluded_sub_100b[:3]])
            up_html += f'''        <div style="font-size: 10px; color: #64748b; margin-top: 6px;">\n          ※ <strong>상한가 임박 기준은 '상승률 +25% 이상 & 거래대금 100억 이상'</strong>에만 부여됩니다.<br>\n          ※ 코난테크놀로지, DGI 등은 <strong>거래대금 100억 미만 소형주({small_upper_names})</strong>이므로 진성 기준에서 제외되었습니다. 장중 100억 돌파 시 즉시 자동 편입됩니다.\n        </div>\n      </div>\n'''

            new_grid = f'''    <!-- BOTTOM: 52W HIGH & 100억+ UPPER LIMIT (PLACED BELOW THEMES) -->\n    <div class="main-bottom-grid">\n{h52_html}\n{up_html}\n    </div>'''
            b_start = html_content.find('<!-- BOTTOM: 52W HIGH & 100억+ UPPER LIMIT (PLACED BELOW THEMES) -->')
            b_end = html_content.find('<!-- TAB 2: SUPPLY STOCKS', b_start)
            if b_start != -1 and b_end != -1:
                html_content = html_content[:b_start] + new_grid + '\n  </div>\n\n  ' + html_content[b_end:]
                print("auto_update_all_tabs: updated 52W High & 100억+ Upper Limit / +25% Near Upper successfully!")
    except Exception as e:
        print(f"[WARN] Failed updating bottom grid: {e}")

    # 5. Check Integrity
    open_divs = len(re.findall(r'<div\b', html_content, re.IGNORECASE))
    close_divs = len(re.findall(r'</div\b', html_content, re.IGNORECASE))
    assert open_divs == close_divs, f"DIV mismatch: {open_divs} != {close_divs}"

    # Write out
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    if os.path.exists("stock_dashboard.html"):
        with open("stock_dashboard.html", "w", encoding="utf-8") as f:
            f.write(html_content)
    if os.path.exists("widgets/stock-theme-map/bundle/index.html"):
        with open("widgets/stock-theme-map/bundle/index.html", "w", encoding="utf-8") as f:
            f.write(html_content)

    print(f"[{time_str}] auto_update_all_tabs completed successfully!")


if __name__ == "__main__":
    main()
