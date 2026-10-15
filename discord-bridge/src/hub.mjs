// One Durable Object for the whole bridge: holds the browser WebSockets, keeps a
// Gateway connection open while any of them is connected, and sends messages
// through one webhook per channel so they show the player's Discord name/avatar.
import { DurableObject } from "cloudflare:workers";

import {
  DiscordError,
  avatarUrl,
  discordRequest,
  displayName,
  memberAllowed,
  readConfig,
  toClientMessage,
  webhookUsername,
} from "./discord.mjs";
import { GatewayClient } from "./gateway.mjs";

const MEMBER_TTL = 5 * 60 * 1000;
const NAMES_TTL = 10 * 60 * 1000;
const IDLE_SHUTDOWN = 60 * 1000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_CONTENT = 2000;
const WEBHOOK_NAME = "Owlbear Bridge";
const UNKNOWN_WEBHOOK = 10015;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status, code, message) {
  return json({ error: code, message }, status);
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
    /** @type {Map<WebSocket, {userId: string, channelId: string}>} */
    this.clients = new Map();
    this.members = new Map(); // user id -> { member, at }
    this.nicks = new Map(); // user id -> nickname seen on gateway events
    this.names = null; // { at, channels, roles }
    this.gatewayState = "idle";
    this.gateway = new GatewayClient({
      token: env.DISCORD_BOT_TOKEN,
      // Testing hook: point at a local mock Discord (see test/mock-discord.mjs)
      gatewayUrl: env.DISCORD_GATEWAY_URL || undefined,
      onDispatch: (type, data) => this.onDispatch(type, data),
      onStatus: (state, detail) => this.onGatewayStatus(state, detail),
    });
  }

  // ---- helpers -------------------------------------------------------------

  ownerOf = (messageId) => this.sql.exec("SELECT user_id FROM sent WHERE message_id = ?", messageId).toArray()[0]?.user_id ?? null;

  nickOf = (userId) => this.nicks.get(userId) || this.members.get(userId)?.member?.nick || null;

  clientMessage(message) {
    return toClientMessage(message, { guildId: this.config.guildId, ownerOf: this.ownerOf, nickOf: this.nickOf });
  }

  async getMember(userId, { fresh = false } = {}) {
    const cached = this.members.get(userId);
    if (!fresh && cached && Date.now() - cached.at < MEMBER_TTL) return cached.member;
    let member = null;
    try {
      member = await discordRequest(this.env, `/guilds/${this.config.guildId}/members/${userId}`);
    } catch (e) {
      if (!(e instanceof DiscordError && e.status === 404)) throw e;
    }
    this.members.set(userId, { member, at: Date.now() });
    return member;
  }

  profileOf(member) {
    return {
      id: member.user.id,
      name: displayName(member.user, member),
      avatar: avatarUrl(member.user, member, this.config.guildId),
    };
  }

  async getNames() {
    if (this.names && Date.now() - this.names.at < NAMES_TTL) return this.names;
    const [channels, roles] = await Promise.all([
      discordRequest(this.env, `/guilds/${this.config.guildId}/channels`).catch(() => []),
      discordRequest(this.env, `/guilds/${this.config.guildId}/roles`).catch(() => []),
    ]);
    this.names = {
      at: Date.now(),
      channels: Object.fromEntries(channels.map((c) => [c.id, c.name])),
      roles: Object.fromEntries(roles.map((r) => [r.id, { name: r.name, color: r.color }])),
    };
    return this.names;
  }

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
    if (this.clients.size === 0) this.ctx.storage.setAlarm(Date.now() + IDLE_SHUTDOWN);
  }

  // ---- gateway -------------------------------------------------------------

  onGatewayStatus(state, detail) {
    this.gatewayState = state;
    this.broadcast(null, { type: "status", state, ...detail });
    // A fresh session may have missed events: let browsers re-read the latest page
    if (state === "ready" && !detail.resumed) this.broadcast(null, { type: "resync" });
  }

  async onDispatch(type, data) {
    if (!data || !this.config.channelIds.includes(data.channel_id)) return;
    try {
      if (type === "MESSAGE_CREATE" || type === "MESSAGE_UPDATE") {
        if (data.member?.nick !== undefined && data.author) {
          if (data.member.nick) this.nicks.set(data.author.id, data.member.nick);
          else this.nicks.delete(data.author.id);
        }
        // Older-style partial updates (e.g. link previews) lack the author
        const message = data.author
          ? data
          : await discordRequest(this.env, `/channels/${data.channel_id}/messages/${data.id}`);
        this.broadcast(data.channel_id, { type: "upsert", message: this.clientMessage(message) });
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
    const userId = request.headers.get("X-Bridge-User");
    if (!userId) return error(401, "unauthorized", "未登录");
    try {
      const member = await this.getMember(userId);
      if (!member) return error(403, "not_member", "你不在这个 Discord 服务器里");
      if (!memberAllowed(member, this.config.allowedRoleIds))
        return error(403, "missing_role", "你没有使用这个聊天窗口所需的身份组");

      if (url.pathname === "/ws") return this.openSocket(request, url, userId);
      if (url.pathname === "/api/me" && request.method === "GET") return this.me(member);

      const match = url.pathname.match(/^\/api\/channels\/(\d+)\/messages(?:\/(\d+))?$/);
      if (!match) return error(404, "not_found", "Not found");
      const [, channelId, messageId] = match;
      if (!this.config.channelIds.includes(channelId)) return error(404, "unknown_channel", "这个频道没有开放");

      if (!messageId && request.method === "GET") return this.history(channelId, url);
      if (!messageId && request.method === "POST") return this.send(channelId, request, member);
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

  async me(member) {
    const names = await this.getNames();
    return json({
      user: this.profileOf(member),
      guildId: this.config.guildId,
      channels: this.config.channelIds.map((id) => ({ id, name: names.channels[id] || id })),
      names: { channels: names.channels, roles: names.roles },
      gateway: this.gatewayState,
    });
  }

  openSocket(request, url, userId) {
    if (request.headers.get("Upgrade") !== "websocket") return error(426, "upgrade_required", "Expected WebSocket");
    const channelId = url.searchParams.get("channel");
    if (!this.config.channelIds.includes(channelId)) return error(404, "unknown_channel", "这个频道没有开放");
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
    server.send(JSON.stringify({ type: "status", state: this.gatewayState }));
    this.gateway.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  async history(channelId, url) {
    const params = new URLSearchParams({ limit: "50" });
    const before = url.searchParams.get("before");
    if (before && /^\d+$/.test(before)) params.set("before", before);
    const messages = await discordRequest(this.env, `/channels/${channelId}/messages?${params}`);
    // History has no member objects; look up authors once so server nicknames show
    const unknown = new Set();
    for (const m of messages) {
      if (!m.webhook_id && m.author && !this.nicks.has(m.author.id) && !this.members.has(m.author.id)) unknown.add(m.author.id);
    }
    await Promise.all([...unknown].slice(0, 20).map((id) => this.getMember(id).catch(() => null)));
    return json({ messages: messages.reverse().map((m) => this.clientMessage(m)), hasMore: messages.length === 50 });
  }

  async readMessageInput(request) {
    const type = request.headers.get("Content-Type") || "";
    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const files = form.getAll("files").filter((f) => typeof f === "object" && f.size > 0);
      return { content: String(form.get("content") || ""), files };
    }
    const body = await request.json().catch(() => ({}));
    return { content: String(body.content || ""), files: [] };
  }

  async send(channelId, request, member) {
    const { content, files } = await this.readMessageInput(request);
    const text = content.trim();
    if (!text && !files.length) return error(400, "empty", "消息是空的");
    if (Array.from(text).length > MAX_CONTENT) return error(400, "too_long", `消息不能超过 ${MAX_CONTENT} 字`);
    if (files.length > 10) return error(400, "too_many_files", "一次最多 10 个文件");
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD_BYTES) return error(413, "too_large", "文件总大小不能超过 10MB");

    const profile = this.profileOf(member);
    const payload = {
      content: text,
      username: webhookUsername(profile.name),
      avatar_url: profile.avatar,
      allowed_mentions: { parse: ["users", "roles"] },
    };
    const message = await this.withWebhook(channelId, ({ id, token }) => {
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
      channelId,
      profile.id,
      Date.now(),
    );
    const result = this.clientMessage(message);
    this.broadcast(channelId, { type: "upsert", message: result });
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
    const { id, token } = await this.getWebhook(channelId);
    const message = await discordRequest(this.env, `/webhooks/${id}/${token}/messages/${messageId}`, {
      method: "PATCH",
      json: { content: text, allowed_mentions: { parse: ["users", "roles"] } },
      auth: null,
    });
    const result = this.clientMessage(message);
    this.broadcast(channelId, { type: "upsert", message: result });
    return json({ message: result });
  }

  async remove(channelId, messageId, userId) {
    const denied = this.checkOwner(messageId, userId);
    if (denied) return denied;
    try {
      const { id, token } = await this.getWebhook(channelId);
      await discordRequest(this.env, `/webhooks/${id}/${token}/messages/${messageId}`, { method: "DELETE", auth: null });
    } catch (e) {
      // Already gone (deleted in Discord, by a moderator, or with its webhook)
      if (!(e instanceof DiscordError && e.status === 404)) throw e;
    }
    this.sql.exec("DELETE FROM sent WHERE message_id = ?", messageId);
    this.broadcast(channelId, { type: "delete", ids: [messageId] });
    return json({ ok: true });
  }
}
