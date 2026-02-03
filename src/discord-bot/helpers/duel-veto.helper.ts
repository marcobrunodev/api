/**
 * Sistema de veto de mapas para duels no Discord
 * Cada jogador bane 3 mapas alternadamente, o mapa restante é jogado
 */

import { HasuraService } from "../../hasura/hasura.service";

export interface DuelMap {
  id: string;
  name: string;
  banned?: boolean;
  bannedBy?: string;
}

export interface DuelVetoSession {
  messageId: string;
  channelId: string;
  categoryId: string;
  guildId: string;
  challengerId: string;
  opponentId: string;
  maps: DuelMap[];
  currentTurn: string; // ID do jogador que deve banir
  bansRemaining: { [playerId: string]: number };
  createdAt: Date;
}

// Map de sessões de veto ativas (messageId -> session)
const vetoSessions = new Map<string, DuelVetoSession>();

/**
 * Formata o nome do mapa para exibição
 * Remove prefixos como de_, aim_, awp_, cs_ e capitaliza
 * Ex: de_vertigo -> Vertigo, aim_headshot -> Headshot
 */
export function formatMapName(mapName: string): string {
  // Remove prefixos comuns de mapas CS2
  const prefixes = ['de_', 'cs_', 'aim_', 'awp_', 'ar_', 'fy_', 'dm_', 'gd_'];
  let formatted = mapName;
  
  for (const prefix of prefixes) {
    if (formatted.toLowerCase().startsWith(prefix)) {
      formatted = formatted.substring(prefix.length);
      break;
    }
  }
  
  // Capitaliza a primeira letra de cada palavra (separadas por _)
  formatted = formatted
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  return formatted;
}

/**
 * Busca os mapas de duel disponíveis do banco de dados
 */
export async function getDuelMaps(hasura: HasuraService): Promise<DuelMap[]> {
  try {
    const { maps } = await hasura.query({
      maps: {
        __args: {
          where: {
            e_match_type: {
              value: { _eq: "Duel" }
            },
            enabled: { _eq: true },
            active_pool: { _eq: true }
          },
          order_by: [{ name: "asc" }]
        },
        id: true,
        name: true,
      }
    });

    return maps.map(m => ({
      id: m.id,
      name: m.name,
      banned: false
    }));
  } catch (error) {
    console.error('Error fetching duel maps:', error);
    // Fallback para mapas padrão de duel
    return [
      { id: 'aim_map', name: 'aim_map' },
      { id: 'aim_redline', name: 'aim_redline' },
      { id: 'aim_ag_texture_city', name: 'aim_ag_texture_city' },
      { id: 'aim_deagle7k', name: 'aim_deagle7k' },
      { id: 'aim_headshot', name: 'aim_headshot' },
      { id: 'awp_india', name: 'awp_india' },
      { id: 'awp_lego_2', name: 'awp_lego_2' },
    ];
  }
}

/**
 * Cria uma nova sessão de veto
 */
export function createVetoSession(
  messageId: string,
  channelId: string,
  categoryId: string,
  guildId: string,
  challengerId: string,
  opponentId: string,
  maps: DuelMap[]
): DuelVetoSession {
  const session: DuelVetoSession = {
    messageId,
    channelId,
    categoryId,
    guildId,
    challengerId,
    opponentId,
    maps,
    currentTurn: challengerId, // Challenger bane primeiro
    bansRemaining: {
      [challengerId]: 3,
      [opponentId]: 3
    },
    createdAt: new Date()
  };

  vetoSessions.set(messageId, session);
  console.log(`Veto session created for message ${messageId}`);
  return session;
}

/**
 * Obtém uma sessão de veto pelo ID da mensagem
 */
export function getVetoSession(messageId: string): DuelVetoSession | undefined {
  return vetoSessions.get(messageId);
}

/**
 * Bane um mapa e retorna o resultado
 */
export function banMap(
  messageId: string,
  playerId: string,
  mapId: string
): { success: boolean; error?: string; session?: DuelVetoSession; finished?: boolean; selectedMap?: DuelMap } {
  const session = vetoSessions.get(messageId);
  
  if (!session) {
    return { success: false, error: 'Veto session not found' };
  }

  if (session.currentTurn !== playerId) {
    return { success: false, error: 'Not your turn to ban' };
  }

  const map = session.maps.find(m => m.id === mapId);
  if (!map) {
    return { success: false, error: 'Map not found' };
  }

  if (map.banned) {
    return { success: false, error: 'Map already banned' };
  }

  // Banir o mapa
  map.banned = true;
  map.bannedBy = playerId;
  session.bansRemaining[playerId]--;

  // Verificar se o veto terminou (6 mapas banidos, 1 restante)
  const availableMaps = session.maps.filter(m => !m.banned);
  if (availableMaps.length === 1) {
    // Veto finalizado
    const selectedMap = availableMaps[0];
    deleteVetoSession(messageId);
    return { success: true, session, finished: true, selectedMap };
  }

  // Alternar turno
  session.currentTurn = session.currentTurn === session.challengerId 
    ? session.opponentId 
    : session.challengerId;

  return { success: true, session, finished: false };
}

/**
 * Obtém os mapas disponíveis (não banidos) de uma sessão
 */
export function getAvailableMaps(messageId: string): DuelMap[] {
  const session = vetoSessions.get(messageId);
  if (!session) return [];
  return session.maps.filter(m => !m.banned);
}

/**
 * Remove uma sessão de veto
 */
export function deleteVetoSession(messageId: string): void {
  vetoSessions.delete(messageId);
  console.log(`Veto session deleted for message ${messageId}`);
}

/**
 * Gera o texto de status do veto
 */
export function getVetoStatusText(session: DuelVetoSession): string {
  const bannedMaps = session.maps.filter(m => m.banned);
  const availableMaps = session.maps.filter(m => !m.banned);
  
  let status = '';
  
  if (bannedMaps.length > 0) {
    status += '**Banned Maps:**\n';
    for (const map of bannedMaps) {
      status += `❌ ~~${formatMapName(map.name)}~~ (banned by <@${map.bannedBy}>)\n`;
    }
    status += '\n';
  }
  
  status += '**Available Maps:**\n';
  for (const map of availableMaps) {
    status += `🗺️ ${formatMapName(map.name)}\n`;
  }
  
  return status;
}
