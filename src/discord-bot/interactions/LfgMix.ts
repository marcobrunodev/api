import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ChannelType,
  TextChannel,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";

const MIX_PLAYERS_REQUIRED = 10;

@BotChatCommand(ChatCommands.LfgMix)
export default class LfgMix extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    // Get channel IDs from database
    const { discord_guilds_by_pk } = await this.hasura.query({
      discord_guilds_by_pk: {
        __args: { id: guild.id },
        notification_channel_id: true,
        queue_mix_channel_id: true,
      },
    });

    if (!discord_guilds_by_pk?.notification_channel_id || !discord_guilds_by_pk?.queue_mix_channel_id) {
      await interaction.reply({
        content: "❌ Channels not configured. Please run `/init` first.",
        ephemeral: true,
      });
      return;
    }

    // Fetch the notification channel
    const notificationChannel = await guild.channels.fetch(discord_guilds_by_pk.notification_channel_id);

    if (!notificationChannel || notificationChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: "❌ Notification channel not found. Please run `/init` again.",
        ephemeral: true,
      });
      return;
    }

    // Fetch the Queue Mix voice channel by ID from database
    const queueMixChannel = await guild.channels.fetch(discord_guilds_by_pk.queue_mix_channel_id);

    // Count players in the Queue Mix channel
    let currentPlayers = 0;
    if (queueMixChannel && queueMixChannel.isVoiceBased()) {
      currentPlayers = queueMixChannel.members.size;
    }

    const playersNeeded = Math.max(0, MIX_PLAYERS_REQUIRED - currentPlayers);

    // Find the @banana-mix role
    const bananaMixRole = guild.roles.cache.find(
      (role) => role.name === "banana-mix"
    );

    const roleMention = bananaMixRole ? `<@&${bananaMixRole.id}>` : "@everyone";

    // Build status message
    let statusMessage: string;
    let statusEmoji: string;

    if (currentPlayers >= MIX_PLAYERS_REQUIRED) {
      statusEmoji = "🎮";
      statusMessage = `**${currentPlayers}/${MIX_PLAYERS_REQUIRED}** players - Ready to start!`;
    } else if (currentPlayers > 0) {
      statusEmoji = "⏳";
      statusMessage = `**${currentPlayers}/${MIX_PLAYERS_REQUIRED}** players - Need **${playersNeeded}** more!`;
    } else {
      statusEmoji = "🔍";
      statusMessage = `**0/${MIX_PLAYERS_REQUIRED}** players - Need **${playersNeeded}** to start!`;
    }

    const embed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle("🍌 Looking for Mix Players!")
      .setDescription(
        `<@${interaction.user.id}> is calling all players!\n\n` +
        `${statusEmoji} ${statusMessage}\n\n` +
        `Join the **🍌 Queue Mix** voice channel to participate.`
      )
      .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
      .setFooter({
        text: "BananaServer.xyz Mix",
        iconURL: guild.iconURL() ?? undefined,
      })
      .setTimestamp();

    // Send message to notification channel
    await (notificationChannel as TextChannel).send({
      content: roleMention,
      embeds: [embed],
    });

    // Reply to the user that the message was sent
    await interaction.reply({
      content: `✅ LFG message sent to <#${notificationChannel.id}>!`,
      ephemeral: true,
    });
  }
}
