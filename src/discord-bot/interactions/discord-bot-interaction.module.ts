import { Module, forwardRef } from "@nestjs/common";
import ScheduleMatch from "./ScheduleMatch";
import ScheduleMix from "./ScheduleMix";
import ScheduleMixWingman from "./ScheduleMixWingman";
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
import MixDuel from "./MixDuel";
import DeclineMixDuel from "./DeclineMixDuel";
import AcceptMixDuel from "./AcceptMixDuel";
import JoinDuelVoice from "./JoinDuelVoice";
import DuelVetoBan from "./DuelVetoBan";
import Ranking from "./Ranking";
import RankingKnife from "./RankingKnife";
import RankingTaser from "./RankingTaser";
import RankingMvp from "./RankingMvp";
import CreateTeam from "./CreateTeam";
import CreateTeamModal from "./CreateTeamModal";
import OpenCreateTeamModal from "./OpenCreateTeamModal";
import JoinTeam from "./JoinTeam";
import AcceptTeamMember from "./AcceptTeamMember";
import DeclineTeamMember from "./DeclineTeamMember";
import LeaveTeam from "./LeaveTeam";
import Migrate from "./Migrate";
import LfgMix from "./LfgMix";
import RegionVeto from "./RegionVeto";
import DuelRegionVeto from "./DuelRegionVeto";
import Warmup from "./Warmup";

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
    ScheduleMixWingman,
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
    MixDuel,
    DeclineMixDuel,
    AcceptMixDuel,
    JoinDuelVoice,
    DuelVetoBan,
    Ranking,
    RankingKnife,
    RankingTaser,
    RankingMvp,
    CreateTeam,
    CreateTeamModal,
    OpenCreateTeamModal,
    JoinTeam,
    AcceptTeamMember,
    DeclineTeamMember,
    LeaveTeam,
    Migrate,
    LfgMix,
    RegionVeto,
    DuelRegionVeto,
    Warmup,
  ],
  providers: [
    LinkDiscord,
    Init,
    Queue,
    KickPlayer,
    ScheduleMatch,
    ScheduleMix,
    ScheduleMixWingman,
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
    MixDuel,
    DeclineMixDuel,
    AcceptMixDuel,
    JoinDuelVoice,
    DuelVetoBan,
    Ranking,
    RankingKnife,
    RankingTaser,
    RankingMvp,
    CreateTeam,
    CreateTeamModal,
    OpenCreateTeamModal,
    JoinTeam,
    AcceptTeamMember,
    DeclineTeamMember,
    LeaveTeam,
    Migrate,
    LfgMix,
    RegionVeto,
    DuelRegionVeto,
    Warmup,
    loggerFactory(),
  ],
})
export class DiscordBotInteractionModule {}
