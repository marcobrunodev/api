/**
 * Add One Bot to Voice Channel
 *
 * This script adds a single bot to a voice channel for testing.
 * Useful for debugging connection issues one bot at a time.
 *
 * Usage:
 *   node add-one-bot.js <guild_id> <voice_channel_id> <bot_number>
 *
 * Example:
 *   node add-one-bot.js 123456789 987654321 1
 */

require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');

// Try to load sodium for encryption
try {
  require('sodium-native');
} catch (e1) {
  try {
    require('libsodium-wrappers');
  } catch (e2) {
    console.warn('⚠️  Warning: No sodium library found.');
  }
}

const [guildId, channelId, botNumber] = process.argv.slice(2);

if (!guildId || !channelId || !botNumber) {
  console.error('❌ Missing required arguments!');
  console.error('Usage: node add-one-bot.js <guild_id> <voice_channel_id> <bot_number>');
  console.error('Example: node add-one-bot.js 123456789 987654321 1');
  process.exit(1);
}

const botIndex = parseInt(botNumber);
const token = process.env[`BOT_TOKEN_${botIndex}`];

if (!token) {
  console.error(`❌ BOT_TOKEN_${botIndex} not found in .env file!`);
  process.exit(1);
}

console.log(`🤖 Starting Bot ${botIndex}...\n`);

let connection;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('ready', async () => {
  console.log(`✅ Bot ${botIndex} logged in as ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);

    if (!channel || channel.type !== 2) {
      console.error(`❌ Channel ${channelId} is not a voice channel`);
      process.exit(1);
    }

    console.log(`🔗 Connecting to voice channel: ${channel.name}...`);

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
      debug: false,
    });

    connection.on('stateChange', (oldState, newState) => {
      console.log(`🔄 ${oldState.status} → ${newState.status}`);
    });

    connection.on('error', (error) => {
      console.error(`❌ Connection error:`, error.message);
    });

    console.log(`⏳ Waiting for ready state...`);
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

    const updatedChannel = await guild.channels.fetch(channelId);
    const memberCount = updatedChannel.members?.size || 0;

    console.log(`\n✅ Bot ${botIndex} is READY in voice channel!`);
    console.log(`   📊 Channel has ${memberCount} members visible to this bot`);
    console.log(`   🔗 Connection state: ${connection.state.status}`);
    console.log('\nPress Ctrl+C to disconnect\n');

  } catch (error) {
    console.error(`❌ Error:`, error.message);
    process.exit(1);
  }
});

client.on('error', (error) => {
  console.error(`❌ Client error:`, error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Disconnecting bot...');

  if (connection) {
    try {
      connection.destroy();
    } catch (error) {
      // Ignore
    }
  }

  try {
    await client.destroy();
  } catch (error) {
    // Ignore
  }

  console.log('✅ Bot disconnected');
  process.exit(0);
});

client.login(token).catch(error => {
  console.error(`❌ Failed to login:`, error.message);
  process.exit(1);
});
