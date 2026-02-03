import {
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import {
  getVetoSession,
  banMap,
  getVetoStatusText,
  formatMapName,
  DuelVetoSession,
  DuelMap,
} from "../helpers/duel-veto.helper";
import { checkServerAvailability } from "../helpers/server-availability.helper";
import { AppConfig } from "src/configs/types/AppConfig";

@BotButtonInteraction(ButtonActions.DuelVetoBan)
export default class DuelVetoBan extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // customId format: dvb:messageId:mapId
    const [, vetoMessageId, mapId] = interaction.customId.split(":");

    const session = getVetoSession(vetoMessageId);
    
    if (!session) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "❌ Veto session not found or already finished.",
      });
      return;
    }

    // Verificar se é um dos jogadores do duel
    if (interaction.user.id !== session.challengerId && interaction.user.id !== session.opponentId) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "❌ Only duel participants can ban maps!",
      });
      return;
    }

    // Verificar se é a vez do jogador
    if (interaction.user.id !== session.currentTurn) {
      const otherPlayer = session.currentTurn === session.challengerId 
        ? session.challengerId 
        : session.opponentId;
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⏳ It's not your turn! Waiting for <@${otherPlayer}> to ban a map.`,
      });
      return;
    }

    await interaction.deferUpdate();

    // Banir o mapa
    const result = banMap(vetoMessageId, interaction.user.id, mapId);

    if (!result.success) {
      await interaction.followUp({
        flags: MessageFlags.Ephemeral,
        content: `❌ ${result.error}`,
      });
      return;
    }

    if (result.finished && result.selectedMap) {
      // Veto finalizado - mostrar o mapa selecionado
      const finalEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🗺️ Map Selected!")
        .setDescription(
          `### <@${session.challengerId}>  ⚔️ VS ⚔️  <@${session.opponentId}>\n\n` +
          `The map for this duel is:\n\n` +
          `# 🎮 ${formatMapName(result.selectedMap.name)}\n\n` +
          getVetoStatusText(result.session!) +
          `\n⏳ **Creating duel server...**`
        )
        .setFooter({
          text: "From BananaServer.xyz with 🍌",
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [finalEmbed],
        components: [],
      });

      // Criar a partida de duel
      try {
        await this.createDuelMatch(
          session,
          result.selectedMap,
          interaction.channel as TextChannel
        );
      } catch (error) {
        console.error('Error creating duel match:', error);
        await interaction.followUp({
          content: `❌ Error creating duel match. Please contact an administrator.`,
        });
      }

      return;
    }

    // Atualizar a mensagem com o novo estado do veto
    const availableMaps = result.session!.maps.filter(m => !m.banned);
    const currentTurnPlayer = result.session!.currentTurn;

    const vetoEmbed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle("🗺️ Map Veto")
      .setDescription(
        `### <@${session.challengerId}>  ⚔️ VS ⚔️  <@${session.opponentId}>\n\n` +
        `**Current Turn:** <@${currentTurnPlayer}>\n` +
        `**Bans Remaining:** ${result.session!.bansRemaining[currentTurnPlayer]}\n\n` +
        getVetoStatusText(result.session!) +
        `\n<@${currentTurnPlayer}>, click a map button to ban it!`
      )
      .setFooter({
        text: "From BananaServer.xyz with 🍌",
      })
      .setTimestamp();

    // Criar botões para os mapas disponíveis
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    
    for (let i = 0; i < availableMaps.length; i++) {
      const map = availableMaps[i];
      const button = new ButtonBuilder()
        .setCustomId(`${ButtonActions.DuelVetoBan}:${vetoMessageId}:${map.id}`)
        .setLabel(formatMapName(map.name))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🗺️');

      currentRow.addComponents(button);

      // Discord permite no máximo 5 botões por row
      if ((i + 1) % 5 === 0 || i === availableMaps.length - 1) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
      }
    }

    await interaction.editReply({
      embeds: [vetoEmbed],
      components: rows,
    });
  }

  /**
   * Cria a partida de duel após o veto terminar
   */
  private async createDuelMatch(
    session: DuelVetoSession,
    selectedMap: DuelMap,
    channel: TextChannel
  ) {
    console.log(`🎮 [DUEL] Creating duel match with map: ${selectedMap.name} (${selectedMap.id})`);

    // Verificar disponibilidade de servidores
    const serverStatus = await checkServerAvailability(this.hasura);
    
    if (!serverStatus.available) {
      console.log(`⚠️ [DUEL] No servers available (${serverStatus.availableServers}/${serverStatus.totalServers})`);
      
      const waitingEmbed = new EmbedBuilder()
        .setColor(0xFF9900)
        .setTitle('⏳ Waiting for Server')
        .setDescription(
          `### <@${session.challengerId}>  ⚔️ VS ⚔️  <@${session.opponentId}>\n\n` +
          `**All servers are currently in use!**\n\n` +
          `**Map:** ${formatMapName(selectedMap.name)}\n` +
          `**Servers:** 0/${serverStatus.totalServers} available\n\n` +
          `Your duel will start automatically when a server becomes available.\n` +
          `You will be notified here when the server is ready.`
        )
        .setFooter({
          text: 'From BananaServer.xyz with 🍌',
        })
        .setTimestamp();

      await channel.send({
        content: `<@${session.challengerId}> <@${session.opponentId}>`,
        embeds: [waitingEmbed],
      });
    }

    // Verificar se o guild está registrado no banco
    let discordGuildId: string | undefined;
    try {
      const { discord_guilds_by_pk } = await this.hasura.query({
        discord_guilds_by_pk: {
          __args: {
            id: session.guildId,
          },
          id: true,
        },
      });
      if (discord_guilds_by_pk) {
        discordGuildId = session.guildId;
      }
    } catch (error) {
      console.warn(`⚠️ [DUEL] Guild ${session.guildId} not registered in database, proceeding without guild id`);
    }

    // Criar partida no banco
    const match = await this.matchAssistant.createMatchBasedOnType(
      "Duel",
      "Duel",
      {
        mr: 8, // Duels geralmente são MR8
        best_of: 1,
        knife: false, // Sem knife round em duels
        map: selectedMap.id,
        overtime: true,
        maps: [],
        ...(discordGuildId && { discord_guild_id: discordGuildId }),
      }
    );

    const matchId = match.id;
    console.log(`🎮 [DUEL] [${matchId}] Match created for map ${selectedMap.name}`);

    // Registrar partida de duel para processamento quando terminar
    this.bot.registerDuelMatch(
      matchId,
      session.guildId,
      session.categoryId,
      session.challengerId,
      session.opponentId
    );

    // Buscar o guild
    const guild = await this.bot.client.guilds.fetch(session.guildId);

    // Adicionar challenger ao lineup 1
    try {
      const challengerMember = await guild.members.fetch(session.challengerId);
      await this.discordPickPlayer.addDiscordUserToLineup(
        matchId,
        match.lineup_1_id,
        challengerMember.user
      );
      console.log(`🎮 [DUEL] [${matchId}] Added challenger ${session.challengerId} to lineup 1`);
    } catch (error) {
      console.error(`❌ [DUEL] Error adding challenger to lineup:`, error);
    }

    // Adicionar opponent ao lineup 2
    try {
      const opponentMember = await guild.members.fetch(session.opponentId);
      await this.discordPickPlayer.addDiscordUserToLineup(
        matchId,
        match.lineup_2_id,
        opponentMember.user
      );
      console.log(`🎮 [DUEL] [${matchId}] Added opponent ${session.opponentId} to lineup 2`);
    } catch (error) {
      console.error(`❌ [DUEL] Error adding opponent to lineup:`, error);
    }

    // Iniciar partida (vai atribuir servidor automaticamente)
    await this.discordPickPlayer.startMatch(matchId);
    console.log(`🎮 [DUEL] [${matchId}] Match started, server assignment in progress`);

    // Aguardar um pouco para dar tempo do servidor ser atribuído
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Buscar informações da partida com servidor
    const { matches_by_pk } = await this.hasura.query({
      matches_by_pk: {
        __args: {
          id: matchId
        },
        id: true,
        status: true,
        connection_link: true,
        server: {
          host: true,
          port: true,
          tv_port: true,
          game_server_node: {
            public_ip: true,
          }
        }
      }
    });

    if (matches_by_pk?.server) {
      const server = matches_by_pk.server;
      const serverIp = server.game_server_node?.public_ip || server.host;
      const connectCommand = `connect ${serverIp}:${server.port}`;
      const tvCommand = server.tv_port ? `connect ${serverIp}:${server.tv_port}` : null;
      const tvSection = tvCommand ? `\n**GOTV (Spectate):**\n\`\`\`\n${tvCommand}\n\`\`\`\n` : '';

      // Criar URL para abrir Steam diretamente
      const steamConnectUrl = `steam://run/730//+connect%20${serverIp}:${server.port}`;
      const quickConnectUrl = matches_by_pk.connection_link
        ? `${this.config.get<AppConfig>("app").webDomain}/quick-connect?link=${encodeURIComponent(matches_by_pk.connection_link)}`
        : `${this.config.get<AppConfig>("app").webDomain}/quick-connect?link=${encodeURIComponent(steamConnectUrl)}`;

      const matchReadyEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎮 Duel Ready!')
        .setDescription(
          `### <@${session.challengerId}>  ⚔️ VS ⚔️  <@${session.opponentId}>\n\n` +
          `**Match ID:** \`${matchId}\`\n` +
          `**Map:** ${formatMapName(selectedMap.name)}\n` +
          `**Status:** ${matches_by_pk.status}\n\n` +
          `**Connect to Server:**\n\`\`\`\n${connectCommand}\n\`\`\`\n` +
          tvSection +
          `Good luck and have fun! 🍌`
        )
        .setFooter({
          text: "From BananaServer.xyz with 🍌",
        })
        .setTimestamp();

      const connectButton = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('🚀 Quick Connect')
        .setURL(quickConnectUrl);

      await channel.send({
        content: `<@${session.challengerId}> <@${session.opponentId}>`,
        embeds: [matchReadyEmbed],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(connectButton)
        ],
      });
    } else {
      // Servidor ainda não atribuído
      const waitingEmbed = new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle('⏳ Duel Created')
        .setDescription(
          `### <@${session.challengerId}>  ⚔️ VS ⚔️  <@${session.opponentId}>\n\n` +
          `**Match ID:** \`${matchId}\`\n` +
          `**Map:** ${formatMapName(selectedMap.name)}\n` +
          `**Status:** Waiting for server...\n\n` +
          `The server is being prepared. You'll receive connection details shortly!`
        )
        .setFooter({
          text: "From BananaServer.xyz with 🍌",
        })
        .setTimestamp();

      await channel.send({
        content: `<@${session.challengerId}> <@${session.opponentId}>`,
        embeds: [waitingEmbed],
      });
    }
  }
}
