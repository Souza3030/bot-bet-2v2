import { Client, ChannelType, TextChannel } from "discord.js";
import { config } from "../config";
import { WaitingDuoTeam } from "../types";
import { findLegByPaymentId, findTeammateLeg, updateLeg } from "./betLedger";
import { joinTeamQueue } from "./betLedger";
import { startTeamCheckIn } from "../queue/duoBetCheckin";
import { markQueueAsCheckingIn, updateQueueStatus } from "../queue/betQueueStatus";

export async function handlePaymentStatusChange(
  client: Client,
  paymentId: string,
  status: string
): Promise<void> {
  const leg = await findLegByPaymentId(paymentId);
  if (!leg) return;

  if (leg.status !== "aguardando_pagamento") return; // já processado (webhook repetido)

  if (status === "rejected" || status === "cancelled") {
    await updateLeg(leg.betId, { status: "cancelada" });
    const user = await client.users.fetch(leg.userId).catch(() => null);
    await user
      ?.send(
        `❌ Seu pagamento PIX de R$ ${leg.amount.toFixed(2)} não foi aprovado. Peça pro seu parceiro te convidar de novo com /apostar-dupla.`
      )
      .catch(() => undefined);
    return;
  }

  if (status !== "approved") return;

  const teammateLeg = await findTeammateLeg(leg.teamId, leg.userId);

  if (!teammateLeg || teammateLeg.status === "aguardando_pagamento") {
    // Parceiro ainda não pagou.
    await updateLeg(leg.betId, { status: "paga_aguardando_parceiro" });
    const user = await client.users.fetch(leg.userId).catch(() => null);
    await user
      ?.send(`✅ Seu pagamento de R$ ${leg.amount.toFixed(2)} foi confirmado! Aguardando seu parceiro pagar a parte dele.`)
      .catch(() => undefined);
    return;
  }

  // Os dois já pagaram: monta a dupla e entra na fila.
  await Promise.all([
    updateLeg(leg.betId, { status: "na_fila" }),
    updateLeg(teammateLeg.betId, { status: "na_fila" }),
  ]);

  const team: WaitingDuoTeam = {
    teamId: leg.teamId,
    amount: leg.amount,
    memberIds: [leg.userId, teammateLeg.userId],
    legBetIds: [leg.betId, teammateLeg.betId],
    joinedAt: Date.now(),
  };

  const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
  if (!guild) {
    console.error("[PaymentFlow] Guild configurada não encontrada.");
    return;
  }

  const pairing = await joinTeamQueue(team);
  const panelChannel = await guild.channels.fetch(config.channels.queuePanelChannelId).catch(() => null);

  if (!pairing) {
    for (const userId of team.memberIds) {
      const user = await client.users.fetch(userId).catch(() => null);
      await user
        ?.send(`✅ Dupla completa! Vocês entraram na fila, aguardando um adversário do mesmo valor (R$ ${team.amount.toFixed(2)}/jogador).`)
        .catch(() => undefined);
    }

    if (panelChannel?.type === ChannelType.GuildText) {
      await updateQueueStatus(guild, panelChannel as TextChannel);
    }
    return;
  }

  await markQueueAsCheckingIn(guild, pairing.waitingTeam, pairing.newTeam);

  if (panelChannel?.type === ChannelType.GuildText) {
    await startTeamCheckIn(guild, panelChannel as TextChannel, pairing.waitingTeam, pairing.newTeam);
  }
}
