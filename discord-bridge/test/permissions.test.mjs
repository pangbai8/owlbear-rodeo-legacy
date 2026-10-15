import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTACH_FILES, READ_MESSAGE_HISTORY, SEND_MESSAGES, VIEW_CHANNEL, channelAccess, channelPermissions } from "../src/permissions.mjs";

const G = "1000";
const PLAYER = "1500";
const MUTED = "1600";
const ADMIN = "1700";
const base = String(VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | ATTACH_FILES);
const guild = { id: G, ownerId: "1", roles: { [G]: base, [PLAYER]: "0", [MUTED]: "0", [ADMIN]: String(1n << 3n) } };
const access = (member, overwrites, userId = "111", now) => channelAccess(channelPermissions({ userId, member, guild, overwrites, now }));

test("non-members get nothing", () => {
  assert.deepEqual(access(null, []), { view: false, history: false, send: false, attach: false });
});

test("public channel: everyone can do everything @everyone can", () => {
  assert.deepEqual(access({ roles: [] }, []), { view: true, history: true, send: true, attach: true });
});

test("private channel: hidden from @everyone, allowed for a role", () => {
  const overwrites = [
    { type: 0, id: G, allow: "0", deny: String(VIEW_CHANNEL) },
    { type: 0, id: PLAYER, allow: String(VIEW_CHANNEL), deny: "0" },
  ];
  assert.equal(access({ roles: [] }, overwrites).view, false);
  assert.equal(access({ roles: [PLAYER] }, overwrites).send, true);
});

test("role deny beats @everyone allow, role allow beats role deny, member overwrite wins", () => {
  const overwrites = [
    { type: 0, id: MUTED, allow: "0", deny: String(SEND_MESSAGES) },
    { type: 0, id: PLAYER, allow: String(SEND_MESSAGES), deny: "0" },
  ];
  assert.equal(access({ roles: [MUTED] }, overwrites).send, false);
  assert.equal(access({ roles: [MUTED, PLAYER] }, overwrites).send, true);
  const withMember = [...overwrites, { type: 1, id: "111", allow: "0", deny: String(SEND_MESSAGES) }];
  assert.equal(access({ roles: [PLAYER] }, withMember).send, false);
  assert.equal(access({ roles: [PLAYER] }, withMember).view, true);
});

test("read-only channel and no attachments", () => {
  assert.deepEqual(access({ roles: [] }, [{ type: 0, id: G, allow: "0", deny: String(SEND_MESSAGES) }]), {
    view: true,
    history: true,
    send: false,
    attach: false,
  });
  assert.equal(access({ roles: [] }, [{ type: 0, id: G, allow: "0", deny: String(ATTACH_FILES) }]).attach, false);
});

test("view without history", () => {
  const a = access({ roles: [] }, [{ type: 0, id: G, allow: "0", deny: String(READ_MESSAGE_HISTORY) }]);
  assert.equal(a.view, true);
  assert.equal(a.history, false);
});

test("owner and administrators bypass overwrites", () => {
  const hidden = [{ type: 0, id: G, allow: "0", deny: String(VIEW_CHANNEL) }];
  assert.equal(access({ roles: [] }, hidden, "1").send, true);
  assert.equal(access({ roles: [ADMIN] }, hidden).send, true);
});

test("timed-out members can only read", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const member = { roles: [], communication_disabled_until: "2026-10-15T13:00:00Z" };
  assert.deepEqual(access(member, [], "111", now), { view: true, history: true, send: false, attach: false });
  assert.equal(access({ ...member, communication_disabled_until: "2026-10-15T11:00:00Z" }, [], "111", now).send, true);
});
