// Which rules the reference tools use: 5e (5etools, 2014 rules first), 5r
// (5etools, the 2024 revision first), PF2 (the PF2 wiki mirror), 4e (the
// 4e wiki mirror) or 3R (the D&D 3.5 wiki mirror). The search bar's visibility (FloatingWindow "quickSearch") turns
// them on; this picks which one, so only one is on at a time. Stored per
// browser; the party panel (same origin) reads the same keys.

import { useEffect, useState } from "react";

export type RuleSystem = "5e" | "5r" | "pf2" | "4e" | "3r";

export const RULE_SYSTEMS: RuleSystem[] = ["5e", "5r", "pf2", "4e", "3r"];

/** Where a rules mode's monsters and cards come from: 5e and 5r share 5etools */
export function dataSystemOf(system: RuleSystem): "5e" | "pf2" | "4e" | "3r" {
  return system === "5r" ? "5e" : system;
}

const KEY = "ruleSystem";
const CHANGE_EVENT = "ruleSystem:change";

export function getRuleSystem(): RuleSystem {
  try {
    const value = localStorage.getItem(KEY);
    return value === "5r" || value === "pf2" || value === "4e" || value === "3r" ? value : "5e";
  } catch {
    return "5e";
  }
}

export function setRuleSystem(system: RuleSystem) {
  try {
    localStorage.setItem(KEY, system);
  } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: system }));
}

export function useRuleSystem(): RuleSystem {
  const [system, setSystem] = useState(getRuleSystem);
  useEffect(() => {
    const handler = (event: Event) =>
      setSystem((event as CustomEvent).detail as RuleSystem);
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);
  return system;
}

export const RULE_SYSTEM_LABEL: Record<RuleSystem, string> = {
  "5e": "5e",
  "5r": "5r",
  pf2: "PF2",
  "4e": "4e",
  "3r": "3R",
};
