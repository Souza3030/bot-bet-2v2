import { db } from "../firebase/admin";
import type { Query, QueryDocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { config } from "../config";
import { BetLeg, LegStatus, WaitingDuoTeam } from "../types";

const LEGS_COLLECTION = "duoBetLegs";
const QUEUE_COLLECTION = "duoBetQueue";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Pernas da aposta (1 documento por jogador por dupla)
// ---------------------------------------------------------------------------

/** Cria a perna de um jogador que acabou de entrar sozinho na fila (fila solo), ainda sem pagamento. */
export async function createSoloLeg(params: {
  userId: string;
  amount: number;
  guildId: string;
}): Promise<BetLeg> {
  const teamId = generateId();
  const now = Date.now();

  const leg: BetLeg = {
    betId: generateId(),
    teamId,
    userId: params.userId,
    guildId: params.guildId,
    amount: params.amount,
    status: "aguardando_pagamento",
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(LEGS_COLLECTION).doc(leg.betId).set(leg);

  return leg;
}

export async function getLeg(betId: string): Promise<BetLeg | null> {
  const doc = await db.collection(LEGS_COLLECTION).doc(betId).get();
  return doc.exists ? (doc.data() as BetLeg) : null;
}

export async function findLegByPaymentId(paymentId: string): Promise<BetLeg | null> {
  const snapshot = await db
    .collection(LEGS_COLLECTION)
    .where("paymentId", "==", paymentId)
    .limit(1)
    .get();
  return snapshot.empty ? null : (snapshot.docs[0].data() as BetLeg);
}

/** Busca a perna de um jogador específico dentro de um "time" (teamId). */
export async function findLegByTeamAndUser(teamId: string, userId: string): Promise<BetLeg | null> {
  const snapshot = await db
    .collection(LEGS_COLLECTION)
    .where("teamId", "==", teamId)
    .where("userId", "==", userId)
    .limit(1)
    .get();
  return snapshot.empty ? null : (snapshot.docs[0].data() as BetLeg);
}

export async function updateLeg(betId: string, patch: Partial<BetLeg>): Promise<void> {
  await db
    .collection(LEGS_COLLECTION)
    .doc(betId)
    .set({ ...patch, updatedAt: Date.now() }, { merge: true });
}

export async function setLegStatus(betId: string, status: LegStatus): Promise<void> {
  await updateLeg(betId, { status });
}

const ACTIVE_LEG_STATUSES: LegStatus[] = [
  "aguardando_pagamento",
  "na_fila",
  "pareada",
  "em_partida",
];

/**
 * Verifica se o jogador tem alguma aposta em andamento (evita queries "in"
 * combinadas com outra igualdade, que exigiriam índice composto no Firestore
 * — como o volume por usuário é pequeno, filtramos em memória).
 */
export async function isPlayerInAnyLeg(userId: string): Promise<boolean> {
  const snapshot = await db.collection(LEGS_COLLECTION).where("userId", "==", userId).get();
  return snapshot.docs.some((doc) => ACTIVE_LEG_STATUSES.includes((doc.data() as BetLeg).status));
}

// ---------------------------------------------------------------------------
// Fila de pareamento — só entram duplas com as 2 pernas pagas.
// Só casa duplas de MESMO valor por jogador.
// ---------------------------------------------------------------------------

function docToTeam(doc: QueryDocumentSnapshot): WaitingDuoTeam {
  return doc.data() as WaitingDuoTeam;
}

export async function joinTeamQueue(
  team: WaitingDuoTeam
): Promise<{ waitingTeam: WaitingDuoTeam; newTeam: WaitingDuoTeam } | null> {
  const collectionRef = db.collection(QUEUE_COLLECTION);

  return db.runTransaction(async (tx: Transaction) => {
    const oldestQuery: Query = collectionRef
      .where("amount", "==", team.amount)
      .orderBy("joinedAt", "asc")
      .limit(1);
    const snapshot = await tx.get(oldestQuery);

    if (snapshot.empty) {
      tx.set(collectionRef.doc(team.teamId), team);
      return null;
    }

    const waitingDoc = snapshot.docs[0];
    const waitingTeam = docToTeam(waitingDoc);
    tx.delete(waitingDoc.ref);

    return { waitingTeam, newTeam: team };
  });
}

export async function leaveTeamQueue(userId: string): Promise<WaitingDuoTeam | null> {
  const snapshot = await db
    .collection(QUEUE_COLLECTION)
    .where("memberIds", "array-contains", userId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const team = docToTeam(doc);
  await doc.ref.delete();
  return team;
}

export async function isTeamInQueue(teamId: string): Promise<boolean> {
  const doc = await db.collection(QUEUE_COLLECTION).doc(teamId).get();
  return doc.exists;
}

export async function listWaitingTeams(): Promise<WaitingDuoTeam[]> {
  const snapshot = await db.collection(QUEUE_COLLECTION).orderBy("joinedAt", "asc").get();
  return snapshot.docs.map(docToTeam);
}

export async function requeueTeam(team: WaitingDuoTeam): Promise<void> {
  await db
    .collection(QUEUE_COLLECTION)
    .doc(team.teamId)
    .set({ ...team, joinedAt: Date.now() });
}

export async function purgeInactiveTeams(): Promise<WaitingDuoTeam[]> {
  const cutoff = Date.now() - config.queue.betQueueTimeoutMs;
  const snapshot = await db.collection(QUEUE_COLLECTION).where("joinedAt", "<=", cutoff).get();

  if (snapshot.empty) return [];

  const removed = snapshot.docs.map(docToTeam);
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  return removed;
}

export function startBetQueueInactivityWatcher(onRemoved: (teams: WaitingDuoTeam[]) => void): void {
  setInterval(() => {
    purgeInactiveTeams()
      .then((removed) => {
        if (removed.length > 0) onRemoved(removed);
      })
      .catch((err) => console.error("[BetLedger] Erro ao varrer duplas inativas:", err));
  }, config.queue.betQueueTimeoutCheckIntervalMs);
}

// ---------------------------------------------------------------------------
// Limpeza de apostas nunca pagas — se o jogador seleciona um valor e não
// paga o PIX (ou o pagamento não é aprovado), a perna fica travada em
// "aguardando_pagamento" para sempre e bloqueia o jogador de entrar em
// novas apostas (ver isPlayerInAnyLeg). Esta rotina expira essas pernas
// automaticamente após config.queue.legPaymentTimeoutMs.
// ---------------------------------------------------------------------------

/**
 * Busca a perna "aguardando_pagamento" mais recente do jogador (se houver)
 * e a marca como "cancelada". Usada pelo botão "Sair da fila" quando o
 * jogador ainda não pagou — nesse caso não há dinheiro a reembolsar, só a
 * trava do isPlayerInAnyLeg a liberar. Retorna null se o jogador não tiver
 * nenhuma aposta pendente de pagamento.
 */
export async function cancelUnpaidLeg(userId: string): Promise<BetLeg | null> {
  // Mesmo motivo do isPlayerInAnyLeg: evita exigir índice composto no
  // Firestore para um volume por usuário que é sempre pequeno (no máximo
  // uma perna "aguardando_pagamento" por vez, na prática).
  const snapshot = await db.collection(LEGS_COLLECTION).where("userId", "==", userId).get();
  const pending = snapshot.docs
    .filter((doc) => (doc.data() as BetLeg).status === "aguardando_pagamento")
    .sort((a, b) => (b.data() as BetLeg).createdAt - (a.data() as BetLeg).createdAt);

  if (pending.length === 0) return null;

  const doc = pending[0];
  const leg = doc.data() as BetLeg;
  await doc.ref.set({ status: "cancelada", updatedAt: Date.now() }, { merge: true });

  return leg;
}

export async function purgeStaleUnpaidLegs(): Promise<BetLeg[]> {
  const cutoff = Date.now() - config.queue.legPaymentTimeoutMs;
  const snapshot = await db
    .collection(LEGS_COLLECTION)
    .where("status", "==", "aguardando_pagamento")
    .where("createdAt", "<=", cutoff)
    .get();

  if (snapshot.empty) return [];

  const expired = snapshot.docs.map((doc) => doc.data() as BetLeg);
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.set(doc.ref, { status: "expirada", updatedAt: Date.now() }, { merge: true }));
  await batch.commit();

  return expired;
}

export function startUnpaidLegInactivityWatcher(onExpired: (legs: BetLeg[]) => void): void {
  setInterval(() => {
    purgeStaleUnpaidLegs()
      .then((expired) => {
        if (expired.length > 0) onExpired(expired);
      })
      .catch((err) => console.error("[BetLedger] Erro ao varrer apostas não pagas:", err));
  }, config.queue.betQueueTimeoutCheckIntervalMs);
}
