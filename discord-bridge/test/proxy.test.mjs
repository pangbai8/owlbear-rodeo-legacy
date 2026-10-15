import { test } from "node:test";
import assert from "node:assert/strict";
import { characterDisplayName, fromTupperboxExport, matchProxy, normalizeCharacter } from "../public/proxy.js";

const norm = { name: "诺宁姆", nick: "", tag: "AC15 DC14 被察14", brackets: ["n:", ""], showBrackets: false };
const melt = { name: "梅尔特", brackets: ["m:", "", "[", "]"], showBrackets: false };
const longer = { name: "诺宁姆之影", brackets: ["nn:", ""], showBrackets: false };

test("display name joins nickname (or name) and tag", () => {
  assert.equal(characterDisplayName(norm), "诺宁姆 AC15 DC14 被察14");
  assert.equal(characterDisplayName({ name: "A", nick: "Alpha", tag: "" }), "Alpha");
  assert.equal(characterDisplayName({ name: "A" }), "A");
});

test("prefix brackets strip and trim", () => {
  assert.deepEqual(matchProxy("n: 你好", [norm]), { character: norm, content: "你好" });
  assert.equal(matchProxy("你好 n:", [norm]), null);
  assert.equal(matchProxy("N: 你好", [norm]), null); // case-sensitive like Tupperbox
});

test("full-width punctuation from an IME matches half-width brackets and vice versa", () => {
  assert.equal(matchProxy("n：你好", [norm]).content, "你好");
  const fullWidth = { ...norm, brackets: ["n：", ""] };
  assert.equal(matchProxy("n:你好", [fullWidth]).content, "你好");
  assert.equal(matchProxy("【你好】", [{ name: "x", brackets: ["【", "】"] }]).content, "你好");
});

test("prefix + suffix pairs and several pairs per character", () => {
  assert.equal(matchProxy("[挥剑]", [melt]).content, "挥剑");
  assert.equal(matchProxy("m:挥剑", [melt]).character, melt);
  assert.equal(matchProxy("[挥剑", [melt]), null);
});

test("longest brackets win", () => {
  assert.equal(matchProxy("nn: 影子说话", [norm, longer]).character, longer);
  assert.equal(matchProxy("n: 本人说话", [norm, longer]).character, norm);
});

test("show brackets keeps the original text", () => {
  assert.equal(matchProxy("n: 你好", [{ ...norm, showBrackets: true }]).content, "n: 你好");
});

test("bracket-only message yields empty content", () => {
  assert.equal(matchProxy("n:", [norm]).content, "");
});

test("normalizeCharacter validates", () => {
  assert.throws(() => normalizeCharacter({ name: "" }), /名字/);
  assert.throws(() => normalizeCharacter({ name: "a", avatarUrl: "javascript:alert(1)" }), /头像/);
  assert.throws(() => normalizeCharacter({ name: "a", brackets: ["x"] }), /成对/);
  assert.throws(() => normalizeCharacter({ name: "a", tag: "x".repeat(80) }), /显示名/);
  assert.deepEqual(normalizeCharacter({ name: " a ", brackets: ["n:", "", " ", ""] }), {
    name: "a",
    nick: "",
    tag: "",
    avatarUrl: "",
    showBrackets: false,
    brackets: ["n:", ""],
  });
});

test("imports a Tupperbox export", () => {
  const characters = fromTupperboxExport({
    tuppers: [
      {
        id: 1,
        name: "诺宁姆",
        nick: null,
        tag: "AC15 DC14 被察14",
        avatar_url: "https://cdn.tupperbox.app/pfp/1/a.webp",
        brackets: ["n:", ""],
        show_brackets: false,
        posts: 657,
        description: "ignored",
        group_id: null,
      },
    ],
    groups: [],
  });
  assert.deepEqual(characters, [
    { name: "诺宁姆", nick: "", tag: "AC15 DC14 被察14", avatarUrl: "https://cdn.tupperbox.app/pfp/1/a.webp", showBrackets: false, brackets: ["n:", ""] },
  ]);
  assert.throws(() => fromTupperboxExport({ members: [] }), /tuppers/);
});
