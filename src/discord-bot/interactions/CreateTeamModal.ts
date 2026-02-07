import {
  ModalSubmitInteraction,
  EmbedBuilder,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotModalSubmit } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotModalSubmit("create_team_modal")
export default class CreateTeamModal extends DiscordInteraction {
  async handler(interaction: ModalSubmitInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const teamName = interaction.fields.getTextInputValue("team_name").trim();
    const shortName = interaction.fields.getTextInputValue("short_name").toUpperCase().trim();

    // 1. Check if player has linked their Discord account
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
        team_members: {
          team_id: true,
          team: {
            name: true,
          },
        },
      },
    });

    const player = players.at(0);

    if (!player) {
      await interaction.editReply({
        content: "❌ You need to link your Discord account first. Use `/steamid` to register.",
      });
      return;
    }

    // 2. Check if player is already in a team (as captain, member, or coach)
    if (player.team_members && player.team_members.length > 0) {
      const currentTeam = player.team_members[0].team?.name || "a team";
      await interaction.editReply({
        content: `❌ You are already a member of **${currentTeam}**. You can only be part of one team. Leave your current team before creating a new one.`,
      });
      return;
    }

    // 4. Check if team name already exists
    const { teams: existingTeams } = await this.hasura.query({
      teams: {
        __args: {
          where: {
            name: {
              _ilike: teamName,
            },
          },
        },
        id: true,
      },
    });

    if (existingTeams.length > 0) {
      await interaction.editReply({
        content: "❌ A team with this name already exists. Please choose a different name.",
      });
      return;
    }

    // 5. Create the team
    try {
      const { insert_teams_one: newTeam } = await this.hasura.mutation({
        insert_teams_one: {
          __args: {
            object: {
              name: teamName,
              short_name: shortName,
              owner_steam_id: player.steam_id,
            },
          },
          id: true,
          name: true,
          short_name: true,
        },
      });

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("✅ Team Created Successfully!")
        .addFields(
          { name: "Team Name", value: newTeam.name, inline: true },
          { name: "Short Name", value: newTeam.short_name, inline: true },
          { name: "Captain", value: player.name || interaction.user.username, inline: true },
        )
        .setFooter({ text: "You can now invite players to your team!" })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
      });

      // Create Discord category and channel for the team
      await this.createTeamDiscordCategory(interaction, newTeam);
    } catch (error) {
      console.error("Error creating team:", error);
      await interaction.editReply({
        content: "❌ An error occurred while creating the team. Please try again later.",
      });
    }
  }

  private async createTeamDiscordCategory(
    interaction: ModalSubmitInteraction,
    team: { id: string; name: string; short_name: string },
  ) {
    try {
      const guild = interaction.guild;
      if (!guild) {
        console.warn("No guild found for team category creation");
        return;
      }

      const categoryName = `🏆 ${team.short_name}`;

      // Check if category already exists
      const existingCategory = guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory &&
          channel.name === categoryName,
      );

      if (existingCategory) {
        console.log(`Category ${categoryName} already exists in guild ${guild.name}`);
        return;
      }

      // Create the category with permissions
      // Everyone can view, but only team members can send messages
      const category = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.id, // @everyone role
            allow: [PermissionsBitField.Flags.ViewChannel],
            deny: [PermissionsBitField.Flags.SendMessages],
          },
          {
            id: interaction.user.id, // Team owner can send messages
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels,
            ],
          },
          {
            id: this.bot.client.user.id, // Bot can manage
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels,
            ],
          },
        ],
      });

      console.log(`Created category ${categoryName} for team ${team.name}`);

      // Create a text channel inside the category for recruitment
      console.log(`Creating recruitment channel in category ${category.id}...`);

      let recruitChannel;
      try {
        recruitChannel = await guild.channels.create({
          name: "📢-recruitment",
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: [
            {
              id: guild.id, // @everyone role
              allow: [PermissionsBitField.Flags.ViewChannel],
              deny: [PermissionsBitField.Flags.SendMessages],
            },
            {
              id: interaction.user.id, // Team owner can send messages
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
              ],
            },
            {
              id: this.bot.client.user.id, // Bot can manage
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
              ],
            },
          ],
        });
        console.log(`Created recruitment channel ${recruitChannel.id} for team ${team.name}`);
      } catch (channelError) {
        console.error("Error creating recruitment channel:", channelError);
        return;
      }

      // Create embed with join button
      const teamEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🏆 ${team.name}`)
        .setDescription(
          `Welcome to **${team.name}** team!\n\n` +
          `**Short Name:** ${team.short_name}\n` +
          `**Captain:** <@${interaction.user.id}>\n\n` +
          `Interested in joining this team? Click the button below to request membership!`,
        )
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: "BananaServer.xyz" })
        .setTimestamp();

      const joinButton = new ButtonBuilder()
        .setCustomId(`${ButtonActions.JoinTeam}:${team.id}`)
        .setLabel("Join Team")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎮");

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinButton);

      try {
        await recruitChannel.send({
          embeds: [teamEmbed],
          components: [row],
        });
        console.log(`Sent embed to recruitment channel for team ${team.name}`);
      } catch (sendError) {
        console.error("Error sending embed to recruitment channel:", sendError);
      }
    } catch (error) {
      console.error("Error creating team Discord category:", error);
      // Don't fail the team creation if Discord category fails
    }
  }
}
