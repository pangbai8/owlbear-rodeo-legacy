// Party status panel storage (/party/ws). Runs against `npm run dev`; for the
// expiry test start it with a short lifetime:
//   npx wrangler dev --port 8787 --var PARTY_TTL_MS:3000
import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";

const base = process.env.TEST_BROKER || "http://127.0.0.1:8787";
const shortTtl = process.env.PARTY_SHORT_TTL === "1";

function open(path, room) {
  const ws = new WebSocket(`${base.replace("http", "ws")}${path}?room=${room}`, { origin: "http://localhost:3000" });
  const messages = [];
  const waiters = [];
  ws.on("message", (data) => {
    messages.push(JSON.parse(data));
    for (const check of [...waiters]) check();
  });
  const wait = (predicate, label) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        remove();
        reject(Error(`Timeout waiting for ${label}`));
      }, 5000);
      const remove = () => {
        clearTimeout(timer);
        const i = waiters.indexOf(check);
        if (i >= 0) waiters.splice(i, 1);
      };
      const check = () => {
        const i = messages.findIndex(predicate);
        if (i >= 0) {
          const m = messages.splice(i, 1)[0];
          remove();
          resolve(m);
        }
      };
      waiters.push(check);
      check();
    });
  const opened = new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  const closed = new Promise((resolve) => ws.on("close", (code) => resolve(code)));
  return { ws, messages, wait, opened, closed };
}

async function joinGame(room, password = "secret") {
  const game = open("/ws", room);
  await game.wait((m) => m.event === "hello", "hello");
  game.ws.send(JSON.stringify({ event: "join_game", args: [room, password] }));
  await game.wait((m) => m.event === "joined_game", "joined_game");
  return game;
}

async function panel(room, password = "secret") {
  const p = open("/party/ws", room);
  await p.opened;
  p.ws.send(JSON.stringify({ op: "auth", password }));
  let id = 0;
  p.request = (msg) => {
    const req = { ...msg, id: ++id };
    p.ws.send(JSON.stringify(req));
    return p.wait((m) => m.t === "ack" && m.id === req.id, `ack ${msg.op}`);
  };
  return p;
}

const newRoom = () => `party-${crypto.randomUUID()}`;

test("party panel needs the game's password", async () => {
  const room = newRoom();
  const early = await panel(room);
  assert.equal((await early.wait((m) => m.t === "error", "error")).code, "permission_denied");
  assert.equal(await early.closed, 1008);

  const game = await joinGame(room);
  const wrong = await panel(room, "nope");
  assert.equal((await wrong.wait((m) => m.t === "error", "error")).code, "permission_denied");
  assert.equal(await wrong.closed, 1008);

  const right = await panel(room);
  assert.deepEqual((await right.wait((m) => m.t === "ready", "ready")).docs, {});
  // Panel sockets are not players
  assert.equal(game.messages.some((m) => m.event === "player_joined"), false);
  for (const c of [game, right]) c.ws.close();
});

test("party documents sync live, persist, and stay inside their room", async () => {
  const room = newRoom();
  const game = await joinGame(room);
  const a = await panel(room);
  const b = await panel(room);
  await a.wait((m) => m.t === "ready", "ready a");
  await b.wait((m) => m.t === "ready", "ready b");

  const team = { name: "示例小队", created: 1, meta: { round: 2 } };
  assert.equal((await a.request({ op: "set", path: "teams/t1", data: team })).code, undefined);
  assert.deepEqual((await b.wait((m) => m.t === "change" && m.path === "teams/t1", "change on b")).data, team);
  assert.deepEqual((await a.wait((m) => m.t === "change" && m.path === "teams/t1", "echo on a")).data, team);

  const member = { name: "诺宁姆", hp: 27, maxHp: 27 };
  await a.request({ op: "set", path: "teams/t1/members/c1", data: member });
  await b.request({ op: "set", path: "teams/t1/members/c1", data: { ...member, hp: 12 } });
  assert.equal((await a.wait((m) => m.t === "change" && m.data?.hp === 12, "edit from b")).path, "teams/t1/members/c1");

  assert.equal((await a.request({ op: "set", path: "../evil", data: {} })).code, "invalid_argument");
  assert.equal((await a.request({ op: "set", path: "teams", data: {} })).code, "invalid_argument");
  assert.equal((await a.request({ op: "set", path: "teams/t2", data: [1] })).code, "invalid_argument");
  assert.equal((await a.request({ op: "set", path: "teams/t2", data: { big: "x".repeat(70 * 1024) } })).code, "quota_exceeded");

  await a.request({ op: "set", path: "classes/k1", data: { name: "炼金术士" } });
  await a.request({ op: "delete", path: "classes/k1" });
  assert.equal((await b.wait((m) => m.t === "change" && m.path === "classes/k1" && m.data === null, "delete on b")).data, null);

  // A later visitor gets everything; another room gets nothing
  const later = await panel(room);
  assert.deepEqual((await later.wait((m) => m.t === "ready", "ready later")).docs, {
    "teams/t1": team,
    "teams/t1/members/c1": { ...member, hp: 12 },
  });
  const otherRoom = newRoom();
  const otherGame = await joinGame(otherRoom);
  const other = await panel(otherRoom);
  assert.deepEqual((await other.wait((m) => m.t === "ready", "ready other")).docs, {});

  // Clearing the room's data reaches everyone
  await a.request({ op: "clear" });
  await b.wait((m) => m.t === "reset", "reset on b");
  const afterClear = await panel(room);
  assert.deepEqual((await afterClear.wait((m) => m.t === "ready", "ready after clear")).docs, {});

  for (const c of [game, a, b, later, otherGame, other, afterClear]) c.ws.close();
});

test("party data expires when nobody uses the panel", { skip: !shortTtl && "set PARTY_SHORT_TTL=1 with --var PARTY_TTL_MS:3000" }, async () => {
  const room = newRoom();
  const game = await joinGame(room);
  const a = await panel(room);
  await a.wait((m) => m.t === "ready", "ready");
  await a.request({ op: "set", path: "teams/t1", data: { name: "会过期的小队" } });
  // Using it again pushes the deadline back
  await new Promise((r) => setTimeout(r, 2000));
  await a.request({ op: "set", path: "teams/t1", data: { name: "还在用" } });
  await new Promise((r) => setTimeout(r, 2000));
  const stillThere = await panel(room);
  assert.deepEqual((await stillThere.wait((m) => m.t === "ready", "ready")).docs, { "teams/t1": { name: "还在用" } });
  stillThere.ws.close();
  // Then idle past the lifetime
  await a.wait((m) => m.t === "reset", "expiry reset");
  const after = await panel(room);
  assert.deepEqual((await after.wait((m) => m.t === "ready", "ready after expiry")).docs, {});
  for (const c of [game, a, after]) c.ws.close();
});
