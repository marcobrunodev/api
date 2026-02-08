import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import {
  ChatInputCommandInteraction,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { Logger } from "@nestjs/common";
import { sendChannelOnboarding, OnboardingChannelType } from "../helpers/channel-onboarding.helper";

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

      // Create notification channel
      let notificationChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.name === '🍌-notification'
      );

      const botId = interaction.client.user?.id;

      if (!notificationChannel) {
        const permissionOverwrites: any[] = [
          {
            id: guild.roles.everyone.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads],
          },
        ];

        // Allow bot to send messages
        if (botId) {
          permissionOverwrites.push({
            id: botId,
            allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
          });
        }

        notificationChannel = await guild.channels.create({
          name: '🍌-notification',
          type: ChannelType.GuildText,
          parent: category?.id,
          topic: 'BananaServer.xyz Mix notifications',
          permissionOverwrites,
        });
        results.push('✅ Created text channel: **🍌-notification** (read-only)');
        this.initLogger.log(`Created notification channel in guild: ${guild.name}`);
      } else {
        results.push('ℹ️ Text channel **🍌-notification** already exists');

        if ('setParent' in notificationChannel && notificationChannel.parentId !== category?.id && category) {
          await (notificationChannel as any).setParent(category.id);
          results.push('✅ Moved **🍌-notification** to the correct category');
        }

        // Ensure read-only permissions for @everyone
        if ('permissionOverwrites' in notificationChannel) {
          await (notificationChannel as any).permissionOverwrites.edit(guild.roles.everyone, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
          });

          // Ensure bot can send messages
          if (botId) {
            await (notificationChannel as any).permissionOverwrites.edit(botId, {
              SendMessages: true,
              EmbedLinks: true,
            });
          }

          results.push('✅ Updated **🍌-notification** permissions (read-only for users, bot can send)');
        }
      }

      // Create @banana-mix role
      let bananaMixRole = guild.roles.cache.find(
        (role) => role.name === 'banana-mix'
      );

      if (!bananaMixRole) {
        bananaMixRole = await guild.roles.create({
          name: 'banana-mix',
          color: 0xf5a623, // Orange/banana color
          reason: 'BananaServer.xyz Mix role for players',
        });
        results.push('✅ Created role: **@banana-mix**');
        this.initLogger.log(`Created banana-mix role in guild: ${guild.name}`);
      } else {
        results.push('ℹ️ Role **@banana-mix** already exists');
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
                notification_channel_id: notificationChannel?.id,
              },
              on_conflict: {
                constraint: 'discord_guilds_pkey',
                update_columns: ['name', 'icon', 'owner_id', 'category_channel_id', 'queue_mix_channel_id', 'afk_channel_id', 'notification_channel_id', 'updated_at'],
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

      // Create TEAMS category at the end of the server
      const teamsCategoryName = "🍌⬇️ TEAMS ⬇️🍌";
      let teamsCategory = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory &&
          channel.name === teamsCategoryName
      );

      if (!teamsCategory) {
        teamsCategory = await guild.channels.create({
          name: teamsCategoryName,
          type: ChannelType.GuildCategory,
        });
        // Position at the end (high number = bottom)
        const maxPosition = Math.max(
          ...guild.channels.cache
            .filter((c) => c.type === ChannelType.GuildCategory)
            .map((c) => c.position),
          0
        );
        await teamsCategory.setPosition(maxPosition + 1);
        results.push(`✅ Created category: **${teamsCategoryName}**`);
        this.initLogger.log(`Created TEAMS category in guild: ${guild.name}`);
      } else {
        results.push(`ℹ️ Category **${teamsCategoryName}** already exists`);
      }

      // Criar canal de texto para enviar mensagens de onboarding (se não existir)
      let infoChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.name === 'banana-info' &&
          channel.parentId === category?.id
      );

      let sendOnboarding = false;

      if (!infoChannel) {
        infoChannel = await guild.channels.create({
          name: 'banana-info',
          type: ChannelType.GuildText,
          parent: category?.id,
          topic: 'Information about BananaServer.xyz Mix channels and how to use them',
        });
        results.push('✅ Created info channel: **banana-info**');
        this.initLogger.log(`Created banana-info channel in guild: ${guild.name}`);
        sendOnboarding = true;
      } else {
        results.push('ℹ️ Info channel **banana-info** already exists');
      }

      await interaction.editReply(
        `**Initialization Complete!**\n\n${results.join('\n')}`
      );

      // Enviar mensagens de onboarding se o canal foi recém-criado
      if (sendOnboarding && infoChannel && 'send' in infoChannel) {
        await sendChannelOnboarding(
          infoChannel as any,
          OnboardingChannelType.BANANA_MIX_CATEGORY,
          `The **${category?.name}** category has been set up successfully!`
        );

        await sendChannelOnboarding(
          infoChannel as any,
          OnboardingChannelType.QUEUE_MIX
        );

        await sendChannelOnboarding(
          infoChannel as any,
          OnboardingChannelType.AFK
        );
      }

    } catch (error) {
      this.initLogger.error('Error in /init command:', error);
      await interaction.editReply("❌ Error initializing server structure. Check bot permissions.");
    }
  }
}
