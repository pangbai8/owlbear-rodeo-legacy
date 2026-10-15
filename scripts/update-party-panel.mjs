// Copies a version of the party status panel ("GM用小队状态面板 vNN.html") into
// public/party-panel/index.html and loads db-shim.js before the panel's own
// script, so the panel shares its data per game room (see db-shim.js).
//   node scripts/update-party-panel.mjs "path/to/GM用小队状态面板 v19.html"
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/update-party-panel.mjs "GM用小队状态面板 vNN.html"');
  process.exit(1);
}
const SHIM = '<script src="/party-panel/db-shim.js"></script>';
let html = readFileSync(source, "utf8").replace(SHIM + "\n", "");
if (!html.includes("window.claude")) console.warn("warning: this panel does not use window.claude; it will not sync");
const index = html.indexOf("<script");
if (index < 0) throw new Error("no <script> in the panel");
html = html.slice(0, index) + SHIM + "\n" + html.slice(index);
const target = fileURLToPath(new URL("../public/party-panel/index.html", import.meta.url));
writeFileSync(target, html);
console.log(`wrote ${target}`);
