import {
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";

@BotChatCommand(ChatCommands.Bananas)
export default class Bananas extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Get the player by discord_id
      const { players } = await this.hasura.query({
        players: {
          __args: {
            where: {
              discord_id: {
                _eq: interaction.user.id,
              },
            },
          },
          steam_id: true,
          name: true,
          total_bananas: true,
          bananas: {
            __args: {
              order_by: [{ created_at: "desc" }],
              limit: 5,
            },
            amount: true,
            breakdown: true,
            created_at: true,
            match: {
              id: true,
              options: {
                type: true,
              },
            },
          },
        },
      });

      const player = players.at(0);

      if (!player) {
        await interaction.editReply({
          content: "You need to register your SteamID first. Use `/steamid` to register.",
        });
        return;
      }

      const totalBananas = player.total_bananas || 0;

      const embed = new EmbedBuilder()
        .setColor(0xf5a623)
        .setTitle("🍌 Your Bananas")
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .setDescription(
          `**${player.name}**, you have **${totalBananas}** 🍌 bananas!`,
        )
        .setFooter({ text: "BananaServer.xyz" })
        .setTimestamp();

      // Show last 5 matches breakdown
      if (player.bananas && player.bananas.length > 0) {
        const historyLines = player.bananas.map((entry) => {
          const breakdown = entry.breakdown || {};
          const parts: string[] = [];

          if (breakdown.participated) parts.push(`+${breakdown.participated} participated`);
          if (breakdown.win) parts.push(`+${breakdown.win} win`);
          if (breakdown.knife_kills) parts.push(`+${breakdown.knife_kills} knife`);
          if (breakdown.taser_kills) parts.push(`+${breakdown.taser_kills} taser`);
          if (breakdown.mvp) parts.push(`+${breakdown.mvp} mvp`);
          if (breakdown.most_damage) parts.push(`+${breakdown.most_damage} top dmg`);
          if (breakdown.most_utility_damage) parts.push(`+${breakdown.most_utility_damage} top util`);
          if (breakdown.headshot_rate) parts.push(`+${breakdown.headshot_rate} hs rate`);
          if (breakdown.aces) parts.push(`+${breakdown.aces} ace`);
          if (breakdown.clutches) parts.push(`+${breakdown.clutches} clutch`);
          if (breakdown.team_damage) parts.push(`${breakdown.team_damage} team dmg`);
          if (breakdown.team_kills) parts.push(`${breakdown.team_kills} tk`);

          const matchType = entry.match?.options?.type || "Match";
          const isTournament = breakdown.tournament_multiplier ? " 🏆x2" : "";
          const sign = entry.amount >= 0 ? "+" : "";

          return `**${sign}${entry.amount}** 🍌 (${matchType}${isTournament})\n┗ ${parts.join(" • ") || "participation"}`;
        });

        embed.addFields({
          name: "📜 Last Matches",
          value: historyLines.join("\n\n"),
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Error fetching bananas:", error);
      await interaction.editReply({
        content: "An error occurred while fetching your bananas.",
      });
    }
  }
}
