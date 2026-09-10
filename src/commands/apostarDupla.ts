import {
  ChannelType,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { config } from "../config";
import { createInvite, hasPendingInvite } from "../betting/duoBetInvites";
import { buildInviteEmbed, buildInviteRow, handleInviteExpired } from "../interactions/buttons/duoBetInviteButtons";
import { isPlayerInAnyLeg } from "../betting/betLedger";
import { isPlayerInCheckIn } from "../queue/duoBetCheckin";
import { isPlayerInActiveMatch } from "../queue/matchmaking";

export const data = new SlashCommandBuilder()
  .setName("apostar-dupla")
  .setDescription("Convida um parceiro para formar dupla apostada e entrar na fila Duo (2v2).")
  .addUserOption((option) =>
    option.setName("parceiro").setDescription("Quem vai jogar com você").setRequired(true)
  )
  .addNumberOption((option) =>
    option
      .setName("valor")
      .setDescription("Quanto cada um vai apostar (R$)")
      .setRequired(true)
      .addChoices(...config.bet.tiers.map((value) => ({ name: `R$ ${value.toFixed(2)}`, value })))
  );

async function checkUnavailable(userId: string): Promise<string | null> {
  if (await isPlayerInAnyLeg(userId)) return `<@${userId}> já está em uma aposta pendente, na fila ou em partida.`;
  if (isPlayerInCheckIn(userId)) return `<@${userId}> já está em check-in de outra partida.`;
  if (isPlayerInActiveMatch(userId)) return `<@${userId}> já está em uma partida em andamento.`;
  if (hasPendingInvite(userId)) return `<@${userId}> já tem um convite de dupla pendente.`;
  return null;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const partner = interaction.options.getUser("parceiro", true);
  const amount = interaction.options.getNumber("valor", true);
  const inviter = interaction.user;

  if (partner.id === inviter.id) {
    await interaction.reply({ content: "⚠️ Você não pode convidar a si mesmo.", ephemeral: true });
    return;
  }

  if (partner.bot) {
    await interaction.reply({ content: "⚠️ Você não pode convidar um bot.", ephemeral: true });
    return;
  }

  const inviterBlocked = await checkUnavailable(inviter.id);
  if (inviterBlocked) {
    await interaction.reply({ content: `⚠️ Você não pode enviar um convite agora: ${inviterBlocked}`, ephemeral: true });
    return;
  }

  const partnerBlocked = await checkUnavailable(partner.id);
  if (partnerBlocked) {
    await interaction.reply({ content: `⚠️ ${partnerBlocked}`, ephemeral: true });
    return;
  }

  if (interaction.channel?.type !== ChannelType.GuildText) {
    await interaction.reply({ content: "⚠️ Use este comando em um canal de texto do servidor.", ephemeral: true });
    return;
  }

  const channel = interaction.channel as TextChannel;

  const invite = createInvite(inviter.id, partner.id, amount, interaction.guildId!, channel.id, (expired) => {
    handleInviteExpired(expired, channel).catch((err) =>
      console.error("[ApostarDupla] Erro ao marcar convite expirado:", err)
    );
  });

  await interaction.reply({
    content: `<@${partner.id}>`,
    embeds: [buildInviteEmbed(invite)],
    components: [buildInviteRow(invite.inviteId)],
  });

  const message = await interaction.fetchReply();
  invite.messageId = message.id;
}
