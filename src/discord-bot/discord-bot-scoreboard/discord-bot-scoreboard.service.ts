import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { DiscordBotService } from '../discord-bot.service';
import { HasuraService } from '../../hasura/hasura.service';

@Injectable()
export class DiscordBotScoreboardService {
  constructor(
    private readonly logger: Logger,
    @Inject(forwardRef(() => DiscordBotService))
    private readonly bot: DiscordBotService,
    private readonly hasura: HasuraService,
  ) {}

  /**
   * Atualiza o scoreboard da partida no Discord
   */
  public async updateMatchScoreboard(matchId: string) {
    try {
      const logChannel = this.bot.getMatchLogChannel(matchId);

      if (!logChannel) {
        this.logger.warn(`[Scoreboard] No log channel found for match ${matchId}`);
        return;
      }

      // Buscar stats da partida
      const matchStats = await this.getMatchStats(matchId);

      if (!matchStats) {
        this.logger.warn(`[Scoreboard] No stats found for match ${matchId}`);
        return;
      }

      // Buscar o canal e mensagem
      const guild = await this.bot.client.guilds.fetch(logChannel.guildId);
      const channel = await guild.channels.fetch(logChannel.channelId);

      if (!channel || !('send' in channel)) {
        this.logger.warn(`[Scoreboard] Channel ${logChannel.channelId} not found or invalid`);
        return;
      }

      const message = await channel.messages.fetch(logChannel.messageId);

      if (!message) {
        this.logger.warn(`[Scoreboard] Message ${logChannel.messageId} not found`);
        return;
      }

      // Formatar scoreboard
      const embed = this.formatScoreboard(matchStats);

      // Atualizar mensagem
      await message.edit({ embeds: [embed] });

      this.logger.log(`[Scoreboard] Updated scoreboard for match ${matchId}`);
    } catch (error) {
      this.logger.error(`[Scoreboard] Error updating scoreboard for match ${matchId}:`, error);
    }
  }

  /**
   * Busca stats da partida do banco de dados usando aggregates (igual ao site)
   */
  private async getMatchStats(matchId: string) {
    // Query usando aggregates do Hasura (igual ao site web)
    const { matches_by_pk } = await this.hasura.query({
      matches_by_pk: {
        __args: { id: matchId },
        id: true,
        status: true,
        match_maps: {
          __args: {
            order_by: [{ created_at: 'asc' }],
          },
          id: true,
          status: true,
          lineup_1_score: true,
          lineup_2_score: true,
          map: {
            name: true,
          },
        },
        lineup_1: {
          id: true,
          name: true,
          lineup_players: {
            steam_id: true,
            player: {
              steam_id: true,
              name: true,
              // Kills aggregate (excluindo team kills)
              kills_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    team_kill: { _eq: false },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              // Assists aggregate (excluindo team assists)
              assists_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    is_team_assist: { _eq: false },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              // Deaths aggregate
              deaths_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
            },
          },
        },
        lineup_2: {
          id: true,
          name: true,
          lineup_players: {
            steam_id: true,
            player: {
              steam_id: true,
              name: true,
              kills_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    team_kill: { _eq: false },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              assists_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    is_team_assist: { _eq: false },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              deaths_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
            },
          },
        },
      },
    });

    if (!matches_by_pk) {
      return null;
    }

    // Processar stats de ambos os lineups
    const processLineupStats = (lineup: any) => {
      return (lineup?.lineup_players || []).map((lp: any) => ({
        steam_id: lp.player.steam_id,
        name: lp.player.name,
        kills: lp.player.kills_aggregate?.aggregate?.count || 0,
        assists: lp.player.assists_aggregate?.aggregate?.count || 0,
        deaths: lp.player.deaths_aggregate?.aggregate?.count || 0,
      }));
    };

    const team1Stats = processLineupStats(matches_by_pk.lineup_1);
    const team2Stats = processLineupStats(matches_by_pk.lineup_2);

    // Ordenar cada time por kills
    team1Stats.sort((a: any, b: any) => b.kills - a.kills);
    team2Stats.sort((a: any, b: any) => b.kills - a.kills);

    return {
      match: matches_by_pk,
      team1Stats,
      team2Stats,
    };
  }

  /**
   * Posta o scoreboard final da partida no canal de scoreboard da guild
   */
  public async postFinalScoreboard(matchId: string, guildId: string) {
    try {
      // Buscar canal de scoreboard da guild
      const channelIds = await this.bot.getGuildChannelIds(guildId);

      if (!channelIds.scoreboard_channel_id) {
        this.logger.warn(`[Final Scoreboard] No scoreboard channel configured for guild ${guildId}`);
        return;
      }

      // Buscar stats da partida
      const matchStats = await this.getFinalMatchStats(matchId);

      if (!matchStats) {
        this.logger.warn(`[Final Scoreboard] No stats found for match ${matchId}`);
        return;
      }

      // Buscar guild e canal
      const guild = await this.bot.client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelIds.scoreboard_channel_id);

      if (!channel || !('send' in channel)) {
        this.logger.warn(`[Final Scoreboard] Scoreboard channel ${channelIds.scoreboard_channel_id} not found or invalid`);
        return;
      }

      // Formatar e enviar embed final
      const embed = this.formatFinalScoreboard(matchStats);

      await channel.send({ embeds: [embed] });

      this.logger.log(`[Final Scoreboard] Posted final scoreboard for match ${matchId} in guild ${guildId}`);
    } catch (error) {
      this.logger.error(`[Final Scoreboard] Error posting final scoreboard for match ${matchId}:`, error);
    }
  }

  /**
   * Busca stats finais da partida incluindo dados para MVP
   */
  private async getFinalMatchStats(matchId: string) {
    const { matches_by_pk } = await this.hasura.query({
      matches_by_pk: {
        __args: { id: matchId },
        id: true,
        status: true,
        winning_lineup_id: true,
        match_maps: {
          __args: {
            order_by: [{ created_at: 'asc' }],
          },
          id: true,
          status: true,
          lineup_1_score: true,
          lineup_2_score: true,
          mvp_steam_id: true,
          map: {
            name: true,
          },
        },
        lineup_1: {
          id: true,
          name: true,
          lineup_players: {
            steam_id: true,
            player: {
              steam_id: true,
              name: true,
              discord_id: true,
              kills_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    team_kill: { _eq: false },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              assists_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    is_team_assist: { _eq: false },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              deaths_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              // Headshots para MVP
              kills: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    team_kill: { _eq: false },
                    headshot: { _eq: true },
                  },
                },
                __typename: true,
              },
            },
          },
        },
        lineup_2: {
          id: true,
          name: true,
          lineup_players: {
            steam_id: true,
            player: {
              steam_id: true,
              name: true,
              discord_id: true,
              kills_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    team_kill: { _eq: false },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              assists_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    is_team_assist: { _eq: false },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              deaths_aggregate: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                  },
                },
                aggregate: {
                  count: true,
                },
              },
              kills: {
                __args: {
                  where: {
                    match_id: { _eq: matchId },
                    team_kill: { _eq: false },
                    headshot: { _eq: true },
                  },
                },
                __typename: true,
              },
            },
          },
        },
      },
    });

    if (!matches_by_pk) {
      return null;
    }

    // Processar stats de ambos os lineups
    const processLineupStats = (lineup: any) => {
      return (lineup?.lineup_players || []).map((lp: any) => {
        const kills = lp.player.kills_aggregate?.aggregate?.count || 0;
        const deaths = lp.player.deaths_aggregate?.aggregate?.count || 0;
        const assists = lp.player.assists_aggregate?.aggregate?.count || 0;
        const headshots = lp.player.kills?.length || 0;
        const kd = deaths > 0 ? kills / deaths : kills;

        return {
          steam_id: lp.player.steam_id,
          discord_id: lp.player.discord_id,
          name: lp.player.name,
          kills,
          assists,
          deaths,
          headshots,
          kd,
          // Score para MVP: kills * 2 + assists + headshots bonus
          mvpScore: kills * 2 + assists + (headshots * 0.5),
        };
      });
    };

    const team1Stats = processLineupStats(matches_by_pk.lineup_1);
    const team2Stats = processLineupStats(matches_by_pk.lineup_2);

    // Ordenar cada time por kills
    team1Stats.sort((a: any, b: any) => b.kills - a.kills);
    team2Stats.sort((a: any, b: any) => b.kills - a.kills);

    // Buscar MVP do banco de dados (do último mapa jogado)
    const allPlayers = [...team1Stats, ...team2Stats];
    const lastMap = matches_by_pk.match_maps?.at(-1);
    const mvpSteamId = lastMap?.mvp_steam_id;

    // Encontrar o jogador MVP pelo steam_id do banco, ou fallback para cálculo se não existir
    let mvp = mvpSteamId
      ? allPlayers.find((p) => p.steam_id === mvpSteamId)
      : null;

    // Fallback: calcular MVP se não estiver no banco (partidas antigas)
    if (!mvp && allPlayers.length > 0) {
      mvp = allPlayers.reduce((best, current) =>
        current.mvpScore > best.mvpScore ? current : best
      , allPlayers[0]);
    }

    return {
      match: matches_by_pk,
      team1Stats,
      team2Stats,
      mvp,
    };
  }

  /**
   * Formata o scoreboard final com MVP em um embed do Discord
   */
  private formatFinalScoreboard(data: any) {
    const { match, team1Stats, team2Stats, mvp } = data;
    const currentMap = match.match_maps?.[0];

    const score1 = currentMap?.lineup_1_score || 0;
    const score2 = currentMap?.lineup_2_score || 0;
    const mapName = currentMap?.map?.name || 'Unknown';

    const team1Name = match.lineup_1?.name || 'Team 1';
    const team2Name = match.lineup_2?.name || 'Team 2';

    // Determinar vencedor
    const winnerName = match.winning_lineup_id === match.lineup_1?.id
      ? team1Name
      : match.winning_lineup_id === match.lineup_2?.id
        ? team2Name
        : 'Empate';

    // Formatar stats dos players
    const formatPlayerLine = (p: any, isMvp: boolean) => {
      const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
      // Sanitizar nome: remover backticks que quebram o bloco de código markdown
      const sanitizedName = p.name.replace(/`/g, "'");
      const name = sanitizedName.length > 12 ? sanitizedName.slice(0, 12) : sanitizedName;
      const mvpIcon = isMvp ? '⭐' : '  ';
      return `${mvpIcon}${name.padEnd(12)} ${String(p.kills).padStart(2)} ${String(p.deaths).padStart(2)} ${String(p.assists).padStart(2)} ${String(kd).padStart(4)}`;
    };

    // Header da tabela
    const header = '  PLAYER        K  D  A  K/D';

    // Construir tabela do time 1
    const team1Table = team1Stats.length > 0
      ? [header, ...team1Stats.map((p: any) => formatPlayerLine(p, p.steam_id === mvp.steam_id))].join('\n')
      : 'No players';

    // Construir tabela do time 2
    const team2Table = team2Stats.length > 0
      ? [header, ...team2Stats.map((p: any) => formatPlayerLine(p, p.steam_id === mvp.steam_id))].join('\n')
      : 'No players';

    // MVP highlight
    const mvpMention = mvp.discord_id ? `<@${mvp.discord_id}>` : mvp.name;
    const mvpHighlight = `
🏆 **MVP da Partida**
⭐ ${mvpMention} - **${mvp.kills}K/${mvp.deaths}D/${mvp.assists}A** (${mvp.headshots} HS)
`;

    const description = `
**🎮 Partida Finalizada!**
**Mapa:** ${mapName}
**Placar Final:** ${score1} - ${score2}
**Vencedor:** 🏆 ${winnerName}

${mvpHighlight}

🟢 **${team1Name}** (${score1})
\`\`\`
${team1Table}
\`\`\`

🔴 **${team2Name}** (${score2})
\`\`\`
${team2Table}
\`\`\`
    `;

    // Cor do embed baseada no resultado
    let color = 0x0099FF; // Azul para empate
    if (match.winning_lineup_id === match.lineup_1?.id) {
      color = 0x00FF00; // Verde
    } else if (match.winning_lineup_id === match.lineup_2?.id) {
      color = 0xFF0000; // Vermelho
    }

    return {
      title: `📊 Resultado Final - ${mapName}`,
      description,
      color,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'From BananaServer.xyz with 🍌',
      },
    };
  }

  /**
   * Formata o scoreboard em um embed do Discord
   */
  private formatScoreboard(data: any) {
    const { match, team1Stats, team2Stats } = data;
    const currentMap = match.match_maps?.[0];

    const score1 = currentMap?.lineup_1_score || 0;
    const score2 = currentMap?.lineup_2_score || 0;
    const mapName = currentMap?.map?.name || 'Unknown';

    const team1Name = match.lineup_1?.name || 'Team 1';
    const team2Name = match.lineup_2?.name || 'Team 2';

    // Formatar stats dos players em formato tabela (similar ao scoreboard in-game)
    const formatPlayerLine = (p: any) => {
      const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
      // Sanitizar nome: remover backticks que quebram o bloco de código markdown
      const sanitizedName = p.name.replace(/`/g, "'");
      const name = sanitizedName.length > 15 ? sanitizedName.slice(0, 15) : sanitizedName;
      return `${name.padEnd(15)} ${String(p.kills).padStart(2)} ${String(p.deaths).padStart(2)} ${String(p.assists).padStart(2)} ${String(kd).padStart(4)}`;
    };

    // Header da tabela
    const header = 'PLAYER           K  D  A  K/D';

    // Construir tabela do time 1
    const team1Table = team1Stats.length > 0
      ? [header, ...team1Stats.map(formatPlayerLine)].join('\n')
      : 'No players';

    // Construir tabela do time 2
    const team2Table = team2Stats.length > 0
      ? [header, ...team2Stats.map(formatPlayerLine)].join('\n')
      : 'No players';

    const description = `
**Map:** ${mapName}
**Score:** ${score1} - ${score2}
**Status:** ${match.status}

🟢 **${team1Name}** (${score1})
\`\`\`
${team1Table}
\`\`\`

🔴 **${team2Name}** (${score2})
\`\`\`
${team2Table}
\`\`\`
    `;

    return {
      title: `📊 Live Match Stats - ${mapName}`,
      description,
      color: score1 > score2 ? 0x00FF00 : score2 > score1 ? 0xFF0000 : 0x0099FF,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'From BananaServer.xyz with 🍌',
      },
    };
  }
}
