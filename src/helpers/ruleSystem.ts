// Which rules the reference tools use: 5e (5etools), PF2 (the PF2 wiki
// mirror) or 4e (the 4e wiki mirror). The search bar's visibility (FloatingWindow "quickSearch") turns
// them on; this picks which one, so only one is on at a time. Stored per
// browser; the party panel (same origin) reads the same keys.

import { useEffect, useState } from "react";

export type RuleSystem = "5e" | "pf2" | "4e";

export const RULE_SYSTEMS: RuleSystem[] = ["5e", "pf2", "4e"];

const KEY = "ruleSystem";
const CHANGE_EVENT = "ruleSystem:change";

export function getRuleSystem(): RuleSystem {
  try {
    const value = localStorage.getItem(KEY);
    return value === "pf2" || value === "4e" ? value : "5e";
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
  pf2: "PF2",
  "4e": "4e",
};
