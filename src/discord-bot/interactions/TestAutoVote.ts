import { ChatInputCommandInteraction } from "discord.js";
import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { getVotesByMessage, updateVoteMessageById, getMaxVotesPerUser, checkAndTriggerVoteComplete, getFruitToPlayerMap } from "./VoteCaptain";

/**
 * Test Auto Vote Command
 *
 * This is a TESTING-ONLY command to automatically simulate votes
 * for bots only (skips real users) in a captain voting session.
 * Bots will prioritize voting for real users (80% chance) over other bots (20% chance)
 * to increase the likelihood of real players becoming captains.
 * It will also trigger the onAllVoted callback if all players have completed voting.
 *
 * Usage: /test-auto-vote-captains <message_id>
 */
@BotChatCommand(ChatCommands.TestAutoVoteCaptains)
export default class TestAutoVote extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

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

      // Simulate votes for each member (bots only, skip real users)
      let votesAdded = 0;
      let botsCount = 0;
      let usersCount = 0;
      const maxVotesPerUser = getMaxVotesPerUser();

      // Get fruit to player mapping to identify real users
      const fruitMapping = getFruitToPlayerMap(messageId);
      if (!fruitMapping) {
        await interaction.editReply({
          content: `❌ No fruit mapping found for message ID: ${messageId}`
        });
        return;
      }

      // Separate fruits by real users vs bots
      const realUserFruits: string[] = [];
      const botFruits: string[] = [];

      for (const [fruit, playerId] of fruitMapping.entries()) {
        const member = members.get(playerId);
        if (member) {
          if (member.user.bot) {
            botFruits.push(fruit);
          } else {
            realUserFruits.push(fruit);
          }
        }
      }

      for (const [userId, member] of members) {
        // Skip real users - only vote for bots
        if (!member.user.bot) {
          usersCount++;
          continue;
        }

        botsCount++;

        // Initialize if needed
        if (!votes.has(userId)) {
          votes.set(userId, new Set());
        }

        const userVotesSet = votes.get(userId);

        // Skip if already voted the maximum
        if (userVotesSet.size >= maxVotesPerUser) {
          continue;
        }

        // Add votes until reaching maxVotesPerUser
        // Prioritize voting for real users (80% chance) over bots (20% chance)
        while (userVotesSet.size < maxVotesPerUser && userVotesSet.size < fruits.length) {
          let selectedFruit: string;

          // 80% chance to vote for a real user if there are any
          if (realUserFruits.length > 0 && Math.random() < 0.8) {
            selectedFruit = realUserFruits[Math.floor(Math.random() * realUserFruits.length)];
          } else if (botFruits.length > 0) {
            selectedFruit = botFruits[Math.floor(Math.random() * botFruits.length)];
          } else {
            // Fallback to any random fruit
            selectedFruit = fruits[Math.floor(Math.random() * fruits.length)];
          }

          // Add the vote if not already voted for this fruit
          if (!userVotesSet.has(selectedFruit)) {
            userVotesSet.add(selectedFruit);
            votesAdded++;
          }
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
        .map(([fruit, count]) => `\`${fruit}\`: ${count} vote(s)`)
        .join('\n');

      // Update the vote message to reflect the new votes
      await updateVoteMessageById(message);

      // Check if all players have voted and trigger callback
      const voteCompleted = checkAndTriggerVoteComplete(messageId);

      await interaction.editReply({
        content: `✅ Auto-voting complete!\n\n` +
          `**Votes added:** ${votesAdded}\n` +
          `**Total bots:** ${botsCount}\n` +
          `**Total users:** ${usersCount}\n` +
          `**Total players who voted:** ${votes.size}\n` +
          `**Vote completed:** ${voteCompleted ? '✅ Yes' : '❌ No'}\n\n` +
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
