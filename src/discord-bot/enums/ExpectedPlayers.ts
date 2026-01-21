import { e_match_types_enum } from "../../../generated";

export const ExpectedPlayers: Record<e_match_types_enum | 'Mix', number> = {
  ["Duel"]: 2,
  ["Wingman"]: 4,
  ["Competitive"]: 10,
  ["Mix"]: 10,
};
