import {
  ChatInputCommandInteraction,
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import { ChatCommands } from "../enums/ChatCommands";
import { ButtonActions } from "../enums/ButtonActions";

@BotChatCommand(ChatCommands.FixTeams)
export default class FixTeams extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    // Fetch all teams from the database
    const { teams } = await this.hasura.query({
      teams: {
        id: true,
        name: true,
        short_name: true,
        owner: {
          discord_id: true,
          steam_id: true,
        },
        roster: {
          role: true,
          player: {
            name: true,
            discord_id: true,
            steam_id: true,
          },
        },
      },
    });

    if (!teams || teams.length === 0) {
      await interaction.editReply({
        content: "No teams found in the database.",
      });
      return;
    }

    const logs: string[] = [];
    let fixedCount = 0;

    for (const team of teams) {
      const categoryName = `🏆 ${team.short_name}`;
      const ownerDiscordId = team.owner?.discord_id;

      if (!ownerDiscordId) {
        logs.push(`⚠️ **${team.name}** - Owner has no Discord ID, skipping.`);
        continue;
      }

      // 1. Find existing category (skip if not found - team may not belong to this guild)
      const category = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory &&
          channel.name === categoryName,
      );

      if (!category || category.type !== ChannelType.GuildCategory) {
        logs.push(`⏭️ **${team.name}** - Category not found, skipping.`);
        continue;
      }

      // Get roster member discord IDs (excluding owner)
      const memberDiscordIds = team.roster
        .filter((r) => r.player?.discord_id && r.player.discord_id !== ownerDiscordId)
        .map((r) => r.player.discord_id);

      // Fix category permissions
      try {
        await category.permissionOverwrites.edit(guild.id, {
          ViewChannel: true,
          SendMessages: false,
        });
        await category.permissionOverwrites.edit(ownerDiscordId, {
          ViewChannel: true,
          SendMessages: true,
          ManageChannels: true,
        });
        await category.permissionOverwrites.edit(this.bot.client.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ManageChannels: true,
        });
        for (const memberId of memberDiscordIds) {
          await category.permissionOverwrites.edit(memberId, {
            ViewChannel: true,
            SendMessages: true,
          });
        }
        fixedCount++;
      } catch (error) {
        logs.push(`⚠️ **${team.name}** - Failed to fix category permissions: ${error.message}`);
      }

      // 2. Check/create recruitment channel
      let recruitChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.parentId === category.id &&
          channel.name === "📢-recruitment",
      );

      if (!recruitChannel) {
        try {
          recruitChannel = await guild.channels.create({
            name: "📢-recruitment",
            type: ChannelType.GuildText,
            parent: category.id,
          });

          // Set permissions individually
          await recruitChannel.permissionOverwrites.edit(guild.id, {
            ViewChannel: true,
            SendMessages: false,
          });
          await recruitChannel.permissionOverwrites.edit(ownerDiscordId, {
            ViewChannel: true,
            SendMessages: true,
          });
          await recruitChannel.permissionOverwrites.edit(this.bot.client.user.id, {
            ViewChannel: true,
            SendMessages: true,
          });

          await this.sendRecruitmentEmbed(recruitChannel, team);
          logs.push(`✅ **${team.name}** - Created recruitment channel.`);
          fixedCount++;
        } catch (error) {
          logs.push(`❌ **${team.name}** - Failed to create recruitment channel: ${error.message}`);
        }
      } else {
        if (recruitChannel.type === ChannelType.GuildText) {
          try {
            await recruitChannel.permissionOverwrites.edit(guild.id, {
              ViewChannel: true,
              SendMessages: false,
            });
            await recruitChannel.permissionOverwrites.edit(ownerDiscordId, {
              ViewChannel: true,
              SendMessages: true,
            });
            await recruitChannel.permissionOverwrites.edit(this.bot.client.user.id, {
              ViewChannel: true,
              SendMessages: true,
            });
            fixedCount++;
          } catch (error) {
            logs.push(`⚠️ **${team.name}** - Failed to fix recruitment permissions: ${error.message}`);
          }

          // Check if recruitment embed exists
          try {
            const messages = await recruitChannel.messages.fetch({ limit: 50 });
            const embedMessage = messages.find(
              (msg) =>
                msg.author.id === this.bot.client.user.id &&
                msg.embeds.length > 0 &&
                msg.embeds[0].title?.includes(team.name),
            );

            if (!embedMessage) {
              await this.sendRecruitmentEmbed(recruitChannel, team);
              logs.push(`✅ **${team.name}** - Created missing recruitment embed.`);
              fixedCount++;
            } else {
              await this.updateRecruitmentEmbed(embedMessage, team);
              logs.push(`🔄 **${team.name}** - Updated recruitment embed.`);
            }
          } catch (error) {
            logs.push(`⚠️ **${team.name}** - Failed to check/update recruitment embed: ${error.message}`);
          }
        }
      }

      // 3. Check/create private team channel
      const privateChannelName = `💬-${team.short_name.toLowerCase()}`;
      let teamChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.parentId === category.id &&
          channel.name === privateChannelName,
      );

      if (!teamChannel) {
        try {
          teamChannel = await guild.channels.create({
            name: privateChannelName,
            type: ChannelType.GuildText,
            parent: category.id,
          });

          await teamChannel.permissionOverwrites.edit(guild.id, {
            ViewChannel: false,
            SendMessages: false,
          });
          await teamChannel.permissionOverwrites.edit(ownerDiscordId, {
            ViewChannel: true,
            SendMessages: true,
            ManageMessages: true,
          });
          await teamChannel.permissionOverwrites.edit(this.bot.client.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ManageMessages: true,
            ManageChannels: true,
          });
          for (const memberId of memberDiscordIds) {
            await teamChannel.permissionOverwrites.edit(memberId, {
              ViewChannel: true,
              SendMessages: true,
            });
          }

          const adminRole = guild.roles.cache.find(
            (role) => role.permissions.has(PermissionsBitField.Flags.Administrator),
          );
          if (adminRole) {
            await teamChannel.permissionOverwrites.edit(adminRole.id, {
              ViewChannel: true,
              SendMessages: true,
              ManageMessages: true,
            });
          }

          logs.push(`✅ **${team.name}** - Created private channel.`);
          fixedCount++;
        } catch (error) {
          logs.push(`❌ **${team.name}** - Failed to create private channel: ${error.message}`);
        }
      } else {
        if (teamChannel.type === ChannelType.GuildText) {
          try {
            await teamChannel.permissionOverwrites.edit(guild.id, {
              ViewChannel: false,
              SendMessages: false,
            });
            await teamChannel.permissionOverwrites.edit(ownerDiscordId, {
              ViewChannel: true,
              SendMessages: true,
              ManageMessages: true,
            });
            await teamChannel.permissionOverwrites.edit(this.bot.client.user.id, {
              ViewChannel: true,
              SendMessages: true,
              ManageMessages: true,
              ManageChannels: true,
            });
            for (const memberId of memberDiscordIds) {
              await teamChannel.permissionOverwrites.edit(memberId, {
                ViewChannel: true,
                SendMessages: true,
              });
            }

            const adminRole = guild.roles.cache.find(
              (role) => role.permissions.has(PermissionsBitField.Flags.Administrator),
            );
            if (adminRole) {
              await teamChannel.permissionOverwrites.edit(adminRole.id, {
                ViewChannel: true,
                SendMessages: true,
                ManageMessages: true,
              });
            }

            fixedCount++;
          } catch (error) {
            logs.push(`⚠️ **${team.name}** - Failed to fix private channel permissions: ${error.message}`);
          }
        }
      }

      // 4. Check/create voice channel
      let voiceChannel = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildVoice &&
          channel.parentId === category.id &&
          channel.name === "🔊-playing",
      );

      if (!voiceChannel) {
        try {
          voiceChannel = await guild.channels.create({
            name: "🔊-playing",
            type: ChannelType.GuildVoice,
            parent: category.id,
          });

          await voiceChannel.permissionOverwrites.edit(guild.id, {
            ViewChannel: true,
            Connect: false,
            Speak: false,
          });
          await voiceChannel.permissionOverwrites.edit(ownerDiscordId, {
            ViewChannel: true,
            Connect: true,
            Speak: true,
          });
          await voiceChannel.permissionOverwrites.edit(this.bot.client.user.id, {
            ViewChannel: true,
            Connect: true,
            Speak: true,
            ManageChannels: true,
          });
          for (const memberId of memberDiscordIds) {
            await voiceChannel.permissionOverwrites.edit(memberId, {
              ViewChannel: true,
              Connect: true,
              Speak: true,
            });
          }

          logs.push(`✅ **${team.name}** - Created voice channel.`);
          fixedCount++;
        } catch (error) {
          logs.push(`❌ **${team.name}** - Failed to create voice channel: ${error.message}`);
        }
      } else {
        if (voiceChannel.type === ChannelType.GuildVoice) {
          try {
            await voiceChannel.permissionOverwrites.edit(guild.id, {
              ViewChannel: true,
              Connect: false,
              Speak: false,
            });
            await voiceChannel.permissionOverwrites.edit(ownerDiscordId, {
              ViewChannel: true,
              Connect: true,
              Speak: true,
            });
            await voiceChannel.permissionOverwrites.edit(this.bot.client.user.id, {
              ViewChannel: true,
              Connect: true,
              Speak: true,
              ManageChannels: true,
            });
            for (const memberId of memberDiscordIds) {
              await voiceChannel.permissionOverwrites.edit(memberId, {
                ViewChannel: true,
                Connect: true,
                Speak: true,
              });
            }

            fixedCount++;
          } catch (error) {
            logs.push(`⚠️ **${team.name}** - Failed to fix voice channel permissions: ${error.message}`);
          }
        }
      }

      logs.push(`🔧 **${team.name}** - Verification complete.`);
    }

    // Send result
    const embed = new EmbedBuilder()
      .setColor(fixedCount > 0 ? 0x00ff00 : 0x5865f2)
      .setTitle("🔧 Fix Teams Report")
      .setDescription(
        `Checked **${teams.length}** teams. Fixed **${fixedCount}** issues.\n\n` +
        logs.join("\n"),
      )
      .setFooter({ text: "BananaServer.xyz" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  private async sendRecruitmentEmbed(
    channel: any,
    team: { id: string; name: string; short_name: string; owner: { discord_id: string }; roster: any[] },
  ) {
    const membersList = team.roster
      .map((member) => {
        const playerName = member.player?.discord_id
          ? `<@${member.player.discord_id}>`
          : member.player?.name || "Unknown";
        const roleEmoji = member.role === "Admin" ? "👑" : "👤";
        return `${roleEmoji} ${playerName}`;
      })
      .join("\n");

    const teamEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🏆 ${team.name}`)
      .setDescription(
        `Welcome to **${team.name}** team!\n\n` +
        `**Short Name:** ${team.short_name}\n` +
        `**Captain:** <@${team.owner.discord_id}>\n\n` +
        `Interested in joining this team? Click the button below to request membership!`,
      )
      .addFields({
        name: `👥 Team Members (${team.roster.length})`,
        value: membersList || "No members yet",
      })
      .setFooter({ text: "BananaServer.xyz" })
      .setTimestamp();

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

    await channel.send({
      embeds: [teamEmbed],
      components: [row],
    });
  }

  private async updateRecruitmentEmbed(
    message: any,
    team: { id: string; name: string; short_name: string; owner: { discord_id: string }; roster: any[] },
  ) {
    const membersList = team.roster
      .map((member) => {
        const playerName = member.player?.discord_id
          ? `<@${member.player.discord_id}>`
          : member.player?.name || "Unknown";
        const roleEmoji = member.role === "Admin" ? "👑" : "👤";
        return `${roleEmoji} ${playerName}`;
      })
      .join("\n");

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
        name: `👥 Team Members (${team.roster.length})`,
        value: membersList || "No members yet",
      })
      .setFooter({ text: "BananaServer.xyz" })
      .setTimestamp();

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

    await message.edit({
      embeds: [updatedEmbed],
      components: [row],
    });
  }
}
