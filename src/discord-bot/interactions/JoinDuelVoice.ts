import {
  ButtonInteraction,
  MessageFlags,
  ChannelType,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotButtonInteraction(ButtonActions.JoinDuelVoice)
export default class JoinDuelVoice extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // customId format: jdv:voiceChannelId
    const [, voiceChannelId] = interaction.customId.split(":");

    if (!voiceChannelId) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "❌ Invalid voice channel.",
      });
      return;
    }

    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: "❌ This can only be used in a server.",
        });
        return;
      }

      const voiceChannel = await guild.channels.fetch(voiceChannelId);
      
      if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: "❌ Voice channel not found. The duel may have ended.",
        });
        return;
      }

      // Create an invite for the voice channel
      const invite = await voiceChannel.createInvite({
        maxAge: 300, // 5 minutes
        maxUses: 1,
        unique: true,
        reason: 'Duel voice channel invite'
      });

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `🔊 **Click here to join the voice channel:**\n${invite.url}`,
      });

    } catch (error) {
      this.logger.error('Error creating voice channel invite:', error);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "❌ Failed to create invite. Please join the voice channel manually.",
      });
    }
  }
}
