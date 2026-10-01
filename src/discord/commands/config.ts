import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { getGuildSettings } from "../../db/repo.js";
import { buildInitialDraft, drafts, renderConfigContainer, scheduleDraftExpiry } from "../configPanel.js";

export const CONFIG_COMMAND = {
  name: "config",
  description: "認証Botの設定パネルを開きます",
  default_member_permissions: PermissionFlagsBits.Administrator.toString(),
  dm_permission: false,
};

export async function handleConfigCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) return;

  const settings = await getGuildSettings(interaction.guildId);
  const draft = buildInitialDraft(interaction.guildId, interaction.user.id, settings);
  const container = renderConfigContainer(draft);

  await interaction.reply({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [container],
  });

  const message = await interaction.fetchReply();
  draft.timeout = scheduleDraftExpiry(message.id, () => {
    drafts.delete(message.id);
    // §8.2: best-effort disable on expiry; ignore failures (e.g. message already gone).
    interaction
      .editReply({ content: "⌛ 期限切れです。`/config` をやり直してください。", components: [] })
      .catch(() => {});
  });
  drafts.set(message.id, draft);
}
