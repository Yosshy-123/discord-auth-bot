import {
  MessageFlags,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { drafts, renderConfigContainer } from "../configPanel.js";
import { botHasChannelPermissions, botOutranksRole, isSelectableRole } from "../memberActions.js";
import { upsertGuildSettings, recordAudit, type GuildSettingsPatch } from "../../db/repo.js";
import { logConfigChange } from "../logChannel.js";
import type { RiskFlag } from "../../lib/proxycheck.js";

type AnyConfigInteraction =
  | ButtonInteraction
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction
  | StringSelectMenuInteraction;

/** True if handled here (customId belongs to the config panel). */
export function isConfigPanelInteraction(customId: string): boolean {
  return customId.startsWith("cfgpanel:");
}

async function replyDraftGone(interaction: AnyConfigInteraction): Promise<void> {
  await interaction.reply({
    content: "⌛ この設定パネルは期限切れです。`/config` をやり直してください。",
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleConfigPanelInteraction(interaction: AnyConfigInteraction): Promise<void> {
  const messageId = interaction.message?.id;
  if (!messageId) return;
  const draft = drafts.get(messageId);
  if (!draft) {
    await replyDraftGone(interaction);
    return;
  }

  if (interaction.user.id !== draft.ownerId) {
    await interaction.reply({
      content: "このパネルは実行者本人のみ操作できます。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [, field] = interaction.customId.split(":");

  if (interaction.isChannelSelectMenu()) {
    if (field === "verifyChannel") draft.verifyChannelId = interaction.values[0] ?? null;
    if (field === "logChannel") draft.logChannelId = interaction.values[0] ?? null;
    await interaction.update({ components: [renderConfigContainer(draft)] });
    return;
  }

  if (interaction.isRoleSelectMenu()) {
    if (field === "verifiedRole") draft.verifiedRoleId = interaction.values[0] ?? null;
    if (field === "unverifiedRole") draft.unverifiedRoleId = interaction.values[0] ?? null;
    await interaction.update({ components: [renderConfigContainer(draft)] });
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (field === "blockTargets") draft.blockTargets = [...interaction.values];
    await interaction.update({ components: [renderConfigContainer(draft)] });
    return;
  }

  if (interaction.isButton()) {
    if (field === "cancel") {
      clearDraft(messageId, draft);
      await interaction.update({ content: "キャンセルしました。", components: [] });
      return;
    }
    if (field === "save") {
      await handleSave(interaction, messageId, draft);
      return;
    }
  }
}

function clearDraft(messageId: string, draft: ReturnType<typeof drafts.get> & object): void {
  if (draft?.timeout) clearTimeout(draft.timeout);
  drafts.delete(messageId);
}

async function handleSave(
  interaction: ButtonInteraction,
  messageId: string,
  draft: NonNullable<ReturnType<typeof drafts.get>>
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const errors: string[] = [];

  // §8.2 バリデーション 1: 必須項目
  if (!draft.verifyChannelId) errors.push("認証用チャンネルが未選択です");
  if (!draft.verifiedRoleId) errors.push("認証ロールが未選択です");

  // §8.2 バリデーション 4: 認証ロールと未認証ロールが同一でない
  if (draft.verifiedRoleId && draft.unverifiedRoleId && draft.verifiedRoleId === draft.unverifiedRoleId) {
    errors.push("認証ロールと未認証ロールに同じロールは指定できません");
  }

  // §8.2 バリデーション 2, 3: ロール階層 / @everyone・managed ロール禁止
  for (const [label, roleId] of [
    ["認証ロール", draft.verifiedRoleId],
    ["未認証ロール", draft.unverifiedRoleId],
  ] as const) {
    if (!roleId) continue;
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      errors.push(`${label}が見つかりません`);
      continue;
    }
    if (!isSelectableRole(guild, role)) {
      errors.push(`${label}に @everyone または管理用ロールは指定できません`);
    } else if (!botOutranksRole(guild, role)) {
      errors.push(`${label}がBotのロールより上位のため、付与・剥奪できません`);
    }
  }

  // §8.2 バリデーション 5, 6: チャンネル権限
  for (const [label, channelId] of [
    ["認証用チャンネル", draft.verifyChannelId],
    ["ログチャンネル", draft.logChannelId],
  ] as const) {
    if (!channelId) continue;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !("permissionsFor" in channel)) {
      errors.push(`${label}が見つかりません`);
      continue;
    }
    if (!botHasChannelPermissions(guild, channel as any)) {
      errors.push(`${label}でBotに閲覧・送信・埋め込みの権限がありません`);
    }
  }

  if (errors.length > 0) {
    await interaction.reply({
      content: `保存できませんでした:\n${errors.map((e) => `- ${e}`).join("\n")}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const patch: GuildSettingsPatch = {
    verifyChannelId: draft.verifyChannelId,
    verifiedRoleId: draft.verifiedRoleId,
    logChannelId: draft.logChannelId,
    unverifiedRoleId: draft.unverifiedRoleId,
    blockTargets: draft.blockTargets as RiskFlag[],
    updatedBy: interaction.user.id,
  };
  await upsertGuildSettings(draft.guildId, patch);

  await recordAudit({
    guildId: draft.guildId,
    actorId: interaction.user.id,
    action: "config_change",
    detail: patch,
  });
  await logConfigChange(draft.guildId, interaction.user.id, JSON.stringify(patch));

  clearDraft(messageId, draft);

  await interaction.update({
    content: "✅ 設定を保存しました。認証チャンネルにパネルを送るには `/panel send` を実行してください。",
    components: [],
  });
}
