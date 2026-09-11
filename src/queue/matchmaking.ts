import { Guild } from "discord.js";
import { createMatchChannels } from "../utils/channelManager";
import { ActiveMatch, QueueMode, Team, WaitingDuoTeam } from "../types";

export const activeMatches = new Map<string, ActiveMatch>();

/**
 * Mapeia matchId -> as duas duplas (com teamId/legBetIds) que deram origem
 * à partida, para que o payout/reembolso saiba pra quem pagar.
 */
export const activeMatchTeams = new Map<string, { teamA: WaitingDuoTeam; teamB: WaitingDuoTeam }>();

function generateMatchId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/** Cria uma nova partida 2v2 a partir de duas duplas já pagas e pareadas. */
export async function createTeamMatch(
  guild: Guild,
  mode: QueueMode,
  duoTeamA: WaitingDuoTeam,
  duoTeamB: WaitingDuoTeam
): Promise<ActiveMatch> {
  const matchId = generateMatchId();

  const teamA: Team = { name: "A", memberIds: [...duoTeamA.memberIds] };
  const teamB: Team = { name: "B", memberIds: [...duoTeamB.memberIds] };

  const channels = await createMatchChannels(guild, mode, matchId, teamA, teamB);

  const match: ActiveMatch = {
    matchId,
    mode,
    teamA,
    teamB,
    categoryId: channels.categoryId,
    textChannelId: channels.textChannelId,
    voiceChannelAId: channels.voiceChannelAId,
    voiceChannelBId: channels.voiceChannelBId,
    createdAt: Date.now(),
  };

  activeMatches.set(matchId, match);
  activeMatchTeams.set(matchId, { teamA: duoTeamA, teamB: duoTeamB });
  return match;
}

export function isPlayerInActiveMatch(userId: string): boolean {
  for (const match of activeMatches.values()) {
    if (match.teamA.memberIds.includes(userId) || match.teamB.memberIds.includes(userId)) {
      return true;
    }
  }
  return false;
}
