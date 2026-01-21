import { ChatInputCommandInteraction } from "discord.js";
import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";

/**
 * Leave Guild Command
 *
 * Makes the bot leave the current Discord server.
 * Only works in development environment for safety.
 */
@BotChatCommand(ChatCommands.LeaveGuild)
export default class LeaveGuild extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    // Only allow in development/testing environments
    if (process.env.NODE_ENV !== 'development') {
      await interaction.editReply({
        content: '❌ This command is disabled in production.'
      });
      return;
    }

    try {
      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply({
          content: '❌ This command can only be used in a server.'
        });
        return;
      }

      const guildName = guild.name;
      const guildId = guild.id;

      await interaction.editReply({
        content: `👋 Bot is leaving server: **${guildName}** (${guildId})\n\nGoodbye!`
      });

      // Wait a bit for the message to be sent before leaving
      setTimeout(async () => {
        await guild.leave();
        console.log(`Bot left guild: ${guildName} (${guildId})`);
      }, 2000);

    } catch (error) {
      console.error('Error leaving guild:', error);
      await interaction.editReply({
        content: `❌ Error leaving server: ${error.message}`
      });
    }
  }
}
