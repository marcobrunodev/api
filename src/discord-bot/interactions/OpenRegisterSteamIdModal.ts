import { ButtonInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ModalActionRowComponentBuilder } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotButtonInteraction(ButtonActions.OpenRegisterSteamIdModal)
export default class OpenRegisterSteamIdModal extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // Criar modal para coletar SteamID
    const modal = new ModalBuilder()
      .setCustomId('register_steamid_modal')
      .setTitle('Register Your SteamID');

    const steamIdInput = new TextInputBuilder()
      .setCustomId('steam_id_input')
      .setLabel('Your SteamID64')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('76561198XXXXXXXXX')
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(17);

    const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(steamIdInput);

    modal.addComponents(row);

    await interaction.showModal(modal);
  }
}
