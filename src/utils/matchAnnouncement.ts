import { EmbedBuilder, Guild, TextChannel } from "discord.js";
import { ActiveMatch } from "../types";
import { MODE_CONFIG } from "../types";
import { buildRegisterResultRow } from "../interactions/buttons/resultButtons";

/**
 * Envia, no canal de texto temporário criado para a partida, a escalação
 * dos times sorteados e o botão para registrar o resultado.
 */
export async function sendMatchAnnouncement(guild: Guild, match: ActiveMatch): Promise<void> {
  const textChannel = guild.channels.cache.get(match.textChannelId) as TextChannel | undefined;
  if (!textChannel) return;

  const mentionsA = match.teamA.memberIds.map((id) => `<@${id}>`).join("\n");
  const mentionsB = match.teamB.memberIds.map((id) => `<@${id}>`).join("\n");
  const allMentions = [...match.teamA.memberIds, ...match.teamB.memberIds]
    .map((id) => `<@${id}>`)
    .join(" ");

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`🏐 Partida ${match.matchId} — ${MODE_CONFIG[match.mode].label}`)
    .setDescription("Times sorteados! Boa sorte a todos. 🍀")
    .addFields(
      { name: "🔵 Time A", value: mentionsA || "—", inline: true },
      { name: "🔴 Time B", value: mentionsB || "—", inline: true }
    )
    .setFooter({ text: "Ao final da partida, registre o resultado abaixo." });

  const row = buildRegisterResultRow(match.matchId, false);

  const message = await textChannel.send({
    content: allMentions,
    embeds: [embed],
    components: [row],
  });

  match.announcementMessageId = message.id;
}
