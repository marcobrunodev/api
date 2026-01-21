import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import {
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";

@BotChatCommand(ChatCommands.Queue)
export default class Queue extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply("This command can only be used in a server.");
        return;
      }

      const member = guild.members.cache.get(interaction.user.id);
      const voiceChannel = member?.voice.channel;

      if (!voiceChannel) {
        await interaction.editReply("❌ You need to be in a voice channel to use this command.");
        return;
      }

      if (voiceChannel.name !== '🍌 Queue Mix') {
        await interaction.editReply("❌ This command can only be used in the **🍌 Queue Mix** channel.");
        return;
      }

      const members = Array.from(voiceChannel.members.values());

      if (members.length === 0) {
        await interaction.editReply("The queue is empty.");
        return;
      }

      const sortedMembers = members.sort((a: any, b: any) => {
        const orderA = this.bot.getQueueMixOrder(a.id) ?? 999999;
        const orderB = this.bot.getQueueMixOrder(b.id) ?? 999999;
        return orderA - orderB;
      });

      const queueList = sortedMembers.map((m: any, index: number) => {
        const position = (index + 1).toString().padStart(2, '0');
        const displayName = m.nickname || m.user.username;
        return `\`${position}\` - ${displayName}`;
      }).join('\n');

      const totalPlayers = members.length;
      const mixesReady = Math.floor(totalPlayers / 10);
      const remaining = totalPlayers % 10;

      let statusText = '';
      let embedColor = 0xFFA500; // Orange

      if (mixesReady > 0) {
        embedColor = 0x00FF00; // Green
        statusText = `✅ **${mixesReady} mix${mixesReady > 1 ? 'es' : ''} ready!** (${mixesReady * 10} players)`;
        if (remaining > 0) {
          statusText += `\n⏳ ${remaining} player${remaining > 1 ? 's' : ''} waiting for next mix`;
        }
      } else {
        statusText = `⏳ **${remaining}/10 players** in queue`;
      }

      await interaction.editReply({
        embeds: [{
          title: '🍌 Queue Mix - Player Order',
          description: queueList,
          color: embedColor,
          fields: [
            {
              name: 'Status',
              value: statusText,
              inline: false,
            }
          ],
          footer: {
            text: 'First 10 players will be moved to the next mix',
          },
          timestamp: new Date().toISOString(),
        }]
      });

    } catch (error) {
      this.logger.error('Error in /queue command:', error);
      await interaction.editReply("❌ Error displaying queue. Please try again.");
    }
  }
}
