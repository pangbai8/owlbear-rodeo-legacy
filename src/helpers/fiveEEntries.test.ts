import { genericCard, itemCard, loadEntryCard, spellCard } from "./fiveEEntries";
import { entriesToText } from "./fiveEStatblock";
import { SearchResult } from "./fiveETools";

const fireball = {
  ENG_name: "Fireball",
  name: "火球术",
  source: "XPHB",
  level: 3,
  school: "V",
  time: [{ number: 1, unit: "action" }],
  range: { type: "point", distance: { type: "feet", amount: 150 } },
  components: { v: true, s: true, m: "一颗蝙蝠粪和硫磺搓成的小球" },
  duration: [{ type: "instant" }],
  entries: ["……受到{@damage 8d6}点火焰伤害。"],
  entriesHigherLevel: [
    { name: "升环施法", type: "entries", entries: ["此伤害就增加{@scaledamage 8d6|3-9|1d6}。"] },
  ],
};

test("spell card", () => {
  expect(spellCard(fireball)).toEqual({
    name: "火球术",
    englishName: "Fireball",
    subtitle: "3 环塑能",
    lines: [
      { label: "施法时间", text: "1 动作" },
      { label: "施法距离", text: "150 尺" },
      { label: "法术成分", text: "言语、姿势、材料（一颗蝙蝠粪和硫磺搓成的小球）" },
      { label: "持续时间", text: "立即" },
    ],
    paragraphs: ["……受到8d6点火焰伤害。", "升环施法。此伤害就增加1d6。"],
  });
  const guardians = spellCard({
    ...fireball,
    level: 0,
    school: "C",
    meta: { ritual: true },
    time: [{ number: 1, unit: "reaction", condition: "当你被{@spell 魔法飞弹}命中时" }],
    range: { type: "emanation", distance: { type: "feet", amount: 15 } },
    components: { v: true },
    duration: [{ type: "timed", duration: { type: "minute", amount: 10 }, concentration: true }],
  });
  expect(guardians.subtitle).toBe("咒法戏法（仪式）");
  expect(guardians.lines.map((l) => l.text)).toEqual([
    "1 反应，当你被魔法飞弹命中时",
    "自身（15 尺光环）",
    "言语",
    "专注，至多 10 分钟",
  ]);
});

test("item card", () => {
  const glossary = { types: { M: "近战武器", HA: "重甲" }, properties: { V: "多用", "2H": "双手" } };
  expect(
    itemCard(
      {
        ENG_name: "Longsword",
        name: "长剑",
        type: "M|XPHB",
        weight: 3,
        value: 1500,
        property: ["V|XPHB"],
        mastery: ["削弱|XPHB"],
        dmg1: "1d8",
        dmgType: "S",
        dmg2: "1d10",
      },
      glossary
    )
  ).toEqual({
    name: "长剑",
    englishName: "Longsword",
    subtitle: "近战武器",
    lines: [
      { label: "伤害", text: "1d8 挥砍（双手 1d10）" },
      { label: "属性", text: "多用" },
      { label: "精通", text: "削弱" },
      { label: "重量", text: "3 磅" },
      { label: "价格", text: "15 gp" },
    ],
    paragraphs: [],
  });
  const tablet = itemCard(
    { name: "黑晶石板", wondrous: true, rarity: "legendary", reqAttune: "由精通{@skill 奥秘}技能的生物", entries: ["x"] },
    glossary
  );
  expect(tablet.subtitle).toBe("奇物，传说（需由精通奥秘技能的生物同调）");
  expect(
    itemCard({ name: "投掷锤", type: "M", rarity: "very rare", reqAttune: "需矮人或与{@item 矮人腰带|XDMG}同调的生物" }, glossary).subtitle
  ).toBe("近战武器，非常珍稀（需矮人或与矮人腰带同调的生物）");
  expect(itemCard({ name: "板甲", type: "HA", ac: 18, reqAttune: true, rarity: "none" }, glossary)).toMatchObject({
    subtitle: "重甲（需同调）",
    lines: [{ label: "护甲等级", text: "18" }],
  });
});

test("tables in entries become rows", () => {
  expect(
    entriesToText([
      { type: "table", caption: "决策", colLabels: ["d4", "结果"], rows: [["1", "有利"], [{ roll: { min: 2, max: 4 } }, "{@b 不利}"]] },
    ])
  ).toEqual(["决策", "d4 | 结果", "1 | 有利", "2–4 | 不利"]);
});

test("generic card keeps the useful extra fields", () => {
  expect(genericCard({ name: "托姆", ENG_name: "Torm", pantheon: "被遗忘的国度", domains: ["战争", "秩序"], entries: [] }, "神祇")).toEqual({
    name: "托姆",
    englishName: "Torm",
    subtitle: "神祇",
    lines: [
      { label: "神系", text: "被遗忘的国度" },
      { label: "领域", text: "战争、秩序" },
    ],
    paragraphs: [],
  });
});

describe("loadEntryCard", () => {
  const files: Record<string, any> = {
    "data/spells/index.json": { XPHB: "spells-xphb.json" },
    "data/spells/spells-xphb.json": { spell: [fireball] },
    "data/conditionsdiseases.json": {
      condition: [
        { ENG_name: "Grappled", name: "受擒", source: "PHB", entries: ["旧版"] },
        { ENG_name: "Grappled", name: "受擒", source: "XPHB", entries: ["速度归零。"] },
      ],
    },
  };
  beforeAll(() => {
    // A plain function: CRA resets jest.fn implementations before each test
    (global as any).fetch = (url: string) => {
      const path = url.replace(/^https:\/\/5e\.kiwee\.top\//, "");
      return Promise.resolve({ ok: path in files, status: 404, json: () => Promise.resolve(files[path]) });
    };
  });

  const result = (over: Partial<SearchResult>): SearchResult => ({
    id: 1,
    name: "",
    englishName: "",
    category: 2,
    categoryLabel: "法术",
    source: "XPHB",
    url: "",
    reprinted: false,
    isMonster: false,
    ...over,
  });

  test("finds spells per book and records by name and source", async () => {
    expect((await loadEntryCard(result({ name: "火球术", englishName: "Fireball" })))?.subtitle).toBe("3 环塑能");
    const grappled = await loadEntryCard(result({ name: "受擒", englishName: "Grappled", category: 6, categoryLabel: "状态" }));
    expect(grappled?.paragraphs).toEqual(["速度归零。"]);
  });

  test("returns null when the record is missing", async () => {
    expect(await loadEntryCard(result({ englishName: "Nope" }))).toBeNull();
    expect(await loadEntryCard(result({ englishName: "Fireball", source: "XYZ" }))).toBeNull();
  });
});
