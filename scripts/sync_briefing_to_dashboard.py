#!/usr/bin/env python3
import sys
import re
import os
import json
import subprocess
import datetime
import esprima

def convert_briefing_to_html(time_key, title, date_str, text):
    """
    Converts plain text or markdown briefing into rich, structured HTML
    with colored cards, badges, bold highlights, and clean typography.
    """
    lines = text.strip().split('\n')
    
    html = []
    html.append('<div style="font-family: inherit; color: #f1f5f9; line-height: 1.6;">')
    
    # Header Banner
    html.append(f'''
  <div style="background: linear-gradient(90deg, #0369a1 0%, #0284c7 100%); padding: 12px 14px; border-radius: 8px; margin-bottom: 14px; border: 1px solid #38bdf8;">
    <div style="font-size: 15px; font-weight: 800; color: #ffffff;">📊 {time_key} {title}</div>
    <div style="font-size: 11px; color: #e0f2fe; margin-top: 3px;">{date_str} · 정규 증시 브리핑 전문</div>
  </div>''')
    
    section_patterns = [
        re.compile(r'^(\d+[\.\)]\s+.*)'),
        re.compile(r'^(■\s+.*)'),
        re.compile(r'^(#{1,4}\s+.*)'),
        re.compile(r'^(\[.*\]\s+.*)')
    ]
    
    palette = [
        ("#6366f1", "#c7d2fe"), # Indigo
        ("#38bdf8", "#bae6fd"), # Sky
        ("#f59e0b", "#fde68a"), # Amber
        ("#34d399", "#a7f3d0"), # Emerald
        ("#ec4899", "#fbcfe8"), # Pink
        ("#a855f7", "#e9d5ff"), # Purple
        ("#06b6d4", "#cffafe"), # Cyan
        ("#e11d48", "#fecdd3"), # Rose
        ("#10b981", "#d1fae5"), # Green
        ("#8b5cf6", "#ddd6fe"), # Violet
    ]
    
    current_sec_title = None
    current_sec_lines = []
    sections = []
    
    for line in lines:
        stripped = line.strip()
        is_heading = False
        for pat in section_patterns:
            m = pat.match(stripped)
            if m:
                is_heading = True
                break
        
        if is_heading:
            if current_sec_title or current_sec_lines:
                sections.append((current_sec_title, current_sec_lines))
            current_sec_title = stripped.lstrip('#').strip()
            current_sec_lines = []
        else:
            if current_sec_title is not None or stripped:
                current_sec_lines.append(stripped)
                
    if current_sec_title or current_sec_lines:
        sections.append((current_sec_title, current_sec_lines))
        
    sec_idx = 0
    for sec_title, sec_content in sections:
        border_col, title_col = palette[sec_idx % len(palette)]
        sec_idx += 1
        
        html.append(f'''
  <div style="background: #0f172a; border: 1px solid #1e293b; border-left: 4px solid {border_col}; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px;">''')
        
        if sec_title:
            html.append(f'    <div style="font-size: 13px; font-weight: 800; color: {title_col}; margin-bottom: 6px;">{sec_title}</div>')
            
        html.append('    <div style="font-size: 12px; color: #cbd5e1; line-height: 1.65;">')
        
        for c_line in sec_content:
            if not c_line:
                html.append('      <div style="height: 6px;"></div>')
                continue
                
            formatted = c_line
            formatted = re.sub(r'\*\*(.*?)\*\*', r'<strong style="color:#ffffff;">\1</strong>', formatted)
            formatted = re.sub(r'(\+[0-9]+\.?[0-9]*%)', r'<span style="color:#f43f5e; font-weight:800;">\1</span>', formatted)
            formatted = re.sub(r'(\-[0-9]+\.?[0-9]*%)', r'<span style="color:#38bdf8; font-weight:800;">\1</span>', formatted)
            
            if formatted.startswith('- ') or formatted.startswith('* ') or formatted.startswith('• '):
                formatted = '• ' + formatted[2:]
                html.append(f'      <div>{formatted}</div>')
            else:
                html.append(f'      <div>{formatted}</div>')
                
        html.append('    </div>\n  </div>')
        
    html.append('</div>')
    return '\n'.join(html)


def sync_to_file(filepath, time_key, title, summary, full_html, indices_text=None, desc_text=None):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # 1. Update briefingData[time_key] (with robust lookahead matching)
    escaped_html = json.dumps(full_html)
    key_pattern = re.compile(rf"('{re.escape(time_key)}':\s*\{{)")
    full_html_pat = re.compile(
        rf"('{re.escape(time_key)}':\s*\{{[^}}]*?fullHtml:\s*).*?(?=\s*,\s*\n\s*(?:title|indices|outlook))",
        re.DOTALL
    )
    
    if full_html_pat.search(content):
        content = full_html_pat.sub(lambda m: m.group(1) + escaped_html, content, count=1)
    elif key_pattern.search(content):
        content = key_pattern.sub(lambda m: m.group(1) + "\n        fullHtml: " + escaped_html + ",", content, count=1)
    else:
        briefing_data_pat = re.compile(r"(const briefingData = \{)")
        if briefing_data_pat.search(content):
            new_entry = f'''const briefingData = {{
      '{time_key}': {{
        fullHtml: {escaped_html},
        title: '{title}',
      }},'''
            content = briefing_data_pat.sub(lambda _: new_entry, content, count=1)

    # 2. Update top callout banner in tabAnalysis
    callout_pat = re.compile(r'<div class="callout-top"[^>]*>.*?</div>\s*</div>\s*<div class="ct-btn"[^>]*>.*?</div>\s*</div>', re.DOTALL)
    new_callout = f'''<div class="callout-top" onclick="openBriefingModal('{time_key}')" style="background: linear-gradient(90deg, #064e3b 0%, #059669 100%); border: 1px solid #34d399;">
        <div>
          <div class="ct-text">👑 {time_key} {title} 전문 보기 (최신 11/13 금)</div>
          <div style="font-size:10.5px; color:#d1fae5; margin-top:2px;">
            {summary}
          </div>
        </div>
        <div class="ct-btn" style="background:#059669; border:1px solid #34d399;">전문 열기 ›</div>
      </div>'''
    if callout_pat.search(content):
        content = callout_pat.sub(lambda _: new_callout, content, count=1)

    # 3. Dynamic Timeline Card Replacement / Insertion in Tab 4
    now_kst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    day_str = f"{now_kst.month}/{now_kst.day} " + ["월","화","수","목","금","토","일"][now_kst.weekday()]
    new_time_text = f"👑 {time_key} {title} ({day_str}) (최신)"
    new_ind = indices_text if indices_text else summary
    new_dsc = desc_text if desc_text else summary

    card_pat = re.compile(
        rf'(<div class="timeline-card"[^>]*onclick="openBriefingModal\(\'{re.escape(time_key)}\'\)"[^>]*>.*?'
        r'<span class="tc-time"[^>]*>).*?(</span>.*?'
        r'<span class="tc-indices"[^>]*>).*?(</span>.*?'
        r'<div class="tc-desc">).*?(</div>)',
        re.DOTALL
    )
    
    # Remove previous "👑 ... (최신)" glow styling from other cards
    content = re.sub(
        r'class="timeline-card"\s+style="border-left-color:\s*#34d399;\s*background:\s*linear-gradient\(180deg,\s*rgba\(52,211,153,0.14\)\s*0%,\s*rgba\(15,23,42,0.6\)\s*100%\);"',
        'class="timeline-card" style="border-left-color: #38bdf8;"',
        content
    )
    content = re.sub(r'👑\s*(\d{2}:\d{2}[^<]*?)\s*\(최신\)', r'\1', content)

    if card_pat.search(content):
        def repl_card(m):
            card_start = m.group(1).replace(
                'class="timeline-card"',
                'class="timeline-card" style="border-left-color: #34d399; background: linear-gradient(180deg, rgba(52,211,153,0.14) 0%, rgba(15,23,42,0.6) 100%);"'
            )
            return card_start + new_time_text + m.group(2) + new_ind + m.group(3) + f"\n          • <strong>시장 흐름:</strong> {new_dsc}\n        " + m.group(4)
        content = card_pat.sub(repl_card, content, count=1)
    else:
        # Insert new active card at the top of TODAY SESSIONS
        new_card_html = f'''      <!-- {time_key} Session (LATEST ACTIVE) -->
      <div class="timeline-card" style="border-left-color: #34d399; background: linear-gradient(180deg, rgba(52,211,153,0.14) 0%, rgba(15,23,42,0.6) 100%); cursor: pointer;" onclick="openBriefingModal('{time_key}')">
        <div class="tc-header">
          <span class="tc-time" style="background:#064e3b; color:#34d399;">{new_time_text}</span>
          <span class="tc-indices" style="color:#6ee7b7; font-weight:700;">{new_ind}</span>
        </div>
        <div class="tc-desc">
          • <strong>시장 흐름:</strong> {new_dsc}
        </div>
        <div class="tc-tap-hint">🔍 터치하여 {time_key} 브리핑 전문 확인 ›</div>
      </div>\n\n'''
      
        insert_marker = re.compile(r'(<!-- TODAY \([^)]+\) SESSIONS -->\s*)')
        if insert_marker.search(content):
            content = insert_marker.sub(lambda m: m.group(1) + new_card_html, content, count=1)
        else:
            # Fallback insertion before the first timeline-card in tabAnalysis
            first_card = re.compile(r'(<div id="tabAnalysis"[^>]*>.*?)(<div class="timeline-card")', re.DOTALL)
            if first_card.search(content):
                content = first_card.sub(lambda m: m.group(1) + new_card_html + m.group(2), content, count=1)

    # 4. Ensure todayDoneSlots includes time_key
    slots_pat = re.compile(r"todayDoneSlots\s*=\s*\[(.*?)\]")
    m_slots = slots_pat.search(content)
    if m_slots:
        current_slots_str = m_slots.group(1)
        if f"'{time_key}'" not in current_slots_str:
            new_slots_str = current_slots_str.rstrip() + f", '{time_key}'"
            content = content[:m_slots.start(1)] + new_slots_str + content[m_slots.end(1):]

    # Validate syntax & DIV balance
    div_open = len(re.findall(r'<div\b', content))
    div_close = len(re.findall(r'</div\b', content))
    if div_open != div_close:
        raise ValueError(f"DIV balance error in {filepath}: {div_open} open vs {div_close} close")
        
    script_blocks = re.findall(r'<script\b[^>]*>(.*?)</script>', content, re.DOTALL)
    for s_body in script_blocks:
        if s_body.strip():
            esprima.parseScript(s_body)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)


if __name__ == '__main__':
    if len(sys.argv) < 5:
        print("Usage: sync_briefing_to_dashboard.py <time_key> <title> <summary> <text_or_file> [indices] [desc]")
        sys.exit(1)
        
    time_key = sys.argv[1]
    title = sys.argv[2]
    summary = sys.argv[3]
    text_input = sys.argv[4]
    indices_text = sys.argv[5] if len(sys.argv) > 5 else None
    desc_text = sys.argv[6] if len(sys.argv) > 6 else None
    
    if os.path.exists(text_input):
        with open(text_input, 'r', encoding='utf-8') as f:
            text = f.read()
    else:
        text = text_input
        
    now_kst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    days = ["월", "화", "수", "목", "금", "토", "일"]
    date_str = f"{now_kst.year}년 {now_kst.month}월 {now_kst.day}일({days[now_kst.weekday()]})"
    full_html = convert_briefing_to_html(time_key, title, date_str, text)
    
    files = [
        "deploy_repo/index.html",
        "stock_dashboard.html",
        "widgets/stock-theme-map/bundle/index.html"
    ]
    
    for fp in files:
        if os.path.exists(fp):
            sync_to_file(fp, time_key, title, summary, full_html, indices_text, desc_text)
            print(f"Synced {time_key} briefing with rollover policy to {fp}")
