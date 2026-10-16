import { findDnd4e, findDnd4eTitle, searchDnd4e } from "./dnd4e";
import { DND4E_CONDITIONS, setCondition } from "./conditions";

const index = {
  kinds: [
    ["威能", "威能"],
    ["专长", "专长"],
    ["规则", "规则"],
  ],
  entries: [
    ["火球术", "Fireball", 0, 5, 51, 14, "法师攻击", "每日"],
    ["火球", "", 1, null, 0, 0, "英雄", ""],
    ["状态表", "", 2, null, 0, 3, "", ""],
  ],
};

beforeAll(() => {
  // A plain function: CRA resets jest.fn implementations before each test
  (global as any).fetch = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(index) });
});

test("search: powers first among equal matches, type and usage shown", async () => {
  const results = await searchDnd4e("火球");
  expect(results.map((r) => r.name)).toEqual(["火球", "火球术"]);
  expect(results[1]).toMatchObject({
    englishName: "Fireball",
    categoryLabel: "威能 5",
    source: "法师攻击 · 每日",
    system: "4e",
    dnd4e: { kind: "威能", chunk: 51, position: 14 },
    url: "https://leonspace.site/#" + encodeURIComponent("火球术 Fireball"),
  });
  expect((await searchDnd4e("fireball"))[0].name).toBe("火球术");
});

test("links and chips: by full title; conditions open the condition table", async () => {
  expect((await findDnd4eTitle("火球术 Fireball"))?.name).toBe("火球术");
  expect(await findDnd4eTitle("没有这个")).toBeNull();
  expect((await findDnd4e("晕眩", "condition"))?.name).toBe("状态表");
  expect((await findDnd4e("火球术", "spell"))?.name).toBe("火球术");
});

test("4e conditions: ongoing damage has a value", () => {
  let list = setCondition([], "持续伤害", 5, DND4E_CONDITIONS);
  list = setCondition(list, "晕眩", 0, DND4E_CONDITIONS);
  expect(list).toEqual(["持续伤害 5", "晕眩"]);
});
