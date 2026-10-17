import { splitRolls } from "./fiveEDice";
import { placeInSlot, rollsFromParts } from "./spellBar";

test("an entry's rolls: the first of each kind", () => {
  const parts = splitRolls(
    "进行一次远程法术攻击：+7。命中：目标受到 8d6 点火焰伤害，豁免成功减半 8d6。升环：每高一环 +1d6。"
  );
  expect(rollsFromParts(parts)).toEqual([
    { label: "命中", formula: "1d20+7" },
    { label: "伤害", formula: "8d6" },
  ]);
  expect(rollsFromParts(splitRolls("没有骰子"))).toEqual([]);
});

test("an entry dropped on a full slot pushes the old one to the first empty slot", () => {
  const a = { id: "a", name: "A", note: "", rolls: [] };
  const b = { id: "b", name: "B", note: "", rolls: [] };
  expect(placeInSlot([a, null, null], 0, b)).toEqual([b, a, null]);
  expect(placeInSlot([a, null, null], 2, b)).toEqual([a, null, b]);
  expect(placeInSlot([a], 0, b)).toEqual([b]);
});
