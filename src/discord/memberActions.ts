import { PermissionsBitField, type Guild, type GuildMember, type Role, type GuildChannel } from "discord.js";
import { client } from "./client.js";

/** §4.2 #6: 404 ⇒ not a member of this guild. */
export async function isGuildMember(guildId: string, userId: string): Promise<boolean> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  return member !== null;
}

export async function fetchMember(guildId: string, userId: string): Promise<GuildMember | null> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;
  return guild.members.fetch(userId).catch(() => null);
}

/** §4.3 #10: assign the verified role; returns false on failure (E012). */
export async function assignRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
  const member = await fetchMember(guildId, userId);
  if (!member) return false;
  try {
    await member.roles.add(roleId);
    return true;
  } catch {
    return false;
  }
}

/** §4.3 #10: best-effort removal of the unverified role — failure is a warning only. */
export async function removeRoleBestEffort(guildId: string, userId: string, roleId: string): Promise<boolean> {
  const member = await fetchMember(guildId, userId);
  if (!member) return false;
  try {
    await member.roles.remove(roleId);
    return true;
  } catch {
    return false;
  }
}

/** §8.2 validation #2: bot's highest role must outrank the target role. */
export function botOutranksRole(guild: Guild, role: Role): boolean {
  const me = guild.members.me;
  if (!me) return false;
  return me.roles.highest.comparePositionTo(role) > 0;
}

/** §8.2 validation #3: reject @everyone and managed roles (bot/booster roles). */
export function isSelectableRole(guild: Guild, role: Role): boolean {
  if (role.id === guild.id) return false; // @everyone
  if (role.managed) return false;
  return true;
}

/** §8.2 validation #5/#6: bot needs View/Send/Embed in the given channel. */
export function botHasChannelPermissions(guild: Guild, channel: GuildChannel): boolean {
  const me = guild.members.me;
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  if (!perms) return false;
  return perms.has([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
  ]);
}
