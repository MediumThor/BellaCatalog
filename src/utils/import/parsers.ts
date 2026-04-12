import type { CatalogItem, ImportWarning, PriceEntry } from "../../types/catalog";
import type { ImportParserId } from "../../types/imports";
import { normalizeSlabSizeDisplay } from "../formatSlabSize";
import { sanitizeMsiProductTitle } from "../msiProductTitle";
import { parsePriceNumber } from "../priceHelpers";

type ParseResult = {
  vendor: string;
  sourceFile: string;
  items: CatalogItem[];
  warnings: ImportWarning[];
};

function slugId(parts: string[]): string {
  return parts
    .join("|")
    .replace(/[^a-zA-Z0-9|._-]+/g, "-")
    .slice(0, 200);
}

function money(s: string): number | null {
  return parsePriceNumber(s);
}

function makeItem(p: Partial<CatalogItem> & { vendor: string; sourceFile: string; displayName: string }): CatalogItem {
  const vendor = p.vendor;
  const sourceFile = p.sourceFile;
  const displayName = p.displayName;
  const sku = p.sku ?? "";
  const productName = p.productName ?? displayName;

  return {
    id: p.id ?? slugId([vendor, sourceFile, sku || displayName, productName]),
    vendor,
    manufacturer: p.manufacturer ?? "",
    sourceFile,
    productName,
    displayName,
    material: p.material ?? "",
    category: p.category ?? "",
    collection: p.collection ?? "",
    tierOrGroup: p.tierOrGroup ?? "",
    thickness: p.thickness ?? "",
    finish: p.finish ?? "",
    size: p.size ?? "",
    sku,
    vendorItemNumber: p.vendorItemNumber ?? "",
    bundleNumber: p.bundleNumber ?? "",
    priceEntries: p.priceEntries ?? [],
    notes: p.notes ?? "",
    freightInfo: p.freightInfo ?? "",
    availabilityFlags: p.availabilityFlags ?? [],
    tags: p.tags ?? [],
    colorFamilies: p.colorFamilies ?? [],
    dominantColors: p.dominantColors ?? [],
    undertones: p.undertones ?? [],
    patternTags: p.patternTags ?? [],
    movement: p.movement,
    styleTags: p.styleTags ?? [],
    rawSourceFields: p.rawSourceFields ?? {},
    integraGlue: p.integraGlue,
  };
}

function linesOf(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function detectParserId(filename: string, text: string): ImportParserId {
  const f = filename.toLowerCase();
  const t = text.toLowerCase();
  if (f.includes("stonex")) return "stonex";
  if (f.includes("daltile")) return "daltile_natural";
  if (f.includes("hanstone") || t.includes("hyundai l&c") || t.includes("price sheet")) return "hanstone";
  if (f.includes("trends in quartz") || t.includes("trends in quartz")) return "trends_quartz";
  if (f.includes("msi") || t.includes("qsl-")) return "msi_q_quartz";
  if (f.includes("uquartz")) return "ugm_uquartz";
  if (f.includes("natural stone prices")) return "ugm_natural";
  if (f.includes("vadara")) return "vadara";
  if (f.includes("viatera")) return "viatera";
  if (f.includes("corian") || t.includes("corian") && t.includes("group")) return "corian_hallmark";
  if (f.includes("cosentino") || t.includes("quick ship program")) return "cosentino_quickship";
  return "auto";
}

export function parsePdfText(parserId: ImportParserId, fileName: string, text: string): ParseResult {
  const warnings: ImportWarning[] = [];
  const sourceFile = fileName;
  const id = parserId === "auto" ? detectParserId(fileName, text) : parserId;

  switch (id) {
    case "stonex":
      return parseStoneX(sourceFile, text);
    case "daltile_natural":
      return parseDaltile(sourceFile, text);
    case "hanstone":
      return parseHanStone(sourceFile, text);
    case "trends_quartz":
      return parseTrends(sourceFile, text);
    case "msi_q_quartz":
      return parseMsi(sourceFile, text);
    case "ugm_uquartz":
      return parseUgmUQuartz(sourceFile, text);
    case "ugm_natural":
      return parseUgmNatural(sourceFile, text);
    case "viatera":
      return parseViatera(sourceFile, text);
    case "vadara":
      return parseVadara(sourceFile, text);
    case "corian_hallmark":
      return parseCorian(sourceFile, text);
    case "cosentino_quickship":
      return parseCosentinoQuickShip(sourceFile, text);
    default:
      warnings.push({
        severity: "error",
        message: "Could not detect a parser for this PDF. Choose a vendor parser manually.",
        sourceFile,
      });
      return { vendor: "Unknown", sourceFile, items: [], warnings };
  }
}

// ---------------- parsers ----------------

function parseStoneX(sourceFile: string, text: string): ParseResult {
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];

  const header = new Set([
    "Stone Name",
    "Category",
    "Bundle #",
    "Sizes",
    "Single",
    "Price",
    "Bundle",
    "Tier 1",
    "Tier 2",
    "QUARTZ PRICE LIST",
  ]);

  const isStoneLine = (s: string) => /\s-\s(Quartz|Granite|Marble|Quartzite|Porcelain)\s*$/i.test(s);
  const typeFrom = (s: string) => (s.match(/\s-\s(Quartz|Granite|Marble|Quartzite|Porcelain)\s*$/i)?.[1] ?? "").trim();

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    if (!s || header.has(s) || /www\.stonexusa\.com/i.test(s)) continue;
    if (!isStoneLine(s)) continue;

    const displayName = s;
    const material = typeFrom(s);
    const category = lines[i + 1] ?? "";
    const bundle = lines[i + 2] ?? "";
    const sizeBits: string[] = [];
    const prices: number[] = [];
    let j = i + 3;
    for (; j < lines.length; j++) {
      const t = lines[j];
      if (isStoneLine(t)) break;
      if (/^\$/.test(t)) {
        // handle broken "$16.0" + "0"
        let maybe = t;
        if (j + 1 < lines.length && /^\d+$/.test(lines[j + 1])) {
          maybe = `${t}${lines[j + 1]}`;
          j++;
        }
        const p = money(maybe);
        if (p !== null) prices.push(p);
        if (prices.length >= 2) {
          j++;
          break;
        }
      } else {
        sizeBits.push(t);
      }
    }
    const sizeRaw = sizeBits.join(" ").replace(/\s+/g, " ").trim();
    const size = normalizeSlabSizeDisplay(sizeRaw);
    const thickness = displayName.match(/\b(\d)\s*cm\b/i)?.[1] ? `${displayName.match(/\b(\d)\s*cm\b/i)![1]} cm` : "";
    const finish = displayName.match(/\b(Polished|Honed|Leathered|Brushed|Dual)\b/i)?.[1] ?? "";

    const pe: PriceEntry[] = [];
    if (prices[0] !== undefined) pe.push({ label: "Single — per sq ft", price: prices[0], unit: "sqft", size });
    if (prices[1] !== undefined) pe.push({ label: "Bundle — per sq ft", price: prices[1], unit: "sqft", size });

    items.push(
      makeItem({
        vendor: "StoneX",
        manufacturer: "StoneX",
        sourceFile,
        productName: displayName.split(" - ")[0]?.trim() || displayName,
        displayName,
        material: material || "Stone",
        category,
        collection: "",
        tierOrGroup: "",
        thickness,
        finish,
        size,
        bundleNumber: bundle,
        priceEntries: pe,
        notes: "Imported from PDF (best-effort).",
        tags: ["pdf-import", "stonex"],
        rawSourceFields: { bundle },
      })
    );
    i = j - 1;
  }

  if (!items.length) {
    warnings.push({ severity: "warning", message: "No StoneX rows detected.", sourceFile });
  }
  return { vendor: "StoneX", sourceFile, items, warnings };
}

function parseDaltile(sourceFile: string, text: string): ParseResult {
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];
  const skuRe = /^[A-Z]\d{3,4}(?:\s*\+\s*[A-Z]\d{3,4})?$/;

  for (let i = 0; i < lines.length - 3; i++) {
    const sku = lines[i];
    if (!skuRe.test(sku)) continue;
    const name = lines[i + 1] ?? "";
    const nums: number[] = [];
    for (let j = i + 2; j < Math.min(i + 10, lines.length) && nums.length < 2; j++) {
      const t = lines[j];
      if (skuRe.test(t)) break;
      const p = money(t.startsWith("$") ? t : `$${t}`);
      if (p !== null) nums.push(p);
    }
    if (nums.length < 2) continue;
    items.push(
      makeItem({
        vendor: "Daltile",
        manufacturer: "Daltile",
        sourceFile,
        productName: name,
        displayName: name,
        material: "Natural stone",
        category: "Traditional (natural stone)",
        thickness: "2 cm / 3 cm",
        sku,
        vendorItemNumber: sku,
        priceEntries: [
          { label: "2 cm — per sq ft", price: nums[0], unit: "sqft", thickness: "2 cm" },
          { label: "3 cm — per sq ft", price: nums[1], unit: "sqft", thickness: "3 cm" },
        ],
        notes: "Imported from PDF (best-effort).",
        tags: ["pdf-import", "daltile"],
      })
    );
  }

  if (!items.length) warnings.push({ severity: "warning", message: "No Daltile rows detected.", sourceFile });
  return { vendor: "Daltile", sourceFile, items, warnings };
}

function parseHanStone(sourceFile: string, text: string): ParseResult {
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];
  // Regex each collection block.
  const collRe =
    /^(VALUE|DESIGNER|IMAGINATION|PREMIUM|PREMIUM \+|PLATINUM)\s+COLLECTION\s*[\s\S]*?(?=^(VALUE|DESIGNER|IMAGINATION|PREMIUM|PREMIUM \+|PLATINUM)\s+COLLECTION|\s*$)/gim;
  const blocks = text.replace(/\r\n/g, "\n").match(collRe) ?? [];

  for (const b of blocks) {
    const head = b.match(/^(VALUE|DESIGNER|IMAGINATION|PREMIUM|PREMIUM \+|PLATINUM)\s+COLLECTION/m)?.[1] ?? "";
    const collection = `${head.toUpperCase()} COLLECTION`.trim();
    const p3 = b.match(/3CM\s*\|\s*\$\s*([\d.]+)/i)?.[1];
    const p2 = b.match(/2CM\s*\|\s*\$\s*([\d.]+)/i)?.[1];
    const sqft3 = p3 ? money(`$${p3}`) : null;
    const sqft2 = p2 ? money(`$${p2}`) : null;
    const jumbo = b.match(/JUMBO SIZE[\s\S]*?65["']?\s*[xX]\s*130["']?[\s\S]*?\$([\d,]+\.?\d*)\s*\$([\d,]+\.?\d*)/i);
    const jumbo3 = jumbo ? money(`$${jumbo[1]}`) : null;
    const jumbo2 = jumbo ? money(`$${jumbo[2]}`) : null;

    const colorLines = linesOf(b).filter((l) => {
      const u = l.toUpperCase();
      if (u.includes("COLLECTION") || u === "PER SQ FT" || u === "JUMBO SIZE") return false;
      if (/^\$/.test(l)) return false;
      if (/\b(3CM|2CM)\b.*\|/i.test(l)) return false;
      if (/^65["']?\s*[xX]\s*130/.test(l)) return false;
      if (/HYUNDAI|CHARTER|PRICE SHEET|FREIGHT/i.test(l)) return false;
      if (l.length > 52) return false;
      return /^[A-Za-z]/.test(l);
    });

    const seen = new Set<string>();
    for (const col of colorLines) {
      const key = col.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const pe: PriceEntry[] = [];
      if (sqft2 !== null) pe.push({ label: `${collection} — 2cm per sq ft`, price: sqft2, unit: "sqft", thickness: "2 cm" });
      if (sqft3 !== null) pe.push({ label: `${collection} — 3cm per sq ft`, price: sqft3, unit: "sqft", thickness: "3 cm" });
      if (jumbo2 !== null) pe.push({ label: `Jumbo 65×130 — 2cm per slab`, price: jumbo2, unit: "slab", thickness: "2 cm", size: '65"×130"' });
      if (jumbo3 !== null) pe.push({ label: `Jumbo 65×130 — 3cm per slab`, price: jumbo3, unit: "slab", thickness: "3 cm", size: '65"×130"' });
      if (!pe.length) continue;

      const displayName = col
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (m) => m.toUpperCase());
      items.push(
        makeItem({
          vendor: "HanStone Quartz",
          manufacturer: "HanStone",
          sourceFile,
          productName: col,
          displayName,
          material: "Quartz",
          category: "Surfacing",
          collection,
          tierOrGroup: collection,
          priceEntries: pe,
          notes: "Imported from PDF (best-effort).",
          freightInfo: "See PDF freight table.",
          availabilityFlags: ["regional"],
          tags: ["pdf-import", "hanstone"],
        })
      );
    }
  }

  if (!items.length) warnings.push({ severity: "warning", message: "No HanStone collection blocks detected.", sourceFile });
  return { vendor: "HanStone", sourceFile, items, warnings };
}

function parseTrends(sourceFile: string, text: string): ParseResult {
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];
  const tiq = /^TIQ[A-Z0-9]+$/;

  for (let i = 0; i < lines.length; i++) {
    const sku = lines[i];
    if (!tiq.test(sku) || i < 3) continue;
    const finish = lines[i - 1];
    const colorNum = lines[i - 2];
    const name = lines[i - 3];
    const slab = money(lines[i + 1] ?? "");
    const sqft = money(lines[i + 2] ?? "");
    const pe: PriceEntry[] = [];
    if (slab !== null) pe.push({ label: "3cm Jumbo slab — per slab", price: slab, unit: "slab", thickness: "3 cm" });
    if (sqft !== null) pe.push({ label: "3cm — per sq ft", price: sqft, unit: "sqft", thickness: "3 cm" });
    if (!pe.length) continue;
    items.push(
      makeItem({
        vendor: "Jaeckle Distributors",
        manufacturer: "Trends in Quartz",
        sourceFile,
        productName: name,
        displayName: name,
        material: "Quartz",
        category: "Surfacing",
        finish,
        thickness: "3 cm",
        size: '65"×130" Jumbo',
        sku,
        vendorItemNumber: colorNum,
        priceEntries: pe,
        notes: "Imported from PDF (best-effort).",
        tags: ["pdf-import", "trends"],
      })
    );
  }

  if (!items.length) warnings.push({ severity: "warning", message: "No Trends TIQ rows detected.", sourceFile });
  return { vendor: "Jaeckle / Trends", sourceFile, items, warnings };
}

function parseMsi(sourceFile: string, text: string): ParseResult {
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];
  const skuRe = /^QSL-/i;
  let group = "Group 0";

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    const gm = s.match(/^(Group|GROUP)\s+(\d+)$/);
    if (gm) {
      group = `Group ${gm[2]}`;
      continue;
    }
    if (/^2CM ONLY/i.test(s)) {
      group = `${group} | 2CM ONLY`;
      continue;
    }
    if (!skuRe.test(s)) continue;
    const sku = s;
    const name = lines[i - 1] ?? "";
    const sizeBits: string[] = [];
    let price: number | null = null;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const t = lines[j];
      if (skuRe.test(t)) break;
      if (/^\$/.test(t)) {
        price = money(t);
        j++;
        break;
      }
      sizeBits.push(t);
    }
    if (price === null) continue;
    const thick = sku.toUpperCase().includes("-3CM") ? "3 cm" : sku.toUpperCase().includes("-2CM") ? "2 cm" : "";
    const cleanName = sanitizeMsiProductTitle(name);
    items.push(
      makeItem({
        vendor: "MSI",
        manufacturer: "MSI Q Quartz",
        sourceFile,
        productName: cleanName,
        displayName: cleanName,
        material: "Quartz",
        category: "Surfacing",
        collection: "Q Quartz",
        tierOrGroup: group,
        thickness: thick,
        size: sizeBits.join(" ").replace(/\s+/g, " ").trim(),
        sku,
        priceEntries: [{ label: `${thick || "Slab"} — per sq ft (${group.split("|")[0].trim()})`, price, unit: "sqft", thickness: thick }],
        notes: "Imported from PDF (best-effort).",
        tags: ["pdf-import", "msi"],
      })
    );
    i = j - 1;
  }

  if (!items.length) warnings.push({ severity: "warning", message: "No MSI QSL rows detected.", sourceFile });
  return { vendor: "MSI", sourceFile, items, warnings };
}

function parseUgmUQuartz(sourceFile: string, text: string): ParseResult {
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const brand = lines[i];
    if (brand !== "UQuartz" && brand !== "Printed UQuartz") continue;
    const priceLine = lines[i + 1];
    if (!priceLine.startsWith("$") || i < 2) continue;
    const name = lines[i - 2];
    const size = lines[i - 1];
    const p = money(priceLine);
    if (p === null) continue;
    const thick = /2CM/i.test(name) ? "2 cm" : /3CM/i.test(name) ? "3 cm" : "";
    items.push(
      makeItem({
        vendor: "UGM",
        manufacturer: brand,
        sourceFile,
        productName: name,
        displayName: name,
        material: "Quartz",
        category: "Surfacing",
        collection: "UQuartz",
        thickness: thick,
        size,
        priceEntries: [{ label: "Price per sq ft", price: p, unit: "sqft", ...(thick ? { thickness: thick } : {}) }],
        notes: "Imported from PDF (best-effort).",
        tags: ["pdf-import", "ugm", "uquartz"],
      })
    );
    i++;
  }
  if (!items.length) warnings.push({ severity: "warning", message: "No UQuartz rows detected.", sourceFile });
  return { vendor: "UGM", sourceFile, items, warnings };
}

function parseUgmNatural(sourceFile: string, text: string): ParseResult {
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const name = lines[i];
    const priceLine = lines[i + 1];
    if (!priceLine.startsWith("$")) continue;
    if (/NATURAL STONE COLOR|PRICE PER SQUARE FOOT/i.test(name)) continue;
    const p = money(priceLine);
    if (p === null) continue;
    items.push(
      makeItem({
        id: slugId(["UGM", sourceFile, name, String(p)]),
        vendor: "UGM",
        manufacturer: "UGM Natural",
        sourceFile,
        productName: name,
        displayName: name,
        material: /MARBLE/i.test(name) ? "Marble" : "Natural stone",
        category: "Natural",
        priceEntries: [{ label: "Price per sq ft", price: p, unit: "sqft" }],
        notes: "Imported from PDF (best-effort).",
        tags: ["pdf-import", "ugm", "natural-stone"],
      })
    );
    i++;
  }
  if (!items.length) warnings.push({ severity: "warning", message: "No UGM natural stone rows detected.", sourceFile });
  return { vendor: "UGM", sourceFile, items, warnings };
}

function parseViatera(sourceFile: string, text: string): ParseResult {
  // Best-effort line parser (pdfjs text extraction is usually enough).
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];

  let currentGroup = "";
  let currentSize = "";
  let currentThickness = "";
  let sqft: number | null = null;
  let slab: number | null = null;
  let colorBuffer: string[] = [];

  function flush() {
    if (!currentGroup || !currentSize || !currentThickness) return;
    if (sqft === null && slab === null) return;
    for (const c of colorBuffer) {
      const color = c.trim();
      if (!color) continue;
      const pe: PriceEntry[] = [];
      if (sqft !== null) pe.push({ label: `${currentGroup} — ${currentThickness} per sq ft`, price: sqft, unit: "sqft", thickness: currentThickness, size: currentSize });
      if (slab !== null) pe.push({ label: `${currentGroup} — ${currentThickness} per slab`, price: slab, unit: "slab", thickness: currentThickness, size: currentSize });
      items.push(
        makeItem({
          vendor: "LX Hausys (Viatera)",
          manufacturer: "Viatera",
          sourceFile,
          productName: color,
          displayName: color,
          material: "Quartz",
          category: "Surfacing",
          tierOrGroup: currentGroup,
          thickness: currentThickness,
          size: currentSize,
          priceEntries: pe,
          notes: "Imported from PDF (best-effort).",
          tags: ["pdf-import", "viatera"],
          rawSourceFields: { group: currentGroup, slabSize: currentSize },
        })
      );
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    const gm = s.match(/^Group\s+([A-Z])$/i);
    if (gm) {
      // new group resets
      currentGroup = `Group ${gm[1].toUpperCase()}`;
      currentSize = "";
      currentThickness = "";
      sqft = slab = null;
      colorBuffer = [];
      continue;
    }
    if (/^Jumbo/i.test(s) || /^Super/i.test(s)) {
      currentSize = s.replace(/\s+/g, " ").trim();
      continue;
    }
    const thick = s.match(/^(\d(?:\.\d)?)\s*cm$/i);
    if (thick) {
      currentThickness = `${thick[1]} cm`;
      // next lines should be $sqft then $slab
      const p1 = money(lines[i + 1] ?? "");
      const p2 = money(lines[i + 2] ?? "");
      if (p1 !== null) sqft = p1;
      if (p2 !== null) slab = p2;
      continue;
    }
    // Color lists often appear as comma separated line(s)
    if (/^\$/.test(s) || /VIATERA/i.test(s) || /Project Code/i.test(s) || /Thickness/i.test(s)) continue;
    if (/^\d+\"/i.test(s) || /Slab Weight/i.test(s) || /Truckload/i.test(s)) continue;
    if (s.length <= 2) continue;
    if (/^Entry$/i.test(s)) continue;
    if (/^Price$/i.test(s)) continue;
    if (/Bundle/i.test(s)) continue;
    if (/^\d+ slabs/i.test(s)) continue;

    // If this is a new block marker, flush existing.
    if (/^Group\s+[A-Z]/i.test(s) && colorBuffer.length) {
      flush();
      colorBuffer = [];
    }

    // treat as colors line (split commas)
    if (/[A-Za-z]/.test(s) && !/^\d/.test(s)) {
      const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
      if (parts.length) colorBuffer.push(...parts);
    }
  }
  flush();

  if (!items.length) warnings.push({ severity: "warning", message: "No Viatera rows detected (try another parser).", sourceFile });
  return { vendor: "Viatera", sourceFile, items, warnings };
}

function parseVadara(sourceFile: string, text: string): ParseResult {
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];

  // Approach: buffer color names until we hit a price line containing size + slab + sqft.
  const priceRow = /(\\d{2,3}x\\d{2,3}).*?(\\$[\\d,]+\\s*\\+?).*?(\\$[\\d.]+)/;
  const colors: string[] = [];
  let bookMatch = false;

  function flushWith(size: string, slabRaw: string, sqftRaw: string) {
    const slab = money(slabRaw.replace("+", "").trim());
    const sqft = money(sqftRaw);
    if (slab === null && sqft === null) return;
    for (const c of colors.splice(0, colors.length)) {
      const clean = c.replace(/\s*\+\s*\(New\)\s*$/i, "").trim();
      const finish = /\(Leather\)/i.test(c) ? "Leather" : "";
      const pe: PriceEntry[] = [];
      if (sqft !== null) pe.push({ label: "3cm — per sq ft", price: sqft, unit: "sqft", thickness: "3 cm", size });
      if (slab !== null) pe.push({ label: "3cm — per slab", price: slab, unit: "slab", thickness: "3 cm", size });
      items.push(
        makeItem({
          vendor: "UGM",
          manufacturer: "Vadara",
          sourceFile,
          productName: clean,
          displayName: clean,
          material: "Quartz",
          category: "Surfacing",
          collection: "Vadara",
          thickness: "3 cm",
          finish,
          size,
          priceEntries: pe,
          notes: "Imported from PDF (best-effort).",
          tags: ["pdf-import", "vadara", "ugm"],
          rawSourceFields: { bookMatch },
        })
      );
    }
    bookMatch = false;
  }

  for (const s of lines) {
    if (/^ALL SLABS ARE 3CM/i.test(s)) continue;
    if (/^Color\s+Size\s+Book Match/i.test(s)) continue;
    if (s === "Yes") {
      bookMatch = true;
      continue;
    }
    const m = s.match(priceRow);
    if (m) {
      flushWith(m[1], m[2], m[3]);
      continue;
    }
    // treat as color name line(s)
    if (/^(Regular size|Super Jumbo Size)/i.test(s)) continue;
    if (/^\+?Super Jumbo/i.test(s)) continue;
    if (/^\d+\s*x\s*\d+/.test(s)) continue;
    if (!/^[A-Za-z]/.test(s)) continue;
    // split multiline blobs that got concatenated
    const parts = s.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    colors.push(...parts);
  }

  if (!items.length) warnings.push({ severity: "warning", message: "No Vadara rows detected (try another parser).", sourceFile });
  return { vendor: "Vadara", sourceFile, items, warnings };
}

function parseCorian(sourceFile: string, text: string): ParseResult {
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];

  let group = "";
  let p2: number | null = null;
  let p3: number | null = null;

  const sizeMap: Record<string, string> = {
    S: 'Standard 63"×120"',
    E: 'Extended 63"×126"',
    J: 'Jumbo 65"×130"',
  };

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    const gm = s.match(/^Group\s+(\d+)/i);
    if (gm) {
      group = `Group ${gm[1]}`;
      p2 = p3 = null;
      continue;
    }
    const pm = s.match(/Price per sq\.\s*ft\.\s*\$([\d.]+)\s*\$([\d.]+)/i);
    if (pm) {
      p2 = money(`$${pm[1]}`);
      p3 = money(`$${pm[2]}`);
      continue;
    }
    // color row: "Cloud White S/J ST ST Rice Paper Translucent White"
    if (!group || (p2 === null && p3 === null)) continue;
    if (/^ST\s*=/i.test(s) || /^S-Standard/i.test(s) || /^E-Extended/i.test(s) || /^J-Jumbo/i.test(s)) continue;
    if (/Corian/i.test(s) || /Hallmark/i.test(s) || /MyAccount/i.test(s)) continue;
    if (s.length < 3) continue;

    const parts = s.split(/\s+/);
    const color = parts.slice(0, 2).join(" "); // best-effort; many are 2-word
    const sizesCode = parts.find((p) => /^[SEJ](\/[SEJ])*$/.test(p)) ?? "";
    if (!sizesCode) continue;
    const stocked2 = /\bST\b/i.test(s);
    const sizeDesc = sizesCode
      .split("/")
      .map((c) => sizeMap[c] ?? c)
      .join(" / ");

    const pe: PriceEntry[] = [];
    if (p2 !== null) pe.push({ label: `${group} — 2cm per sq ft`, price: p2, unit: "sqft", thickness: "2 cm" });
    if (p3 !== null) pe.push({ label: `${group} — 3cm per sq ft`, price: p3, unit: "sqft", thickness: "3 cm" });

    items.push(
      makeItem({
        vendor: "Hallmark Building Supplies",
        manufacturer: "Corian Quartz",
        sourceFile,
        productName: color,
        displayName: color,
        material: "Quartz",
        category: "Surfacing",
        collection: group,
        tierOrGroup: group,
        thickness: "2 cm / 3 cm",
        size: sizeDesc,
        priceEntries: pe,
        availabilityFlags: stocked2 ? ["stocked"] : [],
        notes: "Imported from PDF (best-effort).",
        tags: ["pdf-import", "corian", "hallmark"],
        rawSourceFields: { sizesCode },
      })
    );
  }

  if (!items.length) warnings.push({ severity: "warning", message: "No Corian/Hallmark group tables detected.", sourceFile });
  return { vendor: "Hallmark / Corian", sourceFile, items, warnings };
}

function parseCosentinoQuickShip(sourceFile: string, text: string): ParseResult {
  const lines = linesOf(text);
  const items: CatalogItem[] = [];
  const warnings: ImportWarning[] = [];

  for (let i = 0; i < lines.length - 2; i++) {
    const size = lines[i];
    if (!/^\d+\"\s*x\s*\d+\"\s*x\s*\d+\"/.test(size)) continue;
    const color = lines[i + 1];
    const price = lines[i + 2];
    if (!price.startsWith("$")) continue;
    const p = money(price);
    if (p === null) continue;
    items.push(
      makeItem({
        vendor: "Cosentino",
        manufacturer: "Silestone / Cosentino",
        sourceFile,
        productName: `${color} sink/accessory`,
        displayName: `${color} — ${size}`,
        material: "Accessory",
        category: "Sinks / Accessories",
        collection: "Quick Ship",
        size,
        priceEntries: [{ label: "Price per unit", price: p, unit: "each" }],
        notes: "Imported from PDF (best-effort; accessory tables only).",
        tags: ["pdf-import", "cosentino", "quick-ship"],
      })
    );
  }

  if (!items.length) warnings.push({ severity: "warning", message: "No Quick Ship price rows detected.", sourceFile });
  return { vendor: "Cosentino", sourceFile, items, warnings };
}

