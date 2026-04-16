import type { CatalogItem, PriceEntry } from "../types/catalog";
import type { JobComparisonOptionRecord, JobRecord } from "../types/compareQuote";

/** Markup on material cost before adding fabrication. */
export const QUOTED_MATERIAL_MARKUP = 1.6;

/**
 * Material ($/sq ft) → fabrication ($/sq ft). Sorted by material ascending.
 * Source: internal Bella Stone pricing table (material + fab schedule).
 */
const MATERIAL_TO_FABRICATION: { material: number; fabrication: number }[] = [
  { material: 15, fabrication: 44.9 },
  { material: 17, fabrication: 46.75 },
  { material: 19, fabrication: 48.38 },
  { material: 21, fabrication: 49.79 },
  { material: 23, fabrication: 50.98 },
  { material: 25, fabrication: 52.3 },
  { material: 27, fabrication: 53.5 },
  { material: 29, fabrication: 54.68 },
  { material: 31, fabrication: 55.83 },
  { material: 33, fabrication: 56.96 },
  { material: 35, fabrication: 59.7 },
  { material: 37, fabrication: 60.64 },
  { material: 39, fabrication: 62.57 },
  { material: 41, fabrication: 64.48 },
  { material: 43, fabrication: 66.38 },
  { material: 45, fabrication: 66.4 },
  { material: 47, fabrication: 68.27 },
  { material: 49, fabrication: 70.13 },
  { material: 51, fabrication: 71.97 },
  { material: 53, fabrication: 73.79 },
  { material: 55, fabrication: 72.6 },
  { material: 57, fabrication: 74.37 },
  { material: 59, fabrication: 76.12 },
  { material: 61, fabrication: 77.85 },
  { material: 63, fabrication: 79.56 },
  { material: 65, fabrication: 78.1 },
  { material: 67, fabrication: 79.76 },
  { material: 69, fabrication: 81.4 },
  { material: 71, fabrication: 83.02 },
  { material: 73, fabrication: 84.62 },
  { material: 75, fabrication: 83.1 },
  { material: 77, fabrication: 84.66 },
  { material: 79, fabrication: 86.21 },
  { material: 81, fabrication: 87.74 },
  { material: 83, fabrication: 89.25 },
  { material: 85, fabrication: 87.4 },
  { material: 87, fabrication: 88.88 },
  { material: 89, fabrication: 90.35 },
  { material: 91, fabrication: 91.8 },
  { material: 93, fabrication: 93.23 },
  { material: 95, fabrication: 91.3 },
  { material: 97, fabrication: 92.7 },
  { material: 99, fabrication: 94.08 },
  { material: 100, fabrication: 93 },
];

function lerpFabrication(materialSqft: number, a: number, b: number, fa: number, fb: number): number {
  if (b === a) return fa;
  return fa + ((materialSqft - a) / (b - a)) * (fb - fa);
}

/** Interpolates fabrication $/sq ft from the schedule; linear between knots, linear extrapolation outside 15–100. */
export function fabricationForMaterialSqft(materialSqft: number): number {
  const rows = MATERIAL_TO_FABRICATION;
  const m = materialSqft;
  const first = rows[0];
  const second = rows[1];
  const penult = rows[rows.length - 2];
  const last = rows[rows.length - 1];

  if (m <= first.material) {
    return lerpFabrication(m, first.material, second.material, first.fabrication, second.fabrication);
  }
  if (m >= last.material) {
    return lerpFabrication(m, penult.material, last.material, penult.fabrication, last.fabrication);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (m >= a.material && m <= b.material) {
      return lerpFabrication(m, a.material, b.material, a.fabrication, b.fabrication);
    }
  }
  return last.fabrication;
}

/** Lowest numeric $/sq ft from entries priced per square foot (used as “material” for the quote). */
export function getLowestSqftMaterialPrice(entries: PriceEntry[]): number | null {
  let best: number | null = null;
  for (const e of entries) {
    if (e.unit !== "sqft") continue;
    const p = e.price;
    if (typeof p !== "number" || !Number.isFinite(p)) continue;
    if (best === null || p < best) best = p;
  }
  return best;
}

export type QuotedPriceBreakdown = {
  materialSqft: number;
  materialMarkup: number;
  fabrication: number;
  quotedPerSqft: number;
};

/**
 * Quoted installed price $/sq ft = (material $/sq ft × 1.6) + fabrication(material $/sq ft from schedule).
 * Returns null if no per-sq-ft material price is available on the item.
 */
export function computeQuotedPricePerSqft(item: CatalogItem): QuotedPriceBreakdown | null {
  const materialSqft = getLowestSqftMaterialPrice(item.priceEntries);
  if (materialSqft === null) return null;
  const materialMarkup = materialSqft * QUOTED_MATERIAL_MARKUP;
  const fabrication = fabricationForMaterialSqft(materialSqft);
  return {
    materialSqft,
    materialMarkup,
    fabrication,
    quotedPerSqft: materialMarkup + fabrication,
  };
}

/**
 * Sq ft basis for compare quotes: layout estimate on the option when present, otherwise legacy
 * manual `job.squareFootage` (older data).
 */
export function effectiveQuoteSquareFootage(
  job: JobRecord,
  option?: JobComparisonOptionRecord | null
): number {
  const fromLayout = option?.layoutEstimatedAreaSqFt;
  if (typeof fromLayout === "number" && Number.isFinite(fromLayout) && fromLayout > 0) {
    return fromLayout;
  }
  const legacy = job.squareFootage;
  if (typeof legacy === "number" && Number.isFinite(legacy) && legacy > 0) {
    return legacy;
  }
  return 0;
}

/** When no option is in context (e.g. add-product modal), use any option’s saved layout area on the job. */
export function jobQuoteSquareFootage(
  job: JobRecord,
  allOptions?: JobComparisonOptionRecord[] | null
): number {
  if (allOptions?.length) {
    for (const o of allOptions) {
      const a = o.layoutEstimatedAreaSqFt;
      if (typeof a === "number" && Number.isFinite(a) && a > 0) return a;
    }
  }
  return effectiveQuoteSquareFootage(job, null);
}
