/**
 * Sistema de veto de regiões (servidores) para duels no Discord
 * Cada jogador bane regiões alternadamente até sobrar 1
 */

import { HasuraService } from "../../hasura/hasura.service";

export interface DuelRegion {
  id: string;
  name: string;
  banned?: boolean;
  bannedBy?: string;
}

export interface DuelRegionVetoSession {
  messageId: string;
  channelId: string;
  categoryId: string;
  guildId: string;
  challengerId: string;
  opponentId: string;
  regions: DuelRegion[];
  currentTurn: string; // ID do jogador que deve banir
  bansRemaining: number; // Total de bans restantes
  createdAt: Date;
}

// Map de sessões de veto de região ativas (messageId -> session)
const regionVetoSessions = new Map<string, DuelRegionVetoSession>();

/**
 * Busca as regiões disponíveis do banco de dados
 */
export async function getAvailableRegions(hasura: HasuraService): Promise<DuelRegion[]> {
  try {
    const { servers } = await hasura.query({
      servers: {
        __args: {
          where: {
            enabled: { _eq: true },
            is_available: { _eq: true },
          },
          distinct_on: ["region"],
        },
        region: true,
      },
    });

    // Extrair regiões únicas
    const uniqueRegions = new Set<string>();
    servers.forEach((s: { region?: string }) => {
      if (s.region) {
        uniqueRegions.add(s.region);
      }
    });

    return Array.from(uniqueRegions).map(region => ({
      id: region,
      name: region,
      banned: false,
    }));
  } catch (error) {
    console.error('Error fetching available regions:', error);
    // Fallback para regiões padrão
    return [
      { id: 'São Paulo', name: 'São Paulo' },
      { id: 'Miami', name: 'Miami' },
    ];
  }
}

/**
 * Cria uma nova sessão de veto de região
 */
export function createRegionVetoSession(
  messageId: string,
  channelId: string,
  categoryId: string,
  guildId: string,
  challengerId: string,
  opponentId: string,
  regions: DuelRegion[]
): DuelRegionVetoSession {
  // Calcular quantos bans são necessários (n-1 regiões)
  const bansNeeded = regions.length - 1;

  const session: DuelRegionVetoSession = {
    messageId,
    channelId,
    categoryId,
    guildId,
    challengerId,
    opponentId,
    regions,
    currentTurn: challengerId, // Challenger bane primeiro
    bansRemaining: bansNeeded,
    createdAt: new Date(),
  };

  regionVetoSessions.set(messageId, session);
  console.log(`Region veto session created for message ${messageId} with ${regions.length} regions`);
  return session;
}

/**
 * Obtém uma sessão de veto de região pelo ID da mensagem
 */
export function getRegionVetoSession(messageId: string): DuelRegionVetoSession | undefined {
  return regionVetoSessions.get(messageId);
}

/**
 * Bane uma região e retorna o resultado
 */
export function banRegion(
  messageId: string,
  playerId: string,
  regionId: string
): { success: boolean; error?: string; session?: DuelRegionVetoSession; finished?: boolean; selectedRegion?: DuelRegion } {
  const session = regionVetoSessions.get(messageId);

  if (!session) {
    return { success: false, error: 'Region veto session not found' };
  }

  if (session.currentTurn !== playerId) {
    return { success: false, error: 'Not your turn to ban' };
  }

  const region = session.regions.find(r => r.id === regionId);
  if (!region) {
    return { success: false, error: 'Region not found' };
  }

  if (region.banned) {
    return { success: false, error: 'Region already banned' };
  }

  // Banir a região
  region.banned = true;
  region.bannedBy = playerId;
  session.bansRemaining--;

  // Verificar se o veto terminou (1 região restante)
  const availableRegions = session.regions.filter(r => !r.banned);
  if (availableRegions.length === 1) {
    // Veto finalizado
    const selectedRegion = availableRegions[0];
    deleteRegionVetoSession(messageId);
    return { success: true, session, finished: true, selectedRegion };
  }

  // Alternar turno
  session.currentTurn = session.currentTurn === session.challengerId
    ? session.opponentId
    : session.challengerId;

  return { success: true, session, finished: false };
}

/**
 * Obtém as regiões disponíveis (não banidas) de uma sessão
 */
export function getAvailableRegionsFromSession(messageId: string): DuelRegion[] {
  const session = regionVetoSessions.get(messageId);
  if (!session) return [];
  return session.regions.filter(r => !r.banned);
}

/**
 * Remove uma sessão de veto de região
 */
export function deleteRegionVetoSession(messageId: string): void {
  regionVetoSessions.delete(messageId);
  console.log(`Region veto session deleted for message ${messageId}`);
}

/**
 * Gera o texto de status do veto de região
 */
export function getRegionVetoStatusText(session: DuelRegionVetoSession): string {
  const bannedRegions = session.regions.filter(r => r.banned);
  const availableRegions = session.regions.filter(r => !r.banned);

  let status = '';

  if (bannedRegions.length > 0) {
    status += '**Banned Regions:**\n';
    for (const region of bannedRegions) {
      status += `❌ ~~${region.name}~~ (banned by <@${region.bannedBy}>)\n`;
    }
    status += '\n';
  }

  status += '**Available Regions:**\n';
  for (const region of availableRegions) {
    status += `🌍 ${region.name}\n`;
  }

  return status;
}
