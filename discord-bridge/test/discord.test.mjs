import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avatarUrl,
  displayName,
  memberAllowed,
  readConfig,
  toClientMessage,
  webhookUsername,
} from "../src/discord.mjs";

const user = { id: "80351110224678912", username: "nelly", global_name: "Nelly", avatar: "abc", discriminator: "0" };

test("display name prefers nickname, then global name, then username", () => {
  assert.equal(displayName(user, { nick: "GM Nelly" }), "GM Nelly");
  assert.equal(displayName(user, { nick: null }), "Nelly");
  assert.equal(displayName({ ...user, global_name: null }, null), "nelly");
});

test("avatar urls: guild avatar, user avatar, default avatars", () => {
  assert.equal(avatarUrl(user, { avatar: "g1" }, "42"), "https://cdn.discordapp.com/guilds/42/users/80351110224678912/avatars/g1.png?size=128");
  assert.equal(avatarUrl(user, null, "42"), "https://cdn.discordapp.com/avatars/80351110224678912/abc.png?size=128");
  // New usernames: (id >> 22) % 6
  assert.equal(avatarUrl({ ...user, avatar: null }, null), `https://cdn.discordapp.com/embed/avatars/${Number((80351110224678912n >> 22n) % 6n)}.png`);
  // Legacy discriminators: discriminator % 5
  assert.equal(avatarUrl({ ...user, avatar: null, discriminator: "1337" }, null), "https://cdn.discordapp.com/embed/avatars/2.png");
});

test("webhook usernames avoid names Discord rejects", () => {
  assert.equal(webhookUsername("DiscordFan"), "D​iscordFan");
  assert.equal(webhookUsername("clyde"), "c​lyde");
  assert.equal(webhookUsername("everyone"), "Player everyone");
  assert.equal(webhookUsername("   "), "Player");
  assert.equal(Array.from(webhookUsername("名".repeat(100))).length, 80);
});

test("role gate", () => {
  assert.equal(memberAllowed(null, []), false);
  assert.equal(memberAllowed({ roles: [] }, []), true);
  assert.equal(memberAllowed({ roles: ["1"] }, ["2"]), false);
  assert.equal(memberAllowed({ roles: ["1", "2"] }, ["2"]), true);
});

test("config lists accept commas and spaces", () => {
  const config = readConfig({ CHANNEL_IDS: "1, 2,,3", FRAME_ANCESTORS: "https://a https://b", GUILD_ID: " 9 " });
  assert.deepEqual(config.channelIds, ["1", "2", "3"]);
  assert.deepEqual(config.frameAncestors, ["https://a", "https://b"]);
  assert.equal(config.guildId, "9");
  assert.deepEqual(config.allowedRoleIds, []);
});

test("converts a guild message with member nick, reply and attachment", () => {
  const message = toClientMessage(
    {
      id: "100",
      channel_id: "1",
      type: 19,
      author: user,
      member: { nick: "GM", avatar: null },
      content: "hi <@2>",
      timestamp: "2026-10-15T10:00:00.000Z",
      edited_timestamp: "2026-10-15T10:01:00.000Z",
      attachments: [{ id: "a", filename: "SPOILER_map.png", url: "u", proxy_url: "p", content_type: "image/png", size: 5, width: 10, height: 20 }],
      embeds: [{ type: "rich", title: "Roll", fields: [{ name: "d20", value: "17", inline: true }], color: 255 }],
      mentions: [{ id: "2", username: "bob", global_name: null }],
      referenced_message: { id: "99", author: { id: "2", username: "bob" }, content: "x".repeat(300) },
    },
    { guildId: "42", ownerOf: () => null },
  );
  assert.equal(message.author.name, "GM");
  assert.equal(message.system, null);
  assert.equal(message.editedTimestamp, "2026-10-15T10:01:00.000Z");
  assert.deepEqual(message.mentions, [{ id: "2", name: "bob" }]);
  assert.equal(message.reference.author, "bob");
  assert.equal(message.reference.content.length, 200);
  assert.equal(message.attachments[0].spoiler, true);
  assert.equal(message.attachments[0].proxyUrl, "p");
  assert.equal(message.embeds[0].fields[0].inline, true);
  assert.equal(message.embeds[0].color, 255);
});

test("webhook messages keep the override name and report the bridge owner", () => {
  const message = toClientMessage(
    {
      id: "200",
      channel_id: "1",
      type: 0,
      webhook_id: "777",
      author: { id: "777", username: "Nelly", avatar: "h", bot: true },
      content: "from the map",
      timestamp: "2026-10-15T10:00:00.000Z",
    },
    { guildId: "42", ownerOf: (id) => (id === "200" ? "80351110224678912" : null), nickOf: () => "ignored" },
  );
  assert.equal(message.author.name, "Nelly");
  assert.equal(message.author.webhook, true);
  assert.equal(message.author.avatar, "https://cdn.discordapp.com/avatars/777/h.png?size=128");
  assert.equal(message.ownerId, "80351110224678912");
});

test("cached nicknames fill in history messages and slash command info is kept", () => {
  const message = toClientMessage(
    {
      id: "300",
      channel_id: "1",
      type: 20,
      author: { id: "5", username: "dicebot", bot: true },
      interaction_metadata: { name: "roll", user: user },
      content: "",
      timestamp: "2026-10-15T10:00:00.000Z",
    },
    { nickOf: (id) => (id === "5" ? "Dice" : null) },
  );
  assert.equal(message.author.name, "Dice");
  assert.deepEqual(message.interaction, { name: "roll", user: "Nelly" });
  assert.equal(message.system, null);
});

test("system messages get a label", () => {
  const message = toClientMessage({ id: "1", channel_id: "1", type: 7, author: user, content: "", timestamp: "t" });
  assert.equal(message.system, "加入了服务器");
});
