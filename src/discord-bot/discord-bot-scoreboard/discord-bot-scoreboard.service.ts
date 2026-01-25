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
   * Busca stats da partida do banco de dados
   */
  private async getMatchStats(matchId: string) {
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
          score_lineup_1: true,
          score_lineup_2: true,
          map: {
            name: true,
          },
        },
        lineup_1: {
          id: true,
          lineup_players: {
            player: {
              steam_id: true,
              name: true,
            },
          },
        },
        lineup_2: {
          id: true,
          lineup_players: {
            player: {
              steam_id: true,
              name: true,
            },
          },
        },
      },
    });

    if (!matches_by_pk) {
      return null;
    }

    // Buscar stats individuais dos players no mapa atual
    const currentMap = matches_by_pk.match_maps?.[0];
    if (!currentMap) {
      return {
        match: matches_by_pk,
        playerStats: [],
      };
    }

    // Buscar kills, deaths e assists dos players
    const { player_kills, player_assists } = await this.hasura.query({
      player_kills: {
        __args: {
          where: {
            match_map_id: { _eq: currentMap.id },
          },
        },
        killer_steam_id: true,
        victim_steam_id: true,
        headshot: true,
      },
      player_assists: {
        __args: {
          where: {
            match_map_id: { _eq: currentMap.id },
          },
        },
        assister_steam_id: true,
      },
    });

    // Agregar stats por player
    const statsMap = new Map<string, { kills: number; deaths: number; assists: number; headshots: number }>();

    // Contar kills e headshots
    player_kills?.forEach((kill) => {
      if (kill.killer_steam_id) {
        const killerId = String(kill.killer_steam_id);
        const stats = statsMap.get(killerId) || { kills: 0, deaths: 0, assists: 0, headshots: 0 };
        stats.kills++;
        if (kill.headshot) stats.headshots++;
        statsMap.set(killerId, stats);
      }

      // Contar deaths
      if (kill.victim_steam_id) {
        const victimId = String(kill.victim_steam_id);
        const stats = statsMap.get(victimId) || { kills: 0, deaths: 0, assists: 0, headshots: 0 };
        stats.deaths++;
        statsMap.set(victimId, stats);
      }
    });

    // Contar assists
    player_assists?.forEach((assist) => {
      if (assist.assister_steam_id) {
        const assisterId = String(assist.assister_steam_id);
        const stats = statsMap.get(assisterId) || { kills: 0, deaths: 0, assists: 0, headshots: 0 };
        stats.assists++;
        statsMap.set(assisterId, stats);
      }
    });

    // Buscar nomes dos players dos lineups
    const allPlayers = [
      ...(matches_by_pk.lineup_1?.lineup_players || []),
      ...(matches_by_pk.lineup_2?.lineup_players || []),
    ];

    const playerStats = allPlayers.map((lp) => {
      const steamId = lp.player.steam_id;
      const stats = statsMap.get(steamId) || { kills: 0, deaths: 0, assists: 0, headshots: 0 };
      return {
        steam_id: steamId,
        name: lp.player.name,
        ...stats,
      };
    });

    // Ordenar por kills
    playerStats.sort((a, b) => b.kills - a.kills);

    return {
      match: matches_by_pk,
      playerStats,
    };
  }

  /**
   * Formata o scoreboard em um embed do Discord
   */
  private formatScoreboard(data: any) {
    const { match, playerStats } = data;
    const currentMap = match.match_maps?.[0];

    const score1 = currentMap?.score_lineup_1 || 0;
    const score2 = currentMap?.score_lineup_2 || 0;
    const mapName = currentMap?.map?.name || 'Unknown';

    // Separar players por lineup
    const lineup1SteamIds = new Set(
      match.lineup_1?.lineup_players?.map((lp: any) => lp.player.steam_id) || []
    );

    const team1Stats = playerStats.filter((p: any) => lineup1SteamIds.has(p.steam_id));
    const team2Stats = playerStats.filter((p: any) => !lineup1SteamIds.has(p.steam_id));

    // Formatar stats dos players (similar ao TAB do CS2)
    const formatPlayerLine = (p: any) => {
      const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
      return `\`${p.name.padEnd(16).slice(0, 16)}\` ${String(p.kills).padStart(3)} ${String(p.deaths).padStart(3)} ${String(p.assists).padStart(3)} ${String(kd).padStart(4)}`;
    };

    const team1Lines = team1Stats.map(formatPlayerLine).join('\n') || '_No players_';
    const team2Lines = team2Stats.map(formatPlayerLine).join('\n') || '_No players_';

    const description = `
**Map:** ${mapName}
**Score:** ${score1} - ${score2}
**Status:** ${match.status}

**Team 1** (${score1})
\`${'Name'.padEnd(16)} ${'K'.padStart(3)} ${'D'.padStart(3)} ${'A'.padStart(3)} ${'K/D'.padStart(4)}\`
${team1Lines}

**Team 2** (${score2})
\`${'Name'.padEnd(16)} ${'K'.padStart(3)} ${'D'.padStart(3)} ${'A'.padStart(3)} ${'K/D'.padStart(4)}\`
${team2Lines}
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
