// Registers the message context-menu commands (编辑（Owlbear） / 删除（Owlbear）)
// globally, so they work in every server the bot is in.
//   npm run register              (reads .dev.vars)
//   npm run register -- path/to/vars-file
// If GUILD_ID is set, commands registered on that one server by older versions
// are removed, so they do not show up twice.
import { readFileSync } from "node:fs";
import { COMMANDS } from "../src/interactions.mjs";

const file = process.argv[2] || ".dev.vars";
const vars = { ...process.env };
try {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) vars[match[1]] = match[2].trim();
  }
} catch {
  console.log(`(no ${file}; using environment variables)`);
}

for (const name of ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID"]) {
  if (!vars[name]) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
}

async function put(path, body) {
  const response = await fetch(`https://discord.com/api/v10/applications/${vars.DISCORD_CLIENT_ID}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${vars.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("failed:", response.status, JSON.stringify(data, null, 2));
    process.exit(1);
  }
  return data;
}

const registered = await put("/commands", COMMANDS);
console.log("registered globally:", registered.map((c) => c.name).join(", "));
if (vars.GUILD_ID) {
  await put(`/guilds/${vars.GUILD_ID}/commands`, []);
  console.log(`removed server-only commands from ${vars.GUILD_ID}`);
}
