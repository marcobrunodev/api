import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import {
  ChatInputCommandInteraction,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js";
import { ButtonActions } from "../enums/ButtonActions";
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 5);

@BotChatCommand(ChatCommands.ScheduleMix)
export default class ScheduleMix extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply("This command can only be used in a server.");
        return;
      }

      const member = guild.members.cache.get(interaction.user.id);
      const voiceChannel = member?.voice.channel;
      const players = voiceChannel?.members;

      if (!voiceChannel) {
        await interaction.editReply("❌ You need to be in a voice channel to use this command.");
        return;
      }

      if (!players || players.size < 10) {
        await interaction.editReply(
          `❌ You need at least 10 players to start a mix.\n` +
          `Current players: ${players?.size || 0}/10`
        );
        return;
      }

      const shortCode = nanoid();

      await guild.channels.fetch();

      const bananaServerCategory = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory &&
          channel.name === '🍌 BananaServer.xyz Mix'
      );

      const queueMixChannel = voiceChannel.name === '🍌 Queue Mix' ? voiceChannel : null;
      const playersArray = Array.from(players.values());

      console.log('Fetching bot member...');
      const botMember = await guild.members.fetch(interaction.client.user.id);

      const category = await guild.channels.create({
        name: `Banana Mix - #${shortCode}`,
        type: ChannelType.GuildCategory,
      });

      if (bananaServerCategory && 'position' in bananaServerCategory) {
        const targetPosition = (bananaServerCategory as any).position + 1;
        console.log(`🍌 BananaServer.xyz Mix position: ${(bananaServerCategory as any).position}`);
        console.log(`Moving new category to position: ${targetPosition}`);

        await category.setPosition(targetPosition, { relative: false });
      }

      const mixVoiceChannel = await guild.channels.create({
        name: 'Mix Voice',
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
          {
            id: botMember.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MoveMembers,
            ],
          },
          {
            id: guild.id,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [PermissionFlagsBits.Connect],
          },
        ],
      });

      let movedPlayers: any[];

      if (queueMixChannel) {
        movedPlayers = await this.bot.movePlayersToMix(queueMixChannel, playersArray, mixVoiceChannel);
      } else {
        for (const member of playersArray) {
          await member.voice.setChannel(mixVoiceChannel.id);
        }
        movedPlayers = playersArray;
      }

      console.log('Adding player permissions to Mix Voice channel...');
      for (const player of movedPlayers) {
        await mixVoiceChannel.permissionOverwrites.create(player.id, {
          ViewChannel: true,
          Connect: true,
          Speak: true,
        });
      }

      console.log('Configuring permissions for picks-bans channel...');
      const permissionOverwrites: any[] = [
        {
          id: botMember.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AddReactions,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages
          ],
        },
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AddReactions
          ],
        },
      ];

      for (const player of movedPlayers) {
        permissionOverwrites.push({
          id: player.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AddReactions
          ],
        });
      }

      console.log('Creating picks-bans channel with permissions...');
      const picksBans = await guild.channels.create({
        name: 'picks-bans',
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: permissionOverwrites,
      });

      console.log('picks-bans channel created successfully');
      await interaction.editReply(
        `✅ Mix created!\n` +
        `📁 Category: ${category.name}\n` +
        `💬 Chat: ${picksBans}\n` +
        `🔊 Voice: ${mixVoiceChannel}\n` +
        `👥 Players: ${movedPlayers.length}`
      );

      await picksBans.send({
        embeds: [{
          title: 'Welcome to the Banana Mix!',
          description: 'We will use this channel for:\n\n' +
            '1️⃣ **Ready check**\n' +
            '2️⃣ **Vote for captains**\n' +
            '3️⃣ **Captains picking players**\n' +
            '4️⃣ **Banning maps**',
          color: 0xFFD700,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }]
      });

      const allowedPlayerIds = movedPlayers.map(p => p.id);
      const fruitToPlayer = new Map<string, string>();

      const playersListReady = movedPlayers.map((p) => {
        return `⏳ <@${p.id}>`;
      }).join('\n');

      const readyButton = new ButtonBuilder()
        .setCustomId(ButtonActions.ReadyCheck)
        .setLabel('✅ Ready')
        .setStyle(ButtonStyle.Success);

      const readyRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(readyButton);

      const readyMessage = await picksBans.send({
        embeds: [{
          title: '⏳ Ready Check',
          description: `
**Players Ready: 0/${movedPlayers.length}**

${playersListReady}

Click the button below when you're ready!
          `,
          color: 0xFFD700,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }],
        components: [readyRow]
      });

      const { initializeReadySession } = await import('./ReadyCheck');
      initializeReadySession(
        readyMessage.id,
        allowedPlayerIds,
        fruitToPlayer,
        movedPlayers,
        guild.id,
        category.id,
        mixVoiceChannel.id
      );
    } catch (error) {
      console.error('Erro ao criar mix:', error);
      console.error('Error details:', error.stack);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await interaction.editReply(`❌ Erro ao criar o mix: ${errorMessage}\n\nVerifique se o bot tem permissões adequadas.`);
    }
  }
}