# Discord bridge (discord.pangbai.de)

A small Discord chat page for the Owlbear chat window: players sign in with
Discord and read/write one or more channels of your server without leaving the
map. Runs on Cloudflare Workers + one SQLite Durable Object, within the free plan.

- **Discord → page:** while anyone has the page open, the Durable Object keeps a
  Gateway connection and pushes new messages, **edits and deletes** live over
  WebSocket. With nobody connected for a minute it disconnects (no idle cost).
- **Page → Discord:** messages go through a per-channel webhook created by the
  bot, with the player's server nickname and avatar. Players can **edit and
  delete their own messages** (↑ in an empty input edits the last one); the
  change shows up in Discord too. Files up to 10 MB in total per message.
- **Access:** Discord OAuth (`identify` scope only). The user must be a member
  of the server, and optionally have one of `ALLOWED_ROLE_IDS`.
- Renders Discord markdown, mentions, custom emoji, timestamps, attachments,
  embeds (dice bots), stickers, replies and slash-command lines.

Not supported: voice, reactions, threads/forums, replying from the page.
Messages sent from the page carry Discord's `APP` tag (they are webhook messages).

## Discord setup

1. <https://discord.com/developers/applications> → **New Application**.
2. **Bot** → reset/copy the token (`DISCORD_BOT_TOKEN`), and turn on
   **Message Content Intent** (free for bots in fewer than 100 servers).
3. **OAuth2** → copy Client ID / Client Secret, and add the redirect
   `https://discord.pangbai.de/auth/callback`.
4. Invite the bot with View Channel, Read Message History and Manage Webhooks:
   `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot&permissions=536937472`
5. Enable Developer Mode in Discord (Settings → Advanced) and copy the server id
   and the channel ids you want to open up.

## Deploy

```powershell
npm install
# Fill DISCORD_CLIENT_ID, GUILD_ID, CHANNEL_IDS (and ALLOWED_ROLE_IDS) in wrangler.deploy.jsonc
npx wrangler secret put DISCORD_BOT_TOKEN --config wrangler.deploy.jsonc
npx wrangler secret put DISCORD_CLIENT_SECRET --config wrangler.deploy.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.deploy.jsonc   # any long random string
npm run deploy
```

Then build the VTT with `REACT_APP_CHAT_URL=https://discord.pangbai.de/`
(see ../cloudflare/README.md); the existing chat window embeds it unchanged.

The bridge **must be on the same site as the VTT** (`*.pangbai.de`): the login
cookie is `SameSite=Lax`, so browsers only send it to the iframe when both are
same-site. Sign-in happens in a popup because discord.com refuses to be framed.
`FRAME_ANCESTORS` lists the pages allowed to embed the chat.

## Develop

```powershell
npm install
npm test                       # unit tests (gateway, session, markdown, message shape)
copy .dev.vars.example .dev.vars   # then fill in, or use the mock below
npm run dev                    # http://localhost:8791
```

Without a real bot, run a local mock of the Discord API and Gateway:

```powershell
node test/mock-discord.mjs     # port 8792, see the header of the file for .dev.vars
npm run dev
node test/e2e-smoke.mjs        # sends, edits, deletes in both directions
```

Sign-in cannot reach the mock; for manual testing in a browser, set a session
cookie signed with your `SESSION_SECRET` for user id `111` (see e2e-smoke.mjs).

## Limits and costs

Free plan: Durable Object requests (100k/day) and duration (13k GB-s/day) — the
object stays awake while the chat is open, about 1,800 GB-s for a 4-hour session. Discord rate
limits webhooks to about 5 messages per 2 seconds per channel. Sessions last 30
days; changing `SESSION_SECRET` signs everyone out. Membership and roles are
rechecked every 5 minutes.
