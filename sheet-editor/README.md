# Character sheet editor (sheets.pangbai.de)

Static deployment of [ranuts/document](https://github.com/ranuts/document)
(AGPL-3.0, unmodified, pinned in `build.sh`): ONLYOFFICE's editors and its
x2t converter compiled to WebAssembly, running entirely in the browser.

Owlbear embeds `/editor?embed=1` in the "Character Sheets" window and drives it
through the [iframe API](https://github.com/ranuts/document/blob/main/docs/embed-api.md).
Sheet files never reach a server: Owlbear keeps them in the player's own
browser (IndexedDB) and passes the bytes to the editor with `postMessage`.

- `.xlsm` opens fine but is saved as `.xlsx`: VBA macros are not run or kept.
- The x2t module is pre-compressed Brotli; `worker.mjs` serves it with
  `Content-Encoding: br` and `encodeBody: "manual"` so it is not re-encoded.
- `dist/_headers` (from upstream) sets COOP/COEP for multi-threaded WASM. The
  editor also works without cross-origin isolation, which is the case when it
  is embedded in Owlbear.

```bash
npm install
npm run build    # clones + builds the pinned commit into ./dist (~500 MB, ~2,900 files)
npm run dev      # http://localhost:8800/editor
npm run deploy   # binds sheets.pangbai.de
```

Build Owlbear with `REACT_APP_SHEET_EDITOR_URL=https://sheets.pangbai.de` to
show the character sheet button.
