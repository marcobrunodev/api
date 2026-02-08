import {
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";

@BotChatCommand(ChatCommands.Migrate)
export default class Migrate extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "This command can only be used in a server.",
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Get all players with both discord_id and steam_id configured
      const { players } = await this.hasura.query({
        players: {
          __args: {
            where: {
              discord_id: { _is_null: false },
              steam_id: { _is_null: false },
            },
            order_by: [{ name: "asc" }],
          },
          steam_id: true,
          discord_id: true,
          name: true,
        },
      });

      if (players.length === 0) {
        await interaction.editReply({
          content: "No players found with both Steam ID and Discord linked.",
        });
        return;
      }

      // Find the @banana-mix role
      const bananaMixRole = guild.roles.cache.find(
        (role) => role.name === "banana-mix"
      );

      if (!bananaMixRole) {
        await interaction.editReply({
          content: "Role @banana-mix not found. Run /init first to create it.",
        });
        return;
      }

      // Add role to all players and build the player list
      let rolesAdded = 0;
      let rolesAlreadyHad = 0;
      let notInGuild = 0;

      const playerList: string[] = [];

      for (let index = 0; index < players.length; index++) {
        const player = players[index];
        let status = "";

        try {
          const member = await guild.members.fetch(player.discord_id);

          if (member.roles.cache.has(bananaMixRole.id)) {
            status = "✅";
            rolesAlreadyHad++;
          } else {
            await member.roles.add(bananaMixRole);
            status = "🆕";
            rolesAdded++;
          }
        } catch {
          status = "❌";
          notInGuild++;
        }

        playerList.push(
          `${status} **${index + 1}.** <@${player.discord_id}> - \`${player.steam_id}\``
        );
      }

      // Split into chunks if too long (Discord has 4096 char limit for embed description)
      const chunks: string[][] = [];
      let currentChunk: string[] = [];
      let currentLength = 0;

      for (const line of playerList) {
        if (currentLength + line.length + 1 > 3500) {
          chunks.push(currentChunk);
          currentChunk = [line];
          currentLength = line.length;
        } else {
          currentChunk.push(line);
          currentLength += line.length + 1;
        }
      }
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }

      // Create embed for first chunk
      const embed = new EmbedBuilder()
        .setColor(0xf5a623)
        .setTitle("Migration - @banana-mix Role Assignment")
        .setDescription(chunks[0].join("\n"))
        .addFields({
          name: "Summary",
          value: `🆕 Added: ${rolesAdded}\n✅ Already had: ${rolesAlreadyHad}\n❌ Not in server: ${notInGuild}`,
        })
        .setFooter({
          text: `Total: ${players.length} players | BananaServer.xyz`,
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
      });

      // Send additional embeds if there are more chunks
      for (let i = 1; i < chunks.length; i++) {
        const additionalEmbed = new EmbedBuilder()
          .setColor(0xf5a623)
          .setDescription(chunks[i].join("\n"));

        await interaction.followUp({
          embeds: [additionalEmbed],
          flags: MessageFlags.Ephemeral,
        });
      }

    } catch (error) {
      console.error("Error in /migrate command:", error);
      await interaction.editReply({
        content: "An error occurred while fetching players.",
      });
    }
  }
}
