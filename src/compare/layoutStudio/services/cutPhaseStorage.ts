/**
 * Storage helpers for the Cut phase (post-Quote fabrication handoff).
 *
 * Hard invariant: the DXF file uploaded here is treated as IMMUTABLE.
 * `uploadCutPhaseDxf` writes the original bytes verbatim and returns a
 * SHA-256 checksum of those bytes. The checksum is re-verified at export
 * time. Any "fix this for the user" mutation belongs in a separate path —
 * never in this module. See docs/layout-studio/50_LAYOUT_STUDIO_CUT_PHASE.md.
 */

import { getDownloadURL, ref, uploadBytes, uploadBytesResumable } from "firebase/storage";
import { firebaseStorage } from "../../../firebase";

export type CutUploadProgress = {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
};

function jobCutPrefix(companyId: string, customerId: string, jobId: string): string {
  return `companies/${companyId}/customers/${customerId}/jobs/${jobId}/cut-phase`;
}

function safeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "file";
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type UploadedCutDxf = {
  fileUrl: string;
  fileStoragePath: string;
  fileName: string;
  byteLength: number;
  checksum: string;
};

export async function uploadCutPhaseDxf(
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string,
  file: File,
  opts?: { onProgress?: (p: CutUploadProgress) => void }
): Promise<UploadedCutDxf> {
  const bytes = await file.arrayBuffer();
  const checksum = await sha256Hex(bytes);
  const safeName = sanitizeName(file.name);
  const storagePath = `${jobCutPrefix(companyId, customerId, jobId)}/${optionId}/dxf/${safeId()}-${safeName}`;
  const r = ref(firebaseStorage, storagePath);
  // Use the original ArrayBuffer to guarantee the bytes Firebase stores are
  // identical to what the user uploaded — no re-encoding through `File`.
  const task = uploadBytesResumable(r, bytes, {
    contentType: file.type || "application/dxf",
  });
  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const totalBytes = snap.totalBytes || file.size || 1;
        opts?.onProgress?.({
          bytesTransferred: snap.bytesTransferred,
          totalBytes,
          percent: (snap.bytesTransferred / totalBytes) * 100,
        });
      },
      reject,
      () => resolve(),
    );
  });
  const fileUrl = await getDownloadURL(r);
  return {
    fileUrl,
    fileStoragePath: storagePath,
    fileName: file.name,
    byteLength: bytes.byteLength,
    checksum,
  };
}

export type UploadedCutSlabScan = {
  imageUrl: string;
  imageStoragePath: string;
  byteLength: number;
};

export async function uploadCutPhaseSlabScan(
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string,
  file: File,
  opts?: { onProgress?: (p: CutUploadProgress) => void }
): Promise<UploadedCutSlabScan> {
  const safeName = sanitizeName(file.name);
  const storagePath = `${jobCutPrefix(companyId, customerId, jobId)}/${optionId}/slabs/${safeId()}-${safeName}`;
  const r = ref(firebaseStorage, storagePath);
  const task = uploadBytesResumable(r, file, {
    contentType: file.type || "application/octet-stream",
  });
  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const totalBytes = snap.totalBytes || file.size || 1;
        opts?.onProgress?.({
          bytesTransferred: snap.bytesTransferred,
          totalBytes,
          percent: (snap.bytesTransferred / totalBytes) * 100,
        });
      },
      reject,
      () => resolve(),
    );
  });
  const imageUrl = await getDownloadURL(r);
  return { imageUrl, imageStoragePath: storagePath, byteLength: file.size };
}

export async function uploadCutPhaseExportArtifact(
  companyId: string,
  customerId: string,
  jobId: string,
  optionId: string,
  payload: Blob,
  nameHint = "alphacam-handoff",
): Promise<{ artifactUrl: string; artifactStoragePath: string }> {
  const safeName = `${sanitizeName(nameHint)}-${Date.now()}.json`;
  const storagePath = `${jobCutPrefix(companyId, customerId, jobId)}/${optionId}/exports/${safeName}`;
  const r = ref(firebaseStorage, storagePath);
  await uploadBytes(r, payload, { contentType: payload.type || "application/json" });
  const artifactUrl = await getDownloadURL(r);
  return { artifactUrl, artifactStoragePath: storagePath };
}

/** Re-verify a previously-uploaded DXF still hashes to the stored checksum. */
export async function verifyDxfChecksum(fileUrl: string, expectedChecksum: string): Promise<boolean> {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Could not fetch DXF (${res.status})`);
  const bytes = await res.arrayBuffer();
  const actual = await sha256Hex(bytes);
  return actual.toLowerCase() === expectedChecksum.toLowerCase();
}

export { sha256Hex };
