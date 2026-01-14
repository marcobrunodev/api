import { ChatInputCommandInteraction } from "discord.js";
import { ChatCommands } from "../enums/ChatCommands";
import DiscordInteraction from "./abstracts/DiscordInteraction";
import { BotChatCommand } from "./interactions";

@BotChatCommand(ChatCommands.ScheduleMix)
export default class ScheduleMix extends DiscordInteraction {
  async handler(interaction: ChatInputCommandInteraction) {
    await interaction.reply("Schedule Mix interaction received!");
  }
}