import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ModalBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { ActiveMatch } from "../../types";
import { activeMatches } from "../../queue/matchmaking";
import { config } from "../../config";

export const RESULT_BUTTON_IDS = {
  registerResult: "match_register_result",
  approve: "staff_approve_result",
  reject: "staff_reject_result",
  void: "staff_void_result",
} as const;

export const RESULT_MODAL_ID = "match_result_modal";
export const RESULT_MODAL_INPUTS = {
  scoreA: "score_a",
  scoreB: "score_b",
} as const;

/**
 * Constrói a linha de botão [Registrar Resultado], podendo ser renderizada
 * habilitada (fluxo normal) ou desabilitada (evita cliques/submissões duplicadas).
 */
export function buildRegisterResultRow(
  matchId: string,
  disabled: boolean
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RESULT_BUTTON_IDS.registerResult}:${matchId}`)
      .setLabel(disabled ? "Resultado enviado" : "Registrar Resultado")
      .setEmoji(disabled ? "🕒" : "📝")
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

/**
 * Reabilita o botão de registro na mensagem de anúncio da partida (usado
 * quando a Staff rejeita um resultado e os jogadores precisam poder
 * registrar novamente).
 */
export async function setRegisterResultButtonState(
  match: ActiveMatch,
  guild: import("discord.js").Guild,
  disabled: boolean
): Promise<void> {
  if (!match.announcementMessageId) return;

  const channel = guild.channels.cache.get(match.textChannelId) as TextChannel | undefined;
  if (!channel) return;

  const message = await channel.messages.fetch(match.announcementMessageId).catch(() => null);
  if (!message) return;

  await message
    .edit({ components: [buildRegisterResultRow(match.matchId, disabled)] })
    .catch(() => undefined);
}

/**
 * Abre o modal para o jogador informar o placar da partida.
 * customId esperado: "match_register_result:<matchId>"
 *
 * Antes de abrir o modal, desabilita o botão na mensagem de anúncio para
 * evitar que outro jogador clique simultaneamente e gere registros duplicados.
 */
export async function handleRegisterResultButton(interaction: ButtonInteraction): Promise<void> {
  const matchId = interaction.customId.split(":")[1];
  const match = activeMatches.get(matchId);

  if (!match) {
    await interaction.reply({
      content: "⚠️ Esta partida não está mais ativa.",
      ephemeral: true,
    });
    return;
  }

  const allPlayers = [...match.teamA.memberIds, ...match.teamB.memberIds];
  if (!allPlayers.includes(interaction.user.id)) {
    await interaction.reply({
      content: "⚠️ Apenas jogadores desta partida podem registrar o resultado.",
      ephemeral: true,
    });
    return;
  }

  if (match.resultSubmitted) {
    await interaction.reply({
      content: "⚠️ Um resultado já foi enviado para esta partida e está aguardando análise da Staff.",
      ephemeral: true,
    });
    return;
  }

  // Desabilita o botão imediatamente para evitar cliques duplicados de
  // outros jogadores enquanto este preenche o modal.
  if (interaction.message) {
    await interaction.message
      .edit({ components: [buildRegisterResultRow(matchId, true)] })
      .catch(() => undefined);
  }

  // Rede de segurança: se o jogador fechar o modal sem enviar o placar,
  // o botão não pode ficar desabilitado para sempre. Reabilita
  // automaticamente após alguns minutos, caso nenhum resultado tenha
  // sido submetido nesse meio tempo.
  const guild = interaction.guild;
  if (guild) {
    setTimeout(() => {
      const currentMatch = activeMatches.get(matchId);
      if (currentMatch && !currentMatch.resultSubmitted) {
        setRegisterResultButtonState(currentMatch, guild, false).catch(() => undefined);
      }
    }, config.match.registerButtonSafetyReenableMs);
  }

  const modal = new ModalBuilder()
    .setCustomId(`${RESULT_MODAL_ID}:${matchId}`)
    .setTitle(`Resultado — Partida ${matchId}`);

  const scoreAInput = new TextInputBuilder()
    .setCustomId(RESULT_MODAL_INPUTS.scoreA)
    .setLabel("Placar do Time A")
    .setPlaceholder("Ex: 3")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2);

  const scoreBInput = new TextInputBuilder()
    .setCustomId(RESULT_MODAL_INPUTS.scoreB)
    .setLabel("Placar do Time B")
    .setPlaceholder("Ex: 1")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(scoreAInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(scoreBInput)
  );

  await interaction.showModal(modal);
}
