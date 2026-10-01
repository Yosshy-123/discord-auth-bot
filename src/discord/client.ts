import { Client, GatewayIntentBits, Partials } from "discord.js";

/**
 * §3: Server Members Intent is requested unconditionally — whether any
 * given guild actually uses the unverified-role feature is a per-guild
 * runtime setting (guild_settings.unverified_role_id), not a deploy-time
 * toggle. See §10 guildMemberAdd and §20.
 */
export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});
