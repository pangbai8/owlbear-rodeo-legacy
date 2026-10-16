// One Durable Object for the whole bridge: holds the browser WebSockets, keeps a
// Gateway connection open while any of them is connected, and sends messages
// through one webhook per channel so they show the player's (or character's)
// name and avatar. Channels may belong to different servers; every request is
// checked against the user's Discord permissions in that channel.
import { DurableObject } from "cloudflare:workers";

import {
  DiscordError,
  avatarUrl,
  discordRequest,
  displayName,
  memberAllowed,
  readConfig,
  speakerOf,
  toClientMessage,
  webhookUsername,
} from "./discord.mjs";
import { GatewayClient } from "./gateway.mjs";
import { handleInteraction } from "./interactions.mjs";
import { MANAGE_WEBHOOKS, channelAccess, channelPermissions } from "./permissions.mjs";
import { MAX_CHARACTERS, characterDisplayName, fromTupperboxExport, matchProxy, normalizeCharacter } from "../public/proxy.js";

const MEMBER_TTL = 5 * 60 * 1000;
const GUILD_TTL = 60 * 1000;
const RECHECK_INTERVAL = 5 * 60 * 1000;
const IDLE_SHUTDOWN = 60 * 1000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_CONTENT = 2000;
const WEBHOOK_NAME = "Owlbear Bridge";
const UNKNOWN_WEBHOOK = 10015;
const MAX_AVATAR_BYTES = 1024 * 1024;
const MAX_AVATARS_PER_USER = 200;
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const NO_ACCESS = { view: false, history: false, send: false, attach: false };
const CATEGORY = 4;
// Text and announcement channels (voice-channel chats and threads are left out)
const TEXT_CHANNEL_TYPES = [0, 5];
const compareIds = (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status, code, message) {
  return json({ error: code, message }, status);
}

/** Caches async lookups for `ttl` ms; concurrent callers share one request */
class TtlCache {
  constructor(ttl) {
    this.ttl = ttl;
    this.entries = new Map();
  }
  get(key, load) {
    const entry = this.entries.get(key);
    if (entry && Date.now() - entry.at < this.ttl) return entry.value;
    const value = load().catch((e) => {
      this.entries.delete(key);
      throw e;
    });
    this.entries.set(key, { at: Date.now(), value });
    return value;
  }
  peek(key) {
    const entry = this.entries.get(key);
    return entry?.settled;
  }
  async settle(key, promise) {
    const value = await promise;
    const entry = this.entries.get(key);
    if (entry) entry.settled = value;
    return value;
  }
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.config = readConfig(env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS webhooks (channel_id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, token TEXT NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS sent (message_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL)",
    );
    this.sql.exec("CREATE INDEX IF NOT EXISTS characters_user ON characters (user_id)");
    // Uploaded character avatars, served publicly at /avatars/<id> so Discord can fetch them
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS avatars (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content_type TEXT NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL)",
    );
    /** @type {Map<WebSocket, {userId: string, channelId: string}>} */
    this.clients = new Map();
    this.guildCache = new TtlCache(GUILD_TTL); // guild id -> { id, name, ownerId, roles, roleInfo, channelNames, categories, channels }
    this.channelGuild = new Map(); // channel id -> guild id
    this.memberCache = new TtlCache(MEMBER_TTL); // "guild:user" -> member | null
    this.nicks = new Map(); // "guild:user" -> nickname seen on gateway events
    this.recheckTimer = null;
    this.gatewayState = "idle";
    this.gateway = new GatewayClient({
      token: env.DISCORD_BOT_TOKEN,
      // Testing hook: point at a local mock Discord (see test/mock-discord.mjs)
      gatewayUrl: env.DISCORD_GATEWAY_URL || undefined,
      onDispatch: (type, data) => this.onDispatch(type, data),
      onStatus: (state, detail) => this.onGatewayStatus(state, detail),
    });
  }

  // ---- Discord lookups -------------------------------------------------------

  /** The bot's own user (its id is needed for its channel permissions) */
  getBotUser() {
    return this.guildCache.get("@bot", () => discordRequest(this.env, "/users/@me"));
  }

  /** Servers the bot is in */
  getBotGuilds() {
    return this.guildCache.get("@guilds", async () => {
      const guilds = await discordRequest(this.env, "/users/@me/guilds?limit=200");
      return guilds.map((g) => ({ id: g.id, name: g.name }));
    });
  }

  getGuild(guildId) {
    return this.guildCache.get(guildId, async () => {
      const [guild, roles, channels] = await Promise.all([
        discordRequest(this.env, `/guilds/${guildId}`),
        discordRequest(this.env, `/guilds/${guildId}/roles`),
        discordRequest(this.env, `/guilds/${guildId}/channels`),
      ]);
      const categories = Object.fromEntries(
        channels.filter((c) => c.type === CATEGORY).map((c) => [c.id, { name: c.name, position: c.position }]),
      );
      const textChannels = channels
        .filter((c) => TEXT_CHANNEL_TYPES.includes(c.type))
        .map((c) => ({
          id: c.id,
          guildId,
          name: c.name,
          position: c.position,
          parentId: c.parent_id || null,
          overwrites: c.permission_overwrites || [],
        }))
        // Discord's order: uncategorised first, then categories by position, channels by position
        .sort((a, b) => {
          const pa = a.parentId ? (categories[a.parentId]?.position ?? 0) + 1 : 0;
          const pb = b.parentId ? (categories[b.parentId]?.position ?? 0) + 1 : 0;
          return pa - pb || a.position - b.position || compareIds(a.id, b.id);
        });
      for (const c of textChannels) this.channelGuild.set(c.id, guildId);
      return {
        id: guildId,
        name: guild.name,
        ownerId: guild.owner_id,
        roles: Object.fromEntries(roles.map((r) => [r.id, r.permissions])),
        roleInfo: Object.fromEntries(roles.map((r) => [r.id, { name: r.name, color: r.color }])),
        channelNames: Object.fromEntries(channels.map((c) => [c.id, c.name])),
        categories,
        channels: textChannels,
      };
    });
  }

  getMember(guildId, userId) {
    const key = `${guildId}:${userId}`;
    return this.memberCache.settle(
      key,
      this.memberCache.get(key, async () => {
        try {
          return await discordRequest(this.env, `/guilds/${guildId}/members/${userId}`);
        } catch (e) {
          if (e instanceof DiscordError && e.status === 404) return null;
          throw e;
        }
      }),
    );
  }

  /** Which server a channel belongs to (from loaded servers, else one lookup) */
  async guildOfChannel(channelId) {
    if (this.channelGuild.has(channelId)) return this.channelGuild.get(channelId);
    try {
      const channel = await discordRequest(this.env, `/channels/${channelId}`);
      if (channel.guild_id) this.channelGuild.set(channelId, channel.guild_id);
      return channel.guild_id || null;
    } catch (e) {
      // The bot cannot see it (missing permission, deleted, wrong id)
      if (e instanceof DiscordError && (e.status === 403 || e.status === 404)) return null;
      throw e;
    }
  }

  /** Whether CHANNEL_IDS (if set) allows this channel */
  channelListed(channelId) {
    return !this.config.channelIds.length || this.config.channelIds.includes(channelId);
  }

  /** The user's rights in one channel of one server; null if the bot cannot use it */
  async accessIn(userId, guild, channel) {
    if (!this.channelListed(channel.id)) return null;
    const bot = await this.getBotUser();
    const [member, botMember] = await Promise.all([this.getMember(guild.id, userId), this.getMember(guild.id, bot.id)]);
    // The bot has to read the channel itself, and needs Manage Webhooks to post
    const botPerms = channelPermissions({ userId: bot.id, member: botMember, guild, overwrites: channel.overwrites });
    const botAccess = channelAccess(botPerms);
    if (!botAccess.history) return null;
    const allowed = memberAllowed(member, this.config.allowedRoleIds);
    const access = allowed ? channelAccess(channelPermissions({ userId, member, guild, overwrites: channel.overwrites })) : NO_ACCESS;
    if (!(botPerms & MANAGE_WEBHOOKS)) {
      access.send = false;
      access.attach = false;
      access.botCannotPost = true;
    }
    return { channel, guild, member, access };
  }

  /** The user's rights in a channel given only its id */
  async accessFor(userId, channelId) {
    const guildId = await this.guildOfChannel(channelId);
    if (!guildId) return null;
    const guild = await this.getGuild(guildId);
    const channel = guild.channels.find((c) => c.id === channelId);
    if (!channel) return null;
    return this.accessIn(userId, guild, channel);
  }

  /** Every text channel, in every server the bot is in, that this user can see in Discord */
  async visibleChannels(userId) {
    const guilds = await this.getBotGuilds();
    const perGuild = await Promise.all(
      guilds.map(async ({ id }) => {
        try {
          // Skip servers the user is not in before loading their channels
          if (!(await this.getMember(id, userId))) return [];
          const guild = await this.getGuild(id);
          const entries = await Promise.all(guild.channels.map((c) => this.accessIn(userId, guild, c)));
          return entries.filter((entry) => entry?.access.view);
        } catch (e) {
          console.error(`server ${id} could not be loaded`, e);
          return [];
        }
      }),
    );
    return perGuild.flat();
  }

  /** Any server the bot is in where this user is a member */
  async memberships(userId) {
    const guilds = await this.getBotGuilds();
    const members = await Promise.all(guilds.map(({ id }) => this.getMember(id, userId).catch(() => null)));
    return members.filter(Boolean);
  }

  profileOf(member, guildId) {
    return {
      id: member.user.id,
      name: displayName(member.user, member),
      avatar: avatarUrl(member.user, member, guildId),
    };
  }

  ownerOf = (messageId) => this.sql.exec("SELECT user_id FROM sent WHERE message_id = ?", messageId).toArray()[0]?.user_id ?? null;

  clientMessage(message, guildId = this.channelGuild.get(message.channel_id)) {
    const nickOf = (userId) =>
      this.nicks.get(`${guildId}:${userId}`) || this.memberCache.peek(`${guildId}:${userId}`)?.nick || null;
    return toClientMessage(message, { guildId, ownerOf: this.ownerOf, nickOf });
  }

  // ---- webhooks ----------------------------------------------------------------

  async getWebhook(channelId, { recreate = false } = {}) {
    if (recreate) this.sql.exec("DELETE FROM webhooks WHERE channel_id = ?", channelId);
    const row = this.sql.exec("SELECT webhook_id, token FROM webhooks WHERE channel_id = ?", channelId).toArray()[0];
    if (row) return { id: row.webhook_id, token: row.token };
    // Reuse a webhook this bot created earlier (e.g. after the storage was reset)
    const existing = await discordRequest(this.env, `/channels/${channelId}/webhooks`).catch(() => []);
    let webhook = existing.find((w) => w.name === WEBHOOK_NAME && w.token && w.application_id === this.config.clientId);
    if (!webhook)
      webhook = await discordRequest(this.env, `/channels/${channelId}/webhooks`, { method: "POST", json: { name: WEBHOOK_NAME } });
    this.sql.exec(
      "INSERT OR REPLACE INTO webhooks (channel_id, webhook_id, token) VALUES (?, ?, ?)",
      channelId,
      webhook.id,
      webhook.token,
    );
    return { id: webhook.id, token: webhook.token };
  }

  /** Runs a webhook call, recreating the webhook once if someone deleted it */
  async withWebhook(channelId, call) {
    try {
      return await call(await this.getWebhook(channelId));
    } catch (e) {
      if (!(e instanceof DiscordError && e.code === UNKNOWN_WEBHOOK)) throw e;
      return call(await this.getWebhook(channelId, { recreate: true }));
    }
  }

  // ---- browser sockets ---------------------------------------------------------

  broadcast(channelId, payload) {
    const text = JSON.stringify(payload);
    for (const [socket, client] of this.clients) {
      if (channelId && client.channelId !== channelId) continue;
      try {
        socket.send(text);
      } catch {
        this.dropClient(socket);
      }
    }
  }

  dropClient(socket) {
    if (!this.clients.delete(socket)) return;
    if (this.clients.size === 0) {
      clearInterval(this.recheckTimer);
      this.recheckTimer = null;
      this.ctx.storage.setAlarm(Date.now() + IDLE_SHUTDOWN);
    }
  }

  /** Disconnects people who lost access to their channel (roles changed, kicked, ...) */
  async recheckClients() {
    for (const [socket, client] of [...this.clients]) {
      try {
        const entry = await this.accessFor(client.userId, client.channelId);
        const access = entry?.access || NO_ACCESS;
        if (!access.view) {
          socket.close(4003, "forbidden");
          this.dropClient(socket);
        } else {
          socket.send(JSON.stringify({ type: "access", access }));
        }
      } catch (e) {
        console.error("recheck failed", e);
      }
    }
  }

  openSocket(request, url, userId, entry) {
    if (request.headers.get("Upgrade") !== "websocket") return error(426, "upgrade_required", "Expected WebSocket");
    const channelId = entry.channel.id;
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.clients.set(server, { userId, channelId });
    server.addEventListener("message", (event) => {
      if (event.data === "ping") {
        try {
          server.send("pong");
        } catch {}
      }
    });
    server.addEventListener("close", () => this.dropClient(server));
    server.addEventListener("error", () => this.dropClient(server));
    this.ctx.storage.deleteAlarm();
    this.recheckTimer ??= setInterval(() => this.recheckClients(), RECHECK_INTERVAL);
    server.send(JSON.stringify({ type: "status", state: this.gatewayState }));
    server.send(JSON.stringify({ type: "access", access: entry.access }));
    this.gateway.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- gateway -------------------------------------------------------------

  onGatewayStatus(state, detail) {
    this.gatewayState = state;
    this.broadcast(null, { type: "status", state, ...detail });
    // A fresh session may have missed events: let browsers re-read the latest page
    if (state === "ready" && !detail.resumed) this.broadcast(null, { type: "resync" });
  }

  async onDispatch(type, data) {
    // Without an Interactions Endpoint URL, Discord delivers context-menu clicks here
    if (type === "INTERACTION_CREATE") {
      const response = await this.interaction(data);
      await discordRequest(this.env, `/interactions/${data.id}/${data.token}/callback`, { method: "POST", json: response, auth: null }).catch(
        (e) => console.error("interaction callback failed", e),
      );
      return;
    }
    if (!data?.channel_id || ![...this.clients.values()].some((c) => c.channelId === data.channel_id)) return;
    try {
      if (type === "MESSAGE_CREATE" || type === "MESSAGE_UPDATE") {
        if (data.member?.nick !== undefined && data.author && data.guild_id) {
          const key = `${data.guild_id}:${data.author.id}`;
          if (data.member.nick) this.nicks.set(key, data.member.nick);
          else this.nicks.delete(key);
        }
        // Older-style partial updates (e.g. link previews) lack the author
        const message = data.author
          ? data
          : await discordRequest(this.env, `/channels/${data.channel_id}/messages/${data.id}`);
        this.broadcast(data.channel_id, { type: "upsert", message: this.clientMessage(message, data.guild_id) });
      } else if (type === "MESSAGE_DELETE") {
        this.sql.exec("DELETE FROM sent WHERE message_id = ?", data.id);
        this.broadcast(data.channel_id, { type: "delete", ids: [data.id] });
      } else if (type === "MESSAGE_DELETE_BULK") {
        for (const id of data.ids) this.sql.exec("DELETE FROM sent WHERE message_id = ?", id);
        this.broadcast(data.channel_id, { type: "delete", ids: data.ids });
      }
    } catch (e) {
      console.error("dispatch failed", type, e);
    }
  }

  async alarm() {
    if (this.clients.size === 0) this.gateway.stop();
  }

  // ---- HTTP ----------------------------------------------------------------

  async fetch(request) {
    const response = await this.route(request);
    // Drain bodies of rejected requests: replying before a body is read resets the connection
    if (request.body && !request.bodyUsed) await request.arrayBuffer().catch(() => {});
    return response;
  }

  async route(request) {
    const url = new URL(request.url);
    try {
      // Only the Worker can reach these (it never forwards /internal from browsers)
      if (url.pathname === "/internal/interaction" && request.method === "POST")
        return json(await this.interaction(await request.json()));
      if (url.pathname === "/internal/access" && request.method === "POST") {
        const { userId } = await request.json();
        return json(await this.loginCheck(userId));
      }
      const avatarMatch = url.pathname.match(/^\/internal\/avatars\/([0-9a-f]{32})$/);
      if (avatarMatch) return this.avatar(avatarMatch[1]);

      const userId = request.headers.get("X-Bridge-User");
      if (!userId) return error(401, "unauthorized", "未登录");

      if (url.pathname === "/api/me" && request.method === "GET") return this.me(userId);
      if (url.pathname.startsWith("/api/characters") || url.pathname === "/api/avatars") {
        if (!(await this.visibleChannels(userId)).length) return error(403, "no_access", "你没有可用的频道");
        return this.characterRoute(request, url, userId);
      }

      const channelId = url.pathname === "/ws" ? url.searchParams.get("channel") : url.pathname.match(/^\/api\/channels\/(\d+)\//)?.[1];
      if (!channelId) return error(404, "not_found", "Not found");
      const entry = await this.accessFor(userId, channelId);
      if (!entry?.access.view) return error(403, "no_access", "你看不到这个频道");

      if (url.pathname === "/ws") return this.openSocket(request, url, userId, entry);

      const match = url.pathname.match(/^\/api\/channels\/\d+\/messages(?:\/(\d+))?$/);
      if (!match) return error(404, "not_found", "Not found");
      const messageId = match[1];
      if (!messageId && request.method === "GET") {
        if (!entry.access.history) return json({ messages: [], hasMore: false, noHistory: true });
        return this.history(entry, url);
      }
      if (!messageId && request.method === "POST") {
        if (!entry.access.send)
          return error(403, "no_send", entry.access.botCannotPost ? "机器人在这个频道没有「管理 Webhook」权限，发不了消息" : "你在这个频道没有发言权限");
        return this.send(entry, request);
      }
      if (messageId && request.method === "PATCH") return this.edit(channelId, messageId, request, userId);
      if (messageId && request.method === "DELETE") return this.remove(channelId, messageId, userId);
      return error(405, "method_not_allowed", "Method not allowed");
    } catch (e) {
      console.error("request failed", url.pathname, e);
      if (e instanceof DiscordError) {
        const message = e.status === 403 ? "机器人缺少权限" : e.status === 429 ? "发得太快了，稍等一下" : e.message;
        return error(e.status === 429 ? 429 : 502, "discord_error", message);
      }
      return error(500, "internal", "服务器出错了");
    }
  }

  /** Used by the OAuth callback: may this user sign in at all? */
  async loginCheck(userId) {
    const visible = await this.visibleChannels(userId);
    if (visible.length) return { ok: true };
    const members = await this.memberships(userId);
    if (!members.length) return { ok: false, reason: "not_member" };
    if (this.config.allowedRoleIds.length && !members.some((m) => memberAllowed(m, this.config.allowedRoleIds)))
      return { ok: false, reason: "missing_role" };
    return { ok: false, reason: "no_channels" };
  }

  async me(userId) {
    const visible = await this.visibleChannels(userId);
    if (!visible.length) {
      const check = await this.loginCheck(userId);
      const messages = {
        not_member: "你和这个机器人没有共同的 Discord 服务器",
        missing_role: "你没有使用这个聊天窗口所需的身份组",
        no_channels: "你在 Discord 里看不到机器人能用的任何频道",
      };
      return error(403, check.reason || "no_access", messages[check.reason] || "没有可用的频道");
    }
    const channelNames = {};
    const roles = {};
    for (const { guild } of visible) {
      Object.assign(channelNames, guild.channelNames);
      Object.assign(roles, guild.roleInfo);
    }
    const user = visible[0].member.user;
    return json({
      user: { id: user.id, name: displayName(user, null), avatar: avatarUrl(user, null) },
      channels: visible.map(({ channel, guild, member, access }) => ({
        id: channel.id,
        name: guild.channelNames[channel.id] || channel.name,
        guildId: guild.id,
        guildName: guild.name,
        category: channel.parentId ? guild.categories[channel.parentId]?.name || "" : "",
        access,
        self: this.profileOf(member, guild.id),
      })),
      names: { channels: channelNames, roles },
      gateway: this.gatewayState,
    });
  }

  async history({ channel }, url) {
    const params = new URLSearchParams({ limit: "50" });
    const before = url.searchParams.get("before");
    if (before && /^\d+$/.test(before)) params.set("before", before);
    const messages = await discordRequest(this.env, `/channels/${channel.id}/messages?${params}`);
    // History has no member objects; look up authors once so server nicknames show
    const unknown = new Set();
    for (const m of messages) {
      const key = `${channel.guildId}:${m.author?.id}`;
      if (!m.webhook_id && m.author && !this.nicks.has(key) && this.memberCache.peek(key) === undefined) unknown.add(m.author.id);
    }
    await Promise.all([...unknown].slice(0, 20).map((id) => this.getMember(channel.guildId, id).catch(() => null)));
    return json({
      messages: messages.reverse().map((m) => this.clientMessage(m, channel.guildId)),
      hasMore: messages.length === 50,
    });
  }

  async readMessageInput(request) {
    const type = request.headers.get("Content-Type") || "";
    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const files = form.getAll("files").filter((f) => typeof f === "object" && f.size > 0);
      return { content: String(form.get("content") || ""), characterId: String(form.get("characterId") || ""), files };
    }
    const body = await request.json().catch(() => ({}));
    return {
      content: String(body.content || ""),
      characterId: String(body.characterId || ""),
      speaker: speakerOf(body.speaker),
      files: [],
    };
  }

  async send({ channel, guild, member, access }, request) {
    const input = await this.readMessageInput(request);
    const { files } = input;
    if (files.length && !access.attach) return error(403, "no_attach", "你在这个频道没有上传文件的权限");
    // Brackets (e.g. "n: hello") pick a character, like Tupperbox; otherwise the chosen one, if any
    const profile = this.profileOf(member, guild.id);
    const characters = this.listCharacters(profile.id);
    const proxied = matchProxy(input.content.trim(), characters);
    const character = proxied?.character || characters.find((c) => c.id === input.characterId) || null;
    const text = (proxied ? proxied.content : input.content).trim();
    if (!text && !files.length) return error(400, "empty", proxied ? "括号里没有内容" : "消息是空的");
    if (Array.from(text).length > MAX_CONTENT) return error(400, "too_long", `消息不能超过 ${MAX_CONTENT} 字`);
    if (files.length > 10) return error(400, "too_many_files", "一次最多 10 个文件");
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD_BYTES) return error(413, "too_large", "文件总大小不能超过 10MB");

    // A monster rolling from the VTT's stat card speaks under its own name
    const { speaker } = input;
    const payload = {
      content: text,
      username: webhookUsername(
        speaker ? speaker.name : character ? characterDisplayName(character) : profile.name,
      ),
      avatar_url: (speaker ? speaker.avatarUrl : null) || character?.avatarUrl || profile.avatar,
      allowed_mentions: { parse: ["users", "roles"] },
    };
    const message = await this.withWebhook(channel.id, ({ id, token }) => {
      const path = `/webhooks/${id}/${token}?wait=true`;
      if (!files.length) return discordRequest(this.env, path, { method: "POST", json: payload, auth: null });
      const form = new FormData();
      form.set("payload_json", JSON.stringify({ ...payload, attachments: files.map((f, i) => ({ id: i, filename: f.name })) }));
      files.forEach((file, i) => form.set(`files[${i}]`, file, file.name));
      return discordRequest(this.env, path, { method: "POST", body: form, auth: null });
    });
    this.sql.exec(
      "INSERT OR REPLACE INTO sent (message_id, channel_id, user_id, created_at) VALUES (?, ?, ?, ?)",
      message.id,
      channel.id,
      profile.id,
      Date.now(),
    );
    const result = this.clientMessage(message, guild.id);
    this.broadcast(channel.id, { type: "upsert", message: result });
    return json({ message: result });
  }

  checkOwner(messageId, userId) {
    const owner = this.ownerOf(messageId);
    if (!owner) return error(403, "not_editable", "只能修改从这里发出的消息");
    if (owner !== userId) return error(403, "not_owner", "只能修改自己的消息");
    return null;
  }

  async edit(channelId, messageId, request, userId) {
    const denied = this.checkOwner(messageId, userId);
    if (denied) return denied;
    const { content } = await request.json().catch(() => ({}));
    const text = String(content || "").trim();
    if (!text) return error(400, "empty", "消息不能为空，想删掉请用删除");
    if (Array.from(text).length > MAX_CONTENT) return error(400, "too_long", `消息不能超过 ${MAX_CONTENT} 字`);
    return json({ message: await this.editMessage(channelId, messageId, text) });
  }

  async editMessage(channelId, messageId, text) {
    const { id, token } = await this.getWebhook(channelId);
    const message = await discordRequest(this.env, `/webhooks/${id}/${token}/messages/${messageId}`, {
      method: "PATCH",
      json: { content: text, allowed_mentions: { parse: ["users", "roles"] } },
      auth: null,
    });
    const result = this.clientMessage(message);
    this.broadcast(channelId, { type: "upsert", message: result });
    return result;
  }

  async remove(channelId, messageId, userId) {
    const denied = this.checkOwner(messageId, userId);
    if (denied) return denied;
    await this.deleteMessage(channelId, messageId);
    return json({ ok: true });
  }

  async deleteMessage(channelId, messageId) {
    try {
      const { id, token } = await this.getWebhook(channelId);
      await discordRequest(this.env, `/webhooks/${id}/${token}/messages/${messageId}`, { method: "DELETE", auth: null });
    } catch (e) {
      // Already gone (deleted in Discord, by a moderator, or with its webhook)
      if (!(e instanceof DiscordError && e.status === 404)) throw e;
    }
    this.sql.exec("DELETE FROM sent WHERE message_id = ?", messageId);
    this.broadcast(channelId, { type: "delete", ids: [messageId] });
  }

  // ---- context-menu commands -----------------------------------------------

  interaction(data) {
    return handleInteraction(data, {
      ownerOf: this.ownerOf,
      edit: (channelId, messageId, text) => this.editMessage(channelId, messageId, text),
      remove: (channelId, messageId) => this.deleteMessage(channelId, messageId),
      contentOf: async (channelId, messageId) => {
        const { id, token } = await this.getWebhook(channelId);
        const message = await discordRequest(this.env, `/webhooks/${id}/${token}/messages/${messageId}`, { auth: null });
        return message.content || "";
      },
    });
  }

  // ---- characters ----------------------------------------------------------

  listCharacters(userId) {
    return this.sql
      .exec("SELECT id, data FROM characters WHERE user_id = ? ORDER BY created_at, id", userId)
      .toArray()
      .map((row) => ({ id: row.id, ...JSON.parse(row.data) }));
  }

  saveCharacter(userId, id, character, createdAt = Date.now()) {
    const { id: _ignored, ...data } = character;
    this.sql.exec(
      "INSERT OR REPLACE INTO characters (id, user_id, data, created_at) VALUES (?, ?, ?, ?)",
      id,
      userId,
      JSON.stringify(data),
      createdAt,
    );
    return { id, ...data };
  }

  /** Removes uploaded avatars that no character of this user points at any more */
  pruneAvatars(userId) {
    const used = new Set(this.listCharacters(userId).map((c) => c.avatarUrl.match(/\/avatars\/([0-9a-f]{32})/)?.[1]));
    for (const row of this.sql.exec("SELECT id FROM avatars WHERE user_id = ?", userId).toArray()) {
      if (!used.has(row.id)) this.sql.exec("DELETE FROM avatars WHERE id = ?", row.id);
    }
  }

  async characterRoute(request, url, userId) {
    const parts = url.pathname.split("/").filter(Boolean); // api, characters, [id | "import"]
    const method = request.method;
    const readJson = () => request.json().catch(() => null);
    const tryNormalize = (input) => {
      try {
        return { character: normalizeCharacter(input || {}) };
      } catch (e) {
        return { response: error(400, "invalid_character", e.message) };
      }
    };
    const newId = () => crypto.randomUUID().replace(/-/g, "");

    if (url.pathname === "/api/avatars" && method === "POST") return this.uploadAvatar(request, userId);
    if (parts.length === 2 && method === "GET") return json({ characters: this.listCharacters(userId) });

    if (parts.length === 2 && method === "POST") {
      const { character, response } = tryNormalize(await readJson());
      if (response) return response;
      if (this.listCharacters(userId).length >= MAX_CHARACTERS) return error(400, "too_many", `最多 ${MAX_CHARACTERS} 个角色`);
      return json({ character: this.saveCharacter(userId, newId(), character) });
    }

    if (parts.length === 3 && parts[2] === "import" && method === "POST") {
      let imported;
      try {
        imported = fromTupperboxExport(await readJson());
      } catch (e) {
        return error(400, "invalid_import", e.message);
      }
      // A character with the same name is replaced, like Tupperbox's own import
      const existing = this.listCharacters(userId);
      let added = 0;
      let updated = 0;
      for (const character of imported) {
        const match = existing.find((c) => c.name === character.name);
        if (match) {
          this.saveCharacter(userId, match.id, character);
          updated++;
        } else if (existing.length + added < MAX_CHARACTERS) {
          this.saveCharacter(userId, newId(), character, Date.now() + added);
          added++;
        }
      }
      this.pruneAvatars(userId);
      return json({ added, updated, skipped: imported.length - added - updated, characters: this.listCharacters(userId) });
    }

    if (parts.length === 3) {
      const id = parts[2];
      const row = this.sql.exec("SELECT created_at FROM characters WHERE id = ? AND user_id = ?", id, userId).toArray()[0];
      if (!row) return error(404, "unknown_character", "找不到这个角色");
      if (method === "PUT") {
        const { character, response } = tryNormalize(await readJson());
        if (response) return response;
        const saved = this.saveCharacter(userId, id, character, row.created_at);
        this.pruneAvatars(userId);
        return json({ character: saved });
      }
      if (method === "DELETE") {
        this.sql.exec("DELETE FROM characters WHERE id = ? AND user_id = ?", id, userId);
        this.pruneAvatars(userId);
        return json({ ok: true });
      }
    }
    return error(404, "not_found", "Not found");
  }

  async uploadAvatar(request, userId) {
    const type = (request.headers.get("Content-Type") || "").split(";")[0].trim();
    if (!AVATAR_TYPES.includes(type)) return error(400, "bad_type", "头像只支持 PNG、JPEG、WebP、GIF");
    const data = await request.arrayBuffer();
    if (!data.byteLength) return error(400, "empty", "图片是空的");
    if (data.byteLength > MAX_AVATAR_BYTES) return error(413, "too_large", "头像不能超过 1MB");
    const count = this.sql.exec("SELECT COUNT(*) AS n FROM avatars WHERE user_id = ?", userId).toArray()[0].n;
    if (count >= MAX_AVATARS_PER_USER) this.pruneAvatars(userId);
    const id = crypto.randomUUID().replace(/-/g, "");
    this.sql.exec(
      "INSERT INTO avatars (id, user_id, content_type, data, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      userId,
      type,
      data,
      Date.now(),
    );
    return json({ url: `${request.headers.get("X-Bridge-Origin") || ""}/avatars/${id}` });
  }

  avatar(id) {
    const row = this.sql.exec("SELECT content_type, data FROM avatars WHERE id = ?", id).toArray()[0];
    if (!row) return new Response("Not found", { status: 404 });
    // Ids are never reused, so the image can be cached forever
    return new Response(row.data, {
      headers: { "Content-Type": row.content_type, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }
}
