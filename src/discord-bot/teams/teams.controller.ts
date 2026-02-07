import { Controller, Logger, forwardRef, Inject } from "@nestjs/common";
import { HasuraEvent } from "../../hasura/hasura.controller";
import { HasuraEventData } from "../../hasura/types/HasuraEventData";
import { DiscordBotService } from "../discord-bot.service";
import { ChannelType } from "discord.js";

// Type for team data from Hasura
interface TeamData {
  id: string;
  name: string;
  short_name: string;
  owner_steam_id: string;
}

@Controller("teams")
export class TeamsController {
  constructor(
    private readonly logger: Logger,
    @Inject(forwardRef(() => DiscordBotService))
    private readonly bot: DiscordBotService,
  ) {}

  @HasuraEvent()
  public async team_deleted(data: HasuraEventData<TeamData>) {
    if (data.op !== "DELETE") {
      return;
    }

    const team = data.old;
    if (!team || !team.short_name) {
      console.warn("Team deleted but no short_name found in old data");
      return;
    }

    const categoryName = `🏆 ${team.short_name}`;
    console.log(`Team ${team.name} deleted, looking for Discord category: ${categoryName}`);

    try {
      // Search across all guilds the bot is in
      for (const [, guild] of this.bot.client.guilds.cache) {
        const category = guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === categoryName,
        );

        if (category) {
          console.log(`Found category ${categoryName} in guild ${guild.name}, deleting...`);

          // Delete all channels inside the category first
          const children = guild.channels.cache.filter(
            (channel) => channel.parentId === category.id,
          );

          for (const [, child] of children) {
            try {
              await child.delete(`Team ${team.name} was deleted`);
              console.log(`Deleted channel ${child.name} from category ${categoryName}`);
            } catch (error) {
              console.error(`Failed to delete channel ${child.name}:`, error);
            }
          }

          // Delete the category
          try {
            await category.delete(`Team ${team.name} was deleted`);
            console.log(`Deleted category ${categoryName} for team ${team.name}`);
          } catch (error) {
            console.error(`Failed to delete category ${categoryName}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Error cleaning up Discord category for team ${team.name}:`, error);
    }
  }
}
