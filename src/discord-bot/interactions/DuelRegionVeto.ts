import {
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";
import {
  getRegionVetoSession,
  banRegion,
  getRegionVetoStatusText,
  DuelRegionVetoSession,
} from "../helpers/duel-region-veto.helper";
import {
  getDuelMaps,
  createVetoSession,
  formatMapName,
} from "../helpers/duel-veto.helper";

@BotButtonInteraction(ButtonActions.DuelVetoRegion)
export default class DuelRegionVeto extends DiscordInteraction {
  public async handler(interaction: ButtonInteraction) {
    const [, messageId, regionId] = interaction.customId.split(":");
    const userId = interaction.user.id;

    const session = getRegionVetoSession(messageId);

    if (!session) {
      await interaction.reply({
        content: "❌ Region veto session not found or expired.",
        ephemeral: true,
      });
      return;
    }

    // Verificar se é a vez do jogador
    if (session.currentTurn !== userId) {
      const isChallengerOrOpponent = userId === session.challengerId || userId === session.opponentId;

      if (isChallengerOrOpponent) {
        await interaction.reply({
          content: `❌ It's not your turn! Wait for <@${session.currentTurn}> to ban.`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `❌ Only the duel participants can ban regions!`,
          ephemeral: true,
        });
      }
      return;
    }

    // Acknowledge silently
    await interaction.deferUpdate();

    // Banir a região
    const result = banRegion(messageId, userId, regionId);

    if (!result.success) {
      await interaction.followUp({
        content: `❌ ${result.error}`,
        ephemeral: true,
      });
      return;
    }

    if (result.finished && result.selectedRegion) {
      // Veto de região finalizado - iniciar veto de mapas
      await this.startMapVeto(interaction, result.session!, result.selectedRegion.name);
    } else {
      // Atualizar mensagem com o novo estado
      await this.updateRegionVetoMessage(interaction, result.session!);
    }
  }

  private async updateRegionVetoMessage(
    interaction: ButtonInteraction,
    session: DuelRegionVetoSession
  ) {
    const availableRegions = session.regions.filter(r => !r.banned);

    // Criar botões apenas para regiões disponíveis
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    for (let i = 0; i < availableRegions.length; i++) {
      const region = availableRegions[i];
      const button = new ButtonBuilder()
        .setCustomId(`${ButtonActions.DuelVetoRegion}:${session.messageId}:${region.id}`)
        .setLabel(region.name)
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🌍");

      currentRow.addComponents(button);

      if ((i + 1) % 5 === 0 || i === availableRegions.length - 1) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xff9900)
      .setTitle("🌍 Region Veto")
      .setDescription(
        `### <@${session.challengerId}>  ⚔️ VS ⚔️  <@${session.opponentId}>\n\n` +
        `**Current Turn:** <@${session.currentTurn}>\n` +
        `**Bans Remaining:** ${session.bansRemaining}\n\n` +
        getRegionVetoStatusText(session) +
        `\n<@${session.currentTurn}>, click a region button to ban it!`
      )
      .setFooter({
        text: "From BananaServer.xyz with 🍌",
      })
      .setTimestamp();

    await interaction.message.edit({
      embeds: [embed],
      components: rows,
    });
  }

  private async startMapVeto(
    interaction: ButtonInteraction,
    session: DuelRegionVetoSession,
    selectedRegion: string
  ) {
    const channel = interaction.channel;
    if (!channel || !("send" in channel)) return;

    // Atualizar mensagem final do veto de região
    const bannedRegionsList = session.regions
      .filter(r => r.banned)
      .map(r => `❌ ~~${r.name}~~ (banned by <@${r.bannedBy}>)`)
      .join("\n");

    const finalRegionEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("🌍 Region Selected!")
      .setDescription(
        `### <@${session.challengerId}>  ⚔️ VS ⚔️  <@${session.opponentId}>\n\n` +
        `**Selected Region:** 🎮 **${selectedRegion}**\n\n` +
        `**Banned Regions:**\n${bannedRegionsList}\n\n` +
        `**Starting map veto...**`
      )
      .setFooter({
        text: "From BananaServer.xyz with 🍌",
      })
      .setTimestamp();

    await interaction.message.edit({
      embeds: [finalRegionEmbed],
      components: [],
    });

    // Buscar mapas de duel
    const maps = await getDuelMaps(this.hasura);

    // Criar embed do veto de mapas
    const vetoEmbed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle("🗺️ Map Veto")
      .setDescription(
        `### <@${session.challengerId}>  ⚔️ VS ⚔️  <@${session.opponentId}>\n\n` +
        `**Selected Region:** 🌍 ${selectedRegion}\n\n` +
        `**Current Turn:** <@${session.challengerId}>\n` +
        `**Bans Remaining:** 3\n\n` +
        "**Available Maps:**\n" +
        maps.map(m => `🗺️ ${formatMapName(m.name)}`).join("\n") +
        `\n\n<@${session.challengerId}>, click a map button to ban it!`
      )
      .setFooter({
        text: "From BananaServer.xyz with 🍌",
      })
      .setTimestamp();

    // Enviar mensagem de veto primeiro
    const vetoMessage = await channel.send({
      embeds: [vetoEmbed],
      components: [],
    });

    // Criar sessão de veto de mapas com a região selecionada
    createVetoSession(
      vetoMessage.id,
      session.channelId,
      session.categoryId,
      session.guildId,
      session.challengerId,
      session.opponentId,
      maps,
      selectedRegion
    );

    // Criar botões para os mapas
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    for (let i = 0; i < maps.length; i++) {
      const map = maps[i];
      const button = new ButtonBuilder()
        .setCustomId(`${ButtonActions.DuelVetoBan}:${vetoMessage.id}:${map.id}`)
        .setLabel(formatMapName(map.name))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🗺️");

      currentRow.addComponents(button);

      if ((i + 1) % 5 === 0 || i === maps.length - 1) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
      }
    }

    // Atualizar mensagem com os botões
    await vetoMessage.edit({
      embeds: [vetoEmbed],
      components: rows,
    });
  }
}
