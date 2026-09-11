import { EmbedBuilder, Guild, TextChannel } from "discord.js";
import { WaitingDuoTeam } from "../types";
import { listWaitingTeams } from "../betting/betLedger";

interface QueueStatusLocation {
  channelId: string;
  messageId: string;
}

const statusMessages = new Map<string, QueueStatusLocation>();

function formatTeam(team: WaitingDuoTeam): string {
  return team.memberIds.map((id) => `<@${id}>`).join(" & ");
}

function buildQueueStatusEmbed(waitingTeams: WaitingDuoTeam[]): EmbedBuilder {
  const lines =
    waitingTeams.length > 0
      ? waitingTeams.map(
          (team) => `${formatTeam(team)} — **R$ ${team.amount.toFixed(2)}** — aguardando adversário`
        )
      : ["Ninguém esperando no momento."];

  return new EmbedBuilder()
    .setColor(waitingTeams.length > 0 ? 0xf1c40f : 0x5865f2)
    .setTitle(`🏐 Fila Apostada Duo (2v2) — ${waitingTeams.length}/2 na fila`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Selecione um valor no menu do painel para entrar na fila." })
    .setTimestamp();
}

async function editStatus(guild: Guild, embed: EmbedBuilder): Promise<boolean> {
  const location = statusMessages.get(guild.id);
  if (!location) return false;

  const channel = await guild.channels.fetch(location.channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return false;

  const message = await channel.messages.fetch(location.messageId).catch(() => null);
  if (!message) return false;

  await message.edit({ embeds: [embed] }).catch(() => undefined);
  return true;
}

export async function updateQueueStatus(guild: Guild, channel: TextChannel): Promise<void> {
  const waitingTeams = await listWaitingTeams();
  const embed = buildQueueStatusEmbed(waitingTeams);
  if (await editStatus(guild, embed)) return;

  const message = await channel.send({ embeds: [embed] });
  statusMessages.set(guild.id, { channelId: channel.id, messageId: message.id });
}

export async function refreshQueueStatus(guild: Guild): Promise<void> {
  const waitingTeams = await listWaitingTeams();
  await editStatus(guild, buildQueueStatusEmbed(waitingTeams));
}

export async function markQueueAsCheckingIn(guild: Guild, teamA: WaitingDuoTeam, teamB: WaitingDuoTeam): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("🏐 Fila Apostada Duo (2v2) — Adversários pareados!")
    .setDescription(
      [
        `**Jogador A:** ${formatTeam(teamA)}`,
        `**Jogador B:** ${formatTeam(teamB)}`,
        `💰 Pote: **R$ ${(teamA.amount + teamB.amount).toFixed(2)}**`,
        "",
        "Os 2 jogadores estão confirmando presença para a partida.",
      ].join("\n")
    )
    .setFooter({ text: "Aguarde a próxima atualização..." })
    .setTimestamp();

  await editStatus(guild, embed);
}

export async function markMatchCreated(guild: Guild, matchChannelId: string): Promise<void> {
  await editStatus(
    guild,
    new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Partida Duo (2v2) criada")
      .setDescription(`Os jogadores foram pareados e a partida foi criada em <#${matchChannelId}>.`)
      .setFooter({ text: "Selecione um valor no menu do painel para entrar em uma nova fila." })
      .setTimestamp()
  );
}
