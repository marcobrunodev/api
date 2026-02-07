import {
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalActionRowComponentBuilder,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import { deletePendingTeamCreation } from "../helpers/pending-team.helper";

@BotButtonInteraction(ButtonActions.OpenCreateTeamModal)
export default class OpenCreateTeamModal extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // Limpar pending team creation
    deletePendingTeamCreation(interaction.user.id);

    const modal = new ModalBuilder()
      .setCustomId("create_team_modal")
      .setTitle("Create Team");

    const teamNameInput = new TextInputBuilder()
      .setCustomId("team_name")
      .setLabel("Team Name")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Enter your team name")
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(32);

    const shortNameInput = new TextInputBuilder()
      .setCustomId("short_name")
      .setLabel("Short Name (max 3 characters)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("ABC")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3);

    const row1 = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(teamNameInput);
    const row2 = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(shortNameInput);

    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
  }
}
