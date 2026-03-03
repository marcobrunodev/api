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
      const name = p.name.length > 15 ? p.name.slice(0, 15) : p.name;
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
