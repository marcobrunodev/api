/**
 * Spawn Multiple Bots in Separate Processes
 *
 * This script spawns multiple bot processes, each running independently.
 * This solves the issue where multiple bots in the same process don't connect properly.
 *
 * Usage:
 *   node spawn-multiple-bots.js <guild_id> <voice_channel_id> <number_of_bots>
 *
 * Example:
 *   node spawn-multiple-bots.js 123456789 987654321 10
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

// Check for bot tokens
const BOT_TOKENS = [];
for (let i = 1; i <= 25; i++) {
  const token = process.env[`BOT_TOKEN_${i}`];
  if (token) {
    BOT_TOKENS.push(i);
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
  console.error('Usage: node spawn-multiple-bots.js <guild_id> <voice_channel_id> [number_of_bots]');
  console.error('Example: node spawn-multiple-bots.js 123456789 987654321 10');
  process.exit(1);
}

const botsToCreate = Math.min(parseInt(numberOfBots), BOT_TOKENS.length);

console.log(`🤖 Spawning ${botsToCreate} bots in separate processes...\n`);

const processes = [];
let activeProcesses = 0;

function spawnBot(botNumber) {
  return new Promise((resolve) => {
    console.log(`\n🚀 Starting Bot ${botNumber}...`);

    const botProcess = spawn('node', [
      path.join(__dirname, 'add-one-bot.js'),
      guildId,
      channelId,
      botNumber.toString()
    ], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env
    });

    processes.push(botProcess);
    activeProcesses++;

    // Log stdout with bot number prefix
    botProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`[Bot ${botNumber}] ${line}`);
        }
      });
    });

    // Log stderr with bot number prefix
    botProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.error(`[Bot ${botNumber}] ${line}`);
        }
      });
    });

    botProcess.on('close', (code) => {
      activeProcesses--;
      console.log(`\n❌ Bot ${botNumber} process exited with code ${code}`);

      if (activeProcesses === 0) {
        console.log('\n✅ All bots have disconnected');
        process.exit(0);
      }
    });

    botProcess.on('error', (error) => {
      console.error(`\n❌ Failed to start Bot ${botNumber}:`, error.message);
      activeProcesses--;
      resolve();
    });

    // Wait a bit to see if bot started successfully
    setTimeout(() => {
      resolve();
    }, 2000);
  });
}

async function main() {
  for (let i = 0; i < botsToCreate; i++) {
    const botNumber = BOT_TOKENS[i];
    await spawnBot(botNumber);

    // Small delay between spawning bots
    if (i < botsToCreate - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n✅ All ${botsToCreate} bot processes have been spawned!`);
  console.log('Press Ctrl+C to disconnect all bots\n');
}

// Graceful shutdown - kill all child processes
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down all bots...');

  processes.forEach((proc, index) => {
    try {
      proc.kill('SIGINT');
      console.log(`   Stopped Bot ${BOT_TOKENS[index]}`);
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  setTimeout(() => {
    console.log('\n✅ All bots disconnected');
    process.exit(0);
  }, 1000);
});

process.on('SIGTERM', () => {
  processes.forEach(proc => {
    try {
      proc.kill('SIGTERM');
    } catch (error) {
      // Ignore
    }
  });
  process.exit(0);
});

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
