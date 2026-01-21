import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";
import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

@BotChatCommand(ChatCommands.KickPlayer)
export default class KickPlayer extends DiscordInteraction {
  public async handler(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply("This command can only be used in a server.");
        return;
      }

      // Verificar se o usuário tem permissão de administrador ou moderador
      const member = guild.members.cache.get(interaction.user.id);
      if (!member?.permissions.has(PermissionFlagsBits.KickMembers)) {
        await interaction.editReply("❌ You don't have permission to kick players. You need the 'Kick Members' permission.");
        return;
      }

      // Pegar o jogador a ser kickado
      const targetUser = interaction.options.getUser("player", true);
      const targetMember = guild.members.cache.get(targetUser.id);

      if (!targetMember) {
        await interaction.editReply("❌ Player not found in this server.");
        return;
      }

      // Verificar se o jogador está no Queue Mix
      const voiceChannel = targetMember.voice.channel;

      if (!voiceChannel) {
        await interaction.editReply(`❌ ${targetUser.username} is not in any voice channel.`);
        return;
      }

      if (voiceChannel.name !== '🍌 Queue Mix') {
        await interaction.editReply(`❌ ${targetUser.username} is not in the **🍌 Queue Mix** channel.`);
        return;
      }

      // Desconectar o jogador do canal de voz
      await targetMember.voice.disconnect();

      // Remover da ordem da fila
      this.bot.removeFromQueueMixOrder(targetUser.id);

      await interaction.editReply(`✅ ${targetUser.username} has been kicked from the queue.`);

    } catch (error) {
      this.logger.error('Error in /kick command:', error);
      await interaction.editReply("❌ Error kicking player. Please try again.");
    }
  }
}
