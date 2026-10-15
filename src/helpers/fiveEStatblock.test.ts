import { entriesToText, renderTags, statblock } from "./fiveEStatblock";

test("renderTags turns 5etools markup into readable text", () => {
  expect(
    renderTags(
      "{@atkr m} {@hit 4}，触及 5 英尺。{@h}5（{@damage 1d6 + 2}）挥砍伤害，若攻击检定具有{@variantrule 优势|XPHB}"
    )
  ).toBe("近战攻击检定：+4，触及 5 英尺。命中：5（1d6 + 2）挥砍伤害，若攻击检定具有优势");
  expect(renderTags("{@actSave dex} {@dc 15}。{@actSaveFail} 受伤。{@actSaveSuccess} 减半。")).toBe(
    "敏捷豁免：DC 15。豁免失败：受伤。豁免成功：减半。"
  );
  expect(renderTags("吐息{@recharge 5}")).toBe("吐息（充能 5–6）");
  expect(renderTags("{@spell 火球术|XPHB}与{@item 长剑|XPHB|一把长剑}")).toBe("火球术与一把长剑");
  expect(renderTags("{@hit -1}")).toBe("-1");
  expect(renderTags("{@actTrigger} 被攻击。{@actResponse} 换位。")).toBe("触发：被攻击。反应：换位。");
});

test("entriesToText flattens lists and named entries", () => {
  expect(
    entriesToText([
      "开头。",
      { type: "list", items: ["{@condition 目盲|XPHB}", { name: "甲", entries: ["乙"] }] },
    ])
  ).toEqual(["开头。", "• 目盲", "• 甲。乙"]);
});

const goblinBoss = {
  name: "地精头目",
  ENG_name: "Goblin Boss",
  source: "XMM",
  size: ["S"],
  type: { type: "fey", tags: ["类地精"] },
  alignment: ["C", "N"],
  ac: [17],
  hp: { average: 21, formula: "6d6" },
  speed: { walk: 30, fly: { number: 20, condition: "（悬浮）" } },
  str: 10,
  dex: 15,
  con: 10,
  int: 10,
  wis: 8,
  cha: 10,
  skill: { stealth: "+6" },
  immune: ["poison"],
  conditionImmune: ["poisoned"],
  senses: ["黑暗视觉 60 尺"],
  passive: 9,
  languages: ["通用语", "地精语"],
  cr: "1",
  gear: ["链甲衫|xphb", "弯刀|xphb"],
  action: [
    { name: "多重攻击", entries: ["地精发动两次攻击。"] },
    { name: "弯刀", entries: ["{@atkr m} {@hit 4}。{@h}5（{@damage 1d6 + 2}）挥砍伤害。"] },
  ],
  bonus: [{ name: "迅捷逃逸", entries: ["地精采取{@action 撤离|XPHB}动作。"] }],
  spellcasting: [
    {
      name: "施法",
      headerEntries: ["（法术豁免{@dc 13}）："],
      will: ["{@spell 法师之手|XPHB}"],
      daily: { "1e": ["{@spell 闪电束|XPHB}", "{@spell 羽落术|XPHB}"] },
      displayAs: "action",
    },
  ],
};

test("statblock summarises a monster", () => {
  const card = statblock(goblinBoss, 2);
  expect(card).toMatchObject({
    name: "地精头目",
    englishName: "Goblin Boss",
    subtitle: "小型精类（类地精），混乱中立",
    ac: "17",
    hp: "21（6d6）",
    speed: "30 尺，飞行 20 尺 （悬浮）",
    initiative: "+2",
  });
  expect(card.abilities.map((a) => `${a.label}${a.score}(${a.mod})`)).toEqual([
    "力量10(+0)",
    "敏捷15(+2)",
    "体质10(+0)",
    "智力10(+0)",
    "感知8(-1)",
    "魅力10(+0)",
  ]);
  expect(card.lines).toEqual([
    { label: "技能", text: "隐匿 +6" },
    { label: "免疫", text: "毒素；中毒" },
    { label: "感官", text: "黑暗视觉 60 尺，被动察觉 9" },
    { label: "语言", text: "通用语、地精语" },
    { label: "挑战", text: "1" },
    { label: "装备", text: "链甲衫、弯刀" },
  ]);
  expect(card.sections.map((s) => s.title)).toEqual(["动作", "附赠动作"]);
  const actions = card.sections[0].items;
  expect(actions[1]).toEqual({ name: "弯刀", paragraphs: ["近战攻击检定：+4。命中：5（1d6 + 2）挥砍伤害。"] });
  expect(actions[2]).toEqual({
    name: "施法",
    paragraphs: ["（法术豁免DC 13）：", "随意：法师之手", "1/日（每种）：闪电束、羽落术"],
  });
});
