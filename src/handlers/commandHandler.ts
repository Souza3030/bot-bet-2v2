import { ChatInputCommandInteraction } from "discord.js";
import { commands } from "../commands";

export async function handleCommandInteraction(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const command = commands.find((c) => c.data.name === interaction.commandName);

  if (!command) {
    console.warn(`[CommandHandler] Comando desconhecido: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[CommandHandler] Erro ao executar /${interaction.commandName}:`, error);
    const errorMessage = { content: "❌ Ocorreu um erro ao executar este comando.", ephemeral: true };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorMessage).catch(() => undefined);
    } else {
      await interaction.reply(errorMessage).catch(() => undefined);
    }
  }
}
