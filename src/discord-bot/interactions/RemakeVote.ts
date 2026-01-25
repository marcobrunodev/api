import { ButtonInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { ButtonActions } from "../enums/ButtonActions";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";

// Sessões de votação de remake
const remakeSessions = new Map<string, {
  votes: Map<string, boolean>; // playerId -> vote (true = yes, false = no)
  allowedVoters: string[]; // IDs dos 10 players que podem votar
  initiatorId: string; // Quem solicitou o remake
  totalPlayers: number;
  timeRemaining: number;
  intervalId?: NodeJS.Timeout;
  guildId?: string;
  categoryChannelId?: string;
  queueMixChannelId?: string;
  channelId?: string; // Canal picks-bans
  onRemakeApproved?: () => Promise<void>;
}>();

// Cooldown para evitar spam de remakes (60s)
const remakeCooldowns = new Map<string, number>();
const REMAKE_COOLDOWN_MS = 60 * 1000; // 60 segundos
const REMAKE_VOTE_TIMEOUT = 30; // 30 segundos para votar

export function initializeRemakeSession(
  messageId: string,
  allowedVoters: string[],
  initiatorId: string,
  guildId?: string,
  categoryChannelId?: string,
  queueMixChannelId?: string,
  channelId?: string,
  onRemakeApproved?: () => Promise<void>
) {
  remakeSessions.set(messageId, {
    votes: new Map(),
    allowedVoters,
    initiatorId,
    totalPlayers: allowedVoters.length,
    timeRemaining: REMAKE_VOTE_TIMEOUT,
    guildId,
    categoryChannelId,
    queueMixChannelId,
    channelId,
    onRemakeApproved,
  });
}

export function getRemakeSession(messageId: string) {
  return remakeSessions.get(messageId);
}

export function deleteRemakeSession(messageId: string) {
  const session = remakeSessions.get(messageId);
  if (session?.intervalId) {
    clearInterval(session.intervalId);
  }
  remakeSessions.delete(messageId);
}

function getColorByTimeRemaining(time: number): number {
  if (time > 15) return 0xFFA500; // Laranja
  if (time > 5) return 0xFFD700;  // Amarelo
  return 0xFF0000; // Vermelho
}

export async function startRemakeCountdown(messageId: string, bot: any, channel: any) {
  const session = remakeSessions.get(messageId);
  if (!session) return;

  // Buscar a mensagem
  let message;
  try {
    message = await channel.messages.fetch(messageId);
  } catch (error) {
    console.error('Failed to fetch remake vote message:', error);
    return;
  }

  session.intervalId = setInterval(async () => {
    const currentSession = remakeSessions.get(messageId);
    if (!currentSession) {
      clearInterval(session.intervalId);
      return;
    }

    currentSession.timeRemaining--;

    // Contar votos
    const yesVotes = Array.from(currentSession.votes.values()).filter(v => v === true).length;
    const noVotes = Array.from(currentSession.votes.values()).filter(v => v === false).length;
    const notVoted = currentSession.totalPlayers - currentSession.votes.size;

    // Lista de players e seus votos
    const votesList = currentSession.allowedVoters.map((playerId) => {
      const vote = currentSession.votes.get(playerId);
      const status = vote === true ? '✅ Yes' : vote === false ? '❌ No' : '⏳ Pending';
      return `${status} <@${playerId}>`;
    }).join('\n');

    try {
      await message.edit({
        embeds: [{
          title: '🔄 Remake Vote',
          description: `
<@${currentSession.initiatorId}> requested a remake!

**⏰ Time Remaining: ${currentSession.timeRemaining} seconds**
**Votes:** ✅ ${yesVotes} | ❌ ${noVotes} | ⏳ ${notVoted}
**Required:** ${Math.floor(currentSession.totalPlayers / 2) + 1} Yes votes (50% + 1)

${votesList}

Vote to cancel the mix and return all players to Queue Mix!
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
        console.log(`⚠️ [REMAKE VOTE] Channel deleted, stopping countdown for message ${messageId}`);
        clearInterval(currentSession.intervalId);
        deleteRemakeSession(messageId);
        return;
      }
      console.error('Failed to update remake vote message:', error);
    }

    // Timeout ou votação decidida
    if (currentSession.timeRemaining <= 0) {
      clearInterval(currentSession.intervalId);
      await handleRemakeVoteEnd(messageId, bot, channel);
    }

    // Verificar se todos votaram
    if (currentSession.votes.size === currentSession.totalPlayers) {
      clearInterval(currentSession.intervalId);
      await handleRemakeVoteEnd(messageId, bot, channel);
    }
  }, 1000);
}

async function handleRemakeVoteEnd(messageId: string, bot: any, channel: any) {
  const session = remakeSessions.get(messageId);
  if (!session) return;

  const yesVotes = Array.from(session.votes.values()).filter(v => v === true).length;
  const requiredVotes = Math.floor(session.totalPlayers / 2) + 1; // 50% + 1

  // Desabilitar botões
  try {
    const message = await channel.messages.fetch(messageId);
    await message.edit({
      components: []
    });
  } catch (error) {
    console.error('Failed to disable remake buttons:', error);
  }

  if (yesVotes >= requiredVotes) {
    // Remake aprovado!
    await channel.send({
      content: `✅ **Remake approved!** (${yesVotes}/${session.totalPlayers} voted Yes)\n\nCancelling mix and moving players back to Queue Mix...`
    });

    // Executar callback de cancelamento
    if (session.onRemakeApproved) {
      await session.onRemakeApproved();
    }

    // Mover todos para Queue Mix no topo da fila
    // Nota: Não deletamos manualmente os canais e categoria porque isso
    // será feito automaticamente quando não houver mais players nos canais de voz
    if (session.guildId && session.queueMixChannelId && session.categoryChannelId) {
      try {
        await moveAllPlayersToQueueTop(session, bot);
      } catch (error) {
        console.error('Error moving players to queue:', error);
      }
    }
  } else {
    // Remake rejeitado
    await channel.send({
      content: `❌ **Remake rejected.** (${yesVotes}/${requiredVotes} Yes votes needed)\n\nMatch continues!`
    });
  }

  deleteRemakeSession(messageId);
}

async function moveAllPlayersToQueueTop(session: any, bot: any) {
  if (!session.guildId || !session.queueMixChannelId || !session.categoryChannelId) return;

  try {
    const guild = await bot.client.guilds.fetch(session.guildId);
    const queueMixChannel = guild.channels.cache.get(session.queueMixChannelId);

    if (!queueMixChannel) {
      console.error('Queue Mix channel not found');
      return;
    }

    // Buscar todos os canais de voz na categoria do mix
    await guild.channels.fetch();
    const category = guild.channels.cache.get(session.categoryChannelId);
    if (!category || !('children' in category)) return;

    const voiceChannels = category.children.cache.filter(
      (ch: any) => ch.type === 2 // GuildVoice
    );

    // Mover todos os players dos canais de voz do mix para Queue Mix
    for (const [, voiceChannel] of voiceChannels) {
      const members = (voiceChannel as any).members;
      if (!members) continue;

      for (const [memberId, member] of members) {
        try {
          // Mover para Queue Mix
          await member.voice.setChannel(queueMixChannel.id);

          // Adicionar no topo da fila
          await bot.addPlayerToTopOfQueue(session.guildId, memberId);
        } catch (error) {
          console.error(`Failed to move player ${memberId} to queue:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error moving players to queue top:', error);
  }
}

// Função removida: deleteMatchCategoryAndChannels
// Os canais e categoria são deletados automaticamente pelo sistema
// quando não há mais players nos canais de voz

@BotButtonInteraction(ButtonActions.RequestRemake)
export default class RequestRemake extends DiscordInteraction {
  public async handler(interaction: ButtonInteraction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const channel = interaction.channel;

    if (!guildId || !channel || !('send' in channel)) {
      await interaction.reply({
        content: '❌ This command can only be used in a server text channel.',
        ephemeral: true
      });
      return;
    }

    // Verificar cooldown
    const cooldownKey = `${guildId}:${userId}`;
    const lastRemake = remakeCooldowns.get(cooldownKey);

    if (lastRemake && Date.now() - lastRemake < REMAKE_COOLDOWN_MS) {
      const remainingTime = Math.ceil((REMAKE_COOLDOWN_MS - (Date.now() - lastRemake)) / 1000);
      await interaction.reply({
        content: `❌ Please wait ${remainingTime} seconds before requesting another remake.`,
        ephemeral: true
      });
      return;
    }

    // Tentar pegar informações das sessões ativas
    const { getReadySession } = await import('./ReadyCheck');
    const { getVotesByMessage, getFruitToPlayerMap } = await import('./VoteCaptain');
    const { getPickSession } = await import('./PickPlayer');
    const { getVetoSession } = await import('./MapVeto');

    let allowedVoters: string[] = [];
    let categoryChannelId: string | undefined;
    let queueMixChannelId: string | undefined;

    // Tentar encontrar sessão ativa através das mensagens no canal
    try {
      const messages = await channel.messages.fetch({ limit: 10 });

      for (const [messageId, message] of messages) {
        // Verificar se é uma sessão de Ready Check
        const readySession = getReadySession(messageId);
        if (readySession) {
          allowedVoters = readySession.allowedPlayerIds;
          categoryChannelId = readySession.categoryChannelId;
          queueMixChannelId = readySession.queueMixChannelId;
          break;
        }

        // Verificar se é uma sessão de Vote Captain
        const fruitToPlayer = getFruitToPlayerMap(messageId);
        if (fruitToPlayer) {
          allowedVoters = Array.from(fruitToPlayer.values());
          // Tentar pegar categoryChannelId do canal atual
          const guild = interaction.guild;
          if (guild) {
            const currentChannel = guild.channels.cache.get(channel.id);
            if (currentChannel && 'parent' in currentChannel) {
              categoryChannelId = currentChannel.parentId || undefined;
            }
            // Procurar Queue Mix channel
            const queueMix = guild.channels.cache.find(
              (ch: any) => ch.type === 2 && ch.name === '🍌 Queue Mix'
            );
            if (queueMix) {
              queueMixChannelId = queueMix.id;
            }
          }
          break;
        }

        // Verificar se é uma sessão de Pick Player
        const pickSession = getPickSession(messageId);
        if (pickSession) {
          allowedVoters = [
            ...pickSession.team1,
            ...pickSession.team2,
            ...pickSession.availablePlayers
          ];
          const guild = interaction.guild;
          if (guild) {
            const currentChannel = guild.channels.cache.get(channel.id);
            if (currentChannel && 'parent' in currentChannel) {
              categoryChannelId = currentChannel.parentId || undefined;
            }
            const queueMix = guild.channels.cache.find(
              (ch: any) => ch.type === 2 && ch.name === '🍌 Queue Mix'
            );
            if (queueMix) {
              queueMixChannelId = queueMix.id;
            }
          }
          break;
        }

        // Verificar se é uma sessão de Map Veto
        const vetoSession = getVetoSession(messageId);
        if (vetoSession) {
          allowedVoters = [...vetoSession.team1, ...vetoSession.team2];
          const guild = interaction.guild;
          if (guild) {
            const currentChannel = guild.channels.cache.get(channel.id);
            if (currentChannel && 'parent' in currentChannel) {
              categoryChannelId = currentChannel.parentId || undefined;
            }
            const queueMix = guild.channels.cache.find(
              (ch: any) => ch.type === 2 && ch.name === '🍌 Queue Mix'
            );
            if (queueMix) {
              queueMixChannelId = queueMix.id;
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error('Error finding active session:', error);
    }

    if (allowedVoters.length === 0) {
      await interaction.reply({
        content: '❌ No active mix session found in this channel.',
        ephemeral: true
      });
      return;
    }

    // Filtrar apenas players que estão ONLINE em canais de voz da categoria
    const onlineVoters: string[] = [];
    if (categoryChannelId && interaction.guild) {
      try {
        const guild = interaction.guild;
        await guild.channels.fetch();

        const category = guild.channels.cache.get(categoryChannelId);
        if (category && 'children' in category) {
          const voiceChannels = category.children.cache.filter(
            (ch: any) => ch.type === 2 // GuildVoice
          );

          // Coletar todos os members nos canais de voz da categoria
          for (const [, voiceChannel] of voiceChannels) {
            const members = (voiceChannel as any).members;
            if (members) {
              for (const [memberId] of members) {
                if (allowedVoters.includes(memberId) && !onlineVoters.includes(memberId)) {
                  onlineVoters.push(memberId);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error filtering online voters:', error);
      }
    }

    // Se nenhum player online foi encontrado, usar todos os allowed voters como fallback
    const finalVoters = onlineVoters.length > 0 ? onlineVoters : allowedVoters;

    if (finalVoters.length === 0) {
      await interaction.reply({
        content: '❌ No players found in voice channels.',
        ephemeral: true
      });
      return;
    }

    // Verificar se o usuário está na lista de voters
    if (!finalVoters.includes(userId)) {
      await interaction.reply({
        content: '❌ You are not a player in this mix or you are not in a voice channel.',
        ephemeral: true
      });
      return;
    }

    // Se menos de 50% dos players originais estão online, avisar
    const onlinePercentage = (finalVoters.length / allowedVoters.length) * 100;
    if (onlinePercentage < 50) {
      await interaction.reply({
        content: `⚠️ Only ${finalVoters.length}/${allowedVoters.length} players are online in voice channels. Remake vote will only count online players.`,
        ephemeral: true
      });
    }

    // Definir cooldown
    remakeCooldowns.set(cooldownKey, Date.now());

    // Defer the reply so we can delete it later
    await interaction.deferReply({
      ephemeral: true
    });

    // Criar botões de votação
    const yesButton = new ButtonBuilder()
      .setCustomId(`${ButtonActions.VoteRemake}:yes`)
      .setLabel('✅ Yes')
      .setStyle(ButtonStyle.Success);

    const noButton = new ButtonBuilder()
      .setCustomId(`${ButtonActions.VoteRemake}:no`)
      .setLabel('❌ No')
      .setStyle(ButtonStyle.Danger);

    const voteRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(yesButton, noButton);

    const voteMessage = await channel.send({
      embeds: [{
        title: '🔄 Remake Vote',
        description: `
<@${userId}> requested a remake!

**⏰ Time Remaining: ${REMAKE_VOTE_TIMEOUT} seconds**
**Votes:** ✅ 0 | ❌ 0 | ⏳ ${finalVoters.length}
**Required:** ${Math.floor(finalVoters.length / 2) + 1} Yes votes (50% + 1)
${finalVoters.length < allowedVoters.length ? `\n⚠️ **Only counting ${finalVoters.length}/${allowedVoters.length} players online in voice**\n` : ''}
${finalVoters.map(id => `⏳ Pending <@${id}>`).join('\n')}

Vote to cancel the mix and return all players to Queue Mix!
        `,
        color: 0xFFA500,
        timestamp: new Date().toISOString(),
        footer: {
          text: 'From BananaServer.xyz with 🍌',
        }
      }],
      components: [voteRow]
    });

    // Deletar a mensagem ephemeral "Starting remake vote..."
    try {
      await interaction.deleteReply();
    } catch (error) {
      console.error('Failed to delete remake starting message:', error);
    }

    // Inicializar sessão de remake
    initializeRemakeSession(
      voteMessage.id,
      finalVoters, // Usar apenas os players online
      userId,
      guildId,
      categoryChannelId,
      queueMixChannelId,
      channel.id
    );

    // Iniciar countdown
    await startRemakeCountdown(voteMessage.id, this.bot, channel);
  }
}

@BotButtonInteraction(ButtonActions.VoteRemake)
class VoteRemake extends DiscordInteraction {
  public async handler(interaction: ButtonInteraction) {
    const [, vote] = interaction.customId.split(":");
    const messageId = interaction.message.id;
    const userId = interaction.user.id;

    const session = remakeSessions.get(messageId);

    if (!session) {
      await interaction.reply({
        content: '❌ Remake vote session not found.',
        ephemeral: true
      });
      return;
    }

    if (!session.allowedVoters.includes(userId)) {
      await interaction.reply({
        content: '❌ You are not allowed to vote in this remake.',
        ephemeral: true
      });
      return;
    }

    const voteValue = vote === 'yes';
    session.votes.set(userId, voteValue);

    await interaction.reply({
      content: `✅ You voted **${vote === 'yes' ? 'Yes' : 'No'}** for remake!`,
      ephemeral: true
    });

    // Verificar se devemos finalizar a votação
    const yesVotes = Array.from(session.votes.values()).filter(v => v === true).length;
    const noVotes = Array.from(session.votes.values()).filter(v => v === false).length;
    const remainingVotes = session.totalPlayers - session.votes.size;
    const requiredVotes = Math.floor(session.totalPlayers / 2) + 1;

    // Finalizar se:
    // 1. Todos votaram
    // 2. Atingiu 50%+1 votos Yes (aprovado)
    // 3. É impossível atingir 50%+1 votos Yes (rejeitado automaticamente)
    const yesWins = yesVotes >= requiredVotes;
    const yesCannotWin = (yesVotes + remainingVotes) < requiredVotes;
    const shouldFinalize = session.votes.size === session.totalPlayers || yesWins || yesCannotWin;

    if (shouldFinalize) {
      if (session.intervalId) {
        clearInterval(session.intervalId);
      }
      const channel = interaction.channel;
      if (channel && 'send' in channel) {
        await handleRemakeVoteEnd(messageId, this.bot, channel);
      }
    }
  }
}
