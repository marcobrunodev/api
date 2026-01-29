import { TextChannel, EmbedBuilder, ChannelType } from 'discord.js';

export enum OnboardingChannelType {
  BANANA_MIX_CATEGORY = 'banana_mix_category',
  QUEUE_MIX = 'queue_mix',
  AFK = 'afk',
  MIX_CATEGORY = 'mix_category',
  MIX_VOICE = 'mix_voice',
  PICKS_BANS = 'picks_bans',
  SCOREBOARD = 'scoreboard',
}

interface ChannelOnboardingInfo {
  icon: string;
  title: string;
  description: string;
  usage: string[];
}

const CHANNEL_ONBOARDING_INFO: Record<OnboardingChannelType, ChannelOnboardingInfo> = {
  [OnboardingChannelType.BANANA_MIX_CATEGORY]: {
    icon: '🍌',
    title: 'BananaServer.xyz Mix Category',
    description: 'Main category for all mix-related channels',
    usage: [
      'Contains the Queue Mix voice channel',
      'Contains the AFK channel',
      'All mix sessions will be created below this category',
    ],
  },
  [OnboardingChannelType.QUEUE_MIX]: {
    icon: '🍌',
    title: 'Queue Mix Voice Channel',
    description: 'Join this channel to queue for competitive mixes',
    usage: [
      'Join this channel and wait for 10 players',
      'Once 10 players are in the queue, any player can use `/mix` to start',
      'Players will be automatically moved to the mix channels',
    ],
  },
  [OnboardingChannelType.AFK]: {
    icon: '💤',
    title: 'AFK Channel',
    description: 'Channel for AFK/inactive players',
    usage: [
      'Players who don\'t ready up in time will be moved here',
      'You can manually move to this channel if you need to go AFK',
      'AFK players receive a penalty and are moved to the end of the queue',
    ],
  },
  [OnboardingChannelType.MIX_CATEGORY]: {
    icon: '🎮',
    title: 'Mix Session Category',
    description: 'Private category for your current mix session',
    usage: [
      'Contains all channels for this specific mix',
      'Will be automatically deleted after the match ends',
      'Each mix gets a unique 5-character code',
    ],
  },
  [OnboardingChannelType.MIX_VOICE]: {
    icon: '🔊',
    title: 'Mix Voice Channel',
    description: 'Voice channel where all players start before teams are formed',
    usage: [
      'All 10 players will be here initially',
      'Complete the ready check to proceed',
      'After captain selection, you\'ll be moved to your team\'s voice channel',
    ],
  },
  [OnboardingChannelType.PICKS_BANS]: {
    icon: '💬',
    title: 'Picks & Bans Text Channel',
    description: 'Text channel for all mix coordination',
    usage: [
      '1️⃣ Ready check - Click ready when you\'re prepared',
      '2️⃣ Captain voting - Vote for 2 captains',
      '3️⃣ Team selection - Captains pick their teams',
      '4️⃣ Map veto - Captains ban maps until one remains',
    ],
  },
  [OnboardingChannelType.SCOREBOARD]: {
    icon: '📊',
    title: 'Scoreboard Channel',
    description: 'Live match statistics and scoreboard',
    usage: [
      'Displays real-time match statistics',
      'Updated automatically after each round',
      'Shows team scores, player stats, and round history',
      'Read-only channel (only bot can send messages)',
    ],
  },
};

/**
 * Sends an onboarding message to a text channel explaining what it's for
 */
export async function sendChannelOnboarding(
  channel: TextChannel,
  type: OnboardingChannelType,
  additionalInfo?: string
): Promise<void> {
  console.log(`[CHANNEL ONBOARDING] Sending onboarding for type: ${type} to channel: ${channel.name}`);

  const info = CHANNEL_ONBOARDING_INFO[type];

  if (!info) {
    console.warn(`[CHANNEL ONBOARDING] Unknown channel type: ${type}`);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${info.icon} ${info.title}`)
    .setDescription(info.description)
    .setColor(0xFFD700)
    .addFields({
      name: '📋 How to Use',
      value: info.usage.map((item, index) => `${index + 1}. ${item}`).join('\n'),
    })
    .setFooter({ text: 'From BananaServer.xyz with 🍌' })
    .setTimestamp();

  if (additionalInfo) {
    embed.addFields({
      name: 'ℹ️ Additional Info',
      value: additionalInfo,
    });
  }

  try {
    const message = await channel.send({ embeds: [embed] });
    console.log(`[CHANNEL ONBOARDING] ✅ Successfully sent onboarding message (ID: ${message.id})`);
  } catch (error) {
    console.error(`[CHANNEL ONBOARDING] ❌ Failed to send onboarding message:`, error);
  }
}

/**
 * Sends a comprehensive onboarding message showing all channels in a mix session
 */
export async function sendMixSessionOnboarding(
  channel: TextChannel,
  mixCode: string,
  categoryName: string
): Promise<void> {
  console.log(`[MIX SESSION ONBOARDING] Sending onboarding for mix ${mixCode} to channel: ${channel.name}`);

  const embed = new EmbedBuilder()
    .setTitle('🎮 Welcome to Your Mix Session!')
    .setDescription(
      `Your mix session **${categoryName}** has been created!\n\n` +
      'Here\'s a quick guide to the channels you\'ll use:'
    )
    .setColor(0xFFD700)
    .addFields(
      {
        name: '🔊 Mix Voice',
        value: 'All players start here. Complete the ready check and vote for captains.',
        inline: false,
      },
      {
        name: '💬 picks-bans',
        value: 'This channel! Used for ready check → captain voting → team selection → map veto',
        inline: false,
      },
      {
        name: '🔊 Team Channels',
        value: 'After team selection, each team gets their own voice channel for tactics',
        inline: false,
      },
      {
        name: '📊 scoreboard',
        value: 'Created after map veto. Shows live match stats and updates each round',
        inline: false,
      }
    )
    .setFooter({ text: 'From BananaServer.xyz with 🍌' })
    .setTimestamp();

  try {
    const message = await channel.send({ embeds: [embed] });
    console.log(`[MIX SESSION ONBOARDING] ✅ Successfully sent onboarding message (ID: ${message.id})`);
  } catch (error) {
    console.error(`[MIX SESSION ONBOARDING] ❌ Failed to send mix session onboarding:`, error);
  }
}
