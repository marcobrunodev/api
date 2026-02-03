import {
  ButtonInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotButtonInteraction(ButtonActions.DeclineMixDuel)
export default class DeclineMixDuel extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    const [, challengerId, opponentId] = interaction.customId.split(":");

    // Only the opponent can decline
    if (interaction.user.id !== opponentId) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Only the challenged player can decline this duel!",
      });
      return;
    }

    // Fetch challenger and opponent users to get their avatars
    const challenger = await this.bot.client.users.fetch(challengerId);
    const opponent = await this.bot.client.users.fetch(opponentId);

    const declinedEmbed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("❌ Duel Declined")
      .setDescription(
        `### <@${challengerId}>  ⚔️ VS ⚔️  <@${opponentId}>\n\n` +
        `<@${opponentId}> has **declined** the duel challenge!`,
      )
      .setThumbnail(challenger.displayAvatarURL({ size: 256 }))
      .setImage(opponent.displayAvatarURL({ size: 256 }))
      .setFooter({
        text: "BananaServer.xyz Mix",
        iconURL: interaction.guild?.iconURL() ?? undefined,
      })
      .setTimestamp();

    await interaction.update({
      content: "",
      embeds: [declinedEmbed],
      components: [],
    });
  }
}
