import { ButtonInteraction } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import { deletePendingRegistration } from "./RegisterSteamIdModal";

@BotButtonInteraction(ButtonActions.CancelSteamId)
export default class CancelSteamId extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    await interaction.deferUpdate();

    const [, userId] = interaction.customId.split(":");
    const messageId = interaction.message.id;

    // Verificar se é o usuário correto
    if (interaction.user.id !== userId) {
      await interaction.followUp({
        content: '❌ This cancellation is not for you!',
        ephemeral: true,
      });
      return;
    }

    // Limpar dados pendentes
    deletePendingRegistration(messageId);

    // Atualizar mensagem
    await interaction.editReply({
      content: '❌ **Registration cancelled.**\n\nYou can start over anytime with `/steamid`',
      embeds: [],
      components: []
    });

    this.logger.log(`User ${interaction.user.tag} cancelled Steam ID registration`);
  }
}
