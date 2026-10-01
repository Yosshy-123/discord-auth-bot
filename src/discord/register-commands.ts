import { REST, Routes } from "discord.js";
import { env } from "../config.js";
import { CONFIG_COMMAND } from "./commands/config.js";
import { PANEL_COMMAND } from "./commands/panel.js";
import { USERINFO_COMMAND } from "./commands/userinfo.js";
import { USERDATA_COMMAND } from "./commands/userdata.js";

async function main() {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const body = [CONFIG_COMMAND, PANEL_COMMAND, USERINFO_COMMAND, USERDATA_COMMAND];

  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
  // eslint-disable-next-line no-console
  console.log(`Registered ${body.length} global commands.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to register commands", err);
  process.exit(1);
});
