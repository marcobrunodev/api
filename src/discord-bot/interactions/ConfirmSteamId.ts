import { ButtonInteraction } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import { getPendingRegistration, deletePendingRegistration } from "./RegisterSteamIdModal";

@BotButtonInteraction(ButtonActions.ConfirmSteamId)
export default class ConfirmSteamId extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    await interaction.deferUpdate();

    const [, userId] = interaction.customId.split(":");
    const messageId = interaction.message.id;

    // Verificar se é o usuário correto
    if (interaction.user.id !== userId) {
      await interaction.followUp({
        content: '❌ This confirmation is not for you!',
        ephemeral: true,
      });
      return;
    }

    // Buscar dados pendentes
    const pending = getPendingRegistration(messageId);

    if (!pending) {
      await interaction.followUp({
        content: '❌ Registration session expired. Please try again with `/steamid`',
        ephemeral: true,
      });
      return;
    }

    // Criar jogador no banco de dados
    try {
      const avatarUrl = pending.steamData?.avatarfull || interaction.user.displayAvatarURL();

      const { insert_players_one } = await this.hasura.mutation({
        insert_players_one: {
          __args: {
            object: {
              steam_id: pending.steamId,
              name: pending.generatedUsername,
              discord_id: pending.userId,
              avatar_url: avatarUrl,
            },
          },
          steam_id: true,
          name: true,
        },
      });

      // Atualizar mensagem para mostrar sucesso
      await interaction.editReply({
        content: `✅ **Account created successfully!**\n\n` +
          `**Username:** ${insert_players_one.name}\n` +
          `**Steam ID:** ${insert_players_one.steam_id}\n` +
          `**Discord:** ${interaction.user.tag}\n\n` +
          `You can now use BananaServer features! If you login via Steam on the website, it will use this same account.`,
        embeds: [],
        components: []
      });

      this.logger.log(`New player registered via Discord: ${insert_players_one.name} (${insert_players_one.steam_id}) - Discord: ${interaction.user.tag}`);

      // Limpar dados pendentes
      deletePendingRegistration(messageId);

    } catch (error) {
      this.logger.error('Error creating player:', error);
      await interaction.followUp({
        content: `❌ An error occurred while creating your account. Please try again later.\n\n` +
          `Error: ${error.message}`,
        ephemeral: true,
      });
    }
  }
}
