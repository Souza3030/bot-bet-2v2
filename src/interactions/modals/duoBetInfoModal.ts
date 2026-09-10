import { AttachmentBuilder, EmbedBuilder, ModalSubmitInteraction } from "discord.js";
import { config } from "../../config";
import { PixKeyType } from "../../types";
import { getLeg, updateLeg } from "../../betting/betLedger";
import { createPixPayment } from "../../payments/mercadoPago";

export const BET_INFO_MODAL_ID = "duo_bet_info_modal";

export const BET_INFO_MODAL_INPUTS = {
  pixKey: "pix_key",
  pixKeyType: "pix_key_type",
  ownerDocument: "owner_document",
} as const;

const VALID_PIX_KEY_TYPES: PixKeyType[] = ["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"];

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Processa o envio do modal de dados PIX de uma perna da dupla: valida os
 * campos e gera a cobrança PIX no Mercado Pago para o valor já definido
 * no convite.
 * customId esperado: "duo_bet_info_modal:<betId>"
 */
export async function handleBetInfoModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const betId = interaction.customId.split(":")[1];
  const leg = await getLeg(betId);

  if (!leg || leg.userId !== interaction.user.id) {
    await interaction.reply({ content: "⚠️ Esta aposta não foi encontrada.", ephemeral: true });
    return;
  }

  if (leg.status !== "aguardando_pagamento") {
    await interaction.reply({ content: "⚠️ Esta aposta não está mais aguardando pagamento.", ephemeral: true });
    return;
  }

  const rawPixKey = interaction.fields.getTextInputValue(BET_INFO_MODAL_INPUTS.pixKey).trim();
  const rawPixKeyType = interaction.fields
    .getTextInputValue(BET_INFO_MODAL_INPUTS.pixKeyType)
    .trim()
    .toUpperCase();
  const rawOwnerDocument = onlyDigits(
    interaction.fields.getTextInputValue(BET_INFO_MODAL_INPUTS.ownerDocument)
  );

  if (!VALID_PIX_KEY_TYPES.includes(rawPixKeyType as PixKeyType)) {
    await interaction.reply({
      content: `⚠️ Tipo de chave PIX inválido. Use um destes: ${VALID_PIX_KEY_TYPES.join(", ")}.`,
      ephemeral: true,
    });
    return;
  }

  if (rawOwnerDocument.length !== 11 && rawOwnerDocument.length !== 14) {
    await interaction.reply({
      content: "⚠️ CPF/CNPJ inválido. Informe apenas números (11 dígitos para CPF, 14 para CNPJ).",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  await updateLeg(leg.betId, {
    pixKey: rawPixKey,
    pixKeyType: rawPixKeyType as PixKeyType,
    pixOwnerDocument: rawOwnerDocument,
  });

  try {
    const payerEmail = `${interaction.user.id}@${config.bet.payerEmailDomain}`;
    const payment = await createPixPayment(
      leg.amount,
      leg.betId,
      payerEmail,
      `MamoBall — Aposta Duo (2v2) R$ ${leg.amount.toFixed(2)}`
    );

    await updateLeg(leg.betId, { paymentId: payment.paymentId });

    const qrImage = new AttachmentBuilder(Buffer.from(payment.qrCodeBase64, "base64"), {
      name: "pix-qrcode.png",
    });

    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle(`💰 Pague R$ ${leg.amount.toFixed(2)} via PIX pra confirmar sua parte`)
      .setDescription(
        [
          "Escaneie o QR Code ou copie o código abaixo no app do seu banco.",
          "",
          "**PIX Copia e Cola:**",
          `\`\`\`${payment.qrCode}\`\`\``,
          "",
          `⏳ Este código expira em **${config.bet.paymentExpirationMs / 60000} minutos**.`,
          "Assim que o pagamento for confirmado, avisamos você. A dupla entra na fila quando os dois pagarem.",
        ].join("\n")
      )
      .setImage("attachment://pix-qrcode.png")
      .setFooter({ text: `ID da aposta: ${leg.betId}` });

    await interaction.editReply({ embeds: [embed], files: [qrImage] });
  } catch (error) {
    console.error("[DuoBetInfoModal] Falha ao criar cobrança PIX:", error);
    await interaction.editReply({
      content: "❌ Não foi possível gerar a cobrança PIX agora. Tente novamente clicando em [Pagar minha aposta].",
    });
  }
}
