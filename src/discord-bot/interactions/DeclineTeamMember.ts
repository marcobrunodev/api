import { ButtonInteraction, MessageFlags } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotButtonInteraction(ButtonActions.DeclineTeamMember)
export default class DeclineTeamMember extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // Extract team ID and player ID from custom ID (format: "decline_team_member:teamId:playerId")
    const [, teamId, playerId] = interaction.customId.split(":");

    try {
      // Get team info to check if the user clicking is the captain
      const { teams_by_pk: team } = await this.hasura.query({
        teams_by_pk: {
          __args: {
            id: teamId,
          },
          id: true,
          name: true,
          owner: {
            discord_id: true,
          },
        },
      });

      if (!team) {
        await interaction.reply({
          content: "❌ Team not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check if the user clicking is the captain
      if (team.owner?.discord_id !== interaction.user.id) {
        await interaction.reply({
          content: "❌ Only the team captain can decline join requests.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Acknowledge the interaction first
      await interaction.deferUpdate();

      // Delete the join request message
      try {
        await interaction.message.delete();
      } catch (deleteError) {
        console.error("Error deleting join request message:", deleteError);
      }

      // Try to send a DM to the player who was declined
      try {
        const declinedUser = await interaction.client.users.fetch(playerId);
        await declinedUser.send({
          content: `❌ Your request to join **${team.name}** was declined by the captain.\n\n` +
            `_This message is only visible to you._`,
        });
      } catch (dmError) {
        // If DM fails (user has DMs disabled), send in the channel as ephemeral
        // But we can't send ephemeral to another user, so we just log it
        console.warn(`Could not send DM to declined player ${playerId}:`, dmError);
      }

    } catch (error) {
      console.error("Error declining team member:", error);
      await interaction.reply({
        content: "❌ An error occurred while processing the request.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
