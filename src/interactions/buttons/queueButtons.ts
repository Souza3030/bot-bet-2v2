import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { config } from "../../config";
import { leaveTeamQueue, getLeg, cancelUnpaidLeg } from "../../betting/betLedger";
import { refundTeam } from "../../betting/payoutService";
import { refreshQueueStatus } from "../../queue/betQueueStatus";
import { cancelPayment } from "../../payments/mercadoPago";

export const QUEUE_BUTTON_IDS = {
  leave: "queue_leave",
  info: "queue_info",
} as const;

export const QUEUE_VALUE_SELECT_ID = "queue_value_select";

/**
 * Monta o menu de seleção de valor da aposta. Cada opção representa um
 * valor fixo configurado em `config.bet.tiers`. A opção do menor valor
 * fica marcada como padrão (`setDefault`) para que o menu já apareça com
 * um valor selecionado ao invés de só o placeholder genérico.
 */
function buildValueSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(QUEUE_VALUE_SELECT_ID)
    .setPlaceholder("💰 Selecione o valor da aposta e entre na fila")
    .addOptions(
      config.bet.tiers.map((value, index) =>
        ({
          label: `R$ ${value.toFixed(2)}`,
          description: `Entrar na fila apostando R$ ${value.toFixed(2)}`,
          value: String(value),
          emoji: "💰",
          default: index === 0,
        })
      )
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildActionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(QUEUE_BUTTON_IDS.info)
      .setLabel("Saiba Mais")
      .setEmoji("📖")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(QUEUE_BUTTON_IDS.leave)
      .setLabel("Sair da fila")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Danger)
  );
}

export function buildQueuePanel() {
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("🏐 MamoBall — Fila Apostada Duo (2v2)")
    .setDescription(
      [
        "Aposte contra outro jogador em partidas 1x1 e ganhe o pote via PIX.",
        "",
        `Valores disponíveis: ${config.bet.tiers.map((v) => `R$ ${v}`).join(" • ")}`,
        "",
        "Selecione um valor no menu abaixo para entrar na fila. Apenas **2 jogadores por vez** ficam na fila — assim que você e outro jogador do mesmo valor pagarem, a partida começa.",
        "",
        "⚠️ Apostas em dinheiro real envolvem risco. Jogue com responsabilidade.",
      ].join("\n")
    )
    .setFooter({ text: "MamoBall Bet System" });

  if (config.branding.bannerUrl) {
    embed.setImage(config.branding.bannerUrl);
  }

  return { embeds: [embed], components: [buildValueSelectRow(), buildActionRow()] };
}

function buildInfoEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📖 Como funciona a fila Duo (2v2)")
    .setDescription(
      [
        "1️⃣ Selecione o valor da aposta no menu do painel.",
        "2️⃣ Pague sua parte via PIX (o código é gerado na hora).",
        "3️⃣ Assim que o pagamento for confirmado, você entra na fila. **Só 2 jogadores por vez** ficam esperando — você aguarda até outro jogador do mesmo valor pagar também.",
        "4️⃣ Encontrado o adversário, os dois confirmam presença (check-in) e a partida é criada em canais temporários.",
        "5️⃣ Quem vencer leva o pote (as 2 apostas, menos taxa da casa se houver), pago automaticamente via PIX.",
        "",
        "Se quiser sair enquanto ainda espera adversário, use o botão **Sair da fila** (sua aposta é reembolsada). Se ainda não pagou o PIX, o mesmo botão cancela a cobrança pendente (nenhum valor é cobrado).",
      ].join("\n")
    );
}

export async function handleQueueButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guild } = interaction;

  if (customId === QUEUE_BUTTON_IDS.info) {
    await interaction.reply({ embeds: [buildInfoEmbed()], ephemeral: true });
    return;
  }

  if (!guild) {
    await interaction.reply({ content: "Este comando só funciona em servidores.", ephemeral: true });
    return;
  }

  if (customId !== QUEUE_BUTTON_IDS.leave) return;

  const removedTeam = await leaveTeamQueue(user.id);

  if (removedTeam) {
    await interaction.deferReply({ ephemeral: true });

    const leg = await getLeg(removedTeam.legBetIds[0]);
    if (leg) {
      await refundTeam([leg], guild, "jogador saiu da fila voluntariamente");
    }

    await interaction.editReply({
      content: `✅ Você saiu da fila. Sua aposta de R$ ${removedTeam.amount.toFixed(2)} foi reembolsada.`,
    });

    await refreshQueueStatus(guild);
    return;
  }

  // Não estava na fila de pareamento (dupla paga) — mas pode ter uma aposta
  // selecionada e ainda não paga (perna travada em "aguardando_pagamento",
  // que hoje só se resolvia sozinha após legPaymentTimeoutMs). "Sair da
  // fila" também cancela esse caso, já que nenhum dinheiro foi movimentado.
  const cancelledLeg = await cancelUnpaidLeg(user.id);

  if (!cancelledLeg) {
    await interaction.reply({
      content:
        "Você não está esperando na fila (ou já foi pareado — nesse caso, é só não confirmar presença no check-in que você é reembolsado automaticamente).",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Best-effort: cancela a cobrança PIX pendente no Mercado Pago para
  // evitar a corrida em que o jogador paga logo depois de já ter
  // cancelado por aqui. Se falhar (ex.: já foi paga nesse meio-tempo), o
  // webhook segue tratando a aprovação normalmente pelo fluxo existente.
  if (cancelledLeg.paymentId) {
    await cancelPayment(cancelledLeg.paymentId).catch((err) =>
      console.error("[QueueButtons] Falha ao cancelar cobrança PIX pendente no Mercado Pago:", err)
    );
  }

  await interaction.editReply({
    content: `✅ Sua aposta pendente de R$ ${cancelledLeg.amount.toFixed(2)} foi cancelada. Como o PIX ainda não tinha sido pago, nenhum valor foi cobrado — você já pode entrar na fila de novo.`,
  });

  await refreshQueueStatus(guild);
}
