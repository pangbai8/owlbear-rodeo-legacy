import {
  describeRoll,
  describeSummary,
  formulaExpression,
  parseFormula,
  rollFormula,
  summarizeFormula,
  rollDice,
  rollExpression,
  splitChecks,
  splitDnd3rAttacks,
  TextPart,
  splitPf2Rolls,
  splitRolls,
} from "./fiveEDice";

test("attack bonuses and dice become rolls; the rest stays text", () => {
  expect(
    splitRolls("近战攻击检定：+4，触及5尺。命中：5 (1d6 + 2) 点挥砍伤害。")
  ).toEqual([
    "近战攻击检定：",
    { text: "+4", roll: { count: 1, sides: 20, modifier: 4 }, kind: "hit" },
    "，触及5尺。命中：5 (",
    { text: "1d6 + 2", roll: { count: 1, sides: 6, modifier: 2 }, kind: "damage" },
    ") 点挥砍伤害。",
  ]);
  // Older books: "命中+4"; spells: plain dice
  expect(splitRolls("近战武器攻击：命中+4")[1]).toMatchObject({ text: "+4", kind: "hit" });
  expect(splitRolls("受到8d6点火焰伤害")).toEqual([
    "受到",
    { text: "8d6", roll: { count: 8, sides: 6, modifier: 0 }, kind: "damage" },
    "点火焰伤害",
  ]);
  expect(splitRolls("21 (6d6)")[1]).toMatchObject({ roll: { count: 6, sides: 6 } });
  expect(splitRolls("d20 −1")[0]).toMatchObject({ roll: { count: 1, sides: 20, modifier: -1 }, kind: "check" });
  // Not dice: words, AC, DC
  expect(splitRolls("Goblin bad3 AC 15 DC 12")).toEqual(["Goblin bad3 AC 15 DC 12"]);
});

test("checks: every bonus in a skills or saves line", () => {
  expect(splitChecks("隐匿 +6，察觉 −1")).toEqual([
    "隐匿 ",
    { text: "+6", roll: { count: 1, sides: 20, modifier: 6 }, kind: "check" },
    "，察觉 ",
    { text: "−1", roll: { count: 1, sides: 20, modifier: -1 }, kind: "check" },
  ]);
});

test("rolling and describing", () => {
  const faces = [13];
  const hit = rollDice({ count: 1, sides: 20, modifier: 4 }, () => faces.shift()!);
  expect(hit.total).toBe(17);
  expect(describeRoll(hit)).toBe("1d20+4 = 17（13+4）");
  expect(describeRoll(rollDice({ count: 1, sides: 20, modifier: -1 }, () => 20))).toBe(
    "1d20−1 = 19（20−1）（天然 20！）"
  );
  const damage = rollDice({ count: 2, sides: 6, modifier: 0 }, (s) => s);
  expect(describeRoll(damage)).toBe("2d6 = 12（[6+6]）");
  expect(rollExpression({ count: 1, sides: 8, modifier: 0 })).toBe("1d8");
  // Real randomness stays in range
  for (let i = 0; i < 200; i++) {
    const n = rollDice({ count: 1, sides: 6, modifier: 0 }).rolls[0];
    expect(n >= 1 && n <= 6).toBe(true);
  }
});

test("PF2: strikes with the multiple attack penalty, spell attacks, damage", () => {
  const parts = splitPf2Rolls(
    "**近战** ◆ 斩马刀+8（触及10尺，摔绊，多用P），**伤害** 1d8+3挥砍"
  );
  expect(parts).toEqual([
    "**近战** ◆ 斩马刀",
    { text: "+8", roll: { count: 1, sides: 20, modifier: 8 }, kind: "hit", map: 5 },
    "（触及10尺，摔绊，多用P），**伤害** ",
    { text: "1d8+3", roll: { count: 1, sides: 8, modifier: 3 }, kind: "damage" },
    "挥砍",
  ]);
  expect(splitPf2Rolls("◆ 匕首+7（灵巧，敏捷）")[1]).toMatchObject({ map: 4 });
  expect(splitPf2Rolls("奥术先天法术 DC 20，法术攻击 +12；")).toEqual([
    "奥术先天法术 DC 20，法术攻击 ",
    { text: "+12", roll: { count: 1, sides: 20, modifier: 12 }, kind: "hit" },
    "；",
  ]);
});

test("PF2: trait dice like 致命d10 stay text", () => {
  const parts = splitPf2Rolls("◆ 短弓+8（致命d10，射程增量60尺），**伤害** 1d6穿刺");
  expect(parts.filter((p) => typeof p !== "string").map((p) => (p as any).text)).toEqual([
    "+8",
    "1d6",
  ]);
  expect(parts[2]).toBe("（致命d10，射程增量60尺），**伤害** ");
});

test("typed formulas: dice terms and a flat modifier", () => {
  expect(parseFormula("1d20+7")).toEqual({ dice: [{ count: 1, sides: 20, sign: 1 }], modifier: 7 });
  expect(parseFormula("+7")).toEqual({ dice: [{ count: 1, sides: 20, sign: 1 }], modifier: 7 });
  expect(parseFormula("2d6 ＋ 1d8 − 1")).toEqual({
    dice: [
      { count: 2, sides: 6, sign: 1 },
      { count: 1, sides: 8, sign: 1 },
    ],
    modifier: -1,
  });
  expect(parseFormula("d20")).toEqual({ dice: [{ count: 1, sides: 20, sign: 1 }], modifier: 0 });
  expect(parseFormula("7")).toBeNull();
  expect(parseFormula("火球")).toBeNull();
  expect(parseFormula("1d20+")).toBeNull();
  expect(parseFormula("")).toBeNull();
  expect(formulaExpression(parseFormula("2d6+1d8-1")!)).toBe("2d6+1d8−1");
});

test("formula rolls are summed and described like card rolls", () => {
  const faces = [3, 4, 5];
  const result = rollFormula(parseFormula("2d6+1d8+3")!, () => faces.shift()!);
  expect(result.total).toBe(15);
  expect(describeSummary(summarizeFormula(result))).toBe("2d6+1d8+3 = 15（[3+4]+5+3）");
  const nat = rollFormula(parseFormula("+5")!, () => 20);
  expect(describeSummary(summarizeFormula(nat))).toBe("1d20+5 = 25（20+5）（天然 20！）");
  const minus = rollFormula(parseFormula("1d6-1d4")!, (sides) => sides);
  expect(minus.total).toBe(2);
});

test("3R attacks: bonuses before 近战/远程, iterative ones apart, damage dice", () => {
  const parts = splitDnd3rAttacks("长剑+6/+1 近战(1d8+1/19-20)；或轻弩+1 远程(1d8/19-20)");
  const rolls = parts.filter((p) => typeof p !== "string") as Exclude<TextPart, string>[];
  expect(rolls.map((r) => [r.text, r.kind, r.roll.modifier])).toEqual([
    ["+6", "hit", 6],
    ["+1", "hit", 1],
    ["1d8+1", "damage", 1],
    ["+1", "hit", 1],
    ["1d8", "damage", 0],
  ]);
  expect(parts.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe(
    "长剑+6/+1 近战(1d8+1/19-20)；或轻弩+1 远程(1d8/19-20)"
  );
});
