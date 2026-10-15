import type { DiceRoll } from "../types/Dice";

// Kept apart from helpers/dice.ts, which imports Babylon: the party sidebar
// shows roll totals on every game page, the 3D dice only when the tray opens.
export function getDiceRollTotal(diceRolls: DiceRoll[]) {
  return diceRolls.reduce((accumulator: number, dice) => {
    if (dice.roll === "unknown") {
      return accumulator;
    } else {
      return accumulator + dice.roll;
    }
  }, 0);
}
