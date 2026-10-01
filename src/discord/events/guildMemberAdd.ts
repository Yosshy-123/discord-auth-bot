import type { Client, GuildMember } from "discord.js";
import { getGuildSettings } from "../../db/repo.js";

export function registerGuildMemberAddEvent(client: Client): void {
  client.on("guildMemberAdd", async (member: GuildMember) => {
    if (member.user.bot) return;

    const settings = await getGuildSettings(member.guild.id);
    if (!settings?.unverifiedRoleId) return;

    try {
      await member.roles.add(settings.unverifiedRoleId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "failed to assign unverified role on join",
          guildId: member.guild.id,
          userId: member.id,
        })
      );
    }
  });
}
