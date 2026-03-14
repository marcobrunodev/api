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

      if (!category) {
        logs.push(`⏭️ **${team.name}** - Category not found, skipping.`);
        continue;
      }

      {
        // Fix category permissions
        if (category.type === ChannelType.GuildCategory) {
          try {
            await category.permissionOverwrites.set([
              {
                id: guild.id,
                allow: [PermissionsBitField.Flags.ViewChannel],
                deny: [PermissionsBitField.Flags.SendMessages],
              },
              {
                id: ownerDiscordId,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.ManageChannels,
                ],
              },
              {
                id: this.bot.client.user.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.ManageChannels,
                ],
              },
              // Add all team members to category
              ...this.getMemberPermissionOverwrites(team.roster, ownerDiscordId),
            ]);
          } catch (error) {
            logs.push(`⚠️ **${team.name}** - Failed to fix category permissions: ${error.message}`);
          }
        }
      }

      if (category.type !== ChannelType.GuildCategory) continue;

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
            permissionOverwrites: [
              {
                id: guild.id,
                allow: [PermissionsBitField.Flags.ViewChannel],
                deny: [PermissionsBitField.Flags.SendMessages],
              },
              {
                id: ownerDiscordId,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                ],
              },
              {
                id: this.bot.client.user.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                ],
              },
            ],
          });

          // Send recruitment embed
          await this.sendRecruitmentEmbed(recruitChannel, team);

          logs.push(`✅ **${team.name}** - Created recruitment channel.`);
          fixedCount++;
        } catch (error) {
          logs.push(`❌ **${team.name}** - Failed to create recruitment channel: ${error.message}`);
        }
      } else {
        // Fix recruitment channel permissions
        if (recruitChannel.type === ChannelType.GuildText) {
          try {
            await recruitChannel.permissionOverwrites.set([
              {
                id: guild.id,
                allow: [PermissionsBitField.Flags.ViewChannel],
                deny: [PermissionsBitField.Flags.SendMessages],
              },
              {
                id: ownerDiscordId,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                ],
              },
              {
                id: this.bot.client.user.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                ],
              },
            ]);
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
              // Update existing embed with current roster
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
            permissionOverwrites: [
              {
                id: guild.id,
                deny: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                ],
              },
              {
                id: ownerDiscordId,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.ManageMessages,
                ],
              },
              {
                id: this.bot.client.user.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.ManageMessages,
                  PermissionsBitField.Flags.ManageChannels,
                ],
              },
              // Add all team members
              ...this.getPrivateChannelMemberOverwrites(team.roster, ownerDiscordId),
            ],
          });

          // Add admin role
          const adminRole = guild.roles.cache.find(
            (role) => role.permissions.has(PermissionsBitField.Flags.Administrator),
          );
          if (adminRole && teamChannel.type === ChannelType.GuildText) {
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
        // Fix private channel permissions
        if (teamChannel.type === ChannelType.GuildText) {
          try {
            const overwrites = [
              {
                id: guild.id,
                deny: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                ],
              },
              {
                id: ownerDiscordId,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.ManageMessages,
                ],
              },
              {
                id: this.bot.client.user.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.ManageMessages,
                  PermissionsBitField.Flags.ManageChannels,
                ],
              },
              ...this.getPrivateChannelMemberOverwrites(team.roster, ownerDiscordId),
            ];

            const adminRole = guild.roles.cache.find(
              (role) => role.permissions.has(PermissionsBitField.Flags.Administrator),
            );
            if (adminRole) {
              overwrites.push({
                id: adminRole.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.ManageMessages,
                ],
              } as any);
            }

            await teamChannel.permissionOverwrites.set(overwrites);
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
            permissionOverwrites: [
              {
                id: guild.id,
                allow: [PermissionsBitField.Flags.ViewChannel],
                deny: [
                  PermissionsBitField.Flags.Connect,
                  PermissionsBitField.Flags.Speak,
                ],
              },
              {
                id: ownerDiscordId,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.Connect,
                  PermissionsBitField.Flags.Speak,
                ],
              },
              {
                id: this.bot.client.user.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.Connect,
                  PermissionsBitField.Flags.Speak,
                  PermissionsBitField.Flags.ManageChannels,
                ],
              },
              // Add all team members
              ...this.getVoiceChannelMemberOverwrites(team.roster, ownerDiscordId),
            ],
          });

          logs.push(`✅ **${team.name}** - Created voice channel.`);
          fixedCount++;
        } catch (error) {
          logs.push(`❌ **${team.name}** - Failed to create voice channel: ${error.message}`);
        }
      } else {
        // Fix voice channel permissions
        if (voiceChannel.type === ChannelType.GuildVoice) {
          try {
            await voiceChannel.permissionOverwrites.set([
              {
                id: guild.id,
                allow: [PermissionsBitField.Flags.ViewChannel],
                deny: [
                  PermissionsBitField.Flags.Connect,
                  PermissionsBitField.Flags.Speak,
                ],
              },
              {
                id: ownerDiscordId,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.Connect,
                  PermissionsBitField.Flags.Speak,
                ],
              },
              {
                id: this.bot.client.user.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.Connect,
                  PermissionsBitField.Flags.Speak,
                  PermissionsBitField.Flags.ManageChannels,
                ],
              },
              ...this.getVoiceChannelMemberOverwrites(team.roster, ownerDiscordId),
            ]);
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

  private getMemberPermissionOverwrites(
    roster: Array<{ role: string; player: { name: string; discord_id: string; steam_id: string } }>,
    ownerDiscordId: string,
  ) {
    return roster
      .filter((member) => member.player?.discord_id && member.player.discord_id !== ownerDiscordId)
      .map((member) => ({
        id: member.player.discord_id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ],
      }));
  }

  private getPrivateChannelMemberOverwrites(
    roster: Array<{ role: string; player: { name: string; discord_id: string; steam_id: string } }>,
    ownerDiscordId: string,
  ) {
    return roster
      .filter((member) => member.player?.discord_id && member.player.discord_id !== ownerDiscordId)
      .map((member) => ({
        id: member.player.discord_id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ],
      }));
  }

  private getVoiceChannelMemberOverwrites(
    roster: Array<{ role: string; player: { name: string; discord_id: string; steam_id: string } }>,
    ownerDiscordId: string,
  ) {
    return roster
      .filter((member) => member.player?.discord_id && member.player.discord_id !== ownerDiscordId)
      .map((member) => ({
        id: member.player.discord_id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
        ],
      }));
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
