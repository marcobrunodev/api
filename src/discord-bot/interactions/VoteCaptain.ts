import { ButtonInteraction } from "discord.js";
import { ButtonActions } from "../enums/ButtonActions";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";

const votesByMessage = new Map<string, Map<string, Set<string>>>();

export function getVotesByMessage(messageId: string) {
  return votesByMessage.get(messageId);
}

export const getMaxVotesPerUser = () => 1;

@BotButtonInteraction(ButtonActions.VoteCaptain)
export default class VoteCaptain extends DiscordInteraction {
  public async handler(interaction: ButtonInteraction) {
    const [, fruit] = interaction.customId.split(":");
    const messageId = interaction.message.id;
    const userId = interaction.user.id;

    if (!votesByMessage.has(messageId)) {
      votesByMessage.set(messageId, new Map());
    }

    const votes = votesByMessage.get(messageId);
    const maxVotesPerUser = getMaxVotesPerUser();

    if (!votes.has(userId)) {
      votes.set(userId, new Set());
    }

    const userVotes = votes.get(userId);

    if (userVotes.has(fruit)) {
      await interaction.reply({
        content: `❌ You already voted for ${fruit}!`,
        ephemeral: true
      });
      return;
    }

    if (userVotes.size >= maxVotesPerUser) {
      await interaction.reply({
        content: `❌ You already voted ${maxVotesPerUser} time(s)! Maximum votes reached.`,
        ephemeral: true
      });
      return;
    }

    userVotes.add(fruit);

    await interaction.reply({
      content: `✅ You voted for ${fruit}! (${userVotes.size}/${maxVotesPerUser} votes used)`,
      ephemeral: true
    });
  }
}
