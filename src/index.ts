import { serve } from "@hono/node-server";
import { env } from "./config.js";
import { client } from "./discord/client.js";
import { registerReadyEvent } from "./discord/events/ready.js";
import { registerGuildMemberAddEvent } from "./discord/events/guildMemberAdd.js";
import { registerRoleDeleteEvent } from "./discord/events/roleDelete.js";
import { registerChannelDeleteEvent } from "./discord/events/channelDelete.js";
import { registerInteractionCreateEvent } from "./discord/events/interactionCreate.js";
import { app } from "./web/server.js";
import { scheduleCleanupJob } from "./jobs/cleanup.js";
import { pool } from "./db/client.js";

async function main() {
  registerReadyEvent(client);
  registerGuildMemberAddEvent(client);
  registerRoleDeleteEvent(client);
  registerChannelDeleteEvent(client);
  registerInteractionCreateEvent(client);

  await client.login(env.DISCORD_TOKEN);

  // hostname "::" binds dual-stack (IPv4+IPv6). Needed as-is for platforms
  // whose private networking is IPv6-only (e.g. Railway); harmless elsewhere.
  serve({ fetch: app.fetch, port: env.PORT, hostname: "::" }, (info) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: "info", msg: "web server listening", port: info.port }));
  });

  scheduleCleanupJob();
}

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "shutting down", signal }));
  client.destroy();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: "error", msg: "fatal startup error", error: String(err) }));
  process.exit(1);
});
