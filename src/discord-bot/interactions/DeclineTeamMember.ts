import { ButtonInteraction, MessageFlags } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotButtonInteraction(ButtonActions.DeclineTeamMember)
export default class DeclineTeamMember extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // Extract team ID and player ID from custom ID (format: "decline_team_member:teamId:playerId")
    const [, teamId, playerId] = interaction.customId.split(":");

    // For now, just acknowledge the button click
    await interaction.reply({
      content: `Decline functionality coming soon! (Team: ${teamId}, Player: <@${playerId}>)`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
