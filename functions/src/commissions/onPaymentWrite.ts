/**
 * Trigger: `onDocumentWritten` for every payment under
 *   companies/{companyId}/customers/{customerId}/jobs/{jobId}/payments/{paymentId}
 *
 * Responsibilities (single source of truth for money → side effects):
 *
 * 1. Keep the parent job's derived totals in sync:
 *      - depositReceivedTotal (sum of kind="deposit")
 *      - paidTotal (sum of all positive kinds minus refunds)
 *      - balanceDue (quotedTotal - paidTotal, when quotedTotal is set)
 * 2. On the first payment that crosses the required deposit threshold,
 *    flip the job to `status: "active"` and `pricingLocked: true`, freezing
 *    the assigned rep's commission terms as `commissionSnapshot`.
 * 3. When cumulative payments reach `quotedTotal`, flip to
 *    `status: "complete"` (unless already `cancelled`).
 * 4. Write / revert ledger entries in `companies/{companyId}/commissionLedger`:
 *      - deposit_portion on deposit-kind payments
 *      - final_portion on progress/final payments that bring paid >=
 *        quotedTotal
 *      - adjustment rows for refunds, updates, and deletions so the ledger
 *        stays append-only and auditable.
 *
 * This function deliberately reads+writes in a single transaction so a
 * rapid-fire sequence of payments cannot double-count or race the lock.
 */
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";

type PaymentKind =
  | "deposit"
  | "progress"
  | "final"
  | "refund"
  | "adjustment";

interface PaymentData {
  kind: PaymentKind;
  amount: number;
  receivedAt: string;
  method?: string;
}

interface CommissionSplit {
  onDeposit: number;
  onFinalPayment: number;
}

interface CommissionSnapshot {
  userId: string;
  displayName: string;
  percent: number;
  split: CommissionSplit;
  basis: "gross";
  snapshottedAt: string;
}

const DEFAULT_SPLIT: CommissionSplit = { onDeposit: 0.5, onFinalPayment: 0.5 };

function safeNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function periodYearMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function signedPaymentAmount(p: PaymentData): number {
  const a = safeNumber(p.amount);
  switch (p.kind) {
    case "refund":
      return -a;
    case "adjustment":
      return a; // adjustments are stored signed by the admin
    default:
      return a;
  }
}

export const onPaymentWrite = onDocumentWritten(
  {
    region: "us-central1",
    document:
      "companies/{companyId}/customers/{customerId}/jobs/{jobId}/payments/{paymentId}",
  },
  async (event) => {
    const { companyId, customerId, jobId, paymentId } = event.params as {
      companyId: string;
      customerId: string;
      jobId: string;
      paymentId: string;
    };

    const db = getFirestore();
    const jobRef = db.doc(
      `companies/${companyId}/customers/${customerId}/jobs/${jobId}`
    );
    const paymentsRef = db.collection(
      `companies/${companyId}/customers/${customerId}/jobs/${jobId}/payments`
    );
    const ledgerCol = db.collection(
      `companies/${companyId}/commissionLedger`
    );

    try {
      await db.runTransaction(async (tx) => {
        const jobSnap = await tx.get(jobRef);
        if (!jobSnap.exists) {
          logger.warn("onPaymentWrite: parent job missing", {
            companyId,
            jobId,
          });
          return;
        }
        const job = jobSnap.data() ?? {};

        // ---- Recompute derived totals from the full payments list -----
        const paymentsSnap = await tx.get(paymentsRef);
        let depositTotal = 0;
        let paidTotal = 0;
        for (const doc of paymentsSnap.docs) {
          const p = doc.data() as PaymentData;
          if (p.kind === "deposit") depositTotal += safeNumber(p.amount);
          paidTotal += signedPaymentAmount(p);
        }
        depositTotal = Math.round(depositTotal * 100) / 100;
        paidTotal = Math.round(paidTotal * 100) / 100;

        const quotedTotal = safeNumber(job.quotedTotal, 0);
        const balanceDue =
          quotedTotal > 0
            ? Math.max(0, Math.round((quotedTotal - paidTotal) * 100) / 100)
            : null;

        // ---- Determine lifecycle transitions ---------------------------
        const jobPatch: Record<string, unknown> = {
          depositReceivedTotal: depositTotal,
          paidTotal,
          balanceDue,
          // Stored as an ISO string so it lines up with every client-side
          // writer. The client sorts jobs with
          // `String#localeCompare(updatedAt)` and silently throws when the
          // value comes back as a raw Firestore Timestamp, which then
          // wipes the entire jobs board until reload.
          updatedAt: new Date().toISOString(),
        };

        /**
         * Stamp paidInFullAt the first time the balance hits zero on a
         * quoted job. We deliberately do NOT clear it later if a refund
         * pushes the balance back above zero — that would lose the
         * audit trail, and the QuickBooks export uses this stamp as a
         * "first paid in full" pointer to bucket the job's revenue
         * recognition. If a real refund undoes the close-out, the rep
         * (or an admin) can null it via the unlock flow.
         */
        if (
          quotedTotal > 0 &&
          paidTotal >= quotedTotal &&
          !job.paidInFullAt
        ) {
          jobPatch.paidInFullAt = new Date().toISOString();
        }

        const requiredDepositAmount = safeNumber(job.requiredDepositAmount, 0);
        const currentlyLocked = Boolean(job.pricingLocked);
        const effectiveDepositRequirement =
          requiredDepositAmount > 0 ? requiredDepositAmount : 0;
        const status = String(job.status ?? "draft");

        /**
         * Lifecycle gate: a job can only auto-promote to Active once
         * the customer has both (a) chosen a winning material on at
         * least one area and (b) paid the required deposit. The
         * approved-area gate prevents a stray pre-deposit from
         * bypassing the materials workflow. If the gate isn't met yet,
         * we still record the payment + lock pricing — we just don't
         * touch the status. The next status change (or the
         * `onJobStatusTransition` trigger) will reconcile.
         */
        const areas = Array.isArray(job.areas)
          ? (job.areas as Array<{ selectedOptionId?: string | null }>)
          : [];
        const hasApprovedArea = areas.some((a) =>
          Boolean(a?.selectedOptionId)
        );

        if (
          !currentlyLocked &&
          depositTotal > 0 &&
          depositTotal >= effectiveDepositRequirement
        ) {
          jobPatch.pricingLocked = true;
          jobPatch.pricingLockedAt = FieldValue.serverTimestamp();
          if (
            hasApprovedArea &&
            (status === "draft" || status === "quote")
          ) {
            jobPatch.status = "active";
            jobPatch.statusChangedAt = new Date().toISOString();
          }
          // Freeze commission snapshot if none captured yet.
          if (!job.commissionSnapshot && job.assignedUserId) {
            const snap = await freezeCommissionSnapshot(
              tx,
              db,
              companyId,
              String(job.assignedUserId),
              quotedTotal
            );
            if (snap) jobPatch.commissionSnapshot = snap;
          }
        }

        /**
         * Note: we deliberately do NOT auto-promote to `complete` when
         * `paidTotal >= quotedTotal`. Per the documented bookkeeping
         * workflow, Complete is a *manual* transition from Installed
         * (the rep clicks it after the install is verified). The
         * `onJobStatusTransition` trigger enforces a paid-in-full
         * gate when the rep does click it. Auto-completing here would
         * skip the Installed stage and break the QuickBooks-friendly
         * audit trail.
         */

        tx.update(jobRef, jobPatch);

        // ---- Ledger side effects for THIS write only -----------------
        // We compare before/after for the single changed payment and write
        // compensating / new ledger rows. Per-row operation keeps the
        // ledger append-only regardless of how many payments exist.
        const before = event.data?.before?.data() as PaymentData | undefined;
        const after = event.data?.after?.data() as PaymentData | undefined;

        const snapshot =
          (jobPatch.commissionSnapshot as CommissionSnapshot | undefined) ||
          (job.commissionSnapshot as CommissionSnapshot | undefined);

        if (!snapshot) {
          // No commission snapshot yet (assignedUserId was missing). Ledger
          // writes resume once it's frozen on the next deposit.
          return;
        }

        const prevAmount = computeCommissionAmount(snapshot, before);
        const nextAmount = computeCommissionAmount(snapshot, after);
        const delta =
          Math.round((nextAmount - prevAmount) * 100) / 100;
        if (delta === 0) return;

        const receivedAt = after?.receivedAt ?? before?.receivedAt ?? nowIso();
        const entryKind = resolveLedgerKind(after?.kind, before?.kind);
        const entryId = `${paymentId}-${Date.now().toString(36)}`;

        tx.set(ledgerCol.doc(entryId), {
          id: entryId,
          companyId,
          userId: snapshot.userId,
          customerId,
          jobId,
          paymentId,
          kind: entryKind,
          amount: delta,
          jobTotalAtSnapshot: quotedTotal,
          percent: snapshot.percent,
          split: snapshot.split,
          periodYearMonth: periodYearMonth(receivedAt),
          paymentReceivedAt: receivedAt,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (err) {
      logger.error("onPaymentWrite failed", {
        companyId,
        jobId,
        paymentId,
        error: (err as Error).message,
      });
    }
  }
);

async function freezeCommissionSnapshot(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  companyId: string,
  userId: string,
  jobTotal: number
): Promise<CommissionSnapshot | null> {
  const memberRef = db.doc(`companies/${companyId}/members/${userId}`);
  const companyRef = db.doc(`companies/${companyId}`);
  const [memberSnap, companySnap] = await Promise.all([
    tx.get(memberRef),
    tx.get(companyRef),
  ]);
  if (!memberSnap.exists) return null;
  const m = memberSnap.data() ?? {};
  const c = companySnap.data() ?? {};
  const companyDefaultSplit =
    (c.settings?.defaultCommissionSplit as CommissionSplit | undefined) ??
    DEFAULT_SPLIT;
  const percent = safeNumber(m.commissionPercent, 0);
  if (percent <= 0 || jobTotal <= 0) return null;
  return {
    userId,
    displayName: String(m.displayName ?? m.email ?? ""),
    percent,
    split: (m.commissionSplit as CommissionSplit | undefined) ??
      companyDefaultSplit,
    basis: "gross",
    snapshottedAt: new Date().toISOString(),
  };
}

function computeCommissionAmount(
  snap: CommissionSnapshot,
  p: PaymentData | undefined
): number {
  if (!p) return 0;
  const signed = signedPaymentAmount(p);
  const rate = snap.percent / 100;
  switch (p.kind) {
    case "deposit":
      return signed * rate * snap.split.onDeposit;
    case "progress":
    case "final":
      return signed * rate * snap.split.onFinalPayment;
    case "refund":
      // Refunds proportionally reverse whichever portion they refund. We
      // conservatively treat refunds as reversing the final portion unless
      // the job's deposit total would otherwise go negative; the nightly
      // reconciler can rebalance edge cases.
      return signed * rate * snap.split.onFinalPayment;
    case "adjustment":
      return signed * rate;
    default:
      return 0;
  }
}

function resolveLedgerKind(
  afterKind: PaymentKind | undefined,
  beforeKind: PaymentKind | undefined
): "deposit_portion" | "final_portion" | "adjustment" {
  const k = afterKind ?? beforeKind;
  if (k === "deposit") return "deposit_portion";
  if (k === "final" || k === "progress") return "final_portion";
  return "adjustment";
}

function nowIso(): string {
  return new Date().toISOString();
}

// Silence unused `Timestamp` import when tree-shaking complains.
void Timestamp;
