// End-to-end smoke test against `npm run dev` + `node test/mock-discord.mjs`.
//   node test/e2e-smoke.mjs
import assert from "node:assert/strict";
import WebSocket from "ws";
import { signSession } from "../src/session.mjs";

const BRIDGE = process.env.BRIDGE || "http://localhost:8791";
const MOCK = process.env.MOCK || "http://127.0.0.1:8792/api";
const SECRET = process.env.SESSION_SECRET || "local-dev-session-secret-0123456789";
const CHANNEL = "2000";

const cookie = `db_session=${await signSession({ uid: "111", exp: Date.now() + 3600000 }, SECRET)}`;
const headers = { Cookie: cookie, Origin: BRIDGE };

async function call(method, path, body) {
  const response = await fetch(BRIDGE + path, {
    method,
    headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

const mock = (method, path, body) =>
  fetch(MOCK + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json().catch(() => null));

const events = [];
const waiters = [];
const ws = new WebSocket(`${BRIDGE.replace("http", "ws")}/ws?channel=${CHANNEL}`, { headers });
ws.on("message", (raw) => {
  const text = raw.toString();
  if (text === "pong") return;
  const event = JSON.parse(text);
  events.push(event);
  for (const waiter of [...waiters]) if (waiter.match(event)) {
    waiters.splice(waiters.indexOf(waiter), 1);
    waiter.resolve(event);
  }
});
function waitFor(match, label) {
  const found = events.find(match);
  if (found) {
    events.splice(events.indexOf(found), 1);
    return Promise.resolve(found);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 5000);
    waiters.push({ match, resolve: (e) => (clearTimeout(timer), resolve(e)) });
  });
}

await new Promise((resolve, reject) => (ws.on("open", resolve), ws.on("error", reject)));
await waitFor((e) => e.type === "status" && e.state === "ready", "gateway ready");
console.log("ok  gateway ready");

// Rejections
assert.equal((await fetch(`${BRIDGE}/api/me`)).status, 401);
assert.equal((await fetch(`${BRIDGE}/api/channels/${CHANNEL}/messages`, { method: "POST", headers: { Cookie: cookie } })).status, 403);
assert.equal((await call("GET", "/api/channels/9999/messages")).status, 404);
const outsider = `db_session=${await signSession({ uid: "999", exp: Date.now() + 3600000 }, SECRET)}`;
assert.equal((await fetch(`${BRIDGE}/api/me`, { headers: { Cookie: outsider } })).status, 403);
console.log("ok  unauthenticated / cross-origin / non-member requests rejected");

// Web -> Discord
const sent = await call("POST", `/api/channels/${CHANNEL}/messages`, { content: "掷骰 **1d20** = 17" });
assert.equal(sent.status, 200);
assert.equal(sent.data.message.author.name, "GM 胖白");
assert.equal(sent.data.message.ownerId, "111");
const id = sent.data.message.id;
await waitFor((e) => e.type === "upsert" && e.message.id === id, "own message echo");
console.log("ok  web message sent through webhook with the Discord name");

const edited = await call("PATCH", `/api/channels/${CHANNEL}/messages/${id}`, { content: "掷骰 **1d20** = 18" });
assert.equal(edited.status, 200);
await waitFor((e) => e.type === "upsert" && e.message.id === id && e.message.content.endsWith("18") && e.message.editedTimestamp, "edit");
console.log("ok  web edit synced");

const removed = await call("DELETE", `/api/channels/${CHANNEL}/messages/${id}`);
assert.equal(removed.status, 200);
await waitFor((e) => e.type === "delete" && e.ids.includes(id), "delete");
console.log("ok  web delete synced");

const history = await call("GET", `/api/channels/${CHANNEL}/messages`);
assert.equal(history.data.messages[0].author.name, "Bob the DM");
console.log("ok  history shows server nicknames");

const form = new FormData();
form.set("content", "地图");
form.append("files", new File([new Uint8Array(1024)], "map.png", { type: "image/png" }));
const uploadResponse = await fetch(`${BRIDGE}/api/channels/${CHANNEL}/messages`, { method: "POST", headers, body: form });
const upload = await uploadResponse.json();
assert.equal(uploadResponse.status, 200);
assert.equal(upload.message.attachments[0].filename, "map.png");
assert.equal(upload.message.attachments[0].size, 1024);
const big = new FormData();
big.append("files", new File([new Uint8Array(11 * 1024 * 1024)], "big.bin"));
assert.equal((await fetch(`${BRIDGE}/api/channels/${CHANNEL}/messages`, { method: "POST", headers, body: big })).status, 413);
await call("DELETE", `/api/channels/${CHANNEL}/messages/${upload.message.id}`);
console.log("ok  file upload (and the 10MB limit)");

// Discord -> web
const discordMessage = await mock("POST", "/_test/messages", { content: "来自 Discord 的消息", nick: "Bob the DM" });
const created = await waitFor((e) => e.type === "upsert" && e.message.id === discordMessage.id, "discord create");
assert.equal(created.message.author.name, "Bob the DM");
assert.equal(created.message.ownerId, null);
console.log("ok  Discord message pushed live");

await mock("POST", `/_test/messages/${discordMessage.id}`, { content: "改过了" });
await waitFor((e) => e.type === "upsert" && e.message.id === discordMessage.id && e.message.content === "改过了", "discord edit");
console.log("ok  Discord edit pushed live");

assert.equal((await call("PATCH", `/api/channels/${CHANNEL}/messages/${discordMessage.id}`, { content: "hack" })).status, 403);
assert.equal((await call("DELETE", `/api/channels/${CHANNEL}/messages/${discordMessage.id}`)).status, 403);
console.log("ok  cannot edit/delete other people's messages");

await mock("DELETE", `/_test/messages/${discordMessage.id}`);
await waitFor((e) => e.type === "delete" && e.ids.includes(discordMessage.id), "discord delete");
console.log("ok  Discord delete pushed live");

ws.close();
console.log("all good");
process.exit(0);
