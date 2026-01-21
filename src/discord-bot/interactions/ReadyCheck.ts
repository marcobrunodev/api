import { ButtonInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import DiscordInteraction from "./abstracts/DiscordInteraction";

const readySessions = new Map<string, {
  readyPlayers: Set<string>;
  totalPlayers: number;
  allowedPlayerIds: string[];
  fruitToPlayer: Map<string, string>;
  movedPlayers: any[];
}>();

export function initializeReadySession(
  messageId: string,
  allowedPlayerIds: string[],
  fruitToPlayer: Map<string, string>,
  movedPlayers: any[]
) {
  readySessions.set(messageId, {
    readyPlayers: new Set(),
    totalPlayers: allowedPlayerIds.length,
    allowedPlayerIds,
    fruitToPlayer,
    movedPlayers,
  });
}

export function getReadySession(messageId: string) {
  return readySessions.get(messageId);
}

export function deleteReadySession(messageId: string) {
  readySessions.delete(messageId);
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

  if (session.readyPlayers.has(userId)) {
    await interaction.reply({
      content: '✅ You are already ready!',
      ephemeral: true,
    });
    return;
  }

  session.readyPlayers.add(userId);

  const readyCount = session.readyPlayers.size;
  const totalCount = session.totalPlayers;

  await interaction.reply({
    content: `✅ You are ready! (${readyCount}/${totalCount})`,
    ephemeral: true,
  });

  // Atualizar a mensagem com o status
  const playersList = session.movedPlayers.map((p) => {
    const isReady = session.readyPlayers.has(p.id);
    const status = isReady ? '✅' : '⏳';
    return `${status} <@${p.id}>`;
  }).join('\n');

  await interaction.message.edit({
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
    components: interaction.message.components,
  });

  // Se todos estão prontos, iniciar votação de capitães
  if (readyCount === totalCount) {
    await interaction.message.edit({
      components: [], // Remove o botão de ready
    });

    const channel = interaction.channel;
    if (!channel || !('send' in channel)) return;

    // Iniciar votação de capitães
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
        .setCustomId(`${ButtonActions.VoteCaptain}:${fruit}`)
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

    // Callback quando todos votarem
    const onAllVoted = async (votes: Map<string, Set<string>>) => {

      if (!votes) return;

      const fruitVotes = new Map<string, number>();
      for (const [, votedFruits] of votes.entries()) {
        for (const fruit of votedFruits) {
          fruitVotes.set(fruit, (fruitVotes.get(fruit) || 0) + 1);
        }
      }

      const sortedFruits = Array.from(fruitVotes.entries())
        .sort((a, b) => b[1] - a[1]);

      // Se não houver votos suficientes, selecionar aleatoriamente
      let captain1Fruit: string;
      let captain2Fruit: string;
      let topTwoFruits: [string, number][];

      if (sortedFruits.length >= 2) {
        topTwoFruits = sortedFruits.slice(0, 2);
        captain1Fruit = topTwoFruits[0][0];
        captain2Fruit = topTwoFruits[1][0];
      } else if (sortedFruits.length === 1) {
        captain1Fruit = sortedFruits[0][0];
        // Selecionar um segundo capitão aleatório
        const allFruits = Array.from(session.fruitToPlayer.keys());
        const remainingFruits = allFruits.filter(f => f !== captain1Fruit);
        captain2Fruit = remainingFruits[Math.floor(Math.random() * remainingFruits.length)];
        topTwoFruits = [[captain1Fruit, sortedFruits[0][1]], [captain2Fruit, 0]];
      } else {
        // Nenhum voto - selecionar 2 aleatórios
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

      // Limpar a sessão de ready
      deleteReadySession(messageId);
    };

    // Inicializar votação com callback
    initializeVotingSession(voteMessage.id, session.fruitToPlayer, onAllVoted);

    // Reminder after 10 seconds
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
    }, 10 * 1000); // Reminder after 10 seconds
  }
  }
}
