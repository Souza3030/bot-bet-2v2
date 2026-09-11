/**
 * Modalidades de fila apostada suportadas. Este bot cobre apenas "duo",
 * que mantém o nome/identidade visual "2v2" da fila original, porém
 * funciona como fila SOLO: cada jogador entra sozinho (sem convidar
 * parceiro) e é pareado 1x1 direto contra o próximo jogador do mesmo valor.
 */
export type QueueMode = "duo";

interface ModeConfig {
  label: string;
  totalPlayers: number;
  playersPerTeam: number;
}

export const MODE_CONFIG: Record<QueueMode, ModeConfig> = {
  duo: { label: "Duo (2v2) — Apostado", totalPlayers: 2, playersPerTeam: 1 },
};

/** Um time dentro de uma partida. */
export interface Team {
  name: "A" | "B";
  memberIds: string[];
}

/** Resultado submetido por um jogador, aguardando aprovação da Staff. */
export interface PendingResult {
  matchId: string;
  submittedBy: string;
  scoreA: number;
  scoreB: number;
  winner: "A" | "B";
  staffMessageId?: string;
}

/** Uma partida ativa (canais temporários criados, aguardando resultado). */
export interface ActiveMatch {
  matchId: string;
  mode: QueueMode;
  teamA: Team;
  teamB: Team;
  categoryId: string;
  textChannelId: string;
  voiceChannelAId: string;
  voiceChannelBId: string;
  createdAt: number;
  resultSubmitted?: PendingResult;
  /** ID da mensagem de anúncio da partida (usado para reabilitar o botão de resultado). */
  announcementMessageId?: string;
}

// ---------------------------------------------------------------------------
// Apostas
// ---------------------------------------------------------------------------

/** Tipos de chave PIX aceitos pela API de payout do Mercado Pago. */
export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM";

export type LegStatus =
  | "aguardando_pagamento" // entrou na fila, ainda não pagou
  | "na_fila" // pagou, esperando adversário do mesmo valor
  | "pareada" // adversário encontrado, em check-in
  | "em_partida"
  | "paga_vencedor"
  | "perdida"
  | "reembolsada"
  | "pagamento_manual_pendente"
  | "expirada"
  | "cancelada";

/**
 * A aposta de UM jogador na fila solo ("perna" da aposta). Cada jogador
 * paga sua própria cobrança PIX ao entrar na fila.
 * Persistida no Firestore (coleção `duoBetLegs`).
 */
export interface BetLeg {
  betId: string;
  teamId: string;
  userId: string;
  guildId: string;
  amount: number;
  pixKey?: string;
  pixKeyType?: PixKeyType;
  pixOwnerDocument?: string;
  paymentId?: string;
  status: LegStatus;
  matchId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Um jogador (perna paga) esperando um adversário do mesmo valor. Mantém o nome "Team"/"Duo" por compatibilidade, mas representa 1 único jogador. */
export interface WaitingDuoTeam {
  teamId: string;
  amount: number;
  memberIds: [string];
  legBetIds: [string];
  joinedAt: number;
}

/**
 * Sessão de check-in ativa para dois jogadores pareados: os 2 jogadores
 * precisam confirmar presença antes de a partida (com dinheiro em jogo)
 * ser criada.
 */
export interface DuoBetCheckInSession {
  sessionId: string;
  mode: QueueMode;
  channelId: string;
  messageId?: string;
  guildId: string;
  teamA: WaitingDuoTeam;
  teamB: WaitingDuoTeam;
  confirmed: Set<string>;
  timeout: NodeJS.Timeout;
}
