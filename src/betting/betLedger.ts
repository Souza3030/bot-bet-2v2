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

/** Cria as 2 pernas de uma dupla recém-formada (convite aceito), ainda sem pagamento. */
export async function createTeamLegs(params: {
  inviterId: string;
  partnerId: string;
  amount: number;
  guildId: string;
}): Promise<[BetLeg, BetLeg]> {
  const teamId = generateId();
  const now = Date.now();

  const legInviter: BetLeg = {
    betId: generateId(),
    teamId,
    userId: params.inviterId,
    teammateId: params.partnerId,
    guildId: params.guildId,
    amount: params.amount,
    status: "aguardando_pagamento",
    createdAt: now,
    updatedAt: now,
  };

  const legPartner: BetLeg = {
    betId: generateId(),
    teamId,
    userId: params.partnerId,
    teammateId: params.inviterId,
    guildId: params.guildId,
    amount: params.amount,
    status: "aguardando_pagamento",
    createdAt: now,
    updatedAt: now,
  };

  const batch = db.batch();
  batch.set(db.collection(LEGS_COLLECTION).doc(legInviter.betId), legInviter);
  batch.set(db.collection(LEGS_COLLECTION).doc(legPartner.betId), legPartner);
  await batch.commit();

  return [legInviter, legPartner];
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

/** Busca a perna do outro jogador da mesma dupla. */
export async function findTeammateLeg(teamId: string, excludingUserId: string): Promise<BetLeg | null> {
  const snapshot = await db
    .collection(LEGS_COLLECTION)
    .where("teamId", "==", teamId)
    .get();

  const doc = snapshot.docs.find((d) => (d.data() as BetLeg).userId !== excludingUserId);
  return doc ? (doc.data() as BetLeg) : null;
}

/** Busca a perna de um jogador específico dentro de uma dupla. */
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
  "paga_aguardando_parceiro",
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
