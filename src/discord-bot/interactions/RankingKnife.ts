import {
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";

interface PlayerKnifeStats {
  discord_id: string;
  steam_id: string;
  name: string;
  avatar_url: string | null;
  knife_kills: number;
}

// Weapon names for knife in CS2 (without weapon_ prefix as stored in DB)
const KNIFE_WEAPONS = [
  "knife",
  "knife_t",
  "bayonet",
  "knife_flip",
  "knife_gut",
  "knife_karambit",
  "knife_m9_bayonet",
  "knife_tactical",
  "knife_falchion",
  "knife_survival_bowie",
  "knife_butterfly",
  "knife_push",
  "knife_cord",
  "knife_canis",
  "knife_ursus",
  "knife_gypsy_jackknife",
  "knife_outdoor",
  "knife_stiletto",
  "knife_widowmaker",
  "knife_skeleton",
  "knife_kukri",
];

@BotChatCommand(ChatCommands.RankingKnife)
export default class RankingKnife extends DiscordInteraction {
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

      // Buscar kills com knife para este guild
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
              with: { _in: KNIFE_WEAPONS },
            },
          },
          attacker_steam_id: true,
        },
      });

      // Mapear estatisticas por discord_id
      const playerStats = new Map<string, PlayerKnifeStats>();

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
              knife_kills: 0,
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

      // Processar kills com knife
      for (const kill of player_kills) {
        const attackerDiscordId = steamToDiscord.get(kill.attacker_steam_id?.toString());

        if (attackerDiscordId && playerStats.has(attackerDiscordId)) {
          const stats = playerStats.get(attackerDiscordId)!;
          stats.knife_kills++;
        }
      }

      // Sort by knife kills (desc)
      const sortedPlayers = Array.from(playerStats.values())
        .filter(p => p.knife_kills > 0)
        .sort((a, b) => b.knife_kills - a.knife_kills);

      if (sortedPlayers.length === 0) {
        await interaction.editReply({
          content: "No knife kills found for this server. Time to humiliate some enemies!",
        });
        return;
      }

      // Find the position of the player who executed the command
      const userRankIndex = sortedPlayers.findIndex(p => p.discord_id === userId);
      const userRank = userRankIndex >= 0 ? userRankIndex + 1 : null;
      const userStats = userRankIndex >= 0 ? sortedPlayers[userRankIndex] : null;

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle(`Ranking de Facadas - ${guild.name}`)
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
        description += `**${player.knife_kills}** knife kills\n\n`;
      }

      // If the player is not in the top 10, show their position
      if (userRank && userRank > 10 && userStats) {
        description += `--------------------\n\n`;
        description += `**${userRank}.** <@${userId}> (You)\n`;
        description += `**${userStats.knife_kills}** knife kills\n`;
      } else if (!userRank) {
        description += `--------------------\n\n`;
        description += `You haven't knifed anyone yet. Get those knife kills!\n`;
      }

      embed.setDescription(description);

      // Add total statistics
      const totalKnifeKills = sortedPlayers.reduce((sum, p) => sum + p.knife_kills, 0);
      const totalPlayers = sortedPlayers.length;

      embed.addFields({
        name: "Server Statistics",
        value: `**${totalKnifeKills}** knife kills | **${totalPlayers}** players with knife kills`,
        inline: false,
      });

      await interaction.editReply({
        embeds: [embed],
      });

    } catch (error) {
      console.error("[RANKING KNIFE] Error:", error);
      await interaction.editReply({
        content: "An error occurred while fetching the ranking.",
      });
    }
  }
}
