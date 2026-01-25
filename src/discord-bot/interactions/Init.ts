import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import {
  ChatInputCommandInteraction,
  ChannelType,
  MessageFlags,
} from "discord.js";
import { Logger } from "@nestjs/common";

@BotChatCommand(ChatCommands.Init)
export default class Init extends DiscordInteraction {
  private readonly initLogger = new Logger(Init.name);

  public async handler(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply("This command can only be used in a server.");
        return;
      }

      await guild.channels.fetch();

      let category = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory &&
          channel.name === '🍌 BananaServer.xyz Mix'
      );

      let queueMixChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildVoice &&
          channel.name === '🍌 Queue Mix'
      );

      let afkChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildVoice &&
          channel.name === '💤 AFK'
      );

      const results: string[] = [];

      if (!category) {
        category = await guild.channels.create({
          name: '🍌 BananaServer.xyz Mix',
          type: ChannelType.GuildCategory,
        });

        await category.setPosition(0);
        results.push('✅ Created category: **🍌 BananaServer.xyz Mix**');
        this.initLogger.log(`Created BananaServer.xyz Mix category in guild: ${guild.name}`);
      } else {
        results.push('ℹ️ Category **🍌 BananaServer.xyz Mix** already exists');
      }

      if (!queueMixChannel) {
        queueMixChannel = await guild.channels.create({
          name: '🍌 Queue Mix',
          type: ChannelType.GuildVoice,
          parent: category?.id,
        });
        results.push('✅ Created voice channel: **🍌 Queue Mix**');
        this.initLogger.log(`Created Queue Mix channel in guild: ${guild.name}`);
      } else {
        results.push('ℹ️ Voice channel **🍌 Queue Mix** already exists');

        if ('setParent' in queueMixChannel && queueMixChannel.parentId !== category?.id && category) {
          await (queueMixChannel as any).setParent(category.id);
          results.push('✅ Moved **🍌 Queue Mix** to the correct category');
        }
      }

      if (!afkChannel) {
        afkChannel = await guild.channels.create({
          name: '💤 AFK',
          type: ChannelType.GuildVoice,
          parent: category?.id,
        });
        results.push('✅ Created voice channel: **💤 AFK**');
        this.initLogger.log(`Created AFK channel in guild: ${guild.name}`);
      } else {
        results.push('ℹ️ Voice channel **💤 AFK** already exists');

        if ('setParent' in afkChannel && afkChannel.parentId !== category?.id && category) {
          await (afkChannel as any).setParent(category.id);
          results.push('✅ Moved **💤 AFK** to the correct category');
        }
      }

      // Salvar/atualizar informações da guild no banco de dados
      try {
        const guildOwner = await guild.fetchOwner();

        await this.hasura.mutation({
          insert_discord_guilds_one: {
            __args: {
              object: {
                id: guild.id,
                name: guild.name,
                icon: guild.icon,
                owner_id: guildOwner.id,
                category_channel_id: category?.id,
                queue_mix_channel_id: queueMixChannel?.id,
                afk_channel_id: afkChannel?.id,
              },
              on_conflict: {
                constraint: 'discord_guilds_pkey',
                update_columns: ['name', 'icon', 'owner_id', 'category_channel_id', 'queue_mix_channel_id', 'afk_channel_id', 'updated_at'],
              },
            },
            id: true,
          },
        });

        results.push('✅ Guild information saved to database');
        this.initLogger.log(`Saved guild information for: ${guild.name} (${guild.id})`);
      } catch (dbError) {
        this.initLogger.error('Error saving guild to database:', dbError);
        results.push('⚠️ Warning: Could not save guild information to database');
      }

      await interaction.editReply(
        `**Initialization Complete!**\n\n${results.join('\n')}`
      );

    } catch (error) {
      this.initLogger.error('Error in /init command:', error);
      await interaction.editReply("❌ Error initializing server structure. Check bot permissions.");
    }
  }
}
