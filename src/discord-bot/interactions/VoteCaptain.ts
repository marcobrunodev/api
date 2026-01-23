import { ButtonInteraction } from "discord.js";
import { ButtonActions } from "../enums/ButtonActions";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotButtonInteraction } from "./interactions";

const votesByMessage = new Map<string, Map<string, Set<string>>>();
const fruitToPlayerMap = new Map<string, Map<string, string>>();
const voteCompleteCallbacks = new Map<string, (votes: Map<string, Set<string>>) => void>();

export function getVotesByMessage(messageId: string) {
  return votesByMessage.get(messageId);
}

export function getFruitToPlayerMap(messageId: string) {
  return fruitToPlayerMap.get(messageId);
}

export function initializeVotingSession(
  messageId: string,
  fruitPlayerMapping?: Map<string, string>,
  onAllVoted?: (votes: Map<string, Set<string>>) => void
) {
  if (!votesByMessage.has(messageId)) {
    votesByMessage.set(messageId, new Map());
  }
  if (fruitPlayerMapping) {
    fruitToPlayerMap.set(messageId, fruitPlayerMapping);
  }
  if (onAllVoted) {
    voteCompleteCallbacks.set(messageId, onAllVoted);
  }
  return votesByMessage.get(messageId);
}

export function checkAndTriggerVoteComplete(messageId: string) {
  const votes = votesByMessage.get(messageId);
  const fruitMapping = fruitToPlayerMap.get(messageId);
  const callback = voteCompleteCallbacks.get(messageId);

  if (!votes || !fruitMapping || !callback) return false;

  const maxVotesPerUser = getMaxVotesPerUser();
  const allPlayerIds = Array.from(fruitMapping.values());
  const allVoted = allPlayerIds.every(playerId => {
    const playerVotes = votes.get(playerId);
    return playerVotes && playerVotes.size >= maxVotesPerUser;
  });

  if (allVoted) {
    voteCompleteCallbacks.delete(messageId);
    callback(votes);
    return true;
  }

  return false;
}

export const getMaxVotesPerUser = () => 2;

@BotButtonInteraction(ButtonActions.VoteCaptain)
export default class VoteCaptain extends DiscordInteraction {
  public async handler(interaction: ButtonInteraction) {
    const [, fruit] = interaction.customId.split(":");
    const messageId = interaction.message.id;
    const userId = interaction.user.id;

    const fruitMapping = fruitToPlayerMap.get(messageId);

    if (!fruitMapping) {
      await interaction.reply({
        content: '❌ Voting session not found.',
        ephemeral: true
      });
      return;
    }

    const allowedPlayerIds = Array.from(fruitMapping.values());

    if (!allowedPlayerIds.includes(userId)) {
      await interaction.reply({
        content: '❌ You are not a player in this mix and cannot vote.',
        ephemeral: true
      });
      return;
    }

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
      userVotes.delete(fruit);

      await interaction.reply({
        content: `🗑️ You removed your vote for \`${fruit}\`! (${userVotes.size}/${maxVotesPerUser} votes used)`,
        ephemeral: true
      });

      await updateVoteMessage(interaction);
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
      content: `✅ You voted for \`${fruit}\`! (${userVotes.size}/${maxVotesPerUser} votes used)`,
      ephemeral: true
    });

    await updateVoteMessage(interaction);

    const allPlayerIds = Array.from(fruitMapping.values());
    const allVoted = allPlayerIds.every(playerId => {
      const playerVotes = votes.get(playerId);
      return playerVotes && playerVotes.size >= maxVotesPerUser;
    });

    if (allVoted) {
      const callback = voteCompleteCallbacks.get(messageId);
      if (callback) {
        voteCompleteCallbacks.delete(messageId);
        callback(votes);
      }
    }
  }
}

async function updateVoteMessage(interaction: ButtonInteraction) {
  const messageId = interaction.message.id;
  const votes = votesByMessage.get(messageId);
  const fruitMapping = fruitToPlayerMap.get(messageId);

  if (!votes || !fruitMapping) return;

  const voteCount = new Map<string, number>();
  for (const userVotes of votes.values()) {
    for (const fruit of userVotes) {
      voteCount.set(fruit, (voteCount.get(fruit) || 0) + 1);
    }
  }

  const playersList = Array.from(fruitMapping.entries())
    .map(([fruit, playerId]) => {
      const count = voteCount.get(fruit) || 0;
      return `[${count}] \`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  const maxVotesPerUser = getMaxVotesPerUser();
  const playersWhoHaventVoted = Array.from(fruitMapping.entries())
    .filter(([fruit, playerId]) => {
      const playerVotes = votes.get(playerId);
      return !playerVotes || playerVotes.size < maxVotesPerUser;
    })
    .map(([fruit, playerId]) => `<@${playerId}>`)
    .join(', ');

  const waitingForVotesText = playersWhoHaventVoted
    ? `\n**Waiting for votes:**\n${playersWhoHaventVoted}\n`
    : '';

  const originalEmbed = interaction.message.embeds[0];
  await interaction.message.edit({
    embeds: [{
      title: originalEmbed.title,
      description: `
Vote for 2 captains:

**Players:**
${playersList}
${waitingForVotesText}
**React with the fruits to vote!**
      `,
      color: originalEmbed.color,
      timestamp: originalEmbed.timestamp,
      footer: originalEmbed.footer
    }],
    components: interaction.message.components
  });
}

export async function updateVoteMessageById(message: any) {
  const messageId = message.id;
  const votes = votesByMessage.get(messageId);
  const fruitMapping = fruitToPlayerMap.get(messageId);

  if (!votes || !fruitMapping) return;

  const voteCount = new Map<string, number>();
  for (const userVotes of votes.values()) {
    for (const fruit of userVotes) {
      voteCount.set(fruit, (voteCount.get(fruit) || 0) + 1);
    }
  }

  const playersList = Array.from(fruitMapping.entries())
    .map(([fruit, playerId]) => {
      const count = voteCount.get(fruit) || 0;
      return `[${count}] \`${fruit}\` <@${playerId}>`;
    })
    .join('\n');

  const maxVotesPerUser = getMaxVotesPerUser();
  const playersWhoHaventVoted = Array.from(fruitMapping.entries())
    .filter(([fruit, playerId]) => {
      const playerVotes = votes.get(playerId);
      return !playerVotes || playerVotes.size < maxVotesPerUser;
    })
    .map(([fruit, playerId]) => `<@${playerId}>`)
    .join(', ');

  const waitingForVotesText = playersWhoHaventVoted
    ? `\n**Waiting for votes:**\n${playersWhoHaventVoted}\n`
    : '';

  const originalEmbed = message.embeds[0];
  await message.edit({
    embeds: [{
      title: originalEmbed.title,
      description: `
Vote for 2 captains:

**Players:**
${playersList}
${waitingForVotesText}
**React with the fruits to vote!**
      `,
      color: originalEmbed.color,
      timestamp: originalEmbed.timestamp,
      footer: originalEmbed.footer
    }],
    components: message.components
  });
}
