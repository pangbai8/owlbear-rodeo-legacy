// Local stand-in for the Discord REST API and Gateway, for trying the bridge
// end to end without a real bot:
//   node test/mock-discord.mjs            (listens on 8792)
//   .dev.vars: DISCORD_API_URL=http://127.0.0.1:8792/api
//              DISCORD_GATEWAY_URL=ws://127.0.0.1:8792/gateway
// Simulate activity on the Discord side with
//   POST /_test/messages        {"content": "...", "author": "bob"}
//   POST /_test/messages/:id    {"content": "..."}   (edit)
//   DELETE /_test/messages/:id
//   POST /_test/interactions    (an interaction delivered over the Gateway)
//   GET /_test/interactions/:id (the bridge's callback response)
import http from "node:http";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8792);
export const GUILD = "1000";
export const CHANNEL = "2000";
export const MEMBER = { id: "111", username: "pangbai", global_name: "Pangbai", avatar: null, discriminator: "0" };
const OTHER = { id: "222", username: "bob", global_name: "Bob", avatar: null, discriminator: "0" };
const WEBHOOK = { id: "3000", token: "webhook-token", application_id: "4000" };

let nextId = 5000n;
const newId = () => String(nextId++);
const messages = new Map();
const sockets = new Set();
const callbacks = new Map(); // interaction id -> response the bridge sent

function dispatch(t, d) {
  for (const ws of sockets) ws.send(JSON.stringify({ op: 0, s: ws.seq++, t, d }));
}

function addMessage(fields) {
  const message = {
    id: newId(),
    channel_id: CHANNEL,
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

addMessage({ author: OTHER, member: { nick: null }, content: "欢迎来到 **跑团** 频道！ <@111>", mentions: [MEMBER] });

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
      url: `https://cdn.discordapp.com/attachments/${CHANNEL}/x/${file.name}`,
      proxy_url: `https://media.discordapp.net/attachments/${CHANNEL}/x/${file.name}`,
      content_type: file.type,
    }));
    return payload;
  }
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname.replace(/^\/api/, "");
  let match;
  try {
    if (req.method === "GET" && (match = path.match(/^\/guilds\/\d+\/members\/(\d+)$/))) {
      if (match[1] === MEMBER.id) return send(res, 200, { user: MEMBER, nick: "GM 胖白", avatar: null, roles: [] });
      if (match[1] === OTHER.id) return send(res, 200, { user: OTHER, nick: "Bob the DM", avatar: null, roles: [] });
      return send(res, 404, { message: "Unknown Member", code: 10007 });
    }
    if (req.method === "GET" && path === `/guilds/${GUILD}/channels`) return send(res, 200, [{ id: CHANNEL, name: "跑团" }]);
    if (req.method === "GET" && path === `/guilds/${GUILD}/roles`) return send(res, 200, []);
    if (req.method === "GET" && path === `/channels/${CHANNEL}/messages`) {
      const before = url.searchParams.get("before");
      const limit = Number(url.searchParams.get("limit") || 50);
      const list = [...messages.values()]
        .filter((m) => !before || BigInt(m.id) < BigInt(before))
        .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))
        .slice(0, limit);
      return send(res, 200, list);
    }
    if (req.method === "GET" && (match = path.match(/^\/channels\/\d+\/messages\/(\d+)$/))) {
      const message = messages.get(match[1]);
      return message ? send(res, 200, message) : send(res, 404, { code: 10008 });
    }
    if (path === `/channels/${CHANNEL}/webhooks`) return send(res, 200, req.method === "GET" ? [] : WEBHOOK);
    if ((match = path.match(/^\/webhooks\/(\d+)\/([^/]+)(?:\/messages\/(\d+))?$/))) {
      if (match[1] !== WEBHOOK.id || match[2] !== WEBHOOK.token) return send(res, 404, { message: "Unknown Webhook", code: 10015 });
      const id = match[3];
      if (req.method === "POST" && !id) {
        const body = await readBody(req);
        const message = addMessage({
          webhook_id: WEBHOOK.id,
          author: { id: WEBHOOK.id, username: body.username, avatar: null, bot: true },
          content: body.content || "",
          attachments: body.attachments || [],
        });
        dispatch("MESSAGE_CREATE", message);
        return send(res, 200, message);
      }
      const message = messages.get(id);
      if (!message || message.webhook_id !== WEBHOOK.id) return send(res, 404, { message: "Unknown Message", code: 10008 });
      if (req.method === "PATCH") {
        const body = await readBody(req);
        Object.assign(message, { content: body.content, edited_timestamp: new Date().toISOString() });
        dispatch("MESSAGE_UPDATE", message);
        return send(res, 200, message);
      }
      if (req.method === "DELETE") {
        messages.delete(id);
        dispatch("MESSAGE_DELETE", { id, channel_id: CHANNEL });
        return send(res, 204);
      }
    }

    if (req.method === "POST" && (match = path.match(/^\/interactions\/(\d+)\/([^/]+)\/callback$/))) {
      callbacks.set(match[1], await readBody(req));
      return send(res, 204);
    }

    // ---- test controls: activity from regular Discord users ----
    if (req.method === "POST" && path === "/_test/interactions") {
      const body = await readBody(req);
      const interaction = { id: newId(), token: "interaction-token", channel_id: CHANNEL, ...body };
      dispatch("INTERACTION_CREATE", interaction);
      return send(res, 200, interaction);
    }
    if (req.method === "GET" && (match = path.match(/^\/_test\/interactions\/(\d+)$/))) {
      return callbacks.has(match[1]) ? send(res, 200, callbacks.get(match[1])) : send(res, 404, {});
    }
    if (req.method === "POST" && path === "/_test/messages") {
      const body = await readBody(req);
      const message = addMessage({ author: OTHER, member: { nick: body.nick ?? null }, content: body.content || "" });
      dispatch("MESSAGE_CREATE", message);
      return send(res, 200, message);
    }
    if ((match = path.match(/^\/_test\/messages\/(\d+)$/))) {
      const message = messages.get(match[1]);
      if (!message) return send(res, 404, {});
      if (req.method === "DELETE") {
        messages.delete(message.id);
        dispatch("MESSAGE_DELETE", { id: message.id, channel_id: CHANNEL });
        return send(res, 204);
      }
      const body = await readBody(req);
      Object.assign(message, { content: body.content, edited_timestamp: new Date().toISOString() });
      dispatch("MESSAGE_UPDATE", message);
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
