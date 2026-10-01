import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  type Guild,
} from "discord.js";
import type { GuildSettings } from "../db/repo.js";

export interface ConfigDraft {
  guildId: string;
  ownerId: string;
  verifyChannelId: string | null;
  verifiedRoleId: string | null;
  logChannelId: string | null;
  unverifiedRoleId: string | null;
  blockTargets: string[]; // subset of ["tor","vpn","proxy"]
  createdAt: number;
  timeout: NodeJS.Timeout | null;
}

const DRAFT_TTL_MS = 15 * 60 * 1000; // §8.2

// message.id -> draft. Single-instance in-memory store (§16, §19 phase1 note).
export const drafts = new Map<string, ConfigDraft>();

export function buildInitialDraft(guildId: string, ownerId: string, settings: GuildSettings | null): ConfigDraft {
  return {
    guildId,
    ownerId,
    verifyChannelId: settings?.verifyChannelId ?? null,
    verifiedRoleId: settings?.verifiedRoleId ?? null,
    logChannelId: settings?.logChannelId ?? null,
    unverifiedRoleId: settings?.unverifiedRoleId ?? null,
    blockTargets: settings?.blockTargets ?? [],
    createdAt: Date.now(),
    timeout: null,
  };
}

function summaryLine(draft: ConfigDraft): string {
  const fmt = {
    channel: (id: string | null) => (id ? `<#${id}>` : "*(未設定)*"),
    role: (id: string | null) => (id ? `<@&${id}>` : "*(未設定)*"),
  };
  const warnings: string[] = [];
  if (!draft.verifyChannelId) warnings.push("認証用チャンネルが未設定です");
  if (!draft.verifiedRoleId) warnings.push("認証ロールが未設定です");

  const lines = [
    "### 認証Bot設定",
    `**認証用チャンネル(必須):** ${fmt.channel(draft.verifyChannelId)}`,
    `**認証ロール(必須):** ${fmt.role(draft.verifiedRoleId)}`,
    `**ログチャンネル(任意):** ${fmt.channel(draft.logChannelId)}`,
    `**未認証ロール(任意):** ${fmt.role(draft.unverifiedRoleId)}`,
    `**拒否対象:** ${draft.blockTargets.length ? draft.blockTargets.join(" / ") : "なし(防御OFF)"}`,
  ];
  if (warnings.length > 0) {
    lines.push("", `⚠️ ${warnings.join("、")}`);
  }
  return lines.join("\n");
}

const BLOCK_TARGET_OPTIONS = [
  { label: "Tor", value: "tor", description: "Tor出口ノードからのアクセスを拒否" },
  { label: "VPN", value: "vpn", description: "VPN経由のアクセスを拒否" },
  { label: "Proxy", value: "proxy", description: "Proxy経由のアクセスを拒否" },
];

/** §8.2: builds the whole panel as one Components V2 container. */
export function renderConfigContainer(draft: ConfigDraft): ContainerBuilder {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summaryLine(draft)));

  const verifyChannelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cfgpanel:verifyChannel")
      .setPlaceholder("認証用チャンネル(必須)")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
      .setDefaultChannels(...(draft.verifyChannelId ? [draft.verifyChannelId] : []))
  );

  const verifiedRoleRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("cfgpanel:verifiedRole")
      .setPlaceholder("認証ロール(必須)")
      .setMinValues(1)
      .setMaxValues(1)
      .setDefaultRoles(...(draft.verifiedRoleId ? [draft.verifiedRoleId] : []))
  );

  const logChannelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cfgpanel:logChannel")
      .setPlaceholder("ログチャンネル(任意)")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(1)
      .setDefaultChannels(...(draft.logChannelId ? [draft.logChannelId] : []))
  );

  const unverifiedRoleRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("cfgpanel:unverifiedRole")
      .setPlaceholder("未認証ロール(任意)")
      .setMinValues(0)
      .setMaxValues(1)
      .setDefaultRoles(...(draft.unverifiedRoleId ? [draft.unverifiedRoleId] : []))
  );

  const blockTargetsSelect = new StringSelectMenuBuilder()
    .setCustomId("cfgpanel:blockTargets")
    .setPlaceholder("拒否対象(Tor / VPN / Proxy、複数選択可)")
    .setMinValues(0)
    .setMaxValues(3)
    .addOptions(
      BLOCK_TARGET_OPTIONS.map((o) => ({
        ...o,
        default: draft.blockTargets.includes(o.value),
      }))
    );
  const blockTargetsRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(blockTargetsSelect);

  const buttonsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cfgpanel:save").setLabel("保存").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("cfgpanel:cancel").setLabel("キャンセル").setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(verifyChannelRow);
  container.addActionRowComponents(verifiedRoleRow);
  container.addActionRowComponents(logChannelRow);
  container.addActionRowComponents(unverifiedRoleRow);
  container.addActionRowComponents(blockTargetsRow);
  container.addActionRowComponents(buttonsRow);

  return container;
}

export function scheduleDraftExpiry(messageId: string, onExpire: () => void): NodeJS.Timeout {
  return setTimeout(onExpire, DRAFT_TTL_MS);
}
