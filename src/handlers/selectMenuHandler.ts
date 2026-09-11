import { StringSelectMenuInteraction } from "discord.js";
import { QUEUE_VALUE_SELECT_ID } from "../interactions/buttons/queueButtons";
import { handleQueueValueSelect } from "../interactions/menus/queueValueSelect";

export async function handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  try {
    if (interaction.customId === QUEUE_VALUE_SELECT_ID) {
      await handleQueueValueSelect(interaction);
      return;
    }

    console.warn(`[SelectMenuHandler] customId não reconhecido: ${interaction.customId}`);
  } catch (error) {
    console.error(`[SelectMenuHandler] Erro ao processar menu ${interaction.customId}:`, error);
    const errorMessage = { content: "❌ Ocorreu um erro ao processar esta ação.", ephemeral: true };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorMessage).catch(() => undefined);
    } else {
      await interaction.reply(errorMessage).catch(() => undefined);
    }
  }
}
