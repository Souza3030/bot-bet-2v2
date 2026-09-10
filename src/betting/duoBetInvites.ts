import { DuoBetInvite } from "../types";
import { config } from "../config";

/**
 * Convites de dupla apostada pendentes, mantidos em memória (efêmeros —
 * expiram em minutos e não precisam sobreviver a um reinício). Nenhum
 * dinheiro é movimentado ainda nesta etapa: o convite só define QUEM vai
 * jogar junto e QUANTO cada um vai apostar.
 */
const invites = new Map<string, DuoBetInvite>();

function generateInviteId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function hasPendingInvite(userId: string): boolean {
  for (const invite of invites.values()) {
    if (invite.inviterId === userId || invite.partnerId === userId) return true;
  }
  return false;
}

export function createInvite(
  inviterId: string,
  partnerId: string,
  amount: number,
  guildId: string,
  channelId: string,
  onExpire: (invite: DuoBetInvite) => void
): DuoBetInvite {
  const inviteId = generateInviteId();

  const invite: DuoBetInvite = {
    inviteId,
    inviterId,
    partnerId,
    amount,
    guildId,
    channelId,
    createdAt: Date.now(),
    timeout: setTimeout(() => {
      const current = invites.get(inviteId);
      if (!current) return;
      invites.delete(inviteId);
      onExpire(current);
    }, config.queue.inviteTimeoutMs),
  };

  invites.set(inviteId, invite);
  return invite;
}

export function getInvite(inviteId: string): DuoBetInvite | undefined {
  return invites.get(inviteId);
}

export function resolveInvite(inviteId: string): DuoBetInvite | undefined {
  const invite = invites.get(inviteId);
  if (!invite) return undefined;
  clearTimeout(invite.timeout);
  invites.delete(inviteId);
  return invite;
}
