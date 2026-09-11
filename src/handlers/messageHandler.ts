import { Message, PermissionFlagsBits, TextChannel } from "discord.js";
import { config } from "../config";
import { buildQueuePanel } from "../interactions/buttons/queueButtons";

const SETUP_COMMAND = "!setarbot";

/**
 * Publica o painel de filas no canal configurado. Este comando por texto é
 * intencionalmente restrito a membros que podem gerenciar o servidor.
 */
export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot || !message.guild || message.content.trim().toLowerCase() !== SETUP_COMMAND) {
    return;
  }

  if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("⚠️ Você precisa da permissão **Gerenciar Servidor** para usar este comando.");
    return;
  }

  const channel = await message.guild.channels.fetch(config.channels.queuePanelChannelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    await message.reply("⚠️ O canal configurado em `QUEUE_PANEL_CHANNEL_ID` não é um canal de texto válido.");
    return;
  }

  await (channel as TextChannel).send(buildQueuePanel());
  await message.reply(`✅ Painel de filas publicado em ${channel}.`);
}
