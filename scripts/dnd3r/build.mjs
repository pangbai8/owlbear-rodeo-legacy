// Builds public/dnd3r/ (the 3R quick search's data) from an export of the
// Chinese D&D 3R wiki (https://dnd3r.huijiwiki.com/, CC BY-SA; game rules
// under the OGL). The wiki is behind a browser check, so the export is made
// in a browser on the wiki (scripts/dnd3r/export-in-browser.js) and saved as
// dnd3r-data.json.gz: { exported, source, pages: [{ title, text,
// categories }], redirects: { from: to } }.
//
//   node scripts/dnd3r/build.mjs path/to/dnd3r-data.json.gz [dnd3r-chm.json]
//
// The second file, from 《3R扩展大不全》 (scripts/dnd3r/chm/parse_chm.py), adds
// the entries the wiki lacks (matched by English or Chinese name, and by the
// pairs in scripts/dnd3r/chm/same-as.json). They go in chunks after the
// wiki's, so the wiki entries keep their places (favourites bars store them by
// chunk and position).
//
// Spells, powers, feats, maneuvers, items and monsters are templates in the
// articles ({{法术数据|名称=…|…}}); each becomes a record of fields and body
// text. The conditions come from the 城主指南/状态 page, other articles
// (rules, classes, races…) are kept as text. Output: index.json (names for
// the search) and data/<kind>-<n>.json chunks, so a card loads one small file.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const CHUNK = 60;
const CHUNK_BYTES = 120000;
const OUT = path.resolve("public/dnd3r");

// Template -> kind; the kinds' order is the search's tie-break
export const KINDS = [
  ["怪物", "怪物数据"],
  ["法术", "法术数据"],
  ["状态", null],
  ["灵能", "灵能数据"],
  ["武术", "武术数据"],
  ["专长", "专长数据"],
  ["物品", "物品数据"],
  ["条目", null],
];

// Fields shown elsewhere (title, subtitle) or not at all
const SKIP_FIELD = /^(名称|英文名|出处|页码|原书名|简介|dndtools.*|变体|族群)$/;
// Fields always shown as paragraphs, without their name
const BODY_FIELD = /^(描述|介绍)$/;
// Templates that link to another entry: {{法术|火球术}} -> ⟦火球术⟧
const LINK_TEMPLATES = new Set(["法术", "专长", "物品", "灵能", "武术", "怪物", "怪物能力", "本页能力", "技能", "状态", "职业", "种族", "进阶职业"]);
// Index entry's second column: what to show at the end of the result row
const ROW_FIELD = { 法术: "等级", 灵能: "等级", 武术: "等级", 专长: "类型", 物品: "类别", 怪物: "挑战等级" };

/** Splits template arguments at top-level "|" (not inside {{ }} or [[ ]]) */
export function splitArgs(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      i++;
    } else if ((two === "}}" || two === "]]") && depth > 0) {
      depth--;
      i++;
    } else if (body[i] === "|" && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** Every {{name|…}} at any depth in text, with its arguments as fields */
export function findTemplates(text, names) {
  const found = [];
  for (let i = text.indexOf("{{"); i >= 0; i = text.indexOf("{{", i + 2)) {
    // Only the wanted templates are measured out
    const head = /^\{\{\s*([^|{}]+?)\s*(?:\||\}\})/.exec(text.slice(i, i + 40));
    if (!head || !names.has(head[1])) continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < text.length - 1; j++) {
      const two = text.slice(j, j + 2);
      if (two === "{{") {
        depth++;
        j++;
      } else if (two === "}}") {
        depth--;
        j++;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    const body = text.slice(i + 2, end - 2);
    const [rawName, ...args] = splitArgs(body);
    const name = rawName.trim();
    if (names.has(name)) {
      const fields = [];
      for (const arg of args) {
        const eq = arg.indexOf("=");
        // A "=" inside a nested template is not the key's
        const brace = arg.indexOf("{{");
        if (eq < 0 || (brace >= 0 && brace < eq)) continue;
        fields.push([arg.slice(0, eq).trim(), arg.slice(eq + 1).trim()]);
      }
      found.push({ name, fields, start: i, end });
    }
  }
  return found;
}

/** Wiki markup -> plain text with **bold**, line breaks and ⟦links⟧ */
export function cleanText(input, titles = new Set()) {
  let s = String(input ?? "");
  if (!s) return "";
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref[^>]*>([\s\S]*?)<\/ref>/g, (_, note) => `（注：${note.trim()}）`);
  s = s.replace(/<ref[^>]*\/>/g, "");
  const link = (target, text = target) =>
    titles.has(target.trim()) ? `⟦${text.trim()}${text.trim() !== target.trim() ? "|" + target.trim() : ""}⟧` : text;
  // Templates, innermost first
  for (let i = 0; i < 6 && s.includes("{{"); i++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      // A "|" inside a ⟦link|target⟧ made by an inner template is not the template's
      const parts = body.split(/\|(?![^⟦]*⟧)/).map((p) => p.trim());
      const name = parts[0];
      if (LINK_TEMPLATES.has(name) && parts[1]) return link(parts[1], parts[2] || parts[1]);
      if (/^(出处|审核状态|DEFAULTSORT|目录|TOC)/.test(name) || name.startsWith("#")) return "";
      if (name === "怪物能力定义") return `\u0001${parts[1] || ""}\u0001${parts[2] && !parts[2].includes("=") ? `（${parts[2]}）` : ""} `;
      // A class's abilities: "{{能力定义|动物之友|特异|Animal Companion}}" -> **动物之友（特异）**
      if (name === "能力定义" || name === "子能力定义") return `\u0001${parts[1] || ""}${parts[2] ? `（${parts[2]}）` : ""}\u0001`;
      // A class's skills: all of them
      if (name === "本职技能") return parts.slice(1).filter(Boolean).join("、");
      // A prestige class's requirements: a line a field ("特殊2" is another 特殊)
      if (name === "进阶需求") {
        return (
          "\n" +
          parts
            .slice(1)
            .map((p) => /^([\w一-龥]+?)\d*\s*=\s*([\s\S]*)$/.exec(p))
            .filter((m) => m && m[2].trim())
            .map((m) => (m[1] === "引言" ? m[2].trim() : `\u0001${m[1]}：\u0001${m[2].trim()}`))
            .join("\n") +
          "\n"
        );
      }
      // A starting package: its name, then its text
      if (name === "起始套组") {
        const text = parts.find((p) => p.startsWith("文本="))?.slice(3) || "";
        return `\n\u0001${parts[1] || ""}\u0001\n${text.trim()}\n`;
      }
      // Anything else: its last plain argument, or nothing
      const plain = parts.slice(1).filter((p) => !/^[\w一-龥]+\s*=/.test(p));
      // A data template of no kind of its own (附魔数据, 领域数据…): a line a field
      if (name.endsWith("数据") && !plain.length) {
        const fields = parts
          .slice(1)
          .map((p) => /^([\w一-龥]+)\s*=\s*([\s\S]*)$/.exec(p))
          .filter((m) => m && m[2].trim() && !SKIP_FIELD.test(m[1]));
        return `\n${fields.map(([, k, v]) => (BODY_FIELD.test(k) ? v.trim() : `\u0001${k}：\u0001${v.trim()}`)).join("\n")}\n`;
      }
      return plain.length ? plain[plain.length - 1] : "";
    });
  }
  // Links
  s = s.replace(/\[\[(?:分类|Category|文件|File|图像|Image):[^\]]*\]\]/gi, "");
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, (_, target, text) => link(target, text));
  s = s.replace(/\[\[([^\]]*)\]\]/g, (_, target) => link(target));
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1");
  s = s.replace(/\{\{|\}\}|\[\[|\]\]/g, "");
  // Headings, lists and indents
  s = s
    .split("\n")
    .map((line) =>
      line
        .replace(/^(={2,6})\s*(.*?)\s*\1\s*$/, "\u0001$2\u0001")
        .replace(/^[*#]+\s*/, "• ")
        .replace(/^:+\s*/, "")
    )
    .join("\n");
  // Tables: a row a line, cells split by " | ", header cells bold
  s = wikiTables(s);
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, table) => {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) =>
      [...row.matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, tag, text]) => ({
        header: tag.toLowerCase() === "h",
        text: text.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim(),
      }))
    );
    const lines = rows
      .filter((cells) => cells.length)
      .map((cells) => cells.map((c) => (cells.every((x) => x.header) ? `\u0001${c.text}\u0001` : c.text)).join(" | "));
    return `\n${lines.join("\n")}\n`;
  });
  // HTML; bold is \u0001 until the end, so a "*" in the text stays plain
  s = s.replace(/<\/?(b|strong)\b[^>]*>/gi, "\u0001");
  s = s.replace(/<br\s*\/?>|<hr\s*\/?>|<\/p>|<\/tr>|<\/li>|<\/div>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " | ");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/'''/g, "\u0001").replace(/''/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  s = s
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
  // Bold that ends and starts again on one line is one bold; a heading stays on its own line
  s = s.replace(/\u0001[ \t]*\u0001/g, "").replace(/\u0001/g, "**");
  s = s.replace(/__NOTOC__|__TOC__|__NOEDITSECTION__/g, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * Wiki tables ({| … |}) as text: the caption, then one line a row with its
 * cells split by " | " (header cells in bold). In the wiki a row's cells may
 * each be on a line of their own ("! 等级\n! 基本攻击加值"), so they are
 * gathered row by row, between the "|-" lines.
 */
export function wikiTables(text) {
  const out = [];
  let rows = null;
  let row = null;
  const endRow = () => {
    if (row && row.cells.some((c) => c.text.trim())) rows.push(row);
    row = null;
  };
  const cell = (raw, header) => {
    // "style="…" | text": the attributes go
    const attr = /^[^|[⟦]*=\s*["'][^"']*["'][^|]*\|(?!\|)(.*)$/.exec(raw);
    if (!row) row = { cells: [] };
    row.cells.push({ text: (attr ? attr[1] : raw).trim(), header });
  };
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (rows === null) {
      if (t.startsWith("{|")) rows = [];
      else out.push(line);
      continue;
    }
    if (t.startsWith("|}")) {
      endRow();
      for (const r of rows) {
        const header = r.cells.every((c) => c.header);
        out.push(r.cells.map((c) => (header ? `\u0001${c.text.replace(/'''/g, "")}\u0001` : c.text)).join(" | "));
      }
      rows = null;
      continue;
    }
    if (t.startsWith("|+")) out.push(t.slice(2).trim());
    else if (t.startsWith("|-")) endRow();
    else if (t.startsWith("!")) t.slice(1).split(/\s*!!\s*|\s*\|\|\s*/).forEach((c) => cell(c, true));
    else if (t.startsWith("|")) t.slice(1).split(/\s*\|\|\s*/).forEach((c) => cell(c, false));
    // A cell's text going on over more lines
    else if (t && row?.cells.length) row.cells[row.cells.length - 1].text += " " + t;
  }
  // A table never closed: its rows as they are
  if (rows) for (const r of rows.concat(row ? [row] : [])) out.push(r.cells.map((c) => c.text).join(" | "));
  return out.join("\n");
}

/** A template's fields -> { name, en, source, summary, fields: [[label, text]], body: [[label, text]] } */
export function recordOf(fields, titles) {
  const get = (key) => fields.find(([k]) => k === key)?.[1] || "";
  const record = {
    name: cleanText(get("名称")).replace(/\*\*/g, ""),
    en: cleanText(get("英文名")).replace(/\*\*/g, ""),
    source: cleanText(get("出处")).replace(/\*\*/g, ""),
  };
  const summary = cleanText(get("简介"), titles);
  if (summary) record.summary = summary;
  const rows = [];
  const body = [];
  for (const [key, raw] of fields) {
    if (SKIP_FIELD.test(key)) continue;
    const text = cleanText(raw, titles);
    if (!text) continue;
    if (BODY_FIELD.test(key)) body.push(["", text]);
    else if (text.length > 80 || text.includes("\n")) body.push([key, text]);
    else rows.push([key, text]);
  }
  if (rows.length) record.fields = rows;
  if (body.length) record.body = body;
  return record;
}

// 3.5 sizes -> grid cells per side
const SIZE_CELLS = { 超微型: 1, 微型: 1, 超小型: 1, 小型: 1, 中型: 1, 大型: 2, 超大型: 3, 巨型: 4, 超巨型: 6 };

/** A monster's numbers for its token: size, AC, HP, initiative, CR */
export function monsterStats(fields) {
  const get = (key) => cleanText(fields.find(([k]) => k === key)?.[1] || "");
  const number = (s) => {
    const m = String(s).replace(/−/g, "-").match(/[+-]?\d+/);
    return m ? Number(m[0]) : null;
  };
  const hpText = get("生命骰");
  const hp = hpText.match(/(\d+)\s*(?:hp|生命值|点)/i);
  return {
    size: SIZE_CELLS[get("体型")] || 1,
    ac: number(get("防御等级")),
    hp: hp ? Number(hp[1]) : null,
    init: number(get("先攻")) ?? 0,
    cr: get("挑战等级"),
  };
}

/** The conditions on the 城主指南/状态 page: "{{术语定义|目盲|Blinded}}：…" up to the next one */
export function conditionsOf(text, titles) {
  const re = /\{\{术语定义\|([^|}]+)\|([^|}]+)[^}]*\}\}[:：]?/g;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ name: m[1].trim(), en: m[2].trim(), start: m.index, bodyStart: m.index + m[0].length });
  return marks.map((mark, i) => {
    let end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const nav = text.indexOf("{{自动规则翻页", mark.bodyStart);
    if (nav >= 0 && nav < end) end = nav;
    return {
      name: mark.name,
      en: mark.en,
      source: "城主指南",
      body: [["", cleanText(text.slice(mark.bodyStart, end), titles)]],
    };
  });
}

// Kinds whose CHM entries are checked against each other's names
const SAME_NAMES = { 法术: ["法术", "灵能", "武术"], 灵能: ["法术", "灵能", "武术"], 武术: ["法术", "灵能", "武术"] };
// A wizard's name in front of a spell: "Mordenkainen's Disjunction" is the wiki's "Mage's Disjunction"
const NAMED = new Set(["bigby", "drawmij", "evard", "leomund", "melf", "mordenkainen", "nystul", "otiluke", "otto", "rary", "tasha", "tenser", "mage", "serten", "snilloc", "aganazzar", "larloch", "manshoon", "khelben", "elminster", "simbul", "vecna"]);

/** Ways to write an English name: "Sword, Cursed" / "Cursed Sword", without a wizard's name, singular */
export function englishKeys(en) {
  const lower = String(en || "").toLowerCase().replace(/’/g, "'").replace(/'s /g, " ").replace(/s' /g, " ");
  const forms = new Set([lower]);
  if (lower.includes(",")) {
    const at = lower.indexOf(",");
    forms.add(lower.slice(at + 1) + " " + lower.slice(0, at));
  }
  for (const form of [...forms]) {
    const words = form.trim().split(/\s+/);
    if (words.length > 1 && NAMED.has(words[0])) forms.add(words.slice(1).join(" "));
  }
  const keys = new Set();
  for (const form of forms) {
    const key = form.replace(/[^a-z0-9]/g, "");
    if (!key) continue;
    keys.add(key);
    if (key.endsWith("s")) keys.add(key.slice(0, -1));
  }
  return [...keys];
}

/** A Chinese name without its note ("暗行者（职业）") or punctuation */
export function chineseKey(name) {
  return String(name || "")
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/[\s·、，,()（）[\]【】]/g, "");
}

/** The Chinese name without 之 / 的 ("巴哈姆特之封臣" is "巴哈姆特的封臣"), for names with no English to go by */
export function looseChineseKey(name) {
  return chineseKey(name).replace(/[之的]/g, "");
}

/**
 * The CHM's records of each kind that the wiki (or an earlier CHM record) lacks.
 * sameAs: { kind: { CHM name: wiki name } }, the pairs a person found to be one
 * entry under two spellings (English typos, other translations).
 */
export function chmAdditions(chm, byKind, redirects = {}, sameAs = {}) {
  const known = new Set();
  const keysOf = (r) => [...englishKeys(r.en).map((k) => "en:" + k), "zh:" + chineseKey(r.name)];
  // 之 / 的 only count when one of the two names has no English
  const looseOf = (r) => "zl:" + looseChineseKey(r.name) + (r.en ? "|en" : "|no-en");
  for (const [kind, records] of Object.entries(byKind)) {
    for (const r of records) for (const k of [...keysOf(r), looseOf(r)]) known.add(kind + "|" + k);
  }
  for (const alias of Object.keys(redirects)) known.add("*|zh:" + chineseKey(alias));
  const added = Object.fromEntries(KINDS.map(([kind]) => [kind, []]));
  for (const { kind, file, section, ...record } of chm) {
    if (!added[kind] || !record.name || sameAs[kind]?.[record.name]) continue;
    const keys = keysOf(record);
    const loose = "zl:" + looseChineseKey(record.name);
    const kinds = SAME_NAMES[kind] || [kind];
    const has = (k) => known.has("*|" + k) || kinds.some((other) => known.has(other + "|" + k));
    if (keys.some(has) || has(loose + "|no-en") || (!record.en && has(loose + "|en"))) continue;
    for (const k of keys) known.add(kind + "|" + k);
    known.add(kind + "|" + looseOf(record));
    added[kind].push(record);
  }
  return added;
}

/** Edit distance, or limit + 1 once it is over limit */
function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length];
}

/** Added CHM records whose English is a letter or two from a wiki entry's: for a person to settle in same-as.json */
export function nearMatches(added, byKind, sameAs = {}) {
  const letters = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const found = [];
  for (const [kind, records] of Object.entries(added)) {
    const wiki = (SAME_NAMES[kind] || [kind]).flatMap((k) => byKind[k] || []).filter((w) => w.en);
    for (const r of records) {
      const a = letters(r.en);
      if (a.length < 7 || sameAs.different?.[r.name]) continue;
      const limit = a.length > 14 ? 2 : 1;
      const w = wiki.find((w) => distance(a, letters(w.en), limit) <= limit);
      if (w) found.push(`${kind}\t${r.name}\t${r.en}\t~\t${w.name}\t${w.en}`);
    }
  }
  return found;
}

/** Records in chunks of at most CHUNK records and about CHUNK_BYTES */
function chunked(records) {
  const groups = [];
  let group = [];
  let bytes = 0;
  for (const r of records) {
    const size = Buffer.byteLength(JSON.stringify(r));
    if (group.length && (group.length >= CHUNK || bytes + size > CHUNK_BYTES)) {
      groups.push(group);
      group = [];
      bytes = 0;
    }
    group.push(r);
    bytes += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

/** An article's English name, from its header: {{条目头|…|英文名=Blackguard}} */
export function articleEnglish(text) {
  const head = findTemplates(String(text || ""), new Set(["条目头"]))[0];
  const en = head?.fields.find(([k]) => k === "英文名")?.[1] || "";
  return cleanText(en).replace(/\*\*/g, "");
}

const byName = (a, b) => String(a.en || a.name).localeCompare(String(b.en || b.name));
// Articles keep the order they had before they had English names
const byTitle = (a, b) => String(a.name).localeCompare(String(b.name));

const SAME_AS = path.resolve("scripts/dnd3r/chm/same-as.json");

function build(file, chmFile) {
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "data"), { recursive: true });

  const titles = new Set([...dump.pages.map((p) => p.title), ...Object.keys(dump.redirects || {})]);
  const templateKind = new Map(KINDS.filter(([, t]) => t).map(([kind, t]) => [t, kind]));
  const byKind = Object.fromEntries(KINDS.map(([kind]) => [kind, []]));

  for (const page of dump.pages) {
    if (page.title === "城主指南/状态") {
      for (const c of conditionsOf(page.text, titles)) byKind.状态.push({ ...c, page: page.title });
    }
    const templates = findTemplates(page.text, templateKind);
    // The monster card's page text: its abilities and lore
    let rest = page.text;
    for (const t of [...templates].reverse()) rest = rest.slice(0, t.start) + rest.slice(t.end);
    const pageText = cleanText(rest, titles);
    if (templates.length) {
      // A monster page: each variant is a record, the page text their body
      for (const t of templates) {
        const kind = templateKind.get(t.name);
        // A template inside another one's field (a monster's variants) counts once
        if (templates.some((o) => o !== t && o.start < t.start && o.end > t.end && templateKind.get(o.name) === kind)) continue;
        const record = recordOf(t.fields, titles);
        if (!record.name) record.name = page.title;
        record.page = page.title;
        if (kind === "怪物") {
          record.stats = monsterStats(t.fields);
          if (pageText) record.body = [...(record.body || []), ["", pageText]];
        }
        byKind[kind].push(record);
      }
      continue;
    }
    // Everything else: kept as an article (rules, classes, races…)
    if (!pageText || page.title === "首页" || page.title.startsWith("沙盒")) continue;
    byKind.条目.push({
      name: page.title,
      en: articleEnglish(page.text),
      source: "",
      tags: (page.categories || []).filter((c) => !/^(需要|页面|隐藏|含有)/.test(c)).slice(0, 4),
      body: [["", pageText]],
      page: page.title,
    });
  }

  const chm = chmFile ? JSON.parse(fs.readFileSync(chmFile, "utf8")) : [];
  const sameAs = chm.length && fs.existsSync(SAME_AS) ? JSON.parse(fs.readFileSync(SAME_AS, "utf8")) : {};
  for (const [kind, pairs] of Object.entries(sameAs)) {
    if (kind === "different") continue;
    for (const wikiName of Object.values(pairs)) {
      if (!(SAME_NAMES[kind] || [kind]).some((k) => byKind[k]?.some((r) => r.name === wikiName))) {
        console.warn(`same-as.json: no ${kind} "${wikiName}" on the wiki`);
      }
    }
  }
  const added = chmAdditions(chm, byKind, dump.redirects, sameAs);
  const near = chm.length ? nearMatches(added, byKind, sameAs) : [];

  const entries = [];
  KINDS.forEach(([kind], kindIndex) => {
    const order = kind === "条目" ? byTitle : byName;
    const groups = [...chunked(byKind[kind].sort(order)), ...chunked(added[kind].sort(byName))];
    // A result's id has room for 100 chunks of a kind
    if (groups.length > 100) throw new Error(`${kind}: ${groups.length} chunks`);
    groups.forEach((members, n) => {
      members.forEach((r, i) => {
        const row = ROW_FIELD[kind] ? r.fields?.find(([k]) => k === ROW_FIELD[kind])?.[1] || "" : (r.tags || []).join(" · ");
        // No wiki page: from the CHM
        entries.push([r.name, r.en || "", kindIndex, String(row).replace(/\*\*/g, "").slice(0, 40), n, i, r.source || "", r.page || ""]);
      });
      fs.writeFileSync(path.join(OUT, "data", `${kind}-${n}.json`), JSON.stringify(members));
    });
  });

  const index = {
    source: dump.source,
    exported: dump.exported,
    license: "CC BY-SA（规则内容遵循 OGL 1.0a）",
    kinds: KINDS.map(([kind]) => kind),
    // [中文, English, kind, row text, chunk, position, 出处, wiki page]
    entries,
    // Other names of a page (redirects), for links and lookups
    redirects: dump.redirects || {},
  };
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
  const counts = Object.fromEntries(KINDS.map(([kind]) => [kind, byKind[kind].length]));
  const fromChm = Object.fromEntries(KINDS.map(([kind]) => [kind, added[kind].length]));
  // Spellings a letter or two apart: to go in same-as.json, under their kind or under "different"
  if (near.length) console.warn(`Check these against the wiki (scripts/dnd3r/chm/same-as.json):\n${near.join("\n")}`);
  return { entries: entries.length, counts, fromChm };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/dnd3r/build.mjs dnd3r-data.json.gz [dnd3r-chm.json]");
    process.exit(1);
  }
  console.log(build(file, process.argv[3]));
}
