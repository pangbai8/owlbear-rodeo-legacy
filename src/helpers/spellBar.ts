// The favourites bar (收藏栏): a hotbar of favourite spells and attacks,
// dragged in from the quick search or written by hand, one bar per rules
// mode and per group in it (a character, say), with that group's saving
// throws. Each entry has its own roll formulas; the
// quick search entry it came from shows as its description. Stored per
// browser.

import { useCallback, useEffect, useState } from "react";

import { SearchResult } from "./fiveETools";
import { loadEntryCard } from "./fiveEEntries";
import { loadPf2Record } from "./pf2";
import { loadDnd4eRecord } from "./dnd4e";
import { loadDnd3rRecord } from "./dnd3r";
import {
  TextPart,
  rollExpression,
  splitDnd3rAttacks,
  splitPf2Rolls,
  splitRolls,
} from "./fiveEDice";
import { RULE_SYSTEM_LABEL, RuleSystem, getRuleSystem } from "./ruleSystem";

/** Whose bar: a rules mode's, or "none" (无规则: the rules mode is off) */
export type BarSystem = RuleSystem | "none";

export function barLabel(system: BarSystem) {
  return system === "none" ? "无规则" : RULE_SYSTEM_LABEL[system];
}

/** Drag data type for a quick search entry (spell, power, item…) */
export const ENTRY_DRAG_TYPE = "application/x-owlbear-entry";

export type SpellRoll = { label: string; formula: string };

export type SpellEntry = {
  id: string;
  name: string;
  /** The user's own description or notes */
  note: string;
  rolls: SpellRoll[];
  /** The quick search entry it was dragged from: its card is the description */
  source?: SearchResult;
};

export const SLOT_COUNT = 12;

export type SpellGroup = {
  id: string;
  name: string;
  /** The hotbar slots in order; null: an empty slot */
  entries: (SpellEntry | null)[];
  /**
   * The saving throws shown above the slots, kept for each rules mode on
   * its own; unset: that mode's defaults. (An array: from before, 5e's.)
   */
  saves?: Partial<Record<BarSystem, SpellRoll[]>> | SpellRoll[];
};

/** A group's saving throws in a rules mode */
export function savesFor(group: SpellGroup, system: BarSystem): SpellRoll[] {
  const saves = Array.isArray(group.saves)
    ? { "5e": group.saves }
    : group.saves || {};
  return saves[system] || defaultSaves(system);
}

/** The group with its saving throws in one rules mode changed */
export function withSaves(
  group: SpellGroup,
  system: BarSystem,
  list: SpellRoll[],
): SpellGroup {
  const saves = Array.isArray(group.saves)
    ? { "5e": group.saves }
    : group.saves || {};
  return { ...group, saves: { ...saves, [system]: list } };
}

/** Saving throws to start from, by rules mode (the user edits the bonuses) */
export function defaultSaves(system: BarSystem): SpellRoll[] {
  // No rules: the user sets up whatever saves the game has
  if (system === "none") return [];
  if (system === "pf2" || system === "3r")
    return ["强韧", "反射", "意志"].map((label) => ({ label, formula: "+0" }));
  // 4e: one save, 10 or higher succeeds
  if (system === "4e") return [{ label: "豁免", formula: "1d20" }];
  return ["力量", "敏捷", "体质", "智力", "感知", "魅力"].map((label) => ({
    label,
    formula: "+0",
  }));
}

export type SpellBarState = { groups: SpellGroup[]; current: string };

/** Each rules mode has a bar of its own (its spells are that mode's) */
const keyOf = (system: BarSystem) => `spellBar.v2.${system}`;
/** The one bar from before the bars were per rules mode */
const OLD_KEY = "spellBar.v1";
const CHANGE_EVENT = "spellBar:change";

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyState(): SpellBarState {
  const id = newId();
  return { groups: [{ id, name: "收藏", entries: [] }], current: id };
}

/** The bar from before goes to the rules mode in use when it is first read */
function migrateOldBar() {
  try {
    const old = localStorage.getItem(OLD_KEY);
    if (old === null) return;
    const key = keyOf(getRuleSystem());
    if (localStorage.getItem(key) === null) localStorage.setItem(key, old);
    localStorage.removeItem(OLD_KEY);
  } catch {}
}

export function loadSpellBar(system: BarSystem): SpellBarState {
  migrateOldBar();
  try {
    const parsed = JSON.parse(localStorage.getItem(keyOf(system)) || "null");
    if (parsed && Array.isArray(parsed.groups) && parsed.groups.length) {
      const current = parsed.groups.some(
        (g: SpellGroup) => g.id === parsed.current,
      )
        ? parsed.current
        : parsed.groups[0].id;
      return { groups: parsed.groups, current };
    }
  } catch {}
  return emptyState();
}

function saveSpellBar(system: BarSystem, state: SpellBarState) {
  try {
    localStorage.setItem(keyOf(system), JSON.stringify(state));
  } catch {}
}

/** A rules mode's bar, kept in localStorage and in step across components */
export function useSpellBar(system: BarSystem) {
  const [loaded, setLoaded] = useState(() => ({
    system,
    state: loadSpellBar(system),
  }));
  // Another rules mode: its own bar
  const state = loaded.system === system ? loaded.state : loadSpellBar(system);
  useEffect(() => {
    if (loaded.system !== system)
      setLoaded({ system, state: loadSpellBar(system) });
  }, [system, loaded.system]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        system: BarSystem;
        state: SpellBarState;
      };
      if (detail.system === system) setLoaded(detail);
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [system]);
  const update = useCallback(
    (change: (state: SpellBarState) => SpellBarState) => {
      const next = change(loadSpellBar(system));
      saveSpellBar(system, next);
      window.dispatchEvent(
        new CustomEvent(CHANGE_EVENT, { detail: { system, state: next } }),
      );
    },
    [system],
  );
  return [state, update] as const;
}

/** A group's slots, always SLOT_COUNT long */
export function slotsOf(group: SpellGroup): (SpellEntry | null)[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => group.entries[i] || null);
}

/**
 * Slots with entry put in slot index; an entry already there moves to the
 * first empty slot (or is replaced when the bar is full).
 */
export function placeInSlot(
  slots: (SpellEntry | null)[],
  index: number,
  entry: SpellEntry,
): (SpellEntry | null)[] {
  const next = [...slots];
  const previous = next[index];
  next[index] = entry;
  if (previous) {
    const empty = next.indexOf(null);
    if (empty >= 0) next[empty] = previous;
  }
  return next;
}

/** state with one group changed */
export function updateGroup(
  state: SpellBarState,
  groupId: string,
  change: (group: SpellGroup) => SpellGroup,
): SpellBarState {
  return {
    ...state,
    groups: state.groups.map((g) => (g.id === groupId ? change(g) : g)),
  };
}

const KIND_LABEL = { hit: "命中", damage: "伤害", check: "检定" } as const;

/**
 * The rolls found in an entry's text, as formulas to start from: the first
 * attack bonus ("命中"), dice ("伤害") and check of the text. A click on the
 * slot rolls them all, so later dice (higher levels…) are left to the user.
 */
export function rollsFromParts(parts: TextPart[]): SpellRoll[] {
  const rolls: SpellRoll[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (typeof part === "string" || seen.has(part.kind)) continue;
    seen.add(part.kind);
    rolls.push({
      label: KIND_LABEL[part.kind],
      formula: rollExpression(part.roll),
    });
  }
  const order = ["命中", "伤害", "检定"];
  return rolls.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}

/** Every string in a wiki record (PF2, 4e), for finding its rolls */
function recordText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => recordText(v, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => recordText(v, out));
  return out;
}

/** A spell bar entry for a quick search result, its rolls read from its text */
export async function entryFromResult(
  result: SearchResult,
): Promise<SpellEntry> {
  let parts: TextPart[] = [];
  try {
    if (result.system === "pf2" && result.pf2) {
      const record = await loadPf2Record(result.pf2);
      parts = recordText(record).flatMap((text) => splitPf2Rolls(text));
    } else if (result.system === "4e" && result.dnd4e) {
      const record = await loadDnd4eRecord(result.dnd4e);
      parts = recordText(record).flatMap((text) => splitRolls(text));
    } else if (result.system === "3r" && result.dnd3r) {
      const record = await loadDnd3rRecord(result.dnd3r);
      parts = recordText([record.fields, record.body]).flatMap((text) =>
        splitDnd3rAttacks(text)
      );
    } else {
      const card = await loadEntryCard(result);
      if (card)
        parts = [...card.lines.map((l) => l.text), ...card.paragraphs].flatMap(
          (text) => splitRolls(text),
        );
    }
  } catch {
    // No rolls found: the user adds them
  }
  return {
    id: newId(),
    name: result.name,
    note: "",
    rolls: rollsFromParts(parts),
    source: result,
  };
}

export function readEntryDrag(
  dataTransfer: DataTransfer | null,
): SearchResult | null {
  const raw = dataTransfer?.getData(ENTRY_DRAG_TYPE);
  if (!raw) return null;
  try {
    const result = JSON.parse(raw);
    return result && typeof result.name === "string" ? result : null;
  } catch {
    return null;
  }
}

/** Drag data type for a hotbar slot moved to another slot */
export const SLOT_DRAG_TYPE = "application/x-owlbear-spell-slot";

/** An entry or a slot dragged to the hotbar (the map ignores these) */
export function isEntryDrag(dataTransfer: DataTransfer | null) {
  const types = dataTransfer?.types;
  return (
    !!types &&
    (types.includes(ENTRY_DRAG_TYPE) || types.includes(SLOT_DRAG_TYPE))
  );
}
