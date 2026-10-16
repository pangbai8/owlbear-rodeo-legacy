import { DurableObject } from "cloudflare:workers";
import diff from "deep-diff";
import get from "lodash.get";

import { PARTY_TTL_MS, PartyError, PartyStore } from "./party.mjs";

const iceServers = [
  { urls: "stun:stun.miwifi.com:3478" },
  { urls: "stun:stun.hitv.com:3478" },
];
// PF2 creature art for tokens: the Huiji image CDN refuses other sites'
// referrers and sends no CORS headers, so the VTT reads it through here
const PF2_IMAGE_HOST = "https://huiji-thumb.huijistatic.com/pf2/uploads/";
const PF2_IMAGE_PATH =
  /^\/pf2img\/((?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/[^/?#]+(?:\/[^/?#]+)?)$/;

async function pf2Image(path) {
  const upstream = await fetch(PF2_IMAGE_HOST + path, {
    cf: { cacheEverything: true, cacheTtl: 30 * 86400 },
  });
  const type = upstream.headers.get("Content-Type") || "";
  if (!upstream.ok || !type.startsWith("image/"))
    return new Response("Not found", { status: 404 });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=2592000",
    },
  });
}

const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers });
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",");
    // Same-origin requests (frontend served by this Worker on any bound
    // hostname, e.g. a custom domain) are always allowed.
    if (origin && origin !== url.origin && !allowed.includes(origin))
      return new Response("Origin denied", { status: 403 });
    const cors = origin
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {};
    if (request.method === "OPTIONS")
      return new Response(null, { headers: cors });
    if (url.pathname === "/health")
      return json(
        {
          ok: true,
          transport: "durable-object-websocket",
          turn: !!(env.TURN_KEY_ID && env.TURN_API_TOKEN),
        },
        200,
        cors,
      );
    if (url.pathname === "/iceservers") return json({ iceServers }, 200, cors);
    const image = url.pathname.match(PF2_IMAGE_PATH);
    if (image && request.method === "GET") return pf2Image(image[1]);
    const room = url.searchParams.get("room");
    // /party/ws: the party status panel's shared data for this room
    if (
      !["/ws", "/party/ws"].includes(url.pathname) ||
      !room ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(room)
    )
      return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    // Serialize password creation and all subsequent writes, including across awaits.
    this.queue = Promise.resolve();
    this.partyStore = new PartyStore(ctx.storage.sql);
  }
  read(key) {
    const rows = [
      ...this.ctx.storage.sql.exec(
        "SELECT value FROM room_state WHERE key = ?",
        key,
      ),
    ];
    return rows.length ? JSON.parse(rows[0].value) : null;
  }
  write(key, value) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO room_state(key,value) VALUES (?,?)",
      key,
      JSON.stringify(value),
    );
  }
  peers() {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.deserializeAttachment()?.joined);
  }
  send(ws, event, ...args) {
    try {
      ws.send(JSON.stringify({ event, args }));
    } catch {}
  }
  broadcast(event, args, except) {
    for (const ws of this.peers())
      if (ws !== except) this.send(ws, event, ...args);
  }
  party() {
    return Object.fromEntries(
      this.peers()
        .map((ws) => {
          const a = ws.deserializeAttachment();
          return [a.id, this.read(`player:${a.id}`)];
        })
        .filter(([, p]) => p),
    );
  }
  async fetch(request) {
    if (this.ctx.getWebSockets().length >= 32)
      return new Response("Room full", { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    if (new URL(request.url).pathname === "/party/ws") {
      server.serializeAttachment({ party: true, authed: false });
      return new Response(null, { status: 101, webSocket: client });
    }
    server.serializeAttachment({
      id: crypto.randomUUID(),
      room: new URL(request.url).searchParams.get("room"),
      joined: false,
    });
    this.send(server, "hello", server.deserializeAttachment().id);
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, message) {
    if (ws.deserializeAttachment()?.party) {
      this.queue = this.queue
        .then(() => this.handleParty(ws, message))
        .catch(() => this.sendParty(ws, { t: "error", code: "invalid_argument" }));
      return this.queue;
    }
    this.queue = this.queue
      .then(() => this.handle(ws, message))
      .catch(() => this.send(ws, "protocol_error", "Invalid message"));
    return this.queue;
  }
  async handle(ws, message) {
    if (
      typeof message !== "string" ||
      new TextEncoder().encode(message).length > 1024 * 1024
    ) {
      ws.close(1009, "Message too large");
      return;
    }
    const { event, args } = JSON.parse(message);
    const a = ws.deserializeAttachment();
    if (!Array.isArray(args)) throw Error("args");
    if (event === "join_game") {
      if (a.joined) return;
      const [room, password] = args;
      if (
        room !== a.room ||
        typeof password !== "string" ||
        password.length > 256
      ) {
        this.send(ws, "auth_error");
        return;
      }
      let auth = this.read("auth");
      const salt = auth?.salt || crypto.randomUUID();
      const hash = await this.hashPassword(password, salt);
      if (auth && hash !== auth.hash) {
        this.send(ws, "auth_error");
        ws.close(1008, "Wrong password");
        return;
      }
      if (!auth) this.write("auth", { salt, hash });
      const wasJoined = a.joined;
      a.joined = true;
      ws.serializeAttachment(a);
      // Credentials are issued only after room authentication and never contain the API token.
      const servers = [...iceServers];
      if (this.env.TURN_KEY_ID && this.env.TURN_API_TOKEN) {
        try {
          const response = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_KEY_ID}/credentials/generate-ice-servers`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${this.env.TURN_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ ttl: 86400 }),
              signal: AbortSignal.timeout(5000),
            },
          );
          if (!response.ok) throw Error("TURN API");
          const data = await response.json();
          servers.push(
            ...(Array.isArray(data.iceServers)
              ? data.iceServers
              : [data.iceServers]),
          );
        } catch {
          this.send(ws, "turn_unavailable");
        }
      }
      this.send(ws, "ice_servers", servers);
      this.send(ws, "party_state", this.party());
      for (const name of ["map", "map_state", "manifest"])
        this.send(ws, name, this.read(name));
      if (!wasJoined) this.broadcast("player_joined", [a.id], ws);
      this.send(ws, "joined_game", a.id);
      return;
    }
    if (!a.joined) return;
    if (event === "signal") {
      const { to, signal } = JSON.parse(args[0]);
      const target = this.peers().find(
        (peer) => peer.deserializeAttachment().id === to,
      );
      if (target) this.send(target, "signal", { from: a.id, signal });
      return;
    }
    if (event === "player_state") {
      this.write(`player:${a.id}`, args[0]);
      this.broadcast("party_state", [this.party()], ws);
      return;
    }
    if (event === "player_pointer") {
      this.broadcast(event, args, ws);
      return;
    }
    if (["map", "map_state", "manifest"].includes(event)) {
      this.write(event, args[0] ?? null);
      this.broadcast(event, args, ws);
      return;
    }
    if (["map_state_update", "manifest_update"].includes(event)) {
      const field = event.replace("_update", "");
      const state = this.read(field);
      const update = args[0];
      if (
        !state ||
        update?.id !== state.mapId ||
        !Array.isArray(update.changes)
      )
        return;
      // Reject prototype traversal before applying legacy deep-diff operations.
      const unsafe = (change) =>
        (change.path || []).some((p) =>
          ["__proto__", "prototype", "constructor"].includes(String(p)),
        ) ||
        (change.item && unsafe(change.item));
      if (update.changes.some(unsafe)) throw Error("Unsafe path");
      for (const change of update.changes)
        if (
          !(change.path && ["E", "A"].includes(change.kind)) ||
          get(state, change.path) !== undefined
        )
          diff.applyChange(state, true, change);
      this.write(field, state);
      this.broadcast(event, args, ws);
    }
  }
  webSocketClose(ws, code = 1000, reason = "") {
    const a = ws.deserializeAttachment();
    if (a?.joined) {
      a.joined = false;
      ws.serializeAttachment(a);
      this.ctx.storage.sql.exec(
        "DELETE FROM room_state WHERE key = ?",
        `player:${a.id}`,
      );
      this.broadcast("player_left", [a.id], ws);
      this.broadcast("party_state", [this.party()], ws);
    }
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {}
  }
  webSocketError(ws) {
    this.webSocketClose(ws);
    try {
      ws.close(1011, "Connection error");
    } catch {}
  }
  async hashPassword(password, salt) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    return Array.from(
      new Uint8Array(
        await crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            salt: new TextEncoder().encode(salt),
            iterations: 10000,
            hash: "SHA-256",
          },
          key,
          256,
        ),
      ),
    ).join(",");
  }

  /* ---------- party status panel ---------- */

  sendParty(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch {}
  }
  broadcastParty(message) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.party && a.authed) this.sendParty(ws, message);
    }
  }
  /** Data expires 90 days after the panel was last used in this room */
  partyTtl() {
    // PARTY_TTL_MS is only set when testing locally
    return Number(this.env.PARTY_TTL_MS) || PARTY_TTL_MS;
  }
  async touchParty() {
    const now = Date.now();
    this.write("party_used", now);
    await this.ctx.storage.setAlarm(now + this.partyTtl());
  }
  async alarm() {
    const used = this.read("party_used");
    if (used === null) return;
    if (Date.now() - used < this.partyTtl()) {
      await this.ctx.storage.setAlarm(used + this.partyTtl());
      return;
    }
    this.partyStore.clear();
    this.ctx.storage.sql.exec("DELETE FROM room_state WHERE key = ?", "party_used");
    this.broadcastParty({ t: "reset" });
  }
  async handleParty(ws, message) {
    if (typeof message !== "string" || message.length > 256 * 1024) {
      ws.close(1009, "Message too large");
      return;
    }
    const msg = JSON.parse(message);
    const a = ws.deserializeAttachment();
    if (msg.op === "auth") {
      // Same password as the game; the room must have been joined at least once
      const auth = this.read("auth");
      const password = typeof msg.password === "string" ? msg.password.slice(0, 256) : "";
      if (!auth || (await this.hashPassword(password, auth.salt)) !== auth.hash) {
        this.sendParty(ws, { t: "error", code: "permission_denied" });
        ws.close(1008, "Wrong password");
        return;
      }
      a.authed = true;
      ws.serializeAttachment(a);
      await this.touchParty();
      this.sendParty(ws, { t: "ready", docs: this.partyStore.all() });
      return;
    }
    if (!a.authed) return;
    const ack = (error) => this.sendParty(ws, { t: "ack", id: msg.id, ...(error ? { code: error } : {}) });
    try {
      if (msg.op === "set") {
        const data = this.partyStore.set(msg.path, msg.data);
        this.broadcastParty({ t: "change", path: msg.path, data });
      } else if (msg.op === "delete") {
        this.partyStore.delete(msg.path);
        this.broadcastParty({ t: "change", path: msg.path, data: null });
      } else if (msg.op === "clear") {
        this.partyStore.clear();
        this.broadcastParty({ t: "reset" });
      } else {
        throw new PartyError("invalid_argument", "unknown op");
      }
      await this.touchParty();
      ack();
    } catch (e) {
      ack(e instanceof PartyError ? e.code : "unavailable");
    }
  }
}
