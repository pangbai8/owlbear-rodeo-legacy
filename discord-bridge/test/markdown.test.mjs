import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../public/markdown.js";

test("escapes html", () => {
  assert.equal(renderMarkdown(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("inline formatting", () => {
  assert.equal(renderMarkdown("**b** *i* __u__ ~~s~~ ||sp||"), '<strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <span class="spoiler" tabindex="0">sp</span>');
  assert.equal(renderMarkdown("snake_case_name"), "snake_case_name");
  assert.equal(renderMarkdown("2 * 3 * 4"), "2 * 3 * 4");
});

test("code is not formatted and is escaped", () => {
  assert.equal(renderMarkdown("`**x** <b>`"), "<code>**x** &lt;b&gt;</code>");
  assert.equal(renderMarkdown("```js\nconst a = '<x>';\n```"), '<pre class="code-block"><code>const a = &#39;&lt;x&gt;&#39;;</code></pre>');
});

test("links: only http(s), escaped, masked links", () => {
  assert.equal(
    renderMarkdown("see https://a.com/x?y=1&z=2."),
    'see <a href="https://a.com/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">https://a.com/x?y=1&amp;z=2</a>.',
  );
  assert.equal(
    renderMarkdown("[wiki](https://w.org)"),
    '<a href="https://w.org" target="_blank" rel="noopener noreferrer">wiki</a>',
  );
  assert.equal(renderMarkdown("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
  assert.ok(!renderMarkdown('https://a.com/"onmouseover=alert(1)').includes('"onmouseover'));
});

test("mentions, channels, roles, emoji", () => {
  const html = renderMarkdown("<@1> <@!2> <#3> <@&4> <:smile:5> <a:wave:6> @everyone", {
    users: { 1: "Alice" },
    channels: { 3: "general" },
    roles: { 4: { name: "GM", color: 0xff0000 } },
  });
  assert.ok(html.includes('<span class="mention">@Alice</span>'));
  assert.ok(html.includes('<span class="mention">@未知用户</span>'));
  assert.ok(html.includes('<span class="mention">#general</span>'));
  assert.ok(html.includes('style="--role-color:#ff0000">@GM</span>'));
  assert.ok(html.includes('src="https://cdn.discordapp.com/emojis/5.webp?size=48"'));
  assert.ok(html.includes('src="https://cdn.discordapp.com/emojis/6.gif?size=48"'));
  assert.ok(html.includes('<span class="mention">@everyone</span>'));
});

test("mention names are escaped", () => {
  assert.equal(renderMarkdown("<@1>", { users: { 1: "<b>x</b>" } }), '<span class="mention">@&lt;b&gt;x&lt;/b&gt;</span>');
});

test("block syntax and line breaks", () => {
  assert.equal(renderMarkdown("# Title\n> quote\n-# small\nline"), '<span class="h1">Title</span><br><span class="quote">quote</span><br><span class="subtext">small</span><br>line');
});

test("NUL characters cannot address held pieces", () => {
  assert.equal(renderMarkdown("`a` \u00000\u0000"), "<code>a</code> 0");
});

test("timestamps render", () => {
  assert.match(renderMarkdown("<t:0:d>"), /^<span class="timestamp">.+<\/span>$/);
});
