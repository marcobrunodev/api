import { ButtonInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { ButtonActions } from "../enums/ButtonActions";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";

// Sessões de pick de players
const pickSessions = new Map<string, {
  captain1Id: string;
  captain2Id: string;
  captain1Fruit: string;
  captain2Fruit: string;
  team1ChannelId: string;
  team2ChannelId: string;
  fruitToPlayer: Map<string, string>;
  availablePlayers: string[]; // IDs dos players ainda disponíveis
  team1: string[]; // IDs dos players no time 1
  team2: string[]; // IDs dos players no time 2
  pickOrder: number[]; // 1 ou 2, representa qual capitão escolhe
  currentPickIndex: number;
  guildId: string;
}>();

export function initializePickSession(
  messageId: string,
  captain1Id: string,
  captain2Id: string,
  captain1Fruit: string,
  captain2Fruit: string,
  team1ChannelId: string,
  team2ChannelId: string,
  fruitToPlayer: Map<string, string>,
  guildId: string
) {
  // Ordem de picks: 1,2,2,1,1,2,2,1 (total 8 picks para 10 players - 2 são capitães)
  const pickOrder = [1, 2, 2, 1, 1, 2, 2, 1];

  const allPlayerIds = Array.from(fruitToPlayer.values());
  const availablePlayers = allPlayerIds.filter(id => id !== captain1Id && id !== captain2Id);

  pickSessions.set(messageId, {
    captain1Id,
    captain2Id,
    captain1Fruit,
    captain2Fruit,
    team1ChannelId,
    team2ChannelId,
    fruitToPlayer,
    availablePlayers,
    team1: [captain1Id], // Capitão 1 já está no time 1
    team2: [captain2Id], // Capitão 2 já está no time 2
    pickOrder,
    currentPickIndex: 0,
    guildId,
  });

  return pickSessions.get(messageId);
}

export function getPickSession(messageId: string) {
  return pickSessions.get(messageId);
}

export function deletePickSession(messageId: string) {
  pickSessions.delete(messageId);
}

@BotButtonInteraction(ButtonActions.PickPlayer)
export default class PickPlayer extends DiscordInteraction {
  public async handler(interaction: ButtonInteraction) {
    const [, fruit] = interaction.customId.split(":");
    const messageId = interaction.message.id;
    const userId = interaction.user.id;

    const session = pickSessions.get(messageId);

    if (!session) {
      await interaction.reply({
        content: '❌ Pick session not found.',
        ephemeral: true
      });
      return;
    }

    // Verificar se é a vez do capitão correto
    const currentCaptain = session.pickOrder[session.currentPickIndex];
    const expectedCaptainId = currentCaptain === 1 ? session.captain1Id : session.captain2Id;

    if (userId !== expectedCaptainId) {
      const currentCaptainFruit = currentCaptain === 1 ? session.captain1Fruit : session.captain2Fruit;
      const isCaptain = userId === session.captain1Id || userId === session.captain2Id;

      if (isCaptain) {
        // É um capitão mas não é sua vez
        await interaction.reply({
          content: `❌ It's not your turn! Wait for 👑 <@${expectedCaptainId}> (\`${currentCaptainFruit}\`) to pick.`,
          ephemeral: true
        });
      } else {
        // Não é um capitão
        await interaction.reply({
          content: `❌ Only captains can pick players! Waiting for 👑 <@${expectedCaptainId}> (\`${currentCaptainFruit}\`) to pick.`,
          ephemeral: true
        });
      }
      return;
    }

    // Verificar se a fruta existe e o player está disponível
    const pickedPlayerId = session.fruitToPlayer.get(fruit);

    if (!pickedPlayerId || !session.availablePlayers.includes(pickedPlayerId)) {
      await interaction.reply({
        content: `❌ This player is not available.`,
        ephemeral: true
      });
      return;
    }

    // Adicionar player ao time do capitão
    if (currentCaptain === 1) {
      session.team1.push(pickedPlayerId);
    } else {
      session.team2.push(pickedPlayerId);
    }

    // Remover player da lista de disponíveis
    session.availablePlayers = session.availablePlayers.filter(id => id !== pickedPlayerId);

    // Avançar para o próximo pick
    session.currentPickIndex++;

    await interaction.reply({
      content: `✅ You picked \`${fruit}\` <@${pickedPlayerId}>!`,
      ephemeral: true
    });

    // Atualizar a mensagem
    await updatePickMessage(interaction);

    // Mover o player para o canal de voz do time
    try {
      const guild = await this.bot.client.guilds.fetch(session.guildId);
      const member = await guild.members.fetch(pickedPlayerId);
      const targetChannelId = currentCaptain === 1 ? session.team1ChannelId : session.team2ChannelId;

      if (member.voice.channel) {
        await member.voice.setChannel(targetChannelId);
      }
    } catch (error) {
      this.logger.error('Error moving player to team channel:', error);
    }

    // Verificar se todos os picks foram feitos
    if (session.currentPickIndex >= session.pickOrder.length) {
      await finalizePicks(interaction, session);
      deletePickSession(messageId);
    }
  }
}

async function updatePickMessage(interaction: ButtonInteraction) {
  const messageId = interaction.message.id;
  const session = pickSessions.get(messageId);

  if (!session) return;

  const currentCaptain = session.pickOrder[session.currentPickIndex];
  const currentCaptainId = currentCaptain === 1 ? session.captain1Id : session.captain2Id;
  const currentCaptainFruit = currentCaptain === 1 ? session.captain1Fruit : session.captain2Fruit;

  // Lista de players disponíveis
  const availablePlayersList = session.availablePlayers
    .map(playerId => {
      const fruit = Array.from(session.fruitToPlayer.entries())
        .find(([, id]) => id === playerId)?.[0] || '❓';
      return `\`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  // Times atuais
  const team1List = session.team1
    .map(playerId => {
      const fruit = Array.from(session.fruitToPlayer.entries())
        .find(([, id]) => id === playerId)?.[0] || '❓';
      const isCaptain = playerId === session.captain1Id ? '👑 ' : '';
      return `${isCaptain}\`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  const team2List = session.team2
    .map(playerId => {
      const fruit = Array.from(session.fruitToPlayer.entries())
        .find(([, id]) => id === playerId)?.[0] || '❓';
      const isCaptain = playerId === session.captain2Id ? '👑 ' : '';
      return `${isCaptain}\`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  const picksRemaining = session.pickOrder.length - session.currentPickIndex;

  // Reconstruir botões apenas com players disponíveis
  const buttons = session.availablePlayers.map(playerId => {
    const fruit = Array.from(session.fruitToPlayer.entries())
      .find(([, id]) => id === playerId)?.[0] || '❓';
    return new ButtonBuilder()
      .setCustomId(`${ButtonActions.PickPlayer}:${fruit}`)
      .setLabel(fruit)
      .setStyle(ButtonStyle.Secondary);
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(buttons.slice(i, i + 5));
    rows.push(row);
  }

  // Adicionar botão de remake em uma linha separada
  const remakeButton = new ButtonBuilder()
    .setCustomId(ButtonActions.RequestRemake)
    .setLabel('🔄 Request Remake')
    .setStyle(ButtonStyle.Danger);

  const remakeRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(remakeButton);
  rows.push(remakeRow);

  const originalEmbed = interaction.message.embeds[0];
  await interaction.message.edit({
    embeds: [{
      title: '⚔️ Team Selection',
      description: `
**Current Turn:** 👑 <@${currentCaptainId}> (\`${currentCaptainFruit}\`)
**Picks remaining:** ${picksRemaining}

**Team ${session.captain1Fruit}:**
${team1List || '_Empty_'}

**Team ${session.captain2Fruit}:**
${team2List || '_Empty_'}

**Available Players:**
${availablePlayersList || '_None_'}

**Click the fruit button to pick a player!**
      `,
      color: originalEmbed.color,
      timestamp: originalEmbed.timestamp,
      footer: originalEmbed.footer
    }],
    components: rows
  });
}

async function finalizePicks(interaction: ButtonInteraction, session: ReturnType<typeof getPickSession>) {
  const channel = interaction.channel;
  if (!channel || !('send' in channel)) return;

  // Desabilitar todos os botões
  await interaction.message.edit({
    components: []
  });

  const team1List = session.team1
    .map(playerId => {
      const fruit = Array.from(session.fruitToPlayer.entries())
        .find(([, id]) => id === playerId)?.[0] || '❓';
      const isCaptain = playerId === session.captain1Id ? '👑 ' : '';
      return `${isCaptain}\`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  const team2List = session.team2
    .map(playerId => {
      const fruit = Array.from(session.fruitToPlayer.entries())
        .find(([, id]) => id === playerId)?.[0] || '❓';
      const isCaptain = playerId === session.captain2Id ? '👑 ' : '';
      return `${isCaptain}\`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  await interaction.message.edit({
    embeds: [{
      title: '✅ Teams Selected!',
      description: `
**Team ${session.captain1Fruit}:**
${team1List}

**Team ${session.captain2Fruit}:**
${team2List}

**Next step:** Map veto will begin shortly...
      `,
      color: 0x00FF00,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'From BananaServer.xyz with 🍌',
      }
    }]
  });

  await channel.send({
    content: `✅ Teams are ready! Map veto starting now...`
  });

  // Iniciar veto de mapas
  const { initializeVetoSession } = await import('./MapVeto');

  const COMPETITIVE_MAPS = [
    "Ancient",
    "Anubis",
    "Dust 2",
    "Inferno",
    "Mirage",
    "Nuke",
    "Overpass"
  ];

  // Criar botões com os mapas
  const mapButtons = COMPETITIVE_MAPS.map(map => {
    return new ButtonBuilder()
      .setCustomId(`${ButtonActions.VetoMap}:${map}`)
      .setLabel(map)
      .setStyle(ButtonStyle.Danger);
  });

  const mapRows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < mapButtons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(mapButtons.slice(i, i + 5));
    mapRows.push(row);
  }

  // Adicionar botão de remake em uma linha separada
  const remakeButton = new ButtonBuilder()
    .setCustomId(ButtonActions.RequestRemake)
    .setLabel('🔄 Request Remake')
    .setStyle(ButtonStyle.Danger);

  const remakeRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(remakeButton);
  mapRows.push(remakeRow);

  const vetoMessage = await channel.send({
    embeds: [{
      title: '🗺️ Map Veto',
      description: `
**Current Turn:** 👑 <@${session.captain1Id}> (\`${session.captain1Fruit}\`) - **BAN**
**Bans remaining:** 6

**Team ${session.captain1Fruit}:**
${session.team1.map(id => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map(id => `<@${id}>`).join(', ')}

**Available Maps:**
${COMPETITIVE_MAPS.map(m => `\`${m}\``).join(', ')}

**Banned Maps:**
_None yet_

**Click a map button to ban it!**
      `,
      color: 0xFF0000,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'From BananaServer.xyz with 🍌',
      }
    }],
    components: mapRows
  });

  initializeVetoSession(
    vetoMessage.id,
    session.captain1Id,
    session.captain2Id,
    session.captain1Fruit,
    session.captain2Fruit,
    session.team1,
    session.team2,
    session.guildId,
    channel.id
  );
}

export async function updatePickMessageById(message: any) {
  const messageId = message.id;
  const session = pickSessions.get(messageId);

  if (!session) return;

  const currentCaptain = session.pickOrder[session.currentPickIndex];
  const currentCaptainId = currentCaptain === 1 ? session.captain1Id : session.captain2Id;
  const currentCaptainFruit = currentCaptain === 1 ? session.captain1Fruit : session.captain2Fruit;

  const availablePlayersList = session.availablePlayers
    .map(playerId => {
      const fruit = Array.from(session.fruitToPlayer.entries())
        .find(([, id]) => id === playerId)?.[0] || '❓';
      return `\`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  const team1List = session.team1
    .map(playerId => {
      const fruit = Array.from(session.fruitToPlayer.entries())
        .find(([, id]) => id === playerId)?.[0] || '❓';
      const isCaptain = playerId === session.captain1Id ? '👑 ' : '';
      return `${isCaptain}\`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  const team2List = session.team2
    .map(playerId => {
      const fruit = Array.from(session.fruitToPlayer.entries())
        .find(([, id]) => id === playerId)?.[0] || '❓';
      const isCaptain = playerId === session.captain2Id ? '👑 ' : '';
      return `${isCaptain}\`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  const picksRemaining = session.pickOrder.length - session.currentPickIndex;

  // Reconstruir botões apenas com players disponíveis
  const buttons = session.availablePlayers.map(playerId => {
    const fruit = Array.from(session.fruitToPlayer.entries())
      .find(([, id]) => id === playerId)?.[0] || '❓';
    return new ButtonBuilder()
      .setCustomId(`${ButtonActions.PickPlayer}:${fruit}`)
      .setLabel(fruit)
      .setStyle(ButtonStyle.Secondary);
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(buttons.slice(i, i + 5));
    rows.push(row);
  }

  const originalEmbed = message.embeds[0];
  await message.edit({
    embeds: [{
      title: '⚔️ Team Selection',
      description: `
**Current Turn:** 👑 <@${currentCaptainId}> (\`${currentCaptainFruit}\`)
**Picks remaining:** ${picksRemaining}

**Team ${session.captain1Fruit}:**
${team1List || '_Empty_'}

**Team ${session.captain2Fruit}:**
${team2List || '_Empty_'}

**Available Players:**
${availablePlayersList || '_None_'}

**Click the fruit button to pick a player!**
      `,
      color: originalEmbed.color,
      timestamp: originalEmbed.timestamp,
      footer: originalEmbed.footer
    }],
    components: rows
  });
}
