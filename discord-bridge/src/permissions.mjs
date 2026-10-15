// Discord's channel permission rules, so the page shows a channel only to
// people who can see it in Discord and lets them write only where they could.
// https://discord.com/developers/docs/topics/permissions#permission-overwrites

export const ADMINISTRATOR = 1n << 3n;
export const VIEW_CHANNEL = 1n << 10n;
export const SEND_MESSAGES = 1n << 11n;
export const ATTACH_FILES = 1n << 15n;
export const READ_MESSAGE_HISTORY = 1n << 16n;
export const MANAGE_WEBHOOKS = 1n << 29n;
const ALL = (1n << 64n) - 1n;

const big = (value) => {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
};

/**
 * @param {object} input
 * @param {string} input.userId
 * @param {{ roles?: string[], communication_disabled_until?: string|null } | null} input.member
 * @param {{ id: string, ownerId: string, roles: Record<string, string> }} input.guild  role id -> permissions
 * @param {{ type: number, id: string, allow: string, deny: string }[]} input.overwrites
 * @returns {bigint} 0n when the user is not a member
 */
export function channelPermissions({ userId, member, guild, overwrites = [], now = Date.now() }) {
  if (!member) return 0n;
  if (userId === guild.ownerId) return ALL;
  const memberRoles = member.roles || [];
  let perms = big(guild.roles[guild.id]);
  for (const role of memberRoles) perms |= big(guild.roles[role]);
  if (perms & ADMINISTRATOR) return ALL;

  const everyone = overwrites.find((o) => o.id === guild.id);
  if (everyone) perms = (perms & ~big(everyone.deny)) | big(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const o of overwrites) {
    if (o.type === 0 && o.id !== guild.id && memberRoles.includes(o.id)) {
      allow |= big(o.allow);
      deny |= big(o.deny);
    }
  }
  perms = (perms & ~deny) | allow;
  const own = overwrites.find((o) => o.type === 1 && o.id === userId);
  if (own) perms = (perms & ~big(own.deny)) | big(own.allow);

  if (!(perms & VIEW_CHANNEL)) return 0n;
  // Timed-out members can only read
  const timeout = member.communication_disabled_until ? Date.parse(member.communication_disabled_until) : 0;
  if (timeout > now) perms &= VIEW_CHANNEL | READ_MESSAGE_HISTORY;
  return perms;
}

/** What the page may do in a channel */
export function channelAccess(perms) {
  return {
    view: !!(perms & VIEW_CHANNEL),
    history: !!(perms & VIEW_CHANNEL) && !!(perms & READ_MESSAGE_HISTORY),
    send: !!(perms & VIEW_CHANNEL) && !!(perms & SEND_MESSAGES),
    attach: !!(perms & VIEW_CHANNEL) && !!(perms & SEND_MESSAGES) && !!(perms & ATTACH_FILES),
  };
}
