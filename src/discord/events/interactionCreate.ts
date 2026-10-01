import { MessageFlags, type Client, type Interaction } from "discord.js";
import { handleConfigCommand } from "../commands/config.js";
import { handlePanelSendCommand } from "../commands/panel.js";
import { handleUserinfoCommand } from "../commands/userinfo.js";
import { handleUserdataDeleteCommand } from "../commands/userdata.js";
import { handleConfigPanelInteraction, isConfigPanelInteraction } from "../interactions/configPanelHandler.js";

export function registerInteractionCreateEvent(client: Client): void {
  client.on("interactionCreate", async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        // §8.1: Bot-side re-check of Administrator, independent of the
        // command's default_member_permissions (which a server can override).
        if (!interaction.memberPermissions?.has("Administrator")) {
          await interaction.reply({ content: "この操作には管理者権限が必要です。", flags: MessageFlags.Ephemeral });
          return;
        }

        switch (interaction.commandName) {
          case "config":
            await handleConfigCommand(interaction);
            break;
          case "panel":
            if (interaction.options.getSubcommand() === "send") {
              await handlePanelSendCommand(interaction);
            }
            break;
          case "userinfo":
            await handleUserinfoCommand(interaction);
            break;
          case "userdata":
            if (interaction.options.getSubcommand() === "delete") {
              await handleUserdataDeleteCommand(interaction);
            }
            break;
        }
        return;
      }

      if (
        (interaction.isButton() ||
          interaction.isChannelSelectMenu() ||
          interaction.isRoleSelectMenu() ||
          interaction.isStringSelectMenu()) &&
        isConfigPanelInteraction(interaction.customId)
      ) {
        await handleConfigPanelInteraction(interaction);
        return;
      }
      // Note: /userdata delete's confirm/cancel buttons (customId "ud:*")
      // are handled by their own per-message collector in userdata.ts, not here.
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ level: "error", msg: "interaction handler failed", error: String(err) }));
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "内部エラーが発生しました。", flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  });
}
