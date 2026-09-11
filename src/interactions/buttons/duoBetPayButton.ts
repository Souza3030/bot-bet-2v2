import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { findLegByTeamAndUser } from "../../betting/betLedger";
import { BET_INFO_MODAL_ID, BET_INFO_MODAL_INPUTS } from "../modals/duoBetInfoModal";

export const DUO_BET_PAY_BUTTON_ID = "duo_bet_pay";

/**
 * Processa o clique em "Pagar minha aposta": localiza a perna do jogador
 * dentro da dupla e abre o modal pedindo os dados PIX pra gerar a cobrança.
 * customId esperado: "duo_bet_pay:<teamId>"
 */
export async function handleDuoBetPayButton(interaction: ButtonInteraction): Promise<void> {
  const teamId = interaction.customId.split(":")[1];

  const leg = await findLegByTeamAndUser(teamId, interaction.user.id);

  if (!leg) {
    await interaction.reply({
      content: "⚠️ Esta aposta não foi encontrada.",
      ephemeral: true,
    });
    return;
  }

  if (leg.status !== "aguardando_pagamento") {
    await interaction.reply({
      content:
        leg.status === "na_fila"
          ? "✅ Você já pagou! Já está na fila aguardando adversário."
          : "⚠️ Esta aposta não está mais aguardando pagamento.",
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${BET_INFO_MODAL_ID}:${leg.betId}`)
    .setTitle(`Sua parte: R$ ${leg.amount.toFixed(2)} — Dados PIX`);

  const pixKeyInput = new TextInputBuilder()
    .setCustomId(BET_INFO_MODAL_INPUTS.pixKey)
    .setLabel("Sua chave PIX (pra receber se vencer)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("CPF, e-mail, telefone ou chave aleatória")
    .setRequired(true);

  const pixKeyTypeInput = new TextInputBuilder()
    .setCustomId(BET_INFO_MODAL_INPUTS.pixKeyType)
    .setLabel("Tipo da chave PIX")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("CPF, CNPJ, EMAIL, PHONE ou RANDOM")
    .setRequired(true);

  const ownerDocumentInput = new TextInputBuilder()
    .setCustomId(BET_INFO_MODAL_INPUTS.ownerDocument)
    .setLabel("CPF ou CNPJ do titular da chave PIX")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Apenas números")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(pixKeyInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(pixKeyTypeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(ownerDocumentInput)
  );

  await interaction.showModal(modal);
}
