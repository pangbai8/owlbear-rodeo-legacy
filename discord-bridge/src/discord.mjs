// Discord REST helpers and the message shape sent to the browser.
export const API = "https://discord.com/api/v10";
export const CDN = "https://cdn.discordapp.com";
const USER_AGENT = "DiscordBot (https://github.com/pangbai8/owlbear-rodeo-legacy, 1.0)";

export class DiscordError extends Error {
  constructor(status, body) {
    super(`Discord API ${status}: ${body?.message || "request failed"}`);
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }
}

/**
 * Calls the Discord API. `auth` is "bot", a full Authorization header value,
 * or null (webhook URLs carry their own token). Retries once on a short 429.
 */
export async function discordRequest(env, path, { method = "GET", json, body, auth = "bot", fetchImpl = fetch } = {}) {
  const headers = { "User-Agent": USER_AGENT };
  if (auth === "bot") headers.Authorization = `Bot ${env.DISCORD_BOT_TOKEN}`;
  else if (auth) headers.Authorization = auth;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(path.startsWith("https://") ? path : (env.DISCORD_API_URL || API) + path, { method, headers, body });
    if (response.status === 429 && attempt === 0) {
      const data = await response.json().catch(() => ({}));
      const wait = Number(data.retry_after ?? response.headers.get("Retry-After") ?? 1);
      if (wait <= 5) {
        await new Promise((resolve) => setTimeout(resolve, wait * 1000 + 50));
        continue;
      }
      throw new DiscordError(429, data);
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new DiscordError(response.status, data);
    return data;
  }
}

export function readConfig(env) {
  const list = (value) =>
    String(value || "")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  return {
    channelIds: list(env.CHANNEL_IDS),
    allowedRoleIds: list(env.ALLOWED_ROLE_IDS),
    clientId: String(env.DISCORD_CLIENT_ID || "").trim(),
    frameAncestors: list(env.FRAME_ANCESTORS),
  };
}

export function displayName(user, member) {
  return member?.nick || user?.global_name || user?.username || "Unknown";
}

export function defaultAvatarUrl(user) {
  const legacy = user?.discriminator && user.discriminator !== "0";
  const index = legacy ? Number(user.discriminator) % 5 : Number((BigInt(user?.id || "0") >> 22n) % 6n);
  return `${CDN}/embed/avatars/${index}.png`;
}

export function avatarUrl(user, member, guildId) {
  if (member?.avatar && guildId)
    return `${CDN}/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png?size=128`;
  if (user?.avatar) return `${CDN}/avatars/${user.id}/${user.avatar}.png?size=128`;
  return defaultAvatarUrl(user);
}

/** Webhook names: 1-80 chars, no "discord"/"clyde", not "everyone"/"here" */
export function webhookUsername(name) {
  let result = String(name || "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .replace(/discord|clyde/gi, (match) => `${match[0]}​${match.slice(1)}`);
  if (!result || /^(everyone|here)$/i.test(result)) result = `Player ${result}`.trim();
  return Array.from(result).slice(0, 80).join("");
}

export function memberAllowed(member, allowedRoleIds) {
  if (!member) return false;
  if (!allowedRoleIds.length) return true;
  return (member.roles || []).some((role) => allowedRoleIds.includes(role));
}

// Message types shown as regular chat lines: default, reply, slash command, context menu
const CHAT_TYPES = new Set([0, 19, 20, 23]);
const SYSTEM_TEXT = {
  6: "置顶了一条消息",
  7: "加入了服务器",
  8: "助力了服务器",
  18: "创建了子区",
};

function pickAttachment(a) {
  return {
    id: a.id,
    filename: a.filename,
    url: a.url,
    proxyUrl: a.proxy_url,
    contentType: a.content_type || "",
    size: a.size,
    width: a.width ?? null,
    height: a.height ?? null,
    spoiler: a.filename?.startsWith("SPOILER_") || false,
  };
}

function pickEmbed(e) {
  const media = (item) => (item ? { url: item.proxy_url || item.url, width: item.width, height: item.height } : null);
  return {
    type: e.type || "rich",
    title: e.title || "",
    description: e.description || "",
    url: e.url || "",
    color: e.color ?? null,
    author: e.author ? { name: e.author.name || "", url: e.author.url || "", iconUrl: e.author.proxy_icon_url || e.author.icon_url || "" } : null,
    fields: (e.fields || []).map((f) => ({ name: f.name || "", value: f.value || "", inline: !!f.inline })),
    footer: e.footer ? { text: e.footer.text || "" } : null,
    image: media(e.image),
    thumbnail: media(e.thumbnail),
    video: media(e.video),
    provider: e.provider?.name || "",
  };
}

/**
 * Converts a Discord message object to the browser shape.
 * `ownerOf(id)` returns the bridge user id for messages sent from the web page.
 * `nickOf(userId)` returns a cached guild nickname, if any.
 */
export function toClientMessage(m, { guildId, ownerOf = () => null, nickOf = () => null } = {}) {
  const author = m.author || {};
  const withNick = (user, member) => ({ ...(member || {}), nick: member?.nick || nickOf(user?.id) || null });
  const effectiveMember = withNick(author, m.member);
  const isWebhook = !!m.webhook_id;
  const interaction = m.interaction_metadata || m.interaction;
  const referenced = m.referenced_message;
  return {
    id: m.id,
    channelId: m.channel_id,
    type: m.type ?? 0,
    system: CHAT_TYPES.has(m.type ?? 0) ? null : SYSTEM_TEXT[m.type] || "",
    author: {
      id: author.id,
      name: isWebhook ? author.username || "Webhook" : displayName(author, effectiveMember),
      avatar: avatarUrl(author, isWebhook ? null : effectiveMember, guildId),
      bot: !!author.bot,
      webhook: isWebhook,
    },
    ownerId: ownerOf(m.id),
    content: m.content || "",
    timestamp: m.timestamp,
    editedTimestamp: m.edited_timestamp || null,
    attachments: (m.attachments || []).map(pickAttachment),
    embeds: (m.embeds || []).map(pickEmbed),
    stickers: (m.sticker_items || []).map((s) => ({
      id: s.id,
      name: s.name,
      url: `https://media.discordapp.net/stickers/${s.id}.${s.format_type === 4 ? "gif" : "png"}?size=160`,
    })),
    mentions: (m.mentions || []).map((u) => ({ id: u.id, name: displayName(u, u.member) })),
    interaction: interaction
      ? { name: interaction.name || "", user: displayName(interaction.user, interaction.member) }
      : null,
    reference: referenced
      ? {
          id: referenced.id,
          author: referenced.webhook_id
            ? referenced.author?.username || ""
            : displayName(referenced.author, withNick(referenced.author, referenced.member)),
          content: (referenced.content || "").slice(0, 200),
        }
      : m.type === 19 && m.message_reference?.message_id
        ? { id: m.message_reference.message_id, author: "", content: "" }
        : null,
  };
}
