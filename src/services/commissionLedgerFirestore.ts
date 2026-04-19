/**
 * Firestore helpers for the company commission ledger.
 *
 * Path: `companies/{companyId}/commissionLedger/{entryId}`
 *
 * The ledger is append-only and server-written. The client uses these
 * helpers only for *reads* — dashboards, leaderboards, and rep self-view.
 */
import {
  collection,
  collectionGroup,
  getDocs,
  limit as limitQ,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { firebaseDb } from "../firebase";
import type { CommissionLedgerEntry } from "../types/commission";

const ledgerCol = (companyId: string) =>
  collection(firebaseDb, "companies", companyId, "commissionLedger");

function hydrate(id: string, raw: Record<string, unknown>): CommissionLedgerEntry {
  return {
    id,
    companyId: (raw.companyId as string) ?? "",
    userId: (raw.userId as string) ?? "",
    customerId: (raw.customerId as string) ?? "",
    jobId: (raw.jobId as string) ?? "",
    paymentId: (raw.paymentId as string) ?? "",
    kind: (raw.kind as CommissionLedgerEntry["kind"]) ?? "deposit_portion",
    amount: Number(raw.amount) || 0,
    jobTotalAtSnapshot: Number(raw.jobTotalAtSnapshot) || 0,
    percent: Number(raw.percent) || 0,
    split: (raw.split as CommissionLedgerEntry["split"]) ?? {
      onDeposit: 0.5,
      onFinalPayment: 0.5,
    },
    periodYearMonth: (raw.periodYearMonth as string) ?? "",
    paymentReceivedAt: (raw.paymentReceivedAt as string) ?? "",
    createdAt: (raw.createdAt as CommissionLedgerEntry["createdAt"]) ?? null,
  };
}

export interface LedgerRangeQuery {
  companyId: string;
  /** "YYYY-MM" inclusive lower bound. */
  fromPeriod?: string;
  /** "YYYY-MM" inclusive upper bound. */
  toPeriod?: string;
  /** Filter to one rep — the common rep self-view query. */
  userId?: string;
  max?: number;
}

export async function fetchLedger(
  input: LedgerRangeQuery
): Promise<CommissionLedgerEntry[]> {
  const clauses = [];
  if (input.userId) clauses.push(where("userId", "==", input.userId));
  if (input.fromPeriod)
    clauses.push(where("periodYearMonth", ">=", input.fromPeriod));
  if (input.toPeriod)
    clauses.push(where("periodYearMonth", "<=", input.toPeriod));
  const q = query(
    ledgerCol(input.companyId),
    ...clauses,
    orderBy("periodYearMonth", "asc"),
    limitQ(input.max ?? 5000)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => hydrate(d.id, d.data() as Record<string, unknown>));
}

/**
 * Subscribe to the current rep's own ledger entries across companies.
 * Uses a collectionGroup query filtered by `userId`.
 */
export function subscribeMyLedger(
  userId: string,
  onData: (rows: CommissionLedgerEntry[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(
    collectionGroup(firebaseDb, "commissionLedger"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limitQ(2000)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(
        snap.docs.map((d) => hydrate(d.id, d.data() as Record<string, unknown>))
      );
    },
    (e) => onError?.(e as Error)
  );
}

/**
 * Subscribe to the full company ledger (admin dashboards).
 */
export function subscribeCompanyLedger(
  companyId: string,
  onData: (rows: CommissionLedgerEntry[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(
    ledgerCol(companyId),
    orderBy("createdAt", "desc"),
    limitQ(5000)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(
        snap.docs.map((d) => hydrate(d.id, d.data() as Record<string, unknown>))
      );
    },
    (e) => onError?.(e as Error)
  );
}

/** Rolls entries into `{ [userId]: { [periodYYYYMM]: amount } }`. */
export function rollupByUserAndMonth(
  rows: CommissionLedgerEntry[]
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const byMonth = (out[r.userId] ??= {});
    byMonth[r.periodYearMonth] = (byMonth[r.periodYearMonth] ?? 0) + r.amount;
  }
  return out;
}

/** Total earned per user across the given rows. */
export function totalsByUser(
  rows: CommissionLedgerEntry[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.userId] = (out[r.userId] ?? 0) + r.amount;
  }
  return out;
}
