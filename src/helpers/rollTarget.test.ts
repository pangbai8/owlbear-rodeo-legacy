import { getRollTarget, setRollTarget } from "./rollTarget";
import { discordRollMessage } from "./discordBridge";
import { summarizeRoll } from "./fiveEDice";

beforeEach(() => localStorage.clear());

test("rolls go to Boluo or Discord, one at a time", () => {
  expect(getRollTarget()).toBeNull();
  setRollTarget("boluo");
  expect(getRollTarget()).toBe("boluo");
  setRollTarget("discord");
  expect(getRollTarget()).toBe("discord");
  setRollTarget(null);
  expect(getRollTarget()).toBeNull();
});

test("the old Boluo switch carries over until changed", () => {
  localStorage.setItem("boluo.sendRolls", "true");
  expect(getRollTarget()).toBe("boluo");
  setRollTarget(null);
  expect(getRollTarget()).toBeNull();
  expect(localStorage.getItem("boluo.sendRolls")).toBeNull();
});

test("Discord roll message", () => {
  const roll = summarizeRoll({ count: 1, sides: 20, modifier: 4, rolls: [15], total: 19 });
  expect(discordRollMessage("地精", "弯刀 命中", roll)).toBe("🎲 **地精 弯刀 命中**：1d20+4 = **19**（15+4）");
  expect(discordRollMessage(undefined, "敏捷 豁免", roll)).toBe("🎲 **敏捷 豁免**：1d20+4 = **19**（15+4）");
});
