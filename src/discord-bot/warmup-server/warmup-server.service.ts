import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisManagerService } from "../../redis/redis-manager/redis-manager.service";
import { HasuraService } from "../../hasura/hasura.service";
import { RconService } from "../../rcon/rcon.service";
import { EncryptionService } from "../../encryption/encryption.service";
import { CacheService } from "../../cache/cache.service";
import { BatchV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { GameServersConfig } from "../../configs/types/GameServersConfig";
import { AppConfig } from "../../configs/types/AppConfig";
import {
  WARMUP_CONFIG,
  WARMUP_BOT_CONFIG,
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
  jobName?: string;
}

@Injectable()
export class WarmupServerService {
  private rotationIntervals = new Map<string, NodeJS.Timeout>();
  private shutdownTimeouts = new Map<string, NodeJS.Timeout>();
  private appConfig: AppConfig;
  private gameServerConfig: GameServersConfig;
  private readonly namespace: string;

  constructor(
    private readonly logger: Logger,
    private readonly hasura: HasuraService,
    private readonly redisManager: RedisManagerService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly encryption: EncryptionService,
    @Inject(forwardRef(() => RconService))
    private readonly rcon: RconService,
  ) {
    this.appConfig = this.config.get<AppConfig>("app");
    this.gameServerConfig = this.config.get<GameServersConfig>("gameServers");
    this.namespace = this.gameServerConfig?.namespace || "5stack";
  }

  /**
   * Generate job name for warmup server
   */
  private static GetWarmupServerJobId(guildId: string): string {
    return `w-${guildId.substring(0, 20)}`;
  }

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
        const state = await this.getState(guildId);
        const isActive = state !== null;

        if (!isActive) {
          // Start warmup server
          this.logger.log(`[Warmup] No active server found, starting new warmup server for guild ${guildId}`);
          await this.startWarmupServer(guildId, guild, notificationChannelId);
        } else if (state?.serverId && state?.jobName) {
          // Server already running with a valid server ID and job
          this.logger.log(`[Warmup] Server already active for guild ${guildId} (serverId: ${state.serverId})`);
          await this.notifyPlayer(guildId, memberId, notificationChannelId, guild);
        } else {
          // Stale state without server ID - clean it up and start fresh
          this.logger.warn(`[Warmup] Found stale state without server ID for guild ${guildId}, cleaning up...`);
          await this.cleanupState(guildId);
          await this.startWarmupServer(guildId, guild, notificationChannelId);
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
   * Start a warmup server for the guild (creates K8s pod on demand)
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

      // Try to create on-demand server
      const serverInfo = await this.createOnDemandServer(guildId, gameMode, map);

      if (serverInfo) {
        state.serverId = serverInfo.id;
        state.serverIp = serverInfo.ip;
        state.serverPort = serverInfo.port;
        state.serverPassword = serverInfo.password;
        state.jobName = serverInfo.jobName;
        state.isProvisioning = false;

        await this.saveState(guildId, state);

        // Broadcast connect info
        await this.broadcastConnectInfo(guildId, guild, notificationChannelId, state);

        // Start rotation timer
        this.startRotationTimer(guildId, state);

        this.logger.log(`[Warmup] Server started for guild ${guildId}: ${state.serverIp}:${state.serverPort}`);
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
   * Create an on-demand K8s server for warmup
   */
  private async createOnDemandServer(
    guildId: string,
    gameMode: WarmupGameMode,
    map: string
  ): Promise<{
    id: string;
    ip: string;
    port: number;
    password?: string;
    jobName: string;
  } | null> {
    return this.cache.lock(
      `warmup-server:${guildId}`,
      async () => {
        try {
          // Find available server slot (non-dedicated, not reserved by match or warmup)
          const { servers } = await this.hasura.query({
            servers: {
              __args: {
                limit: 1,
                order_by: [{ updated_at: "asc" }],
                where: {
                  type: { _eq: "Ranked" },
                  enabled: { _eq: true },
                  is_dedicated: { _eq: false },
                  reserved_by_match_id: { _is_null: true },
                  reserved_for_warmup_guild_id: { _is_null: true },
                  game_server_node: {
                    enabled: { _eq: true },
                    status: { _eq: "Online" },
                  },
                },
              },
              id: true,
              label: true,
              host: true,
              port: true,
              tv_port: true,
              api_password: true,
              rcon_password: true,
              game_server_node: {
                id: true,
                public_ip: true,
                pin_plugin_version: true,
                supports_cpu_pinning: true,
              },
              server_region: {
                is_lan: true,
                steam_relay: true,
              },
            },
          });

          const server = servers?.at(-1);

          if (!server) {
            this.logger.warn(`[Warmup] No available server slot found for guild ${guildId}`);
            return null;
          }

          this.logger.log(`[Warmup] Found server slot: ${server.label} (${server.id})`);

          // Reserve server for warmup using the dedicated warmup column
          await this.hasura.mutation({
            update_servers_by_pk: {
              __args: {
                pk_columns: { id: server.id },
                _set: {
                  connected: false,
                  reserved_for_warmup_guild_id: guildId,
                },
              },
              __typename: true,
            },
          });

          // Create K8s Job
          const kc = new KubeConfig();
          kc.loadFromDefault();
          const batch = kc.makeApiClient(BatchV1Api);

          const jobName = WarmupServerService.GetWarmupServerJobId(guildId);
          const gameServerNodeId = server.game_server_node?.id;
          const sanitizedGameServerNodeId = gameServerNodeId.replaceAll(".", "-");
          const steamRelay = server.server_region?.steam_relay || false;

          // Get plugin image
          let pluginImage = this.gameServerConfig.serverImage;
          const pinPluginVersion = server.game_server_node?.pin_plugin_version;
          if (pinPluginVersion) {
            pluginImage = this.gameServerConfig.serverImage.replace(
              /:.+$/,
              `:v${pinPluginVersion.toString()}`
            );
          }

          // Delete existing job if any
          try {
            await batch.deleteNamespacedJob({
              name: jobName,
              namespace: this.namespace,
              propagationPolicy: "Background",
            });
            this.logger.log(`[Warmup] Deleted existing job ${jobName}`);
            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch {
            // Job doesn't exist, that's fine
          }

          this.logger.log(`[Warmup] Creating K8s job ${jobName} for server ${server.label}`);

          // Game params for warmup (casual modes, no password)
          const extraGameParams = `+game_type ${gameMode.game_type} +game_mode ${gameMode.game_mode} +map ${map} -maxplayers ${WARMUP_CONFIG.MAX_PLAYERS} ${server.server_region?.is_lan ? "+sv_lan 1" : ""}`;

          await batch.createNamespacedJob({
            namespace: this.namespace,
            body: {
              apiVersion: "batch/v1",
              kind: "Job",
              metadata: {
                name: jobName,
                labels: {
                  type: "warmup",
                  guild: guildId.substring(0, 20),
                },
              },
              spec: {
                ttlSecondsAfterFinished: 60 * 60, // 1 hour
                template: {
                  metadata: {
                    name: jobName,
                    labels: {
                      job: jobName,
                      type: "warmup",
                    },
                  },
                  spec: {
                    restartPolicy: "Never",
                    dnsConfig: {
                      options: [{ name: "ndots", value: "1" }],
                    },
                    hostNetwork: true,
                    dnsPolicy: "ClusterFirstWithHostNet",
                    affinity: {
                      nodeAffinity: {
                        requiredDuringSchedulingIgnoredDuringExecution: {
                          nodeSelectorTerms: [
                            {
                              matchExpressions: [
                                {
                                  key: "kubernetes.io/hostname",
                                  operator: "In",
                                  values: [gameServerNodeId],
                                },
                              ],
                            },
                          ],
                        },
                      },
                    },
                    containers: [
                      {
                        name: "game-server",
                        image: pluginImage,
                        ports: [
                          { containerPort: server.port, protocol: "TCP" },
                          { containerPort: server.port, protocol: "UDP" },
                          { containerPort: server.tv_port, protocol: "TCP" },
                          { containerPort: server.tv_port, protocol: "UDP" },
                        ],
                        env: [
                          { name: "GAME_NODE_SERVER", value: "true" },
                          { name: "SERVER_PORT", value: server.port.toString() },
                          { name: "TV_PORT", value: server.tv_port.toString() },
                          {
                            name: "RCON_PASSWORD",
                            value: await this.encryption.decrypt(server.rcon_password),
                          },
                          { name: "EXTRA_GAME_PARAMS", value: extraGameParams },
                          { name: "SERVER_ID", value: server.id },
                          { name: "SERVER_API_PASSWORD", value: server.api_password },
                          { name: "API_DOMAIN", value: this.appConfig.apiDomain },
                          { name: "RELAY_DOMAIN", value: this.appConfig.relayDomain },
                          { name: "DEMOS_DOMAIN", value: this.appConfig.demosDomain },
                          { name: "WS_DOMAIN", value: this.appConfig.wsDomain },
                          { name: "STEAM_RELAY", value: steamRelay ? "true" : "false" },
                          { name: "WARMUP_MODE", value: "true" },
                        ],
                        volumeMounts: [
                          {
                            name: `steamcmd-${sanitizedGameServerNodeId}`,
                            mountPath: "/serverdata/steamcmd",
                          },
                          {
                            name: `serverfiles-${sanitizedGameServerNodeId}`,
                            mountPath: "/serverdata/serverfiles",
                          },
                          {
                            name: `demos-${sanitizedGameServerNodeId}`,
                            mountPath: "/opt/demos",
                          },
                          {
                            name: `custom-plugins-${sanitizedGameServerNodeId}`,
                            mountPath: "/opt/custom-plugins",
                          },
                        ],
                      },
                    ],
                    volumes: [
                      {
                        name: `steamcmd-${sanitizedGameServerNodeId}`,
                        persistentVolumeClaim: {
                          claimName: `steamcmd-${sanitizedGameServerNodeId}-claim`,
                        },
                      },
                      {
                        name: `serverfiles-${sanitizedGameServerNodeId}`,
                        persistentVolumeClaim: {
                          claimName: `serverfiles-${sanitizedGameServerNodeId}-claim`,
                        },
                      },
                      {
                        name: `demos-${sanitizedGameServerNodeId}`,
                        persistentVolumeClaim: {
                          claimName: `demos-${sanitizedGameServerNodeId}-claim`,
                        },
                      },
                      {
                        name: `custom-plugins-${sanitizedGameServerNodeId}`,
                        hostPath: {
                          path: `/opt/5stack/custom-plugins`,
                        },
                      },
                    ],
                  },
                },
                backoffLimit: 3,
              },
            },
          });

          this.logger.log(`[Warmup] K8s job ${jobName} created successfully`);

          // Wait for pod to be ready
          const isReady = await this.waitForServerReady(server.id, jobName);

          if (!isReady) {
            this.logger.warn(`[Warmup] Server pod did not become ready in time`);
            await this.stopWarmupPod(guildId, server.id);
            return null;
          }

          const serverIp = server.game_server_node?.public_ip || server.host;

          // Configure bots for warmup
          await this.configureBots(server.id);

          return {
            id: server.id,
            ip: serverIp,
            port: server.port,
            password: undefined, // Warmup is passwordless
            jobName,
          };
        } catch (error) {
          this.logger.error(`[Warmup] Error creating on-demand server:`, error);
          return null;
        }
      },
      30 // 30 second lock timeout
    );
  }

  /**
   * Wait for server pod to be running and RCON to respond
   */
  private async waitForServerReady(serverId: string, jobName: string): Promise<boolean> {
    const maxAttempts = 30; // 30 attempts * 2 seconds = 60 seconds max wait
    const delayMs = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const kc = new KubeConfig();
        kc.loadFromDefault();
        const core = kc.makeApiClient(CoreV1Api);
        const batch = kc.makeApiClient(BatchV1Api);

        // Check if job is active
        const job = await batch.readNamespacedJob({
          name: jobName,
          namespace: this.namespace,
        });

        if (!job.status?.active) {
          this.logger.log(`[Warmup] Job ${jobName} not active yet, attempt ${attempt + 1}/${maxAttempts}`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // Check if pod is running
        const podList = await core.listNamespacedPod({
          namespace: this.namespace,
          labelSelector: `job-name=${jobName}`,
        });

        const runningPods = podList.items.filter(pod => pod.status?.phase === "Running");
        if (runningPods.length === 0) {
          this.logger.log(`[Warmup] No running pods yet for job ${jobName}, attempt ${attempt + 1}/${maxAttempts}`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // Try RCON connection
        const rcon = await this.rcon.connect(serverId);
        if (rcon) {
          this.logger.log(`[Warmup] Server ${serverId} is ready (RCON connected)`);
          await this.rcon.disconnect(serverId);
          return true;
        }

        this.logger.log(`[Warmup] RCON not responding yet, attempt ${attempt + 1}/${maxAttempts}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) {
        this.logger.log(`[Warmup] Error checking server readiness, attempt ${attempt + 1}/${maxAttempts}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return false;
  }

  /**
   * Configure bots for warmup server via RCON
   */
  private async configureBots(serverId: string): Promise<void> {
    try {
      const rconConnection = await this.rcon.connect(serverId);
      if (!rconConnection) {
        this.logger.warn(`[Warmup] Could not connect RCON to configure bots for ${serverId}`);
        return;
      }

      // Bot configuration commands
      const botCommands = [
        // Set bot difficulty (0=easy, 1=normal, 2=hard, 3=expert)
        `bot_difficulty ${WARMUP_BOT_CONFIG.DIFFICULTY}`,

        // Bot quota settings
        `bot_quota ${WARMUP_BOT_CONFIG.QUOTA}`,
        `bot_quota_mode ${WARMUP_BOT_CONFIG.QUOTA_MODE}`,

        // Bot behavior
        `bot_chatter ${WARMUP_BOT_CONFIG.CHATTER}`,
        `bot_join_after_player ${WARMUP_BOT_CONFIG.JOIN_AFTER_PLAYER}`,
        `bot_auto_vacate ${WARMUP_BOT_CONFIG.AUTO_VACATE}`,

        // Make bots smarter
        'bot_defer_to_human_goals 0',
        'bot_defer_to_human_items 0',

        // Balanced teams
        'mp_autoteambalance 1',
        'mp_limitteams 0',
      ];

      for (const cmd of botCommands) {
        try {
          await rconConnection.send(cmd);
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          this.logger.warn(`[Warmup] Error sending bot command "${cmd}":`, error);
        }
      }

      await this.rcon.disconnect(serverId);
      this.logger.log(`[Warmup] Configured bots for server ${serverId} (difficulty: ${WARMUP_BOT_CONFIG.DIFFICULTY}, quota: ${WARMUP_BOT_CONFIG.QUOTA})`);
    } catch (error) {
      this.logger.error(`[Warmup] Error configuring bots:`, error);
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

      // Stop the K8s pod
      if (state?.serverId) {
        await this.stopWarmupPod(guildId, state.serverId);
      }

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
   * Stop the K8s warmup pod and release server reservation
   */
  private async stopWarmupPod(guildId: string, serverId: string): Promise<void> {
    try {
      const jobName = WarmupServerService.GetWarmupServerJobId(guildId);

      // Delete K8s job
      const kc = new KubeConfig();
      kc.loadFromDefault();
      const batch = kc.makeApiClient(BatchV1Api);
      const core = kc.makeApiClient(CoreV1Api);

      try {
        // Delete all pods for this job first
        const podList = await core.listNamespacedPod({
          namespace: this.namespace,
          labelSelector: `job-name=${jobName}`,
        });

        for (const pod of podList.items) {
          try {
            await core.deleteNamespacedPod({
              name: pod.metadata!.name!,
              namespace: this.namespace,
            });
            this.logger.log(`[Warmup] Deleted pod ${pod.metadata!.name}`);
          } catch {
            // Pod might already be deleted
          }
        }

        // Delete the job
        await batch.deleteNamespacedJob({
          name: jobName,
          namespace: this.namespace,
          propagationPolicy: "Background",
        });
        this.logger.log(`[Warmup] Deleted K8s job ${jobName}`);
      } catch (error) {
        this.logger.warn(`[Warmup] Error deleting K8s job ${jobName}:`, error);
      }

      // Release server warmup reservation
      await this.hasura.mutation({
        update_servers_by_pk: {
          __args: {
            pk_columns: { id: serverId },
            _set: {
              connected: false,
              reserved_for_warmup_guild_id: null,
            },
          },
          __typename: true,
        },
      });

      this.logger.log(`[Warmup] Released server reservation for ${serverId}`);
    } catch (error) {
      this.logger.error(`[Warmup] Error stopping warmup pod:`, error);
    }
  }

  /**
   * Check if warmup server is active for a guild
   */
  async isWarmupServerActive(guildId: string): Promise<boolean> {
    const state = await this.getState(guildId);
    return state !== null && state.serverId !== undefined;
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
      jobName: data.jobName || undefined,
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
    if (state.jobName) data.jobName = state.jobName;

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
   * Cleanup stale state and locks
   */
  private async cleanupState(guildId: string): Promise<void> {
    const state = await this.getState(guildId);
    if (state?.serverId) {
      await this.stopWarmupPod(guildId, state.serverId);
    }
    await this.clearState(guildId);
    await this.releaseProvisioningLock(guildId);
    this.logger.log(`[Warmup] Cleaned up stale state for guild ${guildId}`);
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

      // Build connect command in same format as /mix and /mix-duel
      let connectSection = '⏳ Searching for server...';
      if (state.serverIp && state.serverPort) {
        const connectCommand = state.serverPassword
          ? `connect ${state.serverIp}:${state.serverPort}; password ${state.serverPassword}`
          : `connect ${state.serverIp}:${state.serverPort}`;
        connectSection = `**Connect to Server:**\n\`\`\`\n${connectCommand}\n\`\`\``;
      }

      await channel.send({
        embeds: [{
          title: '🎮 Warmup Server Ready!',
          description: `
**Mode:** ${state.currentGameMode}
**Map:** ${state.currentMap}
**Players in queue:** ${queueSize}/10

${connectSection}

Play while waiting for the mix! 🍌
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
No warmup server available at the moment.

You'll be notified as soon as a server becomes available!
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
          title: '🏁 Warmup Ended!',
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
   * Rotate to next game mode (via RCON)
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

      // Send RCON command to change game mode
      try {
        const rconConnection = await this.rcon.connect(state.serverId);
        if (rconConnection) {
          await rconConnection.send(`game_type ${newMode.game_type}`);
          await rconConnection.send(`game_mode ${newMode.game_mode}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          await rconConnection.send(`changelevel ${newMap}`);
          await this.rcon.disconnect(state.serverId);
          this.logger.log(`[Warmup] Rotated game mode for guild ${guildId}: ${newMode.type} on ${newMap}`);

          // Reconfigure bots after map change (wait for map to load)
          await new Promise(resolve => setTimeout(resolve, 3000));
          await this.configureBots(state.serverId);
        } else {
          this.logger.warn(`[Warmup] Failed to connect RCON for rotation in guild ${guildId}`);
        }
      } catch (error) {
        this.logger.warn(`[Warmup] Error sending RCON commands for rotation:`, error);
      }
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
    const result = await redis.set(key, '1', 'EX', 120, 'NX'); // 2 minute lock
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
