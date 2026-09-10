import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: required("DISCORD_GUILD_ID"),
  },
  channels: {
    staffChannelId: required("STAFF_CHANNEL_ID"),
    queuePanelChannelId: required("QUEUE_PANEL_CHANNEL_ID"),
  },
  branding: {
    bannerUrl: process.env.BOT_BANNER_URL?.trim() || undefined,
  },
  firebase: {
    serviceAccountPath:
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? "./serviceAccountKey.json",
  },
  match: {
    // Tempo (ms) de espera após aprovação/rejeição/anulação de resultado antes de apagar os canais temporários
    deleteChannelsDelayMs: 10_000,
    // Caso um jogador clique em [Registrar Resultado] mas feche o modal sem
    // enviar, o botão fica desabilitado por até esse tempo antes de ser
    // reabilitado automaticamente (evita travar a partida indefinidamente).
    registerButtonSafetyReenableMs: 3 * 60 * 1000,
  },
  queue: {
    mode: "duo" as const,
    // Tempo (ms) que o parceiro convidado tem para aceitar/recusar o convite de dupla
    inviteTimeoutMs: 2 * 60 * 1000,
    // Tempo (ms) que cada jogador tem para pagar sua parte da aposta após aceitar o convite
    legPaymentTimeoutMs: 15 * 60 * 1000,
    // Tempo máximo (ms) que uma dupla completa (paga) pode esperar por um adversário do mesmo valor antes de ser removida/reembolsada
    betQueueTimeoutMs: 20 * 60 * 1000,
    // Intervalo (ms) de varredura para remover duplas inativas da fila
    betQueueTimeoutCheckIntervalMs: 60 * 1000,
    // Tempo (ms) que os 4 jogadores pareados têm para confirmar presença (check-in)
    checkInTimeoutMs: 60 * 1000,
  },
  cleanup: {
    // Idade máxima (ms) de uma categoria/canal temporário de partida antes de ser considerado órfão
    staleMatchChannelMaxAgeMs: 2 * 60 * 60 * 1000,
    // Intervalo (ms) entre execuções da rotina de limpeza automática de canais órfãos
    cleanupIntervalMs: 60 * 60 * 1000,
    // Prefixo usado no nome das categorias de partida, usado para identificá-las na limpeza
    matchCategoryPrefix: "partida-",
  },
  bet: {
    // Valores fixos (em reais), apostados POR JOGADOR (cada um paga o mesmo valor).
    tiers: [1, 3, 5, 10, 25, 50, 100],
    // Percentual retido pela "casa" sobre o pote total (0 = sem taxa).
    houseFeePercent: optionalNumber("BET_HOUSE_FEE_PERCENT", 0),
    // Tempo (ms) que o jogador tem para pagar o PIX antes da cobrança expirar.
    paymentExpirationMs: optionalNumber("BET_PAYMENT_EXPIRATION_MINUTES", 15) * 60 * 1000,
    // Domínio usado para gerar um e-mail de pagador fake exigido pela API do Mercado Pago.
    payerEmailDomain: process.env.BET_PAYER_EMAIL_DOMAIN?.trim() || "mamoball.bet",
  },
  mercadoPago: {
    accessToken: required("MERCADOPAGO_ACCESS_TOKEN"),
    // Secret configurado no painel do Mercado Pago para validar a assinatura dos webhooks (notificações IPN).
    webhookSecret: required("MERCADOPAGO_WEBHOOK_SECRET"),
    // URL pública (ex: seu domínio ou túnel ngrok) + porta onde este processo escuta os webhooks do Mercado Pago.
    webhookPublicUrl: required("MERCADOPAGO_WEBHOOK_PUBLIC_URL"),
    webhookPort: optionalNumber("MERCADOPAGO_WEBHOOK_PORT", 3000),
    webhookPath: "/webhooks/mercadopago",
  },
};
