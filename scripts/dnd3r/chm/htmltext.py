"""HTML (Word / CHM export) -> lines. Headings start '#hN ', bold is \x01…\x02, table cells ' | '."""
import re, html


def decode(b):
    try:
        return b.decode('utf-8')
    except UnicodeDecodeError:
        pass
    u = b.decode('utf-8', 'replace')
    if u.count('�') < max(3, len(u) / 2000):
        return u
    return b.decode('gb18030', 'replace')


BLOCK = re.compile(r'(?i)<br\b[^>]*>|</?p\b[^>]*>|</?div\b[^>]*>|</?tr\b[^>]*>|</?li\b[^>]*>|</?table\b[^>]*>|</?[uo]l\b[^>]*>|</?blockquote\b[^>]*>|</?dd\b[^>]*>|</?dt\b[^>]*>')


def to_lines(t):
    t = re.sub(r'(?is)<head\b.*?</head>', '', t)
    t = re.sub(r'(?s)<!--.*?-->', '', t)
    t = re.sub(r'(?is)<(script|style|xml)\b.*?</\1>', '', t)
    # Source line breaks are spaces; only tags break lines
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'(?i)<(h[1-6])\b[^>]*>', lambda m: '\n#' + m.group(1).lower() + ' ', t)
    t = re.sub(r'(?i)</h[1-6]\s*>', '\n', t)
    # A cell's paragraphs stay on its row
    t = re.sub(r'(?is)(<t[dh]\b[^>]*>)(.*?)(</t[dh]\s*>)', lambda m: m.group(1) + BLOCK.sub(' ', m.group(2)) + m.group(3), t)
    t = re.sub(r'(?i)<(b|strong)\b[^>]*>', '\x01', t)
    t = re.sub(r'(?i)</(b|strong)\s*>', '\x02', t)
    t = re.sub(r'(?i)</t[dh]\s*>', ' \x03 ', t)
    t = BLOCK.sub('\n', t)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t).replace('\xa0', ' ').replace('　', ' ')
    lines = []
    for line in t.split('\n'):
        line = re.sub(r'[ \t\r]+', ' ', line).strip()
        # Table cells: drop empty trailing cells
        line = re.sub(r'(\s*\x03\s*)+$', '', line).replace(' \x03 ', ' | ').replace('\x03', ' | ')
        line = re.sub(r'\x01\s*\x02', '', line)
        line = re.sub(r'\x02\s*\x01', '', line)
        if re.sub(r'[\x01\x02|\s]', '', line):
            lines.append(line.strip())
    return lines
