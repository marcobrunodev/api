import { ButtonInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { ButtonActions } from "../enums/ButtonActions";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";

// Sessões de veto de regiões
const regionVetoSessions = new Map<string, {
  captain1Id: string;
  captain2Id: string;
  captain1Fruit: string;
  captain2Fruit: string;
  team1: string[];
  team2: string[];
  availableRegions: string[];
  bannedRegions: string[];
  vetoOrder: number[];
  currentVetoIndex: number;
  guildId: string;
  channelId: string;
  categoryId?: string;
  team1ChannelId: string;
  team2ChannelId: string;
  fruitToPlayer: Map<string, string>;
}>();

export function initializeRegionVetoSession(
  messageId: string,
  captain1Id: string,
  captain2Id: string,
  captain1Fruit: string,
  captain2Fruit: string,
  team1: string[],
  team2: string[],
  availableRegions: string[],
  guildId: string,
  channelId: string,
  categoryId?: string,
  team1ChannelId?: string,
  team2ChannelId?: string,
  fruitToPlayer?: Map<string, string>
) {
  // Com 2 regiões: 1 ban = 1 região restante
  // Com 3 regiões: 1,2 = 1 região restante
  // Com 4 regiões: 1,2,1 = 1 região restante
  const bansNeeded = availableRegions.length - 1;
  const vetoOrder: number[] = [];
  for (let i = 0; i < bansNeeded; i++) {
    vetoOrder.push((i % 2) + 1);
  }

  regionVetoSessions.set(messageId, {
    captain1Id,
    captain2Id,
    captain1Fruit,
    captain2Fruit,
    team1,
    team2,
    availableRegions: [...availableRegions],
    bannedRegions: [],
    vetoOrder,
    currentVetoIndex: 0,
    guildId,
    channelId,
    categoryId,
    team1ChannelId: team1ChannelId || '',
    team2ChannelId: team2ChannelId || '',
    fruitToPlayer: fruitToPlayer || new Map(),
  });

  return regionVetoSessions.get(messageId);
}

export function getRegionVetoSession(messageId: string) {
  return regionVetoSessions.get(messageId);
}

export function deleteRegionVetoSession(messageId: string) {
  regionVetoSessions.delete(messageId);
}

@BotButtonInteraction(ButtonActions.VetoRegion)
export default class RegionVeto extends DiscordInteraction {
  public async handler(interaction: ButtonInteraction) {
    const [, regionName] = interaction.customId.split(":");
    const messageId = interaction.message.id;
    const userId = interaction.user.id;

    const session = regionVetoSessions.get(messageId);

    if (!session) {
      await interaction.reply({
        content: '❌ Region veto session not found.',
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
          content: `❌ Only captains can ban regions! Waiting for 👑 <@${expectedCaptainId}> (\`${currentCaptainFruit}\`) to ban.`,
          ephemeral: true
        });
      }
      return;
    }

    // Verificar se a região está disponível
    if (!session.availableRegions.includes(regionName)) {
      await interaction.reply({
        content: `❌ This region is not available.`,
        ephemeral: true
      });
      return;
    }

    // Acknowledge the interaction silently
    await interaction.deferUpdate();

    // Banir a região
    session.bannedRegions.push(regionName);
    session.availableRegions = session.availableRegions.filter(r => r !== regionName);

    // Avançar para o próximo veto
    session.currentVetoIndex++;

    // Verificar se todos os vetos foram feitos (sobrou 1 região)
    if (session.availableRegions.length === 1) {
      await this.finalizeRegionVeto(interaction, session);
      deleteRegionVetoSession(messageId);
    } else {
      // Atualizar a mensagem
      await updateRegionVetoMessage(interaction);
    }
  }

  private async finalizeRegionVeto(interaction: ButtonInteraction, session: ReturnType<typeof getRegionVetoSession>) {
    const channel = interaction.channel;
    if (!channel || !('send' in channel)) return;

    const selectedRegion = session.availableRegions[0];

    const bannedRegionsList = session.bannedRegions.map((region, index) => {
      const bannedBy = index % 2 === 0 ? session.captain1Fruit : session.captain2Fruit;
      return `~~${region}~~ (${bannedBy})`;
    }).join('\n');

    // Atualizar embed mostrando a região selecionada
    await interaction.message.edit({
      embeds: [{
        title: '🌍 Region Selected!',
        description: `
**Selected Region:** 🎮 **${selectedRegion}**

**Team ${session.captain1Fruit}:**
${session.team1.map((id: string) => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map((id: string) => `<@${id}>`).join(', ')}

**Banned Regions:**
${bannedRegionsList}

**Starting map veto...**
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
      content: `🌍 Region selected: **${selectedRegion}**! Starting map veto...`
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

    const vetoMessage = await channel.send({
      embeds: [{
        title: '🗺️ Map Veto',
        description: `
**Selected Region:** 🌍 ${selectedRegion}
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
      channel.id,
      session.categoryId,
      selectedRegion // Passar a região selecionada
    );
  }
}

async function updateRegionVetoMessage(interaction: ButtonInteraction) {
  const messageId = interaction.message.id;
  const session = regionVetoSessions.get(messageId);

  if (!session) return;

  const currentCaptain = session.vetoOrder[session.currentVetoIndex];
  const currentCaptainId = currentCaptain === 1 ? session.captain1Id : session.captain2Id;
  const currentCaptainFruit = currentCaptain === 1 ? session.captain1Fruit : session.captain2Fruit;

  // Lista de regiões disponíveis
  const availableRegionsList = session.availableRegions
    .map(region => `\`${region}\``)
    .join(', ');

  // Lista de regiões banidas
  const bannedRegionsList = session.bannedRegions.length > 0
    ? session.bannedRegions.map((region, index) => {
        const bannedBy = index % 2 === 0 ? session.captain1Fruit : session.captain2Fruit;
        return `~~${region}~~ (${bannedBy})`;
      }).join(', ')
    : '_None yet_';

  const vetosRemaining = session.vetoOrder.length - session.currentVetoIndex;

  // Reconstruir botões apenas com regiões disponíveis
  const buttons = session.availableRegions.map(region => {
    return new ButtonBuilder()
      .setCustomId(`${ButtonActions.VetoRegion}:${region}`)
      .setLabel(region)
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
      title: '🌍 Region Veto',
      description: `
**Current Turn:** 👑 <@${currentCaptainId}> (\`${currentCaptainFruit}\`) - **BAN**
**Bans remaining:** ${vetosRemaining}

**Team ${session.captain1Fruit}:**
${session.team1.map((id: string) => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map((id: string) => `<@${id}>`).join(', ')}

**Available Regions:**
${availableRegionsList}

**Banned Regions:**
${bannedRegionsList}

**Click a region button to ban it!**
      `,
      color: 0xFF0000,
      timestamp: originalEmbed.timestamp,
      footer: originalEmbed.footer
    }],
    components: rows
  });
}
