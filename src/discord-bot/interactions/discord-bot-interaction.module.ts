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
import TestVote from "./TestVote";
import TestAutoVote from "./TestAutoVote";
import TestAutoReady from "./TestAutoReady";
import Init from "./Init";
import Queue from "./Queue";
import ReadyCheck from "./ReadyCheck";

@Module({
  imports: [
    forwardRef(() => DiscordBotModule),
    HasuraModule,
    forwardRef(() => MatchesModule),
    CacheModule,
  ],
  exports: [
    LinkDiscord,
    Init,
    Queue,
    ScheduleMatch,
    ScheduleMix,
    UpdateMapStatus,
    UpdateMatchStatus,
    VetoPick,
    VoteCaptain,
    ReadyCheck,
    TestVote,
    TestAutoVote,
    TestAutoReady,
  ],
  providers: [
    LinkDiscord,
    Init,
    Queue,
    ScheduleMatch,
    ScheduleMix,
    UpdateMapStatus,
    UpdateMatchStatus,
    VetoPick,
    VoteCaptain,
    ReadyCheck,
    TestVote,
    TestAutoVote,
    TestAutoReady,
    loggerFactory(),
  ],
})
export class DiscordBotInteractionModule {}
