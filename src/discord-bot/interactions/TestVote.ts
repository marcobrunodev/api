import { ChatInputCommandInteraction } from "discord.js";
import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { getVotesByMessage } from "./VoteCaptain";

/**
 * Test Vote Command
 *
 * This is a TESTING-ONLY command to simulate votes from bots or users
 * during development. Should be removed or disabled in production.
 *
 * Usage: /test-vote <message_id> <user_id> <fruit_emoji>
 */
@BotChatCommand(ChatCommands.TestVote)
export default class TestVote extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    // Only allow in development/testing environments
    if (process.env.NODE_ENV === 'production') {
      await interaction.editReply({
        content: '❌ This command is disabled in production.'
      });
      return;
    }

    try {
      const messageId = interaction.options.getString('message_id', true);
      const userId = interaction.options.getString('user_id', true);
      const fruit = interaction.options.getString('fruit', true);

      // Get the votes map for this message
      const votes = getVotesByMessage(messageId);

      if (!votes) {
        await interaction.editReply({
          content: `❌ No voting session found for message ID: ${messageId}\n\nMake sure you're using the correct message ID from the captain voting message.`
        });
        return;
      }

      // Initialize user votes if needed
      if (!votes.has(userId)) {
        votes.set(userId, new Set());
      }

      const userVotes = votes.get(userId);

      // Check if already voted for this fruit
      if (userVotes.has(fruit)) {
        await interaction.editReply({
          content: `⚠️ User <@${userId}> already voted for ${fruit}`
        });
        return;
      }

      // Check if max votes reached
      const maxVotesPerUser = 1;
      if (userVotes.size >= maxVotesPerUser) {
        await interaction.editReply({
          content: `⚠️ User <@${userId}> already reached maximum votes (${maxVotesPerUser})`
        });
        return;
      }

      // Add the vote
      userVotes.add(fruit);

      await interaction.editReply({
        content: `✅ Test vote registered!\n\n` +
          `**User:** <@${userId}>\n` +
          `**Fruit:** ${fruit}\n` +
          `**Total votes:** ${userVotes.size}/${maxVotesPerUser}`
      });

    } catch (error) {
      console.error('Error in test-vote command:', error);
      await interaction.editReply({
        content: `❌ Error simulating vote: ${error.message}`
      });
    }
  }
}
