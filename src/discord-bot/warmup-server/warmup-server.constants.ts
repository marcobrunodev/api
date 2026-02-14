/**
 * Warmup Server Configuration Constants
 */

// Game modes for rotation (every 5 minutes)
export const WARMUP_GAME_MODES = [
  { type: 'ArmsRace', game_type: 1, game_mode: 0 },
  { type: 'Deathmatch', game_type: 1, game_mode: 2 },
  { type: 'Casual', game_type: 0, game_mode: 0 },
] as const;

// Small maps for warmup (Arms Race classics)
export const WARMUP_MAPS = [
  'ar_pool_day',
  'ar_shoots',
  'ar_baggage',
] as const;

// Timing configuration
export const WARMUP_CONFIG = {
  // Minimum players to start warmup server
  MIN_PLAYERS_TO_START: 1,

  // Time in milliseconds between game mode rotations (5 minutes)
  ROTATION_INTERVAL_MS: 5 * 60 * 1000,

  // Delay before shutting down server when queue is empty (30 seconds)
  EMPTY_QUEUE_SHUTDOWN_DELAY_MS: 30 * 1000,

  // Maximum server idle time before auto-cleanup (30 minutes)
  MAX_IDLE_TIME_MS: 30 * 60 * 1000,

  // Redis TTL for warmup state (1 hour)
  REDIS_TTL_SECONDS: 3600,

  // Max players on warmup server
  MAX_PLAYERS: 16,
} as const;

// Redis key prefixes
export const WARMUP_REDIS_KEYS = {
  SERVER_STATE: 'discord:warmup-server',
  NOTIFIED_PLAYERS: 'discord:warmup-players',
  PROVISIONING_LOCK: 'discord:warmup-lock',
} as const;

export type WarmupGameMode = typeof WARMUP_GAME_MODES[number];
export type WarmupMap = typeof WARMUP_MAPS[number];
