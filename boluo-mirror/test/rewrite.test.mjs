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

import { vttOrigins } from "../worker.mjs";
import { bridgeSource } from "../bridge.mjs";
test("dice bridge origins default to the map site", () => {
  assert.deepEqual(vttOrigins({}), ["https://vtt.pangbai.de"]);
  assert.deepEqual(vttOrigins({ VTT_ORIGINS: "https://a.test, http://localhost:3000" }), ["https://a.test", "http://localhost:3000"]);
});
test("dice bridge source is a self-contained script", () => {
  const src = bridgeSource(["https://vtt.pangbai.de"]);
  assert.match(src, /\(function vttBridge\(origins\)/);
  assert.match(src, /\["https:\/\/vtt\.pangbai\.de"\]\); \}\)\(\);$/);
  new Function(src); // parses
});

import { composeMode } from "../bridge.mjs";
test("compose box speaker modifiers, as Boluo reads them", () => {
  assert.deepEqual(composeMode(""), { inGame: null, as: null });
  assert.deepEqual(composeMode("hello"), { inGame: null, as: null });
  assert.deepEqual(composeMode(".out 你好"), { inGame: false, as: null });
  assert.deepEqual(composeMode("。in"), { inGame: true, as: null });
  assert.deepEqual(composeMode(".me .in 挥剑"), { inGame: true, as: null });
  assert.deepEqual(composeMode(".out .as 地精头目; 嘿"), { inGame: true, as: "地精头目" });
  assert.deepEqual(composeMode(".as @gob；"), { inGame: true, as: "@gob" });
  assert.deepEqual(composeMode(".as"), { inGame: true, as: "@" });
});
