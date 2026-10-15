import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCookies, serializeCookie, signSession, verifySession } from "../src/session.mjs";

const SECRET = "test-secret";

test("signed sessions round-trip", async () => {
  const token = await signSession({ uid: "123", exp: Date.now() + 1000 }, SECRET);
  assert.equal((await verifySession(token, SECRET)).uid, "123");
});

test("rejects tampering, wrong secret, expiry and junk", async () => {
  const token = await signSession({ uid: "123", exp: Date.now() + 1000 }, SECRET);
  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ uid: "999", exp: Date.now() + 1000 })).toString("base64url");
  assert.equal(await verifySession(`${forged}.${signature}`, SECRET), null);
  assert.equal(await verifySession(`${body}.${signature}x`, SECRET), null);
  assert.equal(await verifySession(token, "other"), null);
  assert.equal(await verifySession(token, SECRET, Date.now() + 2000), null);
  assert.equal(await verifySession("nope", SECRET), null);
  assert.equal(await verifySession(undefined, SECRET), null);
  const badUid = await signSession({ uid: "abc", exp: Date.now() + 1000 }, SECRET);
  assert.equal(await verifySession(badUid, SECRET), null);
});

test("cookie helpers", () => {
  assert.deepEqual(parseCookies("a=1; db_session=x.y; a=2"), { a: "1", db_session: "x.y" });
  assert.deepEqual(parseCookies(null), {});
  assert.equal(serializeCookie("s", "v", { maxAge: 10 }), "s=v; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=10");
});
