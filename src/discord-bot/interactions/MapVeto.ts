import { ButtonInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType, PermissionFlagsBits } from "discord.js";
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

// Mapeamento de nomes amigáveis para nomes técnicos do banco de dados
const MAP_DISPLAY_TO_DB: Record<string, string> = {
  "Ancient": "de_ancient",
  "Anubis": "de_anubis",
  "Dust 2": "de_dust2",
  "Inferno": "de_inferno",
  "Mirage": "de_mirage",
  "Nuke": "de_nuke",
  "Overpass": "de_overpass"
};

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
  categoryId?: string;
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
  channelId: string,
  categoryId?: string
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
    categoryId,
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

    // Acknowledge the interaction silently (no message shown to user)
    await interaction.deferUpdate();

    // Banir o mapa
    session.bannedMaps.push(mapName);
    session.availableMaps = session.availableMaps.filter(m => m !== mapName);

    // Avançar para o próximo veto
    session.currentVetoIndex++;

    // Atualizar a mensagem
    await updateVetoMessage(interaction);

    // Verificar se todos os vetos foram feitos
    if (session.currentVetoIndex >= session.vetoOrder.length) {
      await this.finalizeVeto(interaction, session);
      deleteVetoSession(messageId);
    }
  }

  private async finalizeVeto(interaction: ButtonInteraction, session: ReturnType<typeof getVetoSession>) {
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
${session.team1.map((id: string) => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map((id: string) => `<@${id}>`).join(', ')}

**Banned Maps:**
${bannedMapsList}

**Starting competitive match...**
      `,
        color: 0x00FF00,
        timestamp: new Date().toISOString(),
        footer: {
          text: 'From BananaServer.xyz with 🍌',
        }
      }]
    });

    await channel.send({
      content: `🎮 Map selected: **${finalMap}**! Starting match...`
    });

    // Criar partida competitiva
    try {
      await this.createCompetitiveMatch(session, finalMap, channel);
    } catch (error) {
      const errorMsg = 'Error creating competitive match:';
      if (this.logger) {
        this.logger.error(errorMsg, error);
      } else {
        console.error(errorMsg, error);
      }
      await channel.send({
        content: `❌ Error creating match. Please contact an administrator.`
      });
    }
  }

  private async createCompetitiveMatch(session: ReturnType<typeof getVetoSession>, selectedMap: string, channel: any) {
    // Converter nome amigável para nome técnico do banco
    const dbMapName = MAP_DISPLAY_TO_DB[selectedMap];

    if (!dbMapName) {
      throw new Error(`Map ${selectedMap} not found in map display mapping`);
    }

    console.log(`🎮 [MAP VETO] Searching for map: "${selectedMap}" (DB name: "${dbMapName}")`);

    const { maps } = await this.hasura.query({
      maps: {
        __args: {
          where: {
            name: {
              _eq: dbMapName
            },
            type: {
              _eq: "Competitive"
            }
          }
        },
        id: true,
        name: true,
      }
    });

    if (!maps || maps.length === 0) {
      throw new Error(`Map ${selectedMap} (${dbMapName}) not found in database`);
    }

    const mapId = maps[0].id;

    // Criar match no banco
    const match = await this.matchAssistant.createMatchBasedOnType(
      "Competitive",
      "Competitive",
      {
        mr: 12,
        best_of: 1,
        knife: true,
        map: mapId,
        overtime: true,
        maps: [],
        discord_guild_id: session.guildId,
      }
    );

    const matchId = match.id;
    console.log(`🎮 [MAP VETO] [${matchId}] Match created for map ${selectedMap}`);

    // Registrar partida do mix para processamento quando terminar
    if (session.categoryId) {
      this.bot.registerMixMatch(
        matchId,
        session.guildId,
        session.categoryId,
        session.team1,
        session.team2
      );
    }

    await this.addPlayersAndStartMatch(session, matchId, match, selectedMap, channel);
  }

  private async addPlayersAndStartMatch(session: any, matchId: string, match: any, selectedMap: string, channel: any) {

    // Buscar todos os players (team1 + team2)
    const allPlayerIds = [...session.team1, ...session.team2];
    const guild = await this.bot.client.guilds.fetch(session.guildId);

    const allPlayers = [];
    for (const playerId of allPlayerIds) {
      try {
        const user = await guild.members.fetch(playerId);
        allPlayers.push(user.user);
      } catch (error) {
        console.warn(`⚠️ [MAP VETO] Failed to fetch user ${playerId}:`, error);
      }
    }

    // Adicionar players aos lineups
    for (const playerId of session.team1) {
      try {
        const user = await guild.members.fetch(playerId);
        await this.discordPickPlayer.addDiscordUserToLineup(
          matchId,
          match.lineup_1_id,
          user.user
        );
      } catch (error) {
        console.error(`❌ [MAP VETO] Error adding player ${playerId} to lineup 1:`, error);
      }
    }

    for (const playerId of session.team2) {
      try {
        const user = await guild.members.fetch(playerId);
        await this.discordPickPlayer.addDiscordUserToLineup(
          matchId,
          match.lineup_2_id,
          user.user
        );
      } catch (error) {
        console.error(`❌ [MAP VETO] Error adding player ${playerId} to lineup 2:`, error);
      }
    }

    // Iniciar partida (vai atribuir servidor automaticamente)
    await this.discordPickPlayer.startMatch(matchId);

    console.log(`🎮 [MAP VETO] [${matchId}] Match started, server assignment in progress`);

    // Aguardar um pouco para dar tempo do servidor ser atribuído
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Buscar informações da partida com servidor
    const { matches_by_pk } = await this.hasura.query({
      matches_by_pk: {
        __args: {
          id: matchId
        },
        id: true,
        status: true,
        connection_link: true,
        server: {
          host: true,
          port: true,
          tv_port: true,
          game_server_node: {
            public_ip: true,
          }
        }
      }
    });

    if (matches_by_pk?.server) {
      const server = matches_by_pk.server;
      const serverIp = server.game_server_node?.public_ip || server.host;
      const connectCommand = `connect ${serverIp}:${server.port}`;
      const tvCommand = server.tv_port ? `connect ${serverIp}:${server.tv_port}` : null;

      const tvSection = tvCommand ? `\n**GOTV (Spectate):**\n\`\`\`\n${tvCommand}\n\`\`\`` : '';

      // Criar URL para abrir Steam diretamente
      const steamConnectUrl = `steam://run/730//+connect%20${serverIp}:${server.port}`;
      const quickConnectUrl = matches_by_pk.connection_link
        ? `${this.configService.get<AppConfig>("app").webDomain}/quick-connect?link=${encodeURIComponent(matches_by_pk.connection_link)}`
        : `${this.configService.get<AppConfig>("app").webDomain}/quick-connect?link=${encodeURIComponent(steamConnectUrl)}`;

      await channel.send({
        embeds: [{
          title: '🎮 Match Ready!',
          description: `
**Match ID:** \`${matchId}\`
**Map:** ${selectedMap}
**Status:** ${matches_by_pk.status}

**Connect to Server:**
\`\`\`
${connectCommand}
\`\`\`${tvSection}

**Team ${session.captain1Fruit}:**
${session.team1.map((id: string) => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map((id: string) => `<@${id}>`).join(', ')}

Good luck and have fun! 🍌

**Quick Connect (Click to copy):**
\`\`\`
${steamConnectUrl}
\`\`\`
        `,
          color: 0x00FF00,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }],
        components: [{
          type: 1,
          components: [{
            type: 2,
            style: 5,
            label: '🚀 Quick Connect',
            url: quickConnectUrl
          }]
        }]
      });

      // Criar canal de log para a partida
      if (session.categoryId && session.guildId) {
        await this.createMatchLogChannel(matchId, session.guildId, session.categoryId, selectedMap);
      }
    } else {
      await channel.send({
        embeds: [{
          title: '⏳ Match Created',
          description: `
**Match ID:** \`${matchId}\`
**Map:** ${selectedMap}
**Status:** Waiting for server...

The server is being prepared. You'll receive connection details shortly!
        `,
          color: 0xFFA500,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }]
      });
    }
  }

  private async createMatchLogChannel(
    matchId: string,
    guildId: string,
    categoryId: string,
    mapName: string
  ) {
    try {
      const guild = await this.bot.client.guilds.fetch(guildId);
      const botMember = await guild.members.fetchMe();

      // Criar canal de texto para scoreboard da partida
      const logChannel = await guild.channels.create({
        name: `scoreboard`,
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: `Live match stats for ${matchId}`,
        permissionOverwrites: [
          {
            id: guild.id,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [PermissionFlagsBits.SendMessages],
          },
          {
            id: botMember.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages,
            ],
          },
        ],
      });

      // Enviar mensagem inicial do scoreboard
      const scoreboardMessage = await logChannel.send({
        embeds: [{
          title: `📊 Live Match Stats - ${mapName}`,
          description: `
**Match ID:** \`${matchId}\`
**Status:** Waiting for match to start...

The scoreboard will be updated here after each round.
          `,
          color: 0x0099FF,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }]
      });

      // Salvar o canal e message ID no cache
      await this.bot.setMatchLogChannel(matchId, logChannel.id, scoreboardMessage.id);

      console.log(`📊 [MATCH LOG] Created log channel for match ${matchId}: ${logChannel.id}`);
    } catch (error) {
      console.error(`❌ [MATCH LOG] Error creating log channel for match ${matchId}:`, error);
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

  // Adicionar botão de remake em uma linha separada
  // const remakeButton = new ButtonBuilder()
  //   .setCustomId(ButtonActions.RequestRemake)
  //   .setLabel('🔄 Request Remake')
  //   .setStyle(ButtonStyle.Secondary);

  // const remakeRow = new ActionRowBuilder<ButtonBuilder>()
  //   .addComponents(remakeButton);
  // rows.push(remakeRow);

  const originalEmbed = interaction.message.embeds[0];
  await interaction.message.edit({
    embeds: [{
      title: '🗺️ Map Veto',
      description: `
**Current Turn:** 👑 <@${currentCaptainId}> (\`${currentCaptainFruit}\`) - **BAN**
**Bans remaining:** ${vetosRemaining}

**Team ${session.captain1Fruit}:**
${session.team1.map((id: string) => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map((id: string) => `<@${id}>`).join(', ')}

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
${session.team1.map((id: string) => `<@${id}>`).join(', ')}

**Team ${session.captain2Fruit}:**
${session.team2.map((id: string) => `<@${id}>`).join(', ')}

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
