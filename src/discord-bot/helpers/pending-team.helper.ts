// Armazena criações de times pendentes aguardando registro de SteamID
export interface PendingTeamCreation {
  odiscordId: string;
  odiscordUsername: string;
  createdAt: Date;
}

// Map: odiscordId -> PendingTeamCreation
const pendingTeamCreations = new Map<string, PendingTeamCreation>();

export function createPendingTeamCreation(
  odiscordId: string,
  odiscordUsername: string,
): void {
  const pending: PendingTeamCreation = {
    odiscordId,
    odiscordUsername,
    createdAt: new Date(),
  };

  pendingTeamCreations.set(odiscordId, pending);

  // Auto-limpar após 10 minutos
  setTimeout(() => {
    deletePendingTeamCreation(odiscordId);
  }, 10 * 60 * 1000);
}

export function getPendingTeamCreation(odiscordId: string): PendingTeamCreation | undefined {
  return pendingTeamCreations.get(odiscordId);
}

export function deletePendingTeamCreation(odiscordId: string): void {
  pendingTeamCreations.delete(odiscordId);
}
