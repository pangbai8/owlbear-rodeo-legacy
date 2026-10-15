// Discord-flavoured markdown to safe HTML. Every piece of user text is escaped
// before any tag is added; tags only come from the fixed patterns below.

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TIME_STYLES = {
  t: { hour: "2-digit", minute: "2-digit" },
  T: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  d: { year: "numeric", month: "2-digit", day: "2-digit" },
  D: { year: "numeric", month: "long", day: "numeric" },
  f: { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" },
  F: { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" },
};

export function formatRelative(date, now = Date.now()) {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) || units[units.length - 1];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(seconds / size), unit);
}

function formatTimestamp(seconds, style) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  if (style === "R") return formatRelative(date);
  return date.toLocaleString(undefined, TIME_STYLES[style] || TIME_STYLES.f);
}

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;

/**
 * @param {string} text message content
 * @param {{ users?: Record<string,string>, roles?: Record<string,{name:string,color:number}>, channels?: Record<string,string> }} ctx
 */
export function renderMarkdown(text, ctx = {}) {
  const users = ctx.users || {};
  const roles = ctx.roles || {};
  const channels = ctx.channels || {};
  const slots = [];
  const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;

  // \u0000 marks held pieces below, so it may not appear in the input
  let source = String(text || "").replace(/\u0000/g, "");

  // Code first so nothing inside it is formatted
  source = source.replace(/```(?:([\w+-]{1,20})\n)?([\s\S]*?)```/g, (_, lang, code) =>
    hold(`<pre class="code-block"><code>${escapeHtml(code.replace(/^\n+|\n+$/g, ""))}</code></pre>`),
  );
  source = source.replace(/``([^`]+?)``|`([^`\n]+?)`/g, (_, a, b) => hold(`<code>${escapeHtml(a ?? b)}</code>`));

  // Masked links and bare links (only http/https)
  source = source.replace(/\[([^\]\n]{1,256})\]\(<?(https?:\/\/[^\s<>()"']+)>?\)/g, (match, label, href) =>
    SAFE_URL.test(href)
      ? hold(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`)
      : match,
  );
  source = source.replace(/<?(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])>?/g, (_, href) =>
    hold(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>`),
  );

  // Mentions, custom emoji, timestamps (raw text uses < >, so match before escaping)
  source = source.replace(/<@!?(\d+)>/g, (_, id) => hold(`<span class="mention">@${escapeHtml(users[id] || "未知用户")}</span>`));
  source = source.replace(/<@&(\d+)>/g, (_, id) => {
    const role = roles[id];
    const color = role?.color ? ` style="--role-color:#${role.color.toString(16).padStart(6, "0")}"` : "";
    return hold(`<span class="mention role"${color}>@${escapeHtml(role?.name || "未知身份组")}</span>`);
  });
  source = source.replace(/<#(\d+)>/g, (_, id) => hold(`<span class="mention">#${escapeHtml(channels[id] || "未知频道")}</span>`));
  source = source.replace(/<(a?):(\w{2,32}):(\d+)>/g, (_, animated, name, id) =>
    hold(
      `<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=48" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:">`,
    ),
  );
  source = source.replace(/<t:(-?\d{1,13})(?::([tTdDfFR]))?>/g, (match, seconds, style) => {
    const formatted = formatTimestamp(seconds, style);
    return formatted ? hold(`<span class="timestamp">${escapeHtml(formatted)}</span>`) : match;
  });
  source = source.replace(/@(everyone|here)\b/g, (_, who) => hold(`<span class="mention">@${who}</span>`));

  let html = escapeHtml(source);

  // Block-level: headings, subtext, quotes (per line)
  html = html
    .split("\n")
    .map((line) => {
      let match;
      if ((match = line.match(/^(#{1,3}) (.+)$/))) return `<span class="h${match[1].length}">${match[2]}</span>`;
      if ((match = line.match(/^-# (.+)$/))) return `<span class="subtext">${match[1]}</span>`;
      if ((match = line.match(/^&gt; ?(.*)$/))) return `<span class="quote">${match[1] || "&#8203;"}</span>`;
      return line;
    })
    .join("\n");

  // Inline formatting
  html = html
    .replace(/\*\*\*(.+?)\*\*\*/gs, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
    .replace(/__(.+?)__/gs, "<u>$1</u>")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/gs, "<s>$1</s>")
    .replace(/\|\|(.+?)\|\|/gs, '<span class="spoiler" tabindex="0">$1</span>');

  html = html.replace(/\n/g, "<br>");
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => slots[Number(index)]);
}
