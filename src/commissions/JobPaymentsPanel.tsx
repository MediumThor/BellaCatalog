/**
 * JobPaymentsPanel — renders:
 *
 * 1. A status stepper (Draft → Quote → Active → Installed → Complete).
 * 2. Editable "Quoted total" and "Required deposit" inputs (admin/manager
 *    only, auto-locked once pricing is locked).
 * 3. Balance-due and deposit-progress summary.
 * 4. Payment history table with a "Record payment" button.
 * 5. Assigned-rep dropdown (owner/admin only).
 *
 * Wire this into `JobDetailPage` (or anywhere that has the job context).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import {
  deletePayment,
  recordPayment,
  subscribeJobPayments,
  summarizePayments,
} from "../services/jobPaymentsFirestore";
import {
  markJobPaidInFull,
  recordFinalInvoiceSent,
  setJobActiveTracking,
  setJobDepositRequirement,
  setJobQuotedTotal,
  transitionJobStatus,
  unlockJobPricing,
} from "../services/compareQuoteFirestore";
import {
  PAYMENT_METHOD_OPTIONS,
  type PaymentMethod,
} from "../types/commission";
import {
  deriveJobSinkModels,
  JOB_STATUS_COLOR,
  JOB_STATUS_LABELS,
  evaluateJobTransition,
  isJobPaidInFull,
  normalizeJobStatus,
  type CustomerRecord,
  type JobAreaRecord,
  type JobComparisonOptionRecord,
  type JobRecord,
  type JobStatus,
  type JobTransitionBlockReason,
} from "../types/compareQuote";
import { Link } from "react-router-dom";
import { SlabThumbnailLightbox } from "../components/SlabThumbnailLightbox";
import type { JobPaymentRecord } from "../types/commission";
import { formatMoney } from "../utils/priceHelpers";
import { RecordPaymentModal } from "./RecordPaymentModal";
import { InvoiceModal } from "./InvoiceModal";
import { JobSheetModal } from "./JobSheetModal";
import { ConfirmDialog } from "../components/ConfirmDialog";

type Props = {
  job: JobRecord;
  /**
   * True once at least one area on this job has an approved
   * customer's-choice material. Until that happens we hide the
   * "Quoted total & deposit" editor since there's nothing to quote.
   */
  hasApprovedSelection?: boolean;
  /**
   * Materials that have been quoted in Layout Studio (have a placement
   * or rendered preview for an area). The lifecycle panel surfaces this
   * count so reps can see at a glance how many quotes exist without
   * scrolling back to the Materials by area section.
   */
  quotedMaterialCount?: number;
  /**
   * Materials approved as the customer's choice for an area. Equal to
   * the number of areas with `selectedOptionId` set.
   */
  approvedMaterialCount?: number;
  /**
   * Areas + options for the lifecycle stepper's content gates. When
   * provided, the stepper enforces:
   *   • Quote requires at least one quoted material.
   *   • Active requires an approved area + deposit recorded.
   *   • Complete (from Installed) requires `paidTotal >= quotedTotal`.
   * Optional so legacy callers without the data still work; in that
   * case the stepper falls back to the deposit-only gate.
   */
  lifecycleGate?: {
    areas: JobAreaRecord[];
    options: JobComparisonOptionRecord[];
  };
  /**
   * Per-area list of materials that have been quoted in Layout Studio
   * (i.e. have a saved placement or rendered preview). Surfaced inside
   * the lifecycle panel so reps see the candidates that are actually
   * priced and can pick the customer's choice from there — no need to
   * scroll through every material attached to the job. The page that
   * owns this data (Job detail) computes it once and passes it down.
   */
  quotedMaterialsByArea?: QuotedAreaSection[];
  /** Pre-computed display total for the quoted materials section (e.g. count). */
  approvalBusyKey?: string | null;
  approvalError?: string | null;
  onApproveAreaOption?: (areaId: string, optionId: string) => void;
  onClearAreaApproval?: (areaId: string) => void;
  /**
   * Allow the parent to control the deep-link target for the "Open in
   * Layout Studio" buttons. Defaults to /compare/jobs/{jobId}/layout.
   */
  layoutStudioHrefForArea?: (
    areaId: string,
    optionId?: string
  ) => string;
  /**
   * Authoritative quoted total derived from the customer-approved Layout
   * Studio quotes (sum of `customerTotal` across all approved areas).
   * The pricing card is now read-only — this is the single source of
   * truth for what the customer owes. The panel auto-syncs the value
   * back to `job.quotedTotal` so lifecycle gates (paid-in-full check)
   * stay in agreement with the displayed number.
   */
  derivedQuotedTotal?: number;
  /**
   * Company-wide default deposit percent (0..100). Comes from
   * `companies/{id}.settings.defaultRequiredDepositPercent` and is
   * configurable by owner/admin in Settings → Pricing. Used to derive
   * the required deposit from the quoted total without per-job edits.
   */
  companyDepositPercent?: number | null;
  /**
   * Customer record for this job. Optional because legacy callers may not
   * have it — when present we use it to populate the "Bill to" block on
   * the deposit invoice and to prefill the mailto: when emailing it.
   */
  customer?: CustomerRecord | null;
};

export interface QuotedAreaMaterial {
  option: JobComparisonOptionRecord;
  /** Per-(area,option) installed estimate, when available. */
  customerTotal: number | null;
  /** Layout preview snapshot; falls back to the option's catalog image. */
  previewUrl: string | null;
  /** True when this material is the customer's chosen one for the area. */
  isApproved: boolean;
}

export interface QuotedAreaSection {
  area: JobAreaRecord;
  quoted: QuotedAreaMaterial[];
  /**
   * Materials added to the area that haven't been quoted in Layout
   * Studio yet. We only show the count (with a CTA into Studio); the
   * goal of this section is to celebrate what's actually quoted, not
   * to relitigate everything attached to the job.
   */
  unquotedCount: number;
  /** Customer's chosen material for the area, if any. */
  approvedOption: JobComparisonOptionRecord | null;
}

const STEPPER_STATUSES: JobStatus[] = [
  "draft",
  "quote",
  "active",
  "installed",
  "complete",
];

/**
 * Render-side translator from the typed gate reason into something a
 * human can act on. Kept here (not in `compareQuote.ts`) so it can
 * reference the live deposit / payment numbers for a more useful
 * tooltip — "$1,234 still owed" is much better than "balance due".
 */
function blockReasonMessage(
  from: JobStatus,
  to: JobStatus,
  reason: JobTransitionBlockReason,
  ctx: {
    depositRequired: number;
    depositReceived: number;
    quotedTotal: number | null | undefined;
    paidTotal: number;
  }
): string {
  switch (reason) {
    case "needs_quoted_material":
      return "Save at least one material in Layout Studio before moving the job to Quote.";
    case "needs_approved_area":
      return "Pick the customer's chosen material on at least one area before activating the job.";
    case "needs_deposit": {
      const remaining = Math.max(0, ctx.depositRequired - ctx.depositReceived);
      return ctx.depositRequired > 0
        ? `Record ${formatMoney(remaining)} more in deposits to activate the job.`
        : "Record a deposit before moving the job to Active.";
    }
    case "needs_paid_in_full": {
      const quoted = ctx.quotedTotal ?? 0;
      const remaining = Math.max(0, quoted - ctx.paidTotal);
      return remaining > 0
        ? `Record ${formatMoney(remaining)} in final payments before marking the job Complete.`
        : "Set the quoted total before marking the job Complete.";
    }
    case "illegal":
    default:
      return `Can't move directly from ${JOB_STATUS_LABELS[from] ?? from} to ${JOB_STATUS_LABELS[to] ?? to}.`;
  }
}

export function JobPaymentsPanel({
  job,
  hasApprovedSelection = true,
  quotedMaterialCount,
  approvedMaterialCount,
  lifecycleGate,
  quotedMaterialsByArea,
  approvalBusyKey,
  approvalError,
  onApproveAreaOption,
  onClearAreaApproval,
  layoutStudioHrefForArea,
  derivedQuotedTotal,
  companyDepositPercent,
  customer = null,
}: Props) {
  const { activeCompany, activeCompanyId, role, permissions } = useCompany();
  const { user, profileDisplayName } = useAuth();
  const [payments, setPayments] = useState<JobPaymentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  /**
   * Final-invoice modal flag, separate from the deposit one above.
   * Same `<InvoiceModal>` component, just rendered with `mode="final"`
   * so the deposit-due headline flips to balance-due and the email
   * boilerplate switches to a "balance closeout" tone.
   */
  const [finalInvoiceOpen, setFinalInvoiceOpen] = useState(false);
  /**
   * Internal "job sheet" modal — printable production reference for the
   * install crew. Distinct from the customer-facing invoice modals; no
   * pricing is rendered. Surfaced from the lifecycle header so reps can
   * print it the moment a job moves into the active phase.
   */
  const [jobSheetOpen, setJobSheetOpen] = useState(false);
  /**
   * Inline draft for the final-payment row that appears in the Active
   * lifecycle phase. Mirrors the deposit row above: the rep can record
   * progress / final payments without leaving the panel and without
   * juggling the more comprehensive `RecordPaymentModal`. We default
   * the kind to `"final"` so QuickBooks export buckets it correctly,
   * and the input pre-fills with the remaining balance.
   */
  const [finalAmountDraft, setFinalAmountDraft] = useState<string>("");
  const [finalMethodDraft, setFinalMethodDraft] =
    useState<PaymentMethod>("check");
  const [recordingFinal, setRecordingFinal] = useState(false);
  const finalAmountDirty = useRef(false);

  /**
   * The pricing card is now read-only: Quoted Total comes straight from
   * the customer-approved Layout Studio quote, and Required Deposit is
   * Quoted Total × the company-wide deposit %. The only editable field
   * is the deposit amount the rep is recording right now (pre-filled
   * with the remaining required deposit).
   */
  const effectiveDepositPercent =
    companyDepositPercent != null && Number.isFinite(companyDepositPercent)
      ? Math.max(0, Math.min(100, companyDepositPercent))
      : 50;
  /**
   * Quoted total is strictly derived from the customer-approved Layout
   * Studio quote. If no area has been approved yet (no
   * `derivedQuotedTotal`), we deliberately fall through to ZERO instead
   * of `job.quotedTotal`. Reading the stale job field would resurrect
   * a deposit requirement that no longer has a quote behind it (e.g.
   * after a rep clears their approval), which is exactly the bug the
   * read-only redesign was meant to prevent.
   */
  const hasDerivedTotal =
    derivedQuotedTotal != null &&
    Number.isFinite(derivedQuotedTotal) &&
    derivedQuotedTotal > 0;
  const effectiveQuotedTotal = hasDerivedTotal
    ? Math.round((derivedQuotedTotal as number) * 100) / 100
    : 0;
  const effectiveRequiredDeposit = hasDerivedTotal
    ? Math.round(((effectiveQuotedTotal * effectiveDepositPercent) / 100) * 100) /
      100
    : 0;

  const [depositInputDraft, setDepositInputDraft] = useState<string>("");
  const [depositMethodDraft, setDepositMethodDraft] =
    useState<PaymentMethod>("check");
  const [recordingDeposit, setRecordingDeposit] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    const unsub = subscribeJobPayments(
      activeCompanyId,
      job.customerId,
      job.id,
      (rows) => setPayments(rows),
      (e) => setError(e.message)
    );
    return unsub;
  }, [activeCompanyId, job.customerId, job.id]);

  const canRecordPayments =
    role === "owner" || role === "admin" || role === "manager";

  const summary = useMemo(() => summarizePayments(payments), [payments]);
  const status = normalizeJobStatus(job.status);
  /**
   * Live deposit context. We pass this to the stepper so the `→ Active`
   * button is disabled (with a contextual tooltip explaining how much
   * more deposit is needed) until bookkeeping shows the customer has
   * actually paid. Mirrors the server-side `onJobStatusTransition` guard.
   */
  const depositContext = useMemo(
    () => ({
      requiredDepositAmount: effectiveRequiredDeposit,
      depositReceivedTotal: summary.deposit,
    }),
    [effectiveRequiredDeposit, summary.deposit]
  );

  /**
   * Full lifecycle gate context — used by the stepper to evaluate the
   * Quote / Active / Complete content gates. We prefer the live areas
   * + options the parent passes via `lifecycleGate`; if the parent
   * hasn't wired them up, fall back to the job's stored areas (still
   * gives us the approved-area + paid-in-full checks) and an empty
   * options list (the Quote gate then degrades to a permissive check).
   *
   * Quoted/required deposit numbers come from the panel's "effective"
   * values (derived from the approved Layout Studio quote + company
   * default %) so the gate stays in agreement with what's displayed,
   * even before the auto-sync write has landed in Firestore.
   */
  const lifecycleContext = useMemo(
    () => ({
      requiredDepositAmount: effectiveRequiredDeposit,
      depositReceivedTotal: summary.deposit,
      quotedTotal: effectiveQuotedTotal > 0 ? effectiveQuotedTotal : null,
      paidTotal: summary.total,
      areas:
        lifecycleGate?.areas ??
        (Array.isArray(job.areas) ? job.areas : []),
      options: lifecycleGate?.options ?? [],
    }),
    [
      effectiveRequiredDeposit,
      effectiveQuotedTotal,
      job.areas,
      summary.deposit,
      summary.total,
      lifecycleGate,
    ]
  );

  /**
   * Auto-sync the derived Quoted total + Required deposit back to the
   * job document so the lifecycle gate (paid-in-full check on
   * complete) and the BalanceSummary keep agreeing with the displayed
   * read-only numbers. We only write when the value drifts by more
   * than a cent and only when the user is permitted (skip when
   * pricing is locked unless owner/admin). A ref guards against
   * overlapping writes when Firestore round-trips back our own value.
   */
  const syncBusyRef = useRef(false);
  useEffect(() => {
    if (!activeCompanyId) return;
    if (syncBusyRef.current) return;
    if (job.pricingLocked && role !== "owner" && role !== "admin") return;

    /**
     * Two-way sync:
     *   1. When a derived total exists, push it (and the derived
     *      required deposit) onto the job doc.
     *   2. When NO derived total exists but the job still has a stale
     *      `quotedTotal` / `requiredDepositAmount`, clear them. Without
     *      this, clearing the customer's selection leaves a phantom
     *      "$X deposit needed" chip in the pipeline summary because
     *      the lifecycle gate keeps reading the stored value.
     */
    const targetTotal: number | null = hasDerivedTotal
      ? effectiveQuotedTotal
      : null;
    const targetDeposit: number | null = hasDerivedTotal
      ? effectiveRequiredDeposit
      : null;
    const targetPercent: number | null = hasDerivedTotal
      ? effectiveDepositPercent
      : null;

    const totalDrift =
      (targetTotal ?? null) !== (job.quotedTotal ?? null) &&
      (targetTotal == null
        ? job.quotedTotal != null
        : Math.abs((job.quotedTotal ?? 0) - targetTotal) > 0.005);
    const depositDrift =
      (targetDeposit ?? null) !== (job.requiredDepositAmount ?? null) &&
      (targetDeposit == null
        ? job.requiredDepositAmount != null
        : Math.abs(
            (job.requiredDepositAmount ?? 0) - targetDeposit
          ) > 0.005);
    const percentDrift =
      (job.requiredDepositPercent ?? null) !== targetPercent;
    if (!totalDrift && !depositDrift && !percentDrift) return;
    syncBusyRef.current = true;
    (async () => {
      try {
        if (totalDrift) {
          await setJobQuotedTotal(
            activeCompanyId,
            job.customerId,
            job.id,
            targetTotal
          );
        }
        if (depositDrift || percentDrift) {
          await setJobDepositRequirement(
            activeCompanyId,
            job.customerId,
            job.id,
            {
              requiredDepositAmount: targetDeposit,
              requiredDepositPercent: targetPercent,
            }
          );
        }
      } catch {
        // Silent — auto-sync should not surface to the rep. Lifecycle
        // gates remain accurate against the stored values until the
        // next render attempts the write again.
      } finally {
        syncBusyRef.current = false;
      }
    })();
  }, [
    activeCompanyId,
    role,
    hasDerivedTotal,
    job.customerId,
    job.id,
    job.pricingLocked,
    job.quotedTotal,
    job.requiredDepositAmount,
    job.requiredDepositPercent,
    effectiveQuotedTotal,
    effectiveRequiredDeposit,
    effectiveDepositPercent,
  ]);

  /**
   * Pre-fill the deposit input with the remaining required amount
   * whenever the requirement, payments, or active job changes. Only
   * resets when the user has not already started typing a different
   * value — the input remains editable so reps can record more or
   * less than the suggested amount in a single click.
   */
  const depositInputDirty = useRef(false);
  useEffect(() => {
    if (depositInputDirty.current) return;
    const remaining = Math.max(
      0,
      Math.round((effectiveRequiredDeposit - summary.deposit) * 100) / 100
    );
    setDepositInputDraft(remaining > 0 ? String(remaining) : "");
  }, [effectiveRequiredDeposit, summary.deposit, job.id]);

  /**
   * Pre-fill the final-payment input with the still-owed balance so a
   * single click closes the job out. Mirrors the deposit pre-fill
   * above; resets only when the user has not started typing a custom
   * amount.
   */
  useEffect(() => {
    if (finalAmountDirty.current) return;
    const balance = Math.max(
      0,
      Math.round((effectiveQuotedTotal - summary.total) * 100) / 100
    );
    setFinalAmountDraft(balance > 0 ? String(balance) : "");
  }, [effectiveQuotedTotal, summary.total, job.id]);

  async function handleRecordDeposit() {
    if (!activeCompanyId || !user) return;
    const amountNum = Number(depositInputDraft);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a deposit amount greater than zero.");
      return;
    }
    setRecordingDeposit(true);
    setError(null);
    try {
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(
        today.getMonth() + 1
      ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      await recordPayment(activeCompanyId, job.customerId, job.id, {
        kind: "deposit",
        amount: amountNum,
        method: depositMethodDraft,
        receivedAt: iso,
        referenceNumber: null,
        notes: "",
        recordedByUserId: user.uid,
        recordedByDisplayName: profileDisplayName ?? user.email ?? null,
      });
      depositInputDirty.current = false;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not record deposit."
      );
    } finally {
      setRecordingDeposit(false);
    }
  }

  /**
   * Record a final / progress payment from the inline row. Defaults
   * to `kind: "final"` so the QuickBooks export buckets it correctly
   * — reps who need a different kind (refund / adjustment) should use
   * the full RecordPaymentModal. Pre-fills with the remaining balance
   * so a single click closes the job out.
   */
  async function handleRecordFinal() {
    if (!activeCompanyId || !user) return;
    const amountNum = Number(finalAmountDraft);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    setRecordingFinal(true);
    setError(null);
    try {
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(
        today.getMonth() + 1
      ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      await recordPayment(activeCompanyId, job.customerId, job.id, {
        kind: "final",
        amount: amountNum,
        method: finalMethodDraft,
        receivedAt: iso,
        referenceNumber: null,
        notes: "",
        recordedByUserId: user.uid,
        recordedByDisplayName: profileDisplayName ?? user.email ?? null,
      });
      finalAmountDirty.current = false;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not record payment."
      );
    } finally {
      setRecordingFinal(false);
    }
  }

  /**
   * Belt-and-suspenders: stamp `paidInFullAt` from the client when the
   * Cloud Function has not yet run (offline, function cold start, or
   * the job was prepaid before this feature shipped). The helper is
   * idempotent — it only writes if the field is currently null.
   */
  async function handleMarkPaidInFull() {
    if (!activeCompanyId) return;
    setBusy(true);
    setError(null);
    try {
      await markJobPaidInFull(activeCompanyId, job.customerId, job.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not mark paid in full."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusClick(next: JobStatus) {
    if (!activeCompanyId) return;
    if (status === next) return;
    /**
     * Lifecycle gate (Quote → Active → Installed → Complete). We
     * evaluate against the live job context so the stepper button's
     * tooltip and this click handler agree on what's missing. The
     * service-layer `transitionJobStatus` and the Cloud Function
     * mirror the same gate — this client check is just for UX.
     */
    const evaluation = evaluateJobTransition(status, next, lifecycleContext);
    if (!evaluation.ok) {
      setError(blockReasonMessage(status, next, evaluation.reason, {
        depositRequired: depositContext.requiredDepositAmount,
        depositReceived: depositContext.depositReceivedTotal,
        quotedTotal: lifecycleContext.quotedTotal,
        paidTotal: lifecycleContext.paidTotal,
      }));
      return;
    }
    if (!permissions.canCreateJobs && role !== "owner" && role !== "admin") {
      setError("You don't have permission to change job status.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await transitionJobStatus(
        activeCompanyId,
        job.customerId,
        job.id,
        next,
        // actor uid — the server trigger re-reads from the updated doc
        // so this is purely for audit metadata on the job itself.
        "self"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transition failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock() {
    if (!activeCompanyId) return;
    if (
      !confirm(
        "Unlock pricing? This lets sales edit the quote again. Recorded payments are preserved."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await unlockJobPricing(activeCompanyId, job.customerId, job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePayment(p: JobPaymentRecord) {
    if (!activeCompanyId) return;
    if (!confirm(`Delete ${p.kind} of ${formatMoney(p.amount)}?`)) return;
    try {
      await deletePayment(activeCompanyId, job.customerId, job.id, p.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete payment."
      );
    }
  }

  const depositRequired = effectiveRequiredDeposit;
  const depositReceived = summary.deposit;
  const depositSatisfied =
    depositReceived > 0 &&
    (depositRequired === 0 || depositReceived >= depositRequired);

  /**
   * "Active phase" = once the deposit is in and the job is on the
   * production / install / closeout track. From here on we hide the
   * deposit-collection UI (which would just be confusing) and instead
   * surface production tracking + final-payment controls.
   */
  const isActivePhase =
    status === "active" || status === "installed" || status === "complete";
  /**
   * Local "paid in full" check — derived from live payment totals so the
   * UI updates the moment the user records the final payment, even
   * before the Cloud Function has stamped `paidInFullAt` on the job.
   * Mirrors `isJobPaidInFull` from the types module so the gate logic
   * is identical client-side and server-side.
   */
  const paidInFullDerived = isJobPaidInFull({
    quotedTotal: effectiveQuotedTotal > 0 ? effectiveQuotedTotal : null,
    paidTotal: summary.total,
  });
  return (
    <section className="job-payments-panel glass-panel" aria-label="Lifecycle and payments">
      <span className="job-payments-panel__accent" aria-hidden="true" />
      <header className="job-payments-panel__head">
        <div className="job-payments-panel__head-copy">
          <span className="job-payments-panel__eyebrow">Job lifecycle</span>
          <h2 className="job-payments-panel__title">Lifecycle &amp; payments</h2>
          <p className="job-payments-panel__lede">
            Move the job through its phases, configure deposit requirements,
            and record customer payments — all in one place.
          </p>
          <PipelineSummary
            quotedCount={quotedMaterialCount}
            approvedCount={approvedMaterialCount}
            depositRequired={depositContext.requiredDepositAmount}
            depositReceived={depositContext.depositReceivedTotal}
            depositSatisfied={depositSatisfied}
            status={status}
          />
        </div>
        <div
          className="job-payments-panel__head-actions"
          role="group"
          aria-label="Job lifecycle actions"
        >
          {/*
           * The Job sheet is the install crew's production handoff — it
           * only makes sense once the deposit has cleared and the job
           * has actually been promoted to Active (or further along).
           * Before that, the "approved material" + delivery dates the
           * sheet is built around aren't locked in yet, so we hide the
           * button entirely rather than letting reps print a half-baked
           * sheet for a job that might still flip back to Quote.
           */}
          {isActivePhase ? (
            <button
              type="button"
              className="btn"
              onClick={() => setJobSheetOpen(true)}
              title="Open the internal job sheet — printable production reference for the install crew. No pricing."
            >
              Job sheet
            </button>
          ) : null}
          <LifecycleAdvanceActions
            status={status}
            disabled={busy}
            lifecycleContext={lifecycleContext}
            onAdvance={handleStatusClick}
          />
        </div>
      </header>

      <StatusStepper
        current={status}
        onClick={handleStatusClick}
        disabled={busy}
        lifecycleContext={lifecycleContext}
      />

      {/*
       * The "→ Active" step is gated on deposit-paid for bookkeeping
       * integrity. Reps can't manually advance to Active until the
       * customer has paid; the server-side `onPaymentWrite` trigger
       * also auto-promotes once `depositReceivedTotal` clears the
       * required threshold so reps never have to click it themselves.
       */}
      {status === "quote" || status === "draft" ? (
        <p className="job-payments-panel__hint product-sub">
          <strong>Active is gated on the deposit.</strong>{" "}
          {hasApprovedSelection && depositRequired > 0
            ? `Record at least ${formatMoney(depositRequired)} in deposits — the job promotes to Active automatically.`
            : hasApprovedSelection
            ? "Record any deposit — the job promotes to Active automatically."
            : "Approve a quoted material first to set the required deposit."}
        </p>
      ) : null}

      {(() => {
        /**
         * Pricing controls (Quoted total / Required deposit / Save /
         * locked badge / balance summary). Built once so it can be
         * rendered EITHER inline inside the approved material card OR
         * as a standalone card in the grid below — never both. Inputs
         * stay bound to the panel-level draft state regardless of
         * where the node lands in the tree.
         */
        const remainingDepositNeeded = Math.max(
          0,
          Math.round((effectiveRequiredDeposit - depositReceived) * 100) / 100
        );
        const depositInputNum = Number(depositInputDraft);
        const depositInputValid =
          depositInputDraft.trim() !== "" &&
          Number.isFinite(depositInputNum) &&
          depositInputNum > 0;
        const canRecord =
          canRecordPayments &&
          hasApprovedSelection &&
          depositInputValid &&
          !recordingDeposit;
        const balanceDue = Math.max(
          0,
          Math.round((effectiveQuotedTotal - summary.total) * 100) / 100
        );
        const finalAmountNum = Number(finalAmountDraft);
        const finalInputValid =
          finalAmountDraft.trim() !== "" &&
          Number.isFinite(finalAmountNum) &&
          finalAmountNum > 0;
        const canRecordFinal =
          canRecordPayments &&
          finalInputValid &&
          !recordingFinal;
        /**
         * Active-phase replacement card: hides every deposit control
         * and replaces them with production tracking (delivery /
         * install / sink models / notes), a final-invoice button, and
         * a final-payment row. The deposit numbers in `BalanceSummary`
         * are also suppressed — once we're past Active, the only
         * number that still matters is the remaining balance.
         */
        const activePhaseControlsNode = (
          <>
            <div className="job-payments-panel__card-head">
              <div>
                <h3 className="job-payments-panel__card-title">
                  Production &amp; final payment
                </h3>
                <p className="job-payments-panel__card-hint">
                  Deposit is collected. Track production milestones,
                  send the final invoice, and record the closing
                  payment here.
                </p>
              </div>
              {paidInFullDerived ? (
                <span
                  className="pill pill--good"
                  title={
                    job.paidInFullAt
                      ? `Paid in full on ${job.paidInFullAt.slice(0, 10)}`
                      : "Paid in full"
                  }
                >
                  Paid in full
                </span>
              ) : null}
            </div>
            <ActiveJobTrackingCard
              job={job}
              canEdit={canRecordPayments}
              onSave={async (patch) => {
                if (!activeCompanyId) return;
                await setJobActiveTracking(
                  activeCompanyId,
                  job.customerId,
                  job.id,
                  patch
                );
              }}
            />
            <BalanceSummary
              quotedTotal={
                effectiveQuotedTotal > 0 ? effectiveQuotedTotal : null
              }
              paidTotal={summary.total}
              depositReceived={depositReceived}
              depositRequired={effectiveRequiredDeposit}
            />
            {canRecordPayments && balanceDue > 0 ? (
              <div className="job-payments-panel__deposit-row">
                <label className="job-payments-panel__field job-payments-panel__field--amount">
                  <span className="job-payments-panel__field-label">
                    Final payment
                  </span>
                  <div className="job-payments-panel__input-affix">
                    <span className="job-payments-panel__input-prefix">$</span>
                    <input
                      className="job-payments-panel__input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={finalAmountDraft}
                      onChange={(e) => {
                        finalAmountDirty.current = true;
                        setFinalAmountDraft(e.target.value);
                      }}
                      disabled={recordingFinal}
                      placeholder="0.00"
                    />
                  </div>
                </label>
                <label className="job-payments-panel__field job-payments-panel__field--method">
                  <span className="job-payments-panel__field-label">
                    Method
                  </span>
                  <select
                    className="job-payments-panel__input"
                    value={finalMethodDraft}
                    onChange={(e) =>
                      setFinalMethodDraft(e.target.value as PaymentMethod)
                    }
                    disabled={recordingFinal}
                  >
                    {PAYMENT_METHOD_OPTIONS.filter(
                      (o) => o.value !== "stripe"
                    ).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-success job-payments-panel__deposit-btn"
                  onClick={() => void handleRecordFinal()}
                  disabled={!canRecordFinal}
                  title={
                    !finalInputValid
                      ? "Enter an amount greater than zero."
                      : undefined
                  }
                >
                  {recordingFinal ? "Recording…" : "Record payment"}
                </button>
                <button
                  type="button"
                  className="btn job-payments-panel__deposit-btn"
                  onClick={() => setFinalInvoiceOpen(true)}
                  disabled={recordingFinal}
                  title="Generate a printable final invoice you can email or save as a PDF."
                >
                  Final invoice
                </button>
              </div>
            ) : null}
            {canRecordPayments && balanceDue === 0 && !job.paidInFullAt ? (
              <div className="job-payments-panel__card-actions job-payments-panel__card-actions--end">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleMarkPaidInFull()}
                  disabled={busy}
                  title="Stamp the paid-in-full timestamp now (normally set automatically once the balance hits zero)."
                >
                  Mark paid in full
                </button>
              </div>
            ) : null}
            {job.finalInvoiceSentAt ? (
              <p className="job-payments-panel__card-hint">
                Final invoice {job.finalInvoiceNumber ?? ""} sent on{" "}
                {job.finalInvoiceSentAt.slice(0, 10)}.
              </p>
            ) : null}
          </>
        );
        const depositPhaseControlsNode = (
          <>
            <div className="job-payments-panel__card-head">
              <div>
                <h3 className="job-payments-panel__card-title">
                  Quoted total &amp; deposit
                </h3>
                <p className="job-payments-panel__card-hint">
                  Quoted total is locked to the customer's approved Layout
                  Studio quote. Required deposit is{" "}
                  <strong>{effectiveDepositPercent}%</strong> of the quote
                  (set in <em>Settings → Pricing</em>).
                </p>
              </div>
            </div>
            <div className="job-payments-panel__readout-grid">
              <div className="job-payments-panel__readout">
                <span className="job-payments-panel__readout-label">
                  Quoted total
                </span>
                <span className="job-payments-panel__readout-value">
                  {effectiveQuotedTotal > 0
                    ? formatMoney(effectiveQuotedTotal)
                    : "—"}
                </span>
                <span className="job-payments-panel__readout-meta product-sub">
                  From the approved quote
                </span>
              </div>
              <div className="job-payments-panel__readout">
                <span className="job-payments-panel__readout-label">
                  Required deposit
                </span>
                <span className="job-payments-panel__readout-value">
                  {effectiveQuotedTotal > 0
                    ? formatMoney(effectiveRequiredDeposit)
                    : "—"}
                </span>
                <span className="job-payments-panel__readout-meta product-sub">
                  {effectiveDepositPercent}% of quote
                  {remainingDepositNeeded > 0 && depositReceived > 0
                    ? ` · ${formatMoney(remainingDepositNeeded)} still needed`
                    : remainingDepositNeeded === 0 && effectiveQuotedTotal > 0
                    ? " · satisfied"
                    : ""}
                </span>
              </div>
            </div>
            {canRecordPayments ? (
              <div className="job-payments-panel__deposit-row">
                <label className="job-payments-panel__field job-payments-panel__field--amount">
                  <span className="job-payments-panel__field-label">
                    Deposit amount
                  </span>
                  <div className="job-payments-panel__input-affix">
                    <span className="job-payments-panel__input-prefix">$</span>
                    <input
                      className="job-payments-panel__input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={depositInputDraft}
                      onChange={(e) => {
                        depositInputDirty.current = true;
                        setDepositInputDraft(e.target.value);
                      }}
                      disabled={
                        recordingDeposit || effectiveQuotedTotal <= 0
                      }
                      placeholder="0.00"
                    />
                  </div>
                </label>
                <label className="job-payments-panel__field job-payments-panel__field--method">
                  <span className="job-payments-panel__field-label">
                    Method
                  </span>
                  <select
                    className="job-payments-panel__input"
                    value={depositMethodDraft}
                    onChange={(e) =>
                      setDepositMethodDraft(e.target.value as PaymentMethod)
                    }
                    disabled={recordingDeposit || effectiveQuotedTotal <= 0}
                  >
                    {PAYMENT_METHOD_OPTIONS.filter(
                      (o) => o.value !== "stripe"
                    ).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-success job-payments-panel__deposit-btn"
                  onClick={() => void handleRecordDeposit()}
                  disabled={!canRecord}
                  title={
                    !hasApprovedSelection
                      ? "Approve a quoted material first to record a deposit."
                      : !depositInputValid
                      ? "Enter an amount greater than zero."
                      : undefined
                  }
                >
                  {recordingDeposit ? "Recording…" : "Record deposit"}
                </button>
                {/*
                 * "Invoice" is the natural sibling of "Record deposit" while
                 * we're waiting on a deposit: same row, same surface. We
                 * only show it when there's something to invoice (a quote
                 * is approved) and nothing has been collected yet — once a
                 * deposit lands, the job auto-promotes to Active and the
                 * deposit-collection workflow ends.
                 */}
                {hasApprovedSelection &&
                effectiveQuotedTotal > 0 &&
                depositReceived === 0 ? (
                  <button
                    type="button"
                    className="btn job-payments-panel__deposit-btn"
                    onClick={() => setInvoiceOpen(true)}
                    disabled={recordingDeposit}
                    title="Generate a printable deposit invoice you can email or save as a PDF."
                  >
                    Invoice
                  </button>
                ) : null}
              </div>
            ) : null}
            {job.pricingLocked &&
            (role === "owner" || role === "admin") ? (
              <div className="job-payments-panel__card-actions job-payments-panel__card-actions--end">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleUnlock()}
                  disabled={busy}
                >
                  Unlock pricing
                </button>
              </div>
            ) : null}
            <BalanceSummary
              quotedTotal={effectiveQuotedTotal > 0 ? effectiveQuotedTotal : null}
              paidTotal={summary.total}
              depositReceived={depositReceived}
              depositRequired={effectiveRequiredDeposit}
            />
          </>
        );
        /**
         * Switch the card body on phase. Pre-Active = collect the
         * deposit; Active+ = track production and collect the
         * remaining balance. Same outer card wrapper either way so
         * the layout stays consistent (and the inline-into-approved-
         * material variant keeps working).
         */
        const pricingControlsNode = isActivePhase
          ? activePhaseControlsNode
          : depositPhaseControlsNode;

        const hasApprovedAreaWithSection =
          !!quotedMaterialsByArea &&
          quotedMaterialsByArea.some((s) => s.approvedOption !== null);
        const inlinePricingActive =
          hasApprovedSelection && hasApprovedAreaWithSection;

        return (
          <>
            {quotedMaterialsByArea && quotedMaterialsByArea.length > 0 ? (
              <QuotedMaterialsByArea
                jobId={job.id}
                sections={quotedMaterialsByArea}
                jobIsApproved={
                  status === "active" ||
                  status === "installed" ||
                  status === "complete"
                }
                approvalBusyKey={approvalBusyKey ?? null}
                approvalError={approvalError ?? null}
                onApproveAreaOption={onApproveAreaOption}
                onClearAreaApproval={onClearAreaApproval}
                layoutStudioHrefForArea={layoutStudioHrefForArea}
                pricingControls={
                  inlinePricingActive ? pricingControlsNode : undefined
                }
              />
            ) : null}

            {error ? (
              <div className="settings-inline-msg settings-inline-msg--bad">
                {error}
              </div>
            ) : null}

            <div className="job-payments-panel__grid">
              {inlinePricingActive ? null : hasApprovedSelection ||
                isActivePhase ? (
                <div className="job-payments-panel__card job-payments-panel__card--pricing">
                  {pricingControlsNode}
                </div>
              ) : null}
            </div>
          </>
        );
      })()}

      <div className="job-payments-panel__list-head">
        <h3 className="job-payments-panel__section-title">
          Payments
          <span className="job-payments-panel__count">({payments.length})</span>
        </h3>
      </div>
      {payments.length === 0 ? (
        <p className="settings-card__hint">No payments recorded yet.</p>
      ) : (
        <table className="job-payments-panel__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Kind</th>
              <th>Method</th>
              <th>Amount</th>
              <th>Ref #</th>
              <th>Recorded by</th>
              <th>Notes</th>
              {canRecordPayments ? <th aria-label="actions"></th> : null}
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{p.receivedAt.slice(0, 10)}</td>
                <td>{p.kind}</td>
                <td>{p.method}</td>
                <td>{formatMoney(p.amount)}</td>
                <td>{p.referenceNumber ?? "—"}</td>
                <td>{p.recordedByDisplayName ?? "—"}</td>
                <td>{p.notes || "—"}</td>
                {canRecordPayments ? (
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleDeletePayment(p)}
                    >
                      Delete
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {activeCompanyId ? (
        <RecordPaymentModal
          open={modalOpen}
          companyId={activeCompanyId}
          customerId={job.customerId}
          jobId={job.id}
          requiredDepositAmount={job.requiredDepositAmount ?? null}
          depositReceivedTotal={depositReceived}
          quotedTotal={job.quotedTotal ?? null}
          paidTotal={summary.total}
          onClose={() => setModalOpen(false)}
          onRecorded={() => setModalOpen(false)}
        />
      ) : null}
      <InvoiceModal
        open={invoiceOpen}
        onClose={() => setInvoiceOpen(false)}
        company={activeCompany}
        customer={customer}
        job={job}
        quotedTotal={effectiveQuotedTotal}
        depositRequired={effectiveRequiredDeposit}
        depositReceived={depositReceived}
        quotedMaterialsByArea={quotedMaterialsByArea}
      />
      {/*
       * Defensive open-gate: even though the trigger button is hidden
       * pre-Active, this guard keeps the modal from rendering if state
       * gets out of sync (e.g. a stale `jobSheetOpen=true` after a
       * status flip back to Quote).
       */}
      <JobSheetModal
        open={jobSheetOpen && isActivePhase}
        onClose={() => setJobSheetOpen(false)}
        company={activeCompany}
        customer={customer}
        job={job}
        quotedMaterialsByArea={quotedMaterialsByArea}
      />
      {/*
       * Final-invoice rendering. Same component, `mode="final"` flips
       * the headline + email body. We stamp the job's
       * `finalInvoiceNumber` / `finalInvoiceSentAt` when the modal
       * opens so the audit trail records that a balance-due invoice
       * was generated, even if the rep ultimately copies the email
       * vs. printing.
       */}
      <InvoiceModal
        open={finalInvoiceOpen}
        onClose={() => setFinalInvoiceOpen(false)}
        company={activeCompany}
        customer={customer}
        job={job}
        quotedTotal={effectiveQuotedTotal}
        depositRequired={effectiveRequiredDeposit}
        depositReceived={depositReceived}
        paidTotal={summary.total}
        mode="final"
        quotedMaterialsByArea={quotedMaterialsByArea}
        onInvoiceNumberGenerated={(num) => {
          if (!activeCompanyId) return;
          // Fire-and-forget — we surface failures in the panel error
          // banner via the next user action; not worth blocking the
          // print/copy flow on a write that can be retried.
          void recordFinalInvoiceSent(
            activeCompanyId,
            job.customerId,
            job.id,
            num
          ).catch((err) =>
            setError(
              err instanceof Error
                ? err.message
                : "Could not save final-invoice metadata."
            )
          );
        }}
      />
    </section>
  );
}

/**
 * Active-phase production tracking card. Lets the rep capture (and
 * later edit) the four production milestones the user asked for:
 *   - material delivery date
 *   - requested install date
 *   - sink models on the job (auto-derived from approved Layout
 *     Studio plans, with a free-form override for one-offs)
 *   - free-form production notes
 *
 * Sink models are presented as a comma-separated string for editing
 * convenience; we split + trim on save. Auto-derived models are
 * shown as the placeholder so the rep can see what we'd seed if they
 * never touch the field.
 */
function ActiveJobTrackingCard({
  job,
  canEdit,
  onSave,
}: {
  job: JobRecord;
  canEdit: boolean;
  onSave: (patch: {
    materialDeliveryDate?: string | null;
    requestedInstallDate?: string | null;
    activeJobNotes?: string | null;
    sinkModelsOverride?: string[] | null;
  }) => Promise<void>;
}) {
  const derivedSinks = useMemo(() => deriveJobSinkModels(job), [job]);
  const initialSinkText = useMemo(() => {
    const list =
      job.sinkModelsOverride && job.sinkModelsOverride.length > 0
        ? job.sinkModelsOverride
        : derivedSinks;
    return list.join(", ");
  }, [job.sinkModelsOverride, derivedSinks]);

  const [delivery, setDelivery] = useState<string>(
    job.materialDeliveryDate ?? ""
  );
  const [install, setInstall] = useState<string>(
    job.requestedInstallDate ?? ""
  );
  const [notes, setNotes] = useState<string>(job.activeJobNotes ?? "");
  const [sinkText, setSinkText] = useState<string>(initialSinkText);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Re-sync local drafts whenever the underlying job doc changes
   * server-side (e.g. another rep edits the same job). We only stomp
   * the input when the value actually differs — typing into an empty
   * field while a no-op snapshot arrives shouldn't reset the cursor.
   */
  useEffect(() => {
    setDelivery(job.materialDeliveryDate ?? "");
  }, [job.materialDeliveryDate]);
  useEffect(() => {
    setInstall(job.requestedInstallDate ?? "");
  }, [job.requestedInstallDate]);
  useEffect(() => {
    setNotes(job.activeJobNotes ?? "");
  }, [job.activeJobNotes]);
  useEffect(() => {
    setSinkText(initialSinkText);
  }, [initialSinkText]);

  async function commit(
    fieldName: string,
    patch: Parameters<typeof onSave>[0]
  ) {
    if (!canEdit) return;
    setSavingField(fieldName);
    setSaveError(null);
    try {
      await onSave(patch);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save change."
      );
    } finally {
      setSavingField(null);
    }
  }

  function commitSinks() {
    const tokens = sinkText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    /**
     * If the rep cleared the override OR typed exactly the auto-derived
     * list back in, store `null` so we keep auto-deriving going
     * forward. That way edits to the layout that change which sinks
     * are placed continue to flow into the displayed list.
     */
    const matchesDerived =
      tokens.length === derivedSinks.length &&
      tokens.every(
        (t, i) => t.toLowerCase() === derivedSinks[i]?.toLowerCase()
      );
    const next: string[] | null =
      tokens.length === 0 || matchesDerived ? null : tokens;
    void commit("sinks", { sinkModelsOverride: next });
  }

  return (
    <div
      className="job-payments-panel__active-tracking"
      aria-label="Production tracking"
    >
      <div className="job-payments-panel__readout-grid">
        <label className="job-payments-panel__field">
          <span className="job-payments-panel__field-label">
            Material delivery
          </span>
          <div className="job-payments-panel__input-affix">
            <input
              type="date"
              className="job-payments-panel__input"
              value={delivery}
              disabled={!canEdit || savingField === "delivery"}
              onChange={(e) => setDelivery(e.target.value)}
              onBlur={() => {
                const next = delivery || null;
                if ((job.materialDeliveryDate ?? null) === next) return;
                void commit("delivery", { materialDeliveryDate: next });
              }}
            />
          </div>
        </label>
        <label className="job-payments-panel__field">
          <span className="job-payments-panel__field-label">
            Requested install
          </span>
          <div className="job-payments-panel__input-affix">
            <input
              type="date"
              className="job-payments-panel__input"
              value={install}
              disabled={!canEdit || savingField === "install"}
              onChange={(e) => setInstall(e.target.value)}
              onBlur={() => {
                const next = install || null;
                if ((job.requestedInstallDate ?? null) === next) return;
                void commit("install", { requestedInstallDate: next });
              }}
            />
          </div>
        </label>
      </div>
      <label className="job-payments-panel__field">
        <span className="job-payments-panel__field-label">Sink models</span>
        <div className="job-payments-panel__input-affix">
          <input
            type="text"
            className="job-payments-panel__input"
            value={sinkText}
            disabled={!canEdit || savingField === "sinks"}
            placeholder={
              derivedSinks.length > 0
                ? derivedSinks.join(", ")
                : "e.g. Karran QU-712, Bocchi 1633"
            }
            onChange={(e) => setSinkText(e.target.value)}
            onBlur={commitSinks}
          />
        </div>
        {derivedSinks.length > 0 ? (
          <span className="job-payments-panel__field-hint product-sub">
            From the customer's approved plan:{" "}
            {derivedSinks.join(", ")}
          </span>
        ) : null}
      </label>
      <label className="job-payments-panel__field">
        <span className="job-payments-panel__field-label">Notes</span>
        <div className="job-payments-panel__input-affix job-payments-panel__input-affix--textarea">
          <textarea
            className="job-payments-panel__input"
            value={notes}
            rows={3}
            disabled={!canEdit || savingField === "notes"}
            placeholder="Production notes, special instructions, edge profile reminders…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              const next = notes.trim() || null;
              if ((job.activeJobNotes ?? null) === next) return;
              void commit("notes", { activeJobNotes: next });
            }}
          />
        </div>
      </label>
      {saveError ? (
        <div className="settings-inline-msg settings-inline-msg--bad">
          {saveError}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact "pipeline" pill row that summarizes the job's bookkeeping signal
 * without restating the materials list. It surfaces three numbers reps care
 * about most: how many materials have been quoted, how many the customer
 * has chosen, and how the deposit stands. Each chip carries a tooltip with
 * the dollar specifics where applicable.
 */
function PipelineSummary({
  quotedCount,
  approvedCount,
  depositRequired,
  depositReceived,
  depositSatisfied,
  status,
}: {
  quotedCount?: number;
  approvedCount?: number;
  depositRequired: number;
  depositReceived: number;
  depositSatisfied: boolean;
  status: JobStatus;
}) {
  const showQuoted = typeof quotedCount === "number";
  const showApproved = typeof approvedCount === "number";
  const remaining = Math.max(0, depositRequired - depositReceived);
  const advancedStatus =
    status === "active" ||
    status === "installed" ||
    status === "complete";
  /**
   * Once the job is in the Active phase the deposit conversation is
   * over (we already collected it) — every additional pill the user
   * sees should be about production / final billing, not "Deposit
   * collected" stamps. We keep the chip for draft/quote where the
   * deposit gate is still meaningful.
   */
  const showDepositChip = !advancedStatus;
  const depositChipState: "neutral" | "warning" | "good" = depositSatisfied
    ? "good"
    : depositRequired > 0 || depositReceived > 0
    ? "warning"
    : "neutral";
  const depositLabel = (() => {
    if (depositSatisfied) return "Deposit collected";
    if (depositRequired > 0) {
      return `${formatMoney(remaining)} deposit needed`;
    }
    return "No deposit recorded";
  })();
  const depositTitle = (() => {
    if (depositRequired > 0) {
      return `${formatMoney(depositReceived)} of ${formatMoney(depositRequired)} received`;
    }
    return depositReceived > 0
      ? `${formatMoney(depositReceived)} on file (no minimum required).`
      : "No deposit recorded yet — Active is locked until one is.";
  })();
  if (!showQuoted && !showApproved) {
    if (!showDepositChip) return null;
    return (
      <div className="job-payments-panel__pipeline" role="group" aria-label="Pipeline status">
        <span
          className={`job-payments-panel__pipeline-chip job-payments-panel__pipeline-chip--${depositChipState}`}
          title={depositTitle}
        >
          <span className="job-payments-panel__pipeline-chip-dot" aria-hidden="true" />
          {depositLabel}
        </span>
      </div>
    );
  }
  return (
    <div className="job-payments-panel__pipeline" role="group" aria-label="Pipeline status">
      {showQuoted ? (
        <span
          className={`job-payments-panel__pipeline-chip${
            (quotedCount ?? 0) > 0
              ? " job-payments-panel__pipeline-chip--info"
              : " job-payments-panel__pipeline-chip--neutral"
          }`}
          title="Materials with a saved layout in Layout Studio."
        >
          <strong>{quotedCount}</strong>{" "}
          {quotedCount === 1 ? "quoted" : "quoted"}
        </span>
      ) : null}
      {showApproved ? (
        <span
          className={`job-payments-panel__pipeline-chip${
            (approvedCount ?? 0) > 0
              ? " job-payments-panel__pipeline-chip--info"
              : " job-payments-panel__pipeline-chip--neutral"
          }`}
          title="Materials picked as the customer's choice for an area."
        >
          <strong>{approvedCount}</strong>{" "}
          {approvedCount === 1 ? "approved" : "approved"}
        </span>
      ) : null}
      {showDepositChip ? (
        <span
          className={`job-payments-panel__pipeline-chip job-payments-panel__pipeline-chip--${depositChipState}`}
          title={depositTitle}
        >
          <span className="job-payments-panel__pipeline-chip-dot" aria-hidden="true" />
          {depositLabel}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Per-status label for the primary "advance" action surfaced in the
 * lifecycle panel header. Mirrors the linear forward arrow in
 * `JOB_STATUS_TRANSITIONS` so the button always points at the next
 * canonical phase.
 */
const ADVANCE_ACTION_LABELS: Partial<Record<JobStatus, string>> = {
  draft: "Move to Quote",
  quote: "Move to Active",
  active: "Mark as Installed",
  installed: "Mark as Complete",
  // Cancelled jobs surface a "Reopen" action that drops the job back
  // into Draft so reps can revive it without recreating the record.
  cancelled: "Reopen job",
};

/** Forward target on the canonical lifecycle for a given status. */
const ADVANCE_TARGETS: Partial<Record<JobStatus, JobStatus>> = {
  draft: "quote",
  quote: "active",
  active: "installed",
  installed: "complete",
  cancelled: "draft",
};

/**
 * Confirmation prompt copy for advance actions that should ask the
 * user before firing. Currently we gate the "Mark as Installed"
 * transition because reverting it requires going through Cancel +
 * Reopen, and we don't want a stray click moving production along.
 * Other linear transitions are reversible (you can step back from
 * Quote → Draft, etc.) so they go through silently.
 */
/**
 * Per-status copy for the styled in-app ConfirmDialog when the rep
 * clicks the lifecycle advance button. Only statuses listed here ask
 * for confirmation; everything else fires `onAdvance` immediately.
 *
 * Title is the modal heading; message is the body copy; confirmLabel
 * is what the affirmative button reads (defaults to "Confirm" if not
 * set). danger=true paints the affirmative button as the primary
 * (highlighted) action so destructive transitions read clearly.
 */
type AdvanceConfirmCopy = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};

const ADVANCE_CONFIRM_PROMPTS: Partial<Record<JobStatus, AdvanceConfirmCopy>> = {
  active: {
    title: "Mark this job as Installed?",
    message:
      "Confirm the material has actually been installed at the customer site before continuing. You can still record the final payment afterward.",
    confirmLabel: "Mark as Installed",
  },
};

type LifecycleAdvanceContext = {
  requiredDepositAmount: number;
  depositReceivedTotal: number;
  quotedTotal: number | null | undefined;
  paidTotal: number;
  areas: import("../types/compareQuote").JobAreaRecord[];
  options: import("../types/compareQuote").JobComparisonOptionRecord[];
};

/**
 * Quick-action buttons in the lifecycle header that let reps advance
 * the job to the next canonical phase (or cancel it) without hunting
 * for the right step in the stepper below. Reuses `handleStatusClick`
 * via the `onAdvance` callback so the lifecycle gates / error surface /
 * audit trail stay identical to the stepper buttons.
 */
function LifecycleAdvanceActions({
  status,
  disabled,
  lifecycleContext,
  onAdvance,
}: {
  status: JobStatus;
  disabled: boolean;
  lifecycleContext: LifecycleAdvanceContext;
  onAdvance: (next: JobStatus) => void;
}) {
  const advanceTarget = ADVANCE_TARGETS[status];
  const advanceLabel = advanceTarget ? ADVANCE_ACTION_LABELS[status] : null;
  const canCancel = status !== "complete" && status !== "cancelled";

  if (!advanceTarget && !canCancel) return null;

  const advanceEvaluation = advanceTarget
    ? evaluateJobTransition(status, advanceTarget, lifecycleContext)
    : null;
  const advanceBlocked = !!(advanceEvaluation && !advanceEvaluation.ok);
  const advanceTooltip = advanceTarget
    ? advanceEvaluation && !advanceEvaluation.ok
      ? blockReasonMessage(status, advanceTarget, advanceEvaluation.reason, {
          depositRequired: lifecycleContext.requiredDepositAmount,
          depositReceived: lifecycleContext.depositReceivedTotal,
          quotedTotal: lifecycleContext.quotedTotal,
          paidTotal: lifecycleContext.paidTotal,
        })
      : `Move this job to ${JOB_STATUS_LABELS[advanceTarget]}.`
    : undefined;
  const advanceConfirm = ADVANCE_CONFIRM_PROMPTS[status] ?? null;
  /**
   * Outline-only styling for the advance button: colored border + text
   * matching the destination phase, transparent background. Keeps the
   * lifecycle header visually quiet while still color-coding the next
   * step at a glance.
   */
  const advanceStyle = advanceTarget
    ? {
        borderColor: JOB_STATUS_COLOR[advanceTarget],
        color: JOB_STATUS_COLOR[advanceTarget],
        background: "transparent",
      }
    : undefined;

  /**
   * Confirmation modal state. We use the in-app `ConfirmDialog`
   * (matches the rest of the job UI) instead of `window.confirm`
   * because the native browser dialog reads as an alien OS-level
   * popup against our dark glass chrome and doesn't carry the app's
   * type / spacing / button treatment.
   */
  const [advanceConfirmOpen, setAdvanceConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const handleAdvanceClick = () => {
    if (!advanceTarget) return;
    if (advanceConfirm) {
      setAdvanceConfirmOpen(true);
      return;
    }
    onAdvance(advanceTarget);
  };

  const handleAdvanceConfirmed = () => {
    setAdvanceConfirmOpen(false);
    if (!advanceTarget) return;
    onAdvance(advanceTarget);
  };

  const handleCancelClick = () => {
    setCancelConfirmOpen(true);
  };

  const handleCancelConfirmed = () => {
    setCancelConfirmOpen(false);
    onAdvance("cancelled");
  };

  return (
    <>
      {advanceTarget && advanceLabel ? (
        <button
          type="button"
          className="btn"
          onClick={handleAdvanceClick}
          disabled={disabled || advanceBlocked}
          title={advanceTooltip}
          style={advanceStyle}
        >
          {advanceLabel}
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleCancelClick}
          disabled={disabled}
          title="Cancel this job."
        >
          Cancel job
        </button>
      ) : null}

      {advanceConfirm && advanceTarget ? (
        <ConfirmDialog
          open={advanceConfirmOpen}
          title={advanceConfirm.title}
          message={advanceConfirm.message}
          confirmLabel={advanceConfirm.confirmLabel ?? "Confirm"}
          danger={advanceConfirm.danger}
          onCancel={() => setAdvanceConfirmOpen(false)}
          onConfirm={handleAdvanceConfirmed}
        />
      ) : null}
      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Cancel this job?"
        message="The job is moved to Cancelled. You can reopen it later from this same panel — recorded payments stay on file and nothing is deleted."
        confirmLabel="Cancel job"
        cancelLabel="Keep job open"
        danger
        onCancel={() => setCancelConfirmOpen(false)}
        onConfirm={handleCancelConfirmed}
      />
    </>
  );
}

function StatusStepper({
  current,
  disabled,
  onClick,
  lifecycleContext,
}: {
  current: JobStatus;
  disabled: boolean;
  onClick: (next: JobStatus) => void;
  lifecycleContext: {
    requiredDepositAmount: number;
    depositReceivedTotal: number;
    quotedTotal: number | null | undefined;
    paidTotal: number;
    areas: import("../types/compareQuote").JobAreaRecord[];
    options: import("../types/compareQuote").JobComparisonOptionRecord[];
  };
}) {
  const currentIndex = STEPPER_STATUSES.indexOf(current);
  const progressPct =
    currentIndex <= 0
      ? 0
      : currentIndex >= STEPPER_STATUSES.length - 1
      ? 100
      : (currentIndex / (STEPPER_STATUSES.length - 1)) * 100;
  return (
    <div className="job-status-stepper-wrap">
      <div
        className="job-status-stepper__rail"
        aria-hidden="true"
      >
        <div
          className="job-status-stepper__rail-fill"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <ol className="job-status-stepper" aria-label="Job lifecycle">
        {STEPPER_STATUSES.map((s, i) => {
          const isActive = s === current;
          const isPast = currentIndex > i;
          /**
           * Evaluate the full lifecycle gate so the button knows
           * whether it's blocked by the allow-list, by a missing
           * quoted material, by a missing approval, by a missing
           * deposit, or by an unpaid balance — and can show the
           * right tooltip + lock icon for each.
           */
          const evaluation = isActive
            ? ({ ok: true } as const)
            : evaluateJobTransition(current, s, lifecycleContext);
          const canMove = evaluation.ok;
          const reason = evaluation.ok ? null : evaluation.reason;
          const blockedOnGate =
            reason === "needs_quoted_material" ||
            reason === "needs_approved_area" ||
            reason === "needs_deposit" ||
            reason === "needs_paid_in_full";
          const tooltip = canMove
            ? `Move to ${JOB_STATUS_LABELS[s]}`
            : isActive
            ? "Current status"
            : reason
            ? blockReasonMessage(current, s, reason, {
                depositRequired: lifecycleContext.requiredDepositAmount,
                depositReceived: lifecycleContext.depositReceivedTotal,
                quotedTotal: lifecycleContext.quotedTotal,
                paidTotal: lifecycleContext.paidTotal,
              })
            : `Not allowed from ${JOB_STATUS_LABELS[current]}`;
          return (
            <li
              key={s}
              className={`job-status-stepper__item${
                isActive ? " job-status-stepper__item--active" : ""
              }${isPast ? " job-status-stepper__item--done" : ""}${
                blockedOnGate
                  ? " job-status-stepper__item--locked-deposit"
                  : ""
              }`}
            >
              <button
                type="button"
                className="job-status-stepper__btn"
                style={{
                  borderColor: isActive || isPast ? JOB_STATUS_COLOR[s] : undefined,
                  color: isActive ? "#fff" : JOB_STATUS_COLOR[s],
                  background: isActive ? JOB_STATUS_COLOR[s] : undefined,
                  boxShadow: isActive
                    ? `0 0 0 4px ${JOB_STATUS_COLOR[s]}22, 0 8px 22px ${JOB_STATUS_COLOR[s]}33`
                    : undefined,
                }}
                onClick={() => onClick(s)}
                disabled={disabled || (!canMove && !isActive)}
                title={tooltip}
                aria-label={
                  blockedOnGate
                    ? `${JOB_STATUS_LABELS[s]} (locked — ${reason?.replace(/_/g, " ")})`
                    : undefined
                }
              >
                <span className="job-status-stepper__index" aria-hidden="true">
                  {isPast ? "✓" : blockedOnGate ? "🔒" : i + 1}
                </span>
                <span className="job-status-stepper__label">
                  {JOB_STATUS_LABELS[s]}
                </span>
              </button>
            </li>
          );
        })}
        {current === "cancelled" ? (
          <li className="job-status-stepper__cancelled">
            <span className="pill pill--bad">Cancelled</span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

/**
 * Compact payment progress card. Replaces the old "deposit received"
 * gauge with something that stays useful through the entire job
 * lifecycle:
 *
 *   - Bar fill = `paidTotal / quotedTotal` so reps can see at a glance
 *     how close the customer is to closing the job out.
 *   - A vertical marker on the bar shows where the *required* deposit
 *     sits along that 0..quotedTotal track. The two glyphs together
 *     convey three things in one glance: how much has been paid, how
 *     much was needed up front, and how much is left.
 *   - Color states:
 *       • warning (amber) — required deposit isn't met yet
 *       • progress (indigo) — deposit met, more payments outstanding
 *       • satisfied (green) — fully paid in / above the quote
 *
 * Used in both the deposit phase (Quoted total & deposit card) and the
 * active phase (Production & final payment card) so reps see the same
 * "is this paid?" answer everywhere it matters.
 */
function BalanceSummary({
  quotedTotal,
  paidTotal,
  depositReceived,
  depositRequired,
}: {
  quotedTotal: number | null;
  paidTotal: number;
  depositReceived: number;
  depositRequired: number;
}) {
  const hasQuote = quotedTotal != null && quotedTotal > 0;
  const balance = hasQuote ? Math.max(0, (quotedTotal as number) - paidTotal) : null;

  /**
   * Fill width = paid / quoted. We clamp at 100% so an over-payment
   * (e.g. tip recorded as a positive adjustment) still renders inside
   * the bar — the headline number underneath shows the real total.
   */
  const paidPct = hasQuote
    ? Math.min(
        100,
        Math.round(((paidTotal / (quotedTotal as number)) * 100) * 10) / 10
      )
    : paidTotal > 0
    ? 100
    : 0;

  /**
   * Marker position for the required deposit. Only meaningful when we
   * have both a quote and a non-trivial deposit requirement. Clamped
   * just inside the bar (1..99) so the glyph never sits on the
   * rounded corner where it would look like it's falling off.
   */
  const showMarker = hasQuote && depositRequired > 0;
  const markerPct = showMarker
    ? Math.max(
        1,
        Math.min(99, (depositRequired / (quotedTotal as number)) * 100)
      )
    : 0;

  const depositMet =
    depositRequired === 0
      ? depositReceived > 0
      : depositReceived >= depositRequired;
  const fullyPaid = hasQuote && paidTotal >= (quotedTotal as number) - 0.005;
  const state: "warning" | "progress" | "satisfied" = fullyPaid
    ? "satisfied"
    : depositMet
    ? "progress"
    : "warning";

  const subline = (() => {
    if (!hasQuote) {
      return paidTotal > 0
        ? `${formatMoney(paidTotal)} on file (no quote set yet).`
        : "Approve a quote to set the payment goal.";
    }
    if (fullyPaid) return "Paid in full — ready to close out.";
    const remaining = Math.max(0, (quotedTotal as number) - paidTotal);
    if (!depositMet && depositRequired > 0) {
      const depositRemaining = Math.max(0, depositRequired - depositReceived);
      return `Awaiting deposit — ${formatMoney(depositRemaining)} of ${formatMoney(
        depositRequired
      )} required.`;
    }
    return `${formatMoney(remaining)} remaining to close out the job.`;
  })();

  return (
    <div className="balance-summary">
      <div
        className={`balance-summary__deposit-tile balance-summary__deposit-tile--${state}`}
      >
        <div className="balance-summary__deposit-tile__head">
          <span className="balance-summary__deposit-tile__label">
            Payment progress
          </span>
          <span className="balance-summary__deposit-tile__amount">
            {formatMoney(paidTotal)}
            {hasQuote ? (
              <span className="balance-summary__deposit-tile__amount-of">
                {" "}/ {formatMoney(quotedTotal as number)}
              </span>
            ) : null}
          </span>
        </div>
        <div className="balance-summary__deposit-tile__sub">{subline}</div>
        <div
          className="balance-summary__bar"
          aria-label="Payment progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={paidPct}
          aria-valuetext={
            hasQuote
              ? `${formatMoney(paidTotal)} of ${formatMoney(
                  quotedTotal as number
                )} paid`
              : `${formatMoney(paidTotal)} on file`
          }
        >
          <div
            className="balance-summary__bar-fill"
            style={{ width: `${paidPct}%` }}
          />
          {showMarker ? (
            <span
              className={`balance-summary__bar-marker${
                depositMet ? " balance-summary__bar-marker--met" : ""
              }`}
              style={{ left: `${markerPct}%` }}
              title={`Required deposit: ${formatMoney(depositRequired)}`}
              aria-hidden="true"
            />
          ) : null}
        </div>
        {showMarker ? (
          <div className="balance-summary__bar-legend">
            <span
              className={`balance-summary__bar-legend-dot${
                depositMet
                  ? " balance-summary__bar-legend-dot--met"
                  : " balance-summary__bar-legend-dot--pending"
              }`}
              aria-hidden="true"
            />
            <span>
              Deposit {depositMet ? "received" : "required"}:{" "}
              {formatMoney(depositRequired)}
              {depositReceived > 0 && depositReceived !== depositRequired
                ? ` (${formatMoney(depositReceived)} on file)`
                : ""}
            </span>
          </div>
        ) : null}
      </div>
      {balance != null ? (
        <div className="balance-summary__row balance-summary__row--strong">
          <span>Balance due</span>
          <span>{formatMoney(balance)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Per-area summary of materials that have actually been quoted in
 * Layout Studio. The job lifecycle cares about quoted candidates (not
 * every option attached to the job), so this is what reps see when
 * picking the customer's choice. Approving a material here is the same
 * action that used to live on the old "Materials by area" cards on the
 * Job detail page — we just brought it next to the lifecycle stepper
 * where it actually matters.
 */
function QuotedMaterialsByArea({
  jobId,
  sections,
  jobIsApproved,
  approvalBusyKey,
  approvalError,
  onApproveAreaOption,
  onClearAreaApproval,
  layoutStudioHrefForArea,
  pricingControls,
}: {
  jobId: string;
  sections: QuotedAreaSection[];
  jobIsApproved: boolean;
  approvalBusyKey: string | null;
  approvalError: string | null;
  onApproveAreaOption?: (areaId: string, optionId: string) => void;
  onClearAreaApproval?: (areaId: string) => void;
  layoutStudioHrefForArea?: (
    areaId: string,
    optionId?: string
  ) => string;
  /**
   * Pricing controls (Quoted total / Required deposit / Save / locked
   * pricing badge / balance summary) rendered inline inside the FIRST
   * approved material card. Lives here so reps see the deposit math
   * right where they pick the customer's material — no need to scroll
   * down to a separate "Quoted total & deposit" card. Provided by the
   * panel so all the inputs share the same component-level draft state.
   */
  pricingControls?: React.ReactNode;
}) {
  const totalQuoted = sections.reduce((sum, s) => sum + s.quoted.length, 0);
  const studioHref = (areaId: string, optionId?: string) => {
    if (layoutStudioHrefForArea) return layoutStudioHrefForArea(areaId, optionId);
    const params = new URLSearchParams({ area: areaId });
    if (optionId) params.set("option", optionId);
    return `/compare/jobs/${jobId}/layout?${params.toString()}`;
  };

  /**
   * The pricing controls only need to render once across all approved
   * cards (they edit job-level fields, not per-area). We pin them to
   * the first approved material so they appear right next to the
   * primary customer choice.
   */
  let renderedInlinePricing = false;

  return (
    <section
      className="job-payments-panel__quoted-materials"
      aria-label="Quoted materials by area"
    >
      <header className="job-payments-panel__quoted-materials-head">
        <div>
          <h3 className="job-payments-panel__quoted-materials-title">
            Quoted materials
          </h3>
          <p className="job-payments-panel__quoted-materials-lede product-sub">
            Materials priced in Layout Studio show up here. Approve one per
            area as the customer's choice — the quote locks once a deposit
            is recorded.
          </p>
        </div>
        <span className="job-payments-panel__quoted-materials-count">
          {totalQuoted} quoted across {sections.length}{" "}
          {sections.length === 1 ? "area" : "areas"}
        </span>
      </header>

      {approvalError ? (
        <div
          className="settings-inline-msg settings-inline-msg--bad"
          role="alert"
        >
          {approvalError}
        </div>
      ) : null}

      <div className="job-payments-panel__quoted-area-list">
        {sections.map((section) => {
          const { area, quoted, unquotedCount, approvedOption } = section;
          return (
            <article
              key={area.id}
              className={`job-payments-panel__quoted-area${
                approvedOption
                  ? jobIsApproved
                    ? " job-payments-panel__quoted-area--approved"
                    : " job-payments-panel__quoted-area--pending"
                  : ""
              }`}
            >
              <header className="job-payments-panel__quoted-area-head">
                <div>
                  <h4 className="job-payments-panel__quoted-area-title">
                    {area.name}
                  </h4>
                  <p className="job-payments-panel__quoted-area-meta product-sub">
                    {quoted.length}{" "}
                    {quoted.length === 1 ? "material quoted" : "materials quoted"}
                  </p>
                </div>
                {approvedOption && onClearAreaApproval ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onClearAreaApproval(area.id)}
                    disabled={approvalBusyKey === `clear:${area.id}`}
                    title={
                      jobIsApproved
                        ? "Clearing the customer's choice on an active job won't undo the deposit."
                        : "Remove the customer's choice for this area."
                    }
                  >
                    {approvalBusyKey === `clear:${area.id}`
                      ? "Clearing…"
                      : "Clear selection"}
                  </button>
                ) : null}
              </header>

              {quoted.length === 0 ? (
                <p className="job-payments-panel__quoted-area-empty product-sub">
                  No materials quoted for this area yet.{" "}
                  <Link to={studioHref(area.id)}>Open Layout Studio</Link> to
                  price one.
                </p>
              ) : (
                <ul className="job-payments-panel__quoted-material-list">
                  {quoted.map((q) => {
                    const key = `${area.id}::${q.option.id}`;
                    const busy = approvalBusyKey === key;
                    const showInlinePricing =
                      q.isApproved &&
                      !!pricingControls &&
                      !renderedInlinePricing;
                    if (showInlinePricing) {
                      renderedInlinePricing = true;
                    }
                    /**
                     * Once one material is approved per area, the other
                     * quoted candidates become inactive — you have to
                     * "Clear selection" on the area to swap. We dim
                     * them and hide the Approve action so the rep can't
                     * accidentally over-write the customer's choice.
                     */
                    const isInactive =
                      Boolean(approvedOption) && !q.isApproved;
                    return (
                      <li
                        key={q.option.id}
                        className={`job-payments-panel__quoted-material${
                          q.isApproved
                            ? " job-payments-panel__quoted-material--approved"
                            : ""
                        }${
                          isInactive
                            ? " job-payments-panel__quoted-material--inactive"
                            : ""
                        }`}
                        aria-disabled={isInactive || undefined}
                      >
                        <div className="job-payments-panel__quoted-material-media">
                          {q.previewUrl ? (
                            <SlabThumbnailLightbox
                              src={q.previewUrl}
                              label={q.option.productName}
                            />
                          ) : (
                            <div className="job-payments-panel__quoted-material-placeholder">
                              No preview
                            </div>
                          )}
                        </div>
                        <div className="job-payments-panel__quoted-material-body">
                          <div className="job-payments-panel__quoted-material-title-row">
                            <h5 className="job-payments-panel__quoted-material-title">
                              {q.option.productName}
                            </h5>
                            {q.isApproved && jobIsApproved ? (
                              <span className="job-payments-panel__quoted-material-flag">
                                Approved quote
                              </span>
                            ) : null}
                          </div>
                          <div className="product-sub">
                            {q.option.vendor}
                            {q.option.manufacturer
                              ? ` · ${q.option.manufacturer}`
                              : ""}
                          </div>
                          {q.customerTotal != null ? (
                            <div className="job-payments-panel__quoted-material-price">
                              <span className="compare-estimate-label">
                                Installed estimate:
                              </span>{" "}
                              <strong>{formatMoney(q.customerTotal)}</strong>
                            </div>
                          ) : null}
                        </div>
                        <div className="job-payments-panel__quoted-material-actions">
                          <Link
                            className="btn btn-sm"
                            to={studioHref(area.id, q.option.id)}
                          >
                            Open in Studio
                          </Link>
                          {q.isApproved ? null : onApproveAreaOption ? (
                            isInactive ? (
                              <span
                                className="product-sub job-payments-panel__quoted-material-inactive-note"
                                title="Clear the current selection above to approve a different material."
                              >
                                Inactive — another material approved
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-success btn-sm"
                                onClick={() =>
                                  onApproveAreaOption(area.id, q.option.id)
                                }
                                disabled={busy}
                                title="Approve this layout quote as the customer's chosen material. Pricing locks once a deposit is recorded."
                              >
                                {busy ? "Saving…" : "Approve quote"}
                              </button>
                            )
                          ) : null}
                        </div>
                        {showInlinePricing ? (
                          <div className="job-payments-panel__quoted-material-pricing">
                            {pricingControls}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              {unquotedCount > 0 ? (
                <p className="job-payments-panel__quoted-area-tail product-sub">
                  {unquotedCount}{" "}
                  {unquotedCount === 1
                    ? "other material added"
                    : "other materials added"}{" "}
                  but not yet quoted —{" "}
                  <Link to={studioHref(area.id)}>price in Layout Studio</Link>.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
