import { ModalSubmitInteraction } from "discord.js";
import { RESULT_MODAL_ID } from "../interactions/buttons/resultButtons";
import { handleResultModalSubmit } from "../interactions/modals/resultModal";
import { BET_INFO_MODAL_ID, handleBetInfoModalSubmit } from "../interactions/modals/duoBetInfoModal";

export async function handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
  const baseId = interaction.customId.split(":")[0];

  try {
    if (baseId === RESULT_MODAL_ID) {
      await handleResultModalSubmit(interaction);
      return;
    }

    if (baseId === BET_INFO_MODAL_ID) {
      await handleBetInfoModalSubmit(interaction);
      return;
    }

    console.warn(`[ModalHandler] customId não reconhecido: ${interaction.customId}`);
  } catch (error) {
    console.error(`[ModalHandler] Erro ao processar modal ${interaction.customId}:`, error);
    const errorMessage = { content: "❌ Ocorreu um erro ao processar o formulário.", ephemeral: true };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorMessage).catch(() => undefined);
    } else {
      await interaction.reply(errorMessage).catch(() => undefined);
    }
  }
}
