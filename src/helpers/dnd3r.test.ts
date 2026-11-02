import { DND3R_WIKI, findDnd3rTitle, isDnd3rChm, loadDnd3rRecord, searchDnd3r } from "./dnd3r";

const index = {
  kinds: ["怪物", "法术", "状态", "灵能", "武术", "专长", "物品", "条目"],
  entries: [
    ["抗力斗篷", "Cloak of Resistance", 6, "奇物", 1, 4, "城主指南", "抗力斗篷"],
    // From the CHM: no wiki page
    ["机运斗篷", "Mantle of Second Chances", 6, "奇物", 18, 1, "城主指南2", ""],
    ["眼魔", "Beholder", 0, "13", 20, 3, "怪物图鉴", ""],
  ],
  redirects: {},
};

// Data chunks by name: 物品-18 has the mantle second, as after a rebuild
const chunks: Record<string, object[]> = {
  "物品-18": [{ name: "眼魔之石" }, { name: "机运斗篷", en: "Mantle of Second Chances" }],
};

beforeAll(() => {
  // A plain function: CRA resets jest.fn implementations before each test
  (global as any).fetch = (url: string) => {
    const chunk = decodeURIComponent(url).match(/data\/(.+)\.json$/)?.[1];
    const body = chunk ? chunks[chunk] || [] : index;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
});

test("a favourite whose entry moved is found by its name", async () => {
  // Stored at position 0 of 物品-18; the index now puts it at 1, and position 0 is another item
  const record = await loadDnd3rRecord(
    { kind: "物品", chunk: 18, position: 0 },
    { name: "机运斗篷", englishName: "Mantle of Second Chances" }
  );
  expect(record.name).toBe("机运斗篷");
  // Without a name to check, the place is taken at its word
  expect((await loadDnd3rRecord({ kind: "物品", chunk: 18, position: 0 })).name).toBe("眼魔之石");
  await expect(
    loadDnd3rRecord({ kind: "物品", chunk: 18, position: 0 }, { name: "没有这个" })
  ).rejects.toThrow("资料不存在");
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
    dnd3r: { kind: "物品", chunk: 18, position: 1 },
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
