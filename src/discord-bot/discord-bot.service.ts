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
    e_match_types_enum,
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

  private queueRoles = new Map<string, Map<number, any>>();
  private waitingRoomJoinOrder = new Map<string, number>();
  private nextJoinOrderNumber = 0;

  private async handleVoiceStateUpdate(oldState: any, newState: any) {
    try {
      await this.handleWaitingRoomNicknames(oldState, newState);

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

  private async getOrCreateQueueRole(guild: any, position: number): Promise<any> {
    const guildId = guild.id;

    if (!this.queueRoles.has(guildId)) {
      this.queueRoles.set(guildId, new Map());
    }

    const guildRoles = this.queueRoles.get(guildId);

    if (guildRoles.has(position)) {
      return guildRoles.get(position);
    }

    const roleName = `Queue-${position.toString().padStart(2, '0')}`;

    let role = guild.roles.cache.find((r: any) => r.name === roleName);

    if (!role) {
      role = await guild.roles.create({
        name: roleName,
        color: 0x95a5a6,
        mentionable: false,
        hoist: false,
      });
      this.logger.log(`Created queue role: ${roleName} in guild: ${guild.name}`);
    }

    guildRoles.set(position, role);
    return role;
  }

  private async removeAllQueueRoles(member: any): Promise<void> {
    const queueRoles = member.roles.cache.filter((role: any) => role.name.startsWith('Queue-'));

    for (const [_, role] of queueRoles) {
      await member.roles.remove(role).catch((error: any) => {
        this.logger.warn(`Failed to remove queue role ${role.name} from ${member.user.tag}: ${error.message}`);
      });
    }
  }

  private getPositionFromRoles(member: any): number | null {
    const queueRole = member.roles.cache.find((role: any) => role.name.startsWith('Queue-'));

    if (!queueRole) return null;

    const match = queueRole.name.match(/Queue-(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  private async handleWaitingRoomNicknames(oldState: any, newState: any) {
    try {
      const oldChannel = oldState.channel;
      const newChannel = newState.channel;
      const member = newState.member || oldState.member;

      if (!member) return;

      const isJoiningWaitingRoom = newChannel?.name === '🍌 Queue Mix';
      const isLeavingWaitingRoom = oldChannel?.name === '🍌 Queue Mix';

      this.logger.log(`Voice state update: ${member.user.tag} | Old: ${oldChannel?.name || 'none'} | New: ${newChannel?.name || 'none'}`);

      if (isJoiningWaitingRoom && !isLeavingWaitingRoom) {
        this.logger.log(`${member.user.tag} is joining Queue Mix`);

        const guild = member.guild;

        if (!this.waitingRoomJoinOrder.has(member.id)) {
          this.waitingRoomJoinOrder.set(member.id, this.nextJoinOrderNumber++);
          this.logger.log(`Assigned join order ${this.waitingRoomJoinOrder.get(member.id)} to ${member.user.tag}`);
        }

        const allMembersInChannel = Array.from(newChannel.members.values());

        this.logger.log(`Members in channel: ${allMembersInChannel.map((m: any) => `${m.user.tag}(order:${this.waitingRoomJoinOrder.get(m.id) ?? 'none'})`).join(', ')}`);

        allMembersInChannel.sort((a: any, b: any) => {
          const aOrder = this.waitingRoomJoinOrder.get(a.id) ?? 999999;
          const bOrder = this.waitingRoomJoinOrder.get(b.id) ?? 999999;
          return aOrder - bOrder;
        });

        this.logger.log(`Members after sort: ${allMembersInChannel.map((m: any) => `${m.user.tag}(order:${this.waitingRoomJoinOrder.get(m.id)})`).join(', ')}`);

        for (let i = 0; i < allMembersInChannel.length; i++) {
          const currentMember = allMembersInChannel[i] as any;
          const currentPosition = this.getPositionFromRoles(currentMember);

          this.logger.log(`Processing ${currentMember.user.tag}: targetPosition=${i}, currentPosition=${currentPosition}`);

          if (i !== currentPosition) {
            this.logger.log(`Assigning position ${i} to ${currentMember.user.tag} (was: ${currentPosition})`);

            await this.removeAllQueueRoles(currentMember);

            const queueRole = await this.getOrCreateQueueRole(guild, i);
            await currentMember.roles.add(queueRole).catch((error: any) => {
              this.logger.warn(`Failed to add queue role to ${currentMember.user.tag}: ${error.message}`);
            });

            this.logger.log(`Added queue role Queue-${i.toString().padStart(2, '0')} to ${currentMember.user.tag}`);

            const currentNickname = currentMember.nickname || currentMember.user.username;
            const cleanNickname = currentNickname.replace(/^\d{2} \| /, '');
            const prefix = i.toString().padStart(2, '0');

            await currentMember.setNickname(`${prefix} | ${cleanNickname}`).catch((error: any) => {
              this.logger.warn(`Failed to set nickname for ${currentMember.user.tag}: ${error.message}`);
            });

            this.logger.log(`✅ Updated ${currentMember.user.tag} to position ${i} with role Queue-${prefix}`);
          } else {
            this.logger.log(`✓ ${currentMember.user.tag} already has correct position ${i}`);
          }
        }
      }

      if (isLeavingWaitingRoom && !isJoiningWaitingRoom) {
        this.logger.log(`${member.user.tag} is leaving Queue Mix`);

        await this.removeAllQueueRoles(member);

        this.waitingRoomJoinOrder.delete(member.id);
        this.logger.log(`Removed join order for ${member.user.tag}`);

        const currentNickname = member.nickname || member.user.username;
        const cleanNickname = currentNickname.replace(/^\d{2} \| /, '');

        this.logger.log(`Restoring nickname for ${member.user.tag}: "${currentNickname}" -> "${cleanNickname}"`);

        if (cleanNickname !== currentNickname) {
          await member.setNickname(cleanNickname).catch((error: any) => {
            this.logger.warn(`Failed to restore nickname for ${member.user.tag}: ${error.message}`);
          });
        }

        if (oldChannel && oldChannel.members.size > 0) {
          const guild = member.guild;
          const remainingMembers = Array.from(oldChannel.members.values())
            .sort((a: any, b: any) => {
              const orderA = this.waitingRoomJoinOrder.get(a.id) ?? 999999;
              const orderB = this.waitingRoomJoinOrder.get(b.id) ?? 999999;
              return orderA - orderB;
            });

          this.logger.log(`Reordering remaining members: ${remainingMembers.map((m: any) => `${m.user.tag}(order:${this.waitingRoomJoinOrder.get(m.id)})`).join(', ')}`);

          for (let i = 0; i < remainingMembers.length; i++) {
            const existingMember = remainingMembers[i] as any;
            const currentPosition = this.getPositionFromRoles(existingMember);

            if (currentPosition !== i) {
              this.logger.log(`Reassigning ${existingMember.user.tag} from position ${currentPosition} to ${i}`);

              await this.removeAllQueueRoles(existingMember);

              const newRole = await this.getOrCreateQueueRole(guild, i);
              await existingMember.roles.add(newRole).catch((error: any) => {
                this.logger.warn(`Failed to reassign queue role for ${existingMember.user.tag}: ${error.message}`);
              });

              const memberNickname = existingMember.nickname || existingMember.user.username;
              const memberCleanNickname = memberNickname.replace(/^\d{2} \| /, '');
              const newPrefix = i.toString().padStart(2, '0');

              await existingMember.setNickname(`${newPrefix} | ${memberCleanNickname}`).catch((error: any) => {
                this.logger.warn(`Failed to update nickname for ${existingMember.user.tag}: ${error.message}`);
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling waiting room nicknames:', error);
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
          .setName(ChatCommands.ScheduleMix)
          .setDescription("Creates a Mix Match"),
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
            .setName(ChatCommands.TestAutoVote)
            .setDescription("[TEST ONLY] Auto-simulate random votes for all players")
            .addStringOption((option) =>
              option
                .setName("message_id")
                .setDescription("The ID of the voting message")
                .setRequired(true),
            ),
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
}
