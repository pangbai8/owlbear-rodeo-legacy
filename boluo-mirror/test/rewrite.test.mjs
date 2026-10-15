import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteSetCookie, rewriteLocation } from "../worker.mjs";

test("strips Domain and keeps SameSite/HttpOnly", () => {
  const out = rewriteSetCookie("session=abc; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=10368000; Domain=.boluochat.com");
  assert.equal(out, "session=abc; HttpOnly; SameSite=Lax; Path=/; Max-Age=10368000; Secure");
});
test("adds Secure when missing", () => {
  assert.equal(rewriteSetCookie("boluo-locale=zh-TW; Path=/; Domain=.boluochat.com"), "boluo-locale=zh-TW; Path=/; Secure");
});
test("rewrites boluochat redirects to the mirror", () => {
  assert.equal(rewriteLocation("https://app.boluochat.com/zh-TW/", "https://chat.pangbai.de"), "https://chat.pangbai.de/zh-TW/");
  assert.equal(rewriteLocation("/zh-TW/", "https://chat.pangbai.de"), "/zh-TW/");
  assert.equal(rewriteLocation("https://github.com/x", "https://chat.pangbai.de"), "https://github.com/x");
});
