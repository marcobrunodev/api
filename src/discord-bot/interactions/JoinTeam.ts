import {
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";
import { ButtonActions } from "../enums/ButtonActions";

@BotButtonInteraction(ButtonActions.JoinTeam)
export default class JoinTeam extends DiscordInteraction {
  async handler(interaction: ButtonInteraction) {
    // Extract team ID from custom ID (format: "join_team:teamId")
    const [, teamId] = interaction.customId.split(":");

    try {
      // Check if player has registered their SteamID
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
          },
        },
      });

      const player = players.at(0);

      if (!player) {
        await interaction.reply({
          content: "❌ You need to register your SteamID first. Use `/create-team` or `/steamid` to register.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check if player is already in a team
      if (player.team_members && player.team_members.length > 0) {
        await interaction.reply({
          content: "❌ You are already a member of a team. Leave your current team before joining another one.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Get team info and captain
      const { teams_by_pk: team } = await this.hasura.query({
        teams_by_pk: {
          __args: {
            id: teamId,
          },
          id: true,
          name: true,
          short_name: true,
          owner_steam_id: true,
          owner: {
            discord_id: true,
            name: true,
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

      if (!team.owner?.discord_id) {
        await interaction.reply({
          content: "❌ Team captain not found or not linked to Discord.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Acknowledge the button click
      await interaction.reply({
        content: "✅ Your request to join the team has been sent! Please wait for the captain to approve.",
        flags: MessageFlags.Ephemeral,
      });

      // Send join request message in the channel
      const requestEmbed = new EmbedBuilder()
        .setColor(0xffa500) // Orange color for pending
        .setTitle("📥 New Join Request")
        .setDescription(
          `<@${interaction.user.id}> wants to join **${team.name}**!\n\n` +
          `<@${team.owner.discord_id}>, please review this request.`,
        )
        .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: "Player", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Status", value: "⏳ Awaiting approval", inline: true },
        )
        .setFooter({ text: "Only the team captain can accept or decline this request." })
        .setTimestamp();

      const acceptButton = new ButtonBuilder()
        .setCustomId(`${ButtonActions.AcceptTeamMember}:${teamId}:${interaction.user.id}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success)
        .setEmoji("👍");

      const declineButton = new ButtonBuilder()
        .setCustomId(`${ButtonActions.DeclineTeamMember}:${teamId}:${interaction.user.id}`)
        .setLabel("Decline")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("👎");

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptButton, declineButton);

      await interaction.channel?.send({
        embeds: [requestEmbed],
        components: [row],
      });

    } catch (error) {
      console.error("Error processing join team request:", error);
      await interaction.reply({
        content: "❌ An error occurred while processing your request. Please try again later.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
