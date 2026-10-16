// PF2 quick search: a mirror of the Chinese PF2 wiki's data (built by
// scripts/pf2/build.mjs into public/pf2/), served with the VTT itself since
// the wiki cannot be read from other sites. Cards link back to the wiki.

import { matchScore, MonsterRef, MonsterStats, SearchResult } from "./fiveETools";

export const PF2_WIKI = "https://pf2.huijiwiki.com/wiki/";
const PF2_BASE = `${process.env.PUBLIC_URL || ""}/pf2/`;
/** Creature art through the VTT's worker (the image CDN blocks other sites) */
const PF2_IMAGE_BASE = "/pf2img/";

export type Pf2Kind =
  | "Creatures"
  | "Spells"
  | "Conditions"
  | "Actions"
  | "Feats"
  | "Items"
  | "Rituals"
  | "Traits"
  | "Backgrounds";

/** Where a record lives in the data chunks */
export type Pf2Location = { kind: Pf2Kind; chunk: number; position: number };

type Pf2Index = {
  kinds: [Pf2Kind, string][];
  // [中文, 原文, kind, level, chunk, position, 来源]
  entries: [string, string, number, number | null, number, number, string][];
};

// Results with the same match: creatures, spells, conditions, actions first
const KIND_BOOST: Partial<Record<Pf2Kind, number>> = {
  Creatures: 6,
  Spells: 5,
  Conditions: 4,
  Actions: 3,
  Items: 2,
  Feats: 1,
};
// Category ids for SearchResult, apart from 5etools' (0–49)
const CATEGORY_BASE = 1000;

let indexPromise: Promise<Pf2Index> | null = null;

export function loadPf2Index() {
  if (!indexPromise) {
    indexPromise = fetch(`${PF2_BASE}index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

function toResult(index: Pf2Index, entry: Pf2Index["entries"][number]): SearchResult {
  const [name, englishName, kindIndex, level, chunk, position, source] = entry;
  const [kind, label] = index.kinds[kindIndex];
  return {
    id: CATEGORY_BASE * 100000 + kindIndex * 10000 + chunk * 100 + position,
    name,
    englishName,
    category: CATEGORY_BASE + kindIndex,
    categoryLabel: level != null ? `${label} ${level}` : label,
    source,
    url: PF2_WIKI + encodeURIComponent(name),
    reprinted: false,
    modern: false,
    isMonster: kind === "Creatures",
    system: "pf2",
    pf2: { kind, chunk, position },
  };
}

export async function searchPf2(query: string, limit = 60) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const index = await loadPf2Index();
  const scored: [number, Pf2Index["entries"][number]][] = [];
  for (const entry of index.entries) {
    const score = Math.max(matchScore(entry[0], q), matchScore(entry[1], q) - 5);
    if (score === 0) continue;
    const kind = index.kinds[entry[2]][0];
    scored.push([score + (KIND_BOOST[kind] || 0), entry]);
  }
  scored.sort(
    (a, b) => b[0] - a[0] || a[1][0].length - b[1][0].length || (a[1][3] ?? 0) - (b[1][3] ?? 0)
  );
  return scored.slice(0, limit).map(([, entry]) => toResult(index, entry));
}

const chunks = new Map<string, Promise<any[]>>();

function loadChunk(kind: Pf2Kind, chunk: number) {
  const key = `${kind}-${chunk}`;
  if (!chunks.has(key)) {
    chunks.set(
      key,
      fetch(`${PF2_BASE}data/${key}.json`)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .catch((error) => {
          chunks.delete(key);
          throw error;
        })
    );
  }
  return chunks.get(key)!;
}

export async function loadPf2Record(location: Pf2Location) {
  const records = await loadChunk(location.kind, location.chunk);
  const record = records[location.position];
  if (!record) throw new Error("资料不存在");
  return record;
}

/** A creature's place in the data, found from a stored MonsterRef */
async function locateCreature(ref: MonsterRef): Promise<Pf2Location> {
  const index = await loadPf2Index();
  const creatures = index.kinds.findIndex(([kind]) => kind === "Creatures");
  const entry =
    index.entries.find(
      (e) => e[2] === creatures && (e[1] || e[0]) === ref.englishName && e[6] === ref.source
    ) || index.entries.find((e) => e[2] === creatures && e[0] === ref.name);
  if (!entry) throw new Error(`PF2 资料里没有「${ref.name}」`);
  return { kind: "Creatures", chunk: entry[4], position: entry[5] };
}

export async function loadPf2Creature(ref: MonsterRef) {
  return loadPf2Record(await locateCreature(ref));
}

// PF2 sizes -> grid cells per side
const SIZE_CELLS: Record<string, number> = {
  微型: 1,
  小型: 1,
  中型: 1,
  大型: 2,
  超大型: 3,
  巨型: 4,
};

export function pf2MonsterStats(record: any, ref: MonsterRef): MonsterStats {
  const number = (v: unknown) => (typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    ...ref,
    size: SIZE_CELLS[record.体型] || 1,
    ac: number(record.AC),
    hp: number(record.HP),
    // PF2 rolls initiative with Perception
    initBonus: number(record.察觉) ?? 0,
    cr: record.等级 != null ? String(record.等级) : "",
    tokenUrl: record.image ? PF2_IMAGE_BASE + record.image : null,
  };
}

const statsCache = new Map<string, Promise<MonsterStats>>();

export function loadPf2Monster(ref: MonsterRef) {
  const key = `${ref.source}|${ref.englishName}`;
  if (!statsCache.has(key)) {
    statsCache.set(
      key,
      loadPf2Creature(ref).then(
        (record) => pf2MonsterStats(record, ref),
        (error) => {
          statsCache.delete(key);
          throw error;
        }
      )
    );
  }
  return statsCache.get(key)!;
}

// Party panel chips: conditions or spells by name
const LOOKUP_KINDS: Record<"condition" | "spell", Pf2Kind[]> = {
  condition: ["Conditions"],
  spell: ["Spells", "Rituals"],
};

/** The best PF2 result of a kind for a chip's name (e.g. "迟缓 1" → 迟缓) */
export async function findPf2(name: string, kind: "condition" | "spell") {
  // Condition chips may carry a value: "迟缓 1", "恶心2"
  const query = kind === "condition" ? name.replace(/\s*\d+$/, "") : name;
  const results = await searchPf2(query, 200);
  return results.find((r) => r.pf2 && LOOKUP_KINDS[kind].includes(r.pf2.kind)) || null;
}
