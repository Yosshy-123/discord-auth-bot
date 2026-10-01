import type { Client } from "discord.js";

export function registerReadyEvent(client: Client): void {
  client.once("ready", (c) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: "info", msg: "bot ready", user: c.user.tag }));
  });
}
