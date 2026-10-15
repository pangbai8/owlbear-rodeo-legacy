// The party status panel's "地图怪物入队" switch (public/party-panel/db-shim.js
// stores it in this origin's localStorage): monsters dropped on the map are
// also added to the panel as NPCs.

import { MonsterStats } from "./fiveETools";

const AUTO_ADD_KEY = "partyPanel.autoAddMapMonsters";
const ADD_EVENT = "partyPanel:addMonster";

export function autoAddMapMonsters() {
  try {
    return localStorage.getItem(AUTO_ADD_KEY) === "true";
  } catch {
    return false;
  }
}

/** Asks the party panel (PartyPanelWindow) to add a monster as an NPC */
export function addMonsterToPartyPanel(stats: MonsterStats) {
  window.dispatchEvent(new CustomEvent(ADD_EVENT, { detail: stats }));
}

export function onAddMonsterToPartyPanel(
  listener: (stats: MonsterStats) => void
) {
  const handler = (event: Event) => listener((event as CustomEvent).detail);
  window.addEventListener(ADD_EVENT, handler);
  return () => window.removeEventListener(ADD_EVENT, handler);
}
