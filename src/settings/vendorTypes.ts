import type { Timestamp } from "firebase/firestore";

/**
 * Minimal company-scoped vendor/supplier record. A vendor is a supplier or
 * distributor whose price sheets the company ingests. Vendor records are
 * referenced by `priceImports.vendorId` so imports can be grouped and so a
 * vendor's most-recent price book can be found.
 *
 * The global catalog has its own canonical `globalVendors/{vendorId}` —
 * that lives outside the company. `CompanyVendorDoc.canonicalVendorId`
 * is how the two are linked when a match exists.
 */
export interface CompanyVendorDoc {
  id: string;
  companyId: string;
  name: string;
  /** Friendly aliases the parser may see ("MSI" vs "M S International"). */
  aliases?: string[];
  /** Optional link to a globally-known vendor (populated later). */
  canonicalVendorId?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
  /** Soft-archive: hidden from the picker but kept for historical imports. */
  archived: boolean;
  createdByUserId: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type CompanyVendorCreateInput = Pick<
  CompanyVendorDoc,
  "name"
> &
  Partial<
    Pick<
      CompanyVendorDoc,
      "aliases" | "canonicalVendorId" | "website" | "contactEmail" | "notes"
    >
  >;

export type CompanyVendorUpdateInput = Partial<
  Pick<
    CompanyVendorDoc,
    "name" | "aliases" | "website" | "contactEmail" | "notes" | "archived"
  >
>;
