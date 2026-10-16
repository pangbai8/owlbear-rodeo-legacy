import {
  addMonsterToPartyPanel,
  linkedStatuses,
  onPartyLinks,
  emitPartyLinks,
  uniqueName,
} from "./partyPanel";

test("numbers names like the panel does", () => {
  expect(uniqueName("地精", [])).toBe("地精");
  expect(uniqueName("地精", ["地精", "地精 2", "狼"])).toBe("地精 3");
});

test("status rings follow HP and turn; other rings stay", () => {
  const full = { hp: 7, maxHp: 7, turn: false };
  expect(linkedStatuses(["blue", "yellow", "red", "primary"], full)).toEqual(["blue"]);
  expect(linkedStatuses(["blue"], { hp: 3, maxHp: 7, turn: false })).toEqual(["blue", "yellow"]);
  expect(linkedStatuses([], { hp: 0, maxHp: 7, turn: true })).toEqual(["primary", "red"]);
});

test("links: listeners get the latest at once and every change", () => {
  const link = { tokenStateId: "t", mapId: "m", name: "狼", hp: 3, maxHp: 11, turn: true };
  emitPartyLinks([link]);
  const seen: unknown[] = [];
  const stop = onPartyLinks((links) => seen.push(links));
  emitPartyLinks([]);
  stop();
  emitPartyLinks([link]);
  expect(seen).toEqual([[link], []]);
});

test("adding fails at once when no panel listens", async () => {
  await expect(addMonsterToPartyPanel({} as any)).rejects.toThrow("小队面板没有加载");
});
