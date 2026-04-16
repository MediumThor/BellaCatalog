/**
 * Compare our cost/sq ft (material billed) to vendor catalog $/sq ft for analytics card styling.
 */
export function materialBilledVsVendorTone(
  slabPerSqft: number | null | undefined,
  vendorCatalogPerSqft: number | null | undefined,
): "negative" | "equal" | undefined {
  if (
    slabPerSqft == null ||
    vendorCatalogPerSqft == null ||
    !Number.isFinite(slabPerSqft) ||
    !Number.isFinite(vendorCatalogPerSqft)
  ) {
    return undefined;
  }
  const eps = 0.005;
  if (slabPerSqft > vendorCatalogPerSqft + eps) return "negative";
  if (Math.abs(slabPerSqft - vendorCatalogPerSqft) <= eps) return "equal";
  return undefined;
}
