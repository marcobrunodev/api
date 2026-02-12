import { Injectable, Logger, forwardRef, Inject } from "@nestjs/common";
import { RedisManagerService } from "../../redis/redis-manager/redis-manager.service";
import { HasuraService } from "../../hasura/hasura.service";
import {
  WARMUP_CONFIG,
  WARMUP_GAME_MODES,
  WARMUP_MAPS,
  WARMUP_REDIS_KEYS,
  WarmupGameMode,
} from "./warmup-server.constants";

export interface WarmupServerState {
  guildId: string;
  serverId?: string;
  serverIp?: string;
  serverPort?: number;
  serverPassword?: string;
  currentGameMode: string;
  currentMap: string;
  roundNumber: number;
  connectInfo?: string;
  createdAt: number;
  lastActivityAt: number;
  isProvisioning: boolean;
}

@Injectable()
export class WarmupServerService {
  private rotationIntervals = new Map<string, NodeJS.Timeout>();
  private shutdownTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly logger: Logger,
    private readonly hasura: HasuraService,
    private readonly redisManager: RedisManagerService,
  ) {}

  /**
   * Handle when a player joins the Queue Mix channel
   */
  async handlePlayerJoinQueue(
    guildId: string,
    memberId: string,
    guild: any,
    notificationChannelId?: string
  ): Promise<void> {
    try {
      // Cancel any pending shutdown
      this.cancelShutdownTimeout(guildId);

      // Get current queue size
      const queueSize = await this.getQueueSize(guildId);
      this.logger.log(`[Warmup] Player joined Queue Mix in guild ${guildId}. Queue size: ${queueSize}`);

      // Check if we should start a warmup server
      if (queueSize >= WARMUP_CONFIG.MIN_PLAYERS_TO_START) {
        const isActive = await this.isWarmupServerActive(guildId);

        if (!isActive) {
          // Start warmup server
          await this.startWarmupServer(guildId, guild, notificationChannelId);
        } else {
          // Server already running, notify the new player
          await this.notifyPlayer(guildId, memberId, notificationChannelId, guild);
        }
      }
    } catch (error) {
      this.logger.error(`[Warmup] Error handling player join:`, error);
    }
  }

  /**
   * Handle when a player leaves the Queue Mix channel
   */
  async handlePlayerLeaveQueue(guildId: string, memberId: string): Promise<void> {
    try {
      const queueSize = await this.getQueueSize(guildId);
      this.logger.log(`[Warmup] Player left Queue Mix in guild ${guildId}. Queue size: ${queueSize}`);

      // If queue is empty, schedule shutdown
      if (queueSize === 0) {
        this.scheduleShutdown(guildId);
      }
    } catch (error) {
      this.logger.error(`[Warmup] Error handling player leave:`, error);
    }
  }

  /**
   * Start a warmup server for the guild
   */
  async startWarmupServer(
    guildId: string,
    guild: any,
    notificationChannelId?: string
  ): Promise<WarmupServerState | null> {
    try {
      // Check for provisioning lock to prevent duplicate starts
      const isLocked = await this.acquireProvisioningLock(guildId);
      if (!isLocked) {
        this.logger.log(`[Warmup] Server already being provisioned for guild ${guildId}`);
        return null;
      }

      this.logger.log(`[Warmup] Starting warmup server for guild ${guildId}`);

      // Select random game mode and map
      const gameMode = this.getRandomGameMode();
      const map = this.getRandomMap();

      // Create initial state
      const state: WarmupServerState = {
        guildId,
        currentGameMode: gameMode.type,
        currentMap: map,
        roundNumber: 0,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        isProvisioning: true,
      };

      // Save state to Redis
      await this.saveState(guildId, state);

      // Try to find an available server
      const serverInfo = await this.findAvailableServer(guildId);

      if (serverInfo) {
        state.serverId = serverInfo.id;
        state.serverIp = serverInfo.ip;
        state.serverPort = serverInfo.port;
        state.serverPassword = serverInfo.password;
        state.connectInfo = `steam://connect/${serverInfo.ip}:${serverInfo.port}/${serverInfo.password || ''}`;
        state.isProvisioning = false;

        await this.saveState(guildId, state);

        // Broadcast connect info
        await this.broadcastConnectInfo(guildId, guild, notificationChannelId, state);

        // Start rotation timer
        this.startRotationTimer(guildId, state);

        this.logger.log(`[Warmup] Server started for guild ${guildId}: ${state.connectInfo}`);
      } else {
        // No server available - notify players
        state.isProvisioning = false;
        await this.saveState(guildId, state);

        await this.notifyNoServerAvailable(guildId, guild, notificationChannelId);
        this.logger.warn(`[Warmup] No server available for guild ${guildId}`);
      }

      // Release lock
      await this.releaseProvisioningLock(guildId);

      return state;
    } catch (error) {
      this.logger.error(`[Warmup] Error starting warmup server:`, error);
      await this.releaseProvisioningLock(guildId);
      return null;
    }
  }

  /**
   * Stop the warmup server for a guild
   */
  async stopWarmupServer(
    guildId: string,
    reason: 'mix_starting' | 'empty' | 'timeout',
    guild?: any,
    notificationChannelId?: string
  ): Promise<void> {
    try {
      this.logger.log(`[Warmup] Stopping warmup server for guild ${guildId}. Reason: ${reason}`);

      // Cancel rotation timer
      this.stopRotationTimer(guildId);

      // Cancel any pending shutdown
      this.cancelShutdownTimeout(guildId);

      // Get current state
      const state = await this.getState(guildId);

      // Clear Redis state
      await this.clearState(guildId);

      // Notify players if reason is mix_starting
      if (reason === 'mix_starting' && guild && notificationChannelId) {
        await this.notifyWarmupEnding(guildId, guild, notificationChannelId, 'Mix is starting! Join the competitive match.');
      }

      this.logger.log(`[Warmup] Server stopped for guild ${guildId}`);
    } catch (error) {
      this.logger.error(`[Warmup] Error stopping warmup server:`, error);
    }
  }

  /**
   * Check if warmup server is active for a guild
   */
  async isWarmupServerActive(guildId: string): Promise<boolean> {
    const state = await this.getState(guildId);
    return state !== null;
  }

  /**
   * Get current warmup state
   */
  async getState(guildId: string): Promise<WarmupServerState | null> {
    const redis = this.redisManager.getConnection();
    const key = `${WARMUP_REDIS_KEYS.SERVER_STATE}:${guildId}`;
    const data = await redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      guildId: data.guildId,
      serverId: data.serverId || undefined,
      serverIp: data.serverIp || undefined,
      serverPort: data.serverPort ? parseInt(data.serverPort) : undefined,
      serverPassword: data.serverPassword || undefined,
      currentGameMode: data.currentGameMode,
      currentMap: data.currentMap,
      roundNumber: parseInt(data.roundNumber) || 0,
      connectInfo: data.connectInfo || undefined,
      createdAt: parseInt(data.createdAt) || Date.now(),
      lastActivityAt: parseInt(data.lastActivityAt) || Date.now(),
      isProvisioning: data.isProvisioning === 'true',
    };
  }

  /**
   * Save warmup state to Redis
   */
  private async saveState(guildId: string, state: WarmupServerState): Promise<void> {
    const redis = this.redisManager.getConnection();
    const key = `${WARMUP_REDIS_KEYS.SERVER_STATE}:${guildId}`;

    const data: Record<string, string> = {
      guildId: state.guildId,
      currentGameMode: state.currentGameMode,
      currentMap: state.currentMap,
      roundNumber: state.roundNumber.toString(),
      createdAt: state.createdAt.toString(),
      lastActivityAt: state.lastActivityAt.toString(),
      isProvisioning: state.isProvisioning.toString(),
    };

    if (state.serverId) data.serverId = state.serverId;
    if (state.serverIp) data.serverIp = state.serverIp;
    if (state.serverPort) data.serverPort = state.serverPort.toString();
    if (state.serverPassword) data.serverPassword = state.serverPassword;
    if (state.connectInfo) data.connectInfo = state.connectInfo;

    await redis.hset(key, data);
    await redis.expire(key, WARMUP_CONFIG.REDIS_TTL_SECONDS);
  }

  /**
   * Clear warmup state from Redis
   */
  private async clearState(guildId: string): Promise<void> {
    const redis = this.redisManager.getConnection();
    const key = `${WARMUP_REDIS_KEYS.SERVER_STATE}:${guildId}`;
    await redis.del(key);
  }

  /**
   * Get queue size from Redis
   */
  private async getQueueSize(guildId: string): Promise<number> {
    const redis = this.redisManager.getConnection();
    const key = `discord:queue-mix:${guildId}`;
    return await redis.zcard(key);
  }

  /**
   * Find an available server for warmup
   */
  private async findAvailableServer(guildId: string): Promise<{
    id: string;
    ip: string;
    port: number;
    password?: string;
  } | null> {
    try {
      // Query for available dedicated servers that are not in a match
      const { servers } = await this.hasura.query({
        servers: {
          __args: {
            where: {
              enabled: { _eq: true },
              current_match_id: { _is_null: true },
            },
            limit: 1,
          },
          id: true,
          host: true,
          port: true,
        },
      });

      if (servers && servers.length > 0) {
        const server = servers[0];
        return {
          id: server.id,
          ip: server.host,
          port: server.port,
          password: undefined, // Warmup servers can be passwordless
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`[Warmup] Error finding available server:`, error);
      return null;
    }
  }

  /**
   * Broadcast connect info to notification channel
   */
  private async broadcastConnectInfo(
    guildId: string,
    guild: any,
    notificationChannelId: string | undefined,
    state: WarmupServerState
  ): Promise<void> {
    if (!notificationChannelId || !guild) return;

    try {
      const channel = await guild.channels.fetch(notificationChannelId).catch((): null => null);
      if (!channel || !('send' in channel)) return;

      const queueSize = await this.getQueueSize(guildId);

      await channel.send({
        embeds: [{
          title: '🎮 Warmup Server Ready!',
          description: `
**Modo:** ${state.currentGameMode}
**Mapa:** ${state.currentMap}
**Players na fila:** ${queueSize}/10

${state.connectInfo ? `🔗 **Conectar:** \`${state.connectInfo}\`` : '⏳ Procurando servidor...'}

Jogue enquanto espera o mix!
          `.trim(),
          color: 0x00FF00,
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          },
          timestamp: new Date().toISOString(),
        }],
      });
    } catch (error) {
      this.logger.error(`[Warmup] Error broadcasting connect info:`, error);
    }
  }

  /**
   * Notify a single player about the warmup server
   */
  private async notifyPlayer(
    guildId: string,
    memberId: string,
    notificationChannelId: string | undefined,
    guild: any
  ): Promise<void> {
    // For now, we don't send individual DMs to avoid rate limiting
    // The player can see the info in the notification channel
  }

  /**
   * Notify that no server is available
   */
  private async notifyNoServerAvailable(
    guildId: string,
    guild: any,
    notificationChannelId: string | undefined
  ): Promise<void> {
    if (!notificationChannelId || !guild) return;

    try {
      const channel = await guild.channels.fetch(notificationChannelId).catch((): null => null);
      if (!channel || !('send' in channel)) return;

      await channel.send({
        embeds: [{
          title: '⏳ Warmup Server',
          description: `
Não há servidor de warmup disponível no momento.

Assim que um servidor estiver livre, vocês serão notificados!
          `.trim(),
          color: 0xFF9900,
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          },
          timestamp: new Date().toISOString(),
        }],
      });
    } catch (error) {
      this.logger.error(`[Warmup] Error notifying no server available:`, error);
    }
  }

  /**
   * Notify that warmup is ending
   */
  private async notifyWarmupEnding(
    guildId: string,
    guild: any,
    notificationChannelId: string,
    reason: string
  ): Promise<void> {
    try {
      const channel = await guild.channels.fetch(notificationChannelId).catch((): null => null);
      if (!channel || !('send' in channel)) return;

      await channel.send({
        embeds: [{
          title: '🏁 Warmup Encerrado!',
          description: reason,
          color: 0x00FFFF,
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          },
          timestamp: new Date().toISOString(),
        }],
      });
    } catch (error) {
      this.logger.error(`[Warmup] Error notifying warmup ending:`, error);
    }
  }

  /**
   * Start game mode rotation timer
   */
  private startRotationTimer(guildId: string, state: WarmupServerState): void {
    this.stopRotationTimer(guildId);

    const interval = setInterval(async () => {
      await this.rotateGameMode(guildId);
    }, WARMUP_CONFIG.ROTATION_INTERVAL_MS);

    this.rotationIntervals.set(guildId, interval);
  }

  /**
   * Stop game mode rotation timer
   */
  private stopRotationTimer(guildId: string): void {
    const interval = this.rotationIntervals.get(guildId);
    if (interval) {
      clearInterval(interval);
      this.rotationIntervals.delete(guildId);
    }
  }

  /**
   * Rotate to next game mode
   */
  async rotateGameMode(guildId: string): Promise<void> {
    try {
      const state = await this.getState(guildId);
      if (!state || !state.serverId) return;

      // Get next mode and map
      const newMode = this.getRandomGameMode();
      const newMap = this.getRandomMap();

      // Update state
      state.currentGameMode = newMode.type;
      state.currentMap = newMap;
      state.roundNumber++;
      state.lastActivityAt = Date.now();

      await this.saveState(guildId, state);

      // TODO: Send RCON command to change game mode
      // await this.rcon.command(state.serverId, `game_type ${newMode.game_type}; game_mode ${newMode.game_mode}; changelevel ${newMap}`);

      this.logger.log(`[Warmup] Rotated game mode for guild ${guildId}: ${newMode.type} on ${newMap}`);
    } catch (error) {
      this.logger.error(`[Warmup] Error rotating game mode:`, error);
    }
  }

  /**
   * Schedule shutdown after delay
   */
  private scheduleShutdown(guildId: string): void {
    this.cancelShutdownTimeout(guildId);

    const timeout = setTimeout(async () => {
      const queueSize = await this.getQueueSize(guildId);
      if (queueSize === 0) {
        await this.stopWarmupServer(guildId, 'empty');
      }
    }, WARMUP_CONFIG.EMPTY_QUEUE_SHUTDOWN_DELAY_MS);

    this.shutdownTimeouts.set(guildId, timeout);
  }

  /**
   * Cancel pending shutdown
   */
  private cancelShutdownTimeout(guildId: string): void {
    const timeout = this.shutdownTimeouts.get(guildId);
    if (timeout) {
      clearTimeout(timeout);
      this.shutdownTimeouts.delete(guildId);
    }
  }

  /**
   * Acquire provisioning lock
   */
  private async acquireProvisioningLock(guildId: string): Promise<boolean> {
    const redis = this.redisManager.getConnection();
    const key = `${WARMUP_REDIS_KEYS.PROVISIONING_LOCK}:${guildId}`;
    const result = await redis.set(key, '1', 'EX', 60, 'NX');
    return result === 'OK';
  }

  /**
   * Release provisioning lock
   */
  private async releaseProvisioningLock(guildId: string): Promise<void> {
    const redis = this.redisManager.getConnection();
    const key = `${WARMUP_REDIS_KEYS.PROVISIONING_LOCK}:${guildId}`;
    await redis.del(key);
  }

  /**
   * Get random game mode from rotation
   */
  private getRandomGameMode(): WarmupGameMode {
    const index = Math.floor(Math.random() * WARMUP_GAME_MODES.length);
    return WARMUP_GAME_MODES[index];
  }

  /**
   * Get random map from warmup maps
   */
  private getRandomMap(): string {
    const index = Math.floor(Math.random() * WARMUP_MAPS.length);
    return WARMUP_MAPS[index];
  }
}
