import type { Timestamp } from "firebase/firestore";
import type { CatalogItem, ImportWarning, PriceUnit } from "../types/catalog";

/**
 * Price import / price book / company catalog item types.
 *
 * See `docs/saas-refactor/40_ai_price_import_pipeline.md` and
 * `docs/saas-refactor/41_price_import_spec.md` for semantics.
 */

export type PriceImportFileType = "pdf" | "xlsx" | "csv" | "unknown";

export type PriceImportStatus =
  | "uploaded"
  | "queued"
  | "parsing"
  | "needs_review"
  | "ready_to_publish"
  | "published"
  | "failed"
  | "canceled";

export type ParsedRowStatus =
  | "accepted"
  | "needs_review"
  | "rejected"
  | "duplicate"
  | "error";

export type PriceBookStatus = "draft" | "published" | "archived";

export type CatalogItemSourceType =
  | "company_price_book"
  | "company_manual"
  | "global_product"
  | "supplier_inventory"
  | "legacy_static"
  | "price_book_line";

export interface PriceImportParserMeta {
  provider: "openai" | "deterministic" | "manual";
  model?: string | null;
  ingestionSpecVersion: string;
  parserVersion: string;
}

export interface PriceImportSummary {
  detectedVendorName?: string | null;
  detectedManufacturerNames?: string[];
  rowCount: number;
  acceptedRowCount: number;
  warningCount: number;
  errorCount: number;
}

export interface PriceImportDoc {
  companyId: string;
  importId: string;

  vendorId: string | null;
  vendorName: string;

  uploadedByUserId: string;

  originalFileName: string;
  fileType: PriceImportFileType;
  storagePath: string;
  fileSizeBytes: number;
  fileHash?: string | null;

  status: PriceImportStatus;

  parser: PriceImportParserMeta;
  summary?: PriceImportSummary;
  warnings: ImportWarning[];
  errorMessage?: string | null;

  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  completedAt?: Timestamp | null;
  publishedAt?: Timestamp | null;
  publishedPriceBookId?: string | null;
}

export interface ParsedPriceRowMatch {
  matchType:
    | "canonical_product"
    | "supplier_listing"
    | "comparable_group"
    | "none";
  canonicalProductId?: string | null;
  confidence: number;
  reason: string;
  requiresHumanReview: boolean;
}

/** A catalog item draft coming out of the parser — not yet published. */
export type CatalogItemDraft = Partial<CatalogItem> & {
  productName: string;
};

export interface ParsedPriceRowDoc {
  companyId: string;
  importId: string;
  rowId: string;

  rowIndex: number;
  sourcePage?: number | null;
  rawText?: string | null;
  rawRow?: Record<string, unknown>;

  normalized: CatalogItemDraft;

  status: ParsedRowStatus;
  confidence: number;
  warnings: ImportWarning[];
  match?: ParsedPriceRowMatch;

  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PriceBookDoc {
  companyId: string;
  priceBookId: string;
  vendorId: string;
  vendorName: string;
  name: string;
  versionLabel: string;
  sourceImportId: string;
  sourceFileName: string;
  sourceFileHash?: string | null;
  status: PriceBookStatus;
  effectiveDate?: string | null;
  publishedByUserId?: string | null;
  publishedAt?: Timestamp | null;
  supersedesPriceBookId?: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PriceBookLineSource {
  importId: string;
  parsedRowId: string;
  sourcePage?: number | null;
  sourceContext?: string | null;
}

export interface PriceBookLineDoc {
  companyId: string;
  priceBookId: string;
  lineId: string;
  vendorId: string;
  vendorName: string;
  catalogItemId: string;
  canonicalProductId?: string | null;
  supplierListingId?: string | null;
  item: CatalogItem;
  source: PriceBookLineSource;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/**
 * Company-scoped catalog item. Note the ownership-clarification fields
 * (`canonicalProductId`, `globalMediaIds`, `companyMediaIds`,
 * `imageResolutionSource`) — see `docs/saas-refactor/05_ownership_clarification.md`.
 */
export interface CompanyCatalogItemDoc {
  companyId: string;
  catalogItemId: string;

  sourceType: CatalogItemSourceType;
  active: boolean;
  item: CatalogItem;

  canonicalProductId?: string | null;
  globalMediaIds?: string[];
  companyMediaIds?: string[];
  imageResolutionSource?:
    | "company_override"
    | "global_product_media"
    | "imported_source_url"
    | "none";

  currentPriceBookId?: string | null;
  currentPriceBookLineId?: string | null;

  createdByUserId?: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type { PriceUnit };
