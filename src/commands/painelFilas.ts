import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { buildQueuePanel } from "../interactions/buttons/queueButtons";

export const data = new SlashCommandBuilder()
  .setName("painel-filas")
  .setDescription("Publica o painel fixo da fila apostada Duo (2v2) neste canal.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel as TextChannel;

  if (!channel) {
    await interaction.reply({ content: "⚠️ Canal inválido.", ephemeral: true });
    return;
  }

  const panel = buildQueuePanel();
  await channel.send(panel);

  await interaction.reply({ content: "✅ Painel de filas publicado!", ephemeral: true });
}
