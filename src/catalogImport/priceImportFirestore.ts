import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { firebaseDb } from "../firebase";
import type { PriceImportDoc, PriceImportFileType } from "./types";

/**
 * Firestore access for company price imports. Phase 1: we only write the
 * `uploaded` state — the real parser runs in backend code later
 * (see `docs/saas-refactor/40_ai_price_import_pipeline.md`).
 */

const INGESTION_SPEC_VERSION = "0.1.0-phase1";
const PARSER_VERSION = "frontend-stub@0.1.0";

function priceImportsCol(companyId: string) {
  return collection(firebaseDb, "companies", companyId, "priceImports");
}

export function subscribeCompanyPriceImports(
  companyId: string,
  onData: (rows: PriceImportDoc[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(priceImportsCol(companyId), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const rows: PriceImportDoc[] = [];
      snap.forEach((entry) => {
        const raw = entry.data() as Record<string, unknown>;
        rows.push({
          companyId,
          importId: entry.id,
          vendorId: (raw.vendorId as string | null | undefined) ?? null,
          vendorName:
            typeof raw.vendorName === "string" ? raw.vendorName : "Unknown vendor",
          uploadedByUserId:
            typeof raw.uploadedByUserId === "string" ? raw.uploadedByUserId : "",
          originalFileName:
            typeof raw.originalFileName === "string" ? raw.originalFileName : "",
          fileType: (typeof raw.fileType === "string"
            ? raw.fileType
            : "unknown") as PriceImportFileType,
          storagePath: typeof raw.storagePath === "string" ? raw.storagePath : "",
          fileSizeBytes:
            typeof raw.fileSizeBytes === "number" ? raw.fileSizeBytes : 0,
          fileHash: (raw.fileHash as string | null | undefined) ?? null,
          status: (typeof raw.status === "string"
            ? raw.status
            : "uploaded") as PriceImportDoc["status"],
          parser: {
            provider:
              (raw.parser && typeof raw.parser === "object"
                ? ((raw.parser as Record<string, unknown>).provider as string)
                : "manual") === "openai"
                ? "openai"
                : "manual",
            model: null,
            ingestionSpecVersion: INGESTION_SPEC_VERSION,
            parserVersion: PARSER_VERSION,
          },
          summary:
            raw.summary && typeof raw.summary === "object"
              ? (raw.summary as PriceImportDoc["summary"])
              : undefined,
          warnings: Array.isArray(raw.warnings)
            ? (raw.warnings as PriceImportDoc["warnings"])
            : [],
          errorMessage: (raw.errorMessage as string | null | undefined) ?? null,
          createdAt: (raw.createdAt as PriceImportDoc["createdAt"]) ?? null,
          updatedAt: (raw.updatedAt as PriceImportDoc["updatedAt"]) ?? null,
          completedAt: (raw.completedAt as PriceImportDoc["completedAt"]) ?? null,
          publishedAt: (raw.publishedAt as PriceImportDoc["publishedAt"]) ?? null,
          publishedPriceBookId:
            (raw.publishedPriceBookId as string | null | undefined) ?? null,
        });
      });
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export interface CreatePriceImportInput {
  companyId: string;
  importId: string;
  uploadedByUserId: string;
  vendorId: string | null;
  vendorName: string;
  originalFileName: string;
  fileType: PriceImportFileType;
  storagePath: string;
  fileSizeBytes: number;
  fileHash?: string | null;
}

export function subscribeCompanyPriceImport(
  companyId: string,
  importId: string,
  onData: (row: PriceImportDoc | null) => void,
  onError?: (e: Error) => void
): () => void {
  const ref = doc(firebaseDb, "companies", companyId, "priceImports", importId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const raw = snap.data() as Record<string, unknown>;
      onData({
        companyId,
        importId: snap.id,
        vendorId: (raw.vendorId as string | null | undefined) ?? null,
        vendorName:
          typeof raw.vendorName === "string" ? raw.vendorName : "Unknown vendor",
        uploadedByUserId:
          typeof raw.uploadedByUserId === "string" ? raw.uploadedByUserId : "",
        originalFileName:
          typeof raw.originalFileName === "string" ? raw.originalFileName : "",
        fileType: (typeof raw.fileType === "string"
          ? raw.fileType
          : "unknown") as PriceImportFileType,
        storagePath: typeof raw.storagePath === "string" ? raw.storagePath : "",
        fileSizeBytes:
          typeof raw.fileSizeBytes === "number" ? raw.fileSizeBytes : 0,
        fileHash: (raw.fileHash as string | null | undefined) ?? null,
        status: (typeof raw.status === "string"
          ? raw.status
          : "uploaded") as PriceImportDoc["status"],
        parser: {
          provider:
            (raw.parser && typeof raw.parser === "object"
              ? ((raw.parser as Record<string, unknown>).provider as string)
              : "manual") === "openai"
              ? "openai"
              : "manual",
          model: null,
          ingestionSpecVersion: INGESTION_SPEC_VERSION,
          parserVersion: PARSER_VERSION,
        },
        summary:
          raw.summary && typeof raw.summary === "object"
            ? (raw.summary as PriceImportDoc["summary"])
            : undefined,
        warnings: Array.isArray(raw.warnings)
          ? (raw.warnings as PriceImportDoc["warnings"])
          : [],
        errorMessage: (raw.errorMessage as string | null | undefined) ?? null,
        createdAt: (raw.createdAt as PriceImportDoc["createdAt"]) ?? null,
        updatedAt: (raw.updatedAt as PriceImportDoc["updatedAt"]) ?? null,
        completedAt: (raw.completedAt as PriceImportDoc["completedAt"]) ?? null,
        publishedAt: (raw.publishedAt as PriceImportDoc["publishedAt"]) ?? null,
        publishedPriceBookId:
          (raw.publishedPriceBookId as string | null | undefined) ?? null,
      });
    },
    (e) => onError?.(e as Error)
  );
}

export async function deleteCompanyPriceImport(
  companyId: string,
  importId: string
): Promise<void> {
  await deleteDoc(
    doc(firebaseDb, "companies", companyId, "priceImports", importId)
  );
}

export async function createPriceImportDoc(
  input: CreatePriceImportInput
): Promise<void> {
  const ref = doc(
    firebaseDb,
    "companies",
    input.companyId,
    "priceImports",
    input.importId
  );
  await setDoc(
    ref,
    {
      companyId: input.companyId,
      importId: input.importId,
      vendorId: input.vendorId,
      vendorName: input.vendorName,
      uploadedByUserId: input.uploadedByUserId,
      originalFileName: input.originalFileName,
      fileType: input.fileType,
      storagePath: input.storagePath,
      fileSizeBytes: input.fileSizeBytes,
      fileHash: input.fileHash ?? null,
      status: "uploaded",
      parser: {
        provider: "manual",
        model: null,
        ingestionSpecVersion: INGESTION_SPEC_VERSION,
        parserVersion: PARSER_VERSION,
      },
      warnings: [],
      errorMessage: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: false }
  );
}
