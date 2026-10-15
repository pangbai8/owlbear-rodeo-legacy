import { test } from "node:test";
import assert from "node:assert/strict";
import { DELETE_COMMAND, EDIT_COMMAND, handleInteraction, modalValue, verifyInteraction } from "../src/interactions.mjs";

const hex = (bytes) => Buffer.from(bytes).toString("hex");

test("verifies Discord's Ed25519 signatures", async () => {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = hex(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
  const body = '{"type":1}';
  const timestamp = "1700000000";
  const signature = hex(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, new TextEncoder().encode(timestamp + body))));
  assert.equal(await verifyInteraction(body, signature, timestamp, publicKey), true);
  assert.equal(await verifyInteraction(body + " ", signature, timestamp, publicKey), false);
  assert.equal(await verifyInteraction(body, signature, "1700000001", publicKey), false);
  assert.equal(await verifyInteraction(body, "zz", timestamp, publicKey), false);
  assert.equal(await verifyInteraction(body, signature, timestamp, undefined), false);
});

function fakeOps(owners = { 900: "111" }) {
  const calls = [];
  return {
    calls,
    ownerOf: (id) => owners[id] || null,
    edit: async (...args) => calls.push(["edit", ...args]),
    remove: async (...args) => calls.push(["remove", ...args]),
  };
}

const command = (name, userId = "111", target = "900") => ({
  type: 2,
  channel_id: "50",
  member: { user: { id: userId } },
  data: { type: 3, name, target_id: target, resolved: { messages: { [target]: { id: target, channel_id: "50", content: "旧内容" } } } },
});

test("PING answers PONG", async () => {
  assert.deepEqual(await handleInteraction({ type: 1 }, fakeOps()), { type: 1 });
});

test("edit command opens a modal prefilled with the message", async () => {
  const response = await handleInteraction(command(EDIT_COMMAND), fakeOps());
  assert.equal(response.type, 9);
  assert.equal(response.data.custom_id, "owlbear-edit:50:900");
  assert.equal(response.data.components[0].components[0].value, "旧内容");
});

test("edit modal falls back to reading the message when Discord omits its text", async () => {
  const ops = { ...fakeOps(), contentOf: async (channelId, messageId) => `text of ${channelId}/${messageId}` };
  const interaction = command(EDIT_COMMAND);
  interaction.data.resolved.messages["900"].content = "";
  const response = await handleInteraction(interaction, ops);
  assert.equal(response.data.components[0].components[0].value, "text of 50/900");
  delete interaction.data.resolved;
  const missing = await handleInteraction(interaction, ops);
  assert.equal(missing.data.components[0].components[0].value, "text of 50/900");
});

test("only the owner can edit or delete; foreign messages are refused", async () => {
  const ops = fakeOps();
  const notOwner = await handleInteraction(command(EDIT_COMMAND, "222"), ops);
  assert.equal(notOwner.type, 4);
  assert.equal(notOwner.data.flags, 64);
  assert.match(notOwner.data.content, /自己/);
  const foreign = await handleInteraction(command(DELETE_COMMAND, "111", "901"), ops);
  assert.match(foreign.data.content, /不是从 Owlbear/);
  assert.deepEqual(ops.calls, []);
});

test("delete command deletes through the bridge", async () => {
  const ops = fakeOps();
  const response = await handleInteraction(command(DELETE_COMMAND), ops);
  assert.deepEqual(ops.calls, [["remove", "50", "900"]]);
  assert.equal(response.data.content, "已删除。");
});

test("modal submit edits (classic rows and label components)", async () => {
  const ops = fakeOps();
  const submit = (components, userId = "111") => ({
    type: 5,
    member: { user: { id: userId } },
    data: { custom_id: "owlbear-edit:50:900", components },
  });
  await handleInteraction(submit([{ type: 1, components: [{ type: 4, custom_id: "content", value: " 新内容 " }] }]), ops);
  await handleInteraction(submit([{ type: 18, component: { type: 4, custom_id: "content", value: "第二次" } }]), ops);
  assert.deepEqual(ops.calls, [
    ["edit", "50", "900", "新内容"],
    ["edit", "50", "900", "第二次"],
  ]);
  const empty = await handleInteraction(submit([{ type: 1, components: [{ type: 4, custom_id: "content", value: "  " }] }]), ops);
  assert.match(empty.data.content, /不能为空/);
  const stranger = await handleInteraction(submit([{ type: 1, components: [{ type: 4, custom_id: "content", value: "x" }] }], "222"), ops);
  assert.match(stranger.data.content, /自己/);
  assert.equal(ops.calls.length, 2);
});

test("errors become an ephemeral message", async () => {
  const ops = fakeOps();
  ops.remove = async () => {
    throw new Error("Discord API 403");
  };
  const response = await handleInteraction(command(DELETE_COMMAND), ops);
  assert.match(response.data.content, /出错了：Discord API 403/);
});

test("modalValue walks nested components", () => {
  assert.equal(modalValue([{ components: [{ custom_id: "a", value: "1" }] }], "a"), "1");
  assert.equal(modalValue([], "a"), undefined);
});
