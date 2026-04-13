import { customerDisplayName, type CustomerRecord } from "../../../types/compareQuote";
import type { LayoutQuoteCustomerSnapshot } from "../types/layoutQuoteShare";

export function layoutQuoteCustomerFromRecord(
  c: CustomerRecord | null | undefined
): LayoutQuoteCustomerSnapshot | null {
  if (!c) return null;
  return {
    displayName: customerDisplayName(c),
    phone: (c.phone ?? "").trim() || "—",
    email: (c.email ?? "").trim() || "—",
    address: (c.address ?? "").trim() || "—",
    notes: (c.notes ?? "").trim() || null,
  };
}
