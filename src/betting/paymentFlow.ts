import { Client, ChannelType, TextChannel } from "discord.js";
import { config } from "../config";
import { WaitingDuoTeam } from "../types";
import { findLegByPaymentId, updateLeg } from "./betLedger";
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
        `❌ Seu pagamento PIX de R$ ${leg.amount.toFixed(2)} não foi aprovado. Selecione o valor novamente no painel da fila para tentar de novo.`
      )
      .catch(() => undefined);
    return;
  }

  if (status !== "approved") return;

  // Pagamento aprovado: o jogador entra sozinho na fila (fila solo).
  await updateLeg(leg.betId, { status: "na_fila" });

  const team: WaitingDuoTeam = {
    teamId: leg.teamId,
    amount: leg.amount,
    memberIds: [leg.userId],
    legBetIds: [leg.betId],
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
    const user = await client.users.fetch(team.memberIds[0]).catch(() => null);
    await user
      ?.send(`✅ Pagamento confirmado! Você entrou na fila, aguardando um adversário do mesmo valor (R$ ${team.amount.toFixed(2)}).`)
      .catch(() => undefined);

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
