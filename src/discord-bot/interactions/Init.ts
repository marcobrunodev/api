import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import {
  ChatInputCommandInteraction,
  ChannelType,
  MessageFlags,
} from "discord.js";

@BotChatCommand(ChatCommands.Init)
export default class Init extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
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

      const results: string[] = [];

      if (!category) {
        category = await guild.channels.create({
          name: '🍌 BananaServer.xyz Mix',
          type: ChannelType.GuildCategory,
        });

        await category.setPosition(0);
        results.push('✅ Created category: **🍌 BananaServer.xyz Mix**');
        this.logger.log(`Created BananaServer.xyz Mix category in guild: ${guild.name}`);
      } else {
        results.push('ℹ️ Category **🍌 BananaServer.xyz Mix** already exists');
      }

      if (!queueMixChannel) {
        queueMixChannel = await guild.channels.create({
          name: '🍌 Queue Mix',
          type: ChannelType.GuildVoice,
          parent: category.id,
        });
        results.push('✅ Created voice channel: **🍌 Queue Mix**');
        this.logger.log(`Created Queue Mix channel in guild: ${guild.name}`);
      } else {
        results.push('ℹ️ Voice channel **🍌 Queue Mix** already exists');

        if ('setParent' in queueMixChannel && queueMixChannel.parentId !== category.id) {
          await (queueMixChannel as any).setParent(category.id);
          results.push('✅ Moved **🍌 Queue Mix** to the correct category');
        }
      }

      await interaction.editReply(
        `**Initialization Complete!**\n\n${results.join('\n')}`
      );

    } catch (error) {
      this.logger.error('Error in /init command:', error);
      await interaction.editReply("❌ Error initializing server structure. Check bot permissions.");
    }
  }
}
