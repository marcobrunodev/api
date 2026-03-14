import {
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";

@BotChatCommand(ChatCommands.ClearNotifications)
export default class ClearNotifications extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const { discord_guilds_by_pk } = await this.hasura.query({
        discord_guilds_by_pk: {
          __args: { id: guild.id },
          notification_channel_id: true,
        },
      });

      if (!discord_guilds_by_pk?.notification_channel_id) {
        await interaction.editReply({
          content: "❌ Notification channel not configured. Please run `/init` first.",
        });
        return;
      }

      const channel = await guild.channels.fetch(discord_guilds_by_pk.notification_channel_id);

      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.editReply({
          content: "❌ Notification channel not found.",
        });
        return;
      }

      const textChannel = channel as TextChannel;
      let totalDeleted = 0;
      let hasMore = true;

      while (hasMore) {
        const messages = await textChannel.messages.fetch({ limit: 100 });

        if (messages.size === 0) {
          hasMore = false;
          break;
        }

        // bulkDelete only works for messages < 14 days old
        const now = Date.now();
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        const recent = messages.filter((m) => now - m.createdTimestamp < fourteenDays);
        const old = messages.filter((m) => now - m.createdTimestamp >= fourteenDays);

        if (recent.size > 0) {
          const deleted = await textChannel.bulkDelete(recent, true);
          totalDeleted += deleted.size;
        }

        // Delete old messages one by one
        for (const [, message] of old) {
          try {
            await message.delete();
            totalDeleted++;
          } catch {
            // Message may already be deleted
          }
        }

        if (messages.size < 100) {
          hasMore = false;
        }
      }

      await interaction.editReply({
        content: `✅ Cleared **${totalDeleted}** messages from <#${textChannel.id}>.`,
      });
    } catch (error) {
      this.logger.error("[ClearNotifications] Error:", error);
      await interaction.editReply({
        content: "❌ An error occurred while clearing messages.",
      });
    }
  }
}
