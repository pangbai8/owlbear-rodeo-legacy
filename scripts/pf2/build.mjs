// Builds public/pf2/ (the PF2 quick search's data) from an export of the
// Chinese PF2 wiki (https://pf2.huijiwiki.com/, CC BY-SA; game rules under
// OGL / ORC). The wiki is behind a browser check, so the export is made in a
// browser on the wiki (its Data: pages through the MediaWiki API) and saved
// as pf2-data.json.gz: { exported, source, kinds: { Creatures: [...], ... },
// images: { "<图鉴 file>": "<thumb path on the image CDN>" } }.
//
//   node scripts/pf2/build.mjs path/to/pf2-data.json.gz
//
// Output: index.json (names for the search) and data/<kind>-<n>.json chunks,
// so a card only loads its own small file.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const CHUNK = 50;
const OUT = path.resolve("public/pf2");

// Kind -> label shown in results; order is the search's tie-break
export const KINDS = [
  ["Creatures", "生物"],
  ["Spells", "法术"],
  ["Conditions", "状态"],
  ["Actions", "动作"],
  ["Feats", "专长"],
  ["Items", "物品"],
  ["Rituals", "仪式"],
  ["Traits", "特征"],
  ["Backgrounds", "背景"],
];

// Wiki-internal fields the cards do not show
const DROP = /^(ID|data_type|__page|生物数据|法术数据|专长数据|背景数据|仪式数据|Unnamed.*|.*_Scale|Strike_Damage_Average|Attack_Bonus|2e|许可|PFS)$/;

const ACTION = { 1: "◆", 2: "◆◆", 3: "◆◆◆", R: "⟲", F: "◇" };
const actionSymbol = (value) =>
  value
    .split("-")
    .map((v) => ACTION[v.trim()] || v.trim())
    .join("～");

/** Wiki markup -> plain text with **bold** and line breaks */
export function cleanText(input) {
  let s = String(input ?? "");
  if (!s) return "";
  s = s.replace(/<ref[^>]*>([\s\S]*?)<\/ref>/g, (_, note) => `（注：${note.trim()}）`);
  s = s.replace(/<ref[^>]*\/>/g, "");
  // Templates, innermost first
  for (let i = 0; i < 5 && s.includes("{{"); i++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const parts = body.split("|").map((p) => p.trim());
      const name = parts[0];
      if (name === "act" || name === "action" || name === "actions" || name === "aciton")
        return actionSymbol(parts[1] || "");
      if (name === "浮窗") return parts[parts.length - 1];
      if (name === "quote") {
        const title = parts.find((p) => p.startsWith("标题="))?.slice(3) || "";
        const text = parts.filter((p) => !/^(icon|标题)=/.test(p)).slice(1).join("|");
        return `${title ? `**${title}** ` : ""}${text}\n`;
      }
      if (name.startsWith("#")) return "";
      // Anything else: its last argument, or nothing
      return parts.length > 1 ? parts[parts.length - 1] : "";
    });
  }
  // Links
  s = s.replace(/\[\[(?:分类|Category|文件|File):[^\]]*\]\]/gi, "");
  s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1");
  s = s.replace(/\[\[([^\]]*)\]\]/g, "$1");
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1");
  // Typos in the source: unclosed templates and links
  s = s.replace(/\{\{浮窗\|[^|{}]*\|/g, "").replace(/\{\{|\}\}|\[\[|\]\]/g, "");
  // Wiki lists and indents: at line starts in the source, before bold
  // markers exist that could be mistaken for them
  s = s
    .split("\n")
    .map((line) => line.replace(/^\*+\s*/, "• ").replace(/^:+\s*/, ""))
    .join("\n");
  // HTML; bold is \u0001 until the end, so a "*" in the text stays plain
  s = s.replace(/<\/?(b|strong)\b[^>]*>/gi, "\u0001");
  s = s.replace(/<br\s*\/?>|<hr\s*\/?>|<\/div>\s*<div[^>]*>|<\/p>|<\/tr>|<\/li>|<\/caption>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " | ");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/'''/g, "\u0001").replace(/''/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  // Lines that only now start a line (after <br>) can be lists too
  s = s
    .split("\n")
    .map((line) => line.replace(/^\*+\s*/, "• ").replace(/^:+\s*/, "").trimEnd())
    .join("\n");
  // Empty bold runs, then the markers; extra blank lines
  s = s.replace(/\u0001\s*\u0001/g, "").replace(/\u0001/g, "**");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function cleanRecord(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (DROP.test(key) || value === "" || value == null) continue;
    if (Array.isArray(value)) {
      const items = value.map((v) => (v && typeof v === "object" ? cleanRecord(v) : cleanText(v)));
      if (items.length) out[key] = items;
    } else if (typeof value === "object") {
      out[key] = cleanRecord(value);
    } else if (typeof value === "number") {
      out[key] = value;
    } else {
      const text = cleanText(value);
      if (text) out[key] = text;
    }
  }
  return out;
}

const levelOf = (kind, r) =>
  r.等级 ?? r.环级 ?? (Array.isArray(r.类型数据) ? r.类型数据[0]?.等级 : undefined) ?? null;

function build(file) {
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "data"), { recursive: true });

  const entries = [];
  KINDS.forEach(([kind], kindIndex) => {
    const records = (dump.kinds[kind] || [])
      .filter((r) => r.中文 || r.原文)
      .sort((a, b) => String(a.原文).localeCompare(String(b.原文)));
    for (let start = 0, n = 0; start < records.length; start += CHUNK, n++) {
      const chunk = records.slice(start, start + CHUNK).map((r, i) => {
        const clean = cleanRecord(r);
        const image = r.图鉴 && dump.images[r.图鉴];
        if (image) clean.image = image;
        delete clean.图鉴;
        const level = levelOf(kind, r);
        entries.push([
          clean.中文 || clean.原文,
          clean.原文 && clean.原文 !== clean.中文 ? clean.原文 : "",
          kindIndex,
          typeof level === "number" ? level : null,
          n,
          i,
          clean.来源 || "",
        ]);
        return clean;
      });
      fs.writeFileSync(path.join(OUT, "data", `${kind}-${n}.json`), JSON.stringify(chunk));
    }
  });

  const index = {
    source: dump.source,
    exported: dump.exported,
    license: "CC BY-SA（规则内容遵循 OGL 1.0a / ORC）",
    kinds: KINDS,
    // [中文, 原文, kind, level, chunk, position, 来源]
    entries,
  };
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
  return { entries: entries.length };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/pf2/build.mjs pf2-data.json.gz");
    process.exit(1);
  }
  console.log(build(file));
}
