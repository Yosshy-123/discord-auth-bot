import type { Client, Role } from "discord.js";
import { getGuildSettings, upsertGuildSettings } from "../../db/repo.js";
import { logSettingCleared } from "../logChannel.js";

export function registerRoleDeleteEvent(client: Client): void {
  client.on("roleDelete", async (role: Role) => {
    const settings = await getGuildSettings(role.guild.id);
    if (!settings) return;

    if (settings.verifiedRoleId === role.id) {
      await upsertGuildSettings(role.guild.id, { verifiedRoleId: null });
      await logSettingCleared(role.guild.id, `認証ロール(${role.name})が削除されたため設定を解除しました`);
    }
    if (settings.unverifiedRoleId === role.id) {
      await upsertGuildSettings(role.guild.id, { unverifiedRoleId: null });
      await logSettingCleared(role.guild.id, `未認証ロール(${role.name})が削除されたため設定を解除しました`);
    }
  });
}
