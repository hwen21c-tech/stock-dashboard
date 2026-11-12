#!/usr/bin/env python3
import re

with open('scripts/auto_update_all_tabs.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace all rf'\\g<1>...' or f'\\g<1>...' occurrences
text = text.replace(
    "rf'\\\\g<1>{close_p} ({ratio_str})\\g<2>'",
    "lambda m: m.group(1) + f'{close_p} ({ratio_str})' + m.group(2)"
)

text = text.replace(
    '''    if inv_k:
        f_val = inv_k.get('foreignValue', '') + '억'
        i_val = inv_k.get('institutionalValue', '') + '억'
        html_content = re.sub(
            r'(<span class="title"[^>]*>코스피 외인</span>\\s*<span class="amount [^"]*"[^>]*>)[^<]+(</span>)',
            rf'\\\\g<1>{f_val}\\g<2>',
            html_content
        )
        html_content = re.sub(
            r'(<span class="title"[^>]*>코스피 기관</span>\\s*<span class="amount [^"]*"[^>]*>)[^<]+(</span>)',
            rf'\\\\g<1>{i_val}\\g<2>',
            html_content
        )''',
    '''    if inv_k:
        f_raw = inv_k.get('foreignValue', '')
        i_raw = inv_k.get('institutionalValue', '')
        if f_raw:
            f_val = ('+' if not f_raw.startswith('-') else '') + f_raw + '억'
            html_content = re.sub(
                r'(<span class="title"[^>]*>외국인</span>\\s*<span class="amount [^"]*"[^>]*>)[^<]+(</span>)',
                lambda m: m.group(1) + f_val + m.group(2),
                html_content
            )
        if i_raw:
            i_val = ('+' if not i_raw.startswith('-') else '') + i_raw + '억'
            html_content = re.sub(
                r'(<span class="title"[^>]*>기관</span>\\s*<span class="amount [^"]*"[^>]*>)[^<]+(</span>)',
                lambda m: m.group(1) + i_val + m.group(2),
                html_content
            )'''
)

text = text.replace(
    'f"\\\\g<1>+{c_d[\'ratio\']:.2f}% 상한가 🚀\\g<2>"',
    'lambda m: m.group(1) + f"+{c_d[\'ratio\']:.2f}% 상한가 🚀" + m.group(2)'
)

text = text.replace(
    "f'\\\\g<1>{ctk_d[\"ratio\"]:+.2f}% ({ctk_d[\"price\"]}원)\x02'",
    "lambda m: m.group(1) + f'{ctk_d[\"ratio\"]:+.2f}% ({ctk_d[\"price\"]}원)' + m.group(2)"
)
text = text.replace(
    "f'\\\\g<1>{gen_d[\"ratio\"]:+.2f}% ({gen_d[\"price\"]}원)\x02'",
    "lambda m: m.group(1) + f'{gen_d[\"ratio\"]:+.2f}% ({gen_d[\"price\"]}원)' + m.group(2)"
)
text = text.replace(
    "f'\\\\g<1>{jyp_d[\"ratio\"]:+.2f}% ({jyp_d[\"price\"]}원)\x02'",
    "lambda m: m.group(1) + f'{jyp_d[\"ratio\"]:+.2f}% ({jyp_d[\"price\"]}원)' + m.group(2)"
)

text = text.replace(
    "f'\\\\g<1> <strong>전 종목 악재 없음(클린 🟢)</strong> <span style=\"font-size:10px; color:#34d399; margin-left:6px;\">[실시간 스캔: {time_str}]</span>\\g<2>'",
    "lambda m: m.group(1) + f' <strong>전 종목 악재 없음(클린 🟢)</strong> <span style=\"font-size:10px; color:#34d399; margin-left:6px;\">[실시간 스캔: {time_str}]</span>' + m.group(2)"
)

text = text.replace(
    "f'\\\\g<1>{sess_title}\\g<2>'",
    "lambda m: m.group(1) + sess_title + m.group(2)"
)
text = text.replace(
    "f'\\\\g<1>({sess_badge})\\g<2>'",
    "lambda m: m.group(1) + f'({sess_badge})' + m.group(2)"
)
text = text.replace(
    "f'\\\\g<1>{sess_badge}\\g<2>'",
    "lambda m: m.group(1) + sess_badge + m.group(2)"
)
text = text.replace(
    "f'\\\\g<1>\\n        {sess_desc}\\n      \\g<2>'",
    "lambda m: m.group(1) + f'\\n        {sess_desc}\\n      ' + m.group(2)"
)

text = text.replace(
    "f'\\\\g<1>{supply_overview_text} '",
    "lambda m: m.group(1) + f'{supply_overview_text} '"
)

text = text.replace(
    "html_content = re.sub(pat, rf'\\\\g<1>{p}원 ({r_str})\\2', html_content)",
    "html_content = re.sub(pat, lambda m: m.group(1) + f'{p}원 ({r_str})' + m.group(2), html_content)"
)

with open('scripts/auto_update_all_tabs.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Patch complete! Remaining \\\\g in script:", len(re.findall(r'\\\\g<', text)))
