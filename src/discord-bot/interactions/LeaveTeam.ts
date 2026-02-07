import {
  ButtonInteraction,
  MessageFlags,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotButtonInteraction(ButtonActions.LeaveTeam)
export default class LeaveTeam extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // Extract team ID from custom ID (format: "leave_team:teamId")
    const [, teamId] = interaction.customId.split(":");

    try {
      // Get team info
      const { teams_by_pk: team } = await this.hasura.query({
        teams_by_pk: {
          __args: {
            id: teamId,
          },
          id: true,
          name: true,
          short_name: true,
          owner: {
            discord_id: true,
            steam_id: true,
          },
        },
      });

      if (!team) {
        await interaction.reply({
          content: "Team not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check if the user is the captain - captain cannot leave
      if (team.owner?.discord_id === interaction.user.id) {
        await interaction.reply({
          content: "You are the captain of this team. You cannot leave. Transfer ownership or delete the team instead.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Get the player's steam_id from their discord_id
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
        },
      });

      const player = players.at(0);

      if (!player) {
        await interaction.reply({
          content: "You need to register your SteamID first using `/steamid`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check if player is actually in this team
      const { team_roster: roster } = await this.hasura.query({
        team_roster: {
          __args: {
            where: {
              team_id: {
                _eq: teamId,
              },
              player_steam_id: {
                _eq: player.steam_id,
              },
            },
          },
          team_id: true,
        },
      });

      if (!roster || roster.length === 0) {
        await interaction.reply({
          content: "You are not a member of this team.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Remove player from the team roster
      await this.hasura.mutation({
        delete_team_roster: {
          __args: {
            where: {
              team_id: {
                _eq: teamId,
              },
              player_steam_id: {
                _eq: player.steam_id,
              },
            },
          },
          affected_rows: true,
        },
      });

      // Remove permission from the private team channel
      const guild = interaction.guild;
      if (guild) {
        const categoryName = `🏆 ${team.short_name}`;
        const category = guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === categoryName,
        );

        if (category) {
          // Find the private team channel
          const teamChannel = guild.channels.cache.find(
            (channel) =>
              channel.type === ChannelType.GuildText &&
              channel.parentId === category.id &&
              channel.name === `💬-${team.short_name.toLowerCase()}`,
          );

          if (teamChannel && teamChannel.type === ChannelType.GuildText) {
            try {
              await teamChannel.permissionOverwrites.delete(interaction.user.id);
              console.log(`Removed ${interaction.user.id} from team channel ${teamChannel.name}`);
            } catch (permError) {
              console.error("Error removing permission from team channel:", permError);
            }
          }
        }
      }

      // Update recruitment embed to show current team members
      await this.updateRecruitmentEmbed(interaction, team);

      await interaction.reply({
        content: `You have left **${team.name}**.`,
        flags: MessageFlags.Ephemeral,
      });

      console.log(`Player ${player.steam_id} left team ${team.name}`);

    } catch (error) {
      console.error("Error leaving team:", error);
      await interaction.reply({
        content: "An error occurred while processing the request.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async updateRecruitmentEmbed(
    interaction: ButtonInteraction,
    team: { id: string; name: string; short_name: string; owner: { discord_id: string } },
  ) {
    try {
      const guild = interaction.guild;
      if (!guild) return;

      const categoryName = `🏆 ${team.short_name}`;
      const category = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory &&
          channel.name === categoryName,
      );

      if (!category) return;

      // Find the recruitment channel
      const recruitChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.parentId === category.id &&
          channel.name === "📢-recruitment",
      );

      if (!recruitChannel || recruitChannel.type !== ChannelType.GuildText) return;

      // Fetch all team members from the database
      const { team_roster: roster } = await this.hasura.query({
        team_roster: {
          __args: {
            where: {
              team_id: {
                _eq: team.id,
              },
            },
          },
          role: true,
          player: {
            name: true,
            discord_id: true,
          },
        },
      });

      // Build member list string
      const membersList = roster
        .map((member) => {
          const playerName = member.player?.discord_id
            ? `<@${member.player.discord_id}>`
            : member.player?.name || "Unknown";
          const roleEmoji = member.role === "Admin" ? "👑" : "👤";
          return `${roleEmoji} ${playerName}`;
        })
        .join("\n");

      // Fetch messages from recruitment channel to find the embed
      const messages = await recruitChannel.messages.fetch({ limit: 10 });
      const embedMessage = messages.find(
        (msg) =>
          msg.author.id === this.bot.client.user.id &&
          msg.embeds.length > 0 &&
          msg.embeds[0].title?.includes(team.name),
      );

      if (!embedMessage) {
        console.warn(`Could not find recruitment embed for team ${team.name}`);
        return;
      }

      // Create updated embed
      const updatedEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🏆 ${team.name}`)
        .setDescription(
          `Welcome to **${team.name}** team!\n\n` +
          `**Short Name:** ${team.short_name}\n` +
          `**Captain:** <@${team.owner.discord_id}>\n\n` +
          `Interested in joining this team? Click the button below to request membership!`,
        )
        .addFields({
          name: `👥 Team Members (${roster.length})`,
          value: membersList || "No members yet",
        })
        .setFooter({ text: "BananaServer.xyz" })
        .setTimestamp();

      // Recreate the buttons
      const joinButton = new ButtonBuilder()
        .setCustomId(`${ButtonActions.JoinTeam}:${team.id}`)
        .setLabel("Join Team")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎮");

      const leaveButton = new ButtonBuilder()
        .setCustomId(`${ButtonActions.LeaveTeam}:${team.id}`)
        .setLabel("Leave Team")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🚪");

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinButton, leaveButton);

      await embedMessage.edit({
        embeds: [updatedEmbed],
        components: [row],
      });

      console.log(`Updated recruitment embed for team ${team.name}`);
    } catch (error) {
      console.error("Error updating recruitment embed:", error);
    }
  }
}
