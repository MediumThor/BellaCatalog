/**
 * Firestore helpers for the per-job payments subcollection.
 *
 * Path: `companies/{companyId}/customers/{customerId}/jobs/{jobId}/payments/{paymentId}`
 *
 * The client writes payment records here; the `onPaymentWrite` Cloud
 * Function then updates the parent job (`depositReceivedTotal`, `paidTotal`,
 * `balanceDue`, `pricingLocked`, `status`) and appends derived rows into
 * `commissionLedger`. Sales reps can only read — rules restrict writes to
 * owner/admin/manager (see `firestore.rules`).
 */
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  limit as limitQ,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { firebaseDb } from "../firebase";
import type {
  JobPaymentRecord,
  PaymentKind,
  PaymentMethod,
} from "../types/commission";

const paymentsCol = (companyId: string, customerId: string, jobId: string) =>
  collection(
    firebaseDb,
    "companies",
    companyId,
    "customers",
    customerId,
    "jobs",
    jobId,
    "payments"
  );

const paymentDocRef = (
  companyId: string,
  customerId: string,
  jobId: string,
  paymentId: string
) =>
  doc(
    firebaseDb,
    "companies",
    companyId,
    "customers",
    customerId,
    "jobs",
    jobId,
    "payments",
    paymentId
  );

function nowIso(): string {
  return new Date().toISOString();
}

export interface RecordPaymentInput {
  kind: PaymentKind;
  /** Dollars. For refunds, pass a positive amount and kind="refund". */
  amount: number;
  method: PaymentMethod;
  /** ISO date string (yyyy-mm-dd or full ISO). Defaults to now. */
  receivedAt?: string;
  referenceNumber?: string | null;
  notes?: string;
  recordedByUserId: string;
  recordedByDisplayName: string | null;
}

export async function recordPayment(
  companyId: string,
  customerId: string,
  jobId: string,
  input: RecordPaymentInput
): Promise<string> {
  const t = nowIso();
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Payment amount must be a positive number");
  }
  const payload: Omit<JobPaymentRecord, "id"> = {
    companyId,
    customerId,
    jobId,
    kind: input.kind,
    amount: Math.round(input.amount * 100) / 100,
    method: input.method,
    referenceNumber: input.referenceNumber?.trim() || null,
    receivedAt: input.receivedAt?.trim() || t,
    notes: input.notes?.trim() ?? "",
    recordedByUserId: input.recordedByUserId,
    recordedByDisplayName: input.recordedByDisplayName,
    createdAt: t,
    updatedAt: t,
    version: 1,
    exportedToQuickBooks: false,
    quickBooksExportId: null,
    stripePaymentIntentId: null,
    stripeChargeId: null,
    stripeStatus: null,
  };
  const ref = await addDoc(paymentsCol(companyId, customerId, jobId), payload);
  return ref.id;
}

export async function updatePayment(
  companyId: string,
  customerId: string,
  jobId: string,
  paymentId: string,
  patch: Partial<Omit<JobPaymentRecord, "id" | "companyId" | "customerId" | "jobId" | "createdAt">>
): Promise<void> {
  await updateDoc(paymentDocRef(companyId, customerId, jobId, paymentId), {
    ...patch,
    updatedAt: nowIso(),
  });
}

export async function deletePayment(
  companyId: string,
  customerId: string,
  jobId: string,
  paymentId: string
): Promise<void> {
  await deleteDoc(paymentDocRef(companyId, customerId, jobId, paymentId));
}

export function subscribeJobPayments(
  companyId: string,
  customerId: string,
  jobId: string,
  onData: (rows: JobPaymentRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  return onSnapshot(
    paymentsCol(companyId, customerId, jobId),
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<JobPaymentRecord, "id">) }))
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export interface PaymentsRangeQuery {
  companyId: string;
  /** ISO date inclusive lower bound on `receivedAt`. */
  from?: string;
  /** ISO date inclusive upper bound on `receivedAt`. */
  to?: string;
  /** Restrict to one rep's jobs via `assignedUserId` — not filterable in a
   *  single collectionGroup query without a composite index; callers can
   *  filter in memory after fetching by range. */
  onlyNotExported?: boolean;
}

/**
 * Fetch all payments for a company within a date range. Uses a
 * collectionGroup query so admin dashboards can pull all payments across
 * customers/jobs in one round trip.
 */
export async function fetchPaymentsInRange(
  input: PaymentsRangeQuery
): Promise<JobPaymentRecord[]> {
  const clauses = [where("companyId", "==", input.companyId)];
  if (input.from) clauses.push(where("receivedAt", ">=", input.from));
  if (input.to) clauses.push(where("receivedAt", "<=", input.to));
  if (input.onlyNotExported)
    clauses.push(where("exportedToQuickBooks", "==", false));
  const q = query(
    collectionGroup(firebaseDb, "payments"),
    ...clauses,
    orderBy("receivedAt", "desc"),
    limitQ(2000)
  );
  const snap = await getDocs(q);
  return snap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as Omit<JobPaymentRecord, "id">) })
  );
}

/**
 * Sum helpers for a list of payment records. Deposits and refunds are
 * handled explicitly so the UI can show "deposits collected" vs "balance
 * remaining" without duplicating logic.
 */
export function summarizePayments(rows: JobPaymentRecord[]): {
  deposit: number;
  progress: number;
  final: number;
  refund: number;
  adjustment: number;
  total: number;
} {
  const out = {
    deposit: 0,
    progress: 0,
    final: 0,
    refund: 0,
    adjustment: 0,
    total: 0,
  };
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    switch (r.kind) {
      case "deposit":
        out.deposit += amt;
        out.total += amt;
        break;
      case "progress":
        out.progress += amt;
        out.total += amt;
        break;
      case "final":
        out.final += amt;
        out.total += amt;
        break;
      case "refund":
        out.refund += amt;
        out.total -= amt;
        break;
      case "adjustment":
        out.adjustment += amt;
        out.total += amt;
        break;
    }
  }
  return out;
}
