import { ButtonInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ModalActionRowComponentBuilder, AttachmentBuilder, ChannelType, PermissionFlagsBits } from "discord.js";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import DiscordInteraction from "./abstracts/DiscordInteraction";

const readySessions = new Map<string, {
  readyPlayers: Set<string>;
  totalPlayers: number;
  allowedPlayerIds: string[];
  fruitToPlayer: Map<string, string>;
  movedPlayers: any[];
  guildId?: string;
  categoryChannelId?: string;
  originalChannelId?: string;
  queueMixChannelId?: string;
  timeRemaining: number;
  intervalId?: NodeJS.Timeout;
  channelId?: string;
}>();

export function initializeReadySession(
  messageId: string,
  allowedPlayerIds: string[],
  fruitToPlayer: Map<string, string>,
  movedPlayers: any[],
  guildId?: string,
  categoryChannelId?: string,
  originalChannelId?: string,
  queueMixChannelId?: string,
  channelId?: string
) {
  readySessions.set(messageId, {
    readyPlayers: new Set(),
    totalPlayers: allowedPlayerIds.length,
    allowedPlayerIds,
    fruitToPlayer,
    movedPlayers,
    guildId,
    categoryChannelId,
    originalChannelId,
    queueMixChannelId,
    timeRemaining: 90,
    channelId,
  });
}

export function getReadySession(messageId: string) {
  return readySessions.get(messageId);
}

export function deleteReadySession(messageId: string) {
  const session = readySessions.get(messageId);
  if (session?.intervalId) {
    clearInterval(session.intervalId);
  }
  readySessions.delete(messageId);
}

function getColorByTimeRemaining(time: number): number {
  if (time > 10) return 0x00FF00; // Verde
  if (time > 5) return 0xFFD700;  // Amarelo
  return 0xFF0000; // Vermelho
}

export async function startCountdown(messageId: string, bot: any, channel: any) {
  const session = readySessions.get(messageId);
  if (!session) return;

  // Buscar a mensagem
  let message;
  try {
    message = await channel.messages.fetch(messageId);
  } catch (error) {
    console.error('Failed to fetch ready check message:', error);
    return;
  }

  session.intervalId = setInterval(async () => {
    const currentSession = readySessions.get(messageId);
    if (!currentSession) {
      clearInterval(session.intervalId);
      return;
    }

    currentSession.timeRemaining--;

    // Atualizar embed
    const readyCount = currentSession.readyPlayers.size;
    const playersList = currentSession.movedPlayers.map((p) => {
      const isReady = currentSession.readyPlayers.has(p.id);
      const status = isReady ? '✅' : '⏳';
      return `${status} <@${p.id}>`;
    }).join('\n');

    try {
      await message.edit({
        embeds: [{
          title: '⏳ Ready Check',
          description: `
**⏰ Time Remaining: ${currentSession.timeRemaining} seconds**
**Players Ready: ${readyCount}/${currentSession.totalPlayers}**

${playersList}

Click the button below when you're ready!
          `,
          color: getColorByTimeRemaining(currentSession.timeRemaining),
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }],
        components: message.components
      });
    } catch (error) {
      // Se o canal foi deletado (erro 10003 ou ChannelNotCached), parar o countdown
      if (error.code === 10003 || error.code === 'ChannelNotCached') {
        console.log(`⚠️ [READY CHECK] Channel deleted, stopping countdown for message ${messageId}`);
        clearInterval(currentSession.intervalId);
        deleteReadySession(messageId);
        return;
      }
      console.error('Failed to update ready check message:', error);
    }

    // Timeout - ninguém mais tem tempo
    if (currentSession.timeRemaining <= 0) {
      clearInterval(currentSession.intervalId);
      await handleTimeout(messageId, bot, channel);
    }
  }, 1000);
}

async function handleTimeout(messageId: string, bot: any, channel: any) {
  const session = readySessions.get(messageId);
  if (!session) return;

  const notReadyPlayers = session.allowedPlayerIds.filter(
    id => !session.readyPlayers.has(id)
  );

  // Se todos deram ready, não fazer nada
  if (notReadyPlayers.length === 0) return;

  await channel.send({
    content: `⚠️ **Timeout!** The following players didn't ready in time:\n${notReadyPlayers.map(id => `<@${id}>`).join(', ')}\n\nMoving AFK players to 💤 AFK channel...`
  });

  // Mover players que não deram ready para o canal AFK
  if (session.guildId && session.queueMixChannelId && session.originalChannelId) {
    try {
      const guild = await bot.client.guilds.fetch(session.guildId);

      // Buscar canal AFK e Queue Mix
      await guild.channels.fetch();
      const afkChannel = guild.channels.cache.find(
        (ch: any) => ch.type === ChannelType.GuildVoice && ch.name === '💤 AFK'
      );
      const queueMixChannel = guild.channels.cache.get(session.queueMixChannelId);
      const mixVoiceChannel = guild.channels.cache.get(session.originalChannelId);

      if (afkChannel && 'id' in afkChannel) {
        // Mover cada player não-ready para o AFK e adicionar penalidade
        for (const playerId of notReadyPlayers) {
          try {
            const member = await guild.members.fetch(playerId);
            if (member.voice.channel) {
              await member.voice.setChannel(afkChannel.id);
            }

            // Remover permissões do player nos canais do mix
            if (mixVoiceChannel) {
              await (mixVoiceChannel as any).permissionOverwrites.delete(playerId);
            }
            if (channel && 'permissionOverwrites' in channel) {
              await channel.permissionOverwrites.delete(playerId);
            }

            // Adicionar penalidade - mover para o final da fila
            await bot.addPenaltyToPlayer(session.guildId, playerId);
          } catch (error) {
            console.error(`Failed to move player ${playerId} to AFK:`, error);
          }
        }

        await channel.send({
          content: `✅ Moved ${notReadyPlayers.length} AFK player(s) to 💤 AFK channel.\n⚠️ Penalty applied - moved to end of queue.`
        });

        // Buscar players substitutos da Queue Mix
        if (queueMixChannel && mixVoiceChannel) {
          const queueMembers = Array.from((queueMixChannel as any).members.values());

          // Filtrar players que não estão nos AFK ou já estavam no mix
          const availableReplacements = queueMembers.filter((m: any) =>
            !session.allowedPlayerIds.includes(m.id) && !notReadyPlayers.includes(m.id)
          );

          if (availableReplacements.length >= notReadyPlayers.length) {
            // Pegar os substitutos necessários usando movePlayersToMix para respeitar a ordem da fila
            const replacementsNeeded = notReadyPlayers.length;
            const replacementPlayers = await bot.movePlayersToMix(
              queueMixChannel,
              availableReplacements.slice(0, replacementsNeeded),
              mixVoiceChannel
            );

            if (replacementPlayers.length > 0) {
              // Não precisamos reatribuir frutas aqui porque elas só serão
              // atribuídas DEPOIS que todos derem ready pela primeira vez

              // Adicionar permissões para os novos players
              for (const player of replacementPlayers) {
                // Permissão no canal de voz
                if (mixVoiceChannel) {
                  await (mixVoiceChannel as any).permissionOverwrites.create(player.id, {
                    ViewChannel: true,
                    Connect: true,
                    Speak: true,
                  });
                }

                // Permissão no canal de texto (picks-bans)
                if (channel && 'permissionOverwrites' in channel) {
                  await channel.permissionOverwrites.create(player.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    AddReactions: true,
                  });
                }
              }

              // Atualizar a sessão com os novos players
              const newAllowedPlayerIds = [
                ...session.allowedPlayerIds.filter((id: string) => !notReadyPlayers.includes(id)),
                ...replacementPlayers.map((p: any) => p.id)
              ];

              // Atualizar movedPlayers removendo os AFK e adicionando os novos
              const newMovedPlayers = [
                ...session.movedPlayers.filter((p: any) => !notReadyPlayers.includes(p.id)),
                ...replacementPlayers
              ];

              session.allowedPlayerIds = newAllowedPlayerIds;
              session.movedPlayers = newMovedPlayers;
              session.totalPlayers = newAllowedPlayerIds.length;
              session.timeRemaining = 21; // Resetar timer

              await channel.send({
                content: `🔄 Found ${replacementPlayers.length} replacement player(s):\n${replacementPlayers.map((p: any) => `<@${p.id}>`).join(', ')}\n\n⏳ Starting new 21-second ready check...`
              });

              // Reiniciar countdown
              await startCountdown(messageId, bot, channel);
              return; // Não deletar a sessão ainda
            }
          }

          // Se não houver players suficientes para substituir
          const finalMessage = `❌ Not enough players in Queue Mix to replace AFK players.\n❌ Mix cancelled.`;
          await channel.send({ content: finalMessage });

          // Mover players que deram ready de volta para Queue Mix
          // IMPORTANTE: Isso vai deletar os canais automaticamente via voiceStateUpdate
          await moveReadyPlayersBackToQueue(session, guild, queueMixChannel, mixVoiceChannel, bot);
        }
      } else {
        const finalMessage = `⚠️ AFK channel not found. Please run \`/init\` first.\n❌ Mix cancelled - not enough players ready in time.`;
        await channel.send({ content: finalMessage });

        // Mover players de volta mesmo sem AFK channel
        // IMPORTANTE: Isso vai deletar os canais automaticamente via voiceStateUpdate
        const queueMixChannel = guild.channels.cache.get(session.queueMixChannelId);
        const mixVoiceChannel = guild.channels.cache.get(session.originalChannelId);
        await moveReadyPlayersBackToQueue(session, guild, queueMixChannel, mixVoiceChannel, bot);
      }
    } catch (error) {
      console.error('Error moving AFK players:', error);

      // Enviar mensagem ANTES de mover os players
      try {
        await channel.send({
          content: `❌ Mix cancelled - not enough players ready in time.`
        });
      } catch (sendError) {
        console.error('Error sending cancellation message:', sendError);
      }

      // Tentar mover players de volta mesmo com erro
      // IMPORTANTE: Isso vai deletar os canais automaticamente via voiceStateUpdate
      if (session.guildId && session.queueMixChannelId && session.originalChannelId) {
        try {
          const guild = await bot.client.guilds.fetch(session.guildId);
          const queueMixChannel = guild.channels.cache.get(session.queueMixChannelId);
          const mixVoiceChannel = guild.channels.cache.get(session.originalChannelId);
          await moveReadyPlayersBackToQueue(session, guild, queueMixChannel, mixVoiceChannel, bot);
        } catch (moveError) {
          console.error('Error moving players back to queue:', moveError);
        }
      }
    }
  } else {
    const finalMessage = `❌ Mix cancelled - not enough players ready in time.`;
    await channel.send({ content: finalMessage });

    // Tentar mover players de volta se tivermos as informações necessárias
    // IMPORTANTE: Isso vai deletar os canais automaticamente via voiceStateUpdate
    if (session.guildId && session.queueMixChannelId && session.originalChannelId) {
      try {
        const guild = await bot.client.guilds.fetch(session.guildId);
        const queueMixChannel = guild.channels.cache.get(session.queueMixChannelId);
        const mixVoiceChannel = guild.channels.cache.get(session.originalChannelId);
        await moveReadyPlayersBackToQueue(session, guild, queueMixChannel, mixVoiceChannel, bot);
      } catch (error) {
        console.error('Error moving players back to queue:', error);
      }
    }
  }

  deleteReadySession(messageId);
}

async function moveReadyPlayersBackToQueue(session: any, guild: any, queueMixChannel: any, mixVoiceChannel: any, bot?: any) {
  if (!queueMixChannel || !mixVoiceChannel) return;

  const readyPlayers = Array.from(session.readyPlayers);

  if (readyPlayers.length === 0) return;

  // Mover cada player que deu ready de volta para Queue Mix e colocar no topo da fila
  for (const playerId of readyPlayers) {
    try {
      const member = await guild.members.fetch(playerId);
      if (member.voice.channelId === mixVoiceChannel.id) {
        await member.voice.setChannel(queueMixChannel.id);

        // Adicionar no topo da fila para garantir prioridade
        if (bot && session.guildId) {
          await bot.addPlayerToTopOfQueue(session.guildId, playerId);
        }
      }
    } catch (error) {
      console.error(`Failed to move player ${playerId} back to Queue Mix:`, error);
    }
  }
}

@BotButtonInteraction(ButtonActions.ReadyCheck)
export default class ReadyCheck extends DiscordInteraction {
  public async handler(interaction: ButtonInteraction) {
  const messageId = interaction.message.id;
  const session = readySessions.get(messageId);

  if (!session) {
    await interaction.reply({
      content: '❌ Ready check session not found.',
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;

  if (!session.allowedPlayerIds.includes(userId)) {
    await interaction.reply({
      content: '❌ You are not a player in this mix.',
      ephemeral: true,
    });
    return;
  }

  // Verificar se o usuário tem SteamID registrado
  const { players } = await this.hasura.query({
    players: {
      __args: {
        where: {
          discord_id: {
            _eq: userId,
          },
        },
      },
      steam_id: true,
      name: true,
    },
  });

  if (players.length === 0 || !players[0].steam_id) {
    const registerButton = new ButtonBuilder()
      .setCustomId(ButtonActions.OpenRegisterSteamIdModal)
      .setLabel('📝 Register SteamID')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(registerButton);

    // Enviar mensagem ephemeral com botão de registro
    await interaction.reply({
      embeds: [{
        title: '🎮 SteamID Registration Required',
        description:
          '**You need to register your SteamID64 to play!**\n\n' +
          '**How to find your SteamID64:**\n' +
          '1. Open your Steam client\n' +
          '2. Click on your profile name\n' +
          '3. Click "Account Details"\n' +
          '4. Your SteamID64 will be shown there\n\n' +
          'Click the button below to register!',
        color: 0xFF9900,
        footer: {
          text: 'From BananaServer.xyz with 🍌',
        },
        timestamp: new Date().toISOString(),
      }],
      components: [row],
      ephemeral: true,
    });

    const channel = interaction.channel;
    if (channel && 'send' in channel) {
      await channel.send({
        content: `<@${userId}> 
📺 **Video Tutorial to find your SteamID64:**\nhttps://youtu.be/DHFmBEL-s1I`,
      });
    }
    return;
  }

  if (session.readyPlayers.has(userId)) {
    await interaction.reply({
      content: '✅ You are already ready!',
      ephemeral: true,
    });
    return;
  }

  session.readyPlayers.add(userId);

  // Acknowledge the interaction silently (no message shown to user)
  await interaction.deferUpdate();

  const readyCount = session.readyPlayers.size;
  const totalCount = session.totalPlayers;

  const playersList = session.movedPlayers.map((p) => {
    const isReady = session.readyPlayers.has(p.id);
    const status = isReady ? '✅' : '⏳';
    return `${status} <@${p.id}>`;
  }).join('\n');

  const timeDisplay = session.timeRemaining > 0
    ? `**⏰ Time Remaining: ${session.timeRemaining} seconds**\n`
    : '';

  await interaction.message.edit({
    embeds: [{
      title: '⏳ Ready Check',
      description: `
${timeDisplay}**Players Ready: ${readyCount}/${totalCount}**

${playersList}

Click the button below when you're ready!
      `,
      color: readyCount === totalCount ? 0x00FF00 : getColorByTimeRemaining(session.timeRemaining),
      timestamp: new Date().toISOString(),
      footer: {
        text: 'From BananaServer.xyz with 🍌',
      }
    }],
    components: interaction.message.components,
  });

  if (readyCount === totalCount) {
    // Parar countdown
    if (session.intervalId) {
      clearInterval(session.intervalId);
      session.intervalId = undefined;
    }
    await interaction.message.edit({
      components: [],
    });

    const channel = interaction.channel;
    if (!channel || !('send' in channel)) return;

    // Enviar mensagem rápida informando que está preparando a votação
    const preparingMessage = await channel.send({
      content: '⏳ **All players ready!** Preparing captain voting...'
    });
    console.log('✅ Sent preparing message');

    const fruitEmojis = ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🥒', '🍆', '🌶️', '🌽'];
    const shuffledFruits = [...fruitEmojis].sort(() => Math.random() - 0.5);
    const usedFruits = shuffledFruits.slice(0, session.movedPlayers.length);

    const playersList = session.movedPlayers.map((p, index) => {
      const fruit = shuffledFruits[index % shuffledFruits.length];
      session.fruitToPlayer.set(fruit, p.id);
      return `[0] \`${fruit}\` <@${p.id}>`;
    }).join('\n');

    const waitingForVotesList = session.movedPlayers.map(p => `<@${p.id}>`).join(', ');

    // Buscar guild para obter os displayNames
    const guild = interaction.guild;

    // Buscar todos os membros de uma vez (mais rápido que buscar um por um)
    const memberPromises = session.movedPlayers.map(p =>
      guild.members.fetch(p.id).catch((): null => null)
    );
    const members = await Promise.all(memberPromises);

    // Criar mapa de ID -> displayName
    const playerNames = new Map<string, string>();
    members.forEach((member, index) => {
      if (member) {
        playerNames.set(session.movedPlayers[index].id, member.displayName);
      }
    });

    const buttons = usedFruits.map((fruit) => {
      const playerId = session.fruitToPlayer.get(fruit);
      const playerName = playerId ? (playerNames.get(playerId) || 'Player') : 'Player';

      return new ButtonBuilder()
        .setCustomId(`${ButtonActions.VoteCaptain}:${fruit}`)
        .setLabel(`${fruit} ${playerName}`)
        .setStyle(ButtonStyle.Secondary);
    });

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < buttons.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(buttons.slice(i, i + 5));
      rows.push(row);
    }

    // Adicionar botão de remake em uma linha separada
    // const remakeButton = new ButtonBuilder()
    //   .setCustomId(ButtonActions.RequestRemake)
    //   .setLabel('🔄 Request Remake')
    //   .setStyle(ButtonStyle.Primary);

    // const remakeRow = new ActionRowBuilder<ButtonBuilder>()
    //   .addComponents(remakeButton);
    // rows.push(remakeRow);

    const voteMessage = await channel.send({
      embeds: [{
        title: 'Step 1: Vote for Captains',
        description: `
Vote for 2 captains:

**Players:**
${playersList}

**Waiting for votes:**
${waitingForVotesList}

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

    // Deletar a mensagem "Preparing captain voting..."
    try {
      await preparingMessage.delete();
      console.log('✅ Deleted preparing message');
    } catch (error) {
      console.error('Failed to delete preparing message:', error);
    }

    const { initializeVotingSession } = await import('./VoteCaptain');

    // Callback quando todos votarem
    const onAllVoted = async (votes: Map<string, Set<string>>) => {
      console.log('🎯 [CAPTAIN VOTE CALLBACK] Triggered! All players have voted.');
      console.log(`🎯 [CAPTAIN VOTE CALLBACK] Votes map size: ${votes?.size}`);

      if (!votes) {
        console.log('❌ [CAPTAIN VOTE CALLBACK] Votes is null/undefined, aborting');
        return;
      }

      console.log('🎯 [CAPTAIN VOTE CALLBACK] Processing votes...');
      const fruitVotes = new Map<string, number>();
      for (const [, votedFruits] of votes.entries()) {
        for (const fruit of votedFruits) {
          fruitVotes.set(fruit, (fruitVotes.get(fruit) || 0) + 1);
        }
      }

      const sortedFruits = Array.from(fruitVotes.entries())
        .sort((a, b) => b[1] - a[1]);

      let captain1Fruit: string;
      let captain2Fruit: string;
      let topTwoFruits: [string, number][];

      if (sortedFruits.length >= 2) {
        topTwoFruits = sortedFruits.slice(0, 2);
        captain1Fruit = topTwoFruits[0][0];
        captain2Fruit = topTwoFruits[1][0];
      } else if (sortedFruits.length === 1) {
        captain1Fruit = sortedFruits[0][0];
        
        const allFruits = Array.from(session.fruitToPlayer.keys());
        const remainingFruits = allFruits.filter(f => f !== captain1Fruit);
        captain2Fruit = remainingFruits[Math.floor(Math.random() * remainingFruits.length)];
        topTwoFruits = [[captain1Fruit, sortedFruits[0][1]], [captain2Fruit, 0]];
      } else {
      
        const allFruits = Array.from(session.fruitToPlayer.keys());
        const shuffled = [...allFruits].sort(() => Math.random() - 0.5);
        captain1Fruit = shuffled[0];
        captain2Fruit = shuffled[1];
        topTwoFruits = [[captain1Fruit, 0], [captain2Fruit, 0]];
      }

      const captain1Id = session.fruitToPlayer.get(captain1Fruit);
      const captain2Id = session.fruitToPlayer.get(captain2Fruit);

      const updatedPlayersList = session.movedPlayers.map((p) => {
        const fruit = Array.from(session.fruitToPlayer.entries()).find(([, id]) => id === p.id)?.[0] || '❓';
        const voteCount = fruitVotes.get(fruit) || 0;
        return `[${voteCount}] \`${fruit}\` <@${p.id}>`;
      }).join('\n');

      await voteMessage.edit({
        embeds: [{
          title: '✅ Captains Selected!',
          description: `
**Players and Votes:**
${updatedPlayersList}

**Captains:**
👑 <@${captain1Id}> (${topTwoFruits[0][1]} votes)
👑 <@${captain2Id}> (${topTwoFruits[1][1]} votes)
          `,
          color: 0x00FF00,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }],
        components: []
      });

      await channel.send({
        content: `🎉 Captains have been selected! <@${captain1Id}> and <@${captain2Id}> will now pick their teams.`
      });

      // Criar canais de voz para os times
      console.log('🎯 [CAPTAIN VOTE CALLBACK] Checking session data...');
      console.log(`🎯 [CAPTAIN VOTE CALLBACK] Guild ID: ${session.guildId}`);
      console.log(`🎯 [CAPTAIN VOTE CALLBACK] Category ID: ${session.categoryChannelId}`);
      console.log(`🎯 [CAPTAIN VOTE CALLBACK] Original Channel ID: ${session.originalChannelId}`);

      if (session.guildId && session.categoryChannelId && session.originalChannelId) {
        console.log('🎯 [CAPTAIN VOTE CALLBACK] All session data present, creating voice channels...');
        try {
          const guild = await this.bot.client.guilds.fetch(session.guildId);
          console.log(`🎯 [CAPTAIN VOTE CALLBACK] Guild fetched: ${guild.name}`);

          // Criar permissões para os canais de voz
          // Todos os 10 players devem poder entrar em ambas as salas
          const voicePermissions: any[] = session.movedPlayers.map(player => ({
            id: player.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          }));

          // Adicionar permissão para o bot
          const botMember = await guild.members.fetchMe();
          voicePermissions.push({
            id: botMember.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.ManageChannels,
            ],
          });


          // Criar canal para Team 1 (captain1)
          console.log(`🎯 [CAPTAIN VOTE CALLBACK] Creating Team ${captain1Fruit} voice channel...`);
          const team1Channel = await guild.channels.create({
            name: `Team ${captain1Fruit}`,
            type: ChannelType.GuildVoice,
            parent: session.categoryChannelId,
            permissionOverwrites: voicePermissions,
          });
          console.log(`🎯 [CAPTAIN VOTE CALLBACK] Team ${captain1Fruit} channel created: ${team1Channel.id}`);

          console.log(`🎯 [CAPTAIN VOTE CALLBACK] Creating Team ${captain2Fruit} voice channel...`);
          const team2Channel = await guild.channels.create({
            name: `Team ${captain2Fruit}`,
            type: ChannelType.GuildVoice,
            parent: session.categoryChannelId,
            permissionOverwrites: voicePermissions,
          });
          console.log(`🎯 [CAPTAIN VOTE CALLBACK] Team ${captain2Fruit} channel created: ${team2Channel.id}`);
          
          const captain1Member = await guild.members.fetch(captain1Id);
          if (captain1Member.voice.channel) {
            await captain1Member.voice.setChannel(team1Channel.id);
          }

          const captain2Member = await guild.members.fetch(captain2Id);
          if (captain2Member.voice.channel) {
            await captain2Member.voice.setChannel(team2Channel.id);
          }

          await channel.send({
            content: `🔊 Voice channels created!\n👑 <@${captain1Id}> → ${team1Channel.name}\n👑 <@${captain2Id}> → ${team2Channel.name}`
          });

          const { initializePickSession } = await import('./PickPlayer');

          // Pegar apenas os players disponíveis (excluindo os capitães)
          const availablePlayers = session.movedPlayers.filter(
            p => p.id !== captain1Id && p.id !== captain2Id
          );

          // Buscar todos os membros disponíveis de uma vez (mais rápido)
          const availableMemberPromises = availablePlayers.map(p =>
            guild.members.fetch(p.id).catch((): null => null)
          );
          const availableMembers = await Promise.all(availableMemberPromises);

          // Criar mapa de ID -> displayName
          const availablePlayerNames = new Map<string, string>();
          availableMembers.forEach((member, index) => {
            if (member) {
              availablePlayerNames.set(availablePlayers[index].id, member.displayName);
            }
          });

          // Criar botões com as frutas dos players disponíveis
          const buttons = availablePlayers.map((player) => {
            const fruit = Array.from(session.fruitToPlayer.entries())
              .find(([, id]) => id === player.id)?.[0] || '❓';
            const playerName = availablePlayerNames.get(player.id) || 'Player';

            return new ButtonBuilder()
              .setCustomId(`${ButtonActions.PickPlayer}:${fruit}`)
              .setLabel(`${fruit} ${playerName}`)
              .setStyle(ButtonStyle.Secondary);
          });

          const rows: ActionRowBuilder<ButtonBuilder>[] = [];
          for (let i = 0; i < buttons.length; i += 5) {
            const row = new ActionRowBuilder<ButtonBuilder>()
              .addComponents(buttons.slice(i, i + 5));
            rows.push(row);
          }

          // Adicionar botão de remake em uma linha separada
          // const remakeButton = new ButtonBuilder()
          //   .setCustomId(ButtonActions.RequestRemake)
          //   .setLabel('🔄 Request Remake')
          //   .setStyle(ButtonStyle.Primary);

          // const remakeRow = new ActionRowBuilder<ButtonBuilder>()
          //   .addComponents(remakeButton);
          // rows.push(remakeRow);

          const pickMessage = await channel.send({
            embeds: [{
              title: '⚔️ Team Selection',
              description: `
**Current Turn:** 👑 <@${captain1Id}> (\`${captain1Fruit}\`)
**Picks remaining:** 8

**Team ${captain1Fruit}:**
👑 \`${captain1Fruit}\` <@${captain1Id}>

**Team ${captain2Fruit}:**
👑 \`${captain2Fruit}\` <@${captain2Id}>

**Available Players:**
${availablePlayers.map(p => {
  const fruit = Array.from(session.fruitToPlayer.entries())
    .find(([, id]) => id === p.id)?.[0] || '❓';
  return `\`${fruit}\` <@${p.id}>`;
}).join('\n')}

**Click the fruit button to pick a player!**
              `,
              color: 0x00FFFF,
              timestamp: new Date().toISOString(),
              footer: {
                text: 'From BananaServer.xyz with 🍌',
              }
            }],
            components: rows
          });

          initializePickSession(
            pickMessage.id,
            captain1Id,
            captain2Id,
            captain1Fruit,
            captain2Fruit,
            team1Channel.id,
            team2Channel.id,
            session.fruitToPlayer,
            session.guildId,
            session.categoryChannelId
          );

        } catch (error) {
          this.logger.error('Error creating voice channels:', error);
          await channel.send({
            content: '⚠️ Failed to create voice channels or move captains.'
          });
        }
      }

      deleteReadySession(messageId);
    };

    initializeVotingSession(voteMessage.id, session.fruitToPlayer, onAllVoted);

    setTimeout(async () => {
      const { getVotesByMessage, getMaxVotesPerUser } = await import('./VoteCaptain');
      const votes = getVotesByMessage(voteMessage.id);

      if (!votes) return;

      const maxVotesPerUser = getMaxVotesPerUser();
      const playersWhoDidntCompleteVotes = session.allowedPlayerIds.filter(
        playerId => {
          const userVotes = votes.get(playerId);
          return !userVotes || userVotes.size < maxVotesPerUser;
        }
      );

      if (playersWhoDidntCompleteVotes.length > 0) {
        await channel.send({
          content: `⏰ **Reminder!** The following players haven't voted yet:\n${playersWhoDidntCompleteVotes.map(id => `<@${id}>`).join(', ')}`
        });
      }
    }, 10 * 1000);
  }
  }
}
