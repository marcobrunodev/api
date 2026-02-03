// Armazena duels pendentes aguardando registro de SteamID
export interface PendingDuel {
  challengerId: string;
  opponentId: string;
  messageId: string;
  channelId: string;
  guildId: string;
  challengerRegistered: boolean;
  opponentRegistered: boolean;
  createdAt: Date;
}

// Map: messageId -> PendingDuel
const pendingDuels = new Map<string, PendingDuel>();

// Map: odiscordId -> messageId (para encontrar duel pendente pelo usuário)
const userToPendingDuel = new Map<string, string>();

export function createPendingDuel(
  messageId: string,
  channelId: string,
  guildId: string,
  challengerId: string,
  opponentId: string,
  challengerRegistered: boolean,
  opponentRegistered: boolean,
): void {
  const pendingDuel: PendingDuel = {
    challengerId,
    opponentId,
    messageId,
    channelId,
    guildId,
    challengerRegistered,
    opponentRegistered,
    createdAt: new Date(),
  };

  pendingDuels.set(messageId, pendingDuel);
  
  // Mapear usuários para este duel (somente os que não estão registrados)
  if (!challengerRegistered) {
    userToPendingDuel.set(challengerId, messageId);
  }
  if (!opponentRegistered) {
    userToPendingDuel.set(opponentId, messageId);
  }

  // Auto-limpar após 10 minutos
  setTimeout(() => {
    deletePendingDuel(messageId);
  }, 10 * 60 * 1000);
}

export function getPendingDuel(messageId: string): PendingDuel | undefined {
  return pendingDuels.get(messageId);
}

export function getPendingDuelByUser(userId: string): PendingDuel | undefined {
  const messageId = userToPendingDuel.get(userId);
  if (messageId) {
    return pendingDuels.get(messageId);
  }
  return undefined;
}

export function updatePendingDuelRegistration(
  messageId: string,
  userId: string,
): PendingDuel | undefined {
  const duel = pendingDuels.get(messageId);
  if (!duel) return undefined;

  if (userId === duel.challengerId) {
    duel.challengerRegistered = true;
    userToPendingDuel.delete(userId);
  } else if (userId === duel.opponentId) {
    duel.opponentRegistered = true;
    userToPendingDuel.delete(userId);
  }

  return duel;
}

export function areBothPlayersRegistered(duel: PendingDuel): boolean {
  return duel.challengerRegistered && duel.opponentRegistered;
}

export function deletePendingDuel(messageId: string): void {
  const duel = pendingDuels.get(messageId);
  if (duel) {
    userToPendingDuel.delete(duel.challengerId);
    userToPendingDuel.delete(duel.opponentId);
    pendingDuels.delete(messageId);
  }
}
