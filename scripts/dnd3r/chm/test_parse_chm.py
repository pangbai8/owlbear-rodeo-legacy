"""py -3.13 -I -m unittest discover -s scripts/dnd3r/chm

Small pages written the ways the CHM's translators wrote them.
"""
import collections, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse_chm as P
from htmltext import to_lines


def records(html, rel=os.path.join('2 书', 'MIC万物大全', '穿戴物', '双手.htm')):
    lines = to_lines(html)
    out = []
    for i, end in P.entries_of(lines):
        out += P.entry_records(lines, i, end, rel, P.source_of(rel), collections.Counter())
    return out


def fields(record):
    return dict(record.get('fields', []))


class Items(unittest.TestCase):
    def test_bold_title_and_labels(self):
        [r] = records('<p><b>奥术师手套（ARCANIST\'S GLOVES）</b></p>'
                      '<p><b>价格</b>（物品等级）：500GP（3）</p><p><b>部位</b>：双手</p>'
                      '<p><b>施法者等级</b>：3</p><p><b>灵光</b>：轻度变化系（DC16）</p>'
                      '<p><b>效果</b>：每天两次，启动后使你在该轮施放的一个1级奥术的施法者等级增加2。</p>')
        self.assertEqual((r['kind'], r['name'], r['en'], r['source']), ('物品', '奥术师手套', "Arcanist's Gloves", '万物大全'))
        self.assertEqual(fields(r)['价格'], '500GP（3）')
        self.assertEqual(fields(r)['类别'], '奇物')

    def test_name_starting_in_latin_letters(self):
        [r] = records('<p><b>Cli七弦琴（Cli Lyre）</b></p><p><b>价格</b>：18100GP</p>'
                      '<p><b>施法者等级</b>：11级</p><p><b>灵光</b>：中等</p>')
        self.assertEqual((r['name'], r['en']), ('Cli七弦琴', 'Cli Lyre'))

    def test_label_with_its_value_on_the_next_line(self):
        [r] = records('<h4>回力手套 (Gauntlets of Throwing)</h4><p><b>价格:</b></p><p>2000GP</p>'
                      '<p><b>灵光:</b></p><p>轻度变化系</p><p><b>施法者等级:</b></p><p>3</p>')
        self.assertEqual(fields(r)['价格'], '2000GP')
        self.assertEqual(fields(r)['灵光'], '轻度变化系')


STAT_ROWS = ''.join(f'<tr><td>{k}</td><td>{v}</td></tr>' for k, v in [
    ('生命骰', '6d8+18 (45HP)'), ('先攻', '+6'), ('速度', '5英尺'), ('防御等级', '19 (+2敏捷、+7天生)、接触12、措手不及17'),
    ('攻击', '啮咬-2近战 (1d6-1)'), ('豁免', '强韧+5、反射+4、意志+9'), ('属性', '力量8、敏捷14、体质16、智力15、感知15、魅力13'),
    ('技能', '侦察+17'), ('挑战级数', '6')])
MM = os.path.join('0 书', 'MM怪物图鉴', '第一章：怪物', 'B', '眼魔.htm')


class Monsters(unittest.TestCase):
    def test_size_and_type_in_the_table_head(self):
        [r] = records('<h1>波达尸 (Bodak)</h1><p>灰皮肤的人形生物。</p>'
                      f'<table><tr><td>资料栏位</td><td>波达尸 (Bodak) 中型不死生物（外界）</td></tr>{STAT_ROWS}</table>', MM)
        self.assertEqual(r['kind'], '怪物')
        self.assertEqual([fields(r)[k] for k in ('体型', '类型', '亚种')], ['中型', '不死生物', '外界'])
        self.assertEqual(r['stats'], {'size': 1, 'ac': 19, 'hp': 45, 'init': 6, 'cr': '6'})

    def test_a_second_stat_block_is_a_monster_of_its_own(self):
        out = records('<h1>阿曼德 (Armand)</h1>'
                      f'<table><tr><td>资料栏位</td><td>阿曼德 (Armand) 小型人形怪物</td></tr>{STAT_ROWS}</table>'
                      '<p>阿曼德的社会。</p><p><b>阿曼德守夜人，等级4武僧</b></p>'
                      f'<table>{STAT_ROWS}</table>', MM)
        self.assertEqual([r['name'] for r in out], ['阿曼德', '阿曼德守夜人'])
        self.assertNotIn('生命骰', out[0]['body'][-1][1] if out[0].get('body') else '')

    def test_columns_named_by_size(self):
        rows = ''.join(f'<tr><td>{k}</td><td>{v}</td><td>{v}</td></tr>' for k, v in [
            ('生命骰', '2d8 (9HP)'), ('先攻', '+5'), ('速度', '50英尺'), ('防御等级', '15'), ('攻击', '挥击+3近战'),
            ('豁免', '强韧+0'), ('属性', '力量10'), ('技能', '聆听+2'), ('挑战级数', '1')])
        out = records('<h1>火元素 (Fire Elemental)</h1>'
                      f'<table><tr><td>资料栏位</td><td>小型</td><td>大型</td></tr>{rows}</table>', MM)
        self.assertEqual([(r['name'], fields(r)['体型'], r['stats']['size']) for r in out],
                         [('小型火元素', '小型', 1), ('大型火元素', '大型', 2)])

    def test_a_dragon_age_gets_its_own_cr(self):
        rows = STAT_ROWS.replace('<td>6</td>', '<td>雏龙3、幼龙5、少年龙7、青少年龙9</td>')
        [r] = records('<h1>赤铜龙 (Copper Dragon)</h1>'
                      f'<table><tr><td>资料栏位</td><td>青少年赤铜龙 (Juvenile Copper Dragon) 大型龙 (土系)</td></tr>{rows}</table>', MM)
        self.assertEqual((r['name'], fields(r)['挑战等级']), ('青少年赤铜龙', '9'))


class Feats(unittest.TestCase):
    def test_a_feat_without_prerequisites_under_a_feat_heading(self):
        rel = os.path.join('9 世设', 'ToM魔法卷册', '专长.htm')
        out = records('<h2>真名专长</h2><h4>启思 (Open Mind)</h4><p><b>效果</b>：你在意志豁免上获得+2加值。</p>'
                      '<p><b>特殊</b>：可多次选取。</p>', rel)
        self.assertEqual([(r['kind'], r['name'], fields(r).get('类型')) for r in out], [('专长', '启思', '真名专长')])

    def test_rituals_are_no_feats(self):
        rel = os.path.join('9 世设', 'PGtE艾伯伦玩家手册', '专长.htm')
        self.assertEqual(records('<h4>吐息仪式 (Ritual of Breath)</h4><p><b>效果</b>：获得吐息武器。</p>', rel), [])


if __name__ == '__main__':
    unittest.main()
