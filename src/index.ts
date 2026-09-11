import { Client, GatewayIntentBits, Interaction, Partials, Events } from "discord.js";
import { config } from "./config";
import "./firebase/admin"; // inicializa o Firebase Admin (efeito colateral)
import { handleCommandInteraction } from "./handlers/commandHandler";
import { handleButtonInteraction } from "./handlers/buttonHandler";
import { handleModalInteraction } from "./handlers/modalHandler";
import { handleSelectMenuInteraction } from "./handlers/selectMenuHandler";
import { handleMessageCreate } from "./handlers/messageHandler";
import { cleanupStaleMatchChannels, startOrphanChannelCleanup } from "./utils/channelManager";
import { registerAntiRaid } from "./security/antiRaid";
import { startWebhookServer } from "./payments/webhookServer";
import { handlePaymentStatusChange } from "./betting/paymentFlow";
import { startBetQueueInactivityWatcher, startUnpaidLegInactivityWatcher, getLeg } from "./betting/betLedger";
import { refundTeam } from "./betting/payoutService";
import { refreshQueueStatus } from "./queue/betQueueStatus";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.GuildMember, Partials.User],
});

registerAntiRaid(client);

client.on("messageCreate", (message) => {
  handleMessageCreate(message).catch((error) => {
    console.error("[MessageHandler] Erro ao processar mensagem:", error);
  });
});

client.once(Events.ClientReady, async () => {
  console.log(`[Bot] Conectado como ${client.user?.tag}`);
  console.log("[Bot] MamoBall Bet System (Duo 2v2) está online.");

  const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
  if (!guild) {
    console.error(
      "[Bot] Não foi possível carregar a guild configurada (DISCORD_GUILD_ID). " +
        "A limpeza automática de canais órfãos não será iniciada."
    );
  } else {
    const removedOnBoot = await cleanupStaleMatchChannels(guild).catch(() => 0);
    if (removedOnBoot > 0) {
      console.log(`[Bot] ${removedOnBoot} categoria(s) de partida órfã(s) removida(s) na inicialização.`);
    }
    startOrphanChannelCleanup(guild);
  }

  startWebhookServer((paymentId, status) => {
    handlePaymentStatusChange(client, paymentId, status).catch((err) =>
      console.error("[PaymentFlow] Erro ao processar notificação de pagamento:", err)
    );
  });

  // Varredura periódica de duplas completas (pagas) que esperaram demais por
  // um adversário do mesmo valor: reembolsa as 2 apostas automaticamente.
  startBetQueueInactivityWatcher(async (teams) => {
    const guild = client.guilds.cache.get(config.discord.guildId);
    if (!guild) return;

    for (const team of teams) {
      const legs = await Promise.all(team.legBetIds.map((id) => getLeg(id)));
      const validLegs = legs.filter((l): l is NonNullable<typeof l> => l !== null);
      if (validLegs.length > 0) {
        await refundTeam(validLegs, guild, "nenhum adversário do mesmo valor apareceu a tempo");
      }
    }

    await refreshQueueStatus(guild);
  });

  // Varredura periódica de apostas selecionadas mas nunca pagas: expira a
  // perna pra liberar o jogador (nenhum dinheiro foi movimentado, então
  // não há reembolso a fazer — só destrava o isPlayerInAnyLeg).
  startUnpaidLegInactivityWatcher((legs) => {
    console.log(`[Bot] ${legs.length} aposta(s) não paga(s) expirada(s) automaticamente.`);
  });
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleCommandInteraction(interaction);
    return;
  }

  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModalInteraction(interaction);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    await handleSelectMenuInteraction(interaction);
    return;
  }
});

client.login(config.discord.token).catch((err) => {
  console.error("[Bot] Falha ao conectar ao Discord:", err);
  process.exit(1);
});
