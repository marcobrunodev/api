import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";
import { WarmupServerService } from "../warmup-server/warmup-server.service";
import { DiscordBotService } from "../discord-bot.service";
import { MatchAssistantService } from "../../matches/match-assistant/match-assistant.service";
import { DiscordBotVoiceChannelsService } from "../discord-bot-voice-channels/discord-bot-voice-channels.service";
import { DiscordBotMessagingService } from "../discord-bot-messaging/discord-bot-messaging.service";
import { DiscordPickPlayerService } from "../discord-pick-player/discord-pick-player.service";
import { DiscordBotOverviewService } from "../discord-bot-overview/discord-bot-overview.service";
import { DiscordBotVetoService } from "../discord-bot-veto/discord-bot-veto.service";
import { HasuraService } from "../../hasura/hasura.service";
import { forwardRef, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@BotChatCommand(ChatCommands.Warmup)
export default class Warmup extends DiscordInteraction {
  constructor(
    logger: Logger,
    config: ConfigService,
    hasura: HasuraService,
    @Inject(forwardRef(() => DiscordBotService))
    bot: DiscordBotService,
    matchAssistant: MatchAssistantService,
    discordBotVeto: DiscordBotVetoService,
    discordPickPlayer: DiscordPickPlayerService,
    discordBotMessaging: DiscordBotMessagingService,
    discordMatchOverview: DiscordBotOverviewService,
    discordBotVoiceChannels: DiscordBotVoiceChannelsService,
    private readonly warmupServer: WarmupServerService,
  ) {
    super(
      logger,
      config,
      hasura,
      bot,
      matchAssistant,
      discordBotVeto,
      discordPickPlayer,
      discordBotMessaging,
      discordMatchOverview,
      discordBotVoiceChannels,
    );
  }

  async handler(interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction) {
    if (!interaction.isChatInputCommand()) return;

    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const state = await this.warmupServer.getState(guild.id);

      if (state?.serverId && !state.isProvisioning) {
        const connectCommand = state.serverPassword
          ? `connect ${state.serverIp}:${state.serverPort}; password ${state.serverPassword}`
          : `connect ${state.serverIp}:${state.serverPort}`;

        await interaction.editReply({
          embeds: [{
            title: '🎮 Warmup Server Running!',
            description: [
              `**Mode:** ${state.currentGameMode}`,
              `**Map:** ${state.currentMap}`,
              '',
              '**Connect to Server:**',
              `\`\`\`${connectCommand}\`\`\``,
              '',
              'Play while waiting for the mix! 🍌',
            ].join('\n'),
            color: 0x00FF00,
            footer: {
              text: 'From BananaServer.xyz with 🍌',
            },
            timestamp: new Date().toISOString(),
          }],
        });
        return;
      }

      if (state?.isProvisioning) {
        await interaction.editReply({
          embeds: [{
            title: '⏳ Warmup Server Starting...',
            description: 'A warmup server is being provisioned. Please wait a moment and try again.',
            color: 0xFFD700,
            footer: {
              text: 'From BananaServer.xyz with 🍌',
            },
            timestamp: new Date().toISOString(),
          }],
        });
        return;
      }

      // No warmup server running - start one
      const newState = await this.warmupServer.startWarmupServer(
        guild.id,
        guild,
        undefined,
      );

      if (!newState?.serverId) {
        await interaction.editReply({
          embeds: [{
            title: '❌ No Server Available',
            description: 'No server slot is available at the moment. Please try again later.',
            color: 0xFF0000,
            footer: {
              text: 'From BananaServer.xyz with 🍌',
            },
            timestamp: new Date().toISOString(),
          }],
        });
        return;
      }

      const connectCommand = newState.serverPassword
        ? `connect ${newState.serverIp}:${newState.serverPort}; password ${newState.serverPassword}`
        : `connect ${newState.serverIp}:${newState.serverPort}`;

      await interaction.editReply({
        embeds: [{
          title: '🎮 Warmup Server Ready!',
          description: [
            `**Mode:** ${newState.currentGameMode}`,
            `**Map:** ${newState.currentMap}`,
            '',
            '**Connect to Server:**',
            `\`\`\`${connectCommand}\`\`\``,
            '',
            'Play while waiting for the mix! 🍌',
          ].join('\n'),
          color: 0x00FF00,
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          },
          timestamp: new Date().toISOString(),
        }],
      });
    } catch (error) {
      this.logger.error('[Warmup Command] Error:', error);
      await interaction.editReply({
        embeds: [{
          title: '❌ Error',
          description: 'An error occurred while processing the warmup command.',
          color: 0xFF0000,
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          },
          timestamp: new Date().toISOString(),
        }],
      });
    }
  }
}
