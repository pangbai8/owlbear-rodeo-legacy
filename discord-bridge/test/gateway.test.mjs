import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayClient, INTENTS } from "../src/gateway.mjs";

class FakeTimers {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.pending = new Map();
  }
  setTimeout(fn, delay) {
    const id = this.nextId++;
    this.pending.set(id, { fn, at: this.now + delay });
    return id;
  }
  clearTimeout(id) {
    this.pending.delete(id);
  }
  async advance(ms) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
      await flush();
    }
    this.now = end;
  }
}

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.listeners = {};
    this.closed = null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close(code) {
    this.closed = code;
  }
  receive(payload) {
    for (const fn of this.listeners.message || []) fn({ data: JSON.stringify(payload) });
  }
  serverClose(code) {
    for (const fn of this.listeners.close || []) fn({ code });
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const timers = new FakeTimers();
  const sockets = [];
  const statuses = [];
  const dispatches = [];
  const client = new GatewayClient({
    token: "TOKEN",
    timers,
    random: () => 0.5,
    connect: async (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    onDispatch: (t, d) => dispatches.push([t, d]),
    onStatus: (state, detail) => statuses.push([state, detail]),
  });
  return { client, timers, sockets, statuses, dispatches };
}

async function ready(socket, { seq = 1 } = {}) {
  socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
  socket.receive({ op: 0, s: seq, t: "READY", d: { session_id: "S1", resume_gateway_url: "wss://resume.example" } });
  await flush();
}

test("identifies with intents after HELLO and reports ready", async () => {
  const { client, sockets, statuses } = setup();
  client.start();
  await flush();
  assert.equal(sockets[0].url, "wss://gateway.discord.gg/?v=10&encoding=json");
  await ready(sockets[0]);
  assert.deepEqual(sockets[0].sent[0], {
    op: 2,
    d: { token: "TOKEN", intents: INTENTS, properties: { os: "linux", browser: "owlbear-discord-bridge", device: "owlbear-discord-bridge" } },
  });
  assert.deepEqual(statuses.at(-1), ["ready", { resumed: false }]);
  assert.equal(client.sessionId, "S1");
});

test("forwards dispatches and heartbeats with the last sequence", async () => {
  const { client, timers, sockets, dispatches } = setup();
  client.start();
  await flush();
  await ready(sockets[0]);
  sockets[0].receive({ op: 0, s: 5, t: "MESSAGE_DELETE", d: { id: "9", channel_id: "1" } });
  assert.deepEqual(dispatches.at(-1), ["MESSAGE_DELETE", { id: "9", channel_id: "1" }]);
  await timers.advance(500); // first beat after interval * jitter
  assert.deepEqual(sockets[0].sent.at(-1), { op: 1, d: 5 });
  sockets[0].receive({ op: 11 });
  await timers.advance(1000);
  assert.deepEqual(sockets[0].sent.at(-1), { op: 1, d: 5 });
});

test("a missed heartbeat ack reconnects and resumes on the resume url", async () => {
  const { client, timers, sockets } = setup();
  client.start();
  await flush();
  await ready(sockets[0], { seq: 7 });
  await timers.advance(500); // beat, never acked
  await timers.advance(1000); // zombie -> reconnect
  assert.equal(sockets[0].closed, 4000);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].url, "wss://resume.example/?v=10&encoding=json");
  sockets[1].receive({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.deepEqual(sockets[1].sent[0], { op: 6, d: { token: "TOKEN", session_id: "S1", seq: 7 } });
});

test("op 7 reconnect resumes; RESUMED reports resumed", async () => {
  const { client, timers, sockets, statuses } = setup();
  client.start();
  await flush();
  await ready(sockets[0]);
  sockets[0].receive({ op: 7, d: null });
  await timers.advance(0);
  assert.equal(sockets.length, 2);
  sockets[1].receive({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(sockets[1].sent[0].op, 6);
  sockets[1].receive({ op: 0, s: 2, t: "RESUMED", d: {} });
  assert.deepEqual(statuses.at(-1), ["ready", { resumed: true }]);
});

test("non-resumable invalid session identifies again on the default url", async () => {
  const { client, timers, sockets } = setup();
  client.start();
  await flush();
  await ready(sockets[0]);
  sockets[0].receive({ op: 9, d: false });
  await timers.advance(5000);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].url, "wss://gateway.discord.gg/?v=10&encoding=json");
  sockets[1].receive({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.equal(sockets[1].sent[0].op, 2);
});

test("ordinary close reconnects with backoff, fatal close stops", async () => {
  const { client, timers, sockets, statuses } = setup();
  client.start();
  await flush();
  await ready(sockets[0]);
  sockets[0].serverClose(1006);
  await timers.advance(999);
  assert.equal(sockets.length, 1);
  await timers.advance(1);
  assert.equal(sockets.length, 2);
  sockets[1].serverClose(4014); // disallowed intents
  assert.deepEqual(statuses.at(-1), ["fatal", { code: 4014 }]);
  assert.equal(client.running, false);
  await timers.advance(60000);
  assert.equal(sockets.length, 2);
});

test("connect failures back off and retry", async () => {
  const { client, timers, statuses } = setup();
  let attempts = 0;
  client.connect = async () => {
    attempts++;
    throw new Error("boom");
  };
  client.start();
  await flush();
  assert.equal(attempts, 1);
  assert.equal(statuses.at(-1)[0], "connecting");
  await timers.advance(1000);
  assert.equal(attempts, 2);
  await timers.advance(2000);
  assert.equal(attempts, 3);
});

test("stop closes with 1000, forgets the session and ignores late events", async () => {
  const { client, timers, sockets, dispatches } = setup();
  client.start();
  await flush();
  await ready(sockets[0]);
  client.stop();
  assert.equal(sockets[0].closed, 1000);
  assert.equal(client.sessionId, null);
  sockets[0].receive({ op: 0, s: 3, t: "MESSAGE_CREATE", d: {} });
  sockets[0].serverClose(1000);
  await timers.advance(60000);
  assert.equal(dispatches.length, 1); // only READY
  assert.equal(sockets.length, 1);
  client.start();
  await flush();
  assert.equal(sockets.length, 2);
});
