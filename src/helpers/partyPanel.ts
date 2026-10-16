// Messages between the VTT and the party status panel (public/party-panel,
// db-shim.js), relayed by PartyPanelWindow, which owns the panel's iframe.

import { MonsterStats } from "./fiveETools";

/* ---------- "地图怪物入队" switch ---------- */

// Stored by the panel in this origin's localStorage, so it is per browser
const AUTO_ADD_KEY = "partyPanel.autoAddMapMonsters";

export function autoAddMapMonsters() {
  try {
    return localStorage.getItem(AUTO_ADD_KEY) === "true";
  } catch {
    return false;
  }
}

/* ---------- adding a monster dropped on the map ---------- */

/** The map token a panel NPC stands for */
export type TokenLink = { tokenStateId: string; mapId: string };

type AddRequest = {
  stats: MonsterStats;
  link?: TokenLink;
  resolve: (name: string) => void;
  reject: (error: Error) => void;
  /** Set by the listener (dispatchEvent runs it synchronously) */
  claimed?: boolean;
};

const ADD_EVENT = "partyPanel:addMonster";

/** Adds a monster to the panel's current team; resolves with its NPC name */
export function addMonsterToPartyPanel(
  stats: MonsterStats,
  link?: TokenLink
): Promise<string> {
  return new Promise((resolve, reject) => {
    const detail: AddRequest = { stats, link, resolve, reject };
    window.dispatchEvent(new CustomEvent(ADD_EVENT, { detail }));
    // Nobody listening: the panel is not part of this page
    if (!detail.claimed) reject(new Error("小队面板没有加载"));
  });
}

export function onAddMonsterToPartyPanel(
  listener: (request: AddRequest) => void
) {
  const handler = (event: Event) => {
    const request: AddRequest = (event as CustomEvent).detail;
    request.claimed = true;
    listener(request);
  };
  window.addEventListener(ADD_EVENT, handler);
  return () => window.removeEventListener(ADD_EVENT, handler);
}

/** "地精", then "地精 2", "地精 3"… (the panel names NPCs the same way) */
export function uniqueName(name: string, taken: Iterable<string>) {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) {
    if (!used.has(`${name} ${n}`)) return `${name} ${n}`;
  }
}

/* ---------- NPCs linked to tokens: HP and turn ---------- */

export type PartyLink = TokenLink & {
  name: string;
  hp: number;
  maxHp: number;
  /** It is this NPC's turn in its team's combat */
  turn: boolean;
  /** A PF2 creature (else 5e) */
  pf2?: boolean;
  /** Its conditions as the token shows them ("倒地", "惊惧 1", "力竭 2") */
  conds?: string[];
};

const LINKS_EVENT = "partyPanel:links";
let latestLinks: PartyLink[] = [];

export function emitPartyLinks(links: PartyLink[]) {
  latestLinks = links;
  window.dispatchEvent(new CustomEvent(LINKS_EVENT, { detail: links }));
}

/** Calls the listener with the latest links now and on every change */
export function onPartyLinks(listener: (links: PartyLink[]) => void) {
  const handler = (event: Event) => listener((event as CustomEvent).detail);
  window.addEventListener(LINKS_EVENT, handler);
  listener(latestLinks);
  return () => window.removeEventListener(LINKS_EVENT, handler);
}

// Status rings the panel sets on linked tokens (others are left alone)
const HURT = "yellow";
const DOWN = "red";
const TURN = "primary";
const MANAGED = new Set<string>([HURT, DOWN, TURN]);

/** A linked token's status rings: bloodied (≤ half HP), down (0), its turn */
export function linkedStatuses<S extends string>(
  statuses: S[],
  link: Pick<PartyLink, "hp" | "maxHp" | "turn">
): string[] {
  const kept: string[] = statuses.filter((s) => s && !MANAGED.has(s));
  if (link.turn) kept.unshift(TURN);
  if (link.hp <= 0) kept.push(DOWN);
  else if (link.hp / link.maxHp <= 0.5) kept.push(HURT);
  return kept;
}

/* ---------- PF2 conditions: token -> panel NPC ---------- */

const SET_CONDS_EVENT = "partyPanel:setConditions";

/** Sets the conditions of the NPC linked to a token */
export function setPanelConditions(tokenStateId: string, conds: string[]) {
  window.dispatchEvent(
    new CustomEvent(SET_CONDS_EVENT, { detail: { tokenStateId, conds } })
  );
}

export function onSetPanelConditions(
  listener: (change: { tokenStateId: string; conds: string[] }) => void
) {
  const handler = (event: Event) => listener((event as CustomEvent).detail);
  window.addEventListener(SET_CONDS_EVENT, handler);
  return () => window.removeEventListener(SET_CONDS_EVENT, handler);
}

/**
 * Two-way sync of a linked PF2 NPC's conditions with its token: whichever
 * side changed since the last sync wins (the panel, if both did).
 */
export function reconcileConditions(
  token: string[],
  panel: string[],
  last: string[] | undefined
): { apply?: "token" | "panel"; value: string[] } {
  const key = (list: string[]) => list.join("|");
  if (key(token) === key(panel)) return { value: token };
  if (last !== undefined && key(panel) === key(last)) {
    return { apply: "panel", value: token };
  }
  return { apply: "token", value: panel };
}

/* ---------- 📍 locate and 5e lookups ---------- */

const LOCATE_EVENT = "partyPanel:locate";

export function locateToken(tokenStateId: string) {
  window.dispatchEvent(new CustomEvent(LOCATE_EVENT, { detail: tokenStateId }));
}

export function onLocateToken(listener: (tokenStateId: string) => void) {
  const handler = (event: Event) => listener((event as CustomEvent).detail);
  window.addEventListener(LOCATE_EVENT, handler);
  return () => window.removeEventListener(LOCATE_EVENT, handler);
}
