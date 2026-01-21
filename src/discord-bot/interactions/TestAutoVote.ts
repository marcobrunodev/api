import { ChatInputCommandInteraction } from "discord.js";
import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { getVotesByMessage, updateVoteMessageById } from "./VoteCaptain";

/**
 * Test Auto Vote Command
 *
 * This is a TESTING-ONLY command to automatically simulate random votes
 * for all players in a captain voting session.
 *
 * Usage: /test-auto-vote <message_id>
 */
@BotChatCommand(ChatCommands.TestAutoVoteCaptains)
export default class TestAutoVote extends DiscordInteraction {
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
      const messageId = interaction.options.getString('message_id', true);

      // Fetch the message to get the buttons/fruits
      const message = await interaction.channel.messages.fetch(messageId);

      if (!message) {
        await interaction.editReply({
          content: `❌ Message not found with ID: ${messageId}`
        });
        return;
      }

      // Extract fruits from the buttons
      const fruits: string[] = [];
      for (const row of message.components) {
        if ('components' in row) {
          for (const component of row.components) {
            if (component.type === 2) { // BUTTON type
              // Extract fruit from label
              const label = (component as any).label;
              if (label) {
                fruits.push(label);
              }
            }
          }
        }
      }

      if (fruits.length === 0) {
        await interaction.editReply({
          content: `❌ No vote buttons found in this message`
        });
        return;
      }

      // Get or create votes map for this message
      const votes = getVotesByMessage(messageId);
      if (!votes) {
        await interaction.editReply({
          content: `❌ No voting session found for message ID: ${messageId}\n\nMake sure this is a captain voting message.`
        });
        return;
      }

      // Get all members in the voice channel (assuming they're in the mix voice channel)
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({ content: '❌ This command must be used in a server' });
        return;
      }

      // Find the "Banana Mix" category and get members from the voice channel
      const categories = guild.channels.cache.filter(c => c.type === 4 && c.name.startsWith('Banana Mix'));

      if (categories.size === 0) {
        await interaction.editReply({
          content: `❌ No "Banana Mix" category found. Make sure the mix is created first.`
        });
        return;
      }

      const category = categories.first();
      const voiceChannels = guild.channels.cache.filter(
        c => c.type === 2 && c.parentId === category.id
      );

      if (voiceChannels.size === 0) {
        await interaction.editReply({
          content: `❌ No voice channels found in the Banana Mix category`
        });
        return;
      }

      const voiceChannel = voiceChannels.first() as any;
      const members = voiceChannel.members;

      if (!members || members.size === 0) {
        await interaction.editReply({
          content: `❌ No members found in voice channel`
        });
        return;
      }

      // Simulate votes for each member (bots only, skip normal users)
      let votesAdded = 0;
      let botsCount = 0;
      let usersCount = 0;
      const maxVotesPerUser = 1;

      for (const [userId, member] of members) {
        // Skip if it's a normal user (not a bot)
        if (!member.user.bot) {
          usersCount++;
          continue;
        }

        botsCount++;

        // Skip if already voted
        const userVotes = votes.get(userId);
        if (userVotes && userVotes.size >= maxVotesPerUser) {
          continue;
        }

        // Pick a random fruit
        const randomFruit = fruits[Math.floor(Math.random() * fruits.length)];

        // Initialize if needed
        if (!votes.has(userId)) {
          votes.set(userId, new Set());
        }

        const userVotesSet = votes.get(userId);

        // Add the vote if not already voted for this fruit
        if (!userVotesSet.has(randomFruit)) {
          userVotesSet.add(randomFruit);
          votesAdded++;
        }
      }

      // Count votes per fruit
      const voteCount = new Map<string, number>();
      for (const userVotesSet of votes.values()) {
        for (const fruit of userVotesSet) {
          voteCount.set(fruit, (voteCount.get(fruit) || 0) + 1);
        }
      }

      const resultsText = Array.from(voteCount.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([fruit, count]) => `${fruit}: ${count} vote(s)`)
        .join('\n');

      // Update the vote message to reflect the new votes
      await updateVoteMessageById(message);

      await interaction.editReply({
        content: `✅ Auto-voting complete (bots only)!\n\n` +
          `**Bots voted:** ${votesAdded}\n` +
          `**Total bots:** ${botsCount}\n` +
          `**Users (skipped):** ${usersCount}\n` +
          `**Total players who voted:** ${votes.size}\n\n` +
          `**Vote results:**\n${resultsText}`
      });

    } catch (error) {
      console.error('Error in test-auto-vote command:', error);
      await interaction.editReply({
        content: `❌ Error simulating auto votes: ${error.message}`
      });
    }
  }
}
