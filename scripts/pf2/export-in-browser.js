// Exports the Chinese PF2 wiki's data for scripts/pf2/build.mjs.
//
// The wiki is behind a browser check, so this runs in the browser:
//   1. Open https://pf2.huijiwiki.com/wiki/ (pass the check if asked).
//   2. Paste this into the developer console (F12 → Console) and press Enter.
//   3. Wait a few minutes; it saves pf2-data.json.gz to your downloads.
//   4. node scripts/pf2/build.mjs ~/Downloads/pf2-data.json.gz
//
// It reads the Data: pages (one JSON per creature, spell, feat, ...) through
// the MediaWiki API, 50 at a time with a short pause between requests, and
// the 300px thumbnail address of each creature's picture.

(async () => {
  const KINDS = ["Creatures", "Spells", "Feats", "Items", "Conditions", "Actions", "Traits", "Backgrounds", "Rituals"];
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

  const kinds = {};
  for (const kind of KINDS) {
    const list = (kinds[kind] = []);
    let cont = {};
    for (;;) {
      const r = await api({
        action: "query", generator: "allpages", gapnamespace: "3500", gapprefix: kind + "-",
        gaplimit: "50", prop: "revisions", rvprop: "content", rvslots: "main", ...cont,
      });
      for (const p of r.query?.pages || []) {
        const text = p.revisions?.[0]?.slots?.main?.content;
        if (!text) continue;
        try {
          list.push({ ...JSON.parse(text), __page: p.title });
        } catch (e) {
          console.warn("not JSON:", p.title);
        }
      }
      console.log(kind, list.length);
      if (!r.continue) break;
      cont = { gapcontinue: r.continue.gapcontinue, continue: r.continue.continue };
      await sleep(150);
    }
  }

  const images = {};
  const files = [...new Set(kinds.Creatures.map((c) => c["图鉴"]).filter(Boolean))];
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const r = await api({
      action: "query", titles: batch.map((f) => "File:" + f).join("|"),
      prop: "imageinfo", iiprop: "url", iiurlwidth: "300",
    });
    const from = {};
    (r.query.normalized || []).forEach((n) => (from[n.to] = n.from.replace(/^File:/, "")));
    for (const p of r.query.pages) {
      const url = p.imageinfo?.[0]?.thumburl;
      const file = from[p.title] || p.title.replace(/^(文件|File):/, "");
      if (url) images[file] = url.replace("https://huiji-thumb.huijistatic.com/pf2/uploads/", "");
    }
    console.log("images", Object.keys(images).length, "/", files.length);
    await sleep(150);
  }

  const dump = { exported: new Date().toISOString(), source: "https://pf2.huijiwiki.com/", kinds, images };
  const gz = await new Response(new Blob([JSON.stringify(dump)]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(gz);
  a.download = "pf2-data.json.gz";
  a.click();
  console.log("saved pf2-data.json.gz", (gz.size / 1e6).toFixed(1), "MB");
})();
