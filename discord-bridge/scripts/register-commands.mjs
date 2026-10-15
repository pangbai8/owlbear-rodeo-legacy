// Registers the message context-menu commands (编辑（Owlbear） / 删除（Owlbear）)
// on the server. Guild commands show up immediately.
//   npm run register              (reads .dev.vars)
//   npm run register -- path/to/vars-file
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

for (const name of ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "GUILD_ID"]) {
  if (!vars[name]) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
}

const response = await fetch(
  `https://discord.com/api/v10/applications/${vars.DISCORD_CLIENT_ID}/guilds/${vars.GUILD_ID}/commands`,
  {
    method: "PUT",
    headers: { Authorization: `Bot ${vars.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(COMMANDS),
  },
);
const body = await response.json();
if (!response.ok) {
  console.error("failed:", response.status, JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log("registered:", body.map((c) => c.name).join(", "));
