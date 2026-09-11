import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { config } from "../../config";
import { createSoloLeg, isPlayerInAnyLeg } from "../../betting/betLedger";
import { isPlayerInCheckIn } from "../../queue/duoBetCheckin";
import { isPlayerInActiveMatch } from "../../queue/matchmaking";
import { DUO_BET_PAY_BUTTON_ID } from "../buttons/duoBetPayButton";

function buildPayButtonRow(teamId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DUO_BET_PAY_BUTTON_ID}:${teamId}`)
      .setLabel("Pagar minha aposta")
      .setEmoji("💳")
      .setStyle(ButtonStyle.Success)
  );
}

/**
 * Processa a seleção de um valor no menu do painel da fila: valida se o
 * jogador pode entrar (não está em outra aposta/fila/check-in/partida) e
 * cria a perna solo da aposta, oferecendo o botão de pagamento PIX.
 *
 * IMPORTANTE: o Discord exige uma resposta em até 3s ou a interação expira
 * ("This interaction failed", sem nenhum aviso pro usuário). Como as
 * validações abaixo consultam o Firestore (podem demorar, principalmente
 * em cold start), damos `deferReply` ANTES de qualquer chamada assíncrona
 * e usamos `editReply` daí em diante.
 */
export async function handleQueueValueSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const amount = Number(interaction.values[0]);

  if (!config.bet.tiers.includes(amount)) {
    await interaction.reply({ content: "⚠️ Valor inválido.", ephemeral: true });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ content: "⚠️ Use este menu em um servidor.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;

  if (await isPlayerInAnyLeg(userId)) {
    await interaction.editReply({
      content: "⚠️ Você já está em uma aposta pendente, na fila ou em partida.",
    });
    return;
  }

  if (isPlayerInCheckIn(userId)) {
    await interaction.editReply({ content: "⚠️ Você já está em check-in de outra partida." });
    return;
  }

  if (isPlayerInActiveMatch(userId)) {
    await interaction.editReply({ content: "⚠️ Você já está em uma partida em andamento." });
    return;
  }

  const leg = await createSoloLeg({ userId, amount, guildId: interaction.guildId });

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("💳 Falta pagar")
    .setDescription(
      [
        `Você vai entrar na fila apostando **R$ ${amount.toFixed(2)}**.`,
        "",
        "Clique no botão abaixo e pague sua aposta via PIX. Assim que o pagamento for confirmado, você entra automaticamente na fila (limite de **2 jogadores por vez**).",
      ].join("\n")
    );

  await interaction.editReply({ embeds: [embed], components: [buildPayButtonRow(leg.teamId)] });
}
