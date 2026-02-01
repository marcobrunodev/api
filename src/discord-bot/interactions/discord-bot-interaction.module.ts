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
import TestAutoRemake from "./TestAutoRemake";
import Init from "./Init";
import Queue from "./Queue";
import ReadyCheck from "./ReadyCheck";
import LeaveGuild from "./LeaveGuild";
import RegisterSteamId from "./RegisterSteamId";
import RegisterSteamIdModal from "./RegisterSteamIdModal";
import ConfirmSteamId from "./ConfirmSteamId";
import CancelSteamId from "./CancelSteamId";
import OpenRegisterSteamIdModal from "./OpenRegisterSteamIdModal";
import KickPlayer from "./KickPlayer";
import PickPlayer from "./PickPlayer";
import MapVeto from "./MapVeto";
import RequestRemake from "./RemakeVote";
import CheckSteamId from "./CheckSteamId";

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
    KickPlayer,
    ScheduleMatch,
    ScheduleMix,
    UpdateMapStatus,
    UpdateMatchStatus,
    VetoPick,
    VoteCaptain,
    ReadyCheck,
    PickPlayer,
    MapVeto,
    RequestRemake,
    TestVote,
    TestAutoVote,
    TestAutoReady,
    TestAutoRemake,
    LeaveGuild,
    RegisterSteamId,
    RegisterSteamIdModal,
    ConfirmSteamId,
    CancelSteamId,
    OpenRegisterSteamIdModal,
    CheckSteamId,
  ],
  providers: [
    LinkDiscord,
    Init,
    Queue,
    KickPlayer,
    ScheduleMatch,
    ScheduleMix,
    UpdateMapStatus,
    UpdateMatchStatus,
    VetoPick,
    VoteCaptain,
    ReadyCheck,
    PickPlayer,
    MapVeto,
    RequestRemake,
    TestVote,
    TestAutoVote,
    TestAutoReady,
    TestAutoRemake,
    LeaveGuild,
    RegisterSteamId,
    RegisterSteamIdModal,
    ConfirmSteamId,
    CancelSteamId,
    OpenRegisterSteamIdModal,
    CheckSteamId,
    loggerFactory(),
  ],
})
export class DiscordBotInteractionModule {}
