/**
 * Helper para verificar disponibilidade de servidores
 */

import { HasuraService } from "../../hasura/hasura.service";

export interface ServerAvailabilityResult {
  available: boolean;
  totalServers: number;
  availableServers: number;
}

/**
 * Verifica quantos servidores estão disponíveis
 */
export async function checkServerAvailability(
  hasura: HasuraService
): Promise<ServerAvailabilityResult> {
  try {
    const { servers } = await hasura.query({
      servers: {
        __args: {
          where: {
            enabled: { _eq: true },
          },
        },
        id: true,
        is_available: true,
      },
    });

    const totalServers = servers.length;
    const availableServers = servers.filter((s) => s.is_available).length;

    return {
      available: availableServers > 0,
      totalServers,
      availableServers,
    };
  } catch (error) {
    console.error('Error checking server availability:', error);
    // Em caso de erro, assume que há servidores disponíveis para não bloquear
    return {
      available: true,
      totalServers: 0,
      availableServers: 0,
    };
  }
}
