// Character ("tupper") helpers shared by the page and the Worker:
// bracket matching, display names and Tupperbox import.

export const MAX_CHARACTERS = 100;
export const MAX_NAME = 80;
export const MAX_BRACKET = 50;
export const MAX_BRACKET_PAIRS = 10;

// Full-width ASCII (as typed with a Chinese IME, e.g. "n：") matches half-width;
// one character maps to one character, so lengths stay comparable
function fold(text) {
  return text.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

/** "诺宁姆" + "AC15 DC14 被察14" -> "诺宁姆 AC15 DC14 被察14" */
export function characterDisplayName(character) {
  const base = (character.nick || "").trim() || character.name;
  const tag = (character.tag || "").trim();
  return tag ? `${base} ${tag}` : base;
}

/**
 * Finds the character whose brackets wrap the message (longest brackets win,
 * like Tupperbox). Returns { character, content } or null.
 */
export function matchProxy(content, characters) {
  const text = String(content || "");
  const folded = fold(text);
  let best = null;
  for (const character of characters || []) {
    const brackets = character.brackets || [];
    for (let i = 0; i + 1 < brackets.length; i += 2) {
      const prefix = fold(brackets[i] || "");
      const suffix = fold(brackets[i + 1] || "");
      if (!prefix && !suffix) continue;
      if (folded.length < prefix.length + suffix.length) continue;
      if (!folded.startsWith(prefix) || !folded.endsWith(suffix)) continue;
      const length = prefix.length + suffix.length;
      if (best && best.length >= length) continue;
      best = { character, length, inner: text.slice(prefix.length, text.length - suffix.length) };
    }
  }
  if (!best) return null;
  return { character: best.character, content: best.character.showBrackets ? text : best.inner.trim() };
}

/** Checks and normalises a character from the settings form or an import. Throws on invalid input. */
export function normalizeCharacter(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("角色名字不能为空");
  if (Array.from(name).length > MAX_NAME) throw new Error(`名字不能超过 ${MAX_NAME} 个字`);
  const nick = String(input.nick || "").trim();
  const tag = String(input.tag || "").trim();
  const character = { name, nick, tag, avatarUrl: String(input.avatarUrl || "").trim(), showBrackets: !!input.showBrackets };
  if (Array.from(characterDisplayName(character)).length > MAX_NAME)
    throw new Error(`显示名加标签不能超过 ${MAX_NAME} 个字`);
  if (character.avatarUrl && !/^https?:\/\/\S+$/i.test(character.avatarUrl)) throw new Error("头像必须是 http(s) 链接");

  const raw = Array.isArray(input.brackets) ? input.brackets : [];
  if (raw.length % 2 !== 0) throw new Error("括号必须成对：前缀和后缀");
  const brackets = [];
  for (let i = 0; i < raw.length; i += 2) {
    const prefix = String(raw[i] ?? "");
    const suffix = String(raw[i + 1] ?? "");
    if (!prefix.trim() && !suffix.trim()) continue;
    if (prefix.length > MAX_BRACKET || suffix.length > MAX_BRACKET) throw new Error(`括号不能超过 ${MAX_BRACKET} 个字符`);
    brackets.push(prefix, suffix);
  }
  if (brackets.length / 2 > MAX_BRACKET_PAIRS) throw new Error(`每个角色最多 ${MAX_BRACKET_PAIRS} 组括号`);
  character.brackets = brackets;
  return character;
}

/** Reads a Tupperbox `tul!export` file ({ tuppers: [...] }) into characters */
export function fromTupperboxExport(data) {
  const tuppers = Array.isArray(data?.tuppers) ? data.tuppers : null;
  if (!tuppers) throw new Error("这不是 Tupperbox 导出的文件（缺少 tuppers）");
  return tuppers.map((t) =>
    normalizeCharacter({
      name: t.name,
      nick: t.nick,
      tag: t.tag,
      avatarUrl: t.avatar_url,
      brackets: t.brackets,
      showBrackets: t.show_brackets,
    }),
  );
}
