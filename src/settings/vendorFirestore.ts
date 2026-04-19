import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type UpdateData,
} from "firebase/firestore";
import { firebaseDb } from "../firebase";
import type {
  CompanyVendorCreateInput,
  CompanyVendorDoc,
  CompanyVendorUpdateInput,
} from "./vendorTypes";

function vendorsCol(companyId: string) {
  return collection(firebaseDb, "companies", companyId, "vendors");
}

function vendorDocRef(companyId: string, vendorId: string) {
  return doc(firebaseDb, "companies", companyId, "vendors", vendorId);
}

function hydrate(
  companyId: string,
  id: string,
  raw: Record<string, unknown>
): CompanyVendorDoc {
  return {
    id,
    companyId,
    name: typeof raw.name === "string" ? raw.name : "",
    aliases: Array.isArray(raw.aliases) ? (raw.aliases as string[]) : [],
    canonicalVendorId:
      typeof raw.canonicalVendorId === "string"
        ? raw.canonicalVendorId
        : null,
    website: typeof raw.website === "string" ? raw.website : null,
    contactEmail:
      typeof raw.contactEmail === "string" ? raw.contactEmail : null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    archived: raw.archived === true,
    createdByUserId:
      typeof raw.createdByUserId === "string" ? raw.createdByUserId : "",
    createdAt: (raw.createdAt as CompanyVendorDoc["createdAt"]) ?? null,
    updatedAt: (raw.updatedAt as CompanyVendorDoc["updatedAt"]) ?? null,
  };
}

export function subscribeCompanyVendors(
  companyId: string,
  onData: (rows: CompanyVendorDoc[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(vendorsCol(companyId), orderBy("name"));
  return onSnapshot(
    q,
    (snap) => {
      const rows: CompanyVendorDoc[] = [];
      snap.forEach((d) => {
        rows.push(hydrate(companyId, d.id, d.data() as Record<string, unknown>));
      });
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export async function createCompanyVendor(
  companyId: string,
  createdByUserId: string,
  input: CompanyVendorCreateInput
): Promise<string> {
  const payload = {
    companyId,
    name: input.name.trim(),
    aliases: (input.aliases ?? [])
      .map((a) => a.trim())
      .filter((a) => a.length > 0),
    canonicalVendorId: input.canonicalVendorId ?? null,
    website: input.website?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    notes: input.notes?.trim() || null,
    archived: false,
    createdByUserId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(vendorsCol(companyId), payload);
  return ref.id;
}

export async function updateCompanyVendor(
  companyId: string,
  vendorId: string,
  patch: CompanyVendorUpdateInput
): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (typeof patch.name === "string") payload.name = patch.name.trim();
  if (patch.aliases)
    payload.aliases = patch.aliases
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  if (patch.website !== undefined)
    payload.website = patch.website?.trim() || null;
  if (patch.contactEmail !== undefined)
    payload.contactEmail = patch.contactEmail?.trim() || null;
  if (patch.notes !== undefined) payload.notes = patch.notes?.trim() || null;
  if (typeof patch.archived === "boolean") payload.archived = patch.archived;

  await updateDoc(
    vendorDocRef(companyId, vendorId),
    payload as UpdateData<Record<string, unknown>>
  );
}

export async function archiveCompanyVendor(
  companyId: string,
  vendorId: string,
  archived: boolean
): Promise<void> {
  await updateDoc(vendorDocRef(companyId, vendorId), {
    archived,
    updatedAt: serverTimestamp(),
  });
}

/** Hard-delete — only for accidental duplicates. */
export async function deleteCompanyVendor(
  companyId: string,
  vendorId: string
): Promise<void> {
  await deleteDoc(vendorDocRef(companyId, vendorId));
}
