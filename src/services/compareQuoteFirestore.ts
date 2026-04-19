import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  type DocumentData,
  type DocumentReference,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { firebaseDb } from "../firebase";
import {
  buildDefaultCompareOptionPayload,
  buildOptionRecordFields,
} from "../compare/AddPriceOptionModal";
import {
  deleteMirroredJobOptionImage,
  mirrorJobOptionImage,
} from "./jobOptionImageStorage";
import type { CatalogItem } from "../types/catalog";
import type {
  CustomerRecord,
  JobActiveEditor,
  JobAreaRecord,
  JobComparisonOptionRecord,
  JobRecord,
  JobStatus,
} from "../types/compareQuote";
import {
  canTransitionJobStatus,
  evaluateJobTransition,
  jobAreasForJob,
  JOB_ACTIVE_EDITOR_STALE_MS,
  JOB_STATUS_LABELS,
  normalizeJobStatus,
  type JobTransitionBlockReason,
} from "../types/compareQuote";
import { jobQuoteSquareFootage } from "../utils/quotedPrice";

/**
 * Company-scoped Compare Tool / internal quote workflow.
 *
 * Hierarchy:
 *   companies/{companyId}
 *     └── customers/{customerId}
 *           └── jobs/{jobId}
 *                 └── options/{optionId}
 *
 * Every doc keeps `companyId` (and `customerId` / `jobId` where applicable)
 * denormalized for collectionGroup queries (e.g. "recent jobs across the
 * company"). `ownerUserId` and `createdByUserId` are audit fields — they do
 * NOT gate access; company membership does.
 */

const customersCol = (companyId: string) =>
  collection(firebaseDb, "companies", companyId, "customers");

const customerDocRef = (companyId: string, customerId: string) =>
  doc(firebaseDb, "companies", companyId, "customers", customerId);

const jobsCol = (companyId: string, customerId: string) =>
  collection(
    firebaseDb,
    "companies",
    companyId,
    "customers",
    customerId,
    "jobs"
  );

const jobDocRef = (companyId: string, customerId: string, jobId: string) =>
  doc(
    firebaseDb,
    "companies",
    companyId,
    "customers",
    customerId,
    "jobs",
    jobId
  );

const optionsCol = (companyId: string, customerId: string, jobId: string) =>
  collection(
    firebaseDb,
    "companies",
    companyId,
    "customers",
    customerId,
    "jobs",
    jobId,
    "options"
  );

const optionDocRef = (
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string
) =>
  doc(
    firebaseDb,
    "companies",
    companyId,
    "customers",
    customerId,
    "jobs",
    jobId,
    "options",
    optionId
  );

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Normalize a possibly-`Timestamp` value into an ISO string.
 *
 * Most of the client treats `createdAt` / `updatedAt` / `statusChangedAt`
 * as ISO strings — that's how all client writers stamp them. Some Cloud
 * Functions (e.g. `onPaymentWrite`, `onJobStatusTransition`) instead
 * write `FieldValue.serverTimestamp()`, which arrives on the client as a
 * Firestore `Timestamp` object. If those rogue values reach a sort like
 * `b.updatedAt.localeCompare(a.updatedAt)` they throw and silently kill
 * the whole snapshot callback (symptom: jobs disappear from the board
 * the moment a server-side trigger touches them). Coerce defensively
 * here so downstream code can keep assuming "always a string".
 */
function coerceIsoString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof v.toDate === "function") {
      try {
        return v.toDate().toISOString();
      } catch {
        // fall through
      }
    }
    if (typeof v.seconds === "number") {
      const ms =
        v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1_000_000);
      return new Date(ms).toISOString();
    }
  }
  return "";
}

/**
 * Coerce a raw Firestore job doc into the strict `JobRecord` shape the
 * rest of the client expects. See `coerceIsoString` for why.
 */
function normalizeJobDoc(
  id: string,
  raw: Record<string, unknown>
): JobRecord {
  const createdAt =
    coerceIsoString(raw.createdAt) || coerceIsoString(raw.updatedAt) || "";
  const updatedAt = coerceIsoString(raw.updatedAt) || createdAt;
  const statusChangedAt = raw.statusChangedAt
    ? coerceIsoString(raw.statusChangedAt) || undefined
    : undefined;
  const pricingLockedAt = raw.pricingLockedAt
    ? coerceIsoString(raw.pricingLockedAt) || undefined
    : undefined;
  const out: Record<string, unknown> = {
    ...raw,
    id,
    createdAt,
    updatedAt,
  };
  if (statusChangedAt !== undefined) out.statusChangedAt = statusChangedAt;
  if (pricingLockedAt !== undefined) out.pricingLockedAt = pricingLockedAt;
  return out as unknown as JobRecord;
}

// ---------------------------------------------------------------------------
// Image mirroring helper
// ---------------------------------------------------------------------------

export async function prepareJobComparisonOptionFields(
  companyId: string,
  customerId: string,
  jobId: string,
  ownerUserId: string,
  item: CatalogItem,
  quoteBasisSqFt: number,
  payload: Parameters<typeof buildOptionRecordFields>[3]
): Promise<
  Omit<
    JobComparisonOptionRecord,
    "id" | "ownerUserId" | "createdAt" | "updatedAt"
  >
> {
  const fields = buildOptionRecordFields(item, jobId, quoteBasisSqFt, payload);
  const sourceImageUrl = fields.imageUrl?.trim() || null;
  if (!sourceImageUrl) return fields;
  try {
    const mirrored = await mirrorJobOptionImage({
      companyId,
      customerId,
      jobId,
      ownerUserId,
      sourceImageUrl,
      catalogItemId: item.id,
      productName: item.displayName || item.productName,
    });
    if (!mirrored) return fields;
    return {
      ...fields,
      imageUrl: mirrored.downloadUrl,
      sourceImageUrl,
      imageStoragePath: mirrored.storagePath,
    };
  } catch {
    return { ...fields, sourceImageUrl };
  }
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

type CustomerCreateInput = Omit<
  CustomerRecord,
  "id" | "companyId" | "createdAt" | "updatedAt"
>;

export async function createCustomer(
  companyId: string,
  data: CustomerCreateInput
): Promise<string> {
  const t = nowIso();
  const ref = await addDoc(customersCol(companyId), {
    companyId,
    ...data,
    visibility: data.visibility ?? "company",
    version: 1,
    createdAt: t,
    updatedAt: t,
  });
  return ref.id;
}

export async function updateCustomer(
  companyId: string,
  customerId: string,
  patch: Partial<Omit<CustomerRecord, "id" | "companyId" | "createdAt">>
): Promise<void> {
  await updateDoc(customerDocRef(companyId, customerId), {
    ...patch,
    updatedAt: nowIso(),
  });
}

export async function getCustomer(
  companyId: string,
  customerId: string
): Promise<CustomerRecord | null> {
  const snap = await getDoc(customerDocRef(companyId, customerId));
  if (!snap.exists()) return null;
  return {
    id: snap.id,
    ...(snap.data() as Omit<CustomerRecord, "id">),
  };
}

export function subscribeCustomer(
  companyId: string,
  customerId: string,
  onData: (row: CustomerRecord | null) => void,
  onError?: (e: Error) => void
): () => void {
  return onSnapshot(
    customerDocRef(companyId, customerId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData({
        id: snap.id,
        ...(snap.data() as Omit<CustomerRecord, "id">),
      });
    },
    (e) => onError?.(e as Error)
  );
}

export function subscribeCustomers(
  companyId: string,
  onData: (rows: CustomerRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  return onSnapshot(
    customersCol(companyId),
    (snap) => {
      const rows = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CustomerRecord, "id">),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

type JobCreateInput = Omit<
  JobRecord,
  "id" | "companyId" | "customerId" | "finalOptionId" | "createdAt" | "updatedAt"
>;

export async function createJob(
  companyId: string,
  customerId: string,
  data: JobCreateInput
): Promise<string> {
  const t = nowIso();
  const ref = await addDoc(jobsCol(companyId, customerId), {
    ...data,
    companyId,
    customerId,
    visibility: data.visibility ?? "company",
    version: 1,
    finalOptionId: null,
    createdAt: t,
    updatedAt: t,
  });
  return ref.id;
}

export async function updateJob(
  companyId: string,
  customerId: string,
  jobId: string,
  patch: Partial<Omit<JobRecord, "id" | "companyId" | "customerId" | "createdAt">>
): Promise<void> {
  await updateDoc(jobDocRef(companyId, customerId, jobId), {
    ...patch,
    updatedAt: nowIso(),
  } as DocumentData);
}

// ---------------------------------------------------------------------------
// Commission tracker: status transitions, deposit totals, rep assignment
// ---------------------------------------------------------------------------

function transitionBlockMessage(
  from: JobStatus,
  to: JobStatus,
  reason: JobTransitionBlockReason
): string {
  switch (reason) {
    case "needs_quoted_material":
      return "Save at least one material in Layout Studio before tagging the job as Quote.";
    case "needs_approved_area":
      return "Pick the customer's chosen material on at least one area before activating the job.";
    case "needs_deposit":
      return "Record the required deposit before activating the job.";
    case "needs_paid_in_full":
      return "Record the final payment so the balance is zero before marking the job Complete.";
    case "illegal":
    default:
      return `Can't move directly from ${JOB_STATUS_LABELS[from] ?? from} to ${JOB_STATUS_LABELS[to] ?? to}.`;
  }
}

/**
 * Write a new job status. Validates the transition server-of-truth
 * inside a transaction (re-reads the job + its options) so a stale
 * client UI cannot smuggle an illegal jump past the lifecycle gates
 * (e.g. Quote → Complete, or Quote → Active without a deposit). The
 * Cloud Function trigger `onJobStatusTransition` mirrors these gates
 * for any code path that bypasses this helper.
 */
export async function transitionJobStatus(
  companyId: string,
  customerId: string,
  jobId: string,
  nextStatus: JobStatus,
  actorUserId: string
): Promise<void> {
  await runTransaction(firebaseDb, async (tx) => {
    const ref = jobDocRef(companyId, customerId, jobId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Job not found");
    const job = { id: snap.id, ...(snap.data() as Omit<JobRecord, "id">) } as JobRecord;
    const current = normalizeJobStatus(job.status);
    const target = normalizeJobStatus(nextStatus);
    if (current === target) return;

    // Re-read the option list so we can evaluate "has any quoted
    // material?" against the latest data. The collection is small
    // (typically 1–10 docs per job) so the extra read cost is
    // negligible compared to the integrity it buys.
    const optionsSnap = await getDocs(
      query(optionsCol(companyId, customerId, jobId))
    );
    const options = optionsSnap.docs.map((d) => ({
      ...(d.data() as Omit<JobComparisonOptionRecord, "id">),
      id: d.id,
    })) as JobComparisonOptionRecord[];

    const evaluation = evaluateJobTransition(current, target, {
      requiredDepositAmount: job.requiredDepositAmount ?? null,
      depositReceivedTotal: job.depositReceivedTotal ?? 0,
      quotedTotal: job.quotedTotal ?? null,
      paidTotal: job.paidTotal ?? 0,
      areas: jobAreasForJob(job),
      options,
    });
    if (!evaluation.ok) {
      throw new Error(transitionBlockMessage(current, target, evaluation.reason));
    }

    const update: Record<string, unknown> = {
      status: nextStatus,
      statusChangedAt: nowIso(),
      statusChangedByUserId: actorUserId,
      updatedAt: nowIso(),
    };
    /**
     * Lifecycle audit timestamps surfaced in the UI receipts and
     * Jobs board (Active card shows "installed on …", Complete card
     * shows the completion date). We only stamp on the forward
     * transition into the stage and never overwrite an existing
     * timestamp so reopening + re-flipping doesn't clobber history.
     */
    if (target === "installed" && !job.installedAt) {
      update.installedAt = nowIso();
    }
    if (target === "complete" && !job.completedAt) {
      update.completedAt = nowIso();
    }
    tx.update(ref, update as DocumentData);
  });
}

/**
 * Set the required deposit amount and/or % of total. Passing `null` clears
 * the requirement; the job can then flip to `active` on any deposit amount.
 */
export async function setJobDepositRequirement(
  companyId: string,
  customerId: string,
  jobId: string,
  patch: {
    requiredDepositAmount?: number | null;
    requiredDepositPercent?: number | null;
  }
): Promise<void> {
  await updateDoc(jobDocRef(companyId, customerId, jobId), {
    ...patch,
    updatedAt: nowIso(),
  } as DocumentData);
}

/**
 * Set the authoritative customer-facing total for the job. Rules block this
 * change once `pricingLocked` unless the caller is owner/admin.
 */
export async function setJobQuotedTotal(
  companyId: string,
  customerId: string,
  jobId: string,
  quotedTotal: number | null
): Promise<void> {
  await updateDoc(jobDocRef(companyId, customerId, jobId), {
    quotedTotal,
    updatedAt: nowIso(),
  } as DocumentData);
}

/**
 * Patch the active-phase tracking fields (delivery date, install date,
 * activeJobNotes, sinkModelsOverride). Pass `null` to clear a field.
 * No-ops when the patch is empty so callers can call this reactively
 * without worrying about writing identical values.
 */
export async function setJobActiveTracking(
  companyId: string,
  customerId: string,
  jobId: string,
  patch: {
    materialDeliveryDate?: string | null;
    requestedInstallDate?: string | null;
    activeJobNotes?: string | null;
    sinkModelsOverride?: string[] | null;
  }
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(patch, "materialDeliveryDate")) {
    body.materialDeliveryDate = patch.materialDeliveryDate ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "requestedInstallDate")) {
    body.requestedInstallDate = patch.requestedInstallDate ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "activeJobNotes")) {
    body.activeJobNotes = patch.activeJobNotes ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "sinkModelsOverride")) {
    body.sinkModelsOverride = patch.sinkModelsOverride ?? null;
  }
  if (Object.keys(body).length === 0) return;
  body.updatedAt = nowIso();
  await updateDoc(jobDocRef(companyId, customerId, jobId), body as DocumentData);
}

/**
 * Manually stamp `paidInFullAt`. The Cloud Function `onPaymentWrite`
 * stamps this automatically the first time `paidTotal >= quotedTotal`,
 * but reps occasionally need to record the close-out themselves (e.g.
 * a job that was prepaid before the quote was finalized, or a payment
 * imported in a non-Firestore flow). This helper is idempotent: if
 * the field is already set, it skips the write so we never overwrite
 * the original close-out timestamp on a retry.
 */
export async function markJobPaidInFull(
  companyId: string,
  customerId: string,
  jobId: string
): Promise<void> {
  const ref = jobDocRef(companyId, customerId, jobId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Job not found.");
  }
  const data = snap.data() as { paidInFullAt?: string | null };
  if (data.paidInFullAt) return;
  await updateDoc(ref, {
    paidInFullAt: nowIso(),
    updatedAt: nowIso(),
  } as DocumentData);
}

/**
 * Stamp the final-invoice metadata on the job (number + sent timestamp)
 * so the receipt and audit trail show when the customer was billed for
 * the balance.
 */
export async function recordFinalInvoiceSent(
  companyId: string,
  customerId: string,
  jobId: string,
  invoiceNumber: string
): Promise<void> {
  await updateDoc(jobDocRef(companyId, customerId, jobId), {
    finalInvoiceNumber: invoiceNumber,
    finalInvoiceSentAt: nowIso(),
    updatedAt: nowIso(),
  } as DocumentData);
}

/** Assign the primary rep for commission snapshotting. */
export async function assignJobRep(
  companyId: string,
  customerId: string,
  jobId: string,
  userId: string | null
): Promise<void> {
  await updateDoc(jobDocRef(companyId, customerId, jobId), {
    assignedUserId: userId,
    updatedAt: nowIso(),
  } as DocumentData);
}

/**
 * Admin escape hatch. Unlocks pricing on a job that was prematurely locked
 * (e.g. a wrong deposit amount was recorded). Rules still require the
 * caller to be owner/admin.
 */
export async function unlockJobPricing(
  companyId: string,
  customerId: string,
  jobId: string
): Promise<void> {
  await updateDoc(jobDocRef(companyId, customerId, jobId), {
    pricingLocked: false,
    pricingLockedAt: null,
    pricingLockedByUserId: null,
    updatedAt: nowIso(),
  } as DocumentData);
}

export async function getJob(
  companyId: string,
  customerId: string,
  jobId: string
): Promise<JobRecord | null> {
  const snap = await getDoc(jobDocRef(companyId, customerId, jobId));
  if (!snap.exists()) return null;
  return normalizeJobDoc(snap.id, snap.data() as Record<string, unknown>);
}

export function subscribeJob(
  companyId: string,
  customerId: string,
  jobId: string,
  onData: (row: JobRecord | null) => void,
  onError?: (e: Error) => void
): () => void {
  return onSnapshot(
    jobDocRef(companyId, customerId, jobId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(
        normalizeJobDoc(snap.id, snap.data() as Record<string, unknown>)
      );
    },
    (e) => onError?.(e as Error)
  );
}

export function subscribeJobsForCustomer(
  companyId: string,
  customerId: string,
  onData: (rows: JobRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  return onSnapshot(
    jobsCol(companyId, customerId),
    (snap) => {
      const rows = snap.docs
        .map((d) => normalizeJobDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export async function fetchJobsForCustomer(
  companyId: string,
  customerId: string
): Promise<JobRecord[]> {
  const snap = await getDocs(jobsCol(companyId, customerId));
  return snap.docs
    .map((d) => normalizeJobDoc(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Resolve a job doc by id alone via a collectionGroup query. Returns the job
 * + its parent customerId so the caller can switch to direct-path reads.
 * Used by routes that only carry `:jobId` in the URL (legacy URL shape).
 */
export async function findJobById(
  companyId: string,
  jobId: string
): Promise<{ job: JobRecord; customerId: string } | null> {
  const q = query(
    collectionGroup(firebaseDb, "jobs"),
    where("companyId", "==", companyId)
  );
  // Surface rule/index errors to the caller instead of hanging on an
  // unhandled rejection (which leaves the Layout Studio stuck on "Loading…").
  let snap;
  try {
    snap = await getDocs(q);
  } catch (error) {
    console.error("findJobById: collectionGroup query failed", error);
    throw error;
  }
  const match = snap.docs.find((d) => d.id === jobId);
  if (!match) return null;
  const job = normalizeJobDoc(
    match.id,
    match.data() as Record<string, unknown>
  );
  return { job, customerId: job.customerId };
}

/**
 * Live feed of the most recently-updated jobs across every customer in a
 * company (collectionGroup query on `jobs`, filtered by `companyId`).
 */
export function subscribeRecentJobsForCompany(
  companyId: string,
  onData: (rows: JobRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(
    collectionGroup(firebaseDb, "jobs"),
    where("companyId", "==", companyId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => normalizeJobDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12);
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

/**
 * Same collectionGroup query as `subscribeRecentJobsForCompany` but
 * returns every job (no slice) so dashboards / stats pages can compute
 * aggregate insights across the full company history.
 */
export function subscribeAllJobsForCompany(
  companyId: string,
  onData: (rows: JobRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(
    collectionGroup(firebaseDb, "jobs"),
    where("companyId", "==", companyId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => normalizeJobDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

/**
 * Live feed of every job comparison option across the company. Used by
 * the Stats page so per-job metrics (selected option material cost,
 * profile LF, slab count, etc.) can be rolled up into company-wide
 * margin and production insights without N+1 fetches.
 */
export function subscribeAllOptionsForCompany(
  companyId: string,
  onData: (rows: JobComparisonOptionRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(
    collectionGroup(firebaseDb, "options"),
    where("companyId", "==", companyId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<JobComparisonOptionRecord, "id">),
      }));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

// ---------------------------------------------------------------------------
// Options (job comparison options)
// ---------------------------------------------------------------------------

type OptionCreateInput = Omit<
  JobComparisonOptionRecord,
  "id" | "companyId" | "jobId" | "createdAt" | "updatedAt"
>;

export async function addJobComparisonOption(
  companyId: string,
  customerId: string,
  jobId: string,
  data: OptionCreateInput
): Promise<string> {
  const t = nowIso();
  const ref = await addDoc(optionsCol(companyId, customerId, jobId), {
    ...data,
    companyId,
    customerId,
    jobId,
    visibility: data.visibility ?? "company",
    version: 1,
    createdAt: t,
    updatedAt: t,
  });
  return ref.id;
}

export async function updateJobComparisonOption(
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string,
  patch: Partial<
    Omit<
      JobComparisonOptionRecord,
      "id" | "companyId" | "customerId" | "jobId" | "createdAt"
    >
  >,
  opts?: { clearLegacyLayoutStudio?: boolean }
): Promise<void> {
  const base: Record<string, unknown> = {
    ...patch,
    updatedAt: nowIso(),
  };
  if (opts?.clearLegacyLayoutStudio) {
    base.layoutStudio = deleteField();
  }
  await updateDoc(
    optionDocRef(companyId, customerId, jobId, optionId),
    base as DocumentData
  );
}

export async function getJobComparisonOption(
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string
): Promise<JobComparisonOptionRecord | null> {
  const snap = await getDoc(
    optionDocRef(companyId, customerId, jobId, optionId)
  );
  if (!snap.exists()) return null;
  return {
    id: snap.id,
    ...(snap.data() as Omit<JobComparisonOptionRecord, "id">),
  };
}

export function subscribeJobComparisonOption(
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string,
  onData: (row: JobComparisonOptionRecord | null) => void,
  onError?: (e: Error) => void
): () => void {
  return onSnapshot(
    optionDocRef(companyId, customerId, jobId, optionId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData({
        id: snap.id,
        ...(snap.data() as Omit<JobComparisonOptionRecord, "id">),
      });
    },
    (e) => onError?.(e as Error)
  );
}

export function subscribeOptionsForJob(
  companyId: string,
  customerId: string,
  jobId: string,
  onData: (rows: JobComparisonOptionRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  return onSnapshot(
    optionsCol(companyId, customerId, jobId),
    (snap) => {
      const rows = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<JobComparisonOptionRecord, "id">),
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export async function fetchOptionsForJob(
  companyId: string,
  customerId: string,
  jobId: string
): Promise<JobComparisonOptionRecord[]> {
  const snap = await getDocs(optionsCol(companyId, customerId, jobId));
  return snap.docs
    .map((d) => ({
      id: d.id,
      ...(d.data() as Omit<JobComparisonOptionRecord, "id">),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deleteJobComparisonOption(
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string
): Promise<void> {
  const existing = await getJobComparisonOption(
    companyId,
    customerId,
    jobId,
    optionId
  );
  await deleteMirroredJobOptionImage(existing?.imageStoragePath);
  await deleteDoc(optionDocRef(companyId, customerId, jobId, optionId));
}

// ---------------------------------------------------------------------------
// Cascading deletes
// ---------------------------------------------------------------------------

export async function deleteJob(
  companyId: string,
  customerId: string,
  jobId: string
): Promise<void> {
  const opts = await fetchOptionsForJob(companyId, customerId, jobId);
  await Promise.all(
    opts.map((o) =>
      deleteJobComparisonOption(companyId, customerId, jobId, o.id)
    )
  );
  await deleteDoc(jobDocRef(companyId, customerId, jobId));
}

export async function deleteCustomer(
  companyId: string,
  customerId: string
): Promise<void> {
  const jobs = await fetchJobsForCustomer(companyId, customerId);
  await Promise.all(
    jobs.map((job) => deleteJob(companyId, customerId, job.id))
  );
  await deleteDoc(customerDocRef(companyId, customerId));
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

export async function setJobFinalOption(
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string | null,
  status?: JobStatus
): Promise<void> {
  // Status is intentionally optional. Lifecycle changes belong to the
  // status stepper inside `JobPaymentsPanel`, which calls
  // `transitionJobStatus` (audit fields + transition guard). Pass a
  // status here only for legacy code paths during the canonical-status
  // migration; new callers should leave it undefined.
  const patch: Partial<JobRecord> = { finalOptionId: optionId };
  if (status) patch.status = status;
  await updateJob(companyId, customerId, jobId, patch);
}

/**
 * Per-area approval payload used by the Job detail page when the user
 * picks the winning material for an area. The helper writes everything
 * the lifecycle panel needs in a single transaction so the UI never
 * shows a half-applied state (status moved without totals updated, etc.).
 */
export interface ApproveAreaQuoteInput {
  areaId: string;
  optionId: string;
  /** Computed installed total ($) for this area+option. */
  areaQuotedTotal: number | null;
  /** Layout preview snapshot URL for this area+option. */
  layoutPreviewImageUrl: string | null;
  /**
   * Map of every other approved area to its computed total. Used so the
   * helper can derive the consolidated `quotedTotal` without re-reading
   * each option doc on the server.
   */
  otherApprovedAreaTotals: Record<string, number>;
  /** Company default deposit % (0..100) — seeds requiredDepositAmount when unset. */
  defaultDepositPercent: number | null;
  /**
   * When true, advance the job from `draft` → `quote` if the transition
   * is currently legal. The lifecycle stepper still owns later moves.
   */
  advanceToQuote: boolean;
}

/**
 * Approve a single area+option pair as the customer-chosen quote. We
 * write the area `selectedOptionId`, refresh the consolidated job total,
 * snapshot the layout preview, optionally seed the required deposit
 * from the company default %, and (when legal) bump status to "quote"
 * — all in one update so subscribers see a consistent record.
 */
export async function approveJobAreaQuote(
  companyId: string,
  customerId: string,
  jobId: string,
  input: ApproveAreaQuoteInput
): Promise<void> {
  await runTransaction(firebaseDb, async (tx) => {
    const ref = jobDocRef(companyId, customerId, jobId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Job not found");
    const job = { id: snap.id, ...(snap.data() as Omit<JobRecord, "id">) } as JobRecord;
    const nowIsoStr = nowIso();

    const areas = jobAreasForJob(job);
    const nextAreas: JobAreaRecord[] = areas.map((area) =>
      area.id === input.areaId
        ? { ...area, selectedOptionId: input.optionId, updatedAt: nowIsoStr }
        : area
    );

    const consolidatedTotal = computeConsolidatedQuotedTotal(
      nextAreas,
      input.areaId,
      input.areaQuotedTotal,
      input.otherApprovedAreaTotals
    );

    const patch: Record<string, unknown> = {
      areas: nextAreas,
      areaType: nextAreas.map((a) => a.name).join(", "),
      approvedQuoteAt: nowIsoStr,
      updatedAt: nowIsoStr,
    };

    if (input.layoutPreviewImageUrl) {
      patch.approvedLayoutPreviewImageUrl = input.layoutPreviewImageUrl;
    }

    if (consolidatedTotal != null) {
      patch.quotedTotal = consolidatedTotal;
      // When required deposit hasn't been set yet, seed from company default %.
      const hasRequiredAmount =
        typeof job.requiredDepositAmount === "number" &&
        Number.isFinite(job.requiredDepositAmount) &&
        job.requiredDepositAmount >= 0;
      if (!hasRequiredAmount && input.defaultDepositPercent != null) {
        const pct = input.defaultDepositPercent;
        if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
          const seeded = Math.round((pct / 100) * consolidatedTotal * 100) / 100;
          patch.requiredDepositAmount = seeded;
          if (job.requiredDepositPercent == null) {
            patch.requiredDepositPercent = pct;
          }
        }
      }
    }

    if (input.advanceToQuote) {
      const current = normalizeJobStatus(job.status);
      if (current === "draft" && canTransitionJobStatus(current, "quote")) {
        patch.status = "quote";
        patch.statusChangedAt = nowIsoStr;
      }
    }

    tx.update(ref, patch as DocumentData);
  });
}

function computeConsolidatedQuotedTotal(
  nextAreas: JobAreaRecord[],
  changedAreaId: string,
  changedAreaTotal: number | null,
  otherApprovedAreaTotals: Record<string, number>
): number | null {
  let total = 0;
  let any = false;
  for (const area of nextAreas) {
    if (!area.selectedOptionId) continue;
    if (area.id === changedAreaId) {
      if (changedAreaTotal == null || !Number.isFinite(changedAreaTotal)) continue;
      total += Math.max(0, changedAreaTotal);
      any = true;
      continue;
    }
    const v = otherApprovedAreaTotals[area.id];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    total += Math.max(0, v);
    any = true;
  }
  if (!any) return null;
  return Math.round(total * 100) / 100;
}

/**
 * Clear the approval on a single area. The consolidated `quotedTotal`
 * is recomputed from whatever approvals remain; when none are left we
 * leave the existing total alone so a previously-saved manual override
 * (entered in the lifecycle panel) isn't blown away.
 */
export async function clearJobAreaQuoteApproval(
  companyId: string,
  customerId: string,
  jobId: string,
  areaId: string,
  remainingApprovedAreaTotals: Record<string, number>
): Promise<void> {
  await runTransaction(firebaseDb, async (tx) => {
    const ref = jobDocRef(companyId, customerId, jobId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Job not found");
    const job = { id: snap.id, ...(snap.data() as Omit<JobRecord, "id">) } as JobRecord;
    const nowIsoStr = nowIso();
    const areas = jobAreasForJob(job);
    const nextAreas: JobAreaRecord[] = areas.map((area) =>
      area.id === areaId
        ? { ...area, selectedOptionId: null, updatedAt: nowIsoStr }
        : area
    );
    const patch: Record<string, unknown> = {
      areas: nextAreas,
      areaType: nextAreas.map((a) => a.name).join(", "),
      updatedAt: nowIsoStr,
    };
    let total = 0;
    let any = false;
    for (const area of nextAreas) {
      if (!area.selectedOptionId) continue;
      const v = remainingApprovedAreaTotals[area.id];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      total += Math.max(0, v);
      any = true;
    }
    if (any) {
      patch.quotedTotal = Math.round(total * 100) / 100;
    }
    tx.update(ref, patch as DocumentData);
  });
}

/**
 * Adds each catalog item as a job option using default price selection (same
 * as modal defaults). Does not dedupe against existing options. Continues on
 * per-item errors; returns counts and failures.
 */
export async function addCatalogItemsToJobBatch(
  companyId: string,
  job: JobRecord,
  ownerUserId: string,
  items: CatalogItem[]
): Promise<{
  added: number;
  failures: { catalogItemId: string; message: string }[];
}> {
  const failures: { catalogItemId: string; message: string }[] = [];
  let added = 0;
  const existingOptions = await fetchOptionsForJob(
    companyId,
    job.customerId,
    job.id
  );
  const quoteBasisSqFt = jobQuoteSquareFootage(job, existingOptions);
  for (const item of items) {
    try {
      const payload = buildDefaultCompareOptionPayload(item);
      const fields = await prepareJobComparisonOptionFields(
        companyId,
        job.customerId,
        job.id,
        ownerUserId,
        item,
        quoteBasisSqFt,
        payload
      );
      await addJobComparisonOption(companyId, job.customerId, job.id, {
        ...fields,
        ownerUserId,
      });
      added++;
    } catch (e) {
      failures.push({
        catalogItemId: item.id,
        message: e instanceof Error ? e.message : "Could not add option.",
      });
    }
  }
  // Lifecycle transitions (draft → quote → active …) now happen
  // exclusively through the status stepper in `JobPaymentsPanel` so they
  // pass through the transition guard + audit fields. We deliberately do
  // NOT auto-bump status on add; the user advances the job when they're
  // actually ready to quote.
  return { added, failures };
}

// ---------------------------------------------------------------------------
// Collaboration: optimistic concurrency + soft edit lock
// ---------------------------------------------------------------------------

/**
 * Identity used when claiming / heartbeating the edit lock. `sessionId`
 * should be stable for the lifetime of a browser tab (generated once on
 * mount) so browser refreshes release cleanly and two tabs of the same
 * user don't fight each other.
 */
export interface EditorIdentity {
  userId: string;
  displayName: string | null;
  sessionId: string;
}

/** Result of an optimistic-version write. */
export type VersionedWriteResult =
  | { ok: true; version: number }
  | {
      ok: false;
      reason: "version-mismatch" | "not-found";
      currentVersion: number | null;
    };

async function updateDocWithVersion<T extends { version?: number | null }>(
  ref: DocumentReference,
  expectedVersion: number,
  patch: Record<string, unknown>
): Promise<VersionedWriteResult> {
  return runTransaction(firebaseDb, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      return {
        ok: false as const,
        reason: "not-found" as const,
        currentVersion: null,
      };
    }
    const data = snap.data() as T;
    const current = typeof data.version === "number" ? data.version : 1;
    if (current !== expectedVersion) {
      return {
        ok: false as const,
        reason: "version-mismatch" as const,
        currentVersion: current,
      };
    }
    const nextVersion = current + 1;
    tx.update(ref, {
      ...patch,
      version: nextVersion,
      updatedAt: nowIso(),
    } as DocumentData);
    return { ok: true as const, version: nextVersion };
  });
}

/**
 * Optimistically update a job. If the local `expectedVersion` no longer
 * matches the server, returns `{ ok: false, reason: "version-mismatch" }`
 * so the UI can refresh and replay the edit. Callers that don't care
 * about conflicts should keep using {@link updateJob}.
 */
export async function updateJobVersioned(
  companyId: string,
  customerId: string,
  jobId: string,
  expectedVersion: number,
  patch: Partial<
    Omit<JobRecord, "id" | "companyId" | "customerId" | "createdAt" | "version">
  >
): Promise<VersionedWriteResult> {
  return updateDocWithVersion<JobRecord>(
    jobDocRef(companyId, customerId, jobId),
    expectedVersion,
    patch as Record<string, unknown>
  );
}

export async function updateJobComparisonOptionVersioned(
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string,
  expectedVersion: number,
  patch: Partial<
    Omit<
      JobComparisonOptionRecord,
      "id" | "companyId" | "customerId" | "jobId" | "createdAt" | "version"
    >
  >
): Promise<VersionedWriteResult> {
  return updateDocWithVersion<JobComparisonOptionRecord>(
    optionDocRef(companyId, customerId, jobId, optionId),
    expectedVersion,
    patch as Record<string, unknown>
  );
}

function isEditorStale(
  editor: JobActiveEditor | null | undefined,
  now: number
): boolean {
  if (!editor) return true;
  const ts = Date.parse(editor.heartbeatAt);
  if (!Number.isFinite(ts)) return true;
  return now - ts > JOB_ACTIVE_EDITOR_STALE_MS;
}

/**
 * Try to acquire the soft edit lock for a job. Succeeds when:
 *
 * 1. No one currently holds the lock.
 * 2. The current lock already belongs to this user + session (re-claim /
 *    refresh within the same tab).
 * 3. The current lock is stale (no heartbeat for
 *    {@link JOB_ACTIVE_EDITOR_STALE_MS}) — this keeps a crashed tab from
 *    blocking a coworker forever.
 * 4. `{ takeover: true }` is passed. The UI surfaces a confirmation
 *    ("Alex is editing — take over?") before sending this.
 *
 * This lock is *advisory*: writes still go through — the lock just tells
 * other seats "someone else is actively working on this, surface it" so
 * they don't step on each other.
 */
export async function claimJobEditor(
  companyId: string,
  customerId: string,
  jobId: string,
  identity: EditorIdentity,
  opts?: { takeover?: boolean }
): Promise<
  | { ok: true; editor: JobActiveEditor }
  | { ok: false; current: JobActiveEditor }
> {
  const ref = jobDocRef(companyId, customerId, jobId);
  return runTransaction(firebaseDb, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error("Job not found");
    }
    const now = Date.now();
    const data = snap.data() as JobRecord;
    const current = data.activeEditor ?? null;
    const sameSession =
      current?.userId === identity.userId &&
      current?.sessionId === identity.sessionId;
    const canClaim =
      !current ||
      sameSession ||
      isEditorStale(current, now) ||
      Boolean(opts?.takeover);
    if (!canClaim && current) {
      return { ok: false as const, current };
    }
    const iso = new Date(now).toISOString();
    const editor: JobActiveEditor = {
      userId: identity.userId,
      displayName: identity.displayName,
      sessionId: identity.sessionId,
      since: sameSession && current ? current.since : iso,
      heartbeatAt: iso,
    };
    tx.update(ref, {
      activeEditor: editor,
      updatedAt: iso,
    } as DocumentData);
    return { ok: true as const, editor };
  });
}

/**
 * Refresh the lock heartbeat. Returns "lost" when the lock was taken
 * over by another session — callers should block further edits and
 * surface a "your changes may conflict" banner.
 */
export async function heartbeatJobEditor(
  companyId: string,
  customerId: string,
  jobId: string,
  identity: EditorIdentity
): Promise<"ok" | "lost"> {
  const ref = jobDocRef(companyId, customerId, jobId);
  return runTransaction(firebaseDb, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return "lost" as const;
    const current = (snap.data() as JobRecord).activeEditor ?? null;
    if (
      !current ||
      current.userId !== identity.userId ||
      current.sessionId !== identity.sessionId
    ) {
      return "lost" as const;
    }
    const iso = new Date().toISOString();
    tx.update(ref, {
      "activeEditor.heartbeatAt": iso,
    } as DocumentData);
    return "ok" as const;
  });
}

/** Release the lock if still held by this session. Safe to call on unmount. */
export async function releaseJobEditor(
  companyId: string,
  customerId: string,
  jobId: string,
  identity: EditorIdentity
): Promise<void> {
  const ref = jobDocRef(companyId, customerId, jobId);
  try {
    await runTransaction(firebaseDb, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const current = (snap.data() as JobRecord).activeEditor ?? null;
      if (
        !current ||
        current.userId !== identity.userId ||
        current.sessionId !== identity.sessionId
      ) {
        return;
      }
      tx.update(ref, { activeEditor: null } as DocumentData);
    });
  } catch {
    /* non-fatal: another tab may have cleaned up first */
  }
}

// ---------------------------------------------------------------------------
// Presence (who is currently viewing — read-only, NOT the edit lock)
// ---------------------------------------------------------------------------

/**
 * Presence is stored per-session under
 * `companies/{companyId}/customers/{customerId}/jobs/{jobId}/presence/{sessionId}`
 * so (a) a single user with two tabs open shows up twice and (b) each tab
 * can clean up its own entry on unmount.
 */
const presenceCol = (companyId: string, customerId: string, jobId: string) =>
  collection(
    firebaseDb,
    "companies",
    companyId,
    "customers",
    customerId,
    "jobs",
    jobId,
    "presence"
  );

const presenceDocRef = (
  companyId: string,
  customerId: string,
  jobId: string,
  sessionId: string
) =>
  doc(
    firebaseDb,
    "companies",
    companyId,
    "customers",
    customerId,
    "jobs",
    jobId,
    "presence",
    sessionId
  );

export interface JobPresenceRow {
  userId: string;
  displayName: string | null;
  sessionId: string;
  heartbeatAt: string;
}

export async function heartbeatJobPresence(
  companyId: string,
  customerId: string,
  jobId: string,
  identity: EditorIdentity
): Promise<void> {
  const iso = nowIso();
  /**
   * `setDoc` (upsert) both creates the presence doc on first heartbeat and
   * refreshes `heartbeatAt` on subsequent ones. Using `merge: true` preserves
   * fields from possible concurrent updaters, though in practice each
   * session only writes its own doc.
   */
  await setDoc(
    presenceDocRef(companyId, customerId, jobId, identity.sessionId),
    {
      userId: identity.userId,
      displayName: identity.displayName,
      sessionId: identity.sessionId,
      heartbeatAt: iso,
    } as DocumentData,
    { merge: true }
  );
}

export async function clearJobPresence(
  companyId: string,
  customerId: string,
  jobId: string,
  identity: EditorIdentity
): Promise<void> {
  try {
    await deleteDoc(
      presenceDocRef(companyId, customerId, jobId, identity.sessionId)
    );
  } catch {
    /* non-fatal */
  }
}

export function subscribeJobPresence(
  companyId: string,
  customerId: string,
  jobId: string,
  onData: (rows: JobPresenceRow[]) => void,
  onError?: (e: Error) => void
): () => void {
  return onSnapshot(
    presenceCol(companyId, customerId, jobId),
    (snap) => {
      const now = Date.now();
      const rows = snap.docs
        .map((d) => d.data() as JobPresenceRow)
        /** Drop stale entries (crashed tabs that never cleared themselves). */
        .filter((row) => {
          const ts = Date.parse(row.heartbeatAt);
          if (!Number.isFinite(ts)) return false;
          return now - ts < JOB_ACTIVE_EDITOR_STALE_MS;
        });
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}
