/**
 * Warmup Server Configuration Constants
 */

// Game modes for rotation (every 5 minutes)
export const WARMUP_GAME_MODES = [
  { type: 'ArmsRace', game_type: 1, game_mode: 0 },
  { type: 'Deathmatch', game_type: 1, game_mode: 2 },
  { type: 'Retake', game_type: 3, game_mode: 0 },
] as const;

// Small maps for warmup (Arms Race classics) - used for ArmsRace and Deathmatch
export const WARMUP_MAPS_AR = [
  'ar_pool_day',
  'ar_shoots',
  'ar_baggage',
] as const;

// Defuse maps for Retake mode (require bomb sites)
export const WARMUP_MAPS_DE = [
  'de_dust2',
  'de_mirage',
  'de_inferno',
  'de_nuke',
  'de_ancient',
] as const;

// Legacy alias for backwards compatibility
export const WARMUP_MAPS = WARMUP_MAPS_AR;

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

// Bot configuration for warmup servers
export const WARMUP_BOT_CONFIG = {
  // Bot difficulty: 0=easy, 1=normal, 2=hard, 3=expert
  DIFFICULTY: 2,

  // Number of bots to fill the server (per team)
  QUOTA: 8,

  // Bot quota mode: "fill" keeps server filled as players join/leave
  QUOTA_MODE: 'fill',

  // Bot chatter: "off", "radio", "minimal", "normal"
  CHATTER: 'minimal',

  // Allow bots to join any team
  JOIN_AFTER_PLAYER: 0,

  // Bot auto balance
  AUTO_VACATE: 1,
} as const;

// Redis key prefixes
export const WARMUP_REDIS_KEYS = {
  SERVER_STATE: 'discord:warmup-server',
  NOTIFIED_PLAYERS: 'discord:warmup-players',
  PROVISIONING_LOCK: 'discord:warmup-lock',
} as const;

export type WarmupGameMode = typeof WARMUP_GAME_MODES[number];
export type WarmupMapAR = typeof WARMUP_MAPS_AR[number];
export type WarmupMapDE = typeof WARMUP_MAPS_DE[number];
export type WarmupMap = WarmupMapAR | WarmupMapDE;
