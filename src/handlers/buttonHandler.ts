import { ButtonInteraction } from "discord.js";
import { QUEUE_BUTTON_IDS, handleQueueButton } from "../interactions/buttons/queueButtons";
import { CHECKIN_BUTTON_ID, handleCheckInButton } from "../queue/duoBetCheckin";
import { DUO_BET_PAY_BUTTON_ID, handleDuoBetPayButton } from "../interactions/buttons/duoBetPayButton";
import { RESULT_BUTTON_IDS, handleRegisterResultButton } from "../interactions/buttons/resultButtons";
import { handleStaffDecisionButton } from "../interactions/buttons/staffDecisionButtons";
import { MANUAL_PAYOUT_BUTTON_ID, handleManualPayoutButton } from "../betting/payoutService";

export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const baseId = interaction.customId.split(":")[0];

  try {
    if (Object.values(QUEUE_BUTTON_IDS).includes(baseId as any)) {
      await handleQueueButton(interaction);
      return;
    }

    if (baseId === DUO_BET_PAY_BUTTON_ID) {
      await handleDuoBetPayButton(interaction);
      return;
    }

    if (baseId === CHECKIN_BUTTON_ID) {
      await handleCheckInButton(interaction);
      return;
    }

    if (baseId === MANUAL_PAYOUT_BUTTON_ID) {
      const betId = interaction.customId.split(":")[1];
      const result = await handleManualPayoutButton(betId, interaction.user.id);
      await interaction.update({ content: result.message, embeds: [], components: [] });
      return;
    }

    if (baseId === RESULT_BUTTON_IDS.registerResult) {
      await handleRegisterResultButton(interaction);
      return;
    }

    if (
      baseId === RESULT_BUTTON_IDS.approve ||
      baseId === RESULT_BUTTON_IDS.reject ||
      baseId === RESULT_BUTTON_IDS.void
    ) {
      await handleStaffDecisionButton(interaction);
      return;
    }

    console.warn(`[ButtonHandler] customId não reconhecido: ${interaction.customId}`);
  } catch (error) {
    console.error(`[ButtonHandler] Erro ao processar botão ${interaction.customId}:`, error);
    const errorMessage = { content: "❌ Ocorreu um erro ao processar esta ação.", ephemeral: true };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorMessage).catch(() => undefined);
    } else {
      await interaction.reply(errorMessage).catch(() => undefined);
    }
  }
}
