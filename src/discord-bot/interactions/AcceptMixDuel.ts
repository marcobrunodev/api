import {
  ButtonInteraction,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  VoiceChannel,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import {
  createPendingDuel,
} from "../helpers/pending-duel.helper";
import { createDuelRooms } from "../helpers/create-duel-rooms.helper";
import { checkPlayersActiveMatch } from "../helpers/player-match-status.helper";

@BotButtonInteraction(ButtonActions.AcceptMixDuel)
export default class AcceptMixDuel extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    const [, challengerId, opponentId] = interaction.customId.split(":");

    // Only the opponent can accept
    if (interaction.user.id !== opponentId) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Only the challenged player can accept this duel!",
      });
      return;
    }

    // Verificar se algum dos jogadores já está em uma partida ativa
    const activeMatchStatus = await checkPlayersActiveMatch(this.hasura, challengerId, opponentId);
    if (activeMatchStatus.playerInMatch) {
      const matchInfo = activeMatchStatus.matchType 
        ? ` (${activeMatchStatus.matchType} - ${activeMatchStatus.matchStatus})`
        : '';
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ <@${activeMatchStatus.playerInMatch}> is already in an active match${matchInfo}! Wait for it to finish before starting a new one.`,
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply({
          content: "This command can only be used in a server.",
          embeds: [],
          components: [],
        });
        return;
      }

      // Fetch challenger and opponent users
      const challenger = await this.bot.client.users.fetch(challengerId);
      const opponent = await this.bot.client.users.fetch(opponentId);

      // Verificar se ambos os jogadores têm SteamID registrado
      const { players: dbPlayers } = await this.hasura.query({
        players: {
          __args: {
            where: {
              discord_id: {
                _in: [challengerId, opponentId],
              },
            },
          },
          discord_id: true,
          steam_id: true,
        },
      });

      const playerMap = new Map<string, string | null>();
      dbPlayers.forEach(p => {
        if (p.discord_id) {
          playerMap.set(p.discord_id, p.steam_id);
        }
      });

      const challengerRegistered = !!playerMap.get(challengerId);
      const opponentRegistered = !!playerMap.get(opponentId);

      // Se falta registro de algum jogador, criar pending duel
      if (!challengerRegistered || !opponentRegistered) {
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
            `### <@${challengerId}>  ⚔️ VS ⚔️  <@${opponentId}>\n\n` +
            `The duel was accepted! But first, both players need to register their SteamID.\n\n` +
            `**Registration Status:**\n` +
            `${challengerRegistered ? '✅' : '⏳'} <@${challengerId}> ${challengerRegistered ? '- Registered!' : '- Waiting...'}\n` +
            `${opponentRegistered ? '✅' : '⏳'} <@${opponentId}> ${opponentRegistered ? '- Registered!' : '- Waiting...'}\n\n` +
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

        const message = await interaction.editReply({
          embeds: [pendingEmbed],
          components: [row],
        });

        // Criar pending duel para rastrear
        createPendingDuel(
          message.id,
          interaction.channelId,
          guild.id,
          challengerId,
          opponentId,
          challengerRegistered,
          opponentRegistered,
        );

        return;
      }

      // Ambos registrados - criar as salas usando a função helper
      const channel = interaction.channel as TextChannel;
      
      // Verificar se o oponente está em um canal de voz
      const opponentMember = await guild.members.fetch(opponentId);
      const sourceVoiceChannel = opponentMember.voice.channel as VoiceChannel | undefined;
      
      await createDuelRooms({
        bot: this.bot,
        hasura: this.hasura,
        challengerId,
        opponentId,
        challenger,
        opponent,
        guild,
        channel,
        messageId: interaction.message.id,
        sourceVoiceChannel,
      });

    } catch (error) {
      console.error('Error creating duel:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await interaction.editReply({
        embeds: [{
          title: '❌ Error',
          description: `Failed to create duel: ${errorMessage}\n\nPlease check if the bot has adequate permissions.`,
          color: 0xe74c3c,
        }],
        components: [],
      });
    }
  }
}
