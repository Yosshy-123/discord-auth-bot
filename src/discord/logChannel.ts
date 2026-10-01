import { EmbedBuilder, type ColorResolvable } from "discord.js";
import { client } from "./client.js";
import { getGuildSettings } from "../db/repo.js";

const COLORS = {
  green: 0x2ecc71,
  red: 0xe74c3c,
  orange: 0xe67e22,
  gray: 0x95a5a6,
} as const;

async function sendWithRetry(channelId: string, embed: EmbedBuilder, retries = 2): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.isTextBased() && "send" in channel) {
        await (channel as any).send({ embeds: [embed], allowedMentions: { parse: [] } });
        return;
      }
      return;
    } catch {
      if (attempt === retries) return; // §9.1: failure never blocks the auth flow
    }
  }
}

async function notify(guildId: string, color: ColorResolvable, title: string, fields: Record<string, string>) {
  const settings = await getGuildSettings(guildId);
  if (!settings?.logChannelId) return;

  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
  for (const [name, value] of Object.entries(fields)) {
    embed.addFields({ name, value, inline: true });
  }
  await sendWithRetry(settings.logChannelId, embed);
}

export const logVerifySuccess = (guildId: string, userId: string, riskFlags: string[]) =>
  notify(guildId, COLORS.green, "✅ 認証成功", {
    ユーザー: `<@${userId}>`,
    リスクフラグ: riskFlags.length ? riskFlags.join(", ") : "なし",
  });

export const logVerifyRejected = (guildId: string, userId: string, reasons: string[]) =>
  notify(guildId, COLORS.red, "🚫 認証拒否", {
    ユーザー: `<@${userId}>`,
    理由: reasons.join(", ") || "不明",
  });

export const logVerifyError = (guildId: string, userId: string, code: string, detail: string) =>
  notify(guildId, COLORS.orange, "⚠️ 認証エラー", {
    ユーザー: `<@${userId}>`,
    コード: code,
    詳細: detail,
  });

export const logConfigChange = (guildId: string, actorId: string, summary: string) =>
  notify(guildId, COLORS.gray, "⚙️ 設定変更", { 実行者: `<@${actorId}>`, 内容: summary });

export const logPanelSend = (guildId: string, actorId: string, channelId: string) =>
  notify(guildId, COLORS.gray, "📌 パネル送信", { 実行者: `<@${actorId}>`, チャンネル: `<#${channelId}>` });

export const logUserinfoView = (guildId: string, actorId: string, targetId: string) =>
  notify(guildId, COLORS.gray, "🔎 userinfo 閲覧", { 実行者: `<@${actorId}>`, 対象: `<@${targetId}>` });

export const logDataDelete = (guildId: string, actorId: string, targetId: string) =>
  notify(guildId, COLORS.gray, "🗑️ データ削除", { 実行者: `<@${actorId}>`, 対象: `<@${targetId}>` });

export const logSettingCleared = (guildId: string, what: string) =>
  notify(guildId, COLORS.orange, "⚠️ 設定対象が削除されました", { 項目: what });
