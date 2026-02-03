import {
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";
import { ButtonActions } from "../enums/ButtonActions";

@BotChatCommand(ChatCommands.MixDuel)
export default class MixDuel extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    const opponent = interaction.options.getUser("opponent", true);
    const challenger = interaction.user;
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "This command can only be used in a server.",
      });
      return;
    }

    if (opponent.id === challenger.id) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "You cannot challenge yourself!",
      });
      return;
    }

    if (opponent.bot) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "You cannot challenge a bot!",
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle("⚔️ Duel Challenge!")
      .setDescription(
        `### <@${challenger.id}>  ⚔️ VS ⚔️  <@${opponent.id}>\n\n` +
        `<@${opponent.id}>, you have been challenged to a 1v1 Duel!`,
      )
      .setThumbnail(challenger.displayAvatarURL({ size: 256 }))
      .setImage(opponent.displayAvatarURL({ size: 256 }))
      .setFooter({
        text: "BananaServer.xyz Mix",
        iconURL: guild.iconURL() ?? undefined,
      })
      .setTimestamp();

    const acceptButton = new ButtonBuilder()
      .setCustomId(`${ButtonActions.AcceptMixDuel}:${challenger.id}:${opponent.id}`)
      .setLabel("Accept Challenge")
      .setStyle(ButtonStyle.Success)
      .setEmoji("👍");

    const declineButton = new ButtonBuilder()
      .setCustomId(`${ButtonActions.DeclineMixDuel}:${challenger.id}:${opponent.id}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("👎");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      acceptButton,
      declineButton,
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
    });
  }
}
