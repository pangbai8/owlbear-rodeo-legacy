import { DND3R_WIKI, findDnd3rTitle, isDnd3rChm, searchDnd3r } from "./dnd3r";

const index = {
  kinds: ["怪物", "法术", "状态", "灵能", "武术", "专长", "物品", "条目"],
  entries: [
    ["抗力斗篷", "Cloak of Resistance", 6, "奇物", 1, 4, "城主指南", "抗力斗篷"],
    // From the CHM: no wiki page
    ["机运斗篷", "Mantle of Second Chances", 6, "奇物", 18, 17, "城主指南2", ""],
    ["眼魔", "Beholder", 0, "13", 20, 3, "怪物图鉴", ""],
  ],
  redirects: {},
};

beforeAll(() => {
  // A plain function: CRA resets jest.fn implementations before each test
  (global as any).fetch = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(index) });
});

test("search: wiki entries link to their page, CHM ones to a wiki search", async () => {
  const [cloak] = await searchDnd3r("抗力斗篷");
  expect(cloak.url).toBe(DND3R_WIKI + encodeURIComponent("抗力斗篷"));
  expect(isDnd3rChm(cloak)).toBe(false);

  const [mantle] = await searchDnd3r("机运斗篷");
  expect(mantle).toMatchObject({
    name: "机运斗篷",
    englishName: "Mantle of Second Chances",
    categoryLabel: "物品",
    source: "奇物",
    dnd3r: { kind: "物品", chunk: 18, position: 17 },
    url: `${DND3R_WIKI}Special:Search?search=${encodeURIComponent("机运斗篷")}`,
  });
  expect(isDnd3rChm(mantle)).toBe(true);
  expect((await searchDnd3r("second chances"))[0].name).toBe("机运斗篷");
});

test("a CHM monster is found by name, with its CR", async () => {
  const [beholder] = await searchDnd3r("眼魔");
  expect(beholder).toMatchObject({ isMonster: true, source: "CR 13" });
  expect((await findDnd3rTitle("眼魔"))?.dnd3r).toEqual({ kind: "怪物", chunk: 20, position: 3 });
});
