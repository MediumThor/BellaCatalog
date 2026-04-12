import type { CatalogItem, PriceEntry, PriceUnit } from "../types/catalog";

const UNIT_ALIASES: Record<string, PriceUnit> = {
  "sq ft": "sqft",
  sqft: "sqft",
  "sf": "sqft",
  "s.f.": "sqft",
  "per sf": "sqft",
  "per sq ft": "sqft",
  slab: "slab",
  bundle: "bundle",
  each: "each",
  lot: "lot",
  lf: "lf",
  "linear ft": "lf",
};

export function normalizeUnit(raw: unknown): PriceUnit {
  if (typeof raw !== "string") return "unknown";
  const k = raw.trim().toLowerCase();
  if (!k) return "unknown";
  return UNIT_ALIASES[k] ?? "unknown";
}

export function parsePriceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,\s]/g, "").replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function getNumericPrices(entries: PriceEntry[]): number[] {
  return entries
    .map((e) => e.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
}

export function getLowestPrice(entries: PriceEntry[]): number | null {
  const nums = getNumericPrices(entries);
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

export function getHighestPrice(entries: PriceEntry[]): number | null {
  const nums = getNumericPrices(entries);
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

export function formatMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function collectPriceLabels(items: CatalogItem[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    for (const pe of it.priceEntries) {
      const label = pe.label?.trim();
      if (label) set.add(label);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function entryMatchesPriceTypes(
  entry: PriceEntry,
  selectedLabels: string[]
): boolean {
  if (selectedLabels.length === 0) return true;
  const label = entry.label?.trim() ?? "";
  return selectedLabels.some((s) => label === s);
}

export function itemMatchesPriceTypes(
  item: CatalogItem,
  selectedLabels: string[]
): boolean {
  if (selectedLabels.length === 0) return true;
  return item.priceEntries.some((e) => entryMatchesPriceTypes(e, selectedLabels));
}
