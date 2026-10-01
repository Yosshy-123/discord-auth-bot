import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import { getGuildSettings, isConfigComplete, upsertGuildSettings, recordAudit } from "../../db/repo.js";
import { logPanelSend } from "../logChannel.js";
import { env } from "../../config.js";

export const PANEL_COMMAND = {
  name: "panel",
  description: "認証パネルの操作",
  default_member_permissions: PermissionFlagsBits.Administrator.toString(),
  dm_permission: false,
  options: [{ type: 1, name: "send", description: "認証用チャンネルに認証パネルを送信します" }],
};

function buildPanelMessage(guildName: string, guildId: string) {
  const embed = new EmbedBuilder()
    .setTitle("✅ 認証")
    .setDescription(
      `${guildName} への参加には認証が必要です。下のボタンから認証してください。`
    )
    .setColor(0x5865f2);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel("認証する").setStyle(ButtonStyle.Link).setURL(`${env.BASE_URL}/start/${guildId}`)
  );

  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

export async function handlePanelSendCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const guildId = interaction.guildId;
  const guild = interaction.guild;

  const settingsRow = await getGuildSettings(guildId);
  if (!isConfigComplete(settingsRow)) {
    const missing: string[] = [];
    if (!settingsRow?.verifyChannelId) missing.push("認証用チャンネル");
    if (!settingsRow?.verifiedRoleId) missing.push("認証ロール");
    await interaction.reply({
      content: `未設定の項目があります: ${missing.join("、")}。先に \`/config\` で設定してください。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // isConfigComplete confirmed verifyChannelId/verifiedRoleId are set.
  const settings = settingsRow!;

  const targetChannel = await guild.channels.fetch(settings.verifyChannelId!).catch(() => null);
  if (!targetChannel || !targetChannel.isTextBased()) {
    await interaction.reply({
      content: "認証用チャンネルが見つかりません。`/config` で設定し直してください。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const payload = buildPanelMessage(guild.name, guildId);
  let sentMessageId: string;

  // §8.3: edit existing panel if it's still in the same channel, else replace it.
  if (settings.panelMessageId && settings.panelChannelId === settings.verifyChannelId) {
    const existing = await (targetChannel as TextChannel).messages.fetch(settings.panelMessageId).catch(() => null);
    if (existing) {
      const edited = await existing.edit(payload);
      sentMessageId = edited.id;
    } else {
      const sent = await (targetChannel as TextChannel).send(payload);
      sentMessageId = sent.id;
    }
  } else {
    if (settings.panelMessageId && settings.panelChannelId) {
      const oldChannel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
      if (oldChannel?.isTextBased()) {
        await (oldChannel as TextChannel).messages.delete(settings.panelMessageId).catch(() => {});
      }
    }
    const sent = await (targetChannel as TextChannel).send(payload);
    sentMessageId = sent.id;
  }

  await upsertGuildSettings(guildId, {
    panelChannelId: settings.verifyChannelId,
    panelMessageId: sentMessageId,
  });

  await recordAudit({ guildId, actorId: interaction.user.id, action: "panel_send", targetId: sentMessageId });
  await logPanelSend(guildId, interaction.user.id, settings.verifyChannelId!);

  const link = `https://discord.com/channels/${guildId}/${settings.verifyChannelId}/${sentMessageId}`;
  await interaction.reply({ content: `送信しました: ${link}`, flags: MessageFlags.Ephemeral });
}
