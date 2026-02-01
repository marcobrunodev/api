import { ChatInputCommandInteraction, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";
import { ButtonActions } from "../enums/ButtonActions";

@BotChatCommand(ChatCommands.CheckSteamId)
export default class CheckSteamId extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply("This command can only be used in a server.");
        return;
      }

      // Buscar o canal Queue Mix
      await guild.channels.fetch();
      const queueMixChannel = guild.channels.cache.find(
        (ch: any) => ch.type === ChannelType.GuildVoice && ch.name === '🍌 Queue Mix'
      );

      if (!queueMixChannel || !('members' in queueMixChannel)) {
        await interaction.editReply("❌ Queue Mix channel not found. Please run `/init` first.");
        return;
      }

      const members = Array.from((queueMixChannel as any).members.values());

      if (members.length === 0) {
        await interaction.editReply("❌ No players in Queue Mix channel.");
        return;
      }

      // Buscar Discord IDs de todos os membros
      const discordIds = members.map((m: any) => m.id);

      // Buscar players no banco de dados
      const { players } = await this.hasura.query({
        players: {
          __args: {
            where: {
              discord_id: {
                _in: discordIds,
              },
            },
          },
          discord_id: true,
          steam_id: true,
          name: true,
        },
      });

      // Criar mapa de Discord ID -> SteamID
      const playerMap = new Map<string, { steam_id: string | null; name: string | null }>();
      players.forEach(p => {
        if (p.discord_id) {
          playerMap.set(p.discord_id, {
            steam_id: p.steam_id,
            name: p.name,
          });
        }
      });

      // Identificar players sem SteamID
      const playersWithoutSteamId: string[] = [];
      const playersWithSteamId: string[] = [];

      for (const member of members) {
        const playerId = (member as any).id;
        const playerData = playerMap.get(playerId);

        if (!playerData || !playerData.steam_id) {
          playersWithoutSteamId.push(playerId);
        } else {
          playersWithSteamId.push(playerId);
        }
      }

      // Se todos têm SteamID configurado
      if (playersWithoutSteamId.length === 0) {
        await interaction.editReply({
          embeds: [{
            title: '✅ All Players Ready!',
            description: `All **${members.length}** player(s) in Queue Mix have their SteamID configured!\n\n${playersWithSteamId.map(id => `✅ <@${id}>`).join('\n')}`,
            color: 0x00FF00,
            footer: {
              text: 'From BananaServer.xyz with 🍌',
            },
            timestamp: new Date().toISOString(),
          }]
        });
        return;
      }

      // Criar botão de registro
      const registerButton = new ButtonBuilder()
        .setCustomId(ButtonActions.OpenRegisterSteamIdModal)
        .setLabel('📝 Register SteamID')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(registerButton);

      // Enviar mensagem mencionando quem não tem SteamID
      await interaction.editReply({
        embeds: [{
          title: '⚠️ SteamID Registration Required',
          description:
            `**${playersWithoutSteamId.length}** player(s) need to register their SteamID64 to play!\n\n` +
            '**Players without SteamID:**\n' +
            playersWithoutSteamId.map(id => `❌ <@${id}>`).join('\n') +
            '\n\n**How to find your SteamID64:**\n' +
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
      });

    } catch (error) {
      this.logger.error('Error checking SteamID:', error);
      await interaction.editReply({
        content: `❌ Error checking SteamID. Please try again later.`
      });
    }
  }
}
