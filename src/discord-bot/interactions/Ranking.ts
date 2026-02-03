import {
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";

interface PlayerRankingStats {
  discord_id: string;
  steam_id: string;
  name: string;
  avatar_url: string | null;
  wins: number;
  losses: number;
  matches_played: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
}

@BotChatCommand(ChatCommands.Ranking)
export default class Ranking extends DiscordInteraction {
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
      const matchType = interaction.options.getString("type") || "all";
      
      // Buscar todas as partidas finalizadas do guild com lineups e players
      const { matches } = await this.hasura.query({
        matches: {
          __args: {
            where: {
              discord_guild_id: { _eq: guild.id },
              status: { _eq: "Finished" },
              winning_lineup_id: { _is_null: false },
              ...(matchType !== "all" && {
                options: {
                  type: { _eq: matchType === "mix" ? "Competitive" : "Duel" }
                }
              })
            },
          },
          id: true,
          winning_lineup_id: true,
          lineup_1_id: true,
          lineup_2_id: true,
          options: {
            type: true,
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

      // Buscar kills, deaths e assists agregados por player para este guild
      const { player_kills, player_assists } = await this.hasura.query({
        player_kills: {
          __args: {
            where: {
              match: {
                discord_guild_id: { _eq: guild.id },
                status: { _eq: "Finished" },
                ...(matchType !== "all" && {
                  options: {
                    type: { _eq: matchType === "mix" ? "Competitive" : "Duel" }
                  }
                })
              },
              team_kill: { _eq: false },
              is_suicide: { _eq: false },
            },
          },
          attacker_steam_id: true,
          attacked_steam_id: true,
        },
        player_assists: {
          __args: {
            where: {
              match: {
                discord_guild_id: { _eq: guild.id },
                status: { _eq: "Finished" },
                ...(matchType !== "all" && {
                  options: {
                    type: { _eq: matchType === "mix" ? "Competitive" : "Duel" }
                  }
                })
              },
              is_team_assist: { _eq: false },
            },
          },
          attacker_steam_id: true,
        },
      });

      // Mapear estatísticas por discord_id
      const playerStats = new Map<string, PlayerRankingStats>();

      // Processar vitórias e derrotas
      for (const match of matches) {
        const allPlayers = [
          ...match.lineup_1.lineup_players.map(p => ({ ...p, lineup_id: match.lineup_1_id })),
          ...match.lineup_2.lineup_players.map(p => ({ ...p, lineup_id: match.lineup_2_id })),
        ];

        for (const lineupPlayer of allPlayers) {
          if (!lineupPlayer.discord_id) continue;

          if (!playerStats.has(lineupPlayer.discord_id)) {
            playerStats.set(lineupPlayer.discord_id, {
              discord_id: lineupPlayer.discord_id,
              steam_id: lineupPlayer.steam_id?.toString() || "",
              name: lineupPlayer.player?.name || "Unknown",
              avatar_url: lineupPlayer.player?.avatar_url || null,
              wins: 0,
              losses: 0,
              matches_played: 0,
              kills: 0,
              deaths: 0,
              assists: 0,
              kd: 0,
            });
          }

          const stats = playerStats.get(lineupPlayer.discord_id)!;
          stats.matches_played++;

          if (lineupPlayer.lineup_id === match.winning_lineup_id) {
            stats.wins++;
          } else {
            stats.losses++;
          }
        }
      }

      // Criar map de steam_id para discord_id
      const steamToDiscord = new Map<string, string>();
      for (const [discordId, stats] of playerStats) {
        if (stats.steam_id) {
          steamToDiscord.set(stats.steam_id, discordId);
        }
      }

      // Processar kills
      for (const kill of player_kills) {
        const attackerDiscordId = steamToDiscord.get(kill.attacker_steam_id?.toString());
        const attackedDiscordId = steamToDiscord.get(kill.attacked_steam_id?.toString());

        if (attackerDiscordId && playerStats.has(attackerDiscordId)) {
          playerStats.get(attackerDiscordId)!.kills++;
        }
        if (attackedDiscordId && playerStats.has(attackedDiscordId)) {
          playerStats.get(attackedDiscordId)!.deaths++;
        }
      }

      // Processar assists
      for (const assist of player_assists) {
        const attackerDiscordId = steamToDiscord.get(assist.attacker_steam_id?.toString());
        if (attackerDiscordId && playerStats.has(attackerDiscordId)) {
          playerStats.get(attackerDiscordId)!.assists++;
        }
      }

      // Calcular K/D
      for (const stats of playerStats.values()) {
        stats.kd = stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills;
      }

      // Ordenar: vitórias (desc), K/D (desc), assists (desc)
      const sortedPlayers = Array.from(playerStats.values())
        .filter(p => p.matches_played > 0)
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.kd !== a.kd) return b.kd - a.kd;
          return b.assists - a.assists;
        });

      if (sortedPlayers.length === 0) {
        await interaction.editReply({
          content: "No matches found for this server.",
        });
        return;
      }

      // Encontrar posição do jogador que executou o comando
      const userRankIndex = sortedPlayers.findIndex(p => p.discord_id === userId);
      const userRank = userRankIndex >= 0 ? userRankIndex + 1 : null;
      const userStats = userRankIndex >= 0 ? sortedPlayers[userRankIndex] : null;

      // Criar embed
      const typeLabel = matchType === "all" ? "Mix & Duel" : matchType === "mix" ? "Mix" : "Duel";
      const embed = new EmbedBuilder()
        .setColor(0xf5a623)
        .setTitle(`🏆 Ranking ${typeLabel} - ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
        .setFooter({
          text: "BananaServer.xyz",
          iconURL: guild.iconURL() ?? undefined,
        })
        .setTimestamp();

      // Top 10
      const top10 = sortedPlayers.slice(0, 10);
      let description = "";

      const medals = ["🥇", "🥈", "🥉"];
      for (let i = 0; i < top10.length; i++) {
        const player = top10[i];
        const position = i + 1;
        const medal = medals[i] || `**${position}.**`;
        const winRate = player.matches_played > 0 
          ? ((player.wins / player.matches_played) * 100).toFixed(0) 
          : "0";
        
        description += `${medal} <@${player.discord_id}>\n`;
        description += `┗ 🏆 ${player.wins}W/${player.losses}L (${winRate}%) • `;
        description += `⚔️ ${player.kd.toFixed(2)} K/D • `;
        description += `🎯 ${player.kills}K/${player.deaths}D/${player.assists}A\n\n`;
      }

      // Se o jogador não está no top 10, mostrar sua posição
      if (userRank && userRank > 10 && userStats) {
        description += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        description += `**${userRank}.** <@${userId}> (Você)\n`;
        const winRate = userStats.matches_played > 0 
          ? ((userStats.wins / userStats.matches_played) * 100).toFixed(0) 
          : "0";
        description += `┗ 🏆 ${userStats.wins}W/${userStats.losses}L (${winRate}%) • `;
        description += `⚔️ ${userStats.kd.toFixed(2)} K/D • `;
        description += `🎯 ${userStats.kills}K/${userStats.deaths}D/${userStats.assists}A\n`;
      } else if (!userRank) {
        description += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        description += `Você ainda não jogou nenhuma partida.\n`;
      }

      embed.setDescription(description);

      // Adicionar estatísticas gerais
      const totalMatches = matches.length;
      const totalPlayers = sortedPlayers.length;
      embed.addFields({
        name: "📊 Estatísticas do Servidor",
        value: `**${totalMatches}** partidas finalizadas • **${totalPlayers}** jogadores`,
        inline: false,
      });

      await interaction.editReply({
        embeds: [embed],
      });

    } catch (error) {
      console.error("❌ [RANKING] Error:", error);
      await interaction.editReply({
        content: "An error occurred while fetching the ranking.",
      });
    }
  }
}
