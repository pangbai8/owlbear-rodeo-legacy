// 4e quick search: a mirror of the Chinese 4e wiki (https://leonspace.site/,
// with its owner's permission), built by scripts/dnd4e/build.mjs into
// public/dnd4e/. Cards link back to the wiki.

import { SearchResult, matchScore } from "./fiveETools";

export const DND4E_WIKI = "https://leonspace.site/";
const DND4E_BASE = `${process.env.PUBLIC_URL || ""}/dnd4e/`;

/** Where a record lives in the data chunks */
export type Dnd4eLocation = { kind: string; chunk: number; position: number };

type Dnd4eIndex = {
  kinds: [string, string][];
  // [中文, English, kind, level, chunk, position, type, usage]
  entries: [string, string, number, number | null, number, number, string, string][];
};

// Results with the same match: powers, feats, items first
const KIND_BOOST: Record<string, number> = { 威能: 6, 专长: 5, 物品: 4, 仪式: 3 };
// Category ids for SearchResult, apart from 5etools' and PF2's
const CATEGORY_BASE = 2000;

let indexPromise: Promise<Dnd4eIndex> | null = null;

export function loadDnd4eIndex() {
  if (!indexPromise) {
    indexPromise = fetch(`${DND4E_BASE}index.json`)
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

/** The wiki's page for an entry (TiddlyWiki permalink) */
export function dnd4eUrl(name: string, englishName: string) {
  return `${DND4E_WIKI}#${encodeURIComponent([name, englishName].filter(Boolean).join(" "))}`;
}

function toResult(index: Dnd4eIndex, entry: Dnd4eIndex["entries"][number]): SearchResult {
  const [name, englishName, kindIndex, level, chunk, position, type, usage] = entry;
  const [kind, label] = index.kinds[kindIndex];
  return {
    id: CATEGORY_BASE * 100000 + kindIndex * 1000 + chunk * 50 + position,
    name,
    englishName,
    category: CATEGORY_BASE + kindIndex,
    categoryLabel: level != null ? `${label} ${level}` : label,
    // Shown at the end of the row: "法师攻击 · 每日", a feat's tier, ...
    source: [type, usage].filter(Boolean).join(" · "),
    url: dnd4eUrl(name, englishName),
    reprinted: false,
    modern: false,
    isMonster: false,
    system: "4e",
    dnd4e: { kind, chunk, position },
  };
}

export async function searchDnd4e(query: string, limit = 60) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const index = await loadDnd4eIndex();
  const scored: [number, Dnd4eIndex["entries"][number]][] = [];
  for (const entry of index.entries) {
    const score = Math.max(matchScore(entry[0], q), matchScore(entry[1], q) - 5);
    if (score === 0) continue;
    scored.push([score + (KIND_BOOST[index.kinds[entry[2]][0]] || 0), entry]);
  }
  scored.sort(
    (a, b) => b[0] - a[0] || a[1][0].length - b[1][0].length || (a[1][3] ?? 0) - (b[1][3] ?? 0)
  );
  return scored.slice(0, limit).map(([, entry]) => toResult(index, entry));
}

/** The result for an entry's full title ("火球术 Fireball"), for ⟦links⟧ */
export async function findDnd4eTitle(title: string) {
  const index = await loadDnd4eIndex();
  const entry = index.entries.find((e) => [e[0], e[1]].filter(Boolean).join(" ") === title);
  return entry ? toResult(index, entry) : null;
}

const chunks = new Map<string, Promise<any[]>>();

export async function loadDnd4eRecord({ kind, chunk, position }: Dnd4eLocation) {
  const key = `${kind}-${chunk}`;
  if (!chunks.has(key)) {
    chunks.set(
      key,
      fetch(`${DND4E_BASE}data/${encodeURIComponent(key)}.json`)
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

/** Party panel chips in 4e mode: conditions open the condition table */
export async function findDnd4e(name: string, kind: "condition" | "spell") {
  if (kind === "condition") return findDnd4eTitle("状态表");
  const results = await searchDnd4e(name, 20);
  return results.find((r) => r.dnd4e?.kind === "威能") || results[0] || null;
}
