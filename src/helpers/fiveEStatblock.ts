// Turns a 5etools (zh-CN) monster record into plain text lines for a compact
// stat card. Only what the quick search needs; the full page stays one click
// away on 5etools itself.

const ABILITY_LABEL: Record<string, string> = {
  str: "力量",
  dex: "敏捷",
  con: "体质",
  int: "智力",
  wis: "感知",
  cha: "魅力",
};

const SIZE_LABEL: Record<string, string> = {
  T: "微型",
  S: "小型",
  M: "中型",
  L: "大型",
  H: "巨型",
  G: "超巨型",
};

const TYPE_LABEL: Record<string, string> = {
  aberration: "异怪",
  beast: "野兽",
  celestial: "天界生物",
  construct: "构装生物",
  dragon: "龙",
  elemental: "元素",
  fey: "精类",
  fiend: "邪魔",
  giant: "巨人",
  humanoid: "类人生物",
  monstrosity: "怪兽",
  ooze: "泥怪",
  plant: "植物",
  undead: "亡灵",
};

const ALIGNMENT_LABEL: Record<string, string> = {
  L: "守序",
  N: "中立",
  C: "混乱",
  G: "善良",
  E: "邪恶",
  U: "无阵营",
  A: "任意阵营",
};

const SKILL_LABEL: Record<string, string> = {
  acrobatics: "特技",
  "animal handling": "驯兽",
  arcana: "奥秘",
  athletics: "运动",
  deception: "欺瞒",
  history: "历史",
  insight: "洞悉",
  intimidation: "威吓",
  investigation: "调查",
  medicine: "医药",
  nature: "自然",
  perception: "察觉",
  performance: "表演",
  persuasion: "游说",
  religion: "宗教",
  "sleight of hand": "巧手",
  stealth: "隐匿",
  survival: "求生",
};

const DAMAGE_LABEL: Record<string, string> = {
  acid: "强酸",
  bludgeoning: "钝击",
  cold: "寒冷",
  fire: "火焰",
  force: "力场",
  lightning: "闪电",
  necrotic: "暗蚀",
  piercing: "穿刺",
  poison: "毒素",
  psychic: "心灵",
  radiant: "光耀",
  slashing: "挥砍",
  thunder: "雷鸣",
};

const CONDITION_LABEL: Record<string, string> = {
  blinded: "目盲",
  charmed: "魅惑",
  deafened: "耳聋",
  exhaustion: "力竭",
  frightened: "恐慌",
  grappled: "受擒",
  incapacitated: "失能",
  invisible: "隐形",
  paralyzed: "麻痹",
  petrified: "石化",
  poisoned: "中毒",
  prone: "倒地",
  restrained: "束缚",
  stunned: "震慑",
  unconscious: "昏迷",
};

const SPEED_LABEL: Record<string, string> = {
  walk: "",
  burrow: "掘穴",
  climb: "攀爬",
  fly: "飞行",
  swim: "游泳",
};

const ATTACK_LABEL: Record<string, string> = {
  m: "近战攻击检定：",
  r: "远程攻击检定：",
  "m,r": "近战或远程攻击检定：",
  mw: "近战武器攻击：",
  rw: "远程武器攻击：",
  "mw,rw": "近战或远程武器攻击：",
  ms: "近战法术攻击：",
  rs: "远程法术攻击：",
  "ms,rs": "近战或远程法术攻击：",
};

/** Replaces 5etools {@tag ...} markup with readable text */
export function renderTags(text: string): string {
  let out = String(text ?? "");
  // Inner tags first: repeat until no tag is left (tags can nest)
  for (let i = 0; i < 5 && out.includes("{@"); i++) {
    out = out.replace(/\{@(\w+)\s*([^{}]*)\}/g, (_, tag: string, body: string) => {
      const parts = body.split("|");
      const text = parts[0].trim();
      switch (tag) {
        case "atk":
        case "atkr":
          return ATTACK_LABEL[text] || "攻击：";
        case "hit":
          return text.startsWith("-") ? text : `+${text}`;
        case "h":
          return "命中：";
        case "m":
          return "失手：";
        case "dc":
          return `DC ${text}`;
        case "recharge":
          return text ? `（充能 ${text}–6）` : "（充能 6）";
        case "actSave":
          return `${ABILITY_LABEL[text] || text}豁免：`;
        case "actSaveFail":
          return "豁免失败：";
        case "actSaveFailBy":
          return `豁免失败 ${text} 或更多：`;
        case "actSaveSuccess":
          return "豁免成功：";
        case "actSaveSuccessOrFail":
          return "豁免成功或失败：";
        case "actTrigger":
          return "触发：";
        case "actResponse":
          return "反应：";
        case "damage":
        case "dice":
        case "d20":
          return text;
        default:
          // {@tag text|source|display}: show the display text when given
          return (parts[2] || text).trim();
      }
    });
  }
  // Labels end in a full-width colon; drop the space the source puts after them
  return out.replace(/\s+/g, " ").replace(/：\s+/g, "：").trim();
}

/** Flattens 5etools entries (strings, lists, named sub-entries) to paragraphs */
export function entriesToText(entries: any): string[] {
  const out: string[] = [];
  const walk = (entry: any, prefix = "") => {
    if (entry == null) return;
    if (typeof entry === "string") {
      out.push(prefix + renderTags(entry));
    } else if (Array.isArray(entry)) {
      entry.forEach((e) => walk(e, prefix));
    } else if (entry.type === "list" || Array.isArray(entry.items)) {
      for (const item of entry.items || []) walk(item, "• ");
    } else if (entry.type === "table") {
      // Tables become one line per row: "d4 | 决策"
      const cell = (value: any): string =>
        typeof value === "string" || typeof value === "number"
          ? renderTags(String(value))
          : value?.roll
          ? String(value.roll.exact ?? `${value.roll.min}–${value.roll.max}`)
          : entriesToText(value).join(" ");
      if (entry.caption) out.push(prefix + renderTags(entry.caption));
      if (entry.colLabels?.length) out.push(prefix + entry.colLabels.map(cell).join(" | "));
      for (const row of entry.rows || []) {
        const cells = Array.isArray(row) ? row : row?.row || [];
        out.push(prefix + cells.map(cell).join(" | "));
      }
    } else {
      const name = entry.name ? `${renderTags(entry.name)}。` : "";
      const body = [...(entry.entries || []), ...(entry.entry ? [entry.entry] : [])];
      if (!body.length) {
        if (name) out.push(prefix + name);
        return;
      }
      const [first, ...rest] = body;
      if (typeof first === "string") out.push(prefix + name + renderTags(first));
      else {
        if (name) out.push(prefix + name);
        walk(first, prefix);
      }
      rest.forEach((e) => walk(e, prefix));
    }
  };
  walk(entries);
  return out;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
export const abilityMod = (score: number) => Math.floor((score - 10) / 2);

function listLabels(values: any, labels: Record<string, string>): string {
  if (!Array.isArray(values)) return "";
  return values
    .map((v) => {
      if (typeof v === "string") return labels[v] || v;
      if (v?.special) return renderTags(v.special);
      // e.g. { immune: ["bludgeoning", ...], note: "非魔法攻击" }
      const inner = v?.immune || v?.resist || v?.vulnerable || v?.conditionImmune;
      if (inner) {
        const text = listLabels(inner, labels);
        return v.note ? `${text}（${renderTags(v.note)}）` : text;
      }
      return "";
    })
    .filter(Boolean)
    .join("、");
}

export type StatItem = { name: string; paragraphs: string[] };
export type Statblock = {
  name: string;
  englishName: string;
  subtitle: string;
  ac: string;
  hp: string;
  speed: string;
  initiative: string;
  abilities: { key: string; label: string; score: number; mod: string }[];
  lines: { label: string; text: string }[];
  sections: { title: string; items: StatItem[] }[];
};

function spellcastingItems(record: any, displayAs: string): StatItem[] {
  return (record.spellcasting || [])
    .filter((s: any) => (s.displayAs || "trait") === displayAs)
    .map((s: any) => {
      const paragraphs = entriesToText(s.headerEntries || []);
      if (s.will?.length)
        paragraphs.push(`随意：${s.will.map(renderTags).join("、")}`);
      for (const [key, spells] of Object.entries(s.daily || {})) {
        const n = key.replace("e", "");
        paragraphs.push(
          `${n}/日${key.endsWith("e") ? "（每种）" : ""}：${(spells as string[])
            .map(renderTags)
            .join("、")}`
        );
      }
      for (const [level, data] of Object.entries<any>(s.spells || {})) {
        const label = level === "0" ? "戏法" : `${level} 环`;
        paragraphs.push(`${label}：${(data.spells || []).map(renderTags).join("、")}`);
      }
      return { name: renderTags(s.name || "施法"), paragraphs };
    });
}

function items(list: any): StatItem[] {
  return (list || []).map((t: any) => ({
    name: renderTags(t.name || ""),
    paragraphs: entriesToText(t.entries || []),
  }));
}

export function statblock(record: any, initBonus: number): Statblock {
  const sizes = (Array.isArray(record.size) ? record.size : [record.size])
    .map((s: string) => SIZE_LABEL[s] || s)
    .join("或");
  const type =
    typeof record.type === "string"
      ? TYPE_LABEL[record.type] || record.type
      : `${TYPE_LABEL[record.type?.type] || record.type?.type || ""}${
          record.type?.tags?.length
            ? `（${record.type.tags
                .map((t: any) => (typeof t === "string" ? t : t.tag))
                .join("、")}）`
            : ""
        }`;
  const alignment = (record.alignment || [])
    .map((a: any) => (typeof a === "string" ? ALIGNMENT_LABEL[a] || a : ""))
    .join("");

  const ac = (record.ac || [])
    .map((a: any) =>
      typeof a === "number"
        ? `${a}`
        : `${a.ac}${a.from ? `（${a.from.map(renderTags).join("、")}）` : ""}${
            a.condition ? ` ${renderTags(a.condition)}` : ""
          }`
    )
    .join("，");
  const hp = record.hp?.special
    ? renderTags(record.hp.special)
    : `${record.hp?.average ?? "?"}${record.hp?.formula ? `（${record.hp.formula}）` : ""}`;
  const speed = Object.entries(record.speed || {})
    .filter(([k]) => k in SPEED_LABEL)
    .map(([k, v]: [string, any]) => {
      const value = typeof v === "object" ? v.number : v;
      const cond = typeof v === "object" && v.condition ? ` ${renderTags(v.condition)}` : "";
      return `${SPEED_LABEL[k]}${SPEED_LABEL[k] ? " " : ""}${value} 尺${cond}`;
    })
    .join("，");

  const lines: { label: string; text: string }[] = [];
  const add = (label: string, text: string) => text && lines.push({ label, text });
  add(
    "豁免",
    Object.entries(record.save || {})
      .map(([k, v]) => `${ABILITY_LABEL[k] || k} ${v}`)
      .join("，")
  );
  add(
    "技能",
    Object.entries(record.skill || {})
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => `${SKILL_LABEL[k] || k} ${v}`)
      .join("，")
  );
  add("易伤", listLabels(record.vulnerable, DAMAGE_LABEL));
  add("抗性", listLabels(record.resist, DAMAGE_LABEL));
  add("免疫", [listLabels(record.immune, DAMAGE_LABEL), listLabels(record.conditionImmune, CONDITION_LABEL)].filter(Boolean).join("；"));
  add(
    "感官",
    [...(record.senses || []).map(renderTags), record.passive != null ? `被动察觉 ${record.passive}` : ""]
      .filter(Boolean)
      .join("，")
  );
  add("语言", (record.languages || []).map(renderTags).join("、") || "—");
  add("挑战", typeof record.cr === "object" ? record.cr?.cr ?? "" : String(record.cr ?? ""));
  add("装备", (record.gear || []).map((g: any) => (typeof g === "string" ? g.split("|")[0] : g.item?.split("|")[0] || "")).join("、"));

  const sections = [
    { title: "特性", items: [...items(record.trait), ...spellcastingItems(record, "trait")] },
    { title: "动作", items: [...items(record.action), ...spellcastingItems(record, "action")] },
    { title: "附赠动作", items: [...items(record.bonus), ...spellcastingItems(record, "bonus")] },
    { title: "反应", items: [...items(record.reaction), ...spellcastingItems(record, "reaction")] },
    { title: "传奇动作", items: items(record.legendary) },
  ].filter((s) => s.items.length > 0);

  return {
    name: record.name || record.ENG_name || "",
    englishName: record.ENG_name && record.ENG_name !== record.name ? record.ENG_name : "",
    subtitle: [sizes + type, alignment].filter(Boolean).join("，"),
    ac,
    hp,
    speed,
    initiative: signed(initBonus),
    abilities: ["str", "dex", "con", "int", "wis", "cha"].map((key) => {
      const score = typeof record[key] === "number" ? record[key] : 10;
      return { key, label: ABILITY_LABEL[key], score, mod: signed(abilityMod(score)) };
    }),
    lines,
    sections,
  };
}
