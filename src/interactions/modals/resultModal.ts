import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalSubmitInteraction,
  TextChannel,
} from "discord.js";
import { activeMatches } from "../../queue/matchmaking";
import { RESULT_BUTTON_IDS, RESULT_MODAL_INPUTS } from "../buttons/resultButtons";
import { config } from "../../config";
import { MODE_CONFIG } from "../../types";
import { setRegisterResultButtonState } from "../buttons/resultButtons";

async function resetPendingResult(
  match: (typeof activeMatches extends Map<string, infer T> ? T : never),
  guild: ModalSubmitInteraction["guild"]
): Promise<void> {
  match.resultSubmitted = undefined;

  if (guild) {
    await setRegisterResultButtonState(match, guild, false);
  }
}

/**
 * Processa a submissão do modal de resultado: valida o placar, monta o
 * painel de aprovação e o envia ao canal da Staff.
 * customId esperado: "match_result_modal:<matchId>"
 */
export async function handleResultModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const matchId = interaction.customId.split(":")[1];
  const match = activeMatches.get(matchId);

  if (!match) {
    await interaction.reply({ content: "⚠️ Esta partida não está mais ativa.", ephemeral: true });
    return;
  }

  const rawScoreA = interaction.fields.getTextInputValue(RESULT_MODAL_INPUTS.scoreA);
  const rawScoreB = interaction.fields.getTextInputValue(RESULT_MODAL_INPUTS.scoreB);

  const scoreA = Number(rawScoreA);
  const scoreB = Number(rawScoreB);

  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    await interaction.reply({
      content: "⚠️ Placar inválido. Utilize apenas números inteiros positivos.",
      ephemeral: true,
    });
    return;
  }

  if (scoreA === scoreB) {
    await interaction.reply({
      content: "⚠️ O MamoBall não permite empate. Informe um placar com vencedor.",
      ephemeral: true,
    });
    return;
  }

  const winner: "A" | "B" = scoreA > scoreB ? "A" : "B";

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
      content: "⚠️ Um resultado já está aguardando análise da Staff.",
      ephemeral: true,
    });
    return;
  }

  match.resultSubmitted = {
    matchId,
    submittedBy: interaction.user.id,
    scoreA,
    scoreB,
    winner,
  };

  const guild = interaction.guild;
  if (!guild) {
    await resetPendingResult(match, guild);
    await interaction.reply({ content: "⚠️ Esta ação só funciona em servidores.", ephemeral: true });
    return;
  }

  const staffChannel = guild.channels.cache.get(config.channels.staffChannelId) as
    | TextChannel
    | undefined;

  if (!staffChannel) {
    await resetPendingResult(match, guild);
    await interaction.reply({
      content: "⚠️ Canal da Staff não encontrado. Contate um administrador.",
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📋 Resultado pendente — Partida ${matchId}`)
    .setDescription(`Modalidade: **${MODE_CONFIG[match.mode].label}**`)
    .addFields(
      {
        name: "🔵 Time A",
        value: `${match.teamA.memberIds.map((id) => `<@${id}>`).join(", ")}\n**Placar:** ${scoreA}`,
        inline: false,
      },
      {
        name: "🔴 Time B",
        value: `${match.teamB.memberIds.map((id) => `<@${id}>`).join(", ")}\n**Placar:** ${scoreB}`,
        inline: false,
      },
      { name: "Vencedor", value: winner === "A" ? "🔵 Time A" : "🔴 Time B" },
      { name: "Enviado por", value: `<@${interaction.user.id}>` }
    )
    .setFooter({ text: "Aprove ou rejeite o resultado abaixo." });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RESULT_BUTTON_IDS.approve}:${matchId}`)
      .setLabel("Aprovar")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${RESULT_BUTTON_IDS.reject}:${matchId}`)
      .setLabel("Rejeitar")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${RESULT_BUTTON_IDS.void}:${matchId}`)
      .setLabel("Anular Partida")
      .setEmoji("🚫")
      .setStyle(ButtonStyle.Secondary)
  );

  try {
    const staffMessage = await staffChannel.send({ embeds: [embed], components: [row] });
    match.resultSubmitted.staffMessageId = staffMessage.id;
  } catch (error) {
    await resetPendingResult(match, guild);
    console.error(`[ResultModal] Falha ao enviar resultado da partida ${matchId} à Staff:`, error);
    await interaction.reply({
      content: "⚠️ Não foi possível enviar o resultado à Staff. Tente novamente.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: "✅ Resultado enviado para aprovação da Staff. Aguarde a confirmação.",
    ephemeral: true,
  });
}
