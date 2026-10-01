import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { deleteVerification, getGuildSettings, recordAudit } from "../../db/repo.js";
import { removeRoleBestEffort } from "../memberActions.js";
import { logDataDelete } from "../logChannel.js";

export const USERDATA_COMMAND = {
  name: "userdata",
  description: "ユーザーの認証データを操作します(管理者のみ)",
  default_member_permissions: PermissionFlagsBits.Administrator.toString(),
  dm_permission: false,
  options: [
    {
      type: 1, // Subcommand
      name: "delete",
      description: "対象ユーザーの認証データを削除します",
      options: [
        { type: ApplicationCommandOptionType.User, name: "user", description: "対象ユーザー", required: true },
        {
          type: ApplicationCommandOptionType.Boolean,
          name: "revoke_roles",
          description: "認証ロールも剥奪する(既定: false)",
          required: false,
        },
      ],
    },
  ],
};

export async function handleUserdataDeleteCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const guildId = interaction.guildId;

  const target = interaction.options.getUser("user", true);
  const revokeRoles = interaction.options.getBoolean("revoke_roles") ?? false;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ud:confirm").setLabel("削除").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ud:cancel").setLabel("キャンセル").setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: `<@${target.id}> の認証データを削除します。${revokeRoles ? "(認証ロールも剥奪します)" : ""}よろしいですか?`,
    components: [row],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });

  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60_000,
    filter: (i) => i.user.id === interaction.user.id,
    max: 1,
  });

  collector.on("collect", async (buttonInteraction) => {
    if (buttonInteraction.customId === "ud:cancel") {
      await buttonInteraction.update({ content: "キャンセルしました。", components: [] });
      return;
    }

    await deleteVerification(guildId, target.id);

    if (revokeRoles) {
      const settings = await getGuildSettings(guildId);
      if (settings?.verifiedRoleId) {
        await removeRoleBestEffort(guildId, target.id, settings.verifiedRoleId);
      }
    }

    await recordAudit({
      guildId,
      actorId: interaction.user.id,
      action: "userdata_delete",
      targetId: target.id,
      detail: { revokeRoles },
    });
    await logDataDelete(guildId, interaction.user.id, target.id);

    await buttonInteraction.update({ content: "✅ 削除しました。", components: [] });
  });

  collector.on("end", async (collected) => {
    if (collected.size === 0) {
      await interaction.editReply({ content: "⌛ 期限切れです。", components: [] }).catch(() => {});
    }
  });
}
