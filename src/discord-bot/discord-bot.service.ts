import { ModuleRef } from "@nestjs/core";
import { Logger, Injectable } from "@nestjs/common";
import {
  AutocompleteInteraction,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { ChatCommands } from "./enums/ChatCommands";
import { HasuraService } from "../hasura/hasura.service";
import { ConfigService } from "@nestjs/config";
import { DiscordConfig } from "../configs/types/DiscordConfig";
import { e_match_types_enum } from "../../generated";
import { interactions } from "./interactions/interactions";
import DiscordInteraction from "./interactions/abstracts/DiscordInteraction";
import { Type } from "@nestjs/common";
import MiniSearch from "minisearch";
import { Queue } from "bullmq";
import { DiscordBotQueues } from "./enums/DiscordBotQueues";
import { InjectQueue } from "@nestjs/bullmq";
import { RemoveArchivedThreads } from "./jobs/RemoveArchivedThreads";
import { RedisManagerService } from "../redis/redis-manager/redis-manager.service";

let client: Client;

@Injectable()
export class DiscordBotService {
  public client: Client;
  private discordConfig: DiscordConfig;

  private mapChoices: Record<
    e_match_types_enum | 'Mix',
    {
      search: MiniSearch;
      maps: { name: string; id: string }[];
    }
  > = {
    Duel: undefined,
    Wingman: undefined,
    Competitive: undefined,
    Mix: undefined,
  };

  // Mapa para rastrear partidas criadas pelo Discord Mix
  private mixMatches = new Map<string, {
    guildId: string;
    categoryId: string;
    team1PlayerIds: string[];
    team2PlayerIds: string[];
  }>();

  constructor(
    readonly config: ConfigService,
    private readonly logger: Logger,
    private readonly hasura: HasuraService,
    private readonly moduleRef: ModuleRef,
    @InjectQueue(DiscordBotQueues.DiscordBot) private queue: Queue,
    private readonly redisManager: RedisManagerService,
  ) {
    this.client = client;
    this.discordConfig = config.get<DiscordConfig>("discord");
  }

  public async login() {
    client = this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });

    this.client
      .on(Events.ClientReady, async () => {
        this.logger.log(`logged in as ${this.client.user.tag}!`);
        await this.ensureBananaServerCategory();
        await this.syncQueueMixOnStartup();
      })
      .on(Events.VoiceStateUpdate, async (oldState, newState) => {
        await this.handleVoiceStateUpdate(oldState, newState);
      })
      .on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isAutocomplete()) {
          const autocompleteInteraction =
            interaction as AutocompleteInteraction;

          const { name, value: query } =
            autocompleteInteraction.options.getFocused(true);

          switch (name) {
            case "map":
              const matchType = (autocompleteInteraction.commandName
                .charAt(0)
                .toUpperCase() +
                autocompleteInteraction.commandName.slice(
                  1,
                )) as e_match_types_enum;
              const { maps, search } = await this.getMapChoices(matchType);

              let mapChoices = maps;
              if (query) {
                // @ts-ignore
                mapChoices = await search.search(query);
              }

              await autocompleteInteraction.respond(
                mapChoices
                  .map((map) => {
                    return {
                      name: map.name,
                      value: map.id,
                    };
                  })
                  .slice(0, 25),
              );

              break;
          }

          return;
        }

        if (interaction.isChatInputCommand()) {
          const DiscordInteraction =
            interactions.chat[
              interaction.commandName as keyof typeof interactions.chat
            ];

          const discordInteraction =
            await this.moduleRef.create<DiscordInteraction>(
              DiscordInteraction as unknown as Type<DiscordInteraction>,
            );

          return await discordInteraction.handler(interaction);
        }

        if (interaction.isButton()) {
          if (interaction.customId === "confirm_map_pool") {
            return;
          }

          const [type] = interaction.customId.split(":");
          const DiscordInteraction =
            interactions.buttons[type as keyof typeof interactions.buttons];

          const discordInteraction =
            await this.moduleRef.create<DiscordInteraction>(
              DiscordInteraction as unknown as Type<DiscordInteraction>,
            );

          return await discordInteraction.handler(interaction);
        }

        if (interaction.isModalSubmit()) {
          const DiscordInteraction =
            interactions.modals[interaction.customId];

          if (!DiscordInteraction) {
            this.logger.warn(`No modal handler found for: ${interaction.customId}`);
            return;
          }

          const discordInteraction =
            await this.moduleRef.create<DiscordInteraction>(
              DiscordInteraction as unknown as Type<DiscordInteraction>,
            );

          return await discordInteraction.handler(interaction);
        }
      })
      .on(Events.Error, (error) => {
        this.logger.warn("unhandled error", error);
      });

    await this.client.login(this.discordConfig.token);
  }

  private async ensureBananaServerCategory() {
    try {
      const guilds = this.client.guilds.cache;

      for (const [_, guild] of guilds) {
        const existingCategory = guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === '🍌 BananaServer.xyz Mix'
        );

        if (!existingCategory) {
          this.logger.log(`Creating BananaServer.xyz Mix category in guild: ${guild.name}`);

          const category = await guild.channels.create({
            name: '🍌 BananaServer.xyz Mix',
            type: ChannelType.GuildCategory,
          });

          await category.setPosition(0);

          await guild.channels.create({
            name: '🍌 Queue Mix',
            type: ChannelType.GuildVoice,
            parent: category.id,
          });

          await guild.channels.create({
            name: '💤 AFK',
            type: ChannelType.GuildVoice,
            parent: category.id,
          });

          this.logger.log(`Successfully created category, queue and AFK rooms in guild: ${guild.name}`);
        } else {
          this.logger.log(`BananaServer.xyz Mix category already exists in guild: ${guild.name}`);

          // Verificar se a sala AFK existe
          const afkChannel = guild.channels.cache.find(
            (channel) =>
              channel.type === ChannelType.GuildVoice &&
              channel.name === '💤 AFK' &&
              channel.parentId === existingCategory.id
          );

          if (!afkChannel) {
            this.logger.log(`Creating AFK channel in guild: ${guild.name}`);
            await guild.channels.create({
              name: '💤 AFK',
              type: ChannelType.GuildVoice,
              parent: existingCategory.id,
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Error ensuring BananaServer.xyz Mix category:', error);
    }
  }

  /**
   * Sync Queue Mix members from Discord to Redis on startup
   * Handles members who joined/left during bot downtime
   *
   * IMPORTANT: Members who joined during downtime will be added to the end of the queue.
   * If multiple members joined during downtime, their relative order cannot be determined
   * (Discord doesn't provide voice channel join timestamps), so they will be added in
   * the order returned by Discord's cache, which is not guaranteed to be chronological.
   */
  private async syncQueueMixOnStartup() {
    try {
      this.logger.log('Starting Queue Mix synchronization...');

      for (const [guildId, guild] of this.client.guilds.cache) {
        const queueChannel = guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildVoice &&
            channel.name === '🍌 Queue Mix'
        );

        if (!queueChannel || queueChannel.type !== ChannelType.GuildVoice) {
          continue;
        }

        // Get current members in the Discord channel
        // NOTE: Order is not guaranteed to be chronological for members who joined during downtime
        const currentMembers = Array.from(queueChannel.members.keys());

        // Get members currently in Redis queue
        const redisMembers = await this.getAllQueueMembers(guildId);

        // Find members to add (joined during downtime)
        const toAdd = currentMembers.filter(id => !redisMembers.includes(id));

        // Find members to remove (left during downtime)
        const toRemove = redisMembers.filter(id => !currentMembers.includes(id));

        // Add new members (they go to the end of the queue)
        for (const memberId of toAdd) {
          await this.addToQueueMix(guildId, memberId);
          const member = guild.members.cache.get(memberId);
          this.logger.log(`[Sync] Added ${member?.user?.tag || memberId} to queue (joined during downtime)`);
        }

        // Remove members who left
        for (const memberId of toRemove) {
          await this.removeFromQueueMix(guildId, memberId);
          this.logger.log(`[Sync] Removed ${memberId} from queue (left during downtime)`);
        }

        if (toAdd.length > 0 || toRemove.length > 0) {
          this.logger.log(
            `[Sync] Guild ${guild.name}: +${toAdd.length} added, -${toRemove.length} removed, ${currentMembers.length} total in queue`
          );
        } else {
          this.logger.log(`[Sync] Guild ${guild.name}: Queue already synchronized (${currentMembers.length} members)`);
        }
      }

      this.logger.log('Queue Mix synchronization completed');
    } catch (error) {
      this.logger.error('Error during Queue Mix synchronization:', error);
    }
  }

  /**
   * Get Redis key for queue mix
   */
  private getQueueMixRedisKey(guildId: string): string {
    return `discord:queue-mix:${guildId}`;
  }

  /**
   * Add member to queue mix in Redis
   */
  private async addToQueueMix(guildId: string, memberId: string): Promise<void> {
    const redis = this.redisManager.getConnection();
    const key = this.getQueueMixRedisKey(guildId);
    const timestamp = Date.now() * 1000 + Math.random(); // Microseconds to ensure uniqueness
    await redis.zadd(key, timestamp, memberId);
    this.logger.log(`Added ${memberId} to queue mix in guild ${guildId} with timestamp ${timestamp}`);
  }

  /**
   * Remove member from queue mix in Redis
   */
  private async removeFromQueueMix(guildId: string, memberId: string): Promise<void> {
    const redis = this.redisManager.getConnection();
    const key = this.getQueueMixRedisKey(guildId);
    await redis.zrem(key, memberId);
    this.logger.log(`Removed ${memberId} from queue mix in guild ${guildId}`);
  }

  /**
   * Get member's position in queue (0-indexed)
   */
  private async getQueueMixPosition(guildId: string, memberId: string): Promise<number | null> {
    const redis = this.redisManager.getConnection();
    const key = this.getQueueMixRedisKey(guildId);
    const rank = await redis.zrank(key, memberId);
    return rank !== null ? rank : null;
  }

  /**
   * Get all members in queue ordered by join time
   */
  private async getAllQueueMembers(guildId: string): Promise<string[]> {
    const redis = this.redisManager.getConnection();
    const key = this.getQueueMixRedisKey(guildId);
    return await redis.zrange(key, 0, -1);
  }

  private async handleVoiceStateUpdate(oldState: any, newState: any) {
    try {
      await this.handleQueueMixTracking(oldState, newState);

      const channelLeft = oldState.channel;
      if (!channelLeft) return;

      const category = channelLeft.parent;
      if (!category) return;

      if (!category.name.startsWith('Banana Mix')) return;

      const voiceChannels = category.children.cache.filter(
        (channel: any) => channel.type === ChannelType.GuildVoice
      );

      const hasMembers = voiceChannels.some(
        (channel: any) => channel.members && channel.members.size > 0
      );

      if (!hasMembers) {
        this.logger.log(`Cleaning up empty Banana Mix category: ${category.name}`);

        for (const [_, channel] of category.children.cache) {
          await channel.delete('No users in Banana Mix voice channels');
        }

        await category.delete('No users in Banana Mix voice channels');

        this.logger.log(`Successfully deleted category: ${category.name}`);
      }
    } catch (error) {
      this.logger.error('Error handling voice state update:', error);
    }
  }


  public async setup() {
    if (!this.discordConfig.token) {
      this.logger.warn("discord bot not configured");
      return;
    }

    void this.queue.add(
      RemoveArchivedThreads.name,
      {},
      {
        repeat: {
          pattern: "0 * * * *",
        },
      },
    );

    const rest = new REST({ version: "10" }).setToken(this.discordConfig.token);

    try {
      const commands: any[] = [
        await this.addBaseOptions(
          new SlashCommandBuilder()
            .setName(ChatCommands.ScheduleComp)
            .setDescription("Creates a Competitive Match"),
        ),
        await this.addBaseOptions(
          new SlashCommandBuilder()
            .setName(ChatCommands.ScheduleWingMan)
            .setDescription("Creates a Wingman Match"),
        ),
        await this.addBaseOptions(
          new SlashCommandBuilder()
            .setName(ChatCommands.ScheduleDuel)
            .setDescription("Creates a Duel Match"),
        ),
        new SlashCommandBuilder()
          .setName(ChatCommands.LinkDiscord)
          .setDescription(
            "Link your Discord account to 5stack.gg for stat tracking",
          ),
        new SlashCommandBuilder()
          .setName(ChatCommands.RegisterSteamId)
          .setDescription("Register your SteamID and create an account"),
        new SlashCommandBuilder()
          .setName(ChatCommands.ScheduleMix)
          .setDescription("Creates a Mix Match"),
        new SlashCommandBuilder()
          .setName(ChatCommands.Init)
          .setDescription("Initialize BananaServer.xyz Mix category and Queue Mix channel"),
        new SlashCommandBuilder()
          .setName(ChatCommands.Queue)
          .setDescription("Show the Queue Mix player order"),
        new SlashCommandBuilder()
          .setName(ChatCommands.KickPlayer)
          .setDescription("Kick a player from the queue")
          .addUserOption((option) =>
            option
              .setName("player")
              .setDescription("The player to kick from the queue")
              .setRequired(true),
          ),
      ];

      // if (process.env.NODE_ENV === 'development') {
        commands.push(
          new SlashCommandBuilder()
            .setName(ChatCommands.TestVote)
            .setDescription("[TEST ONLY] Simulate a vote for captain selection")
            .addStringOption((option) =>
              option
                .setName("message_id")
                .setDescription("The ID of the voting message")
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("user_id")
                .setDescription("The user ID to vote as")
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("fruit")
                .setDescription("The fruit emoji to vote for")
                .setRequired(true),
            ),
          new SlashCommandBuilder()
            .setName(ChatCommands.TestAutoVoteCaptains)
            .setDescription("[TEST ONLY] Auto-simulate random votes for all players")
            .addStringOption((option) =>
              option
                .setName("message_id")
                .setDescription("The ID of the voting message")
                .setRequired(true),
            ),
          new SlashCommandBuilder()
            .setName(ChatCommands.TestAutoReady)
            .setDescription("[TEST ONLY] Auto-simulate ready confirmations for all bot players")
            .addStringOption((option) =>
              option
                .setName("message_id")
                .setDescription("The ID of the ready check message")
                .setRequired(true),
            ),
          new SlashCommandBuilder()
            .setName(ChatCommands.TestAutoRemake)
            .setDescription("[TEST ONLY] Auto-simulate remake votes for all bot players")
            .addStringOption((option) =>
              option
                .setName("message_id")
                .setDescription("The ID of the remake vote message")
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("vote_yes_or_no")
                .setDescription("Vote yes or no")
                .setRequired(true)
                .addChoices(
                  { name: "Yes", value: "yes" },
                  { name: "No", value: "no" },
                ),
            ),
          new SlashCommandBuilder()
            .setName(ChatCommands.LeaveGuild)
            .setDescription("[TEST ONLY] Make the bot leave the current Discord server"),
        );
      // }

      await rest.put(Routes.applicationCommands(this.discordConfig.clientId), {
        body: commands,
      });

      await this.login();

      this.logger.log("successfully reloaded application (/) interactions.");
    } catch (error) {
      this.logger.error(`unable to reload application (/) commands`, error);
    }
  }

  private async addBaseOptions(builder: SlashCommandBuilder) {
    return builder
      .addChannelOption((option) =>
        option
          .setName("team-selection")
          .setDescription(
            "This channel should have at least 10 or 4 people to start a match based on the type.",
          )
          .addChannelTypes(ChannelType.GuildVoice),
      )
      .addBooleanOption((option) =>
        option
          .setName("knife")
          .setDescription("Knife Round to pick sides (default: true)"),
      )
      .addBooleanOption((option) =>
        option
          .setName("overtime")
          .setDescription("Allow Overtime (default: true)"),
      )
      .addStringOption((option) =>
        option
          .setName("map")
          .setDescription("Map Selection")
          .setAutocomplete(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("custom-map-pool")
          .setDescription("Allows yout to setup a custom map pool"),
      )
      .addBooleanOption((option) =>
        option
          .setName("captains")
          .setDescription(
            "Captain Picks Player Lineups, otherwise will be random lineups (default: false)",
          ),
      )
      .addUserOption((option) =>
        option.setName("captain-1").setDescription("Captain #1"),
      )
      .addUserOption((option) =>
        option.setName("captain-2").setDescription("Captain #2"),
      )
      .addStringOption((option) =>
        option
          .setName("mr")
          .setDescription("Sets the number of rounds per half (default MR12)")
          .addChoices(
            { name: "MR3", value: "3" },
            { name: "MR8", value: "8" },
            { name: "MR12", value: "12" },
            { name: "MR15", value: "15" },
          ),
      );
  }

  private async getMapChoices(type: e_match_types_enum) {
    if (this.mapChoices[type]) {
      return this.mapChoices[type];
    }

    const { maps } = await this.hasura.query({
      maps: {
        __args: {
          limit: 25,
          where: {
            type: {
              _eq: type,
            },
          },
        },
        id: true,
        name: true,
      },
    });

    const miniSearch = new MiniSearch({
      fields: ["name"],
      storeFields: ["name"],
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
      },
    });

    miniSearch.addAll(
      maps.map((map) => {
        return {
          id: map.id,
          name: map.name,
        };
      }),
    );

    return (this.mapChoices[type] = {
      maps,
      search: miniSearch,
    });
  }

  private async handleQueueMixTracking(oldState: any, newState: any) {
    try {
      const oldChannel = oldState.channel;
      const newChannel = newState.channel;
      const member = newState.member || oldState.member;

      if (!member) return;

      const guild = member.guild;
      if (!guild) return;

      const isJoiningQueueMix = newChannel?.name === '🍌 Queue Mix';
      const isLeavingQueueMix = oldChannel?.name === '🍌 Queue Mix';

      if (isJoiningQueueMix && !isLeavingQueueMix) {
        await this.addToQueueMix(guild.id, member.id);
        const position = await this.getQueueMixPosition(guild.id, member.id);
        this.logger.log(`${member.user.tag} joined Queue Mix - position: ${position}`);
      }

      if (isLeavingQueueMix && !isJoiningQueueMix) {
        // Só remove da fila se não está indo para um canal de mix
        const isGoingToMixChannel = newChannel?.name === 'Mix Voice' || newChannel?.parent?.name?.startsWith('Banana Mix');

        if (!isGoingToMixChannel) {
          await this.removeFromQueueMix(guild.id, member.id);
          this.logger.log(`${member.user.tag} left Queue Mix - removed from queue order`);
        } else {
          this.logger.log(`${member.user.tag} moved from Queue Mix to Mix Voice - keeping queue position`);
        }
      }
    } catch (error) {
      this.logger.error('Error handling queue mix tracking:', error);
    }
  }

  public async getQueueMixOrder(guildId: string, memberId: string): Promise<number | null> {
    return await this.getQueueMixPosition(guildId, memberId);
  }

  public async removeFromQueueMixOrder(guildId: string, memberId: string): Promise<void> {
    await this.removeFromQueueMix(guildId, memberId);
  }

  public async addPenaltyToPlayer(guildId: string, memberId: string): Promise<void> {
    // Remove da posição atual e adiciona novamente no final da fila
    await this.removeFromQueueMix(guildId, memberId);
    await this.addToQueueMix(guildId, memberId);
    this.logger.log(`Added penalty to ${memberId} in guild ${guildId} - moved to end of queue`);
  }

  public async addPlayerToTopOfQueue(guildId: string, memberId: string): Promise<void> {
    const redis = this.redisManager.getConnection();
    const key = this.getQueueMixRedisKey(guildId);

    // Remove da posição atual se já estiver na fila
    await redis.zrem(key, memberId);

    // Pegar o menor timestamp atual na fila
    const lowestScoreMember = await redis.zrange(key, 0, 0, 'WITHSCORES');
    let newTimestamp: number;

    if (lowestScoreMember.length > 0) {
      // Se há membros, usar um timestamp menor que o primeiro
      const lowestScore = parseFloat(lowestScoreMember[1]);
      newTimestamp = lowestScore - 1000; // 1 milissegundo antes
    } else {
      // Se não há membros, usar timestamp atual
      newTimestamp = Date.now() * 1000;
    }

    await redis.zadd(key, newTimestamp, memberId);
    this.logger.log(`Added ${memberId} to top of queue in guild ${guildId} with timestamp ${newTimestamp}`);
  }

  public async deleteMatchCategory(guildId: string, categoryChannelId: string): Promise<void> {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const category = guild.channels.cache.get(categoryChannelId);

      if (!category) {
        this.logger.error(`Category ${categoryChannelId} not found in guild ${guildId}`);
        return;
      }

      // Deletar todos os canais filhos da categoria
      if ('children' in category) {
        const children = category.children.cache;
        for (const [, child] of children) {
          try {
            await child.delete();
            this.logger.log(`Deleted channel ${child.name} from category ${category.name}`);
          } catch (error) {
            this.logger.error(`Failed to delete channel ${child.name}:`, error);
          }
        }
      }

      // Deletar a categoria
      await category.delete();
      this.logger.log(`Deleted category ${category.name} in guild ${guildId}`);
    } catch (error) {
      this.logger.error(`Error deleting match category ${categoryChannelId}:`, error);
      throw error;
    }
  }

  public async movePlayersToMix(queueMixChannel: any, players: any[], mixVoiceChannel: any): Promise<any[]> {
    this.logger.log(`Starting to move ${players.length} players from Queue Mix to mix voice channel`);

    const guild = queueMixChannel.guild;
    if (!guild) {
      this.logger.error('No guild found for queue mix channel');
      return [];
    }

    // Get all members from Redis queue ordered by join time
    const queuedMemberIds = await this.getAllQueueMembers(guild.id);

    // Map player IDs to their queue order
    const playerOrderMap = new Map<string, number>();
    queuedMemberIds.forEach((memberId, index) => {
      playerOrderMap.set(memberId, index);
    });

    // Sort players by their queue order
    const sortedPlayers = players.sort((a: any, b: any) => {
      const orderA = playerOrderMap.get(a.id) ?? 999999;
      const orderB = playerOrderMap.get(b.id) ?? 999999;
      return orderA - orderB;
    });

    const playersToMove = sortedPlayers.slice(0, 10);

    this.logger.log(`Moving first ${playersToMove.length} players (by queue order): ${playersToMove.map((p: any) => `${p.user.tag}(${playerOrderMap.get(p.id)})`).join(', ')}`);

    for (const player of playersToMove) {
      await player.voice.setChannel(mixVoiceChannel.id).catch((error: any) => {
        this.logger.warn(`Failed to move ${player.user.tag}: ${error.message}`);
      });
    }

    this.logger.log(`✅ Successfully moved ${playersToMove.length} players to mix`);

    return playersToMove;
  }

  /**
   * Registra uma partida criada pelo Discord Mix
   */
  public registerMixMatch(matchId: string, guildId: string, categoryId: string, team1PlayerIds: string[], team2PlayerIds: string[]) {
    this.mixMatches.set(matchId, {
      guildId,
      categoryId,
      team1PlayerIds,
      team2PlayerIds,
    });
    this.logger.log(`[Mix Match] Registered match ${matchId} for guild ${guildId}`);
  }

  /**
   * Processa o fim de uma partida do Discord Mix
   */
  public async handleMixMatchEnd(matchId: string, winningLineupId?: string) {
    const mixMatch = this.mixMatches.get(matchId);

    if (!mixMatch) {
      // Não é uma partida do mix, ignorar
      return;
    }

    this.logger.log(`[Mix Match] Processing end of match ${matchId}`);

    const { guildId, categoryId, team1PlayerIds, team2PlayerIds } = mixMatch;

    try {
      // Buscar qual lineup venceu
      const { matches_by_pk } = await this.hasura.query({
        matches_by_pk: {
          __args: {
            id: matchId
          },
          winning_lineup_id: true,
          lineup_1_id: true,
          lineup_2_id: true,
        }
      });

      if (!matches_by_pk) {
        this.logger.warn(`[Mix Match] Match ${matchId} not found in database`);
        return;
      }

      const actualWinningLineupId = winningLineupId || matches_by_pk.winning_lineup_id;

      // Determinar quais players venceram
      let winningPlayerIds: string[];
      let losingPlayerIds: string[];

      if (actualWinningLineupId === matches_by_pk.lineup_1_id) {
        winningPlayerIds = team1PlayerIds;
        losingPlayerIds = team2PlayerIds;
        this.logger.log(`[Mix Match] Team 1 won`);
      } else if (actualWinningLineupId === matches_by_pk.lineup_2_id) {
        winningPlayerIds = team2PlayerIds;
        losingPlayerIds = team1PlayerIds;
        this.logger.log(`[Mix Match] Team 2 won`);
      } else {
        // Empate ou sem vencedor - mover todos para o topo
        winningPlayerIds = [...team1PlayerIds, ...team2PlayerIds];
        losingPlayerIds = [];
        this.logger.log(`[Mix Match] No winner (tie/canceled) - moving all players to top`);
      }

      // Mover vencedores para o topo da fila
      for (const playerId of winningPlayerIds) {
        await this.addPlayerToTopOfQueue(guildId, playerId);
      }

      // Mover perdedores para o final da fila
      for (const playerId of losingPlayerIds) {
        await this.addPenaltyToPlayer(guildId, playerId);
      }

      // Deletar categoria e canais do Discord
      await this.deleteMatchCategory(guildId, categoryId);

      this.logger.log(`[Mix Match] Successfully processed end of match ${matchId}`);
    } catch (error) {
      this.logger.error(`[Mix Match] Error processing end of match ${matchId}:`, error);
    } finally {
      // Remover da lista de partidas ativas
      this.mixMatches.delete(matchId);
    }
  }
}
