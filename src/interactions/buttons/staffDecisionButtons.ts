import { ButtonInteraction, EmbedBuilder } from "discord.js";
import { activeMatches, activeMatchTeams } from "../../queue/matchmaking";
import { deleteMatchChannels } from "../../utils/channelManager";
import { config } from "../../config";
import { RESULT_BUTTON_IDS, setRegisterResultButtonState } from "./resultButtons";
import { getLeg } from "../../betting/betLedger";
import { payoutWinningTeam, refundTeam } from "../../betting/payoutService";

export async function handleStaffDecisionButton(interaction: ButtonInteraction): Promise<void> {
  const [action, matchId] = interaction.customId.split(":");
  const match = activeMatches.get(matchId);
  const teams = activeMatchTeams.get(matchId);
  const guild = interaction.guild;

  if (!guild) return;

  if (!match || !match.resultSubmitted) {
    await interaction.update({
      content: "⚠️ Esta partida não possui mais um resultado pendente.",
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === RESULT_BUTTON_IDS.reject) {
    await interaction.update({
      content: `❌ Resultado da partida **${matchId}** rejeitado por <@${interaction.user.id}>. Peça para os jogadores registrarem novamente.`,
      embeds: [],
      components: [],
    });
    match.resultSubmitted = undefined;
    await setRegisterResultButtonState(match, guild, false);
    return;
  }

  if (action === RESULT_BUTTON_IDS.void) {
    await interaction.update({
      content: `🚫 Anulando a partida **${matchId}** e reembolsando as duas duplas...`,
      embeds: [],
      components: [],
    });

    if (teams) {
      for (const team of [teams.teamA, teams.teamB]) {
        const [legA, legB] = await Promise.all(team.legBetIds.map((id) => getLeg(id)));
        if (legA && legB) await refundTeam([legA, legB], guild, "partida anulada pela Staff");
      }
    } else {
      console.error(`[StaffDecision] Duplas da partida ${matchId} não encontradas para reembolso.`);
    }

    const voidEmbed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle(`🚫 Partida ${matchId} anulada`)
      .setDescription(
        "Esta partida foi anulada pela Staff. As duas duplas foram reembolsadas via Mercado Pago.\n" +
          "Os canais temporários serão removidos em 10 segundos."
      )
      .setFooter({ text: `Anulada por ${interaction.user.username}` })
      .setTimestamp();

    await interaction.message.edit({ content: "", embeds: [voidEmbed], components: [] });

    const textChannel = guild.channels.cache.get(match.textChannelId);
    if (textChannel?.isTextBased()) {
      await textChannel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x95a5a6)
              .setDescription(
                "🚫 Esta partida foi **anulada** pela Staff. As duas duplas foram reembolsadas. O canal será removido em instantes."
              ),
          ],
        })
        .catch(() => undefined);
    }

    setTimeout(async () => {
      await deleteMatchChannels(guild, {
        categoryId: match.categoryId,
        textChannelId: match.textChannelId,
        voiceChannelAId: match.voiceChannelAId,
        voiceChannelBId: match.voiceChannelBId,
      });
      activeMatches.delete(matchId);
      activeMatchTeams.delete(matchId);
    }, config.match.deleteChannelsDelayMs);

    return;
  }

  if (action === RESULT_BUTTON_IDS.approve) {
    await interaction.update({
      content: `⏳ Aprovando resultado da partida **${matchId}** e processando o pagamento...`,
      embeds: [],
      components: [],
    });

    const { winner, scoreA, scoreB } = match.resultSubmitted;

    if (!teams) {
      console.error(`[StaffDecision] Duplas da partida ${matchId} não encontradas para payout.`);
      await interaction.message
        .edit({
          content: "",
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle(`⚠️ Erro ao pagar a partida ${matchId}`)
              .setDescription(
                "Não encontrei o registro das duplas desta partida (o bot pode ter reiniciado). " +
                  "Verifique manualmente no Firestore (coleção `duoBetLegs`) e pague os vencedores."
              ),
          ],
          components: [],
        })
        .catch(() => undefined);
      return;
    }

    const winningTeam = winner === "A" ? teams.teamA : teams.teamB;
    const losingTeam = winner === "A" ? teams.teamB : teams.teamA;

    const [winnerLegs, loserLegs] = await Promise.all([
      Promise.all(winningTeam.legBetIds.map((id) => getLeg(id))),
      Promise.all(losingTeam.legBetIds.map((id) => getLeg(id))),
    ]);

    if (winnerLegs[0] && winnerLegs[1] && loserLegs[0] && loserLegs[1]) {
      await payoutWinningTeam(
        guild,
        [winnerLegs[0], winnerLegs[1]],
        [loserLegs[0], loserLegs[1]]
      );
    } else {
      console.error(`[StaffDecision] Registro de apostas ausente para a partida ${matchId}.`);
    }

    const confirmationEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`✅ Partida ${matchId} aprovada`)
      .setDescription(
        `Placar final: **Time A ${scoreA} x ${scoreB} Time B**\n` +
          `Dupla vencedora: ${winner === "A" ? "🔵 Time A" : "🔴 Time B"} — ${winningTeam.memberIds
            .map((id) => `<@${id}>`)
            .join(" & ")}\n\n` +
          `Pagamento processado (ou encaminhado à Staff, se o payout automático não estiver disponível). ` +
          `Os canais temporários serão removidos em 10 segundos.`
      )
      .setFooter({ text: `Aprovado por ${interaction.user.username}` })
      .setTimestamp();

    await interaction.message.edit({ content: "", embeds: [confirmationEmbed], components: [] });

    setTimeout(async () => {
      await deleteMatchChannels(guild, {
        categoryId: match.categoryId,
        textChannelId: match.textChannelId,
        voiceChannelAId: match.voiceChannelAId,
        voiceChannelBId: match.voiceChannelBId,
      });
      activeMatches.delete(matchId);
      activeMatchTeams.delete(matchId);
    }, config.match.deleteChannelsDelayMs);
  }
}
