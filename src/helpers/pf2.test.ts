import { findPf2, pf2MonsterStats, searchPf2 } from "./pf2";

const index = {
  kinds: [
    ["Creatures", "生物"],
    ["Spells", "法术"],
    ["Conditions", "状态"],
  ],
  entries: [
    ["地精突击手", "Goblin Commando", 0, 1, 0, 0, "MC"],
    ["地精战士", "Goblin Warrior", 0, -1, 0, 1, "MC"],
    ["迟缓", "Slowed", 2, null, 0, 0, "PC"],
    ["火球术", "Fireball", 1, 3, 0, 0, "PC"],
  ],
};

beforeAll(() => {
  // A plain function: CRA resets jest.fn implementations before each test
  (global as any).fetch = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(index) });
});

test("search: names in both languages, creatures first, links to the wiki", async () => {
  const results = await searchPf2("地精");
  expect(results.map((r) => r.name)).toEqual(["地精战士", "地精突击手"]);
  expect(results[1]).toMatchObject({
    englishName: "Goblin Commando",
    categoryLabel: "生物 1",
    isMonster: true,
    system: "pf2",
    pf2: { kind: "Creatures", chunk: 0, position: 0 },
    url: "https://pf2.huijiwiki.com/wiki/" + encodeURIComponent("地精突击手"),
  });
  expect((await searchPf2("fireball"))[0]).toMatchObject({ name: "火球术", isMonster: false });
});

test("chips: a condition with a value finds the condition", async () => {
  expect((await findPf2("迟缓 1", "condition"))?.name).toBe("迟缓");
  expect(await findPf2("迟缓", "spell")).toBeNull();
});

test("creature stats for tokens and the party panel", () => {
  const ref = {
    name: "地精突击手",
    englishName: "Goblin Commando",
    source: "MC",
    url: "u",
    system: "pf2" as const,
  };
  expect(
    pf2MonsterStats(
      { 体型: "大型", AC: 17, HP: 18, 察觉: 5, 等级: 1, image: "thumb/a/ae/x.webp/300px-x.webp.png" },
      ref
    )
  ).toEqual({
    ...ref,
    size: 2,
    ac: 17,
    hp: 18,
    initBonus: 5,
    cr: "1",
    tokenUrl: "/pf2img/thumb/a/ae/x.webp/300px-x.webp.png",
  });
});
