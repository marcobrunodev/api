import {
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";

interface PlayerTaserStats {
  discord_id: string;
  steam_id: string;
  name: string;
  avatar_url: string | null;
  taser_kills: number;
}

// Weapon name for taser/zeus in CS2 (without weapon_ prefix as stored in DB)
const TASER_WEAPONS = ["taser"];

@BotChatCommand(ChatCommands.RankingTaser)
export default class RankingTaser extends DiscordInteraction {
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
      // Buscar todas as partidas finalizadas do guild para obter os players
      const { matches } = await this.hasura.query({
        matches: {
          __args: {
            where: {
              discord_guild_id: { _eq: guild.id },
              status: { _eq: "Finished" },
            },
          },
          id: true,
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

      // Buscar kills com taser para este guild
      const { player_kills } = await this.hasura.query({
        player_kills: {
          __args: {
            where: {
              match: {
                discord_guild_id: { _eq: guild.id },
                status: { _eq: "Finished" },
              },
              team_kill: { _eq: false },
              is_suicide: { _eq: false },
              with: { _in: TASER_WEAPONS },
            },
          },
          attacker_steam_id: true,
        },
      });

      // Mapear estatisticas por discord_id
      const playerStats = new Map<string, PlayerTaserStats>();

      // Registrar todos os players das partidas
      for (const match of matches) {
        const allPlayers = [
          ...match.lineup_1.lineup_players,
          ...match.lineup_2.lineup_players,
        ];

        for (const lineupPlayer of allPlayers) {
          if (!lineupPlayer.discord_id) continue;

          if (!playerStats.has(lineupPlayer.discord_id)) {
            playerStats.set(lineupPlayer.discord_id, {
              discord_id: lineupPlayer.discord_id,
              steam_id: lineupPlayer.steam_id?.toString() || "",
              name: lineupPlayer.player?.name || "Unknown",
              avatar_url: lineupPlayer.player?.avatar_url || null,
              taser_kills: 0,
            });
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

      // Processar kills com taser
      for (const kill of player_kills) {
        const attackerDiscordId = steamToDiscord.get(kill.attacker_steam_id?.toString());

        if (attackerDiscordId && playerStats.has(attackerDiscordId)) {
          const stats = playerStats.get(attackerDiscordId)!;
          stats.taser_kills++;
        }
      }

      // Sort by taser kills (desc)
      const sortedPlayers = Array.from(playerStats.values())
        .filter(p => p.taser_kills > 0)
        .sort((a, b) => b.taser_kills - a.taser_kills);

      if (sortedPlayers.length === 0) {
        await interaction.editReply({
          content: "No taser kills found for this server. Time to zap some enemies!",
        });
        return;
      }

      // Find the position of the player who executed the command
      const userRankIndex = sortedPlayers.findIndex(p => p.discord_id === userId);
      const userRank = userRankIndex >= 0 ? userRankIndex + 1 : null;
      const userStats = userRankIndex >= 0 ? sortedPlayers[userRankIndex] : null;

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0x00aaff)
        .setTitle(`Ranking de Taser - ${guild.name}`)
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
        description += `**${player.taser_kills}** taser kills\n\n`;
      }

      // If the player is not in the top 10, show their position
      if (userRank && userRank > 10 && userStats) {
        description += `--------------------\n\n`;
        description += `**${userRank}.** <@${userId}> (You)\n`;
        description += `**${userStats.taser_kills}** taser kills\n`;
      } else if (!userRank) {
        description += `--------------------\n\n`;
        description += `You haven't zapped anyone yet. Get those taser kills!\n`;
      }

      embed.setDescription(description);

      // Add total statistics
      const totalTaserKills = sortedPlayers.reduce((sum, p) => sum + p.taser_kills, 0);
      const totalPlayers = sortedPlayers.length;

      embed.addFields({
        name: "Server Statistics",
        value: `**${totalTaserKills}** taser kills | **${totalPlayers}** players with taser kills`,
        inline: false,
      });

      await interaction.editReply({
        embeds: [embed],
      });

    } catch (error) {
      console.error("[RANKING TASER] Error:", error);
      await interaction.editReply({
        content: "An error occurred while fetching the ranking.",
      });
    }
  }
}
