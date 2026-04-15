import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  type DocumentData,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { firebaseDb } from "../firebase";
import {
  buildDefaultCompareOptionPayload,
  buildOptionRecordFields,
} from "../compare/AddPriceOptionModal";
import { deleteMirroredJobOptionImage, mirrorJobOptionImage } from "./jobOptionImageStorage";
import type { CatalogItem } from "../types/catalog";
import type {
  CustomerRecord,
  JobComparisonOptionRecord,
  JobRecord,
  JobStatus,
} from "../types/compareQuote";
import { jobQuoteSquareFootage } from "../utils/quotedPrice";

const customersCol = () => collection(firebaseDb, "customers");
const jobsCol = () => collection(firebaseDb, "jobs");
const optionsCol = () => collection(firebaseDb, "jobComparisonOptions");

function nowIso(): string {
  return new Date().toISOString();
}

export async function prepareJobComparisonOptionFields(
  ownerUserId: string,
  item: CatalogItem,
  jobId: string,
  quoteBasisSqFt: number,
  payload: Parameters<typeof buildOptionRecordFields>[3]
): Promise<Omit<JobComparisonOptionRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">> {
  const fields = buildOptionRecordFields(item, jobId, quoteBasisSqFt, payload);
  const sourceImageUrl = fields.imageUrl?.trim() || null;
  if (!sourceImageUrl) {
    return fields;
  }
  try {
    const mirrored = await mirrorJobOptionImage({
      ownerUserId,
      jobId,
      sourceImageUrl,
      catalogItemId: item.id,
      productName: item.displayName || item.productName,
    });
    if (!mirrored) {
      return fields;
    }
    return {
      ...fields,
      imageUrl: mirrored.downloadUrl,
      sourceImageUrl,
      imageStoragePath: mirrored.storagePath,
    };
  } catch {
    return {
      ...fields,
      sourceImageUrl,
    };
  }
}

export async function createCustomer(
  ownerUserId: string,
  data: Omit<CustomerRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">
): Promise<string> {
  const t = nowIso();
  const ref = await addDoc(customersCol(), {
    ownerUserId,
    ...data,
    createdAt: t,
    updatedAt: t,
  });
  return ref.id;
}

export async function updateCustomer(
  customerId: string,
  patch: Partial<Omit<CustomerRecord, "id" | "ownerUserId" | "createdAt">>
): Promise<void> {
  await updateDoc(doc(firebaseDb, "customers", customerId), {
    ...patch,
    updatedAt: nowIso(),
  });
}

export async function getCustomer(customerId: string): Promise<CustomerRecord | null> {
  const snap = await getDoc(doc(firebaseDb, "customers", customerId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<CustomerRecord, "id">) };
}

/** Live updates for a single customer (detail page). */
export function subscribeCustomer(
  customerId: string,
  ownerUserId: string,
  onData: (row: CustomerRecord | null) => void,
  onError?: (e: Error) => void
): () => void {
  const ref = doc(firebaseDb, "customers", customerId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const row = { id: snap.id, ...(snap.data() as Omit<CustomerRecord, "id">) };
      if (row.ownerUserId !== ownerUserId) {
        onData(null);
        return;
      }
      onData(row);
    },
    (e) => onError?.(e as Error)
  );
}

export function subscribeCustomers(
  ownerUserId: string,
  onData: (rows: CustomerRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(customersCol(), where("ownerUserId", "==", ownerUserId));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerRecord, "id">) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export async function createJob(
  ownerUserId: string,
  data: Omit<JobRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt" | "finalOptionId">
): Promise<string> {
  const t = nowIso();
  const ref = await addDoc(jobsCol(), {
    ownerUserId,
    ...data,
    finalOptionId: null,
    createdAt: t,
    updatedAt: t,
  });
  return ref.id;
}

export async function updateJob(
  jobId: string,
  patch: Partial<Omit<JobRecord, "id" | "ownerUserId" | "createdAt">>
): Promise<void> {
  await updateDoc(doc(firebaseDb, "jobs", jobId), {
    ...patch,
    updatedAt: nowIso(),
  });
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  const snap = await getDoc(doc(firebaseDb, "jobs", jobId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<JobRecord, "id">) };
}

export function subscribeJobsForCustomer(
  customerId: string,
  ownerUserId: string,
  onData: (rows: JobRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  /** `ownerUserId` must be in the query so rules can evaluate `resource.data.ownerUserId == auth.uid`. */
  const q = query(
    jobsCol(),
    where("customerId", "==", customerId),
    where("ownerUserId", "==", ownerUserId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<JobRecord, "id">) }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export async function fetchJobsForCustomer(
  customerId: string,
  ownerUserId: string
): Promise<JobRecord[]> {
  const q = query(
    jobsCol(),
    where("customerId", "==", customerId),
    where("ownerUserId", "==", ownerUserId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<JobRecord, "id">) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function subscribeRecentJobsForUser(
  ownerUserId: string,
  onData: (rows: JobRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(jobsCol(), where("ownerUserId", "==", ownerUserId));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<JobRecord, "id">) }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12);
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export async function addJobComparisonOption(
  ownerUserId: string,
  data: Omit<JobComparisonOptionRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">
): Promise<string> {
  const t = nowIso();
  const ref = await addDoc(optionsCol(), {
    ownerUserId,
    ...data,
    createdAt: t,
    updatedAt: t,
  });
  return ref.id;
}

export async function updateJobComparisonOption(
  optionId: string,
  patch: Partial<Omit<JobComparisonOptionRecord, "id" | "ownerUserId" | "createdAt">>,
  opts?: { clearLegacyLayoutStudio?: boolean }
): Promise<void> {
  const base: Record<string, unknown> = {
    ...patch,
    updatedAt: nowIso(),
  };
  if (opts?.clearLegacyLayoutStudio) {
    base.layoutStudio = deleteField();
  }
  await updateDoc(doc(firebaseDb, "jobComparisonOptions", optionId), base as DocumentData);
}

/** Live updates for a single job document (e.g. Layout Studio shared plan). */
export function subscribeJob(
  jobId: string,
  ownerUserId: string,
  onData: (row: JobRecord | null) => void,
  onError?: (e: Error) => void
): () => void {
  const ref = doc(firebaseDb, "jobs", jobId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const row = { id: snap.id, ...(snap.data() as Omit<JobRecord, "id">) };
      if (row.ownerUserId !== ownerUserId) {
        onData(null);
        return;
      }
      onData(row);
    },
    (e) => onError?.(e as Error)
  );
}

export async function deleteJobComparisonOption(optionId: string): Promise<void> {
  const existing = await getJobComparisonOption(optionId);
  await deleteMirroredJobOptionImage(existing?.imageStoragePath);
  await deleteDoc(doc(firebaseDb, "jobComparisonOptions", optionId));
}

export async function getJobComparisonOption(optionId: string): Promise<JobComparisonOptionRecord | null> {
  const snap = await getDoc(doc(firebaseDb, "jobComparisonOptions", optionId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<JobComparisonOptionRecord, "id">) };
}

export function subscribeJobComparisonOption(
  optionId: string,
  ownerUserId: string,
  onData: (row: JobComparisonOptionRecord | null) => void,
  onError?: (e: Error) => void
): () => void {
  const ref = doc(firebaseDb, "jobComparisonOptions", optionId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const row = { id: snap.id, ...(snap.data() as Omit<JobComparisonOptionRecord, "id">) };
      if (row.ownerUserId !== ownerUserId) {
        onData(null);
        return;
      }
      onData(row);
    },
    (e) => onError?.(e as Error)
  );
}

export function subscribeOptionsForJob(
  jobId: string,
  ownerUserId: string,
  onData: (rows: JobComparisonOptionRecord[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(
    optionsCol(),
    where("jobId", "==", jobId),
    where("ownerUserId", "==", ownerUserId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<JobComparisonOptionRecord, "id">) }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export async function fetchOptionsForJob(
  jobId: string,
  ownerUserId: string
): Promise<JobComparisonOptionRecord[]> {
  const q = query(
    optionsCol(),
    where("jobId", "==", jobId),
    where("ownerUserId", "==", ownerUserId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<JobComparisonOptionRecord, "id">) }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Deletes all comparison options for the job, then the job document. */
export async function deleteJob(jobId: string, ownerUserId: string): Promise<void> {
  const opts = await fetchOptionsForJob(jobId, ownerUserId);
  await Promise.all(opts.map((o) => deleteJobComparisonOption(o.id)));
  await deleteDoc(doc(firebaseDb, "jobs", jobId));
}

/** Deletes the customer and cascades through all of their jobs/options first. */
export async function deleteCustomer(customerId: string, ownerUserId: string): Promise<void> {
  const jobs = await fetchJobsForCustomer(customerId, ownerUserId);
  await Promise.all(jobs.map((job) => deleteJob(job.id, ownerUserId)));
  await deleteDoc(doc(firebaseDb, "customers", customerId));
}

export async function setJobFinalOption(
  jobId: string,
  optionId: string | null,
  status: JobStatus
): Promise<void> {
  await updateJob(jobId, { finalOptionId: optionId, status });
}

/**
 * Adds each catalog item as a job option using default price selection (same as modal defaults).
 * Does not dedupe against existing options. Continues on per-item errors; returns counts and failures.
 */
export async function addCatalogItemsToJobBatch(
  ownerUserId: string,
  job: JobRecord,
  items: CatalogItem[]
): Promise<{ added: number; failures: { catalogItemId: string; message: string }[] }> {
  const failures: { catalogItemId: string; message: string }[] = [];
  let added = 0;
  const existingOptions = await fetchOptionsForJob(job.id, ownerUserId);
  const quoteBasisSqFt = jobQuoteSquareFootage(job, existingOptions);
  for (const item of items) {
    try {
      const payload = buildDefaultCompareOptionPayload(item);
      const fields = await prepareJobComparisonOptionFields(ownerUserId, item, job.id, quoteBasisSqFt, payload);
      await addJobComparisonOption(ownerUserId, fields);
      added++;
    } catch (e) {
      failures.push({
        catalogItemId: item.id,
        message: e instanceof Error ? e.message : "Could not add option.",
      });
    }
  }
  if (added > 0 && job.status === "draft") {
    try {
      await updateJob(job.id, { status: "comparing" });
    } catch {
      /* non-fatal */
    }
  }
  return { added, failures };
}
