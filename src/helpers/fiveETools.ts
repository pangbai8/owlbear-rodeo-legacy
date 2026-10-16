// Quick search over the Chinese 5etools site (https://5e.kiwee.top/). The
// browser reads its public search index and bestiary data directly (both are
// served with Access-Control-Allow-Origin: *); nothing is copied to this site.

import type { Pf2Location } from "./pf2";
import type { Dnd4eLocation } from "./dnd4e";
import { PF2_WIKI, loadPf2Monster } from "./pf2";

export const FIVE_E_BASE = "https://5e.kiwee.top/";

/** Drag data type for a monster dragged out of the quick search */
export const MONSTER_DRAG_TYPE = "application/x-owlbear-monster";

const CATEGORY_CREATURE = 1;

// Category id -> page, from 5etools' UrlUtil.CAT_TO_PAGE
const CATEGORY_PAGE: Record<number, string> = {
  1: "bestiary.html",
  2: "spells.html",
  3: "backgrounds.html",
  4: "items.html",
  5: "classes.html",
  6: "conditionsdiseases.html",
  7: "feats.html",
  8: "optionalfeatures.html",
  9: "psionics.html",
  10: "races.html",
  11: "rewards.html",
  12: "variantrules.html",
  13: "adventure.html",
  14: "deities.html",
  15: "objects.html",
  16: "trapshazards.html",
  17: "trapshazards.html",
  18: "quickreference.html",
  19: "cultsboons.html",
  20: "cultsboons.html",
  21: "conditionsdiseases.html",
  22: "optionalfeatures.html",
  23: "optionalfeatures.html",
  24: "tables.html",
  25: "tables.html",
  26: "optionalfeatures.html",
  27: "optionalfeatures.html",
  28: "optionalfeatures.html",
  29: "optionalfeatures.html",
  30: "classes.html",
  31: "vehicles.html",
  32: "optionalfeatures.html",
  33: "optionalfeatures.html",
  34: "optionalfeatures.html",
  35: "vehicles.html",
  36: "vehicles.html",
  37: "optionalfeatures.html",
  38: "optionalfeatures.html",
  39: "optionalfeatures.html",
  40: "classes.html",
  41: "classes.html",
  42: "actions.html",
  43: "languages.html",
  44: "book.html",
  46: "bestiary.html",
  47: "charcreationoptions.html",
  48: "recipes.html",
  49: "conditionsdiseases.html",
  52: "decks.html",
  55: "bastions.html",
  56: "vehicles.html",
  57: "homecrafts.html",
};

// Category id -> label, from 5etools' Parser.CAT_ID_TO_FULL (zh-CN)
const CATEGORY_LABEL: Record<number, string> = {
  1: "怪物",
  2: "法术",
  3: "背景",
  4: "物品",
  5: "职业",
  6: "状态",
  7: "专长",
  8: "魔能祈唤",
  9: "灵能",
  10: "种族",
  11: "其他奖励",
  12: "变体规则",
  13: "冒险",
  14: "神祇",
  15: "物件",
  16: "陷阱",
  17: "危险",
  18: "快速参考",
  19: "异教",
  20: "恩惠",
  21: "疾病",
  22: "超魔法",
  23: "战技",
  24: "表格",
  25: "表格",
  26: "战技",
  27: "秘法射击",
  28: "可选特性",
  29: "战斗风格",
  30: "职业特性",
  31: "载具",
  32: "契约恩赐",
  33: "四象法门",
  34: "注法",
  37: "真名言灵",
  38: "炼金师公式",
  39: "战技",
  40: "子职",
  41: "子职特性",
  42: "动作",
  43: "语言",
  44: "书籍",
  46: "传奇组",
  47: "角色创建选项",
  48: "食谱",
  49: "状态",
  52: "牌组",
  55: "据点",
};

// Categories most often looked up at the table come first among equal matches
const CATEGORY_BOOST: Record<number, number> = { 1: 6, 2: 5, 4: 4, 6: 3, 49: 3, 7: 2, 42: 2 };

type IndexEntry = {
  id: number;
  c: number;
  u: string;
  uh?: string;
  s: number | string;
  n: string;
  cn?: string;
  dR?: number;
};

export type SearchResult = {
  id: number;
  name: string;
  englishName: string;
  category: number;
  categoryLabel: string;
  source: string;
  url: string;
  reprinted: boolean;
  /** From a 5e 2024 rules book (shown dimmed; the table plays 2014) */
  modern: boolean;
  isMonster: boolean;
  /** From the PF2 or 4e mirror (pf2.ts, dnd4e.ts) instead of 5etools */
  system?: "pf2" | "4e";
  /** Where a PF2 result's record is */
  pf2?: Pf2Location;
  /** Where a 4e result's record is */
  dnd4e?: Dnd4eLocation;
  /** Color for its category label in the results (4e powers by usage) */
  accent?: string;
};

type SearchIndex = {
  entries: IndexEntry[];
  sources: string[];
  modernSources: Set<string>;
};

// Books and adventures from the 2024 Player's Handbook on use the 2024 rules
const MODERN_SINCE = "2024-09-17";

/** Sources published for the 2024 rules, from the site's book lists */
async function loadModernSources() {
  const lists = await Promise.all(
    [
      ["data/books.json", "book"],
      ["data/adventures.json", "adventure"],
    ].map(([path, key]) =>
      fetchJson(path)
        .then((data) => data[key] || [])
        // Without the lists nothing is dimmed; search still works
        .catch(() => [])
    )
  );
  const modern = new Set<string>();
  for (const book of lists.flat()) {
    if ((book.published || "") >= MODERN_SINCE) modern.add(book.id);
  }
  return modern;
}

let indexPromise: Promise<SearchIndex> | null = null;

/** Loads the search index once (about 3 MB, cached by the browser) */
export function loadSearchIndex() {
  if (!indexPromise) {
    indexPromise = Promise.all([fetchJson("search/index.json"), loadModernSources()])
      .then(([data, modernSources]) => {
        const sources: string[] = [];
        for (const [abbr, index] of Object.entries(data.m?.s || {})) {
          sources[index as number] = abbr;
        }
        return { entries: data.x as IndexEntry[], sources, modernSources };
      })
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

// Which rules come first: "2014" (5e mode: the 2014 core books first, 2024
// books dimmed) or "2024" (5r mode: 2024 books first and highlighted, older
// entries a 2024 book replaced dimmed). The boost only reorders equally good
// name matches (exact > prefix > contains).
export type Edition = "2014" | "2024";
const PREFERRED_SOURCES = new Set(["MM", "PHB", "DMG"]);
const PREFERRED_BOOST = 20;
/** 5r mode: the label color of 2024 results */
export const EDITION_2024_COLOR = "#2e7d6b";

function sourceBonus(source: string, entry: IndexEntry, modern: boolean, edition: Edition) {
  if (edition === "2024") return modern ? PREFERRED_BOOST : entry.dR ? -15 : 0;
  return PREFERRED_SOURCES.has(source) ? PREFERRED_BOOST : entry.dR ? -15 : 0;
}

function toResult(
  entry: IndexEntry,
  { sources, modernSources }: Pick<SearchIndex, "sources" | "modernSources">,
  edition: Edition = "2014"
): SearchResult {
  const source =
    typeof entry.s === "number" ? sources[entry.s] || "" : String(entry.s);
  const modern = modernSources.has(source);
  if (edition === "2024") {
    return {
      ...toResult(entry, { sources, modernSources }),
      // Dimmed when a 2024 book replaced it; 2024 entries stand out
      reprinted: entry.dR === 1,
      modern: false,
      accent: modern ? EDITION_2024_COLOR : undefined,
    };
  }
  const page = CATEGORY_PAGE[entry.c] || "search.html";
  const hash = entry.uh || entry.u;
  return {
    id: entry.id,
    name: entry.cn || entry.n,
    englishName: entry.cn ? entry.n : "",
    category: entry.c,
    categoryLabel: CATEGORY_LABEL[entry.c] || "其他",
    source,
    url: `${FIVE_E_BASE}${page}#${hash}`,
    // Not dimmed as "old" when it is a book the table prefers
    reprinted: entry.dR === 1 && !PREFERRED_SOURCES.has(source),
    modern,
    isMonster: entry.c === CATEGORY_CREATURE,
  };
}

/** Scores how well one name matches the query (0: no match) */
export function matchScore(name: string, query: string) {
  if (!name) return 0;
  const n = name.toLowerCase();
  if (n === query) return 100;
  if (n.startsWith(query)) return 70;
  if (n.includes(query)) return 40;
  return 0;
}

export async function searchFiveE(
  query: string,
  limit = 60,
  edition: Edition = "2014"
) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const index = await loadSearchIndex();
  const { entries, sources, modernSources } = index;
  const scored: [number, IndexEntry][] = [];
  for (const entry of entries) {
    const score = Math.max(
      matchScore(entry.cn || "", q),
      matchScore(entry.n, q) - 5
    );
    if (score === 0) continue;
    const source = typeof entry.s === "number" ? sources[entry.s] : entry.s;
    const bonus = sourceBonus(source, entry, modernSources.has(source), edition);
    scored.push([score + (CATEGORY_BOOST[entry.c] || 0) + bonus, entry]);
  }
  scored.sort(
    (a, b) =>
      b[0] - a[0] ||
      (a[1].cn || a[1].n).length - (b[1].cn || b[1].n).length ||
      a[1].id - b[1].id
  );
  return scored.slice(0, limit).map(([, entry]) => toResult(entry, index, edition));
}

/* ---------- monsters ---------- */

export type MonsterRef = {
  name: string;
  englishName: string;
  source: string;
  url: string;
  /** A PF2 creature (its url is on the PF2 wiki) */
  system?: "pf2";
};

export type MonsterStats = MonsterRef & {
  /** Grid cells per side: Tiny–Medium 1, Large 2, Huge 3, Gargantuan 4 */
  size: number;
  ac: number | null;
  hp: number | null;
  initBonus: number;
  cr: string;
  tokenUrl: string | null;
};

const SIZE_CELLS: Record<string, number> = { T: 1, S: 1, M: 1, L: 2, H: 3, G: 4 };

let bestiaryIndexPromise: Promise<Record<string, string>> | null = null;
const bestiaryFiles = new Map<string, Promise<any[]>>();

export async function fetchJson(path: string) {
  const response = await fetch(FIVE_E_BASE + path);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  return response.json();
}

async function bestiaryFile(source: string) {
  if (!bestiaryIndexPromise) {
    bestiaryIndexPromise = fetchJson("data/bestiary/index.json").catch(
      (error) => {
        bestiaryIndexPromise = null;
        throw error;
      }
    );
  }
  const index = await bestiaryIndexPromise;
  const file = index[source];
  if (!file) throw new Error(`没有 ${source} 的怪物数据`);
  if (!bestiaryFiles.has(file)) {
    bestiaryFiles.set(
      file,
      fetchJson(`data/bestiary/${file}`).then(
        (data) => data.monster || [],
        (error) => {
          bestiaryFiles.delete(file);
          throw error;
        }
      )
    );
  }
  return bestiaryFiles.get(file)!;
}

/** Finds a monster record, filling in "_copy" variants from their base */
async function monsterRecord(
  source: string,
  englishName: string,
  depth = 0
): Promise<any> {
  const monsters = await bestiaryFile(source);
  const record = monsters.find(
    (m: any) =>
      (m.ENG_name || m.name) === englishName ||
      m.name === englishName
  );
  if (!record) throw new Error(`找不到怪物 ${englishName} (${source})`);
  if (record._copy && depth < 4) {
    const base = await monsterRecord(
      record._copy.source,
      record._copy.ENG_name || record._copy.name,
      depth + 1
    ).catch(() => ({}));
    return { ...base, ...record, hasToken: record.hasToken };
  }
  return record;
}

export function proficiencyBonus(cr: string) {
  const value = cr.includes("/") ? 0 : parseFloat(cr) || 0;
  return value < 5 ? 2 : Math.min(9, 2 + Math.floor((value - 1) / 4));
}

/** Pulls the numbers the map and the party panel need out of a 5etools monster */
export function monsterStats(record: any, ref: MonsterRef): MonsterStats {
  const sizeLetter = Array.isArray(record.size) ? record.size[0] : record.size;
  const firstAc = Array.isArray(record.ac) ? record.ac[0] : record.ac;
  const ac =
    typeof firstAc === "number"
      ? firstAc
      : typeof firstAc?.ac === "number"
      ? firstAc.ac
      : null;
  const hp = typeof record.hp?.average === "number" ? record.hp.average : null;
  const cr = String(
    typeof record.cr === "object" ? record.cr?.cr ?? "" : record.cr ?? ""
  );
  const dexMod = Math.floor(((record.dex ?? 10) - 10) / 2);
  let initBonus = dexMod;
  if (typeof record.initiative === "number") {
    initBonus = record.initiative;
  } else if (record.initiative?.proficiency) {
    initBonus += proficiencyBonus(cr) * record.initiative.proficiency;
  }
  let tokenUrl: string | null = null;
  if (record.tokenUrl) {
    tokenUrl = new URL(record.tokenUrl, FIVE_E_BASE).href;
  } else if (record.hasToken) {
    tokenUrl = `${FIVE_E_BASE}img/bestiary/tokens/${
      record.source
    }/${encodeURIComponent(record.ENG_name || record.name)}.webp`;
  }
  return {
    ...ref,
    size: SIZE_CELLS[sizeLetter] || 1,
    ac,
    hp,
    initBonus,
    cr,
    tokenUrl,
  };
}

const statsCache = new Map<string, Promise<MonsterStats>>();

export function loadMonster(ref: MonsterRef): Promise<MonsterStats> {
  if (ref.system === "pf2") return loadPf2Monster(ref);
  const key = `${ref.source}|${ref.englishName}`;
  if (!statsCache.has(key)) {
    statsCache.set(
      key,
      monsterRecord(ref.source, ref.englishName).then(
        (record) => monsterStats(record, ref),
        (error) => {
          statsCache.delete(key);
          throw error;
        }
      )
    );
  }
  return statsCache.get(key)!;
}

/** The full monster record (for the stat card); files are cached */
export function loadMonsterRecord(ref: MonsterRef) {
  return monsterRecord(ref.source, ref.englishName);
}

/** Whether a value (e.g. from the party panel frame) looks like a MonsterRef */
export function isMonsterRef(value: any): value is MonsterRef {
  return (
    !!value &&
    typeof value.name === "string" &&
    typeof value.englishName === "string" &&
    typeof value.source === "string" &&
    typeof value.url === "string" &&
    (value.system === "pf2"
      ? value.url.startsWith(PF2_WIKI)
      : value.system === undefined && value.url.startsWith(FIVE_E_BASE))
  );
}

/** The search result a stored monster stands for, to show its card again */
export function monsterResult(ref: MonsterRef): SearchResult {
  if (ref.system === "pf2") {
    // Its record is found by name when the card opens
    return {
      id: -1,
      name: ref.name,
      englishName: ref.englishName !== ref.name ? ref.englishName : "",
      category: 1000,
      categoryLabel: "生物",
      source: ref.source,
      url: ref.url,
      reprinted: false,
      modern: false,
      isMonster: true,
      system: "pf2",
    };
  }
  return {
    id: -1,
    name: ref.name,
    englishName: ref.englishName !== ref.name ? ref.englishName : "",
    category: CATEGORY_CREATURE,
    categoryLabel: CATEGORY_LABEL[CATEGORY_CREATURE],
    source: ref.source,
    url: ref.url,
    reprinted: false,
    modern: false,
    isMonster: true,
  };
}

const OPEN_CARD_EVENT = "fiveE:openCard";

/** Opens a search result's card in the quick search bar (from anywhere) */
export function openFiveECard(result: SearchResult) {
  window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail: result }));
}

/** Opens a stored monster's stat card (token menu, party panel 📖) */
export function openMonsterCard(ref: MonsterRef) {
  if (isMonsterRef(ref)) openFiveECard(monsterResult(ref));
}

export function onOpenFiveECard(listener: (result: SearchResult) => void) {
  const handler = (event: Event) => listener((event as CustomEvent).detail);
  window.addEventListener(OPEN_CARD_EVENT, handler);
  return () => window.removeEventListener(OPEN_CARD_EVENT, handler);
}

// Conditions (and diseases, statuses like 专注) or spells, for panel chips
const LOOKUP_CATEGORIES = { condition: [6, 49, 21], spell: [2] };

/** Finds a condition or spell by name and opens its card; false if none */
export async function lookupFiveE(
  name: string,
  kind: keyof typeof LOOKUP_CATEGORIES,
  edition: Edition = "2014"
) {
  const categories = LOOKUP_CATEGORIES[kind];
  const found = (await searchFiveE(name, 200, edition)).filter((r) =>
    categories.includes(r.category)
  );
  // Results come best first (exact names, then the edition's books)
  if (!found[0]) return false;
  openFiveECard(found[0]);
  return true;
}

export function monsterRefOf(result: SearchResult): MonsterRef {
  return {
    name: result.name,
    englishName: result.englishName || result.name,
    source: result.source,
    url: result.url,
    ...(result.system === "pf2" ? { system: "pf2" as const } : {}),
  };
}

/** Crops a tall or wide picture to a square (biased up, where heads are) */
async function squareImage(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  if (Math.abs(width - height) <= 2) return blob;
  const side = Math.min(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const sx = (width - side) / 2;
  const sy = height > width ? (height - side) * 0.15 : 0;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, side, side, 0, 0, side, side);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("crop failed"))), "image/webp", 0.9)
  );
}

/** A round placeholder when 5etools has no token art for a monster */
async function placeholderToken(name: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#3b2f4a";
  ctx.beginPath();
  ctx.arc(128, 128, 124, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#d9c38c";
  ctx.stroke();
  ctx.fillStyle = "#f2ead6";
  ctx.font = "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(Array.from(name).slice(0, 2).join(""), 128, 132);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas"))),
      "image/png"
    )
  );
}

/**
 * An image File for a dropped monster. The "2x2"-style suffix is how
 * createTokenFromFile picks the token size (and it is removed from the name).
 */
export async function monsterTokenFile(stats: MonsterStats) {
  let blob: Blob | null = null;
  if (stats.tokenUrl) {
    const response = await fetch(stats.tokenUrl).catch(() => null);
    if (response?.ok) blob = await response.blob();
  }
  // PF2 art is a portrait, not a round token: crop it square
  if (blob) blob = await squareImage(blob).catch(() => blob);
  if (!blob) blob = await placeholderToken(stats.name);
  const size = stats.size > 1 ? ` ${stats.size}x${stats.size}` : "";
  const extension = blob.type === "image/webp" ? "webp" : "png";
  return new File([blob], `${stats.name}${size}.${extension}`, {
    type: blob.type || "image/png",
  });
}

export function parseMonsterDrag(dataTransfer: DataTransfer | null) {
  const raw = dataTransfer?.getData(MONSTER_DRAG_TYPE);
  if (!raw) return null;
  try {
    const ref = JSON.parse(raw);
    return isMonsterRef(ref) ? ref : null;
  } catch {
    return null;
  }
}

export function isMonsterDrag(dataTransfer: DataTransfer | null) {
  return !!dataTransfer?.types?.includes(MONSTER_DRAG_TYPE);
}
