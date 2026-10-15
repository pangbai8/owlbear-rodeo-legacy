# Discord bridge (discord.pangbai.de)

A small Discord chat page for the Owlbear chat window: players sign in with
Discord and read/write channels of one or more servers without leaving the
map. Runs on Cloudflare Workers + one SQLite Durable Object, within the free plan.

- **Discord → page:** while anyone has the page open, the Durable Object keeps a
  Gateway connection and pushes new messages, **edits and deletes** live over
  WebSocket. With nobody connected for a minute it disconnects (no idle cost).
- **Page → Discord:** messages go through a per-channel webhook created by the
  bot, under the player's server nickname and avatar, or a **character**.
  Files up to 10 MB in total per message.
- **Characters (like Tupperbox):** each player sets up characters on the page
  (name, display name + tag, avatar upload or link, `prefix text suffix`
  brackets, keep brackets) or imports a `tul!export` file. A message wrapped in
  a character's brackets — `n: hello`, full-width `n：` works too — or sent with
  the character picked next to the input goes out as that character.
  Tupperbox itself ignores bot/webhook messages, so it cannot proxy for the page.
- **Editing:** on the page (hover, or ↑ in an empty input), or in Discord by
  right-clicking the message → Apps → **编辑（Owlbear）** / **删除（Owlbear）**
  (webhook messages cannot be edited in the Discord client). Only the sender can
  edit or delete their bridge messages.
- **Access mirrors Discord:** sign-in needs Discord OAuth (`identify` only). A
  channel shows up only for people who can see it in Discord (server roles and
  channel overwrites, owner/admin, timeouts); without Send Messages it is
  read-only, without Attach Files there are no uploads, without Read Message
  History no history. Rechecked every few minutes while connected.
  `ALLOWED_ROLE_IDS` can restrict it further.
- Channels can come from several servers (the channel picker groups them).
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
4. **General Information** → copy the Public Key into `DISCORD_PUBLIC_KEY`;
   after deploying, set **Interactions Endpoint URL** to
   `https://discord.pangbai.de/interactions` (needed for the right-click
   commands when nobody has the page open).
5. Invite the bot to each server with View Channel, Read Message History and
   Manage Webhooks (also per channel, for private channels):
   `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot&permissions=536937472`
6. Enable Developer Mode in Discord (Settings → Advanced) and copy the channel
   ids you want to open up into `CHANNEL_IDS` (any mix of servers).

## Deploy

```powershell
npm install
# Fill DISCORD_CLIENT_ID, DISCORD_PUBLIC_KEY, CHANNEL_IDS (and ALLOWED_ROLE_IDS) in wrangler.deploy.jsonc
npx wrangler secret put DISCORD_BOT_TOKEN --config wrangler.deploy.jsonc
npx wrangler secret put DISCORD_CLIENT_SECRET --config wrangler.deploy.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.deploy.jsonc   # any long random string
npm run deploy
npm run register    # right-click commands, global; reads the bot token and client id from .dev.vars
```

Then build the VTT with `REACT_APP_CHAT_URL=https://discord.pangbai.de/`
(see ../cloudflare/README.md); the existing chat window embeds it unchanged.

The bridge **must be on the same site as the VTT** (`*.pangbai.de`): the login
cookie is `SameSite=Lax`, so browsers only send it to the iframe when both are
same-site. Sign-in happens in a popup because discord.com refuses to be framed.
`FRAME_ANCESTORS` lists the pages allowed to embed the chat.

Character avatars uploaded on the page are stored in the Durable Object and
served publicly at `/avatars/<id>`, because Discord has to fetch them.

## Develop

```powershell
npm install
npm test                       # unit tests
copy .dev.vars.example .dev.vars   # then fill in, or use the mock below
npm run dev                    # http://localhost:8791
```

Without a real bot, run a local mock of the Discord API and Gateway (two
servers, a private and a read-only channel; see the header of the file):

```powershell
node test/mock-discord.mjs     # port 8792
npm run dev                    # with the .dev.vars from mock-discord.mjs
node test/e2e-smoke.mjs        # sends, edits, deletes, permissions, characters, right-click
```

Sign-in cannot reach the mock; for manual testing in a browser, set a session
cookie signed with your `SESSION_SECRET` for user id `111` (see e2e-smoke.mjs).
Locally uploaded avatars do not show up in Discord (it cannot fetch localhost).

## Limits and costs

Free plan: Durable Object requests (100k/day) and duration (13k GB-s/day) — the
object stays awake while the chat is open, about 1,800 GB-s for a 4-hour session.
Discord rate limits webhooks to about 5 messages per 2 seconds per channel.
Sessions last 30 days; changing `SESSION_SECRET` signs everyone out. Members,
roles and channel overwrites are cached for 1–5 minutes. Up to 100 characters
per player; avatars up to 1 MB (larger images are shrunk to 512 px).
