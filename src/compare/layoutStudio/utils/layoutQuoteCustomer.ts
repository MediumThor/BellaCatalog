import type { CustomerRecord } from "../../../types/compareQuote";
import type { LayoutQuoteCustomerSnapshot } from "../types/layoutQuoteShare";

export function layoutQuoteCustomerFromRecord(
  c: CustomerRecord | null | undefined
): LayoutQuoteCustomerSnapshot | null {
  if (!c) return null;
  const displayName = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return {
    displayName: displayName || "—",
    phone: (c.phone ?? "").trim() || "—",
    email: (c.email ?? "").trim() || "—",
    address: (c.address ?? "").trim() || "—",
    notes: (c.notes ?? "").trim() || null,
  };
}
