// Detail cards for non-monster quick-search results (spells, items, conditions,
// feats, ...), read from the same 5etools data files the site uses, so the
// panel can show just the entry instead of the site's list + filter page.

import { SearchResult, fetchJson } from "./fiveETools";
import { entriesToText, renderTags } from "./fiveEStatblock";

export type EntryCard = {
  name: string;
  englishName: string;
  subtitle: string;
  lines: { label: string; text: string }[];
  paragraphs: string[];
};

type Source = { file: string; key: string };

// Category -> where its records live (single files; spells are per book)
const CATEGORY_FILES: Record<number, Source[]> = {
  3: [{ file: "backgrounds.json", key: "background" }],
  4: [
    { file: "items.json", key: "item" },
    { file: "items-base.json", key: "baseitem" },
  ],
  6: [{ file: "conditionsdiseases.json", key: "condition" }],
  7: [{ file: "feats.json", key: "feat" }],
  10: [
    { file: "races.json", key: "race" },
    { file: "races.json", key: "subrace" },
  ],
  12: [{ file: "variantrules.json", key: "variantrule" }],
  14: [{ file: "deities.json", key: "deity" }],
  15: [{ file: "objects.json", key: "object" }],
  16: [{ file: "trapshazards.json", key: "trap" }],
  17: [{ file: "trapshazards.json", key: "hazard" }],
  21: [{ file: "conditionsdiseases.json", key: "disease" }],
  42: [{ file: "actions.json", key: "action" }],
  49: [{ file: "conditionsdiseases.json", key: "status" }],
};
// Optional features: invocations, metamagic, maneuvers, fighting styles, ...
for (const id of [8, 22, 23, 26, 27, 28, 29, 32, 33, 34, 37, 38, 39]) {
  CATEGORY_FILES[id] = [{ file: "optionalfeatures.json", key: "optionalfeature" }];
}
const SPELLS = 2;

export function hasEntryCard(result: SearchResult) {
  return result.category === SPELLS || result.category in CATEGORY_FILES;
}

const files = new Map<string, Promise<any>>();
function dataFile(path: string) {
  if (!files.has(path)) {
    files.set(
      path,
      fetchJson(`data/${path}`).catch((error) => {
        files.delete(path);
        throw error;
      })
    );
  }
  return files.get(path)!;
}

const sameName = (record: any, englishName: string) =>
  (record.ENG_name || record.name) === englishName || record.name === englishName;

/** The record behind a search result, or null if it is not in the data files */
export async function loadEntryRecord(result: SearchResult): Promise<any | null> {
  const englishName = result.englishName || result.name;
  let sources: Source[];
  if (result.category === SPELLS) {
    const index = await dataFile("spells/index.json");
    const file = index[result.source];
    if (!file) return null;
    sources = [{ file: `spells/${file}`, key: "spell" }];
  } else {
    sources = CATEGORY_FILES[result.category] || [];
  }
  for (const { file, key } of sources) {
    const data = await dataFile(file);
    const record = (data[key] || []).find(
      (r: any) => sameName(r, englishName) && (!r.source || r.source === result.source)
    );
    if (record) return record;
  }
  return null;
}

/* ---------- spells ---------- */

const SCHOOL: Record<string, string> = {
  A: "防护",
  C: "咒法",
  D: "预言",
  E: "惑控",
  V: "塑能",
  I: "幻术",
  N: "死灵",
  T: "变化",
};
const TIME_UNIT: Record<string, string> = {
  action: "动作",
  bonus: "附赠动作",
  reaction: "反应",
  minute: "分钟",
  hour: "小时",
  round: "轮",
};
const DURATION_UNIT: Record<string, string> = {
  round: "轮",
  minute: "分钟",
  hour: "小时",
  day: "天",
  week: "周",
  year: "年",
};
const AREA: Record<string, string> = {
  radius: "半径",
  sphere: "球形",
  cone: "锥形",
  line: "线形",
  cube: "立方",
  hemisphere: "半球",
  emanation: "光环",
  cylinder: "柱形",
};

function distanceText(distance: any) {
  if (!distance) return "";
  switch (distance.type) {
    case "self":
      return "自身";
    case "touch":
      return "触及";
    case "sight":
      return "视线所及";
    case "unlimited":
      return "无限";
    case "miles":
      return `${distance.amount} 里`;
    case "feet":
      return `${distance.amount} 尺`;
    default:
      return distance.amount ? `${distance.amount} ${distance.type}` : distance.type;
  }
}

export function spellCard(record: any): EntryCard {
  const level = record.level === 0 ? `${SCHOOL[record.school] || ""}戏法` : `${record.level} 环${SCHOOL[record.school] || ""}`;
  const time = (record.time || [])
    .map((t: any) =>
      `${t.number ?? 1} ${TIME_UNIT[t.unit] || t.unit}${
        t.condition ? `，${renderTags(t.condition)}` : ""
      }`
    )
    .join(" 或 ");
  const range = record.range || {};
  const rangeText =
    range.type === "point"
      ? distanceText(range.distance)
      : range.type === "special"
      ? "特殊"
      : `自身（${distanceText(range.distance)}${AREA[range.type] || ""}）`;
  const c = record.components || {};
  const components = [
    c.v && "言语",
    c.s && "姿势",
    c.m && `材料（${renderTags(typeof c.m === "string" ? c.m : c.m.text || "")}）`,
  ]
    .filter(Boolean)
    .join("、");
  const duration = (record.duration || [])
    .map((d: any) => {
      if (d.type === "instant") return "立即";
      if (d.type === "permanent") return d.ends?.length ? `直到${d.ends.join("或")}` : "永久";
      if (d.type === "special") return "特殊";
      if (d.type === "timed") {
        const span = `${d.duration?.amount ?? ""} ${DURATION_UNIT[d.duration?.type] || d.duration?.type || ""}`.trim();
        return d.concentration ? `专注，至多 ${span}` : span;
      }
      return d.type;
    })
    .join(" 或 ");
  return {
    name: record.name,
    englishName: record.ENG_name && record.ENG_name !== record.name ? record.ENG_name : "",
    subtitle: `${level}${record.meta?.ritual ? "（仪式）" : ""}`,
    lines: [
      { label: "施法时间", text: time },
      { label: "施法距离", text: rangeText },
      { label: "法术成分", text: components },
      { label: "持续时间", text: duration },
    ].filter((l) => l.text),
    paragraphs: [...entriesToText(record.entries), ...entriesToText(record.entriesHigherLevel)],
  };
}

/* ---------- items ---------- */

const RARITY: Record<string, string> = {
  common: "普通",
  uncommon: "非普通",
  rare: "珍稀",
  "very rare": "非常珍稀",
  legendary: "传说",
  artifact: "神器",
  varies: "稀有度不定",
  "unknown (magic)": "未知稀有度",
};
const DAMAGE_TYPE: Record<string, string> = {
  A: "强酸",
  B: "钝击",
  C: "寒冷",
  F: "火焰",
  O: "力场",
  L: "闪电",
  N: "暗蚀",
  P: "穿刺",
  I: "毒素",
  Y: "心灵",
  R: "光耀",
  S: "挥砍",
  T: "雷鸣",
};

const abbr = (code: unknown) => String(code ?? "").split("|")[0];

/** Item type and property names, from the site's own items-base.json */
export async function loadItemGlossary() {
  const base = await dataFile("items-base.json");
  const types: Record<string, string> = {};
  for (const t of base.itemType || []) types[t.abbreviation] = t.name;
  const properties: Record<string, string> = {};
  for (const p of base.itemProperty || []) {
    properties[p.abbreviation] = p.name || p.entries?.[0]?.name || p.abbreviation;
  }
  return { types, properties };
}

export function itemCard(
  record: any,
  glossary: { types: Record<string, string>; properties: Record<string, string> }
): EntryCard {
  const kind = record.wondrous
    ? "奇物"
    : glossary.types[abbr(record.type)] ||
      (record.weaponCategory === "simple" ? "简易武器" : record.weaponCategory === "martial" ? "军用武器" : "物品");
  const rarity = RARITY[record.rarity] || "";
  const attune =
    record.reqAttune === true
      ? "（需同调）"
      : typeof record.reqAttune === "string"
      ? // Some texts already say who can attune ("需矮人或……同调的生物")
        renderTags(record.reqAttune).includes("同调")
        ? `（${renderTags(record.reqAttune)}）`
        : `（需${renderTags(record.reqAttune)}同调）`
      : "";
  const lines: { label: string; text: string }[] = [];
  if (record.dmg1) {
    lines.push({
      label: "伤害",
      text: `${record.dmg1} ${DAMAGE_TYPE[record.dmgType] || ""}${record.dmg2 ? `（双手 ${record.dmg2}）` : ""}`.trim(),
    });
  }
  if (record.ac) lines.push({ label: "护甲等级", text: String(record.ac) });
  if (record.property?.length)
    lines.push({
      label: "属性",
      text: record.property
        .map((p: any) => glossary.properties[abbr(typeof p === "string" ? p : p.uid)] || abbr(p))
        .join("、"),
    });
  if (record.mastery?.length)
    lines.push({ label: "精通", text: record.mastery.map((m: any) => abbr(typeof m === "string" ? m : m.uid)).join("、") });
  if (record.weight) lines.push({ label: "重量", text: `${record.weight} 磅` });
  if (record.value) lines.push({ label: "价格", text: record.value >= 100 ? `${record.value / 100} gp` : `${record.value} cp` });
  return {
    name: record.name,
    englishName: record.ENG_name && record.ENG_name !== record.name ? record.ENG_name : "",
    subtitle: [kind, rarity].filter(Boolean).join("，") + attune,
    lines,
    paragraphs: entriesToText([...(record.entries || []), ...(record.additionalEntries || [])]),
  };
}

/* ---------- everything else ---------- */

export function genericCard(record: any, categoryLabel: string): EntryCard {
  const lines: { label: string; text: string }[] = [];
  if (record.pantheon) lines.push({ label: "神系", text: renderTags(record.pantheon) });
  if (record.domains?.length) lines.push({ label: "领域", text: record.domains.join("、") });
  if (record.province) lines.push({ label: "掌管", text: renderTags(record.province) });
  if (record.symbol) lines.push({ label: "圣徽", text: renderTags(record.symbol) });
  if (record.ac != null && typeof record.ac !== "object") lines.push({ label: "护甲等级", text: String(record.ac) });
  if (record.hp != null && typeof record.hp !== "object") lines.push({ label: "生命值", text: String(record.hp) });
  return {
    name: record.name,
    englishName: record.ENG_name && record.ENG_name !== record.name ? record.ENG_name : "",
    subtitle: categoryLabel,
    lines,
    paragraphs: entriesToText(record.entries || record.actionEntries || []),
  };
}

export async function loadEntryCard(result: SearchResult): Promise<EntryCard | null> {
  const record = await loadEntryRecord(result);
  if (!record) return null;
  if (result.category === SPELLS) return spellCard(record);
  if (result.category === 4) return itemCard(record, await loadItemGlossary());
  return genericCard(record, result.categoryLabel);
}
