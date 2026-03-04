import MatchEventProcessor from "./abstracts/MatchEventProcessor";
import { e_match_map_status_enum } from "../../../generated";

export default class MatchMapStatusEvent extends MatchEventProcessor<{
  status: e_match_map_status_enum;
  winning_lineup_id?: string;
}> {
  public async process() {
    const { matches_by_pk: match } = await this.hasura.query({
      matches_by_pk: {
        __args: {
          id: this.matchId,
        },
        current_match_map_id: true,
      },
    });

    if (!match?.current_match_map_id) {
      return;
    }

    const isFinished = this.data.status === "Finished";
    const matchMapId = match.current_match_map_id;

    // Calculate MVP before updating status if map is finished
    let mvpSteamId: string | null = null;
    if (isFinished) {
      mvpSteamId = await this.calculateMvp(this.matchId);
    }

    const { update_match_maps_by_pk } = await this.hasura.mutation({
      update_match_maps_by_pk: {
        __args: {
          pk_columns: {
            id: matchMapId,
          },
          _set: {
            status: this.data.status,
            ...(this.data.winning_lineup_id
              ? { winning_lineup_id: this.data.winning_lineup_id }
              : {}),
            ...(mvpSteamId ? { mvp_steam_id: mvpSteamId } : {}),
          },
        },
        id: true,
        match: {
          current_match_map_id: true,
        },
      },
    });

    if (isFinished) {
      this.logger.log(`[${this.matchId}] Map finished. MVP: ${mvpSteamId || 'none'}`);

      if (update_match_maps_by_pk.match.current_match_map_id !== null) {
        await this.matchAssistant.sendServerMatchId(this.matchId);
        return;
      }
    }
  }

  /**
   * Calculate MVP for the match using formula: kills * 2 + assists + (headshots * 0.5)
   * Note: MVP is not calculated for Duel matches (1v1)
   */
  private async calculateMvp(matchId: string): Promise<string | null> {
    try {
      const { matches_by_pk } = await this.hasura.query({
        matches_by_pk: {
          __args: { id: matchId },
          options: {
            type: true,
          },
          lineup_1: {
            lineup_players: {
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
                  aggregate: { count: true },
                },
                assists_aggregate: {
                  __args: {
                    where: {
                      match_id: { _eq: matchId },
                      is_team_assist: { _eq: false },
                    },
                  },
                  aggregate: { count: true },
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
          lineup_2: {
            lineup_players: {
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
                  aggregate: { count: true },
                },
                assists_aggregate: {
                  __args: {
                    where: {
                      match_id: { _eq: matchId },
                      is_team_assist: { _eq: false },
                    },
                  },
                  aggregate: { count: true },
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

      // Skip MVP calculation for Duel matches (1v1)
      if (matches_by_pk.options?.type === "Duel") {
        this.logger.log(`[${matchId}] Skipping MVP calculation for Duel match`);
        return null;
      }

      const processPlayers = (lineup: any) => {
        return (lineup?.lineup_players || []).map((lp: any) => {
          const kills = lp.player.kills_aggregate?.aggregate?.count || 0;
          const assists = lp.player.assists_aggregate?.aggregate?.count || 0;
          const headshots = lp.player.kills?.length || 0;
          return {
            steam_id: lp.player.steam_id,
            name: lp.player.name,
            mvpScore: kills * 2 + assists + (headshots * 0.5),
          };
        });
      };

      const allPlayers = [
        ...processPlayers(matches_by_pk.lineup_1),
        ...processPlayers(matches_by_pk.lineup_2),
      ];

      if (allPlayers.length === 0) {
        return null;
      }

      const mvp = allPlayers.reduce((best, current) =>
        current.mvpScore > best.mvpScore ? current : best
      , allPlayers[0]);

      this.logger.log(`[${matchId}] MVP calculated: ${mvp.name} (${mvp.steam_id}) with score ${mvp.mvpScore}`);

      return mvp.steam_id;
    } catch (error) {
      this.logger.error(`[${matchId}] Error calculating MVP:`, error);
      return null;
    }
  }
}
