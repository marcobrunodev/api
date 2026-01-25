import { ChatInputCommandInteraction } from "discord.js";
import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { getRemakeSession } from "./RemakeVote";

/**
 * Test Auto Remake Command
 *
 * This is a TESTING-ONLY command to automatically simulate remake votes
 * for bots only (skips real users) in a remake voting session.
 *
 * Usage: /test-auto-remake <message_id> <vote_yes_or_no>
 *
 * @param message_id - The ID of the remake vote message
 * @param vote_yes_or_no - "yes" to make bots vote yes, "no" to make bots vote no
 */
@BotChatCommand(ChatCommands.TestAutoRemake)
export default class TestAutoRemake extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const messageId = interaction.options.getString('message_id', true);
      const voteChoice = interaction.options.getString('vote_yes_or_no', true);

      if (voteChoice !== 'yes' && voteChoice !== 'no') {
        await interaction.editReply({
          content: `❌ Invalid vote choice. Use "yes" or "no".`
        });
        return;
      }

      // Get the remake session
      const session = getRemakeSession(messageId);

      if (!session) {
        await interaction.editReply({
          content: `❌ No remake session found for message ID: ${messageId}`
        });
        return;
      }

      // Fetch the message to get the buttons
      const message = await interaction.channel.messages.fetch(messageId);

      if (!message) {
        await interaction.editReply({
          content: `❌ Message not found with ID: ${messageId}`
        });
        return;
      }

      // Get guild to check which users are bots
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({
          content: `❌ This command can only be used in a server.`
        });
        return;
      }

      // Find all allowed voters that are bots and haven't voted yet
      const botsToVote: string[] = [];
      for (const voterId of session.allowedVoters) {
        // Skip if already voted
        if (session.votes.has(voterId)) {
          continue;
        }

        try {
          const member = await guild.members.fetch(voterId);
          if (member.user.bot) {
            botsToVote.push(voterId);
          }
        } catch (error) {
          console.error(`Failed to fetch member ${voterId}:`, error);
        }
      }

      if (botsToVote.length === 0) {
        await interaction.editReply({
          content: `✅ No bots need to vote (all bots have already voted or no bots in session)`
        });
        return;
      }

      // Simulate votes for all bots
      const voteValue = voteChoice === 'yes';
      for (const botId of botsToVote) {
        session.votes.set(botId, voteValue);
        console.log(`🤖 [TEST AUTO REMAKE] Bot ${botId} voted ${voteChoice}`);
      }

      await interaction.editReply({
        content: `✅ Successfully simulated ${botsToVote.length} bot vote(s) for **${voteChoice}**!`
      });

      // Update the vote message to reflect the new votes
      // The countdown will handle checking if vote is complete

    } catch (error) {
      this.logger.error('Error in test-auto-remake command:', error);
      await interaction.editReply({
        content: `❌ Error simulating remake votes: ${error.message}`
      });
    }
  }
}
