import {
  ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalActionRowComponentBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";
import { ButtonActions } from "../enums/ButtonActions";
import { createPendingTeamCreation } from "../helpers/pending-team.helper";

@BotChatCommand(ChatCommands.CreateTeam)
export default class CreateTeam extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    // Check if player has SteamID registered
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
      },
    });

    const player = players.at(0);

    if (!player) {
      // Registrar pending team creation
      createPendingTeamCreation(interaction.user.id, interaction.user.username);

      const registerButton = new ButtonBuilder()
        .setCustomId(ButtonActions.OpenRegisterSteamIdModal)
        .setLabel("Register SteamID")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(registerButton);

      const embed = new EmbedBuilder()
        .setColor(0xff9900)
        .setTitle("Awaiting SteamID Registration")
        .setDescription(
          `You need to register your SteamID before creating a team.\n\n` +
          `**Registration Status:**\n` +
          `<@${interaction.user.id}> - Waiting...\n\n` +
          `**How to find your SteamID64:**\n` +
          `1. Go to [steamid.io](https://steamid.io/)\n` +
          `2. Enter your Steam profile URL\n` +
          `3. Click "Lookup"\n` +
          `4. Your SteamID64 will be shown there\n\n` +
          `Click the button below to register your SteamID.\n` +
          `Once registered, you will be able to create your team!`,
        )
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: "BananaServer.xyz" })
        .setTimestamp();

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [embed],
        components: [row],
      });
      return;
    }

    // Player has SteamID - show the modal
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
