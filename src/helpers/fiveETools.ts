// Quick search over the Chinese 5etools site (https://5e.kiwee.top/). The
// browser reads its public search index and bestiary data directly (both are
// served with Access-Control-Allow-Origin: *); nothing is copied to this site.

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

// 2014 core books come first; the table plays with those rules. The boost
// only reorders equally good name matches (exact > prefix > contains).
const PREFERRED_SOURCES = new Set(["MM", "PHB", "DMG"]);
const PREFERRED_BOOST = 20;

function toResult(
  entry: IndexEntry,
  { sources, modernSources }: Pick<SearchIndex, "sources" | "modernSources">
): SearchResult {
  const source =
    typeof entry.s === "number" ? sources[entry.s] || "" : String(entry.s);
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
    modern: modernSources.has(source),
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

export async function searchFiveE(query: string, limit = 60) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const index = await loadSearchIndex();
  const { entries, sources } = index;
  const scored: [number, IndexEntry][] = [];
  for (const entry of entries) {
    const score = Math.max(
      matchScore(entry.cn || "", q),
      matchScore(entry.n, q) - 5
    );
    if (score === 0) continue;
    const source = typeof entry.s === "number" ? sources[entry.s] : entry.s;
    const sourceBonus = PREFERRED_SOURCES.has(source)
      ? PREFERRED_BOOST
      : entry.dR
      ? -15
      : 0;
    scored.push([score + (CATEGORY_BOOST[entry.c] || 0) + sourceBonus, entry]);
  }
  scored.sort(
    (a, b) =>
      b[0] - a[0] ||
      (a[1].cn || a[1].n).length - (b[1].cn || b[1].n).length ||
      a[1].id - b[1].id
  );
  return scored.slice(0, limit).map(([, entry]) => toResult(entry, index));
}

/* ---------- monsters ---------- */

export type MonsterRef = {
  name: string;
  englishName: string;
  source: string;
  url: string;
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

export function loadMonster(ref: MonsterRef) {
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
    value.url.startsWith(FIVE_E_BASE)
  );
}

/** The search result a stored monster stands for, to show its card again */
export function monsterResult(ref: MonsterRef): SearchResult {
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

const OPEN_MONSTER_EVENT = "fiveE:openMonster";

/** Opens a monster's stat card in the quick search bar (from anywhere) */
export function openMonsterCard(ref: MonsterRef) {
  window.dispatchEvent(new CustomEvent(OPEN_MONSTER_EVENT, { detail: ref }));
}

export function onOpenMonsterCard(listener: (ref: MonsterRef) => void) {
  const handler = (event: Event) => {
    const ref = (event as CustomEvent).detail;
    if (isMonsterRef(ref)) listener(ref);
  };
  window.addEventListener(OPEN_MONSTER_EVENT, handler);
  return () => window.removeEventListener(OPEN_MONSTER_EVENT, handler);
}

export function monsterRefOf(result: SearchResult): MonsterRef {
  return {
    name: result.name,
    englishName: result.englishName || result.name,
    source: result.source,
    url: result.url,
  };
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
