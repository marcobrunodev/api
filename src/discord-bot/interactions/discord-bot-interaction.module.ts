import { Module, forwardRef } from "@nestjs/common";
import ScheduleMatch from "./ScheduleMatch";
import ScheduleMix from "./ScheduleMix";
import { DiscordBotModule } from "../discord-bot.module";
import { HasuraModule } from "../../hasura/hasura.module";
import { MatchesModule } from "../../matches/matches.module";
import UpdateMapStatus from "./UpdateMapStatus";
import VetoPick from "./VetoPick";
import UpdateMatchStatus from "./UpdateMatchStatus";
import { loggerFactory } from "../../utilities/LoggerFactory";
import { CacheModule } from "src/cache/cache.module";
import LinkDiscord from "./LinkDiscord";
import VoteCaptain from "./VoteCaptain";

@Module({
  imports: [
    forwardRef(() => DiscordBotModule),
    HasuraModule,
    forwardRef(() => MatchesModule),
    CacheModule,
  ],
  exports: [
    LinkDiscord,
    ScheduleMatch,
    ScheduleMix,
    UpdateMapStatus,
    UpdateMatchStatus,
    VetoPick,
    VoteCaptain,
  ],
  providers: [
    LinkDiscord,
    ScheduleMatch,
    ScheduleMix,
    UpdateMapStatus,
    UpdateMatchStatus,
    VetoPick,
    VoteCaptain,
    loggerFactory(),
  ],
})
export class DiscordBotInteractionModule {}
