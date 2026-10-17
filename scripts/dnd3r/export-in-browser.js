// Exports the Chinese D&D 3R wiki's articles for scripts/dnd3r/build.mjs.
//
// The wiki is behind a browser check, so this runs in the browser:
//   1. Open https://dnd3r.huijiwiki.com/wiki/ (pass the check if asked).
//   2. Paste this into the developer console (F12 → Console) and press Enter.
//   3. Wait a few minutes; it saves dnd3r-data.json.gz to your downloads.
//   4. node scripts/dnd3r/build.mjs ~/Downloads/dnd3r-data.json.gz
//
// Spells, monsters, feats, powers, maneuvers and items are templates
// ({{法术数据|…}}, {{怪物数据|…}}, …) in the articles, so it reads every
// article's wikitext through the MediaWiki API, 50 at a time with a short
// pause between requests, and the redirects (other names of a page).

(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function api(params) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await (await fetch("/api.php?" + new URLSearchParams({ format: "json", formatversion: "2", ...params }))).json();
      } catch (e) {
        await sleep(2000);
      }
    }
    throw new Error("API request failed");
  }

  // A batch's categories may come over several responses: merged by title
  const byTitle = new Map();
  let cont = {};
  for (;;) {
    const r = await api({
      action: "query", generator: "allpages", gapnamespace: "0", gapfilterredir: "nonredirects",
      gaplimit: "50", prop: "revisions|categories", rvprop: "content", rvslots: "main", cllimit: "max", ...cont,
    });
    for (const p of r.query?.pages || []) {
      const page = byTitle.get(p.title) || { title: p.title, text: "", categories: [] };
      const text = p.revisions?.[0]?.slots?.main?.content;
      if (text) page.text = text;
      for (const c of p.categories || []) {
        const name = c.title.replace(/^(分类|Category):/, "");
        if (!page.categories.includes(name)) page.categories.push(name);
      }
      byTitle.set(p.title, page);
    }
    console.log("pages", byTitle.size);
    if (!r.continue) break;
    cont = r.continue;
    await sleep(150);
  }

  const pages = [...byTitle.values()].filter((p) => p.text);

  const redirects = {};
  cont = {};
  for (;;) {
    const r = await api({
      action: "query", generator: "allpages", gapnamespace: "0", gapfilterredir: "redirects",
      gaplimit: "500", redirects: "1", ...cont,
    });
    for (const x of r.query?.redirects || []) redirects[x.from] = x.to;
    console.log("redirects", Object.keys(redirects).length);
    if (!r.continue) break;
    cont = r.continue;
    await sleep(150);
  }

  const dump = { exported: new Date().toISOString(), source: "https://dnd3r.huijiwiki.com/", pages, redirects };
  const gz = await new Response(new Blob([JSON.stringify(dump)]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(gz);
  a.download = "dnd3r-data.json.gz";
  a.click();
  console.log("saved dnd3r-data.json.gz", (gz.size / 1e6).toFixed(1), "MB");
  window.__dnd3rExport = { pages: pages.length, redirects: Object.keys(redirects).length, mb: gz.size / 1e6 };
})();
