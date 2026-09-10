import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { DuoBetInvite } from "../../types";
import { getInvite, resolveInvite } from "../../betting/duoBetInvites";
import { createTeamLegs } from "../../betting/betLedger";
import { DUO_BET_PAY_BUTTON_ID } from "./duoBetPayButton";

export const DUO_BET_INVITE_BUTTON_IDS = {
  accept: "duo_bet_invite_accept",
  decline: "duo_bet_invite_decline",
} as const;

export function buildInviteRow(inviteId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DUO_BET_INVITE_BUTTON_IDS.accept}:${inviteId}`)
      .setLabel("Aceitar")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${DUO_BET_INVITE_BUTTON_IDS.decline}:${inviteId}`)
      .setLabel("Recusar")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );
}

export function buildInviteEmbed(invite: DuoBetInvite, statusFooter?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🤝 Convite de Dupla Apostada — Fila 2v2")
    .setDescription(
      [
        `<@${invite.inviterId}> quer formar dupla com <@${invite.partnerId}> apostando **R$ ${invite.amount.toFixed(
          2
        )} cada um** na fila 2v2.`,
        "",
        `<@${invite.partnerId}>, aceita?`,
        "",
        "⚠️ Ao aceitar, cada um de vocês vai precisar pagar sua própria parte via PIX antes da dupla entrar na fila.",
      ].join("\n")
    )
    .setFooter({ text: statusFooter ?? "Convite expira em alguns minutos." });
}

export async function handleInviteExpired(invite: DuoBetInvite, channel: TextChannel): Promise<void> {
  if (!invite.messageId) return;
  const message = await channel.messages.fetch(invite.messageId).catch(() => null);
  await message
    ?.edit({ embeds: [buildInviteEmbed(invite, "⌛ Convite expirado.").setColor(0x99aab5)], components: [] })
    .catch(() => undefined);
}

function buildPayButtonRow(teamId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DUO_BET_PAY_BUTTON_ID}:${teamId}`)
      .setLabel("Pagar minha aposta")
      .setEmoji("💳")
      .setStyle(ButtonStyle.Success)
  );
}

export async function handleDuoBetInviteButton(interaction: ButtonInteraction): Promise<void> {
  const [baseId, inviteId] = interaction.customId.split(":");
  const invite = getInvite(inviteId);

  if (!invite) {
    await interaction.reply({
      content: "⚠️ Este convite não está mais disponível (expirou ou já foi respondido).",
      ephemeral: true,
    });
    return;
  }

  if (baseId === DUO_BET_INVITE_BUTTON_IDS.decline) {
    if (interaction.user.id !== invite.partnerId && interaction.user.id !== invite.inviterId) {
      await interaction.reply({ content: "⚠️ Este convite não é seu.", ephemeral: true });
      return;
    }

    resolveInvite(inviteId);
    await interaction.reply({ content: "❌ Convite recusado/cancelado.", ephemeral: true });
    await interaction.message
      .edit({ embeds: [buildInviteEmbed(invite, "❌ Convite recusado/cancelado.").setColor(0xe74c3c)], components: [] })
      .catch(() => undefined);
    return;
  }

  if (baseId !== DUO_BET_INVITE_BUTTON_IDS.accept) return;

  if (interaction.user.id !== invite.partnerId) {
    await interaction.reply({ content: "⚠️ Só a pessoa convidada pode aceitar este convite.", ephemeral: true });
    return;
  }

  resolveInvite(inviteId);

  const [legInviter, legPartner] = await createTeamLegs({
    inviterId: invite.inviterId,
    partnerId: invite.partnerId,
    amount: invite.amount,
    guildId: invite.guildId,
  });

  await interaction.reply({
    content: `✅ Dupla formada! Cada um paga R$ ${invite.amount.toFixed(2)} pra confirmar a entrada na fila.`,
  });

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("💳 Dupla formada — falta pagar")
    .setDescription(
      [
        `<@${legInviter.userId}> e <@${legPartner.userId}> vão jogar juntos apostando **R$ ${invite.amount.toFixed(
          2
        )} cada**.`,
        "",
        "Cada um clica no botão abaixo e paga sua própria parte via PIX. A dupla só entra na fila quando os dois pagarem.",
      ].join("\n")
    );

  await interaction.message
    .edit({ embeds: [embed], components: [buildPayButtonRow(legInviter.teamId)] })
    .catch(() => undefined);
}
