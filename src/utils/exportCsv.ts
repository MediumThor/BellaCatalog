import type { CatalogItem, ColumnVisibility } from "../types/catalog";
import { glueBrandLabel } from "./glueBrandLabel";
import { formatMoney, getLowestPrice } from "./priceHelpers";

function escCell(s: string): string {
  const needsQuote = /[",\n\r]/.test(s);
  const inner = s.replace(/"/g, '""');
  return needsQuote ? `"${inner}"` : inner;
}

function integraSummary(item: CatalogItem): string {
  if (!item.integraGlue?.length) return "";
  const body = item.integraGlue
    .map((g) => (g.form ? `${g.glue} (${g.form})` : g.glue))
    .join(" | ");
  return `${glueBrandLabel(item)}: ${body}`;
}

function priceSummary(item: CatalogItem): string {
  return item.priceEntries
    .map((p) => {
      const amt = p.price !== null ? formatMoney(p.price) : "—";
      return `${p.label}: ${amt}${p.unit && p.unit !== "unknown" ? ` / ${p.unit}` : ""}`;
    })
    .join(" | ");
}

function sizeDimensions(item: CatalogItem): { width: string; height: string } {
  const raw = item.rawSourceFields || {};
  const widthCandidates = [raw.slabWidth, raw.width, raw.slab_width, raw.slabWidthIn];
  const heightCandidates = [raw.slabHeight, raw.height, raw.slab_height, raw.slabHeightIn];
  const width = widthCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || "";
  const height =
    heightCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || "";
  if (width || height) {
    return { width, height };
  }
  const match = item.size.match(/^\s*(.+?)\s*[xX]\s*(.+?)\s*$/);
  if (!match) return { width: "", height: "" };
  return {
    width: match[1]?.trim() || "",
    height: match[2]?.trim() || "",
  };
}

export function exportCsv(
  items: CatalogItem[],
  columns: ColumnVisibility
): string {
  const optional: { key: keyof ColumnVisibility; header: string }[] = [
    { key: "manufacturer", header: "Manufacturer" },
    { key: "category", header: "Category" },
    { key: "collection", header: "Collection" },
    { key: "tierOrGroup", header: "Tier / Group" },
    { key: "material", header: "Material" },
    { key: "thickness", header: "Thickness" },
    { key: "finish", header: "Finish" },
    { key: "size", header: "Size" },
    { key: "sku", header: "SKU" },
    { key: "vendorItemNumber", header: "Vendor Item #" },
    { key: "bundleNumber", header: "Bundle #" },
    { key: "glue", header: "Glue" },
    { key: "notes", header: "Notes" },
    { key: "freight", header: "Freight / Shipping" },
  ];

  const activeOptional = optional.filter((o) => columns[o.key]);
  const headers = [
    "Vendor",
    "Product Name",
    "Display Name",
    ...activeOptional.flatMap((o) => (o.key === "size" ? ["Width", "Height", o.header] : [o.header])),
    "Lowest Price",
    "All Prices",
    "Live Availability",
    "Live Sizes",
    "Live Source URL",
    "Live Last Seen",
    "Source File",
    "Row ID",
  ];

  const lines = [headers.map(escCell).join(",")];

  for (const it of items) {
    const lowest = getLowestPrice(it.priceEntries);
    const row: string[] = [it.vendor, it.productName, it.displayName];
    for (const o of activeOptional) {
      switch (o.key) {
        case "manufacturer":
          row.push(it.manufacturer);
          break;
        case "category":
          row.push(it.category);
          break;
        case "collection":
          row.push(it.collection);
          break;
        case "tierOrGroup":
          row.push(it.tierOrGroup);
          break;
        case "material":
          row.push(it.material);
          break;
        case "thickness":
          row.push(it.thickness);
          break;
        case "finish":
          row.push(it.finish);
          break;
        case "size": {
          const dims = sizeDimensions(it);
          row.push(dims.width);
          row.push(dims.height);
          row.push(it.size);
          break;
        }
        case "sku":
          row.push(it.sku);
          break;
        case "vendorItemNumber":
          row.push(it.vendorItemNumber);
          break;
        case "bundleNumber":
          row.push(it.bundleNumber);
          break;
        case "notes":
          row.push(it.notes);
          break;
        case "freight":
          row.push(it.freightInfo);
          break;
        case "glue":
          row.push(integraSummary(it));
          break;
        default:
          row.push("");
      }
    }
    row.push(lowest !== null ? String(lowest) : "");
    row.push(priceSummary(it));
    row.push(it.liveInventory?.availabilityStatus ?? "");
    row.push(
      it.liveInventory?.availableSizes?.length
        ? it.liveInventory.availableSizes
            .map((s) => s.label)
            .filter(Boolean)
            .join(" | ")
        : ""
    );
    row.push(it.liveInventory?.detailPageUrl || it.liveInventory?.sourceUrl || "");
    row.push(it.liveInventory?.inventoryLastSeenAt || "");
    row.push(it.sourceFile);
    row.push(it.id);
    lines.push(row.map(escCell).join(","));
  }

  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}
