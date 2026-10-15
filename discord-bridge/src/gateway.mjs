// Minimal Discord Gateway client: identify/resume, heartbeats, reconnects.
// Only runs while someone has the chat open; the Durable Object starts and stops it.
export const GATEWAY_URL = "wss://gateway.discord.gg";
const QUERY = "?v=10&encoding=json";
// GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT (privileged, enable it in the Developer Portal)
export const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);
// Close codes that will not get better by reconnecting (bad token, bad intents, ...)
export const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
// Close codes after which the session cannot be resumed
const NEW_SESSION_CODES = new Set([4007, 4009]);

/** Opens an outbound WebSocket from a Worker / Durable Object */
export async function workersConnect(url) {
  const response = await fetch(url.replace(/^ws(s?):/, "http$1:"), { headers: { Upgrade: "websocket" } });
  const socket = response.webSocket;
  if (!socket) throw new Error(`Gateway upgrade failed: ${response.status}`);
  socket.accept();
  return socket;
}

export class GatewayClient {
  constructor({ token, gatewayUrl = GATEWAY_URL, intents = INTENTS, connect = workersConnect, onDispatch, onStatus, timers = globalThis, random = Math.random }) {
    this.token = token;
    this.gatewayUrl = gatewayUrl;
    this.intents = intents;
    this.connect = connect;
    this.onDispatch = onDispatch || (() => {});
    this.onStatus = onStatus || (() => {});
    this.timers = timers;
    this.random = random;
    this.running = false;
    this.state = "idle";
    this.socket = null;
    this.generation = 0;
    this.seq = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.acked = true;
    this.failures = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#open();
  }

  stop() {
    this.running = false;
    this.generation++;
    this.#clearTimers();
    // Code 1000 ends the session on Discord's side; start() will identify again
    this.#closeSocket(1000, "idle");
    this.seq = this.sessionId = this.resumeUrl = null;
    this.#setState("idle");
  }

  #setState(state, detail = {}) {
    this.state = state;
    this.onStatus(state, detail);
  }

  #clearTimers() {
    if (this.heartbeatTimer !== null) this.timers.clearTimeout(this.heartbeatTimer);
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = this.reconnectTimer = null;
  }

  #closeSocket(code, reason) {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close(code, reason);
    } catch {}
  }

  async #open() {
    const generation = ++this.generation;
    this.#setState("connecting");
    const resuming = !!(this.sessionId && this.resumeUrl && this.seq !== null);
    const url = (resuming ? this.resumeUrl : this.gatewayUrl).replace(/\/?(\?.*)?$/, "/") + QUERY;
    let socket;
    try {
      socket = await this.connect(url);
    } catch (error) {
      if (generation === this.generation) this.#scheduleReconnect({ resume: resuming, error });
      return;
    }
    if (generation !== this.generation || !this.running) {
      try {
        socket.close(1000, "stale");
      } catch {}
      return;
    }
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (generation === this.generation) this.#onMessage(event.data, resuming);
    });
    socket.addEventListener("close", (event) => {
      if (generation === this.generation) this.#onClose(event.code);
    });
    socket.addEventListener("error", () => {});
  }

  #send(payload) {
    try {
      this.socket?.send(JSON.stringify(payload));
    } catch {}
  }

  #onMessage(data, resuming) {
    let payload;
    try {
      payload = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }
    if (payload.s !== null && payload.s !== undefined) this.seq = payload.s;
    switch (payload.op) {
      case 10: {
        const interval = payload.d.heartbeat_interval;
        this.acked = true;
        this.#scheduleHeartbeat(interval * this.random(), interval);
        if (resuming && this.sessionId) {
          this.#send({ op: 6, d: { token: this.token, session_id: this.sessionId, seq: this.seq } });
        } else {
          this.#send({
            op: 2,
            d: {
              token: this.token,
              intents: this.intents,
              properties: { os: "linux", browser: "owlbear-discord-bridge", device: "owlbear-discord-bridge" },
            },
          });
        }
        break;
      }
      case 11:
        this.acked = true;
        break;
      case 1:
        this.#heartbeat();
        break;
      case 7:
        this.#reconnect({ resume: true, delay: 0 });
        break;
      case 9:
        // Not resumable: forget the session; Discord asks for a 1-5 s wait
        if (!payload.d) this.seq = this.sessionId = this.resumeUrl = null;
        this.#reconnect({ resume: !!payload.d, delay: 1000 + Math.floor(this.random() * 4000) });
        break;
      case 0:
        if (payload.t === "READY") {
          this.sessionId = payload.d.session_id;
          this.resumeUrl = payload.d.resume_gateway_url;
          this.failures = 0;
          this.#setState("ready", { resumed: false });
        } else if (payload.t === "RESUMED") {
          this.failures = 0;
          this.#setState("ready", { resumed: true });
        }
        this.onDispatch(payload.t, payload.d);
        break;
    }
  }

  #scheduleHeartbeat(firstDelay, interval) {
    if (this.heartbeatTimer !== null) this.timers.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = this.timers.setTimeout(() => {
      this.heartbeatTimer = null;
      if (!this.#heartbeat()) return;
      this.#scheduleHeartbeat(interval, interval);
    }, firstDelay);
  }

  /** Returns false when the previous beat was never acked (zombie connection) */
  #heartbeat() {
    if (!this.acked) {
      this.#reconnect({ resume: true, delay: 0 });
      return false;
    }
    this.acked = false;
    this.#send({ op: 1, d: this.seq });
    return true;
  }

  #onClose(code) {
    this.socket = null;
    if (!this.running) return;
    if (FATAL_CLOSE_CODES.has(code)) {
      this.running = false;
      this.generation++;
      this.#clearTimers();
      this.#setState("fatal", { code });
      return;
    }
    if (NEW_SESSION_CODES.has(code)) this.seq = this.sessionId = this.resumeUrl = null;
    this.#scheduleReconnect({ resume: true });
  }

  #reconnect({ resume, delay }) {
    this.generation++;
    this.#clearTimers();
    // Non-1000 close keeps the session resumable
    this.#closeSocket(4000, "reconnect");
    if (!resume) this.seq = this.sessionId = this.resumeUrl = null;
    this.#setState("connecting");
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) this.#open();
    }, delay);
  }

  #scheduleReconnect({ resume, error }) {
    this.failures++;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.failures - 1, 5));
    if (error) this.onStatus("connecting", { error: String(error?.message || error) });
    this.#reconnect({ resume, delay });
  }
}
