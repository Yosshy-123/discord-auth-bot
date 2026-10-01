import {
  ApplicationCommandOptionType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getVerification, decryptVerification, getGuildSettings, recordAudit } from "../../db/repo.js";
import { logUserinfoView } from "../logChannel.js";
import { userinfoLimiter } from "../../web/rateLimit.js";

export const USERINFO_COMMAND = {
  name: "userinfo",
  description: "取得済みの認証情報を表示します(管理者のみ)",
  default_member_permissions: PermissionFlagsBits.Administrator.toString(),
  dm_permission: false,
  options: [
    {
      type: ApplicationCommandOptionType.User,
      name: "user",
      description: "対象ユーザー",
      required: true,
    },
  ],
};

function code(s: string | null | undefined): string {
  if (!s) return "*(なし)*";
  return `\`${s.replace(/`/g, "'")}\``;
}

export async function handleUserinfoCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const guildId = interaction.guildId;

  if (!userinfoLimiter.consume(interaction.user.id)) {
    await interaction.reply({ content: "アクセスが集中しています。しばらくしてからお試しください。", flags: MessageFlags.Ephemeral });
    return;
  }

  const target = interaction.options.getUser("user", true);

  const row = await getVerification(guildId, target.id);
  await recordAudit({ guildId, actorId: interaction.user.id, action: "userinfo_view", targetId: target.id });
  await logUserinfoView(guildId, interaction.user.id, target.id);

  if (!row) {
    await interaction.reply({ content: "データがありません。", flags: MessageFlags.Ephemeral });
    return;
  }

  const v = decryptVerification(row);
  const embed = new EmbedBuilder().setTitle(`userinfo: ${v.discordUsername}`).setFooter({
    text: `最終更新: ${v.updatedAt.toISOString()}`,
  });

  if (v.status === "oauth_done") {
    embed.setColor(0x95a5a6).setDescription("認証未完了");
    embed.addFields({ name: "メールアドレス", value: code(v.email), inline: false });
    if (v.lastError) embed.addFields({ name: "最終エラー", value: code(v.lastError) });
  } else if (v.status === "rejected") {
    embed.setColor(0xe74c3c).setDescription("拒否");
    embed.addFields({ name: "メールアドレス", value: code(v.email) });
    embed.addFields({ name: "拒否理由", value: code(v.rejectReasons.join(", ") || null) });
    if (v.ip) embed.addFields({ name: "IPアドレス", value: code(v.ip) });
    if (v.uaServer || v.uaClient) {
      embed.addFields({ name: "User-Agent (server/client)", value: code(`${v.uaServer ?? ""} / ${v.uaClient ?? ""}`) });
    }
  } else {
    embed.setColor(0x2ecc71).setDescription("認証済み");
    embed.addFields(
      { name: "メールアドレス", value: code(v.email), inline: false },
      { name: "メール確認済み", value: v.emailVerified ? "はい" : "いいえ", inline: true },
      { name: "認証時IP", value: code(v.ip), inline: true },
      { name: "OAuth時IP", value: code(v.oauthIp), inline: true },
      { name: "WebRTC IP", value: code(v.webrtcIps?.join(", ") ?? null), inline: false },
      { name: "WebRTC状態", value: code(v.webrtcStatus), inline: true },
      { name: "User-Agent (server)", value: code(v.uaServer), inline: false },
      { name: "User-Agent (client)", value: code(v.uaClient), inline: false },
      { name: "リスクフラグ", value: code(v.riskFlags.join(", ") || null), inline: false },
      { name: "認証日時", value: v.verifiedAt ? v.verifiedAt.toISOString() : "-", inline: false }
    );
  }

  // ロール保有状況の警告
  const settings = await getGuildSettings(guildId);
  if (v.status === "verified" && settings?.verifiedRoleId) {
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member && !member.roles.cache.has(settings.verifiedRoleId)) {
      embed.addFields({ name: "⚠️ 注意", value: "DB上は認証済みですが、認証ロールを保有していません。" });
    }
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
