import { DurableObject } from "cloudflare:workers";
import diff from "deep-diff";
import get from "lodash.get";

const iceServers = [
  { urls: "stun:stun.miwifi.com:3478" },
  { urls: "stun:stun.hitv.com:3478" },
];
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
    const room = url.searchParams.get("room");
    if (url.pathname !== "/ws" || !room || !/^[a-zA-Z0-9_-]{1,128}$/.test(room))
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
    server.serializeAttachment({
      id: crypto.randomUUID(),
      room: new URL(request.url).searchParams.get("room"),
      joined: false,
    });
    this.send(server, "hello", server.deserializeAttachment().id);
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, message) {
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
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      const hash = Array.from(
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
}
