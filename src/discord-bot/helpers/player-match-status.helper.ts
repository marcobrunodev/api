import { HasuraService } from "../../hasura/hasura.service";

/**
 * Verifica se um jogador está em uma partida ativa
 * Uma partida ativa é uma que tem status Scheduled ou Live
 */
export async function isPlayerInActiveMatch(
  hasura: HasuraService,
  discordId: string
): Promise<{ inMatch: boolean; matchType?: string; matchStatus?: string }> {
  try {
    const { match_lineup_players } = await hasura.query({
      match_lineup_players: {
        __args: {
          where: {
            discord_id: { _eq: discordId },
            lineup: {
              _or: [
                {
                  v_match_lineup: {
                    match: {
                      status: { _in: ["Scheduled", "Live"] }
                    }
                  }
                }
              ]
            }
          },
          limit: 1
        },
        id: true,
        lineup: {
          v_match_lineup: {
            match: {
              id: true,
              status: true,
              options: {
                type: true
              }
            }
          }
        }
      }
    });

    if (match_lineup_players && match_lineup_players.length > 0) {
      const match = match_lineup_players[0]?.lineup?.v_match_lineup?.match;
      return {
        inMatch: true,
        matchType: match?.options?.type,
        matchStatus: match?.status
      };
    }

    return { inMatch: false };
  } catch (error) {
    console.error('Error checking if player is in active match:', error);
    return { inMatch: false };
  }
}

/**
 * Verifica se algum dos dois jogadores está em uma partida ativa
 * Retorna informações sobre qual jogador e em que partida
 */
export async function checkPlayersActiveMatch(
  hasura: HasuraService,
  discordId1: string,
  discordId2: string
): Promise<{
  playerInMatch: string | null;
  matchType?: string;
  matchStatus?: string;
}> {
  const player1Status = await isPlayerInActiveMatch(hasura, discordId1);
  if (player1Status.inMatch) {
    return {
      playerInMatch: discordId1,
      matchType: player1Status.matchType,
      matchStatus: player1Status.matchStatus
    };
  }

  const player2Status = await isPlayerInActiveMatch(hasura, discordId2);
  if (player2Status.inMatch) {
    return {
      playerInMatch: discordId2,
      matchType: player2Status.matchType,
      matchStatus: player2Status.matchStatus
    };
  }

  return { playerInMatch: null };
}
