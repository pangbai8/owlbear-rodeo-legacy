// Where dice rolls from the cards and the spell bar also go: the channel
// open in the Boluo window or in the Discord window (one at a time), or
// nowhere. Switches in the rules mode menu; stored per browser.

import { useEffect, useState } from "react";

export type RollTarget = "boluo" | "discord" | null;

const KEY = "rolls.sendTo";
/** The Boluo-only switch this replaces */
const OLD_BOLUO_KEY = "boluo.sendRolls";
const CHANGE_EVENT = "rolls.sendTo:change";

export function getRollTarget(): RollTarget {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "boluo" || value === "discord") return value;
    if (value === null && localStorage.getItem(OLD_BOLUO_KEY) === "true") return "boluo";
  } catch {}
  return null;
}

export function setRollTarget(target: RollTarget) {
  try {
    localStorage.setItem(KEY, target || "off");
    localStorage.removeItem(OLD_BOLUO_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: target }));
}

export function useRollTarget(): RollTarget {
  const [target, setTarget] = useState(getRollTarget);
  useEffect(() => {
    const handler = (event: Event) => setTarget((event as CustomEvent).detail as RollTarget);
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);
  return target;
}
