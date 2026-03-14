import {
  ButtonInteraction,
  MessageFlags,
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotButtonInteraction(ButtonActions.AcceptTeamMember)
export default class AcceptTeamMember extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // Extract team ID and player ID from custom ID (format: "accept_team_member:teamId:playerId")
    const [, teamId, discordPlayerId] = interaction.customId.split(":");

    try {
      // Get team info to check if the user clicking is the captain
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
          },
        },
      });

      if (!team) {
        await interaction.reply({
          content: "❌ Team not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check if the user clicking is the captain
      if (team.owner?.discord_id !== interaction.user.id) {
        await interaction.reply({
          content: "❌ Only the team captain can accept join requests.",
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
                _eq: discordPlayerId,
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
          content: "❌ Player not found. They may need to register their SteamID first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check if player is already in a team
      const { team_roster: existingRoster } = await this.hasura.query({
        team_roster: {
          __args: {
            where: {
              player_steam_id: {
                _eq: player.steam_id,
              },
            },
          },
          team_id: true,
        },
      });

      if (existingRoster && existingRoster.length > 0) {
        await interaction.reply({
          content: "❌ This player is already a member of a team.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Add player to the team roster
      await this.hasura.mutation({
        insert_team_roster_one: {
          __args: {
            object: {
              team_id: teamId,
              player_steam_id: player.steam_id,
              role: "Member",
            },
          },
          team_id: true,
        },
      });

      // Acknowledge the interaction
      await interaction.deferUpdate();

      // Delete the join request message
      try {
        await interaction.message.delete();
      } catch (deleteError) {
        console.error("Error deleting join request message:", deleteError);
      }

      // Add permissions to the team category and private channel
      const guild = interaction.guild;
      if (guild) {
        const categoryName = `🏆 ${team.short_name}`;
        const category = guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === categoryName,
        );

        if (category && category.type === ChannelType.GuildCategory) {
          // Add permission to the category
          try {
            await category.permissionOverwrites.edit(discordPlayerId, {
              ViewChannel: true,
              SendMessages: true,
            });
            console.log(`Added ${discordPlayerId} to team category ${category.name}`);
          } catch (permError) {
            console.error("Error adding permission to team category:", permError);
          }

          // Find the private team channel
          const teamChannel = guild.channels.cache.find(
            (channel) =>
              channel.type === ChannelType.GuildText &&
              channel.parentId === category.id &&
              channel.name === `💬-${team.short_name.toLowerCase()}`,
          );

          if (teamChannel && teamChannel.type === ChannelType.GuildText) {
            try {
              await teamChannel.permissionOverwrites.edit(discordPlayerId, {
                ViewChannel: true,
                SendMessages: true,
              });
              console.log(`Added ${discordPlayerId} to team channel ${teamChannel.name}`);
            } catch (permError) {
              console.error("Error adding permission to team channel:", permError);
            }
          }

          // Find the voice channel
          const voiceChannel = guild.channels.cache.find(
            (channel) =>
              channel.type === ChannelType.GuildVoice &&
              channel.parentId === category.id &&
              channel.name === `🔊-playing`,
          );

          if (voiceChannel && voiceChannel.type === ChannelType.GuildVoice) {
            try {
              await voiceChannel.permissionOverwrites.edit(discordPlayerId, {
                ViewChannel: true,
                Connect: true,
                Speak: true,
              });
              console.log(`Added ${discordPlayerId} to voice channel ${voiceChannel.name}`);
            } catch (permError) {
              console.error("Error adding permission to voice channel:", permError);
            }
          }
        }
      }

      // Try to send a DM to the player who was accepted
      try {
        const acceptedUser = await interaction.client.users.fetch(discordPlayerId);
        await acceptedUser.send({
          content: `🎉 Congratulations! You have been accepted into **${team.name}**!\n\n` +
            `You now have access to the team's private channel.\n\n` +
            `_This message is only visible to you._`,
        });
      } catch (dmError) {
        console.warn(`Could not send DM to accepted player ${discordPlayerId}:`, dmError);
      }

      // Update recruitment embed to show current team members
      await this.updateRecruitmentEmbed(interaction, team);

      console.log(`Player ${player.steam_id} was added to team ${team.name}`);

    } catch (error) {
      console.error("Error accepting team member:", error);
      await interaction.reply({
        content: "❌ An error occurred while processing the request.",
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
      const messages = await recruitChannel.messages.fetch({ limit: 50 });
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
