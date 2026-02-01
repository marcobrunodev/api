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
import { sendMixSessionOnboarding } from "../helpers/channel-onboarding.helper";

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

      const playersArray = Array.from(players.values());

      // Filtrar apenas jogadores reais (não bots) para verificação de SteamID
      const realPlayers = playersArray.filter((m: any) => !m.user.bot);
      const discordIds = realPlayers.slice(0, 10).map((m: any) => m.id);

      const { players: dbPlayers } = await this.hasura.query({
        players: {
          __args: {
            where: {
              discord_id: {
                _in: discordIds,
              },
            },
          },
          discord_id: true,
          steam_id: true,
        },
      });

      // Criar mapa de Discord ID -> SteamID
      const playerMap = new Map<string, string | null>();
      dbPlayers.forEach(p => {
        if (p.discord_id) {
          playerMap.set(p.discord_id, p.steam_id);
        }
      });

      // Identificar players sem SteamID (somente jogadores reais, não bots)
      const playersWithoutSteamId: string[] = [];

      for (let i = 0; i < Math.min(10, realPlayers.length); i++) {
        const playerId = realPlayers[i].id;
        const steamId = playerMap.get(playerId);

        if (!steamId) {
          playersWithoutSteamId.push(playerId);
        }
      }

      // Se houver jogadores sem SteamID, não permitir iniciar o mix
      if (playersWithoutSteamId.length > 0) {
        const registerButton = new ButtonBuilder()
          .setCustomId(ButtonActions.OpenRegisterSteamIdModal)
          .setLabel('📝 Register SteamID')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(registerButton);

        await interaction.editReply({
          embeds: [{
            title: '⚠️ SteamID Registration Required',
            description:
              `**${playersWithoutSteamId.length}** player(s) need to register their SteamID64 before starting the mix!\n\n` +
              '**Players without SteamID:**\n' +
              playersWithoutSteamId.map(id => `❌ <@${id}>`).join('\n') +
              '\n\n**How to find your SteamID64:**\n' +
              '1. Open your Steam client\n' +
              '2. Click on your profile name\n' +
              '3. Click "Account Details"\n' +
              '4. Your SteamID64 will be shown there\n\n' +
              'Use the `/steamid` command to register, then try `/mix` again!',
            color: 0xFF9900,
            footer: {
              text: 'From BananaServer.xyz with 🍌',
            },
            timestamp: new Date().toISOString(),
          }],
          components: [row],
        });
        return;
      }

      const shortCode = nanoid();

      await guild.channels.fetch();

      const queueMixChannel = voiceChannel.name === '🍌 Queue Mix' ? voiceChannel : null;

      console.log('Fetching bot member...');
      const botMember = await guild.members.fetch(interaction.client.user.id);

      // Criar categoria específica para este mix
      const category = await guild.channels.create({
        name: `Banana Mix - #${shortCode}`,
        type: ChannelType.GuildCategory,
      });

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

      // Enviar mensagem de onboarding explicando toda a sessão do mix
      await sendMixSessionOnboarding(picksBans, shortCode, category.name);

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

      const { initializeReadySession, startCountdown } = await import('./ReadyCheck');
      initializeReadySession(
        readyMessage.id,
        allowedPlayerIds,
        fruitToPlayer,
        movedPlayers,
        guild.id,
        category.id,
        mixVoiceChannel.id,
        queueMixChannel?.id,
        picksBans.id
      );

      // Iniciar countdown de 21 segundos
      await startCountdown(readyMessage.id, this.bot, picksBans);
    } catch (error) {
      console.error('Erro ao criar mix:', error);
      console.error('Error details:', error.stack);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await interaction.editReply(`❌ Erro ao criar o mix: ${errorMessage}\n\nVerifique se o bot tem permissões adequadas.`);
    }
  }
}