// Builds public/dnd4e/ (the 4e quick search's data) from the Chinese 4e wiki
// at https://leonspace.site/ (a TiddlyWiki; mirrored with its owner's
// permission). The whole wiki is one HTML page with every entry ("tiddler")
// as JSON inside, so this downloads it and splits it up:
//
//   node scripts/dnd4e/build.mjs              # download and build
//   node scripts/dnd4e/build.mjs site.html    # build from a saved copy
//
// Output: index.json (names for the search) and data/<kind>-<n>.json chunks,
// so a card only loads its own small file.

import fs from "node:fs";
import path from "node:path";

const SOURCE = "https://leonspace.site/";
const CHUNK = 50;
const CHUNK_BYTES = 120000;
const OUT = path.resolve("public/dnd4e");

// Kind (by tag, first match wins) -> label shown in results
export const KINDS = [
  ["威能", "威能"],
  ["专长", "专长"],
  ["物品", "物品"],
  ["仪式", "仪式"],
  ["武术奥义", "武术奥义"],
  ["典范", "典范"],
  ["天命", "天命"],
  ["种族", "种族"],
  ["职业", "职业"],
  ["主题", "主题"],
  ["技能", "技能"],
  ["生物", "生物"],
  ["物品套装", "物品套装"],
  // Untagged pages: rules and tables (状态表, 混职规则, 护甲, ...)
  ["规则", "规则"],
  ["其他", "其他"],
];
const OTHER_TAGS = ["领域", "魔法学派", "败德", "美德", "疾病", "载具", "魔剑士契约", "缚影师契约", "血统", "文章"];
// Entries that are not reference material
const SKIP_TAGS = ["贡献者", "TableOfContents", "$:/tags/Stylesheet", "$:/tags/SideBar"];

// Fields copied to records (others are the wiki's bookkeeping)
const FIELDS = [
  "power-type", "usage", "actionType", "keywords", "range", "level", "details", "flavorText",
  "skill", "tier", "prerequisite", "benefit", "special", "item-category", "item-suitable",
  "item-level", "rarity", "ritual-level", "ritual-catagory", "key-skill", "component-category",
  "component-type", "race-abilityone", "race-abilitytwo", "race-size", "race-speed", "race-vision",
  "power source", "role", "hybrid", "source", "magazine",
];

const tagsOf = (t) =>
  (String(t.tags || "").match(/\[\[[^\]]+\]\]|\S+/g) || []).map((x) => x.replace(/^\[\[|\]\]$/g, ""));

/** "火球术 Fireball" -> ["火球术", "Fireball"] */
export function splitTitle(title) {
  const i = title.search(/[A-Za-z]/);
  if (i <= 0) return [title.trim(), ""];
  return [title.slice(0, i).trim(), title.slice(i).trim()];
}

/**
 * TiddlyWiki markup and HTML -> plain text with **bold**, line breaks and
 * ⟦Title⟧ for links and embedded entries (the cards make them clickable).
 */
export function cleanText(input, { fields = {}, procedures = {}, titles = new Set() } = {}) {
  let s = String(input ?? "");
  if (!s) return "";
  // Procedures (item price tables) and other macros
  s = s.replace(/<<([\w-]+)[^>]*>>/g, (_, name) => procedures[name] || "");
  // Own fields and embedded entries
  s = s.replace(/\{\{!!([^}]+)\}\}/g, (_, f) => String(fields[f.trim()] ?? ""));
  s = s.replace(/\{\{\{[^}]*\}\}\}/g, "");
  s = s.replace(/\{\{([^{}|!]+)(?:\|\|[^}]*)?\}\}/g, (_, t) =>
    titles.has(t.trim()) ? `\n⟦${t.trim()}⟧\n` : ""
  );
  s = s.replace(/\{\{[^}]*\}\}/g, "");
  // Widgets and other $-tags (whole lines: their attributes can hold ">")
  s = s.replace(/^\s*<\/?\$.*$/gm, "");
  s = s.replace(/<\/?\$[^>]*>/g, "");
  // Bold blocks: <div class="bold ...">特性</div>
  s = s.replace(/<div class="?bold[^>]*>([\s\S]*?)<\/div>/gi, "\u0001$1\u0001\n");
  // Links: [[Title]], [[text|Title]], [img[...]]
  s = s.replace(/\[img[^\]]*\[[^\]]*\]\]/g, "");
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, text, t) => (titles.has(t.trim()) ? `⟦${t.trim()}⟧` : text));
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, t) => (titles.has(t.trim()) ? `⟦${t.trim()}⟧` : t));
  // Headings, block markers
  s = s.replace(/^!+\s*(.*)$/gm, "\u0001$1\u0001");
  s = s.replace(/@@[.\w-]*|"""/g, "");
  s = s.replace(/^\*+\s*/gm, "• ").replace(/^#+\s*/gm, "• ");
  s = s.replace(/^<<<.*$/gm, "");
  // HTML entities that stand for tags (&lt;br&gt;) become tags first
  s = s.replace(/&lt;(\/?(?:br|hr)\s*\/?)&gt;/gi, "<$1>");
  // HTML; only real tag names, since titles like "<Divinity>" are text
  const TAG = "(?:div|span|table|tbody|thead|tr|td|th|p|b|strong|i|em|br|hr|ul|ol|li|h\\d|sup|sub|a|img|center|font|small|big|u|s|caption|code|pre|blockquote)";
  const tag = (body) => new RegExp(`<${body}`, "gi");
  s = s.replace(tag(`\\/?(?:b|strong|th)\\b[^>]*>`), "\u0001");
  s = s.replace(tag(`(?:br|hr)\\s*\\/?>|<\\/(?:div|p|tr|li|h\\d|caption)>`), "\n");
  s = s.replace(tag(`\\/td>\\s*<td[^>]*>`), " | ");
  s = s.replace(tag(`li\\b[^>]*>`), "• ");
  s = s.replace(tag(`\\/?${TAG}\\b[^>]*>`), "");
  // Inline wiki formatting (not the // of a URL)
  s = s.replace(/''/g, "\u0001").replace(/(^|[^:])\/\//g, "$1").replace(/\^\^|,,|__|~~/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  s = s
    .split("\n")
    .map((l) => l.replace(/^\s*:+\s*/, "").trimEnd())
    .join("\n");
  // Empty bold on one line only (a heading and the next line's bold stay apart)
  s = s.replace(/\u0001[ \t]*\u0001/g, "").replace(/\u0001/g, "**");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function kindOf(tags, tiddler, classTabs) {
  for (const [kind] of KINDS) if (tags.includes(kind)) return kind;
  if (tags.some((t) => OTHER_TAGS.includes(t))) return "其他";
  // Untagged rules pages, but not the text of a class page's first tab
  if (!tags.length && !classTabs.has(tiddler.title) && String(tiddler.text || "").length > 200)
    return "规则";
  return null;
}

const levelOf = (r) => {
  const n = parseInt(String(r.level ?? r["ritual-level"] ?? "").replace(/^等级/, ""), 10);
  return Number.isFinite(n) ? n : null;
};

async function load(file) {
  if (file) return fs.readFileSync(file, "utf8");
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function build(file) {
  const html = await load(file);
  const store = html.match(/<script class="tiddlywiki-tiddler-store" type="application\/json">([\s\S]*?)<\/script>/);
  if (!store) throw new Error("no tiddler store in the page");
  const all = JSON.parse(store[1]);
  const byTitle = new Map(all.map((t) => [t.title, t]));

  // \procedure definitions (item level / price tables)
  const procedures = {};
  for (const t of all) {
    if (!t.title.startsWith("$:/")) continue;
    for (const m of String(t.text || "").matchAll(/\\procedure ([\w-]+)\(\)\n([\s\S]*?)\n\\end/g)) {
      if (/^item-level/.test(m[1])) procedures[m[1]] = m[2];
    }
  }

  // Class pages show their first tab's text; that page is not listed apart
  const classTabs = new Set();
  for (const t of all) {
    const tab = String(t.text || "").match(/^<<tabs\s+"([^"\s]+)/);
    if (tab) classTabs.add(tab[1]);
  }
  const kinds = new Map();
  const entries = all.filter((t) => {
    if (t.title.startsWith("$:/") || /^image\/|text\/css/.test(t.type || "")) return false;
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(t.title)) return false;
    const tags = tagsOf(t);
    const kind = !tags.some((x) => SKIP_TAGS.includes(x)) && kindOf(tags, t, classTabs);
    if (kind) kinds.set(t.title, kind);
    return !!kind;
  });
  const titles = new Set(entries.map((t) => t.title));

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "data"), { recursive: true });

  const index = [];
  KINDS.forEach(([kind], kindIndex) => {
    const records = entries
      .filter((t) => kinds.get(t.title) === kind)
      .sort((a, b) => a.title.localeCompare(b.title));
    // Chunks of at most CHUNK entries and about CHUNK_BYTES (long pages
    // like races fill a chunk sooner)
    const groups = [];
    let group = [];
    let bytes = 0;
    for (const t of records) {
      const size = JSON.stringify(t).length;
      if (group.length && (group.length >= CHUNK || bytes + size > CHUNK_BYTES)) {
        groups.push(group);
        group = [];
        bytes = 0;
      }
      group.push(t);
      bytes += size;
    }
    if (group.length) groups.push(group);
    groups.forEach((members, n) => {
      const chunk = members.map((t, i) => {
        const tags = tagsOf(t);
        const [cn, en] = splitTitle(t.title);
        const record = { title: t.title, cn, en };
        const context = { fields: t, procedures, titles };
        for (const f of FIELDS) {
          if (t[f] == null || t[f] === "") continue;
          const value = cleanText(t[f], context);
          if (value) record[f] = value;
        }
        // Powers and classes: which class they belong to
        const cls = tags.filter((x) => !KINDS.some(([k]) => k === x) && !OTHER_TAGS.includes(x));
        if (cls.length) record.tags = cls;
        // Body text; class pages are tabs whose first tab holds the text
        let text = String(t.text || "");
        const tabs = text.match(/^<<tabs\s+"([^"\s]+)/);
        if (tabs && byTitle.has(tabs[1])) text = String(byTitle.get(tabs[1]).text || "");
        if (!/^<<(power|feat|item)-format>>$/.test(text.trim())) {
          const body = cleanText(text, context);
          if (body) record.body = body;
        }
        const level = levelOf(t);
        index.push([cn, en, kindIndex, level, n, i, String(t["power-type"] || t.tier || t.rarity || ""), String(t.usage || "")]);
        return record;
      });
      fs.writeFileSync(path.join(OUT, "data", `${kind}-${n}.json`), JSON.stringify(chunk));
    });
  });

  fs.writeFileSync(
    path.join(OUT, "index.json"),
    JSON.stringify({
      source: SOURCE,
      built: new Date().toISOString(),
      kinds: KINDS,
      // [中文, English, kind, level, chunk, position, type, usage]
      entries: index,
    })
  );
  return { entries: index.length };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  build(process.argv[2]).then(
    (result) => console.log(result),
    (error) => {
      console.error(error);
      process.exit(1);
    }
  );
}
