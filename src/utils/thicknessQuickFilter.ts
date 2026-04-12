/**
 * Map catalog thickness labels to a coarse 2 cm vs 3 cm bucket for quick filtering.
 * Uses the same string values as `it.thickness` / filter options (exact match in filterCatalog).
 * Avoids substring traps (e.g. "32cm" must not match "3cm").
 */
export function classifyThicknessLabel(label: string): 2 | 3 | null {
  const t = label.trim();
  if (!t) return null;
  if (/\b3\s*cm\b/i.test(t)) return 3;
  if (/\b2\s*cm\b/i.test(t)) return 2;
  const c = t.toLowerCase().replace(/\s/g, "");
  if (c === "3cm" || c === "30mm") return 3;
  if (c === "2cm" || c === "20mm") return 2;
  return null;
}

/** Exact option strings from the catalog that match the given cm class. */
export function thicknessOptionsForCmClass(options: string[], cm: 2 | 3): string[] {
  return options.filter((o) => classifyThicknessLabel(o) === cm);
}

function sortedKey(arr: string[]): string {
  return [...arr].sort().join("\0");
}

export type ThicknessQuickPreset = "all" | "2cm" | "3cm" | "custom";

export function thicknessQuickPresetFromSelection(
  selected: string[],
  catalogThicknessOptions: string[]
): ThicknessQuickPreset {
  const s2 = thicknessOptionsForCmClass(catalogThicknessOptions, 2);
  const s3 = thicknessOptionsForCmClass(catalogThicknessOptions, 3);
  if (selected.length === 0) return "all";
  if (s2.length > 0 && sortedKey(selected) === sortedKey(s2)) return "2cm";
  if (s3.length > 0 && sortedKey(selected) === sortedKey(s3)) return "3cm";
  return "custom";
}
