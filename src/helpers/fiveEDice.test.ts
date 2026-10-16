import {
  describeRoll,
  rollDice,
  rollExpression,
  splitChecks,
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
