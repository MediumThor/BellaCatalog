/**
 * Commission tracker, payments, and QuickBooks export types.
 *
 * See `docs/commission-tracker-plan.md` for the full design and rollout plan.
 *
 * Conventions
 * - All monetary `amount` fields are in whole dollars (number). Refunds are
 *   stored as positive amounts on a `"refund"`-kind payment; the commission
 *   ledger negates them via `"adjustment"` entries.
 * - Percentages (commission rate, deposit %) are stored as 0..100 unless
 *   explicitly documented as 0..1 (splits are 0..1 and must sum to 1).
 */

import type { Timestamp } from "firebase/firestore";

export type PaymentKind =
  | "deposit"
  | "progress"
  | "final"
  | "refund"
  | "adjustment";

export type PaymentMethod =
  | "check"
  | "cash"
  | "ach"
  | "card"
  | "wire"
  | "other"
  /** Populated by the Stripe Connect customer-payment webhook (phase 2). */
  | "stripe";

export const PAYMENT_KIND_OPTIONS: Array<{ value: PaymentKind; label: string }> =
  [
    { value: "deposit", label: "Deposit" },
    { value: "progress", label: "Progress payment" },
    { value: "final", label: "Final payment" },
    { value: "refund", label: "Refund" },
    { value: "adjustment", label: "Adjustment" },
  ];

export const PAYMENT_METHOD_OPTIONS: Array<{
  value: PaymentMethod;
  label: string;
}> = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "ach", label: "ACH / Bank transfer" },
  { value: "card", label: "Card (manual)" },
  { value: "wire", label: "Wire" },
  { value: "other", label: "Other" },
  { value: "stripe", label: "Stripe" },
];

/**
 * Persisted payment record. One row per money movement event. The server
 * (`onPaymentWrite`) derives lifecycle transitions + ledger entries from
 * these rows — the client never writes ledger entries directly.
 */
export interface JobPaymentRecord {
  id: string;
  companyId: string;
  customerId: string;
  jobId: string;
  kind: PaymentKind;
  /** Dollars. For `refund`, stored positive; ledger adjustments handle sign. */
  amount: number;
  method: PaymentMethod;
  referenceNumber: string | null;
  /** ISO date (yyyy-mm-dd or full ISO timestamp). */
  receivedAt: string;
  notes: string;
  recordedByUserId: string;
  recordedByDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic concurrency counter. */
  version: number;
  exportedToQuickBooks: boolean;
  quickBooksExportId: string | null;
  /** Phase 2 Stripe fields; null in phase 1. */
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeStatus: string | null;
}

export const DEFAULT_COMMISSION_SPLIT: CommissionSplit = {
  onDeposit: 0.5,
  onFinalPayment: 0.5,
};

export interface CommissionSplit {
  /** Portion earned when deposit is received. 0..1. */
  onDeposit: number;
  /** Portion earned on paid-in-full. 0..1. Must sum with `onDeposit` to 1. */
  onFinalPayment: number;
}

/**
 * Snapshot of the rep's commission terms captured on the job when it is
 * locked. Later rate changes do NOT retroactively affect locked jobs.
 */
export interface JobCommissionSnapshot {
  userId: string;
  displayName: string;
  /** 0..100. */
  percent: number;
  split: CommissionSplit;
  /** Reserved for future alternate bases (net margin, labor-only, etc.). */
  basis: "gross";
  /** ISO timestamp. */
  snapshottedAt: string;
}

/**
 * Server-written ledger row. Append-only; corrections are new
 * `"adjustment"` entries. Rules forbid client writes.
 */
export interface CommissionLedgerEntry {
  id: string;
  companyId: string;
  userId: string;
  customerId: string;
  jobId: string;
  paymentId: string;
  kind: "deposit_portion" | "final_portion" | "adjustment";
  /** Dollars earned. Signed — refunds produce negative entries. */
  amount: number;
  jobTotalAtSnapshot: number;
  percent: number;
  split: CommissionSplit;
  /** "YYYY-MM" for quick period rollups. Derived from `createdAt`. */
  periodYearMonth: string;
  createdAt: Timestamp | null;
  /** Mirrors the payment's `receivedAt` for reporting by payment date. */
  paymentReceivedAt: string;
}

/**
 * Admin record of a generated QuickBooks export file. Server-written only.
 */
export interface QuickBooksExportDoc {
  id: string;
  companyId: string;
  requestedByUserId: string;
  requestedByDisplayName: string | null;
  /** ISO dates. Inclusive bounds on `payments.receivedAt`. */
  periodStart: string;
  periodEnd: string;
  paymentCount: number;
  totalDepositAmount: number;
  totalProgressAmount: number;
  totalFinalAmount: number;
  totalRefundAmount: number;
  totalCommissionAmount: number;
  /** Signed Cloud Storage URL valid for ~24 hours. */
  downloadUrl: string;
  paymentsFileName: string;
  commissionsFileName: string;
  createdAt: Timestamp | null;
}

/**
 * Normalize a commission split: clamp each side to [0,1] and re-normalize so
 * the two parts sum to 1. When both are zero, fall back to 50/50.
 */
export function normalizeCommissionSplit(
  split: Partial<CommissionSplit> | null | undefined
): CommissionSplit {
  const onDeposit = clamp01(split?.onDeposit ?? DEFAULT_COMMISSION_SPLIT.onDeposit);
  const onFinalPayment = clamp01(
    split?.onFinalPayment ?? DEFAULT_COMMISSION_SPLIT.onFinalPayment
  );
  const total = onDeposit + onFinalPayment;
  if (total <= 0) return { ...DEFAULT_COMMISSION_SPLIT };
  return {
    onDeposit: onDeposit / total,
    onFinalPayment: onFinalPayment / total,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Format a `periodYearMonth` key from a date string or Date. UTC-based so
 * ledger rollups are deterministic regardless of viewer timezone.
 */
export function periodYearMonth(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
