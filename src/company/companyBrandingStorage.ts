import {
  doc,
  serverTimestamp,
  updateDoc,
  type UpdateData,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { firebaseDb, firebaseStorage } from "../firebase";
import type { CompanyAddress, CompanyBranding, CompanySettings } from "./types";

/**
 * Storage layout:
 *
 *   companies/{companyId}/branding/logo-{timestamp}.{ext}
 *
 * Logo objects are publicly readable (required so shared quote links and
 * generated PDFs can embed the image for external customers). Writes are
 * gated at the storage rules layer to signed-in users; the rules can be
 * tightened further to require company membership.
 */

const ALLOWED_LOGO_MIME = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "image/webp",
];

const MAX_LOGO_BYTES = 4 * 1024 * 1024;

function extensionFor(file: File): string {
  const match = file.name.match(/\.([A-Za-z0-9]+)$/);
  if (match) return match[1].toLowerCase();
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/svg+xml") return "svg";
  if (file.type === "image/webp") return "webp";
  return "png";
}

export interface UploadedCompanyLogo {
  storagePath: string;
  downloadUrl: string;
}

export async function uploadCompanyLogo(
  companyId: string,
  file: File
): Promise<UploadedCompanyLogo> {
  if (!companyId) throw new Error("Missing company id");
  if (!ALLOWED_LOGO_MIME.includes(file.type)) {
    throw new Error(
      "Unsupported logo format. Use PNG, JPEG, SVG, or WebP."
    );
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error("Logo is too large. Keep it under 4 MB.");
  }

  const ext = extensionFor(file);
  const filename = `logo-${Date.now()}.${ext}`;
  const path = `companies/${companyId}/branding/${filename}`;
  const ref = storageRef(firebaseStorage, path);
  const snap = await uploadBytes(ref, file, { contentType: file.type });
  const downloadUrl = await getDownloadURL(snap.ref);
  return { storagePath: path, downloadUrl };
}

export async function removeCompanyLogoObject(
  storagePath: string | null | undefined
): Promise<void> {
  if (!storagePath) return;
  if (!storagePath.startsWith("companies/")) return;
  try {
    await deleteObject(storageRef(firebaseStorage, storagePath));
  } catch {
    // Non-fatal: the object may already be gone.
  }
}

export interface BrandingPatch extends Partial<CompanyBranding> {}

export async function updateCompanyBranding(
  companyId: string,
  patch: BrandingPatch
): Promise<void> {
  const dotted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    dotted[`branding.${key}`] = value ?? null;
  }
  dotted.updatedAt = serverTimestamp();
  await updateDoc(
    doc(firebaseDb, "companies", companyId),
    dotted as UpdateData<Record<string, unknown>>
  );
}

export interface CompanyProfilePatch {
  name?: string;
  legalName?: string | null;
  address?: CompanyAddress | null;
}

export async function updateCompanyProfile(
  companyId: string,
  patch: CompanyProfilePatch
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.legalName !== undefined) {
    update.legalName = patch.legalName?.trim() || null;
  }
  if (patch.address !== undefined) {
    update.address = patch.address ?? null;
  }
  await updateDoc(
    doc(firebaseDb, "companies", companyId),
    update as UpdateData<Record<string, unknown>>
  );
}

/**
 * Patch one or more keys on `companies/{id}.settings`. Uses dotted
 * field paths so writes are merged into the existing object instead
 * of clobbering sibling settings.
 */
export async function updateCompanySettings(
  companyId: string,
  patch: Partial<CompanySettings>
): Promise<void> {
  const dotted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    dotted[`settings.${key}`] = value ?? null;
  }
  dotted.updatedAt = serverTimestamp();
  await updateDoc(
    doc(firebaseDb, "companies", companyId),
    dotted as UpdateData<Record<string, unknown>>
  );
}
