import {
  conditionBadge,
  conditionSummary,
  conditionValue,
  parseCondition,
  setCondition,
} from "./pf2Conditions";
import { reconcileConditions } from "./partyPanel";

test("conditions are strings, with a value for valued ones", () => {
  expect(parseCondition("惊惧 2")).toEqual({ name: "惊惧", value: 2 });
  expect(parseCondition("倒地")).toEqual({ name: "倒地", value: null });
  let list = setCondition([], "惊惧", 1);
  list = setCondition(list, "倒地", 0);
  expect(list).toEqual(["惊惧 1", "倒地"]);
  // A new value keeps its place
  list = setCondition(list, "惊惧", 3);
  expect(list).toEqual(["惊惧 3", "倒地"]);
  expect(conditionValue(list, "惊惧")).toBe(3);
  expect(conditionValue(list, "倒地")).toBe(0);
  expect(conditionValue(list, "恶心")).toBeNull();
  expect(setCondition(list, "惊惧", 0)).toEqual(["倒地"]);
  expect(setCondition(list, "倒地", null)).toEqual(["惊惧 3"]);
  expect(conditionSummary("惊惧 3")).toMatch(/状态减值/);
});

test("the token badge", () => {
  expect(conditionBadge(["惊惧 1", "倒地"])).toBe("惊惧1 · 倒地");
  expect(conditionBadge(["惊惧 1", "倒地", "恶心 2", "目盲", "隐形"])).toBe("惊惧1 · 倒地 · 恶心2 +2");
  expect(conditionBadge([])).toBe("");
});

test("sync: whichever side changed since the last sync wins", () => {
  // Same on both sides
  expect(reconcileConditions(["倒地"], ["倒地"], undefined)).toEqual({ value: ["倒地"] });
  // Token changed (panel still as last synced): push to the panel
  expect(reconcileConditions(["倒地", "惊惧 1"], ["倒地"], ["倒地"])).toEqual({
    apply: "panel",
    value: ["倒地", "惊惧 1"],
  });
  // Panel changed: update the token
  expect(reconcileConditions(["倒地"], [], ["倒地"])).toEqual({ apply: "token", value: [] });
  // Both changed, or never synced: the panel wins
  expect(reconcileConditions(["目盲"], ["倒地"], ["隐形"])).toEqual({ apply: "token", value: ["倒地"] });
  expect(reconcileConditions(["目盲"], ["倒地"], undefined)).toEqual({ apply: "token", value: ["倒地"] });
});
