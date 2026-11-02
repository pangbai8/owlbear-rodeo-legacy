"""Reads an unpacked 《3R扩展大不全》 CHM and writes its entries (spells, powers,
maneuvers, feats, items, monsters; classes, prestige classes and races as
articles) as records like scripts/dnd3r/build.mjs makes, each with its kind.
build.mjs adds the ones the wiki lacks.

  7z x 3R扩展大不全v2.50.chm -o<empty dir>
  py -3.13 -I scripts/dnd3r/chm/parse_chm.py <that dir> dnd3r-chm.json

The pages are Word exports by many translators: an entry is a title
("机运斗篷 (MANTLE OF SECOND CHANCES)", a heading or a bold line) followed by
labelled lines (灵光：…, 价格：…) or a table of them; its kind comes from the
labels it has.
"""
import sys, os, re, json, html, collections, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")
from htmltext import decode, to_lines

CJK = r'㐀-鿿豈-﫿'
HAS_CJK = re.compile('[' + CJK + ']')

# Field labels -> the wiki's names (kind-specific ones are fixed up later)
LABELS = {
    # spells
    '等级': '等级', '法术等级': '等级', '法术成分': '法术成分', '成分': '法术成分', '施法时间': '施法时间', '施展时间': '施法时间',
    '距离': '距离', '射程': '距离', '目标': '目标', '效果': '效果', '区域': '区域', '范围': '区域', '持续时间': '持续时间',
    '豁免检定': '豁免检定', '豁免': '豁免', '法术抗力': '法术抗力', '学派': '学派',
    # powers
    '显能时间': '显能时间', '显现时间': '显能时间', '展现时间': '显能时间', '异象': '异象', '灵能点': '灵能点', '能量点': '灵能点',
    '灵能抗力': '灵能抗力', '能系': '能系',
    # maneuvers
    '流派': '流派', '发动时间': '发动时间', '启动时间': '发动时间',
    # feats
    '先决条件': '先决条件', '前提': '先决条件', '前置条件': '先决条件', '先决': '先决条件', '需求': '先决条件',
    '利益': '效果', '好处': '效果', '益处': '效果', '收益': '效果', '正常': '正常', '普通': '正常', '一般情况': '正常', '特殊': '特殊',
    # items
    '价格': '价格', '市价': '价格', '售价': '价格', '部位': '部位', '位置': '部位', '身体部位': '部位', '装备部位': '部位',
    '施法者等级': '施法者等级', '灵光': '灵光', '光环': '灵光', '制造条件': '制造条件', '制作': '制造条件', '制造': '制造条件',
    '制造需求': '制造条件', '制作需求': '制造条件', '制造要求': '制造条件', '制造花费': '制造耗费', '制作花费': '制造耗费',
    '制造耗费': '制造耗费', '制造费用': '制造耗费', '花费': '制造耗费', '成本': '制造耗费', '重量': '重量', '激活': '启动', '启动': '启动',
    '启动方式': '启动', '描述': '描述', '学识': '学识', '物品等级': '物品等级',
    # monsters
    '体型/类型': '体型/类型', '生命骰': '生命骰', '先攻': '先攻', '速度': '速度', '防御等级': '防御等级', '护甲等级': '防御等级',
    '基本攻击/擒抱': '基本攻击/擒抱', '基础攻击/擒抱': '基本攻击/擒抱', '攻击': '攻击', '全力攻击': '全力攻击', '占用/触及': '占据/触及',
    '空间/触及': '占据/触及', '占据/触及': '占据/触及', '特殊攻击': '特殊攻击', '特殊能力': '特殊特性', '特殊特质': '特殊特性',
    '特殊特性': '特殊特性', '属性': '属性', '技能': '技能', '专长': '专长', '环境': '环境', '组织': '组织', '挑战级数': '挑战等级',
    '挑战等级': '挑战等级', '宝藏': '宝物', '宝物': '宝物', '阵营': '阵营', '进化': '进化', '进阶': '进化', '等级修正值': '等级调整',
    '等级调整': '等级调整', '等级调整值': '等级调整',
}
LABELS.update({
    # more spellings met in the books
    '影响区域': '区域', '影响范围': '区域', '面积': '区域', '法术抗性': '法术抗力', '法抗': '法术抗力', '持续': '持续时间',
    '施法动作': '施法时间', '施放时间': '施法时间', '组件': '法术成分', '异能抗力': '灵能抗力',
    '魔法灵光': '灵光', '灵气': '灵光', '灵光/施法者等级': '灵光', '灵气/施法者等级': '灵光', '灵光与施法者等级': '灵光',
    '灵光/显能者等级': '灵光', '施法等级': '施法者等级', '适用部位': '部位', '装备位置': '部位', '占用部位': '部位',
    '身体位置': '部位', '身体装备位': '部位', '移植部位': '部位', '制作前提': '制造条件', '制造消耗': '制造耗费',
    '制造价格': '制造耗费', '激发动作': '启动', '传说': '学识', '传闻': '学识', '逸闻': '学识', '相关知识': '学识',
    '适用物品': '适用', '适用范围': '适用', '适用': '适用',
    '面宽/触及': '占据/触及', '全回合攻击': '全力攻击', '全攻击': '全力攻击', '先攻权': '先攻', '特性': '特殊特性',
    '属性值': '属性', '地域': '环境', '财宝': '宝物', '成长': '进化', '体型及种类': '体型/类型', '体型与类型': '体型/类型',
})
TEXT_FIELDS = {'效果', '描述', '特殊', '正常', '学识'}

SIZES = ['超微型', '微型', '超小型', '小型', '中型', '大型', '超大型', '巨型', '超巨型']
SIZE_CELLS = {'超微型': 1, '微型': 1, '超小型': 1, '小型': 1, '中型': 1, '大型': 2, '超大型': 3, '巨型': 4, '超巨型': 6}
SCHOOL = re.compile(r'^(防护|咒法|预言|附魔|塑能|幻术|死灵|变化|通用|心灵|预知|心灵传送|心灵附魔|心灵变化|心灵塑能|心灵异变|心灵感应|超感|心灵念力|心灵控制)')


def label_of(raw):
    raw = raw.strip(' *«»').replace('／', '/')
    if raw in LABELS:
        return LABELS[raw]
    # "目标/效果"，"目标、效果或区域"
    if re.match(r'^(目标|效果|区域)[/、或和]', raw):
        return '目标'
    return None


def field_of(plain):
    """(label, raw label, value or [values]) for a field line, else None"""
    if ' | ' in plain:
        cells = [c.strip() for c in plain.split(' | ')]
        lab = label_of(re.sub(r'[:：]$', '', cells[0]))
        if lab:
            vals = cells[1:]
            return lab, cells[0], vals if len(vals) > 1 else vals[0]
        return None
    m = re.match(r'^([^\s:：|]{1,10}?)\s*(?:[\(（][^)）]{0,10}[\)）])?\s*[:：]\s*(.*)$', plain)
    if m:
        lab = label_of(m.group(1))
        if lab:
            return lab, m.group(1), m.group(2).strip()
    return None


def plain_of(line):
    return re.sub(r'^#h\d ', '', line).replace('\x01', '').replace('\x02', '').strip()


def all_bold(line):
    """Nothing outside bold (an open bold runs to the end of the line)"""
    s = re.sub(r'^#h\d ', '', line)
    if not s.startswith('\x01'):
        return False
    out = re.sub(r'\x01[^\x02]*(\x02|$)', '', s)
    return not re.sub(r'[\s()（）\[\]【】:：]', '', out)


SMALL = {'of', 'the', 'and', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'from', 'at', 'by', 'or'}


def nice_en(en):
    en = re.sub(r'\s+', ' ', en).strip(' ,.-:')
    if en.isupper() or en.islower():
        words = en.lower().split(' ')
        en = ' '.join(w if (i and w in SMALL) else w[:1].upper() + w[1:] for i, w in enumerate(words))
        en = re.sub(r"(?<=[-/])([a-z])", lambda m: m.group(1).upper(), en)
    return en


def parse_title(line):
    """(中文名, English, tags) or None"""
    s = plain_of(line)
    if not s or len(s) > 90:
        return None
    s = re.sub(r'\s*(CR|ＣＲ|挑战等级)\s*[\d/]+\s*$', '', s)
    tags = re.findall(r'[\[【]([^\]】]{1,14})[\]】]', s)
    s = re.sub(r'\s*[\[【][^\]】]{1,14}[\]】]\s*', ' ', s).strip()
    for _ in range(2):
        s = re.sub(r'\s*[\(（][^()（）A-Za-z]{1,14}[\)）]\s*$', '', s)
    m = re.match(r'^([^A-Za-z()（）\[\]|]*?[' + CJK + r'][^A-Za-z()（）\[\]|:：]*?)\s*[\(（]?\s*([A-Za-z][A-Za-z0-9 ,.\'’\-:/&!+]*?)\s*[\)）]?\s*$', s)
    if m:
        name, en = m.group(1).strip(' :：,，、-—.。'), m.group(2)
        letters = len(re.findall('[A-Za-z]', en))
        if 1 <= len(name) <= 20 and letters >= 3 and len(en.split()) <= 9 and not re.search(r'[。；！？]', name):
            return name, nice_en(en.replace('’', "'")), tags
        return None
    # A name that starts with a word in Latin letters: "Cli七弦琴（Cli Lyre）", the English in brackets
    m = re.match(r'^([A-Za-z]{1,12}[' + CJK + r'][^()（）\[\]|:：]{0,16}?)\s*[\(（]\s*([A-Za-z][A-Za-z0-9 ,.\'’\-:/&!+]*?)\s*[\)）]$', s)
    if m:
        return m.group(1).strip(), nice_en(m.group(2).replace('’', "'")), tags
    if re.match(r'^[' + CJK + r'0-9+\-·、]{2,14}$', s):
        return s, '', tags
    return None


def heading_level(line):
    m = re.match(r'^#h(\d) ', line)
    return int(m.group(1)) if m else None


def toc_files(root):
    t = open(os.path.join(root, 'Contents.hhc'), 'rb').read().decode('gb18030', 'replace')
    seen, order = set(), []
    for m in re.finditer(r'name="Local"\s+value="([^"]*)"', t, re.I):
        f = urllib.parse.unquote(m.group(1).split('#')[0]).replace('/', os.sep)
        if f not in seen:
            seen.add(f)
            order.append(f)
    return order


def toc_books(root):
    """file -> its book, the nearest "[DMG2] 城主指南2" above it in the contents (not in the quick reference)"""
    t = open(os.path.join(root, 'Contents.hhc'), 'rb').read().decode('gb18030', 'replace')
    stack, books, last = [], {}, None
    for m in re.finditer(r'<UL>|</UL>|<OBJECT type="text/sitemap">(.*?)</OBJECT>', t, re.S | re.I):
        g = m.group(0).upper()
        if g == '<UL>':
            stack.append(last or '')
            last = None
        elif g == '</UL>':
            if stack:
                stack.pop()
            last = None
        else:
            body = m.group(1)
            name = re.search(r'name="Name"\s+value="([^"]*)"', body, re.I)
            last = html.unescape(name.group(1)).strip() if name else ''
            loc = re.search(r'name="Local"\s+value="([^"]*)"', body, re.I)
            if not loc or any(x.startswith('速查') for x in stack):
                continue
            rel = urllib.parse.unquote(loc.group(1).split('#')[0]).replace('/', os.sep)
            for label in reversed(stack + [last]):
                b = re.match(r'^\[([^\]]+)\]\s*(.+)$', label)
                if b and not re.search(r'暂缺|部分|官网', b.group(1)):
                    books.setdefault(rel, re.sub(r'\s*[（(].*$|[：:].*$', '', b.group(2)).strip())
                    break
    return books


BOOKS = {}

# Contents sections whose pages are each a class or a race
ARTICLE_SECTIONS = [(re.compile(r'^(\d+\.\s*)?(新)?进阶职业'), '进阶职业'), (re.compile(r'^(\d+\.\s*)?(新|基础)?职业$|^(\d+\.\s*)?基础职业'), '职业'),
                    (re.compile(r'^(\d+\.\s*)?(新|海洋|其他)?种族$'), '种族')]
NOT_ARTICLE = re.compile(r'年龄|身高|体重|表|介绍|简介|概述|选择|创造|设计|调整|规则|说明|列表|附录|总览|一览|前言|替代|变体|犯错|随谈|领域|常见|血脉|自发|其他|传奇|一般|强力|[：:？?]|^进阶职业$|^职业$|^种族$')


def quick_reference(stack, label):
    """A race or base class in the contents' quick reference ("速查"): ("人类", "种族"), else None"""
    m = re.match(r'^\[[^\]]+\]\s*(.+)$', label)
    if not m:
        return None
    name = re.split(r'[/／(（]', m.group(1))[0].strip()
    if any(x.startswith('种族') for x in stack):
        return name, '种族'
    # A class, not one of its variants (those sit under the class)
    if any(x.startswith('基础职业') for x in stack) and not stack[-1].startswith('['):
        return name, '职业'
    return None


def toc_articles(root):
    """[(rel, name, section)] for the class, prestige class and race pages and the magic item sets in the contents"""
    t = open(os.path.join(root, 'Contents.hhc'), 'rb').read().decode('gb18030', 'replace')
    stack, out, last, seen = [], [], None, set()
    for m in re.finditer(r'<UL>|</UL>|<OBJECT type="text/sitemap">(.*?)</OBJECT>', t, re.S | re.I):
        g = m.group(0).upper()
        if g == '<UL>':
            stack.append(last or '')
            last = None
        elif g == '</UL>':
            if stack:
                stack.pop()
            last = None
        else:
            body = m.group(1)
            name = re.search(r'name="Name"\s+value="([^"]*)"', body, re.I)
            last = html.unescape(name.group(1)).strip() if name else ''
            loc = re.search(r'name="Local"\s+value="([^"]*)"', body, re.I)
            if not loc or not stack:
                continue
            rel = urllib.parse.unquote(loc.group(1).split('#')[0]).replace('/', os.sep)
            if any(x.startswith('速查') for x in stack):
                found = quick_reference(stack, last)
                if found and HAS_CJK.search(found[0]) and rel not in seen:
                    seen.add(rel)
                    out.append((rel,) + found)
                continue
            section = '套装' if stack[-1].strip().startswith('魔法物品套装') else \
                next((s for pattern, s in ARTICLE_SECTIONS if pattern.search(stack[-1].strip())), None)
            label = re.sub(r'\s*[（(][^)）]*[)）]\s*|\s*\[[^\]]*\]\s*', '', last).strip()
            if section and label and not NOT_ARTICLE.search(label) and HAS_CJK.search(label) and rel not in seen:
                seen.add(rel)
                out.append((rel, label, section))
    return out


def article_of(root, rel, name, section):
    """A class or race page as an article: its English name from its title, its text"""
    lines = to_lines(decode(open(os.path.join(root, rel), 'rb').read()))
    en = ''
    for line in lines[:6]:
        t = parse_title(line)
        if t and t[1] and (t[0] == name or name in t[0] or t[0] in name):
            en = t[1]
            break
    text = []
    for line in lines:
        plain = plain_of(line)
        if re.match(r'^(反馈本页勘误|返回目录|返回顶部|上一页|下一页)$', plain):
            continue
        if not text and (plain == name or (en and en in plain and len(plain) < 60)):
            continue
        s = to_text(line)
        if heading_level(line) and not s.startswith('**'):
            s = '**' + s + '**'
        text.append(s)
    body = re.sub(r'\n{3,}', '\n\n', '\n'.join(text)).strip()
    if len(body) < 200:
        return None
    return {'name': name, 'en': en, 'source': '', 'tags': [], 'body': [['', body]], 'kind': '条目', 'section': section}


def source_of(rel):
    """The book: its folder ("FC1深渊堕群", named as the wiki names it), else the contents' name for it"""
    parts = rel.split(os.sep)[:-1]
    for part in parts:
        m = re.match(r'^[A-Za-z][A-Za-z0-9&＆\-]*([' + CJK + r'].*)$', part)
        if m:
            return re.sub(r'[（(].*$', '', m.group(1)).strip()
    if rel in BOOKS:
        return BOOKS[rel]
    folder = parts[-1] if parts else ''
    return path_source(rel) or re.sub(r'^[0-9 .]+|\s*[（(].*$', '', folder).strip()


def path_source(rel):
    """The folder after a setting's ("OA-L5R/麓燕战役设定集")"""
    parts = rel.split(os.sep)[:-1]
    for n, part in enumerate(parts):
        if n and re.match(r'^[A-Za-z][A-Za-z0-9&＆\-]*$', part) and n + 1 < len(parts) and HAS_CJK.search(parts[n + 1]):
            return re.sub(r'^[0-9 ]+|[（(].*$', '', parts[n + 1]).strip()
    return ''


def clean_name(name, kind):
    """"天使：星界天使" -> "星界天使"; "新专长：公会青睐者" -> "公会青睐者"; a field label is no name"""
    name = name.strip()
    m = re.match(r'^([^：:]{1,8})[：:]\s*(.+)$', name)
    if m:
        if label_of(m.group(1)):
            return ''
        name = m.group(2).strip()
    return name


def to_text(line):
    """Body line: bold as **…**"""
    s = re.sub(r'^#h\d ', '', line)
    s = s.replace('\x01', '**').replace('\x02', '**')
    s = re.sub(r'\*\*\s*\*\*', '', s)
    if s.count('**') % 2:
        s = s.replace('**', '')
    return s.strip()


def classify(labels, tags, title_tags_text):
    L = set(labels)
    def n(*names):
        return sum(1 for x in names if x in L)
    if n('生命骰') and n('防御等级') and n('先攻', '速度', '攻击', '全力攻击', '豁免', '属性', '技能', '专长', '特殊攻击', '特殊特性', '挑战等级') >= 5:
        return '怪物'
    if n('价格') and n('灵光', '施法者等级', '部位', '制造条件', '制造耗费') >= 1 and not n('施法时间', '显能时间'):
        return '物品'
    if n('显能时间', '灵能点') and n('距离', '持续时间', '异象', '灵能抗力', '目标', '效果') >= 2:
        return '灵能'
    if n('流派') or (n('发动时间') and n('等级') and not n('施法时间')):
        return '武术'
    if n('施法时间', '法术成分') and n('等级', '距离', '持续时间', '豁免检定', '豁免', '法术抗力', '目标', '效果', '区域') >= 3:
        return '法术'
    if '专长' in title_tags_text and n('效果', '先决条件', '特殊', '正常'):
        return '专长'
    if n('先决条件') and n('效果') and not n('价格', '施法时间', '施法者等级', '灵光'):
        return '专长'
    return None


def entries_of(lines):
    """Splits a page's lines at entry titles: [(title line index, end)]"""
    marks = []
    for i, line in enumerate(lines):
        t = parse_title(line)
        if not t:
            continue
        head = heading_level(line)
        nxt = [plain_of(x) for x in lines[i + 1:i + 4]]
        fieldish = any(field_of(x) for x in nxt) or any(SCHOOL.match(x) for x in nxt[:1])
        if head or all_bold(line):
            if t[1] or fieldish:
                marks.append((i, head))
        elif t[1] and fieldish and len(plain_of(line)) < 50:
            marks.append((i, None))
    spans = []
    for k, (i, head) in enumerate(marks):
        end = marks[k + 1][0] if k + 1 < len(marks) else len(lines)
        for j in range(i + 1, end):
            h = heading_level(lines[j])
            if h and (head is None or h <= head):
                end = j
                break
        spans.append((i, min(end, i + 300)))
    return spans


SIZE_WORDS = '|'.join(sorted(SIZES, key=len, reverse=True))
SIZE_TYPE = re.compile(r'^(' + SIZE_WORDS + r')\s*([^\s。；，,].{0,40})$')


def header_cell(cell):
    """A stat table's column head: "波达尸 (Bodak) 中型不死生物（外界）" -> ("波达尸 (Bodak)", "中型不死生物（外界）")"""
    m = re.match(r'^(.*?[)）A-Za-z' + CJK + r'])\s+((?:' + SIZE_WORDS + r')\s*[' + CJK + r'].{0,40})$', cell)
    if m and not SIZE_TYPE.match(cell):
        return m.group(1).strip(), m.group(2).strip()
    return cell, None


def statblock_starts(lines, i, end):
    """Where a second (third…) stat block starts in an entry: the bold line or table head that names it"""
    starts, seen, low = [], False, i + 1
    for j in range(i + 1, end):
        f = field_of(plain_of(lines[j]))
        # A class's "生命骰：d8" is no stat block
        if not f or f[0] != '生命骰' or re.match(r'^d\d+', str(f[2]).strip()):
            continue
        if seen:
            for k in range(j - 1, max(low, j - 8) - 1, -1):
                plain = plain_of(lines[k])
                if re.match(r'^资料栏位?\s*\|', plain) or (
                        (all_bold(lines[k]) or heading_level(lines[k])) and len(plain) <= 40 and not field_of(plain)):
                    starts.append(k)
                    low = j + 1
                    break
        seen = True
    return starts


def block_title(line):
    """The name over a later stat block: "3个 野蛮人衍体 CR5", "阿曼德守夜人，等级4武僧", a table head"""
    plain = plain_of(line)
    if re.match(r'^资料栏位?\s*\|', plain):
        plain = header_cell(plain.split(' | ')[1].strip())[0]
    plain = re.sub(r'^\d+\s*[个只名位]\s*|\s*(CR|ＣＲ)\s*[\d/]*\s*$', '', plain).strip()
    t = parse_title(plain)
    if t:
        return t
    # "海獭（Otter，…": the English up to the first comma
    m = re.match(r'^([' + CJK + r']{1,16})\s*[（(]\s*([A-Za-z][A-Za-z \'’\-]+)', plain)
    if m:
        return m.group(1), nice_en(m.group(2)), []
    name = re.split(r'[，,：:]', plain)[0].strip()
    return (name, '', []) if HAS_CJK.search(name) and len(name) <= 16 else None


def build_record(lines, i, end, rel, title=None):
    """Fields and text of an entry, in the page's order"""
    name, en, tags = title or parse_title(lines[i])
    segments = []  # ['field', label, value or [values]] | ['text', text]
    labels = []
    first_free = None
    size_type = None
    header = None
    header_types = []
    cr_hint = None
    last = None
    skip = set()
    # A later stat block named by its table head: the head is read too (its size and type)
    head_row = bool(re.match(r'^资料栏位?\s*\|', plain_of(lines[i])))
    for j in range(i if head_row else i + 1, end):
        if j in skip:
            continue
        plain = plain_of(lines[j])
        if re.match(r'^资料栏位?\s*\|', plain):
            cells = [header_cell(c.strip()) for c in plain.split(' | ')[1:]]
            if header is None:
                header = [c[0] for c in cells]
                header_types = [c[1] for c in cells]
            continue
        if re.match(r'^(反馈本页勘误|返回目录|返回顶部|上一页|下一页)$', plain):
            continue
        f = field_of(plain)
        # A label met again is the text's (a monster's 技能 note under its block)
        if f and f[0] in labels and f[0] not in ('目标', '效果'):
            f = None
        if f and f[2] == '' and j + 1 < end:
            nxt = plain_of(lines[j + 1])
            if nxt and not field_of(nxt) and not heading_level(lines[j + 1]) and not all_bold(lines[j + 1]):
                f = (f[0], f[1], nxt)
                skip.add(j + 1)
        if f:
            lab, raw, val = f
            labels.append(lab)
            segments.append(['field', lab, val])
            last = lab
            continue
        cr = re.search(r'挑战(?:级数|等级)\s*[:：]?\s*(\d+(?:/\d+)?)', plain)
        if cr and cr_hint is None:
            cr_hint = cr.group(1)
        head = plain.split(' | ')[0]
        if size_type is None and not labels and SIZE_TYPE.match(head):
            size_type = head
            if ' | ' in plain:
                continue
        if size_type == head and ' | ' not in plain:
            continue
        if not labels and first_free is None and len(plain) <= 40 and not re.search(r'[。；]', plain) and not heading_level(lines[j]):
            first_free = plain
            continue
        if last in TEXT_FIELDS and not heading_level(lines[j]) and segments[-1][0] == 'field' and isinstance(segments[-1][2], str):
            segments[-1][2] += '\n' + to_text(lines[j])
            continue
        last = None
        segments.append(['text', to_text(lines[j])])
    if first_free and not size_type and SIZE_TYPE.match(first_free):
        size_type, first_free = first_free, None
    return dict(name=name, en=en, tags=tags, segments=segments, labels=labels, first=first_free,
                size_type=size_type, header=header, header_types=header_types, cr=cr_hint, rel=rel)


def item_class(name, rel, fields):
    get = dict(fields)
    path = rel.replace(os.sep, '/')
    if re.search(r'(戒指|指环|之戒)$', name) or '/戒指' in path or '戒指' in get.get('部位', ''):
        return '戒指'
    for word in ('权杖', '法杖', '魔杖', '药水', '卷轴', '神器'):
        if name.endswith(word) or ('/' + word) in path:
            return word
    if re.search(r'盾$|盾牌', name):
        return '盾牌'
    if re.search(r'武器|弹药', path) or '伤害' in get or re.search(r'(剑|刀|斧|锤|矛|枪|弓|弩|匕首|鞭|镰|戟|棍|连枷|箭|弹)$', name):
        return '武器'
    if re.search(r'盔甲|护甲|防具|铠甲', path) or re.search(r'(甲|铠|锁子衫|链甲衫)$', name):
        return '防具'
    if re.search(r'灵能', path):
        return '灵能物品'
    return '奇物'


FEAT_TYPES = {'一般', '战士', '超魔', '制造物品', '传奇', '灵能', '种族', '神圣', '崇善', '秽恶', '怪物', '战术', '法储', '血脉',
              '龙脉', '魂能', '野性', '领域', '幸运', '超能', '入信者', '武器', '伏击', '超喷吐', '异怪', '兽化', '吟唱', '传古',
              '污化', '区域', '地区', '龙纹', '天赋', '先祖', '武技', '武术', '技艺', '外貌', '信仰', '执念', '英雄', '恶棍', '武僧',
              '心灵', '奥术', '死灵', '暗影', '真名', '契约', '战斗', '一般专长'}


def feat_type(tags):
    for t in tags:
        t = t.strip()
        if t.endswith('专长'):
            return t
        if t in FEAT_TYPES:
            return t + '专长'
    return ''


def clean_value(v):
    v = v.replace('\x01', '').replace('\x02', '')
    v = re.sub(r'\n{3,}', '\n\n', v).strip()
    if '\n' not in v:
        v = v.replace('**', '').strip()
        # A short value is a table cell: no closing punctuation
        if len(v) <= 80:
            v = re.sub(r'[。；;，,]+$', '', v)
    return v


def finish(rec, kind, source, column=None):
    """Record in build.mjs's shape: short fields as rows, long ones and the text as body"""
    lead = []
    if kind == '物品':
        lead.append(['类别', item_class(rec['name'], rec['rel'], [s[1:] for s in rec['segments'] if s[0] == 'field'])])
    elif kind == '专长':
        # From the title's tag, else the heading or file it is under ("龙纹专长"); a bare "专长" says nothing
        t = feat_type(rec['tags']) or (rec.get('section') if rec.get('section', '') != '专长' else '')
        if t and t.endswith('专长'):
            lead.append(['类型', t])
    elif kind == '法术' and rec['first'] and SCHOOL.match(rec['first']):
        lead.append(['学派', rec['first']])
    elif kind == '灵能' and rec['first']:
        lead.append(['能系', rec['first']])
    elif kind == '怪物':
        types = rec.get('header_types') or []
        size_type = (types[column or 0] if len(types) > (column or 0) else None) or rec['size_type'] or ''
        for s in rec['segments']:
            if s[0] == 'field' and s[1] == '体型/类型':
                size_type = s[2][column] if isinstance(s[2], list) else s[2]
        m = SIZE_TYPE.match(size_type)
        if m:
            sub = re.search(r'[\(（](.+?)[\)）]', m.group(2))
            lead.append(['体型', m.group(1)])
            lead.append(['类型', re.sub(r'\s*[\(（].*$', '', m.group(2)).strip()])
            if sub:
                lead.append(['亚种', sub.group(1)])
        else:
            # A table with no type row: the size in the name ("大型火元素") sizes the token
            size = re.match(r'^(' + SIZE_WORDS + r')', rec['name'])
            if size:
                lead.append(['体型', size.group(1)])
    rows, body = [], []
    # The short line under the title, when it was not the school or discipline
    texts = [] if rec['first'] and any(v == rec['first'] for _, v in lead) or not rec['first'] else [rec['first']]

    def flush():
        text = re.sub(r'\n{3,}', '\n\n', '\n'.join(x for x in texts if x)).strip()
        if text:
            body.append(['', text])
        texts.clear()

    for k, v in lead:
        if v:
            rows.append([k, v])
    for s in rec['segments']:
        if s[0] == 'text':
            texts.append(s[1])
            continue
        _, k, v = s
        if isinstance(v, list):
            v = v[column] if column is not None and column < len(v) else v[0]
        if kind == '怪物' and k == '体型/类型':
            continue
        if kind == '物品' and k == '先决条件':
            k = '制造条件'
        if kind in ('法术', '灵能', '武术') and k == '豁免':
            k = '豁免检定'
        v = clean_value(v)
        if not v:
            continue
        if k == '描述':
            texts.append(v)
        elif len(v) > 80 or '\n' in v:
            flush()
            body.append([k, v])
        else:
            rows.append([k, v])
    flush()
    if kind == '怪物' and rec.get('cr') and not any(k == '挑战等级' for k, _ in rows):
        rows.append(['挑战等级', rec['cr']])
    if kind == '怪物':
        # A dragon's table gives each age its CR: "雏龙3、幼龙5、少年龙7…" -> 少年赤铜龙's is 7
        for row in rows:
            ages = re.findall(r'([' + CJK + r']+?)龙?\s*(\d+(?:/\d+)?)', row[1]) if row[0] == '挑战等级' else []
            mine = [cr for age, cr in ages if rec['name'].startswith(age)]
            if len(ages) > 1 and mine:
                row[1] = max(((age, cr) for age, cr in ages if rec['name'].startswith(age)), key=lambda x: len(x[0]))[1]
    out = {'name': rec['name'], 'en': rec['en'], 'source': source}
    if rows:
        out['fields'] = rows
    if body:
        out['body'] = body
    if kind == '怪物':
        out['stats'] = monster_stats(dict(rows + [[k, v] for k, v in body if k]), lead)
    return out


def monster_stats(get, lead):
    def number(s):
        m = re.search(r'[+\-−]?\d+', s or '')
        return int(m.group(0).replace('−', '-')) if m else None
    size = dict(lead).get('体型', '')
    hp = re.search(r'(\d+)\s*(?:hp|生命值|点|HP)', get.get('生命骰', ''), re.I)
    return {
        'size': SIZE_CELLS.get(size, 1),
        'ac': number(get.get('防御等级', '')),
        'hp': int(hp.group(1)) if hp else None,
        'init': number(get.get('先攻', '')) or 0,
        'cr': re.sub(r'[^0-9/]', '', get.get('挑战等级', '')),
    }


FEAT_LABELS = {'先决条件', '效果', '正常', '特殊'}
SPELL_LABELS = {'等级', '法术成分', '施法时间', '距离', '目标', '效果', '区域', '持续时间', '豁免检定', '豁免', '法术抗力'}
# "X专长" headings that name no type
NOT_FEAT_TYPE = {'新', '其他', '额外', '相关', '可选', '附加', '更多', '选择', '的', '一些', '以下', '各种', '本章', '这些'}


def section_of(lines, i, rel):
    """What the entry sits under: a feat type ("龙纹专长") or 法术, from the nearest heading or the file's name"""
    names = [plain_of(lines[k]) for k in range(i - 1, -1, -1) if heading_level(lines[k])][:3]
    for text in names + [os.path.splitext(os.path.basename(rel))[0]]:
        m = re.search(r'([' + CJK + r']{1,5})专长', text)
        if m and m.group(1) not in NOT_FEAT_TYPE and not m.group(1).endswith(('新', '的')):
            return m.group(1) + '专长'
        if '专长' in text:
            return '专长'
        if '法术' in text:
            return '法术'
    return ''


def kind_of(rec, rel, section):
    """The entry's kind from its labels, its title's tags and what it sits under"""
    kind = classify(rec['labels'], rec['tags'], ' '.join(rec['tags']))
    feat_context = feat_type(rec['tags']) or '专长' in rel or section.endswith('专长')
    if kind == '专长' and not feat_context:
        return None
    labels = set(rec['labels'])
    # A feat without prerequisites: only its 效果 (and 特殊 / 正常)
    if not kind and labels and labels <= FEAT_LABELS and '效果' in labels and feat_context \
            and not re.search(r'仪式|指挥官|^替代能力', rec['name']):
        return '专长'
    # A spell in short: its level ("修验者2") and a few lines
    level = next((s[2] for s in rec['segments'] if s[0] == 'field' and s[1] == '等级' and isinstance(s[2], str)), '')
    if not kind and labels <= SPELL_LABELS and len(labels) >= 2 and re.match(r'^[' + CJK + r'/、，, ]+\s*\d', level) \
            and ('法术' in rel or section == '法术'):
        return '法术'
    return kind


def entry_records(lines, i, end, rel, source, unclassified):
    """The records an entry gives: one, one a column of a stat table, or one a stat block"""
    section = section_of(lines, i, rel)
    starts = statblock_starts(lines, i, end)
    if starts:
        first = build_record(lines, i, starts[0], rel)
        if kind_of(first, rel, section) == '怪物':
            out = records_from(first, '怪物', source, rel, section)
            bounds = starts + [end]
            for a, b in zip(starts, bounds[1:]):
                title = block_title(lines[a])
                if not title:
                    continue
                rec = build_record(lines, a, b, rel, title)
                if kind_of(rec, rel, section) == '怪物':
                    out += records_from(rec, '怪物', source, rel, section)
            return out
    rec = build_record(lines, i, end, rel)
    kind = kind_of(rec, rel, section)
    if not kind:
        if rec['labels']:
            unclassified[tuple(sorted(set(rec['labels'])))] += 1
        return []
    return records_from(rec, kind, source, rel, section)


def records_from(rec, kind, source, rel, section):
    rec['name'] = clean_name(rec['name'], kind)
    rec['section'] = section
    # A school or discipline line is no spell's name
    if kind in ('法术', '灵能') and SCHOOL.match(rec['name']) and rec['name'].endswith('系'):
        return []
    # Without an English name only a feat with its type, or a block with many fields
    if not rec['name'] or not (rec['en'] or (kind == '专长' and (feat_type(rec['tags']) or section.endswith('专长'))) or (
            len(set(rec['labels'])) >= (2 if kind == '专长' else 5) and len(rec['name']) <= 12
            and not re.search(r'说明|解释|名称|列表|章|节|表|规则', rec['name'])
            and not re.match(r'^[0-9一二三四五六七八九十]', rec['name']))):
        return []
    # A size or a size and type is no monster's name ("超大型", "大体型异界生物"), nor is a template's how-to
    if kind == '怪物' and (rec['name'] in SIZES or SIZE_TYPE.match(rec['name']) and not rec['en']
                          or re.match(r'^(' + SIZE_WORDS + r'|大体型|中体型|小体型)[' + CJK + r']{0,3}(生物|类)$', rec['name'])
                          or re.match(r'^创造', rec['name'])):
        return []
    # A feat table's head or a feat type is no feat ("专长名称", "秽恶专长")
    if kind == '专长' and (rec['name'].endswith('专长') or rec['name'] in ('专长名称', '专长说明')):
        return []
    file = rel.replace(os.sep, '/')
    out = []
    if kind == '怪物' and rec['header'] and len(rec['header']) > 1:
        # Monsters side by side: one record a column; a column headed by a size is that size of the monster
        for column, title in enumerate(rec['header']):
            t = (title + rec['name'], '', []) if title in SIZES else parse_title(title)
            if not t:
                continue
            one = dict(rec, name=clean_name(t[0], kind), en=t[1])
            r = finish(one, kind, source, column)
            r['kind'], r['file'] = kind, file
            out.append(r)
        return out
    if kind == '怪物' and rec['header'] and len(rec['header']) == 1:
        t = parse_title(rec['header'][0])
        if t and t[1]:
            rec['name'], rec['en'] = clean_name(t[0], kind), t[1]
    r = finish(rec, kind, source)
    r['kind'], r['file'] = kind, file
    return [r]


def main():
    root, out = sys.argv[1], sys.argv[2]
    BOOKS.update(toc_books(root))
    files =[f for f in toc_files(root) if f.lower().endswith(('.htm', '.html'))]
    seen = set(files)
    for d, _, fs in os.walk(root):
        for f in sorted(fs):
            rel = os.path.relpath(os.path.join(d, f), root)
            if rel.lower().endswith(('.htm', '.html')) and rel not in seen:
                files.append(rel)
                seen.add(rel)
    records = []
    unclassified = collections.Counter()
    for rel in files:
        p = os.path.join(root, rel)
        # The appendix (reviews, tables of other pages) is not rules text
        if not os.path.isfile(p) or rel.startswith('10 '):
            continue
        lines = to_lines(decode(open(p, 'rb').read()))
        source = source_of(rel)
        for i, end in entries_of(lines):
            records += entry_records(lines, i, end, rel, source, unclassified)
    for rel, name, section in toc_articles(root):
        if rel.startswith('10 ') or not os.path.isfile(os.path.join(root, rel)):
            continue
        r = article_of(root, rel, name, section)
        if not r:
            continue
        r['file'] = rel.replace(os.sep, '/')
        if section == '套装':
            # A magic item set: an item whose text is the whole page
            r.update(kind='物品', source=source_of(rel), fields=[['类别', '套装']], tags=[])
            del r['section']
        else:
            r['tags'] = [t for t in (source_of(rel), section) if t]
        records.append(r)
    json.dump(records, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
    c = collections.Counter(r['kind'] for r in records)
    print(len(records), dict(c))
    print(collections.Counter(r['section'] for r in records if r['kind'] == '条目'))
    print('unclassified label sets:', unclassified.most_common(10))


if __name__ == '__main__':
    main()
