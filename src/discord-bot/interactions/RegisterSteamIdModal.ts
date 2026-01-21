import { ModalSubmitInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotModalSubmit } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import { ConfigService } from "@nestjs/config";

// Armazenar dados temporários de registro pendentes
const pendingRegistrations = new Map<string, {
  steamId: string;
  generatedUsername: string;
  steamData: any;
  userId: string;
}>();

export function getPendingRegistration(messageId: string) {
  return pendingRegistrations.get(messageId);
}

export function deletePendingRegistration(messageId: string) {
  pendingRegistrations.delete(messageId);
}

@BotModalSubmit('register_steamid_modal')
export default class RegisterSteamIdModal extends DiscordInteraction {
  async handler(interaction: ModalSubmitInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const steamId = interaction.fields.getTextInputValue('steam_id_input');

    // Validar SteamID64 format (deve começar com 7656119 e ter 17 dígitos)
    if (!/^7656119\d{10}$/.test(steamId)) {
      await interaction.editReply({
        content: '❌ Invalid SteamID64 format! It should start with 7656119 and have 17 digits total.\n\n' +
          'Example: 76561198123456789'
      });
      return;
    }

    // Verificar se o SteamID já está em uso
    const { players: existingSteamPlayers } = await this.hasura.query({
      players: {
        __args: {
          where: {
            steam_id: {
              _eq: steamId,
            },
          },
        },
        steam_id: true,
        name: true,
        discord_id: true,
      },
    });

    if (existingSteamPlayers.length > 0) {
      const existingPlayer = existingSteamPlayers[0];

      // Se já tem Discord ID associado e é diferente
      if (existingPlayer.discord_id && existingPlayer.discord_id !== interaction.user.id) {
        await interaction.editReply({
          content: `❌ This SteamID is already registered to another Discord account!`
        });
        return;
      }

      // Se é o mesmo usuário mas sem Discord ID, vamos atualizar
      if (!existingPlayer.discord_id) {
        await this.hasura.mutation({
          update_players: {
            __args: {
              where: {
                steam_id: {
                  _eq: existingPlayer.steam_id,
                },
              },
              _set: {
                discord_id: interaction.user.id,
              },
            },
            affected_rows: true,
          },
        });

        await interaction.editReply({
          content: `✅ Successfully linked your Discord to existing account!\n\n` +
            `**Username:** ${existingPlayer.name}\n` +
            `**Steam ID:** ${steamId}\n` +
            `**Discord:** ${interaction.user.tag}`
        });
        return;
      }
    }

    // Buscar dados da Steam API
    try {
      const steamConfig = this.config.get('steam');
      const steamApiKey = steamConfig?.steamApiKey;

      if (!steamApiKey) {
        await interaction.editReply({
          content: '❌ Steam API is not configured. Please contact an administrator.'
        });
        return;
      }

      // Buscar dados da Steam
      const response = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamApiKey}&steamids=${steamId}`
      );

      if (!response.ok) {
        throw new Error(`Steam API returned ${response.status}`);
      }

      const data = await response.json();

      if (!data.response?.players?.length) {
        await interaction.editReply({
          content: '❌ Could not find a Steam profile with this SteamID. Please verify your SteamID64 is correct.'
        });
        return;
      }

      const steamData = data.response.players[0];
      const steamUsername = steamData.personaname || 'Player';

      // Gerar username único baseado no nome da Steam
      let generatedUsername = steamUsername;
      let suffix = 1;

      // Verificar se o username já existe e adicionar sufixo numérico se necessário
      while (true) {
        const { players: existingPlayers } = await this.hasura.query({
          players: {
            __args: {
              where: {
                name: {
                  _ilike: generatedUsername,
                },
              },
            },
            steam_id: true,
          },
        });

        if (existingPlayers.length === 0) {
          break; // Username disponível
        }

        // Adicionar sufixo numérico
        generatedUsername = `${steamUsername}${suffix.toString().padStart(2, '0')}`;
        suffix++;

        // Limite de segurança
        if (suffix > 99) {
          await interaction.editReply({
            content: '❌ Could not generate a unique username. Please contact an administrator.'
          });
          return;
        }
      }

      // Criar embed com dados da Steam
      const embed = new EmbedBuilder()
        .setTitle('🎮 Confirm Your Registration')
        .setColor(0x00FF00)
        .setDescription('Please review your information and confirm to create your account.')
        .addFields(
          { name: '👤 BananaServer Username', value: generatedUsername, inline: true },
          { name: '🔗 Steam ID', value: steamId, inline: true },
          { name: '💬 Discord', value: interaction.user.tag, inline: true },
          { name: '🎯 Steam Name', value: steamData.personaname || 'Unknown', inline: true },
          { name: '🌐 Profile URL', value: steamData.profileurl || 'Unknown', inline: false }
        )
        .setFooter({ text: 'Click "Confirm" to create your account or "Cancel" to abort' })
        .setTimestamp();

      if (steamData.avatarfull) {
        embed.setThumbnail(steamData.avatarfull);
      }

      // Botões de confirmação
      const confirmButton = new ButtonBuilder()
        .setCustomId(`${ButtonActions.ConfirmSteamId}:${interaction.user.id}`)
        .setLabel('✅ Confirm')
        .setStyle(ButtonStyle.Success);

      const cancelButton = new ButtonBuilder()
        .setCustomId(`${ButtonActions.CancelSteamId}:${interaction.user.id}`)
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(confirmButton, cancelButton);

      const message = await interaction.editReply({
        content: null,
        embeds: [embed],
        components: [row]
      });

      // Armazenar dados temporários
      pendingRegistrations.set(message.id, {
        steamId,
        generatedUsername,
        steamData,
        userId: interaction.user.id,
      });

      // Limpar após 5 minutos se não confirmar
      setTimeout(() => {
        pendingRegistrations.delete(message.id);
      }, 5 * 60 * 1000);

    } catch (error) {
      this.logger.error('Error fetching Steam data:', error);
      await interaction.editReply({
        content: `❌ An error occurred while fetching Steam profile data. Please try again later.\n\n` +
          `Error: ${error.message}`
      });
    }
  }
}
