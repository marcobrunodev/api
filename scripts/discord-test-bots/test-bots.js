/**
 * Discord Test Bots
 *
 * This script creates multiple Discord bot instances that can join voice channels
 * to help test the Banana Mix functionality without needing multiple real users.
 *
 * Usage:
 *   node test-bots.js <guild_id> <voice_channel_id> <number_of_bots>
 *
 * Example:
 *   node test-bots.js 123456789 987654321 10
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
    console.warn('⚠️  Warning: No sodium library found. Voice connections may not work properly.');
    console.warn('Please install: npm install sodium-native');
  }
}

// Bot tokens should be provided via environment variables
// BOT_TOKEN_1, BOT_TOKEN_2, BOT_TOKEN_3, etc.
const BOT_TOKENS = [];
for (let i = 1; i <= 25; i++) {
  const token = process.env[`BOT_TOKEN_${i}`];
  if (token) {
    BOT_TOKENS.push(token);
  }
}

if (BOT_TOKENS.length === 0) {
  console.error('❌ No bot tokens found!');
  console.error('Please set environment variables: BOT_TOKEN_1, BOT_TOKEN_2, etc.');
  process.exit(1);
}

const [guildId, channelId, numberOfBots = BOT_TOKENS.length] = process.argv.slice(2);

if (!guildId || !channelId) {
  console.error('❌ Missing required arguments!');
  console.error('Usage: node test-bots.js <guild_id> <voice_channel_id> [number_of_bots]');
  console.error('Example: node test-bots.js 123456789 987654321 10');
  process.exit(1);
}

const botsToCreate = Math.min(parseInt(numberOfBots), BOT_TOKENS.length);

if (botsToCreate > BOT_TOKENS.length) {
  console.warn(`⚠️  Requested ${numberOfBots} bots but only ${BOT_TOKENS.length} tokens available`);
}

console.log(`🤖 Starting ${botsToCreate} test bots...`);

const bots = [];
const connections = [];

async function createBot(token, index) {
  return new Promise(async (resolve, reject) => {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
      ],
    });

    client.once('ready', async () => {
      console.log(`✅ Bot ${index + 1} logged in as ${client.user.tag}`);

      try {
        const guild = await client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(channelId);

        if (!channel || channel.type !== 2) { // 2 = GUILD_VOICE
          console.error(`❌ Bot ${index + 1}: Channel ${channelId} is not a voice channel`);
          resolve(client);
          return;
        }

        console.log(`🔗 Bot ${index + 1}: Connecting to voice channel...`);

        const connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: true,
          selfMute: true,
          debug: false,
        });

        connections.push(connection);

        // Listen for connection state changes
        connection.on('stateChange', (oldState, newState) => {
          console.log(`🔄 Bot ${index + 1}: ${oldState.status} → ${newState.status}`);
        });

        connection.on('error', (error) => {
          console.error(`❌ Bot ${index + 1} connection error:`, error.message);
        });

        // Wait for connection to be ready
        console.log(`⏳ Bot ${index + 1}: Waiting for ready state...`);
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

          // Verify the connection by checking channel members
          const updatedChannel = await guild.channels.fetch(channelId);
          const memberCount = updatedChannel.members?.size || 0;

          console.log(`✅ Bot ${index + 1} is READY in voice channel: ${channel.name}`);
          console.log(`   📊 Channel has ${memberCount} members visible to this bot`);
          console.log(`   🔗 Connection state: ${connection.state.status}`);

          resolve(client);
        } catch (error) {
          console.error(`❌ Bot ${index + 1}: Failed to reach ready state - ${error.message}`);
          console.error(`   Current state: ${connection.state.status}`);
          resolve(client); // Still resolve to continue with other bots
        }

      } catch (error) {
        console.error(`❌ Bot ${index + 1} error:`, error.message);
        resolve(client);
      }
    });

    client.on('error', (error) => {
      console.error(`❌ Bot ${index + 1} error:`, error);
    });

    try {
      await client.login(token);
    } catch (error) {
      console.error(`❌ Bot ${index + 1} failed to login:`, error.message);
      reject(error);
    }
  });
}

async function main() {
  console.log('⏳ Connecting bots sequentially to avoid rate limits...\n');

  for (let i = 0; i < botsToCreate; i++) {
    try {
      console.log(`\n--- Starting Bot ${i + 1} ---`);
      const bot = await createBot(BOT_TOKENS[i], i);
      bots.push(bot);

      // Small delay to avoid rate limiting
      if (i < botsToCreate - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`❌ Failed to create bot ${i + 1}:`, error.message);
    }
  }

  console.log(`\n✅ ${bots.length} bots have been initialized`);
  console.log('Press Ctrl+C to disconnect all bots\n');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down bots...');

  for (const connection of connections) {
    try {
      connection.destroy();
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  for (const bot of bots) {
    try {
      await bot.destroy();
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  console.log('✅ All bots disconnected');
  process.exit(0);
});

main().catch(console.error);
