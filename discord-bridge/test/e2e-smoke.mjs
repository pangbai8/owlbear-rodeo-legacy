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
assert.equal((await call("GET", "/api/channels/9999/messages")).status, 403);
const outsider = `db_session=${await signSession({ uid: "999", exp: Date.now() + 3600000 }, SECRET)}`;
const outsiderMe = await fetch(`${BRIDGE}/api/me`, { headers: { Cookie: outsider } });
assert.equal(outsiderMe.status, 403);
assert.equal((await outsiderMe.json()).error, "not_member");
console.log("ok  unauthenticated / cross-origin / non-member requests rejected");

// Several servers and Discord channel permissions
const me = await call("GET", "/api/me");
// Listed automatically, uncategorised channels first and then by category like
// Discord; 2001 is private, 2003 hidden from the bot, 2004 is voice, 111 is not in 1200
assert.deepEqual(
  me.data.channels.map((c) => [c.id, c.guildName, c.category, c.access.send]),
  [
    ["2002", "服务器 A", "", false],
    ["2000", "服务器 A", "跑团区", true],
    ["2100", "服务器 B", "", true],
    ["2101", "服务器 B", "", false],
  ],
);
assert.equal(me.data.channels.find((c) => c.id === "2101").access.botCannotPost, true);
assert.match((await call("POST", "/api/channels/2101/messages", { content: "x" })).data.message, /管理 Webhook/);
assert.equal((await call("GET", "/api/channels/2003/messages")).status, 403);
assert.equal((await call("GET", "/api/channels/2200/messages")).status, 403);
assert.equal(me.data.channels.find((c) => c.id === "2100").self.name, "B服的胖白");
assert.equal((await call("GET", "/api/channels/2001/messages")).status, 403);
assert.equal((await call("POST", "/api/channels/2002/messages", { content: "只读频道" })).status, 403);
const hidden = new WebSocket(`${BRIDGE.replace("http", "ws")}/ws?channel=2001`, { headers });
await new Promise((resolve) => {
  hidden.on("unexpected-response", (_, response) => {
    assert.equal(response.statusCode, 403);
    resolve();
  });
  hidden.on("open", () => assert.fail("opened a socket for a hidden channel"));
});
const bobCookie = `db_session=${await signSession({ uid: "222", exp: Date.now() + 3600000 }, SECRET)}`;
const bobMe = await fetch(`${BRIDGE}/api/me`, { headers: { Cookie: bobCookie } }).then((r) => r.json());
assert.deepEqual(bobMe.channels.map((c) => c.id), ["2001", "2002", "2000"]);
const bobSecret = await fetch(`${BRIDGE}/api/channels/2001/messages`, { headers: { Cookie: bobCookie } }).then((r) => r.json());
assert.equal(bobSecret.messages[0].content, "只有玩家身份组能看到的秘密");
const otherServer = await call("POST", "/api/channels/2100/messages", { content: "B 服发言" });
assert.equal(otherServer.status, 200);
assert.equal(otherServer.data.message.author.name, "B服的胖白");
await call("DELETE", `/api/channels/2100/messages/${otherServer.data.message.id}`);
console.log("ok  channels listed automatically across servers, following Discord and bot permissions");

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

// Characters (Tupperbox-style brackets)
const imported = await call("POST", "/api/characters/import", {
  tuppers: [{ name: "诺宁姆", nick: null, tag: "AC15 DC14 被察14", avatar_url: "https://cdn.tupperbox.app/pfp/1/a.webp", brackets: ["n:", ""], show_brackets: false }],
});
assert.equal(imported.status, 200);
assert.equal(imported.data.added + imported.data.updated, 1);
const norm = imported.data.characters.find((c) => c.name === "诺宁姆");
const proxied = await call("POST", `/api/channels/${CHANNEL}/messages`, { content: "n：我拔出了剑" });
assert.equal(proxied.status, 200);
assert.equal(proxied.data.message.author.name, "诺宁姆 AC15 DC14 被察14");
assert.equal(proxied.data.message.content, "我拔出了剑");
assert.equal(proxied.data.message.ownerId, "111");
const picked = await call("POST", `/api/channels/${CHANNEL}/messages`, { content: "没有括号，用下拉框选的", characterId: norm.id });
assert.equal(picked.data.message.author.name, "诺宁姆 AC15 DC14 被察14");
const plain = await call("POST", `/api/channels/${CHANNEL}/messages`, { content: "我自己说话" });
assert.equal(plain.data.message.author.name, "GM 胖白");
assert.equal((await call("POST", `/api/channels/${CHANNEL}/messages`, { content: "n:" })).status, 400);
console.log("ok  brackets and picker send as the character (full-width colon too)");

const created2 = await call("POST", "/api/characters", { name: "梅尔特", tag: "18/13/15", brackets: ["[", "]"] });
assert.equal(created2.status, 200);
assert.equal((await call("POST", "/api/characters", { name: "" })).status, 400);
const renamed = await call("PUT", `/api/characters/${created2.data.character.id}`, { ...created2.data.character, nick: "梅尔特·梅尔汀" });
assert.equal(renamed.data.character.nick, "梅尔特·梅尔汀");
const bracketed = await call("POST", `/api/channels/${CHANNEL}/messages`, { content: "[挥剑]" });
assert.equal(bracketed.data.message.author.name, "梅尔特·梅尔汀 18/13/15");
const outsiderChars = await fetch(`${BRIDGE}/api/characters`, { headers: { Cookie: outsider } });
assert.equal(outsiderChars.status, 403);
console.log("ok  character create / update / validation");

const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
const upload2 = await fetch(`${BRIDGE}/api/avatars`, { method: "POST", headers: { ...headers, "Content-Type": "image/png" }, body: png });
const avatar = await upload2.json();
assert.equal(upload2.status, 200);
assert.match(avatar.url, /\/avatars\/[0-9a-f]{32}$/);
const publicAvatar = await fetch(avatar.url);
assert.equal(publicAvatar.status, 200);
assert.equal(publicAvatar.headers.get("Content-Type"), "image/png");
assert.equal((await publicAvatar.arrayBuffer()).byteLength, png.length);
assert.equal((await fetch(`${BRIDGE}/api/avatars`, { method: "POST", headers: { ...headers, "Content-Type": "text/html" }, body: "<b>" })).status, 400);
await call("PUT", `/api/characters/${created2.data.character.id}`, { ...renamed.data.character, avatarUrl: avatar.url });
await call("DELETE", `/api/characters/${created2.data.character.id}`);
assert.equal((await fetch(avatar.url)).status, 404); // unused uploads are cleaned up
console.log("ok  avatar upload, public avatar url, cleanup on delete");

// Context-menu commands delivered over the Gateway
async function interact(payload) {
  const sentInteraction = await mock("POST", "/_test/interactions", payload);
  for (let i = 0; i < 50; i++) {
    const response = await fetch(`${MOCK}/_test/interactions/${sentInteraction.id}`);
    if (response.ok) return response.json();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("no interaction callback");
}
const target = proxied.data.message;
const modal = await interact({
  type: 2,
  member: { user: { id: "111" } },
  data: { type: 3, name: "编辑（Owlbear）", target_id: target.id, resolved: { messages: { [target.id]: { id: target.id, channel_id: CHANNEL, content: target.content } } } },
});
assert.equal(modal.type, 9);
assert.equal(modal.data.components[0].components[0].value, "我拔出了剑");
const done = await interact({
  type: 5,
  member: { user: { id: "111" } },
  data: { custom_id: modal.data.custom_id, components: [{ type: 1, components: [{ type: 4, custom_id: "content", value: "我收起了剑" }] }] },
});
assert.equal(done.data.content, "已修改。");
await waitFor((e) => e.type === "upsert" && e.message.id === target.id && e.message.content === "我收起了剑", "context-menu edit");
const refused = await interact({
  type: 2,
  member: { user: { id: "222" } },
  data: { type: 3, name: "删除（Owlbear）", target_id: target.id, resolved: { messages: {} } },
});
assert.match(refused.data.content, /自己/);
const removedByMenu = await interact({
  type: 2,
  member: { user: { id: "111" } },
  data: { type: 3, name: "删除（Owlbear）", target_id: target.id, resolved: { messages: {} } },
});
assert.equal(removedByMenu.data.content, "已删除。");
await waitFor((e) => e.type === "delete" && e.ids.includes(target.id), "context-menu delete");
console.log("ok  right-click edit (modal) and delete, owner only");

for (const m of [picked, plain, bracketed]) await call("DELETE", `/api/channels/${CHANNEL}/messages/${m.data.message.id}`);

ws.close();
console.log("all good");
process.exit(0);
