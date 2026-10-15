// Local stand-in for the Discord REST API and Gateway, for trying the bridge
// end to end without a real bot:
//   node test/mock-discord.mjs            (listens on 8792)
//   .dev.vars: DISCORD_API_URL=http://127.0.0.1:8792/api
//              DISCORD_GATEWAY_URL=ws://127.0.0.1:8792/gateway
//              CHANNEL_IDS=2000,2001,2002,2100,2999
// Two servers: 1000 has a public channel (2000), a private one only role 1500
// can see (2001) and a read-only one (2002); 1100 has 2100. User 111 is in both
// servers without role 1500; user 222 is only in 1000, with role 1500. The bot
// cannot see 2999.
// Simulate activity on the Discord side with
//   POST /_test/messages        {"content": "...", "nick": "...", "channel": "2000"}
//   POST /_test/messages/:id    {"content": "..."}   (edit)
//   DELETE /_test/messages/:id
//   POST /_test/interactions    (an interaction delivered over the Gateway)
//   GET /_test/interactions/:id (the bridge's callback response)
//   POST /_test/members         {"guild": "1000", "user": "111", "roles": [...]}  (change roles)
import http from "node:http";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8792);
const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const ATTACH = 1n << 15n;
const HISTORY = 1n << 16n;
const EVERYONE_PERMS = String(VIEW | SEND | ATTACH | HISTORY);

export const MEMBER = { id: "111", username: "pangbai", global_name: "Pangbai", avatar: null, discriminator: "0" };
const OTHER = { id: "222", username: "bob", global_name: "Bob", avatar: null, discriminator: "0" };
const APPLICATION_ID = "4000";

const guilds = {
  1000: { id: "1000", name: "服务器 A", owner_id: "1", roles: [{ id: "1000", name: "@everyone", permissions: EVERYONE_PERMS, color: 0 }, { id: "1500", name: "玩家", permissions: "0", color: 0x3366ff }] },
  1100: { id: "1100", name: "服务器 B", owner_id: "1", roles: [{ id: "1100", name: "@everyone", permissions: EVERYONE_PERMS, color: 0 }] },
};
const channels = {
  2000: { id: "2000", guild_id: "1000", name: "跑团", type: 0, permission_overwrites: [] },
  2001: {
    id: "2001",
    guild_id: "1000",
    name: "私密",
    type: 0,
    permission_overwrites: [
      { id: "1000", type: 0, allow: "0", deny: String(VIEW) },
      { id: "1500", type: 0, allow: String(VIEW), deny: "0" },
    ],
  },
  2002: { id: "2002", guild_id: "1000", name: "公告", type: 0, permission_overwrites: [{ id: "1000", type: 0, allow: "0", deny: String(SEND) }] },
  2100: { id: "2100", guild_id: "1100", name: "B服跑团", type: 0, permission_overwrites: [] },
};
const members = {
  "1000:111": { user: MEMBER, nick: "GM 胖白", avatar: null, roles: [] },
  "1000:222": { user: OTHER, nick: "Bob the DM", avatar: null, roles: ["1500"] },
  "1100:111": { user: MEMBER, nick: "B服的胖白", avatar: null, roles: [] },
};

let nextId = 5000n;
const newId = () => String(nextId++);
const messages = new Map();
const webhooks = new Map(); // channel id -> webhook
const sockets = new Set();
const callbacks = new Map(); // interaction id -> response the bridge sent

function dispatch(t, d) {
  for (const ws of sockets) ws.send(JSON.stringify({ op: 0, s: ws.seq++, t, d }));
}

function addMessage(fields) {
  const message = {
    id: newId(),
    channel_id: "2000",
    type: 0,
    content: "",
    timestamp: new Date().toISOString(),
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [],
    ...fields,
  };
  messages.set(message.id, message);
  return message;
}

addMessage({ author: OTHER, content: "欢迎来到 **跑团** 频道！ <@111>", mentions: [MEMBER] });
addMessage({ channel_id: "2001", author: OTHER, content: "只有玩家身份组能看到的秘密" });
addMessage({ channel_id: "2100", author: MEMBER, content: "B 服的第一条消息" });

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

async function readBody(req) {
  const request = new Request("http://x", { method: req.method, headers: req.headers, body: Readable.toWeb(req), duplex: "half" });
  const type = req.headers["content-type"] || "";
  if (type.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const payload = JSON.parse(form.get("payload_json"));
    const files = [...form.entries()].filter(([key]) => key.startsWith("files["));
    payload.attachments = files.map(([, file]) => ({
      id: newId(),
      filename: file.name,
      size: file.size,
      url: `https://cdn.discordapp.com/attachments/x/x/${file.name}`,
      proxy_url: `https://media.discordapp.net/attachments/x/x/${file.name}`,
      content_type: file.type,
    }));
    return payload;
  }
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

const withGuild = (message) => ({ ...message, guild_id: channels[message.channel_id]?.guild_id });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname.replace(/^\/api/, "");
  let match;
  try {
    if (req.method === "GET" && (match = path.match(/^\/guilds\/(\d+)\/members\/(\d+)$/))) {
      const member = members[`${match[1]}:${match[2]}`];
      return member ? send(res, 200, member) : send(res, 404, { message: "Unknown Member", code: 10007 });
    }
    if (req.method === "GET" && (match = path.match(/^\/guilds\/(\d+)(\/roles|\/channels)?$/))) {
      const guild = guilds[match[1]];
      if (!guild) return send(res, 404, { message: "Unknown Guild", code: 10004 });
      if (match[2] === "/roles") return send(res, 200, guild.roles);
      if (match[2] === "/channels") return send(res, 200, Object.values(channels).filter((c) => c.guild_id === guild.id));
      return send(res, 200, { id: guild.id, name: guild.name, owner_id: guild.owner_id });
    }
    if (req.method === "GET" && (match = path.match(/^\/channels\/(\d+)$/))) {
      const channel = channels[match[1]];
      return channel ? send(res, 200, channel) : send(res, 403, { message: "Missing Access", code: 50001 });
    }
    if (req.method === "GET" && (match = path.match(/^\/channels\/(\d+)\/messages$/))) {
      const before = url.searchParams.get("before");
      const limit = Number(url.searchParams.get("limit") || 50);
      const list = [...messages.values()]
        .filter((m) => m.channel_id === match[1] && (!before || BigInt(m.id) < BigInt(before)))
        .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))
        .slice(0, limit);
      return send(res, 200, list);
    }
    if (req.method === "GET" && (match = path.match(/^\/channels\/\d+\/messages\/(\d+)$/))) {
      const message = messages.get(match[1]);
      return message ? send(res, 200, message) : send(res, 404, { code: 10008 });
    }
    if ((match = path.match(/^\/channels\/(\d+)\/webhooks$/))) {
      const channelId = match[1];
      if (req.method === "GET") return send(res, 200, webhooks.has(channelId) ? [webhooks.get(channelId)] : []);
      const webhook = { id: `30${channelId}`, token: `token-${channelId}`, name: "Owlbear Bridge", application_id: APPLICATION_ID, channel_id: channelId };
      webhooks.set(channelId, webhook);
      return send(res, 200, webhook);
    }
    if ((match = path.match(/^\/webhooks\/(\d+)\/([^/]+)(?:\/messages\/(\d+))?$/))) {
      const webhook = [...webhooks.values()].find((w) => w.id === match[1] && w.token === match[2]);
      if (!webhook) return send(res, 404, { message: "Unknown Webhook", code: 10015 });
      const id = match[3];
      if (req.method === "POST" && !id) {
        const body = await readBody(req);
        const message = addMessage({
          channel_id: webhook.channel_id,
          webhook_id: webhook.id,
          author: { id: webhook.id, username: body.username, avatar: null, bot: true },
          content: body.content || "",
          attachments: body.attachments || [],
        });
        dispatch("MESSAGE_CREATE", withGuild(message));
        return send(res, 200, message);
      }
      const message = messages.get(id);
      if (!message || message.webhook_id !== webhook.id) return send(res, 404, { message: "Unknown Message", code: 10008 });
      if (req.method === "PATCH") {
        const body = await readBody(req);
        Object.assign(message, { content: body.content, edited_timestamp: new Date().toISOString() });
        dispatch("MESSAGE_UPDATE", withGuild(message));
        return send(res, 200, message);
      }
      if (req.method === "DELETE") {
        messages.delete(id);
        dispatch("MESSAGE_DELETE", { id, channel_id: message.channel_id, guild_id: channels[message.channel_id].guild_id });
        return send(res, 204);
      }
    }

    if (req.method === "POST" && (match = path.match(/^\/interactions\/(\d+)\/([^/]+)\/callback$/))) {
      callbacks.set(match[1], await readBody(req));
      return send(res, 204);
    }

    // ---- test controls ----
    if (req.method === "POST" && path === "/_test/interactions") {
      const body = await readBody(req);
      const interaction = { id: newId(), token: "interaction-token", channel_id: "2000", guild_id: "1000", ...body };
      dispatch("INTERACTION_CREATE", interaction);
      return send(res, 200, interaction);
    }
    if (req.method === "GET" && (match = path.match(/^\/_test\/interactions\/(\d+)$/))) {
      return callbacks.has(match[1]) ? send(res, 200, callbacks.get(match[1])) : send(res, 404, {});
    }
    if (req.method === "POST" && path === "/_test/members") {
      const body = await readBody(req);
      members[`${body.guild}:${body.user}`].roles = body.roles;
      return send(res, 200, members[`${body.guild}:${body.user}`]);
    }
    if (req.method === "POST" && path === "/_test/messages") {
      const body = await readBody(req);
      const message = addMessage({ channel_id: body.channel || "2000", author: OTHER, content: body.content || "" });
      dispatch("MESSAGE_CREATE", withGuild({ ...message, member: { nick: body.nick ?? null } }));
      return send(res, 200, message);
    }
    if ((match = path.match(/^\/_test\/messages\/(\d+)$/))) {
      const message = messages.get(match[1]);
      if (!message) return send(res, 404, {});
      if (req.method === "DELETE") {
        messages.delete(message.id);
        dispatch("MESSAGE_DELETE", { id: message.id, channel_id: message.channel_id, guild_id: channels[message.channel_id].guild_id });
        return send(res, 204);
      }
      const body = await readBody(req);
      Object.assign(message, { content: body.content, edited_timestamp: new Date().toISOString() });
      dispatch("MESSAGE_UPDATE", withGuild(message));
      return send(res, 200, message);
    }
    send(res, 404, { message: `mock: no route ${req.method} ${path}` });
  } catch (error) {
    console.error(error);
    send(res, 500, { message: String(error) });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/gateway")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.seq = 1;
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 41250 } }));
    ws.on("message", (raw) => {
      const payload = JSON.parse(raw);
      if (payload.op === 1) ws.send(JSON.stringify({ op: 11 }));
      if (payload.op === 2) {
        sockets.add(ws);
        ws.send(JSON.stringify({ op: 0, s: ws.seq++, t: "READY", d: { session_id: "mock", resume_gateway_url: `ws://127.0.0.1:${PORT}/gateway` } }));
        console.log("gateway: identified, intents", payload.d.intents);
      }
      if (payload.op === 6) {
        sockets.add(ws);
        ws.send(JSON.stringify({ op: 0, s: ws.seq++, t: "RESUMED", d: {} }));
      }
    });
    ws.on("close", () => {
      sockets.delete(ws);
      console.log("gateway: closed");
    });
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock discord on http://127.0.0.1:${PORT}`));
