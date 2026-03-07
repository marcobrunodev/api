import {
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";

interface PlayerMvpStats {
  discord_id: string;
  steam_id: string;
  name: string;
  avatar_url: string | null;
  mvp_count: number;
}

@BotChatCommand(ChatCommands.RankingMvp)
export default class RankingMvp extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "This command can only be used in a server.",
      });
      return;
    }

    await interaction.deferReply();

    try {
      // Buscar todas as partidas finalizadas do guild com match_maps que têm MVP
      const { matches } = await this.hasura.query({
        matches: {
          __args: {
            where: {
              discord_guild_id: { _eq: guild.id },
              status: { _eq: "Finished" },
            },
          },
          id: true,
          match_maps: {
            mvp_steam_id: true,
          },
          lineup_1: {
            lineup_players: {
              discord_id: true,
              steam_id: true,
              player: {
                name: true,
                avatar_url: true,
              },
            },
          },
          lineup_2: {
            lineup_players: {
              discord_id: true,
              steam_id: true,
              player: {
                name: true,
                avatar_url: true,
              },
            },
          },
        },
      });

      // Mapear estatísticas por discord_id
      const playerStats = new Map<string, PlayerMvpStats>();

      // Criar map de steam_id para discord_id e registrar todos os players
      const steamToDiscord = new Map<string, string>();

      for (const match of matches) {
        const allPlayers = [
          ...match.lineup_1.lineup_players,
          ...match.lineup_2.lineup_players,
        ];

        for (const lineupPlayer of allPlayers) {
          if (!lineupPlayer.discord_id) continue;

          const steamId = lineupPlayer.steam_id?.toString() || "";

          if (steamId) {
            steamToDiscord.set(steamId, lineupPlayer.discord_id);
          }

          if (!playerStats.has(lineupPlayer.discord_id)) {
            playerStats.set(lineupPlayer.discord_id, {
              discord_id: lineupPlayer.discord_id,
              steam_id: steamId,
              name: lineupPlayer.player?.name || "Unknown",
              avatar_url: lineupPlayer.player?.avatar_url || null,
              mvp_count: 0,
            });
          }
        }
      }

      // Contar MVPs por jogador
      for (const match of matches) {
        for (const matchMap of match.match_maps) {
          if (!matchMap.mvp_steam_id) continue;

          const mvpSteamId = matchMap.mvp_steam_id.toString();
          const discordId = steamToDiscord.get(mvpSteamId);

          if (discordId && playerStats.has(discordId)) {
            const stats = playerStats.get(discordId)!;
            stats.mvp_count++;
          }
        }
      }

      // Ordenar por número de MVPs (desc)
      const sortedPlayers = Array.from(playerStats.values())
        .filter(p => p.mvp_count > 0)
        .sort((a, b) => b.mvp_count - a.mvp_count);

      if (sortedPlayers.length === 0) {
        await interaction.editReply({
          content: "No MVP awards found for this server. Play some matches to earn MVP!",
        });
        return;
      }

      // Encontrar a posição do jogador que executou o comando
      const userRankIndex = sortedPlayers.findIndex(p => p.discord_id === userId);
      const userRank = userRankIndex >= 0 ? userRankIndex + 1 : null;
      const userStats = userRankIndex >= 0 ? sortedPlayers[userRankIndex] : null;

      // Criar embed
      const embed = new EmbedBuilder()
        .setColor(0xffd700) // Cor dourada para MVP
        .setTitle(`Ranking de MVP - ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
        .setFooter({
          text: "BananaServer.xyz",
          iconURL: guild.iconURL() ?? undefined,
        })
        .setTimestamp();

      // Top 10
      const top10 = sortedPlayers.slice(0, 10);
      let description = "";

      const medals = ["1.", "2.", "3."];
      for (let i = 0; i < top10.length; i++) {
        const player = top10[i];
        const position = i + 1;
        const medal = medals[i] || `**${position}.**`;

        description += `${medal} <@${player.discord_id}>\n`;
        description += `**${player.mvp_count}** MVP${player.mvp_count > 1 ? 's' : ''}\n\n`;
      }

      // Se o jogador não está no top 10, mostrar sua posição
      if (userRank && userRank > 10 && userStats) {
        description += `--------------------\n\n`;
        description += `**${userRank}.** <@${userId}> (You)\n`;
        description += `**${userStats.mvp_count}** MVP${userStats.mvp_count > 1 ? 's' : ''}\n`;
      } else if (!userRank) {
        description += `--------------------\n\n`;
        description += `You haven't earned any MVP awards yet. Keep playing!\n`;
      }

      embed.setDescription(description);

      // Adicionar estatísticas totais
      const totalMvps = sortedPlayers.reduce((sum, p) => sum + p.mvp_count, 0);
      const totalPlayers = sortedPlayers.length;

      embed.addFields({
        name: "Server Statistics",
        value: `**${totalMvps}** MVP awards | **${totalPlayers}** players with MVP`,
        inline: false,
      });

      await interaction.editReply({
        embeds: [embed],
      });

    } catch (error) {
      console.error("[RANKING MVP] Error:", error);
      await interaction.editReply({
        content: "An error occurred while fetching the ranking.",
      });
    }
  }
}
