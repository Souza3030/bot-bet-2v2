import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  Guild,
  TextChannel,
} from "discord.js";
import { DuoBetCheckInSession, MODE_CONFIG, WaitingDuoTeam } from "../types";
import { config } from "../config";
import { createTeamMatch } from "./matchmaking";
import { sendMatchAnnouncement } from "../utils/matchAnnouncement";
import { requeueTeam, getLeg, updateLeg } from "../betting/betLedger";
import { refundTeam } from "../betting/payoutService";
import { markMatchCreated, refreshQueueStatus } from "./betQueueStatus";

export const CHECKIN_BUTTON_ID = "queue_checkin_confirm";

const sessions = new Map<string, DuoBetCheckInSession>();
const busyPlayers = new Set<string>();

export function isPlayerInCheckIn(userId: string): boolean {
  return busyPlayers.has(userId);
}

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function allPlayers(session: DuoBetCheckInSession): string[] {
  return [...session.teamA.memberIds, ...session.teamB.memberIds];
}

function buildCheckInEmbed(session: DuoBetCheckInSession): EmbedBuilder {
  const pot = (session.teamA.amount + session.teamB.amount) * 2;
  const pending = allPlayers(session).filter((id) => !session.confirmed.has(id));

  const teamLine = (team: WaitingDuoTeam, label: string) =>
    team.memberIds
      .map((id) => `${session.confirmed.has(id) ? "✅" : "⏳"} <@${id}>`)
      .join(" • ")
      .replace(/^/, `**${label} (R$ ${team.amount.toFixed(2)}/jogador):** `);

  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`✅ Check-in — Fila ${MODE_CONFIG[session.mode].label}`)
    .setDescription(
      [
        `💰 **Pote da partida: R$ ${pot.toFixed(2)}** (dividido entre a dupla vencedora, descontada a taxa da casa se houver).`,
        `Vocês têm **${config.queue.checkInTimeoutMs / 1000} segundos** para confirmar presença.`,
        "",
        teamLine(session.teamA, "Dupla A"),
        teamLine(session.teamB, "Dupla B"),
        "",
        pending.length > 0
          ? `**Aguardando:** ${pending.map((id) => `<@${id}>`).join(", ")}`
          : "Todos confirmaram! Iniciando partida...",
      ].join("\n")
    );
}

function buildCheckInRow(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CHECKIN_BUTTON_ID}:${sessionId}`)
      .setLabel("Confirmar Presença")
      .setEmoji("🖐️")
      .setStyle(ButtonStyle.Success)
  );
}

export async function startTeamCheckIn(
  guild: Guild,
  channel: TextChannel,
  teamA: WaitingDuoTeam,
  teamB: WaitingDuoTeam
): Promise<void> {
  const sessionId = generateSessionId();

  const session: DuoBetCheckInSession = {
    sessionId,
    mode: "duo",
    channelId: channel.id,
    guildId: guild.id,
    teamA,
    teamB,
    confirmed: new Set(),
    timeout: setTimeout(() => resolveCheckIn(sessionId, guild), config.queue.checkInTimeoutMs),
  };

  sessions.set(sessionId, session);
  allPlayers(session).forEach((id) => busyPlayers.add(id));

  await Promise.all(
    [...teamA.legBetIds, ...teamB.legBetIds].map((betId) => updateLeg(betId, { status: "pareada" }))
  );

  const mentions = allPlayers(session).map((id) => `<@${id}>`).join(" ");

  const message = await channel.send({
    content: mentions,
    embeds: [buildCheckInEmbed(session)],
    components: [buildCheckInRow(sessionId)],
  });

  session.messageId = message.id;
}

export async function handleCheckInButton(interaction: ButtonInteraction): Promise<void> {
  const sessionId = interaction.customId.split(":")[1];
  const session = sessions.get(sessionId);

  if (!session) {
    await interaction.reply({ content: "⚠️ Esta sessão de check-in não está mais ativa.", ephemeral: true });
    return;
  }

  if (!allPlayers(session).includes(interaction.user.id)) {
    await interaction.reply({ content: "⚠️ Você não faz parte desta partida.", ephemeral: true });
    return;
  }

  if (session.confirmed.has(interaction.user.id)) {
    await interaction.reply({ content: "Você já confirmou presença.", ephemeral: true });
    return;
  }

  session.confirmed.add(interaction.user.id);
  await interaction.reply({ content: "✅ Presença confirmada!", ephemeral: true });

  const channel = interaction.guild?.channels.cache.get(session.channelId);
  if (channel?.isTextBased() && session.messageId) {
    const message = await channel.messages.fetch(session.messageId).catch(() => null);
    await message
      ?.edit({ embeds: [buildCheckInEmbed(session)], components: [buildCheckInRow(sessionId)] })
      .catch(() => undefined);
  }

  if (session.confirmed.size === allPlayers(session).length && interaction.guild) {
    clearTimeout(session.timeout);
    await resolveCheckIn(sessionId, interaction.guild);
  }
}

/**
 * Resolve a sessão de check-in.
 * - As 2 duplas confirmam 100%: cria a partida normalmente.
 * - Uma dupla confirma 100% e a outra não: a dupla completa volta pra fila
 *   (mantém o dinheiro em jogo); a dupla incompleta é DESCARTADA e as 2
 *   pernas dela são reembolsadas (mesmo a de quem confirmou — sem o parceiro
 *   não há como jogar 2v2, então o time todo é cancelado).
 * - Nenhuma dupla confirma 100%: as 2 são descartadas e reembolsadas.
 */
async function resolveCheckIn(sessionId: string, guild: Guild): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);
  allPlayers(session).forEach((id) => busyPlayers.delete(id));

  const channel = guild.channels.cache.get(session.channelId);
  const textChannel = channel?.isTextBased() ? channel : null;

  const isTeamFullyConfirmed = (team: WaitingDuoTeam) =>
    team.memberIds.every((id) => session.confirmed.has(id));

  const teamAOk = isTeamFullyConfirmed(session.teamA);
  const teamBOk = isTeamFullyConfirmed(session.teamB);

  if (teamAOk && teamBOk) {
    if (textChannel && session.messageId) {
      const message = await textChannel.messages.fetch(session.messageId).catch(() => null);
      await message
        ?.edit({
          content: "",
          embeds: [
            new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle("✅ Check-in concluído")
              .setDescription("As duas duplas confirmaram presença! Criando a partida..."),
          ],
          components: [],
        })
        .catch(() => undefined);
    }

    try {
      const match = await createTeamMatch(guild, session.mode, session.teamA, session.teamB);
      await sendMatchAnnouncement(guild, match);
      await Promise.all(
        [...session.teamA.legBetIds, ...session.teamB.legBetIds].map((betId) =>
          updateLeg(betId, { status: "em_partida", matchId: match.matchId })
        )
      );
      await markMatchCreated(guild, match.textChannelId);
    } catch (error) {
      console.error("[DuoBetCheckIn] Falha ao criar a partida:", error);
      await refundBothTeams(session.teamA, session.teamB, guild, "falha técnica ao criar a partida");
      await refreshQueueStatus(guild);
    }
    return;
  }

  // Check-in incompleto: dupla completa volta pra fila; dupla incompleta é
  // descartada por inteiro (as 2 pernas reembolsadas).
  const requeued: WaitingDuoTeam[] = [];
  const discarded: WaitingDuoTeam[] = [];

  if (teamAOk) {
    await requeueTeam(session.teamA);
    await Promise.all(session.teamA.legBetIds.map((betId) => updateLeg(betId, { status: "na_fila" })));
    requeued.push(session.teamA);
  } else {
    discarded.push(session.teamA);
  }

  if (teamBOk) {
    await requeueTeam(session.teamB);
    await Promise.all(session.teamB.legBetIds.map((betId) => updateLeg(betId, { status: "na_fila" })));
    requeued.push(session.teamB);
  } else {
    discarded.push(session.teamB);
  }

  for (const team of discarded) {
    const legs = await Promise.all(team.legBetIds.map((betId) => getLeg(betId)));
    const validLegs = legs.filter((l): l is NonNullable<typeof l> => l !== null);
    if (validLegs.length === 2) {
      await refundTeam([validLegs[0], validLegs[1]], guild, "dupla não confirmou presença completa a tempo");
    }
  }

  await refreshQueueStatus(guild);

  if (textChannel && session.messageId) {
    const message = await textChannel.messages.fetch(session.messageId).catch(() => null);
    await message
      ?.edit({
        content: "",
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Check-in falhou")
            .setDescription(
              [
                discarded
                  .map(
                    (team) =>
                      `A dupla ${team.memberIds.map((id) => `<@${id}>`).join(" & ")} não confirmou presença completa e foi reembolsada.`
                  )
                  .join("\n"),
                requeued.length > 0
                  ? `A dupla que confirmou 100% (${requeued
                      .map((t) => t.memberIds.map((id) => `<@${id}>`).join(" & "))
                      .join(", ")}) voltou para a fila aguardando novo adversário.`
                  : "",
              ]
                .filter(Boolean)
                .join("\n\n")
            ),
        ],
        components: [],
      })
      .catch(() => undefined);
  }
}

async function refundBothTeams(
  teamA: WaitingDuoTeam,
  teamB: WaitingDuoTeam,
  guild: Guild,
  reason: string
): Promise<void> {
  for (const team of [teamA, teamB]) {
    const legs = await Promise.all(team.legBetIds.map((betId) => getLeg(betId)));
    const validLegs = legs.filter((l): l is NonNullable<typeof l> => l !== null);
    if (validLegs.length === 2) {
      await refundTeam([validLegs[0], validLegs[1]], guild, reason);
    }
  }
}
