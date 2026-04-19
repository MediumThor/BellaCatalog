import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { firebaseStorage } from "../firebase";
import type { PriceImportFileType } from "./types";

/**
 * Upload helpers for company price-sheet files. Files are stored under:
 *
 *   companies/{companyId}/price-imports/{importId}/{originalFileName}
 *
 * The backend parser (added later) will read from the same path.
 */

function randomId(length = 20): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function detectFileType(file: File): PriceImportFileType {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (name.endsWith(".csv")) return "csv";
  const type = file.type.toLowerCase();
  if (type.includes("pdf")) return "pdf";
  if (type.includes("sheet") || type.includes("excel")) return "xlsx";
  if (type.includes("csv")) return "csv";
  return "unknown";
}

export interface UploadedPriceImportFile {
  importId: string;
  storagePath: string;
  downloadUrl: string;
  fileSizeBytes: number;
  fileType: PriceImportFileType;
}

export async function uploadPriceImportFile(
  companyId: string,
  file: File
): Promise<UploadedPriceImportFile> {
  const importId = randomId();
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
  const storagePath = `companies/${companyId}/price-imports/${importId}/${safeName}`;
  const ref = storageRef(firebaseStorage, storagePath);
  const snap = await uploadBytes(ref, file, { contentType: file.type });
  const downloadUrl = await getDownloadURL(snap.ref);
  return {
    importId,
    storagePath,
    downloadUrl,
    fileSizeBytes: file.size,
    fileType: detectFileType(file),
  };
}
