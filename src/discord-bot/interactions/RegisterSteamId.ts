import { ChatInputCommandInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ModalActionRowComponentBuilder } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";

@BotChatCommand(ChatCommands.RegisterSteamId)
export default class RegisterSteamId extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    // Verificar se o usuário já tem uma conta
    const { players } = await this.hasura.query({
      players: {
        __args: {
          where: {
            discord_id: {
              _eq: interaction.user.id,
            },
          },
        },
        steam_id: true,
        name: true,
      },
    });

    if (players.length > 0) {
      const player = players[0];
      await interaction.reply({
        content: `❌ You already have an account linked!\n\n` +
          `**Username:** ${player.name}\n` +
          `**Steam ID:** ${player.steam_id}\n` +
          `**Discord ID:** ${interaction.user.id}`,
        ephemeral: true,
      });
      return;
    }

    // Criar modal para coletar apenas SteamID
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
