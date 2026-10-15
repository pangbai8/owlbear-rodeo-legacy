# Boluo mirror (chat.pangbai.de)

Unofficial same-site reverse proxy for [Boluo](https://github.com/mythal/boluo)
(AGPL-3.0, frontend and backend unmodified), so the Boluo chat can be embedded
next to the Owlbear map on vtt.pangbai.de with a working login.

Why it works: Boluo's session cookie is `SameSite=Lax`, so it is never sent to
an iframe on another site. Served from `chat.pangbai.de` it is same-site with
`vtt.pangbai.de`. The Boluo SPA uses `location.origin + /api` on unknown
origins, so every API and WebSocket call goes through this Worker.

The Worker:
- proxies every path to `https://app.boluochat.com` (whose Worker forwards
  `/api/*` to the Boluo backend), WebSocket upgrades included;
- rewrites `Set-Cookie`: drops `Domain` (host-only cookie on the mirror) and
  forces `Secure`; rewrites `Location` redirects back to the mirror;
- answers `/api/info/proxies` with `[]`, so the SPA never switches its API
  base to a cross-site `proxy-N.boluo.chat`, where the cookie would not follow.

Logins on the mirror are separate from boluochat.com. Passwords and sessions
pass through this Worker, so only use it with people who trust the operator.

```bash
npm install
npm test        # cookie / redirect rewrite unit tests
npm run dev     # http://localhost:8790
npm run deploy  # needs wrangler login; binds chat.pangbai.de
```
