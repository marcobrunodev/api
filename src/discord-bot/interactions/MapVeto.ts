import { ButtonInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { ButtonActions } from "../enums/ButtonActions";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";

// Pool de mapas do competitive CS2
const COMPETITIVE_MAPS = [
  "Ancient",
  "Anubis",
  "Dust 2",
  "Inferno",
  "Mirage",
  "Nuke",
  "Overpass"
];

// Sessões de veto de mapas
const vetoSessions = new Map<string, {
  captain1Id: string;
  captain2Id: string;
  captain1Fruit: string;
  captain2Fruit: string;
  team1: string[];
  team2: string[];
  availableMaps: string[];
  bannedMaps: string[];
  vetoOrder: number[]; // 1 ou 2, representa qual capitão bane
  currentVetoIndex: number;
  guildId: string;
  channelId: string;
}>();

export function initializeVetoSession(
  messageId: string,
  captain1Id: string,
  captain2Id: string,
  captain1Fruit: string,
  captain2Fruit: string,
  team1: string[],
  team2: string[],
  guildId: string,
  channelId: string
) {
  // Ordem de vetos: 1,2,1,2,1,2 (6 bans) = 1 mapa restante
  const vetoOrder = [1, 2, 1, 2, 1, 2];

  vetoSessions.set(messageId, {
    captain1Id,
    captain2Id,
    captain1Fruit,
    captain2Fruit,
    team1,
    team2,
    availableMaps: [...COMPETITIVE_MAPS],
    bannedMaps: [],
    vetoOrder,
    currentVetoIndex: 0,
    guildId,
    channelId,
  });

  return vetoSessions.get(messageId);
}

export function getVetoSession(messageId: string) {
  return vetoSessions.get(messageId);
}

export function deleteVetoSession(messageId: string) {
  vetoSessions.delete(messageId);
}

@BotButtonInteraction(ButtonActions.VetoMap)
export default class MapVeto extends DiscordInteraction {
  public async handler(interaction: ButtonInteraction) {
    const [, mapName] = interaction.customId.split(":");
    const messageId = interaction.message.id;
    const userId = interaction.user.id;

    const session = vetoSessions.get(messageId);

    if (!session) {
      await interaction.reply({
        content: '❌ Veto session not found.',
        ephemeral: true
      });
      return;
    }

    // Verificar se é a vez do capitão correto
    const currentCaptain = session.vetoOrder[session.currentVetoIndex];
    const expectedCaptainId = currentCaptain === 1 ? session.captain1Id : session.captain2Id;

    if (userId !== expectedCaptainId) {
      const currentCaptainFruit = currentCaptain === 1 ? session.captain1Fruit : session.captain2Fruit;
      const isCaptain = userId === session.captain1Id || userId === session.captain2Id;

      if (isCaptain) {
        await interaction.reply({
          content: `❌ It's not your turn! Wait for 👑 <@${expectedCaptainId}> (\`${currentCaptainFruit}\`) to ban.`,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: `❌ Only captains can ban maps! Waiting for 👑 <@${expectedCaptainId}> (\`${currentCaptainFruit}\`) to ban.`,
          ephemeral: true
        });
      }
      return;
    }

    // Verificar se o mapa está disponível
    if (!session.availableMaps.includes(mapName)) {
      await interaction.reply({
        content: `❌ This map is not available.`,
        ephemeral: true
      });
      return;
    }

    // Banir o mapa
    session.bannedMaps.push(mapName);
    session.availableMaps = session.availableMaps.filter(m => m !== mapName);

    // Avançar para o próximo veto
    session.currentVetoIndex++;

    await interaction.reply({
      content: `✅ You banned **${mapName}**!`,
      ephemeral: true
    });

    // Atualizar a mensagem
    await updateVetoMessage(interaction);

    // Verificar se todos os vetos foram feitos
    if (session.currentVetoIndex >= session.vetoOrder.length) {
      await finalizeVeto(interaction, session);
      deleteVetoSession(messageId);
    }
  }
}

async function updateVetoMessage(interaction: ButtonInteraction) {
  const messageId = interaction.message.id;
  const session = vetoSessions.get(messageId);

  if (!session) return;

  const currentCaptain = session.vetoOrder[session.currentVetoIndex];
  const currentCaptainId = currentCaptain === 1 ? session.captain1Id : session.captain2Id;
  const currentCaptainFruit = currentCaptain === 1 ? session.captain1Fruit : session.captain2Fruit;

  // Lista de mapas disponíveis
  const availableMapsList = session.availableMaps
    .map(map => `\`${map}\``)
    .join(', ');

  // Lista de mapas banidos
  const bannedMapsList = session.bannedMaps.length > 0
    ? session.bannedMaps.map((map, index) => {
        const bannedBy = index % 2 === 0 ? session.captain1Fruit : session.captain2Fruit;
        return `~~${map}~~ (${bannedBy})`;
      }).join(', ')
    : '_None yet_';

  const vetosRemaining = session.vetoOrder.length - session.currentVetoIndex;

  // Reconstruir botões apenas com mapas disponíveis
  const buttons = session.availableMaps.map(map => {
    return new ButtonBuilder()
      .setCustomId(`${ButtonActions.VetoMap}:${map}`)
      .setLabel(map)
      .setStyle(ButtonStyle.Danger);
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(buttons.slice(i, i + 5));
    rows.push(row);
  }

  const originalEmbed = interaction.message.embeds[0];
  await interaction.message.edit({
    embeds: [{
      title: '🗺️ Map Veto',
      description: `
**Current Turn:** 👑 <@${currentCaptainId}> (\`${currentCaptainFruit}\`) - **BAN**
**Bans remaining:** ${vetosRemaining}

**Team ${session.captain1Fruit}:**
${session.team1.map(id => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map(id => `<@${id}>`).join(', ')}

**Available Maps:**
${availableMapsList}

**Banned Maps:**
${bannedMapsList}

**Click a map button to ban it!**
      `,
      color: 0xFF0000,
      timestamp: originalEmbed.timestamp,
      footer: originalEmbed.footer
    }],
    components: rows
  });
}

async function finalizeVeto(interaction: ButtonInteraction, session: ReturnType<typeof getVetoSession>) {
  const channel = interaction.channel;
  if (!channel || !('send' in channel)) return;

  // Desabilitar todos os botões
  await interaction.message.edit({
    components: []
  });

  const finalMap = session.availableMaps[0];

  const bannedMapsList = session.bannedMaps.map((map, index) => {
    const bannedBy = index % 2 === 0 ? session.captain1Fruit : session.captain2Fruit;
    return `~~${map}~~ (${bannedBy})`;
  }).join('\n');

  await interaction.message.edit({
    embeds: [{
      title: '✅ Map Selected!',
      description: `
**Playing Map:** 🎮 **${finalMap}**

**Team ${session.captain1Fruit}:**
${session.team1.map(id => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map(id => `<@${id}>`).join(', ')}

**Banned Maps:**
${bannedMapsList}

**Get ready to play on ${finalMap}!**
      `,
      color: 0x00FF00,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'From BananaServer.xyz with 🍌',
      }
    }]
  });

  await channel.send({
    content: `🎮 Map selected: **${finalMap}**! Both teams get ready!`
  });
}

export async function updateVetoMessageById(message: any) {
  const messageId = message.id;
  const session = vetoSessions.get(messageId);

  if (!session) return;

  const currentCaptain = session.vetoOrder[session.currentVetoIndex];
  const currentCaptainId = currentCaptain === 1 ? session.captain1Id : session.captain2Id;
  const currentCaptainFruit = currentCaptain === 1 ? session.captain1Fruit : session.captain2Fruit;

  const availableMapsList = session.availableMaps
    .map(map => `\`${map}\``)
    .join(', ');

  const bannedMapsList = session.bannedMaps.length > 0
    ? session.bannedMaps.map((map, index) => {
        const bannedBy = index % 2 === 0 ? session.captain1Fruit : session.captain2Fruit;
        return `~~${map}~~ (${bannedBy})`;
      }).join(', ')
    : '_None yet_';

  const vetosRemaining = session.vetoOrder.length - session.currentVetoIndex;

  const buttons = session.availableMaps.map(map => {
    return new ButtonBuilder()
      .setCustomId(`${ButtonActions.VetoMap}:${map}`)
      .setLabel(map)
      .setStyle(ButtonStyle.Danger);
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
      title: '🗺️ Map Veto',
      description: `
**Current Turn:** 👑 <@${currentCaptainId}> (\`${currentCaptainFruit}\`) - **BAN**
**Bans remaining:** ${vetosRemaining}

**Team ${session.captain1Fruit}:**
${session.team1.map(id => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map(id => `<@${id}>`).join(', ')}

**Available Maps:**
${availableMapsList}

**Banned Maps:**
${bannedMapsList}

**Click a map button to ban it!**
      `,
      color: 0xFF0000,
      timestamp: originalEmbed.timestamp,
      footer: originalEmbed.footer
    }],
    components: rows
  });
}
