import { ButtonInteraction, MessageFlags } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotButtonInteraction(ButtonActions.AcceptTeamMember)
export default class AcceptTeamMember extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // Extract team ID and player ID from custom ID (format: "accept_team_member:teamId:playerId")
    const [, teamId, playerId] = interaction.customId.split(":");

    // For now, just acknowledge the button click
    await interaction.reply({
      content: `Accept functionality coming soon! (Team: ${teamId}, Player: <@${playerId}>)`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
