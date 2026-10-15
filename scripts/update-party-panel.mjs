// Copies a version of the party status panel ("GM用小队状态面板 vNN.html") into
// public/party-panel/index.html, and
// - loads db-shim.js before the panel's own script, so the panel shares its
//   data per game room (see db-shim.js);
// - swaps Google Fonts for the copies in public/party-panel/fonts.css
//   (fonts.googleapis.com is unreachable in mainland China).
//   node scripts/update-party-panel.mjs "path/to/GM用小队状态面板 v19.html"
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/update-party-panel.mjs "GM用小队状态面板 vNN.html"');
  process.exit(1);
}
const SHIM = '<script src="/party-panel/db-shim.js"></script>';
const FONTS = '<link rel="stylesheet" href="/party-panel/fonts.css">';
let html = readFileSync(source, "utf8").replace(SHIM + "\n", "");
if (!html.includes("window.claude")) console.warn("warning: this panel does not use window.claude; it will not sync");

const googleFonts = /<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\r?\n?/g;
const families = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"&]+)/g)].map((m) => decodeURIComponent(m[1]));
if (families.length) {
  const first = html.search(googleFonts);
  html = html.replace(googleFonts, "");
  html = html.slice(0, first) + FONTS + "\n" + html.slice(first);
  const known = /^(IBM\+Plex\+Mono|IBM\+Plex\+Sans|Noto\+Serif\+SC)/;
  const missing = families.flatMap((f) => f.split("&family=")).filter((f) => !known.test(f));
  if (missing.length) console.warn(`warning: fonts.css does not cover ${missing.join(", ")}; add them or they fall back to system fonts`);
}

const index = html.indexOf("<script");
if (index < 0) throw new Error("no <script> in the panel");
html = html.slice(0, index) + SHIM + "\n" + html.slice(index);
const target = fileURLToPath(new URL("../public/party-panel/index.html", import.meta.url));
writeFileSync(target, html);
console.log(`wrote ${target}`);
