import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder } from "discord.js";
import { config } from "../../config";
import { leaveTeamQueue, getLeg } from "../../betting/betLedger";
import { refundTeam } from "../../betting/payoutService";
import { refreshQueueStatus } from "../../queue/betQueueStatus";

export const QUEUE_BUTTON_IDS = {
  leave: "queue_leave",
} as const;

export function buildQueuePanel() {
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("MamoBall — Fila Apostada Duo (2v2)")
    .setDescription(
      [
        "Use `/apostar-dupla parceiro:@alguém valor:<R$>` para convidar um parceiro.",
        "",
        `Valores disponíveis (por jogador): ${config.bet.tiers.map((v) => `R$ ${v}`).join(" • ")}`,
        "",
        "Depois que seu parceiro aceitar, cada um de vocês paga sua própria parte via PIX. A dupla só entra na fila quando os dois pagarem, e só é pareada com outra dupla que apostou o **mesmo valor por jogador**.",
        "",
        "Quem vencer divide o pote (as 4 apostas, menos taxa da casa se houver) igualmente entre os 2, pago automaticamente via PIX.",
        "",
        "⚠️ Apostas em dinheiro real envolvem risco. Jogue com responsabilidade.",
        "",
        "Se quiser sair da fila enquanto sua dupla ainda espera adversário, use o botão abaixo (as 2 apostas são reembolsadas).",
      ].join("\n")
    )
    .setFooter({ text: "MamoBall Bet System" });

  if (config.branding.bannerUrl) {
    embed.setImage(config.branding.bannerUrl);
  }

  const leaveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(QUEUE_BUTTON_IDS.leave)
      .setLabel("Sair da fila (reembolso da dupla)")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [leaveRow] };
}

export async function handleQueueButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guild } = interaction;

  if (!guild) {
    await interaction.reply({ content: "Este comando só funciona em servidores.", ephemeral: true });
    return;
  }

  if (customId !== QUEUE_BUTTON_IDS.leave) return;

  const removedTeam = await leaveTeamQueue(user.id);

  if (!removedTeam) {
    await interaction.reply({
      content:
        "Sua dupla não está esperando na fila (ou já foi pareada — nesse caso, é só não confirmar presença no check-in que vocês são reembolsados automaticamente).",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const [legA, legB] = await Promise.all(removedTeam.legBetIds.map((id) => getLeg(id)));
  if (legA && legB) {
    await refundTeam([legA, legB], guild, "dupla saiu da fila voluntariamente");
  }

  await interaction.editReply({
    content: `✅ Sua dupla saiu da fila. As duas apostas de R$ ${removedTeam.amount.toFixed(2)} foram reembolsadas.`,
  });

  await refreshQueueStatus(guild);
}
