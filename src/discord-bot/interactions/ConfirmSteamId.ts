import { ButtonInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import { getPendingRegistration, deletePendingRegistration } from "./RegisterSteamIdModal";
import {
  getPendingDuelByUser,
  updatePendingDuelRegistration,
  areBothPlayersRegistered,
  deletePendingDuel,
} from "../helpers/pending-duel.helper";
import { createDuelRooms } from "../helpers/create-duel-rooms.helper";
import {
  getPendingTeamCreation,
  deletePendingTeamCreation,
} from "../helpers/pending-team.helper";

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

      console.log(`New player registered via Discord: ${insert_players_one.name} (${insert_players_one.steam_id}) - Discord: ${interaction.user.tag}`);

      // Limpar dados pendentes
      deletePendingRegistration(messageId);

      // Verificar se há um duel pendente para este usuário
      try {
        await this.checkAndProcessPendingDuel(interaction.user.id);
      } catch (duelError) {
        console.error('Error processing pending duel:', duelError);
      }

      // Verificar se há uma criação de time pendente para este usuário
      try {
        await this.checkAndProcessPendingTeamCreation(interaction);
      } catch (teamError) {
        console.error('Error processing pending team creation:', teamError);
      }

    } catch (error) {
      console.error('Error creating player:', error);
      await interaction.followUp({
        content: `❌ An error occurred while creating your account. Please try again later.\n\n` +
          `Error: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  private async checkAndProcessPendingDuel(userId: string) {
    const pendingDuel = getPendingDuelByUser(userId);
    
    if (!pendingDuel) {
      return; // Não há duel pendente para este usuário
    }

    // Atualizar status de registro
    const updatedDuel = updatePendingDuelRegistration(pendingDuel.messageId, userId);
    
    if (!updatedDuel) {
      return;
    }

    try {
      // Buscar o canal e a mensagem do duel
      const guild = await this.bot.client.guilds.fetch(pendingDuel.guildId);
      const channel = await guild.channels.fetch(pendingDuel.channelId) as TextChannel;
      const message = await channel.messages.fetch(pendingDuel.messageId);

      // Buscar dados dos jogadores
      const challenger = await this.bot.client.users.fetch(pendingDuel.challengerId);
      const opponent = await this.bot.client.users.fetch(pendingDuel.opponentId);

      // Se ambos estão registrados, criar as salas
      if (areBothPlayersRegistered(updatedDuel)) {
        console.log(`Both players registered for duel ${pendingDuel.messageId}, creating rooms...`);

        // Usar a função helper para criar as salas
        await createDuelRooms({
          bot: this.bot,
          hasura: this.hasura,
          challengerId: pendingDuel.challengerId,
          opponentId: pendingDuel.opponentId,
          challenger,
          opponent,
          guild,
          channel,
          messageId: pendingDuel.messageId,
          // Não temos sourceVoiceChannel aqui pois é via registro de SteamID
        });

        // Limpar duel pendente
        deletePendingDuel(pendingDuel.messageId);

      } else {
        // Atualizar a mensagem mostrando que um jogador registrou
        const registerButton = new ButtonBuilder()
          .setCustomId(ButtonActions.OpenRegisterSteamIdModal)
          .setLabel('📝 Register SteamID')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(registerButton);

        const pendingEmbed = new EmbedBuilder()
          .setColor(0xFF9900)
          .setTitle('⏳ Awaiting SteamID Registration')
          .setDescription(
            `### <@${pendingDuel.challengerId}>  ⚔️ VS ⚔️  <@${pendingDuel.opponentId}>\n\n` +
            `The duel was accepted! But first, both players need to register their SteamID.\n\n` +
            `**Registration Status:**\n` +
            `${updatedDuel.challengerRegistered ? '✅' : '⏳'} <@${pendingDuel.challengerId}> ${updatedDuel.challengerRegistered ? '- Registered!' : '- Waiting...'}\n` +
            `${updatedDuel.opponentRegistered ? '✅' : '⏳'} <@${pendingDuel.opponentId}> ${updatedDuel.opponentRegistered ? '- Registered!' : '- Waiting...'}\n\n` +
            `Click the button below to register your SteamID.\n` +
            `Once both players are registered, the duel rooms will be created automatically! 🎮`,
          )
          .setThumbnail(challenger.displayAvatarURL({ size: 256 }))
          .setImage(opponent.displayAvatarURL({ size: 256 }))
          .setFooter({
            text: "BananaServer.xyz Mix • Expires in 10 minutes",
            iconURL: guild.iconURL() ?? undefined,
          })
          .setTimestamp();

        await message.edit({
          embeds: [pendingEmbed],
          components: [row],
        });
      }
    } catch (error) {
      console.error('Error processing pending duel after registration:', error);
    }
  }

  private async checkAndProcessPendingTeamCreation(interaction: ButtonInteraction) {
    const pendingTeam = getPendingTeamCreation(interaction.user.id);

    if (!pendingTeam) {
      return; // Não há criação de time pendente para este usuário
    }

    // Mostrar botão para continuar criação do time
    const createTeamButton = new ButtonBuilder()
      .setCustomId(ButtonActions.OpenCreateTeamModal)
      .setLabel('Create Team')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(createTeamButton);

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Continue Creating Your Team')
      .setDescription(
        `Your SteamID has been registered successfully!\n\n` +
        `Click the button below to continue creating your team.`,
      )
      .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: "BananaServer.xyz" })
      .setTimestamp();

    await interaction.followUp({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  }
}
