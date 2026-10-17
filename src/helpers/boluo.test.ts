import { boluoRollMessage } from "./boluo";

test("roll message puts the total in bold", () => {
  const { text, entities } = boluoRollMessage("地精", "弯刀 命中", {
    count: 1,
    sides: 20,
    modifier: 4,
    rolls: [20],
    total: 24,
  });
  expect(text).toBe("地精 弯刀 命中：1d20+4 = 24（20+4）（天然 20！）");
  const pieces = entities.map((e) => text.slice(e.start, e.start + e.len));
  expect(pieces).toEqual(["地精 弯刀 命中：1d20+4 = ", "24", "（20+4）（天然 20！）"]);
  expect(entities[1].type).toBe("Strong");
});
