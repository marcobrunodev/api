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

  constructor(
    readonly config: ConfigService,
    private readonly logger: Logger,
    private readonly hasura: HasuraService,
    private readonly moduleRef: ModuleRef,
    @InjectQueue(DiscordBotQueues.DiscordBot) private queue: Queue,
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

          this.logger.log(`Successfully created category and waiting room in guild: ${guild.name}`);
        } else {
          this.logger.log(`BananaServer.xyz Mix category already exists in guild: ${guild.name}`);
        }
      }
    } catch (error) {
      this.logger.error('Error ensuring BananaServer.xyz Mix category:', error);
    }
  }

  private queueMixJoinOrder = new Map<string, number>();
  private nextQueueJoinNumber = 0;

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

      if (process.env.NODE_ENV === 'development') {
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
            .setName(ChatCommands.LeaveGuild)
            .setDescription("[TEST ONLY] Make the bot leave the current Discord server"),
        );
      }

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

      const isJoiningQueueMix = newChannel?.name === '🍌 Queue Mix';
      const isLeavingQueueMix = oldChannel?.name === '🍌 Queue Mix';

      if (isJoiningQueueMix && !isLeavingQueueMix) {
        this.queueMixJoinOrder.set(member.id, this.nextQueueJoinNumber++);
        this.logger.log(`${member.user.tag} joined Queue Mix - position: ${this.queueMixJoinOrder.get(member.id)}`);
      }

      if (isLeavingQueueMix && !isJoiningQueueMix) {
        // Só remove da fila se não está indo para um canal de mix
        const isGoingToMixChannel = newChannel?.name === 'Mix Voice' || newChannel?.parent?.name?.startsWith('Banana Mix');

        if (!isGoingToMixChannel) {
          this.queueMixJoinOrder.delete(member.id);
          this.logger.log(`${member.user.tag} left Queue Mix - removed from queue order`);
        } else {
          this.logger.log(`${member.user.tag} moved from Queue Mix to Mix Voice - keeping queue position`);
        }
      }
    } catch (error) {
      this.logger.error('Error handling queue mix tracking:', error);
    }
  }

  public getQueueMixOrder(memberId: string): number | null {
    return this.queueMixJoinOrder.get(memberId) ?? null;
  }

  public removeFromQueueMixOrder(memberId: string): void {
    this.queueMixJoinOrder.delete(memberId);
    this.logger.log(`Removed ${memberId} from queue mix order`);
  }

  public async movePlayersToMix(queueMixChannel: any, players: any[], mixVoiceChannel: any): Promise<any[]> {
    this.logger.log(`Starting to move ${players.length} players from Queue Mix to mix voice channel`);

    const sortedPlayers = players.sort((a: any, b: any) => {
      const orderA = this.queueMixJoinOrder.get(a.id) ?? 999999;
      const orderB = this.queueMixJoinOrder.get(b.id) ?? 999999;
      return orderA - orderB;
    });

    const playersToMove = sortedPlayers.slice(0, 10);

    this.logger.log(`Moving first ${playersToMove.length} players (by queue order): ${playersToMove.map((p: any) => `${p.user.tag}(${this.queueMixJoinOrder.get(p.id)})`).join(', ')}`);

    for (const player of playersToMove) {
      await player.voice.setChannel(mixVoiceChannel.id).catch((error: any) => {
        this.logger.warn(`Failed to move ${player.user.tag}: ${error.message}`);
      });
    }

    this.logger.log(`✅ Successfully moved ${playersToMove.length} players to mix`);

    return playersToMove;
  }
}
