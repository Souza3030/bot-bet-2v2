/**
 * Modalidades de fila apostada suportadas. Este bot cobre apenas "duo"
 * (2v2); a versão solo (1v1) é um projeto irmão com estrutura mais simples
 * (sem convite de parceiro), e trio/squad seguirão o mesmo padrão deste.
 */
export type QueueMode = "duo";

interface ModeConfig {
  label: string;
  totalPlayers: number;
  playersPerTeam: number;
}

export const MODE_CONFIG: Record<QueueMode, ModeConfig> = {
  duo: { label: "Duo (2v2) — Apostado", totalPlayers: 4, playersPerTeam: 2 },
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
  | "aguardando_pagamento" // convite aceito, ainda não pagou
  | "paga_aguardando_parceiro" // este jogador pagou, esperando o parceiro pagar
  | "na_fila" // dupla completa (os 2 pagaram), esperando adversário
  | "pareada" // adversário encontrado, em check-in
  | "em_partida"
  | "paga_vencedor"
  | "perdida"
  | "reembolsada"
  | "pagamento_manual_pendente"
  | "expirada"
  | "cancelada";

/**
 * A aposta de UM jogador dentro de uma dupla ("perna" da aposta). Cada um
 * dos 2 membros de uma dupla paga sua própria cobrança PIX; o valor
 * apostado por jogador é o mesmo para os dois (definido no convite).
 * Persistida no Firestore (coleção `duoBetLegs`).
 */
export interface BetLeg {
  betId: string;
  teamId: string;
  userId: string;
  teammateId: string;
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

/** Uma dupla completa (2 pernas pagas) esperando um adversário do mesmo valor. */
export interface WaitingDuoTeam {
  teamId: string;
  amount: number;
  memberIds: [string, string];
  legBetIds: [string, string];
  joinedAt: number;
}

/**
 * Convite de um jogador para formar dupla apostada com outro jogador. O
 * valor da aposta (por jogador) já é definido no momento do convite.
 * Mantido em memória (efêmero, expira rápido).
 */
export interface DuoBetInvite {
  inviteId: string;
  inviterId: string;
  partnerId: string;
  amount: number;
  guildId: string;
  channelId: string;
  messageId?: string;
  createdAt: number;
  timeout: NodeJS.Timeout;
}

/**
 * Sessão de check-in ativa para duas duplas pareadas: os 4 jogadores
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
