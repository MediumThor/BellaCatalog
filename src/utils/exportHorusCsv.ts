import type { CatalogItem, PriceEntry } from "../types/catalog";
import { getLowestPrice } from "./priceHelpers";
import * as XLSX from "xlsx";

/**
 * Horus Match Inventory / Classification import layout (21 columns).
 * Sheet name **Match Inventory**. Missing numeric values export as **0**.
 */
export const MATCH_INVENTORY_SHEET_NAME = "Match Inventory";

export const MATCH_INVENTORY_HEADERS = [
  "StoneType",
  "StoneName",
  "StoneClass",
  "ArticleID",
  "SupplierID",
  "Country",
  "Finishing",
  "Thickness",
  "Weight",
  "VAT",
  "Cost",
  "Price",
  "Price2",
  "Price3",
  "Price4",
  "Price5",
  "DefaultW",
  "DefaultH",
  "SupplierName",
  "ColorsID",
  "PriceTag",
] as const;

/** Prefer per-sqft price entry; fallback to lowest numeric price. */
function preferredSqftPrice(entries: PriceEntry[]): number | null {
  const sq = entries.filter((e) => e.unit === "sqft" && e.price != null && Number.isFinite(e.price));
  if (sq.length) {
    return Math.min(...sq.map((e) => e.price as number));
  }
  return getLowestPrice(entries);
}

/** Thickness in mm (e.g. 3 cm → 30). */
function thicknessMmNumber(thickness: string): number {
  const t = thickness.trim().toLowerCase();
  const cm = t.match(/(\d+(?:\.\d+)?)\s*cm\b/);
  if (cm) {
    return Math.round(Number(cm[1]) * 10);
  }
  const mm = t.match(/(\d+(?:\.\d+)?)\s*mm\b/);
  if (mm) {
    return Math.round(Number(mm[1]));
  }
  return 0;
}

/** Map catalog material to example-style StoneType (Granite, Quartz, …). */
function stoneTypeFromMaterial(material: string): string {
  const m = material.trim().toLowerCase();
  if (!m) return "Other";
  if (m.includes("quartz") && !m.includes("quartzite")) return "Quartz";
  if (m.includes("quartzite")) return "Quartzite";
  if (m.includes("granite")) return "Granite";
  if (m.includes("marble")) return "Marble";
  if (m.includes("porcelain") || m.includes("dekton") || m.includes("ceramic")) return "Porcelain";
  if (m.includes("dolomite")) return "Dolomite";
  if (m.includes("soapstone")) return "Soapstone";
  if (m.includes("limestone")) return "Limestone";
  if (m.includes("travertine")) return "Travertine";
  if (m.includes("onyx")) return "Onyx";
  if (m.includes("natural")) return "Natural stone";
  const first = material.trim().split(/[\s/]+/)[0];
  if (!first) return "Other";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Horus ArticleID is numeric; prefer numeric SKU, else stable positive int from catalog `id`. */
function articleIdForHorus(it: CatalogItem): number {
  const sku = String(it.sku ?? "").trim();
  const n = parseInt(sku, 10);
  if (Number.isFinite(n) && n !== 0) return n;
  let h = 0;
  const key = it.id || `${it.vendor}|${it.productName}|${it.displayName}`;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(h) % 2147483647;
  return positive === 0 ? 1 : positive;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** First `W x H` pair in size strings (inches/cm as stored). */
function parseFirstSizePair(sizeStr: string): [number, number] | null {
  const m = sizeStr.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

function defaultWidthHeightFromItem(it: CatalogItem): { defaultW: number; defaultH: number } {
  const candidates = [it.size, ...it.priceEntries.map((e) => e.size ?? "")].filter(Boolean);
  for (const s of candidates) {
    const pair = parseFirstSizePair(s);
    if (pair) {
      const [x, y] = pair;
      return { defaultW: Math.max(x, y), defaultH: Math.min(x, y) };
    }
  }
  const live = it.liveInventory?.availableSizes?.[0];
  const w = live?.width;
  const h = live?.height;
  if (
    w != null &&
    h != null &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0
  ) {
    return { defaultW: Math.max(w, h), defaultH: Math.min(w, h) };
  }
  return { defaultW: 0, defaultH: 0 };
}

function matchInventoryRowValues(it: CatalogItem): (string | number)[] {
  const priceSqft = preferredSqftPrice(it.priceEntries);
  const priceNum = priceSqft != null && Number.isFinite(priceSqft) ? roundMoney(priceSqft) : 0;
  const thick = thicknessMmNumber(it.thickness);
  const stoneType = stoneTypeFromMaterial(it.material);
  const manu = it.manufacturer.trim();
  const vend = it.vendor.trim();
  const stoneName = manu || vend || stoneType;
  const stoneClass = (it.productName.trim() || it.displayName.trim()) || stoneName;
  const finish = it.finish.trim() || "Polished";
  const { defaultW, defaultH } = defaultWidthHeightFromItem(it);

  return [
    stoneType,
    stoneName,
    stoneClass,
    articleIdForHorus(it),
    0,
    "United States",
    finish,
    thick,
    0,
    0,
    priceNum,
    priceNum,
    0,
    0,
    0,
    0,
    defaultW,
    defaultH,
    vend || manu,
    0,
    0,
  ];
}

function buildMatchInventoryWorkbook(items: CatalogItem[]): XLSX.WorkBook {
  const aoa: (string | number)[][] = [
    [...MATCH_INVENTORY_HEADERS],
    ...items.map((it) => matchInventoryRowValues(it)),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, MATCH_INVENTORY_SHEET_NAME);
  return wb;
}

/** Excel workbook bytes (.xlsx), Horus Match Inventory layout. */
export function exportHorusSlabsXlsx(items: CatalogItem[]): Uint8Array {
  const wb = buildMatchInventoryWorkbook(items);
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadHorusSlabsExcel(items: CatalogItem[], filename: string): void {
  const u8 = exportHorusSlabsXlsx(items);
  const blob = new Blob([u8], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(filename, blob);
}
