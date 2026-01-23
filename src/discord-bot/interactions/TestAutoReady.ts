import { ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { getReadySession } from "./ReadyCheck";
import { ButtonActions } from "../enums/ButtonActions";

/**
 * Test Auto Ready Command
 *
 * This is a TESTING-ONLY command to automatically simulate ready confirmations
 * for all bot players in a ready check session.
 *
 * Usage: /test-auto-ready <message_id>
 */
@BotChatCommand(ChatCommands.TestAutoReady)
export default class TestAutoReady extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const messageId = interaction.options.getString('message_id', true);

      // Fetch the message
      const message = await interaction.channel.messages.fetch(messageId);

      if (!message) {
        await interaction.editReply({
          content: `❌ Message not found with ID: ${messageId}`
        });
        return;
      }

      // Get the ready session
      const session = getReadySession(messageId);
      if (!session) {
        await interaction.editReply({
          content: `❌ No ready check session found for message ID: ${messageId}\n\nMake sure this is a ready check message.`
        });
        return;
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({ content: '❌ This command must be used in a server' });
        return;
      }

      // Get all allowed players and mark bots as ready
      let botsMarkedReady = 0;
      let usersSkipped = 0;
      let alreadyReady = 0;

      for (const playerId of session.allowedPlayerIds) {
        // Check if already ready
        if (session.readyPlayers.has(playerId)) {
          alreadyReady++;
          continue;
        }

        // Fetch the member to check if it's a bot
        const member = await guild.members.fetch(playerId).catch((_err): null => null);

        if (!member) {
          continue;
        }

        // Skip if it's a normal user (not a bot)
        if (!member.user.bot) {
          usersSkipped++;
          continue;
        }

        // Mark bot as ready
        session.readyPlayers.add(playerId);
        botsMarkedReady++;
      }

      const readyCount = session.readyPlayers.size;
      const totalCount = session.totalPlayers;

      // Update the message with the new ready status
      const playersList = session.movedPlayers.map((p) => {
        const isReady = session.readyPlayers.has(p.id);
        const status = isReady ? '✅' : '⏳';
        return `${status} <@${p.id}>`;
      }).join('\n');

      await message.edit({
        embeds: [{
          title: '⏳ Ready Check',
          description: `
**Players Ready: ${readyCount}/${totalCount}**

${playersList}

Click the button below when you're ready!
          `,
          color: readyCount === totalCount ? 0x00FF00 : 0xFFD700,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }],
        components: message.components,
      });

      await interaction.editReply({
        content: `✅ Auto-ready complete (bots only)!\n\n` +
          `**Bots marked ready:** ${botsMarkedReady}\n` +
          `**Already ready:** ${alreadyReady}\n` +
          `**Users (skipped):** ${usersSkipped}\n` +
          `**Total ready:** ${readyCount}/${totalCount}\n\n` +
          (readyCount === totalCount ? '🎉 **All players are ready! Captain voting should start soon.**' : '⏳ **Waiting for remaining players...**')
      });

      // If all players are ready, trigger captain voting
      if (readyCount === totalCount) {
        await message.edit({
          components: [], // Remove the ready button
        });

        const channel = interaction.channel;
        if (!channel || !('send' in channel)) return;

        // Start captain voting
        const fruitEmojis = ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝'];
        const shuffledFruits = [...fruitEmojis].sort(() => Math.random() - 0.5);
        const usedFruits = shuffledFruits.slice(0, session.movedPlayers.length);

        const playersList = session.movedPlayers.map((p, index) => {
          const fruit = shuffledFruits[index % shuffledFruits.length];
          session.fruitToPlayer.set(fruit, p.id);
          return `[0] \`${fruit}\` <@${p.id}>`;
        }).join('\n');

        const buttons = usedFruits.map(fruit =>
          new ButtonBuilder()
            .setCustomId(`${ButtonActions.VoteCaptain}:\`${fruit}\``)
            .setLabel(fruit)
            .setStyle(ButtonStyle.Secondary)
        );

        const rows: ActionRowBuilder<ButtonBuilder>[] = [];
        for (let i = 0; i < buttons.length; i += 5) {
          const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(buttons.slice(i, i + 5));
          rows.push(row);
        }

        const voteMessage = await channel.send({
          embeds: [{
            title: 'Step 1: Vote for Captains',
            description: `
Vote for 2 captains:

**Players:**
${playersList}

**React with the fruits to vote!**
            `,
            color: 0x00FFFF,
            timestamp: new Date().toISOString(),
            footer: {
              text: 'From BananaServer.xyz with 🍌',
            }
          }],
          components: rows
        });

        const { initializeVotingSession } = await import('./VoteCaptain');
        initializeVotingSession(voteMessage.id, session.fruitToPlayer);
      }

    } catch (error) {
      console.error('Error in test-auto-ready command:', error);
      await interaction.editReply({
        content: `❌ Error simulating auto ready: ${error.message}`
      });
    }
  }
}
