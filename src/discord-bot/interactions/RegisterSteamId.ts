import { ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";
import { ButtonActions } from "../enums/ButtonActions";

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
        created_at: true,
      },
    });

    if (players.length > 0) {
      const player = players[0];

      // Obter avatar do usuário
      const avatarUrl = interaction.user.displayAvatarURL({ size: 256 });

      // Formatar data de criação (usando created_at se disponível)
      const registrationDate = player.created_at
        ? new Date(player.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
        : 'Unknown';

      await interaction.reply({
        embeds: [{
          title: '✅ Account Already Registered',
          description: `Your account is already linked to BananaServer.xyz!`,
          color: 0x00FF00,
          thumbnail: {
            url: avatarUrl,
          },
          fields: [
            {
              name: '👤 Username',
              value: player.name || interaction.user.username,
              inline: true,
            },
            {
              name: '🎮 Steam ID',
              value: player.steam_id || 'Not set',
              inline: true,
            },
            {
              name: '📅 Registered on',
              value: registrationDate,
              inline: false,
            },
          ],
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          },
          timestamp: new Date().toISOString(),
        }],
        ephemeral: true,
      });
      return;
    }

    const registerButton = new ButtonBuilder()
      .setCustomId(ButtonActions.OpenRegisterSteamIdModal)
      .setLabel('📝 Register SteamID')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(registerButton);

    // Enviar mensagem ephemeral com botão de registro
    await interaction.reply({
      embeds: [{
        title: '🎮 SteamID Registration Required',
        description:
          '**You need to register your SteamID64 to play!**\n\n' +
          '**How to find your SteamID64:**\n' +
          '1. Open your Steam client\n' +
          '2. Click on your profile name\n' +
          '3. Click "Account Details"\n' +
          '4. Your SteamID64 will be shown there\n\n' +
          'Click the button below to register!',
        color: 0xFF9900,
        footer: {
          text: 'From BananaServer.xyz with 🍌',
        },
        timestamp: new Date().toISOString(),
      }],
      components: [row],
      ephemeral: true,
    });

    const channel = interaction.channel;
    if (channel && 'send' in channel) {
      await channel.send({
        content: `<@${interaction.user.id}>
📺 **Video Tutorial to find your SteamID64:**\nhttps://youtu.be/DHFmBEL-s1I`,
      });
    }
  }
}
