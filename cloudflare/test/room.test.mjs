import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";

const base = process.env.TEST_BROKER || "http://127.0.0.1:8787";
function peer(room) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?room=${room}`, {
    origin: "http://localhost:3000",
  });
  const messages = [];
  const waiters = [];
  ws.on("message", (data) => {
    const message = JSON.parse(data);
    messages.push(message);
    for (const done of [...waiters]) done();
  });
  const wait = (event, predicate = () => true) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        remove();
        reject(Error(`Timeout ${event}`));
      }, 5000);
      const remove = () => {
        clearTimeout(timer);
        const i = waiters.indexOf(check);
        if (i >= 0) waiters.splice(i, 1);
      };
      const check = () => {
        const i = messages.findIndex(
          (m) => m.event === event && predicate(...m.args),
        );
        if (i >= 0) {
          const m = messages.splice(i, 1)[0];
          remove();
          resolve(m.args[0]);
        }
      };
      waiters.push(check);
      check();
    });
  return {
    ws,
    messages,
    wait,
    send: (event, ...args) => ws.send(JSON.stringify({ event, args })),
    async join(password = "secret") {
      const id = await wait("hello");
      this.send("join_game", room, password);
      await wait("joined_game");
      return id;
    },
  };
}

test("Cloudflare room: auth, sync, partial updates, isolation, persistence, disconnect", async () => {
  const room = `test-${crypto.randomUUID()}`;
  const clients = [];
  const create = (r = room) => {
    const p = peer(r);
    clients.push(p);
    return p;
  };
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal(
      (
        await fetch(`${base}/iceservers`, {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const a = create();
    const aid = await a.join();
    const wrong = create();
    await wrong.wait("hello");
    wrong.send("join_game", room, "wrong");
    await wrong.wait("auth_error");
    const b = create();
    const bid = await b.join();
    assert.equal(await a.wait("player_joined"), bid);
    a.send("player_state", { name: "Alice" });
    assert.equal(
      (await b.wait("party_state", (p) => p[aid]?.name === "Alice"))[aid].name,
      "Alice",
    );
    a.send("map", { id: "map-1" });
    assert.deepEqual(await b.wait("map", (m) => m?.id === "map-1"), {
      id: "map-1",
    });
    a.send("map_state", { mapId: "map-1", tokens: { x: 1 } });
    await b.wait("map_state", (s) => s?.mapId === "map-1");
    a.send("map_state_update", {
      id: "map-1",
      changes: [{ kind: "E", path: ["tokens", "x"], lhs: 1, rhs: 2 }],
    });
    await b.wait("map_state_update");
    a.send("manifest", { mapId: "map-1", tokens: [] });
    await b.wait("manifest", (m) => m?.mapId === "map-1");
    a.send(
      "signal",
      JSON.stringify({ to: bid, signal: { type: "offer", sdp: "test" } }),
    );
    assert.equal((await b.wait("signal")).from, aid);
    const other = create(`other-${crypto.randomUUID()}`);
    const oid = await other.join();
    a.send(
      "signal",
      JSON.stringify({ to: oid, signal: { sdp: "must-not-arrive" } }),
    );
    a.send("map_state_update", {
      id: "map-1",
      changes: [{ kind: "N", path: ["__proto__", "polluted"], rhs: true }],
    });
    await a.wait("protocol_error");
    const late = create();
    await late.join();
    assert.equal(
      (await late.wait("map_state", (s) => s?.mapId === "map-1")).tokens.x,
      2,
    );
    assert.equal(
      other.messages.some((m) => m.event === "signal"),
      false,
    );
    const left = b.wait("player_left", (id) => id === aid);
    a.ws.close();
    assert.equal(await left, aid);
    console.log(
      "PASS health, CORS, correct/wrong password, party, map, map-state diff, manifest, signalling, cross-room isolation, unsafe diff rejection, late join, disconnect",
    );
  } finally {
    for (const p of clients) p.ws.close();
  }
});
