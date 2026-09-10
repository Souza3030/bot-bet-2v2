import { EmbedBuilder, Guild, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { config } from "../config";
import { BetLeg } from "../types";
import { payoutPix, refundPayment } from "../payments/mercadoPago";
import { updateLeg } from "./betLedger";

export const MANUAL_PAYOUT_BUTTON_ID = "duo_bet_manual_paid";

/** Reembolsa uma perna de aposta individual via Mercado Pago. */
export async function refundLeg(leg: BetLeg, guild: Guild, reason: string): Promise<void> {
  if (!leg.paymentId) {
    // Nunca chegou a pagar (ex: convite/pagamento nem foi concluído) — nada a reembolsar.
    await updateLeg(leg.betId, { status: "cancelada" });
    return;
  }

  try {
    await refundPayment(leg.paymentId);
    await updateLeg(leg.betId, { status: "reembolsada" });
  } catch (error) {
    console.error(`[Payout] Falha ao reembolsar perna ${leg.betId}:`, error);
    await notifyStaffManualAction(
      guild,
      `⚠️ **Reembolso automático falhou** para <@${leg.userId}> (aposta ${leg.betId}, R$ ${leg.amount.toFixed(
        2
      )}). Motivo: ${reason}. Verifique o pagamento **${leg.paymentId}** manualmente no painel do Mercado Pago.`
    );
    return;
  }

  const user = await guild.client.users.fetch(leg.userId).catch(() => null);
  await user
    ?.send(`💸 Sua aposta de **R$ ${leg.amount.toFixed(2)}** foi reembolsada automaticamente. Motivo: ${reason}`)
    .catch(() => undefined);
}

/** Reembolsa as 2 pernas de uma dupla (usado quando a dupla inteira é descartada). */
export async function refundTeam(legs: [BetLeg, BetLeg], guild: Guild, reason: string): Promise<void> {
  await Promise.all(legs.map((leg) => refundLeg(leg, guild, reason)));
}

/**
 * Paga os 2 jogadores da dupla vencedora, dividindo o pote (as 4 apostas,
 * menos a taxa da casa) igualmente entre eles. Cada payout é tentado
 * individualmente — se um falhar, o outro não é afetado, e o que falhou
 * cai no fallback manual para a Staff.
 */
export async function payoutWinningTeam(
  guild: Guild,
  winnerLegs: [BetLeg, BetLeg],
  loserLegs: [BetLeg, BetLeg]
): Promise<void> {
  const pot = winnerLegs.reduce((sum, l) => sum + l.amount, 0) + loserLegs.reduce((sum, l) => sum + l.amount, 0);
  const houseFee = pot * (config.bet.houseFeePercent / 100);
  const totalPayout = pot - houseFee;
  const perWinner = Math.round((totalPayout / 2) * 100) / 100;

  await Promise.all(loserLegs.map((leg) => updateLeg(leg.betId, { status: "perdida" })));

  await Promise.all(
    winnerLegs.map(async (leg) => {
      if (!leg.pixKey || !leg.pixKeyType || !leg.pixOwnerDocument) {
        console.error(`[Payout] Perna vencedora ${leg.betId} sem dados PIX completos.`);
        await updateLeg(leg.betId, { status: "pagamento_manual_pendente" });
        await notifyStaffManualPayout(guild, leg, perWinner);
        return;
      }

      try {
        const result = await payoutPix({
          amount: perWinner,
          pixKey: leg.pixKey,
          pixKeyType: leg.pixKeyType,
          ownerDocument: leg.pixOwnerDocument,
          externalReference: `payout-${leg.betId}`,
        });

        await updateLeg(leg.betId, { status: "paga_vencedor" });

        const user = await guild.client.users.fetch(leg.userId).catch(() => null);
        await user
          ?.send(
            `🏆 Sua dupla venceu! **R$ ${perWinner.toFixed(2)}** foram enviados via PIX para sua chave ` +
              `(comprovante: transação \`${result.transactionId}\`).`
          )
          .catch(() => undefined);
      } catch (error) {
        console.error(`[Payout] Falha ao pagar vencedor (aposta ${leg.betId}):`, error);
        await updateLeg(leg.betId, { status: "pagamento_manual_pendente" });
        await notifyStaffManualPayout(guild, leg, perWinner);
      }
    })
  );
}

async function notifyStaffManualAction(guild: Guild, message: string): Promise<void> {
  const staffChannel = guild.channels.cache.get(config.channels.staffChannelId) as TextChannel | undefined;
  if (!staffChannel) {
    console.error("[Payout] Canal da Staff não encontrado para notificação manual:", message);
    return;
  }
  await staffChannel.send(message).catch(() => undefined);
}

async function notifyStaffManualPayout(guild: Guild, leg: BetLeg, payoutAmount: number): Promise<void> {
  const staffChannel = guild.channels.cache.get(config.channels.staffChannelId) as TextChannel | undefined;
  if (!staffChannel) {
    console.error(`[Payout] Canal da Staff não encontrado. Pagamento manual pendente para ${leg.userId}.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("⚠️ Pagamento automático falhou — ação manual necessária")
    .setDescription(
      [
        "O payout automático via Mercado Pago não pôde ser concluído (a API de Payouts pode não estar habilitada/aprovada para esta conta ainda, ou os dados PIX estão incompletos).",
        "",
        `**Vencedor:** <@${leg.userId}>`,
        `**Valor a pagar:** R$ ${payoutAmount.toFixed(2)}`,
        `**Chave PIX:** \`${leg.pixKey ?? "não informada"}\` (${leg.pixKeyType ?? "?"})`,
        `**CPF/CNPJ do titular:** \`${leg.pixOwnerDocument ?? "não informado"}\``,
        `**ID da aposta:** \`${leg.betId}\``,
        "",
        "Faça a transferência manualmente e clique no botão abaixo para marcar como pago.",
      ].join("\n")
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MANUAL_PAYOUT_BUTTON_ID}:${leg.betId}`)
      .setLabel("Marcar como pago manualmente")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );

  await staffChannel.send({ embeds: [embed], components: [row] }).catch(() => undefined);
}

export async function handleManualPayoutButton(
  betId: string,
  markedBy: string
): Promise<{ ok: boolean; message: string }> {
  await updateLeg(betId, { status: "paga_vencedor" });
  return { ok: true, message: `✅ Aposta \`${betId}\` marcada como paga manualmente por <@${markedBy}>.` };
}
