/**
 * Generate Discord Bot Invite Links
 *
 * This script generates OAuth2 invite links for all configured bots
 * so you can easily add them to your server.
 */

require('dotenv').config();

// Bot client IDs should be provided via environment variables
// BOT_CLIENT_ID_1, BOT_CLIENT_ID_2, etc.
const BOT_CLIENT_IDS = [];
for (let i = 1; i <= 25; i++) {
  const clientId = process.env[`BOT_CLIENT_ID_${i}`];
  if (clientId) {
    BOT_CLIENT_IDS.push({ index: i, clientId });
  }
}

if (BOT_CLIENT_IDS.length === 0) {
  console.error('❌ No bot client IDs found!');
  console.error('Please set environment variables: BOT_CLIENT_ID_1, BOT_CLIENT_ID_2, etc.');
  console.error('\nYou can find the Client ID in Discord Developer Portal:');
  console.error('Application → General Information → Application ID (Client ID)');
  process.exit(1);
}

// Required permissions for voice channel bots
const PERMISSIONS = [
  'ViewChannels',    // 1024
  'Connect',         // 1048576
  'Speak',           // 2097152
].join(',');

const PERMISSIONS_VALUE = 3146752; // Sum of the permission values

console.log('🔗 Discord Bot Invite Links\n');
console.log('Copy these links and paste them in your browser to invite the bots to your server:\n');

BOT_CLIENT_IDS.forEach(({ index, clientId }) => {
  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${PERMISSIONS_VALUE}&scope=bot`;
  console.log(`Bot ${index}: ${inviteUrl}`);
});

console.log('\n✅ Total bots: ' + BOT_CLIENT_IDS.length);
console.log('\n💡 Tip: You can Ctrl+Click (or Cmd+Click on Mac) to open links directly from the terminal!');
