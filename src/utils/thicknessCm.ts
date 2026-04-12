import type { CatalogItem, PriceEntry } from "../types/catalog";

function formatCm(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  if (Number.isInteger(r)) return `${r}cm`;
  return `${String(r).replace(/\.?0+$/, "")}cm`;
}

/** Parse one fragment (e.g. "20mm", "2 cm", "3CM") into canonical "2cm" / "3cm". */
export function normalizeThicknessToken(fragment: string): string {
  const f = fragment.trim();
  if (!f) return "";

  const cm = f.match(/(\d+(?:\.\d+)?)\s*cm\b/i);
  if (cm) return formatCm(Number(cm[1]));

  const mm = f.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mm) return formatCm(Number(mm[1]) / 10);

  const bare = f.match(/^(\d+(?:\.\d+)?)\s*$/);
  if (bare) return formatCm(Number(bare[1]));

  return f;
}

function splitSegments(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  return s
    .split(/\s*(?:[/&|,]|\s+and\s+|\s+or\s+)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Values in cm like "2cm", "3cm" (mm converted). Empty if nothing numeric found. */
export function parseThicknessVariantsFromString(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  const segments = splitSegments(s);
  const parts = segments.length ? segments : [s];
  const out: string[] = [];
  for (const p of parts) {
    const t = normalizeThicknessToken(p);
    if (t && /cm$/i.test(t)) out.push(t);
  }
  return uniquePreservingOrder(out);
}

function uniquePreservingOrder(vals: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of vals) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Distinct slab thicknesses from price lines (2 cm / 3 cm / 20 mm, etc.). */
function thicknessVariantsFromPriceEntries(entries: PriceEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const raw = e.thickness?.trim();
    if (!raw) continue;
    const n = normalizeThicknessToken(raw);
    if (!n || !/cm$/i.test(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function collectThicknessVariants(item: CatalogItem): string[] {
  const fromArr =
    item.thicknesses
      ?.filter(Boolean)
      .map((t) => normalizeThicknessToken(t))
      .filter((t) => t && /cm$/i.test(t)) ?? [];
  if (fromArr.length > 1) return uniquePreservingOrder(fromArr);

  const parsed = parseThicknessVariantsFromString(item.thickness);
  if (parsed.length > 1) return parsed;
  if (parsed.length === 1) return parsed;
  if (fromArr.length === 1) return fromArr;

  const fromPrices = thicknessVariantsFromPriceEntries(item.priceEntries);
  if (fromPrices.length > 1) return fromPrices;

  const t = item.thickness.trim();
  if (!t) {
    if (fromPrices.length === 1) return fromPrices;
    return [""];
  }
  const one = normalizeThicknessToken(t);
  return [one && /cm$/i.test(one) ? one : t];
}

function priceEntriesForVariant(entries: PriceEntry[], variantCm: string): PriceEntry[] {
  const v = variantCm;
  const anyHasThickness = entries.some((e) => e.thickness?.trim());
  if (!anyHasThickness) {
    return entries.map((e) => ({
      ...e,
      thickness: e.thickness ? normalizeThicknessToken(e.thickness) : v,
    }));
  }
  const nV = v ? normalizeThicknessToken(v) : "";
  const filtered = entries.filter((e) => {
    if (!e.thickness?.trim()) return true;
    return normalizeThicknessToken(e.thickness) === nV;
  });
  return filtered.map((e) => ({
    ...e,
    thickness: e.thickness ? normalizeThicknessToken(e.thickness) : v,
  }));
}

function normalizePriceEntriesThickness(entries: PriceEntry[]): PriceEntry[] {
  return entries.map((e) => ({
    ...e,
    thickness: e.thickness ? normalizeThicknessToken(e.thickness) : e.thickness,
  }));
}

/** Normalize mm→cm on all thickness fields; does not split rows. */
export function normalizeThicknessFieldsOnItem(item: CatalogItem): CatalogItem {
  const thickness = item.thickness.trim()
    ? (() => {
        const vars = parseThicknessVariantsFromString(item.thickness);
        if (vars.length === 1) return vars[0];
        if (vars.length > 1) return item.thickness;
        const one = normalizeThicknessToken(item.thickness);
        return one && /cm$/i.test(one) ? one : item.thickness;
      })()
    : "";

  const thicknesses = item.thicknesses?.length
    ? uniquePreservingOrder(
        item.thicknesses.map((t) => normalizeThicknessToken(t)).filter((t) => t && /cm$/i.test(t))
      )
    : undefined;

  return {
    ...item,
    thickness,
    thicknesses: thicknesses?.length ? thicknesses : undefined,
    priceEntries: normalizePriceEntriesThickness(item.priceEntries),
  };
}

/**
 * If the row encodes multiple thicknesses (e.g. "2cm/3cm" or thicknesses: ["2cm","3cm"]),
 * return one item per thickness with distinct ids. Otherwise return a single normalized item.
 */
/** Match file / API maps (StoneX, Cosentino) that key by pre-split catalog `id`. */
export function catalogEnrichmentCatalogId(it: CatalogItem): string {
  const v = (it.rawSourceFields as Record<string, unknown> | undefined)?.__thicknessSplitFromId;
  return typeof v === "string" && v.trim() ? v : it.id;
}

export function expandCatalogItemByThickness(item: CatalogItem): CatalogItem[] {
  const normalized = normalizeThicknessFieldsOnItem(item);
  const variants = collectThicknessVariants(normalized);
  if (variants.length <= 1) {
    const t = variants[0] ?? normalized.thickness;
    return [
      {
        ...normalized,
        thickness: t,
        thicknesses: undefined,
      },
    ];
  }

  const baseId = normalized.id;
  const multi = variants.length > 1;
  return variants.map((v) => ({
    ...normalized,
    id: `${baseId}|t:${v}`,
    thickness: v,
    thicknesses: undefined,
    displayName: multi ? `${normalized.displayName} (${v})` : normalized.displayName,
    priceEntries: priceEntriesForVariant(normalized.priceEntries, v),
    rawSourceFields: {
      ...normalized.rawSourceFields,
      __thicknessSplitFromId: baseId,
    },
  }));
}
