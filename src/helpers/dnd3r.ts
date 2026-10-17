// 3R quick search: a mirror of the Chinese D&D 3R wiki
// (https://dnd3r.huijiwiki.com/, CC BY-SA), built by scripts/dnd3r/build.mjs
// into public/dnd3r/ and served with the VTT itself, since the wiki cannot
// be read from other sites. Cards link back to the wiki.

import { MonsterRef, MonsterStats, SearchResult, matchScore } from "./fiveETools";

export const DND3R_WIKI = "https://dnd3r.huijiwiki.com/wiki/";
const DND3R_BASE = `${process.env.PUBLIC_URL || ""}/dnd3r/`;

/** Where a record lives in the data chunks */
export type Dnd3rLocation = { kind: string; chunk: number; position: number };

/** A record: fields as rows, body as paragraphs; text has **bold** and ⟦links⟧ */
export type Dnd3rRecord = {
  name: string;
  en: string;
  source: string;
  page: string;
  summary?: string;
  tags?: string[];
  fields?: [string, string][];
  body?: [string, string][];
  stats?: { size: number; ac: number | null; hp: number | null; init: number; cr: string };
};

type Dnd3rIndex = {
  kinds: string[];
  // [中文, English, kind, row text, chunk, position, 出处, wiki page]
  entries: [string, string, number, string, number, number, string, string][];
  redirects: Record<string, string>;
};

// Results with the same match: monsters, spells, conditions first
const KIND_BOOST: Record<string, number> = { 怪物: 7, 法术: 6, 状态: 5, 灵能: 4, 武术: 3, 专长: 2, 物品: 1 };
// Category ids for SearchResult, apart from 5etools', PF2's and 4e's
const CATEGORY_BASE = 3000;

let indexPromise: Promise<Dnd3rIndex> | null = null;

export function loadDnd3rIndex() {
  if (!indexPromise) {
    indexPromise = fetch(`${DND3R_BASE}index.json`)
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

export function dnd3rUrl(page: string) {
  return DND3R_WIKI + encodeURIComponent(page).replace(/%2F/g, "/");
}

function toResult(index: Dnd3rIndex, entry: Dnd3rIndex["entries"][number]): SearchResult {
  const [name, englishName, kindIndex, row, chunk, position, source, page] = entry;
  const kind = index.kinds[kindIndex];
  return {
    id: CATEGORY_BASE * 100000 + kindIndex * 10000 + chunk * 100 + position,
    name,
    englishName,
    category: CATEGORY_BASE + kindIndex,
    categoryLabel: kind,
    // Shown at the end of the row: a spell's levels, a monster's CR, a book…
    source: kind === "怪物" && row ? `CR ${row}` : row || source,
    url: dnd3rUrl(page),
    reprinted: false,
    modern: false,
    isMonster: kind === "怪物",
    system: "3r",
    dnd3r: { kind, chunk, position },
  };
}

export async function searchDnd3r(query: string, limit = 60) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const index = await loadDnd3rIndex();
  const scored: [number, Dnd3rIndex["entries"][number]][] = [];
  for (const entry of index.entries) {
    const score = Math.max(matchScore(entry[0], q), matchScore(entry[1], q) - 5);
    if (score === 0) continue;
    scored.push([score + (KIND_BOOST[index.kinds[entry[2]]] || 0), entry]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1][0].length - b[1][0].length);
  return scored.slice(0, limit).map(([, entry]) => toResult(index, entry));
}

/** The result for a ⟦link⟧'s target: an entry's name, page or other name */
export async function findDnd3rTitle(title: string) {
  const index = await loadDnd3rIndex();
  const target = index.redirects[title] || title;
  const entry =
    index.entries.find((e) => e[0] === title) ||
    index.entries.find((e) => e[7] === target) ||
    index.entries.find((e) => e[0] === target);
  return entry ? toResult(index, entry) : null;
}

const chunks = new Map<string, Promise<Dnd3rRecord[]>>();

export async function loadDnd3rRecord({ kind, chunk, position }: Dnd3rLocation): Promise<Dnd3rRecord> {
  const key = `${kind}-${chunk}`;
  if (!chunks.has(key)) {
    chunks.set(
      key,
      fetch(`${DND3R_BASE}data/${encodeURIComponent(key)}.json`)
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
  const record = (await chunks.get(key)!)[position];
  if (!record) throw new Error("资料不存在");
  return record;
}

/** A monster's record from a stored MonsterRef (by its wiki page and name) */
async function locateMonster(ref: MonsterRef): Promise<Dnd3rLocation> {
  const index = await loadDnd3rIndex();
  const monsters = index.kinds.indexOf("怪物");
  const entry =
    index.entries.find((e) => e[2] === monsters && e[0] === ref.name && dnd3rUrl(e[7]) === ref.url) ||
    index.entries.find((e) => e[2] === monsters && e[0] === ref.name);
  if (!entry) throw new Error(`3R 资料里没有「${ref.name}」`);
  return { kind: "怪物", chunk: entry[4], position: entry[5] };
}

export async function loadDnd3rMonsterRecord(ref: MonsterRef) {
  return loadDnd3rRecord(await locateMonster(ref));
}

const statsCache = new Map<string, Promise<MonsterStats>>();

/** A 3R monster's token numbers (no art on the wiki: a placeholder token) */
export function loadDnd3rMonster(ref: MonsterRef): Promise<MonsterStats> {
  const key = `${ref.url}|${ref.name}`;
  if (!statsCache.has(key)) {
    statsCache.set(
      key,
      loadDnd3rMonsterRecord(ref).then(
        (record) => ({
          ...ref,
          size: record.stats?.size || 1,
          ac: record.stats?.ac ?? null,
          hp: record.stats?.hp ?? null,
          initBonus: record.stats?.init ?? 0,
          cr: record.stats?.cr || "",
          tokenUrl: null,
        }),
        (error) => {
          statsCache.delete(key);
          throw error;
        }
      )
    );
  }
  return statsCache.get(key)!;
}

// Party panel chips and the token menu: conditions or spells by name
const LOOKUP_KINDS: Record<"condition" | "spell", string[]> = {
  condition: ["状态"],
  spell: ["法术", "灵能", "武术"],
};

/** The best 3R result of a kind for a chip's name */
export async function findDnd3r(name: string, kind: "condition" | "spell") {
  const results = await searchDnd3r(name.replace(/\s*\d+$/, ""), 200);
  return results.find((r) => r.dnd3r && LOOKUP_KINDS[kind].includes(r.dnd3r.kind)) || null;
}
