// node --test scripts/dnd3r/build.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { articleEnglish, chmAdditions, cleanText, englishKeys, nearMatches, wikiTables } from "./build.mjs";

const byKind = {
  法术: [{ name: "法师裂解术", en: "Mage's Disjunction" }, { name: "心灵沉静", en: "Clarity of Mind" }],
  物品: [{ name: "-2诅咒剑", en: "-2 Sword, Cursed" }],
  专长: [{ name: "毁坏打击", en: "Razing Strike" }],
  条目: [{ name: "黑暗卫士", en: "Blackguard" }, { name: "巴哈姆特的封臣", en: "" }],
};
const chm = (kind, name, en = "") => ({ kind, name, en, source: "", file: "x.htm" });

test("English names match without a wizard's name, in either order, singular", () => {
  assert.ok(englishKeys("Mordenkainen's Disjunction").some((k) => englishKeys("Mage's Disjunction").includes(k)));
  assert.ok(englishKeys("Cursed -2 Sword").some((k) => englishKeys("-2 Sword, Cursed").includes(k)));
  assert.ok(englishKeys("Planars").includes("planar"));
});

test("the CHM adds only what the wiki lacks", () => {
  const added = chmAdditions(
    [
      chm("法术", "魔邓肯裂解术", "Mordenkainen's Disjunction"),
      chm("物品", "机运斗篷", "Mantle of Second Chances"),
      // Another translation of a wiki article, found by its English name
      chm("条目", "暗黑卫士", "Blackguard"),
      // No English: 之 and 的 are the same
      chm("条目", "巴哈姆特之封臣"),
      // English given: 之 / 的 alone does not make two entries one
      chm("专长", "火之守护", "Fire Ward"),
      chm("专长", "火的守护", "Fire Shield Ward"),
      // A typo a person has settled in same-as.json
      chm("法术", "澄晰心智", "Claroty of Mind"),
    ],
    byKind,
    {},
    { 法术: { 澄晰心智: "心灵沉静" } }
  );
  assert.deepEqual(added.法术, []);
  assert.deepEqual(added.条目, []);
  assert.deepEqual(added.物品.map((r) => r.name), ["机运斗篷"]);
  assert.deepEqual(added.专长.map((r) => r.name), ["火之守护", "火的守护"]);
  // The CHM's own fields are dropped
  assert.equal(added.物品[0].file, undefined);
});

test("near spellings are listed for a person, unless settled as different", () => {
  const added = { 专长: [{ name: "震魂击", en: "Hazing Strike" }], 法术: [], 物品: [], 条目: [] };
  assert.equal(nearMatches(added, byKind).length, 1);
  assert.equal(nearMatches(added, byKind, { different: { 震魂击: "毁坏打击" } }).length, 0);
});

test("a wiki article's English name comes from its header", () => {
  assert.equal(articleEnglish("{{条目头|出处=城主指南|类型=进阶职业|英文名=Blackguard}}\n正文"), "Blackguard");
  assert.equal(articleEnglish("没有条目头"), "");
});

test("a wiki table is a row a line, its header cells bold", () => {
  const table = "{| class=\"wikitable\"\n|+ '''进度表'''\n! 等级\n! 特殊\n \n|-\n| 1 || 取得灵域\n|-\n| style=\"text-align:center\" | 2\n| 读心\n继续\n|}";
  assert.equal(wikiTables(`前文\n${table}\n后文`), "前文\n'''进度表'''\n\u0001等级\u0001 | \u0001特殊\u0001\n1 | 取得灵域\n2 | 读心 继续\n后文");
  assert.equal(cleanText(table).split("\n")[1], "**等级** | **特殊**");
});

test("a class's templates keep their text", () => {
  const titles = new Set(["驯养动物", "技能专攻"]);
  const page = [
    "{{进阶需求\n|引言=要具备万兽王的资格：\n|技能={{技能|驯养动物}}8级\n|特殊2=能召唤动物\n}}",
    "'''本职技能：'''{{本职技能|攀爬|驯养动物|游泳}}。",
    "{{能力定义|动物之友|特异|Animal Companion}}\n获得一个动物伙伴。",
    "{{起始套组|侏儒吟游诗人起始套组\n|文本='''金钱：'''2d4 金币。\n}}",
    '<table class="wikitable">\n  <tr><th>技能</th><th>级数</th></tr>\n\n  <tr><td>{{技能|驯养动物}}</td><td>4</td></tr>\n</table>',
  ].join("\n\n");
  const text = cleanText(page, titles);
  for (const line of [
    "要具备万兽王的资格：",
    "**技能：**⟦驯养动物⟧8级",
    "**特殊：**能召唤动物",
    "**本职技能：**攀爬、驯养动物、游泳。",
    "**动物之友（特异）**",
    "**侏儒吟游诗人起始套组**",
    "**金钱：**2d4 金币。",
    "**技能** | **级数**\n⟦驯养动物⟧ | 4",
  ]) {
    assert.ok(text.includes(line), `${line}\n— not in —\n${text}`);
  }
});
