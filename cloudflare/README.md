# Cloudflare trial

Production URL: https://vtt.pangbai.de (Workers Custom Domain)
Fallback URL: https://owlbear-legacy-trial.findstars-worker.workers.dev

The React frontend is served as Worker static assets. Each game uses a separate
SQLite-backed Durable Object and native WebSocket signalling with hibernation.
Images still stay in browser IndexedDB and transfer through the existing WebRTC
data channel. The original Socket.IO backend remains supported when
`REACT_APP_BROKER_TRANSPORT` is unset.

## Build and deploy

The legacy frontend needs its existing Yarn lockfile and Node 16 to build.
Wrangler uses a separate modern Node runtime (Node 22 here).

```powershell
# In repository root, using Node 16 / Yarn 1
yarn install --frozen-lockfile --ignore-engines
$env:REACT_APP_BROKER_URL='https://vtt.pangbai.de'   # or your workers.dev URL
$env:REACT_APP_BROKER_TRANSPORT='cloudflare'
$env:REACT_APP_CHAT_URL='https://chat.pangbai.de/'  # optional Boluo chat window (see ../boluo-mirror)
$env:REACT_APP_DISCORD_CHAT_URL='https://discord.pangbai.de/'  # optional Discord chat window (see ../discord-bridge)
$env:REACT_APP_SHEET_EDITOR_URL='https://sheets.pangbai.de'  # optional character sheets (see ../sheet-editor)
$env:GENERATE_SOURCEMAP='false'
yarn build

# Switch to Node 22, then:
cd cloudflare
npm ci
npx wrangler login
npm run deploy
```

Before using a different account/domain, edit `name`, `routes` and
`ALLOWED_ORIGINS` in `wrangler.deploy.jsonc`. Requests whose `Origin` equals the
Worker's own hostname are always accepted, so the frontend works on both the
custom domain and workers.dev; other frontends need their exact origin listed
(no wildcard CORS). `workers_dev: true` keeps the workers.dev fallback enabled
next to the custom domain.

### Custom domain checklist (vtt.pangbai.de)

1. `pangbai.de` zone shows **Active** in Cloudflare (nameservers switched at Spaceship).
2. DNSSEC: the DS record from Cloudflare is published at Spaceship and Cloudflare
   shows DNSSEC **Success** (until then validating resolvers may return SERVFAIL).
3. Workers → owlbear-legacy-trial → Domains: `vtt.pangbai.de` certificate **Active**.
4. `curl https://vtt.pangbai.de/health` returns `{"ok":true,...}`.
5. Run the protocol and browser tests with `TEST_BROKER=https://vtt.pangbai.de`. The deployment config serves `/game/*` as SPA routes and sends `/ws`,
`/health`, and `/iceservers` to the Worker. `wrangler.jsonc` is the backend-only
local configuration (`npm run dev`).

## Optional Cloudflare TURN

Default STUN: `stun.miwifi.com:3478`, `stun.hitv.com:3478`.
Create a TURN key in Cloudflare Realtime, then use server-side secrets:

```powershell
npx wrangler secret put TURN_KEY_ID --config wrangler.deploy.jsonc
npx wrangler secret put TURN_API_TOKEN --config wrangler.deploy.jsonc
```

The API token stays on the server. Each authenticated WebSocket receives temporary
credentials valid for 24 hours; reconnect after that period for fresh credentials.
If the API fails, the room retains STUN and emits `turn_unavailable`.
`GET /health` reports whether TURN secrets are configured, without revealing them.
TURN is currently **not configured or tested** on this trial.

## Verification (2026-10-15)

- Full frontend TypeScript check and production build passed with locked dependencies.
- Local workerd and deployed cloud protocol tests passed: correct/wrong passwords,
  players, maps, state diffs, manifest, signalling, room isolation, unsafe diff
  rejection, late joining and leave notifications.
- Two isolated Chromium profiles joined the deployed room, synchronized nicknames,
  imported a custom PNG, transferred the original and thumbnail over WebRTC, and
  verified identical SHA-256 hashes in both IndexedDB databases.
- Browser page errors: none. Both a dropped signalling connection and a page refresh
  rejoined the room with a new session ID and restored the player list.
- Browser results, screenshots and raw WebSocket traces are local-only in
  `test-results/` (ignored by Git).

```powershell
npm test                              # running local backend on port 8787
$env:TEST_BROKER='https://YOUR-WORKER.workers.dev'
npm test                              # deployed protocol test
python test/browser_smoke.py           # requires Python Playwright + Chromium
```

This is a small-group trial: maximum 32 concurrent sockets per room, 1 MiB per
WebSocket message, SQL-persisted map metadata/state. It does not provide uploaded
image hosting or a server backup of browser assets. Mainland ISP connectivity,
cross-network NAT traversal and forced TURN relay still need separate tests.
No paid plan or TURN billing configuration was enabled by this deployment.

References: [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[static assets](https://developers.cloudflare.com/workers/static-assets/),
[TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/).
