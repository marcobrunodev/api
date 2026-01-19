import { e_map_pool_types_enum, e_match_types_enum } from "generated";
import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import {
  ChatInputCommandInteraction,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from "discord.js";
import { ButtonActions } from "../enums/ButtonActions";

@BotChatCommand(ChatCommands.ScheduleMix)
export default class ScheduleMix extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply("This command can only be used in a server.");
        return;
      }

      const member = guild.members.cache.get(interaction.user.id);
      const voiceChannel = member?.voice.channel;
      const players = voiceChannel?.members;

      if (!voiceChannel) {
        await interaction.editReply("❌ You need to be in a voice channel to use this command.");
        return;
      }

      const category = await guild.channels.create({
        name: `Banana Mix - ${new Date().toLocaleString()}`,
        type: ChannelType.GuildCategory,
      });

      const picksBans = await guild.channels.create({
        name: 'picks-bans',
        type: ChannelType.GuildText,
        parent: category.id,
      });

      const mixVoiceChannel = await guild.channels.create({
        name: 'Mix Voice',
        type: ChannelType.GuildVoice,
        parent: category.id,
      });

      for (const [id, member] of players) {
        await member.voice.setChannel(mixVoiceChannel.id);
      }

      await interaction.editReply(
        `✅ Mix created!\n` +
        `📁 Category: ${category.name}\n` +
        `💬 Chat: ${picksBans}\n` +
        `🔊 Voice: ${mixVoiceChannel}`
      );

      await picksBans.send({
        embeds: [{
          title: 'Welcome to the Banana Mix!',
          description: 'We will use this channel for:\n\n' +
            '1️⃣ **Vote for captains**\n' +
            '2️⃣ **Captains picking players**\n' +
            '3️⃣ **Banning maps**',
          color: 0xFFD700,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }]
      });

      const fruitEmojis = ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝'];
      const shuffledFruits = [...fruitEmojis].sort(() => Math.random() - 0.5);
      const playersList = Array.from(players.values()).map((p, index) => {
      const fruit = shuffledFruits[index % shuffledFruits.length];
        return `${fruit} <@${p.id}>`;
      }).join('\n');

      const usedFruits = shuffledFruits.slice(0, players.size);

      const voteMessage = await picksBans.send({
        embeds: [{
          title: 'Step 1: Vote for Captains',
          description: `
Vote for 2 captains:

**Players:**
${playersList}

**React with the fruits to vote!**
          `,
          color: 0x00FFFF,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'From BananaServer.xyz with 🍌',
          }
        }],
        components: [
          new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              usedFruits.map(fruit =>
                new ButtonBuilder()
                  .setCustomId(`${ButtonActions.VoteCaptain}:${fruit}`)
                  .setLabel(fruit)
                  .setStyle(ButtonStyle.Secondary)
              )
            )
        ]
      });

      setTimeout(async () => {
        const { getVotesByMessage } = await import('./VoteCaptain');
        const votes = getVotesByMessage(voteMessage.id);

        if (!votes) return;

        const maxVotesPerUser = 2;
        const playersWhoDidntCompleteVotes = Array.from(players.keys()).filter(
          playerId => {
            const userVotes = votes.get(playerId);
            return !userVotes || userVotes.size < maxVotesPerUser;
          }
        );

        if (playersWhoDidntCompleteVotes.length > 0) {
          await picksBans.send({
            content: `⏰ **Reminder!** The following players haven't completed their ${maxVotesPerUser} votes yet:\n${playersWhoDidntCompleteVotes.map(id => `<@${id}>`).join(', ')}`
          });
        }
      }, 10000);
    } catch (error) {
      console.error('Erro ao criar mix:', error);
      await interaction.editReply("❌ Erro ao criar o mix. Verifique se o bot tem permissões adequadas.");
    }
  }
}