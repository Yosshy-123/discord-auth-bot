import type { Client, GuildChannel } from "discord.js";
import { getGuildSettings, upsertGuildSettings } from "../../db/repo.js";
import { logSettingCleared } from "../logChannel.js";

export function registerChannelDeleteEvent(client: Client): void {
  client.on("channelDelete", async (channel) => {
    if (!("guild" in channel) || !channel.guild) return;
    const guildChannel = channel as GuildChannel;
    const settings = await getGuildSettings(guildChannel.guild.id);
    if (!settings) return;

    if (settings.verifyChannelId === guildChannel.id) {
      await upsertGuildSettings(guildChannel.guild.id, { verifyChannelId: null, panelChannelId: null, panelMessageId: null });
      await logSettingCleared(guildChannel.guild.id, `認証用チャンネル(#${guildChannel.name})が削除されたため設定を解除しました`);
    }
    if (settings.logChannelId === guildChannel.id) {
      await upsertGuildSettings(guildChannel.guild.id, { logChannelId: null });
      // ログチャンネル自体が消えたので、この通知は送れない(ベストエフォート、無視)
    }
  });
}
