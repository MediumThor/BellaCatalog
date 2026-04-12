import type {
  CatalogItem,
  ImportWarning,
  IntegraGlueEntry,
  NormalizedCatalog,
  PriceEntry,
} from "../types/catalog";
import { normalizeSlabSizeDisplay } from "./formatSlabSize";
import { sanitizeMsiProductTitle } from "./msiProductTitle";
import { normalizeUnit, parsePriceNumber } from "./priceHelpers";
import {
  isCosentinoSpecGarbage,
  sanitizeCosentinoSpecString,
  sanitizeCosentinoSpecStringList,
} from "./sanitizeCosentinoSpec";
import { expandCatalogItemByThickness } from "./thicknessCm";

function asString(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function asOptionalString(v: unknown): string | undefined {
  const s = asString(v, "").trim();
  return s ? s : undefined;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

function uniqueLower(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeMovement(v: unknown): "low" | "medium" | "high" | undefined {
  const s = asString(v).trim().toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return undefined;
}

function pushMatches(out: string[], blob: string, synonyms: Record<string, string[]>): void {
  for (const [target, variants] of Object.entries(synonyms)) {
    if (variants.some((variant) => blob.includes(variant))) out.push(target);
  }
}

function deriveCatalogMetadata(input: {
  productName: string;
  displayName: string;
  material: string;
  category: string;
  collection: string;
  finish: string;
  notes: string;
  tags: string[];
}): Pick<
  CatalogItem,
  "colorFamilies" | "dominantColors" | "undertones" | "patternTags" | "movement" | "styleTags"
> {
  const blob = ` ${[
    input.productName,
    input.displayName,
    input.material,
    input.category,
    input.collection,
    input.finish,
    input.notes,
    input.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase()} `;

  const colorFamilies: string[] = [];
  pushMatches(colorFamilies, blob, {
    black: [" black", " ebony", " charcoal", " jet", " obsidian", " noir"],
    white: [" white", " ivory", " alabaster", " snow", " pearl"],
    brown: [" brown", " bronze", " mocha", " chocolate", " coffee", " espresso", " chestnut", " walnut", " umber"],
    beige: [" beige", " sand", " tan", " camel", " limestone"],
    cream: [" cream", " creamy", " vanilla"],
    gray: [" gray", " grey", " silver", " ash", " concrete"],
    gold: [" gold", " golden", " brass", " honey"],
    blue: [" blue", " navy", " azure"],
    green: [" green", " emerald", " olive", " sage"],
    taupe: [" taupe", " greige", " mushroom"],
  });

  const dominantColors: string[] = [];
  pushMatches(dominantColors, blob, {
    black: [" black", " ebony", " charcoal", " noir"],
    white: [" white", " ivory", " snow"],
    brown: [" brown", " mocha", " espresso", " chocolate", " coffee", " walnut"],
    beige: [" beige", " sand", " tan"],
    cream: [" cream", " vanilla"],
    gray: [" gray", " grey", " silver", " ash"],
    gold: [" gold", " golden", " honey"],
    blue: [" blue", " navy"],
    green: [" green", " olive", " sage"],
    taupe: [" taupe", " greige", " mushroom"],
  });

  const undertones: string[] = [];
  pushMatches(undertones, blob, {
    warm: [" warm", " gold", " golden", " beige", " cream", " brown", " bronze"],
    cool: [" cool", " blue", " gray", " grey", " silver", " icy"],
    neutral: [" neutral", " greige", " taupe"],
  });

  const patternTags: string[] = [];
  pushMatches(patternTags, blob, {
    veined: [" vein", " veined"],
    marbled: [" marble", " marbled", " calacatta", " carrara"],
    speckled: [" speck", "granite-look", "granular"],
    solid: [" solid", " uniform"],
    cloudy: [" cloud", " mist", " haze"],
    "concrete-look": [" concrete", "cement"],
  });

  const styleTags: string[] = [];
  pushMatches(styleTags, blob, {
    modern: [" modern", " contemporary", "minimal"],
    classic: [" classic", " timeless", " traditional"],
    luxury: [" luxury", " premium", " elegant"],
    bold: [" bold", " striking"],
    soft: [" soft", " subtle", " gentle"],
    dramatic: [" dramatic", " high-contrast"],
    natural: [" natural", " organic", " stone"],
  });

  let movement = normalizeMovement("");
  if (!movement) {
    if (/\b(heavy movement|dramatic|bold veining|high contrast)\b/i.test(blob)) movement = "high";
    else if (/\b(low movement|subtle|soft|uniform|solid)\b/i.test(blob)) movement = "low";
    else if (patternTags.length > 0) movement = "medium";
  }

  return {
    colorFamilies: uniqueLower(colorFamilies),
    dominantColors: uniqueLower(dominantColors),
    undertones: uniqueLower(undertones),
    patternTags: uniqueLower(patternTags),
    movement,
    styleTags: uniqueLower(styleTags),
  };
}

function normalizePriceEntry(raw: unknown, opts?: { cosentino?: boolean }): PriceEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  let label = asString(o.label ?? o.type ?? o.name, "");
  if (opts?.cosentino) {
    const cleaned = sanitizeCosentinoSpecString(label);
    if (cleaned) label = cleaned;
    else if (label && isCosentinoSpecGarbage(label)) label = "Price";
  }
  const price = parsePriceNumber(o.price ?? o.amount ?? o.value);
  const unitRaw = asString(o.unit ?? o.uom ?? o.per, "");
  const unit = normalizeUnit(unitRaw.toLowerCase());
  if (!label && price === null) return null;
  let peThickness = asString(o.thickness);
  let peSize = normalizeSlabSizeDisplay(asString(o.size));
  if (opts?.cosentino) {
    peThickness = sanitizeCosentinoSpecString(peThickness);
    peSize = normalizeSlabSizeDisplay(sanitizeCosentinoSpecString(peSize));
  }
  return {
    label: label || "Price",
    price,
    unit,
    thickness: peThickness,
    size: peSize,
    quantityRule: asString(o.quantityRule ?? o.qtyRule),
    sourceContext: asString(o.sourceContext ?? o.context),
  };
}

function normalizePriceEntries(raw: unknown, opts?: { cosentino?: boolean }): PriceEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PriceEntry[] = [];
  for (const r of raw) {
    const e = normalizePriceEntry(r, opts);
    if (e) out.push(e);
  }
  return out;
}

function normalizeIntegraGlue(raw: unknown): IntegraGlueEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: IntegraGlueEntry[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const glue = asString(o.glue);
    if (!glue) continue;
    const rank = typeof o.rank === "number" && Number.isFinite(o.rank) ? o.rank : out.length + 1;
    out.push({ rank, glue, form: asString(o.form) });
  }
  return out.length ? out : undefined;
}

function stableId(parts: (string | number)[]): string {
  return parts.join("|");
}

/** Local sync writes `/vendor-assets/cambria/...` but that folder is not deployed; use Cambria CDN URLs from scrape metadata when present. */
function cambriaImageUrlFromRaw(
  vendor: string,
  imageUrl: string | undefined,
  rawSourceFields: Record<string, unknown>
): string | undefined {
  if (vendor !== "Cambria" || !imageUrl?.startsWith("/vendor-assets/")) {
    return imageUrl;
  }
  const downloads = rawSourceFields.downloads;
  if (downloads && typeof downloads === "object") {
    const slab = (downloads as Record<string, unknown>).slabImage;
    if (typeof slab === "string" && /^https?:\/\//i.test(slab)) return slab;
  }
  const og = rawSourceFields.ogImage;
  if (typeof og === "string" && /^https?:\/\//i.test(og)) return og;
  return imageUrl;
}

function baseItemFromRaw(
  raw: Record<string, unknown>,
  index: number,
  defaultSource: string
): Omit<CatalogItem, "id" | "displayName" | "productName" | "priceEntries"> & {
  productName: string;
  displayName: string;
  priceEntries: PriceEntry[];
  integraGlue?: IntegraGlueEntry[];
} {
  const vendor = asString(raw.vendor ?? raw.distributor ?? raw.supplier, "Unknown");
  const sourceFile = asString(raw.sourceFile ?? raw.source ?? defaultSource);
  let productName = asString(raw.productName ?? raw.name ?? raw.title, "");
  let displayName = asString(raw.displayName, productName);
  if (vendor === "MSI") {
    productName = sanitizeMsiProductTitle(productName);
    displayName = sanitizeMsiProductTitle(displayName);
  }
  const rawFields =
    raw.rawSourceFields && typeof raw.rawSourceFields === "object"
      ? (raw.rawSourceFields as Record<string, unknown>)
      : {};

  const cosentino = vendor === "Cosentino";
  const peOpts = cosentino ? { cosentino: true as const } : undefined;

  const imageUrl = cambriaImageUrlFromRaw(
    vendor,
    asOptionalString(raw.imageUrl ?? raw.image ?? raw.heroImageUrl),
    rawFields
  );
  const tags = asStringArray(raw.tags);
  const derivedMetadata = deriveCatalogMetadata({
    productName,
    displayName,
    material: asString(raw.material ?? raw.productType),
    category: asString(raw.category ?? raw.type),
    collection: asString(raw.collection ?? raw.line ?? raw.series),
    finish: cosentino
      ? sanitizeCosentinoSpecString(asString(raw.finish ?? raw.surface))
      : asString(raw.finish ?? raw.surface),
    notes: asString(raw.notes ?? raw.note ?? raw.remarks),
    tags,
  });

  return {
    vendor,
    manufacturer: asString(raw.manufacturer ?? raw.mfr ?? raw.brand),
    sourceFile,
    sourceType: asOptionalString(raw.sourceType),
    sourceUrl: asOptionalString(raw.sourceUrl),
    productPageUrl: asOptionalString(raw.productPageUrl ?? raw.productUrl ?? raw.url),
    productName,
    displayName,
    material: asString(raw.material ?? raw.productType),
    category: asString(raw.category ?? raw.type),
    collection: asString(raw.collection ?? raw.line ?? raw.series),
    tierOrGroup: asString(raw.tierOrGroup ?? raw.tier ?? raw.group ?? raw.priceGroup),
    thickness: cosentino
      ? sanitizeCosentinoSpecString(asString(raw.thickness))
      : asString(raw.thickness),
    thicknesses: cosentino
      ? (() => {
          const a = sanitizeCosentinoSpecStringList(
            Array.isArray(raw.thicknesses) ? asStringArray(raw.thicknesses) : []
          );
          return a.length ? a : undefined;
        })()
      : Array.isArray(raw.thicknesses)
        ? asStringArray(raw.thicknesses)
        : undefined,
    finish: cosentino
      ? sanitizeCosentinoSpecString(asString(raw.finish ?? raw.surface))
      : asString(raw.finish ?? raw.surface),
    size: cosentino
      ? normalizeSlabSizeDisplay(sanitizeCosentinoSpecString(asString(raw.size ?? raw.dimensions ?? raw.slabSize)))
      : normalizeSlabSizeDisplay(asString(raw.size ?? raw.dimensions ?? raw.slabSize)),
    sizes: cosentino
      ? (() => {
          const a = sanitizeCosentinoSpecStringList(Array.isArray(raw.sizes) ? asStringArray(raw.sizes) : []);
          return a.length ? a : undefined;
        })()
      : Array.isArray(raw.sizes)
        ? asStringArray(raw.sizes)
        : undefined,
    sku: asString(raw.sku ?? raw.SKU ?? raw.code),
    vendorItemNumber: asString(raw.vendorItemNumber ?? raw.itemNumber ?? raw.vin),
    bundleNumber: asString(raw.bundleNumber ?? raw.bundle),
    priceEntries: normalizePriceEntries(raw.priceEntries ?? raw.prices, peOpts),
    imageUrl,
    galleryImages: asStringArray(raw.galleryImages ?? raw.images ?? raw.gallery),
    notes: asString(raw.notes ?? raw.note ?? raw.remarks),
    freightInfo: asString(raw.freightInfo ?? raw.freight ?? raw.shipping),
    availabilityFlags: asStringArray(raw.availabilityFlags ?? raw.flags),
    tags,
    colorFamilies: uniqueLower([
      ...asStringArray(raw.colorFamilies),
      ...derivedMetadata.colorFamilies,
    ]),
    dominantColors: uniqueLower([
      ...asStringArray(raw.dominantColors),
      ...derivedMetadata.dominantColors,
    ]),
    undertones: uniqueLower([
      ...asStringArray(raw.undertones),
      ...derivedMetadata.undertones,
    ]),
    patternTags: uniqueLower([
      ...asStringArray(raw.patternTags),
      ...derivedMetadata.patternTags,
    ]),
    movement: normalizeMovement(raw.movement) ?? derivedMetadata.movement,
    styleTags: uniqueLower([
      ...asStringArray(raw.styleTags),
      ...derivedMetadata.styleTags,
    ]),
    lastSeenAt: asOptionalString(raw.lastSeenAt),
    lastImageSyncAt: asOptionalString(raw.lastImageSyncAt),
    lastPriceSyncAt: asOptionalString(raw.lastPriceSyncAt),
    rawSourceFields: { ...rawFields, __importIndex: index },
    integraGlue: normalizeIntegraGlue(raw.integraGlue),
  };
}

function shouldExpandColors(raw: Record<string, unknown>): boolean {
  if (raw.expandCollectionColors === true || raw.hanStoneStyle === true) return true;
  const colors = raw.colors;
  return Array.isArray(colors) && colors.length > 0;
}

function colorRowsFromRaw(
  raw: Record<string, unknown>,
  base: ReturnType<typeof baseItemFromRaw>,
  index: number
): CatalogItem[] {
  const colors = asStringArray(raw.colors);
  const collection = base.collection || asString(raw.collection);
  const vendor = base.vendor;
  const sourceFile = base.sourceFile;
  const suffix = `${vendor}|${sourceFile}|${collection}|${index}`;

  return colors.map((color, ci) => {
    const colorPart = color.trim();
    const displayName =
      vendor === "HanStone Quartz" && base.tags?.some((t) => t.toLowerCase() === "pdf-import")
        ? colorPart || base.displayName
        : collection
          ? `${collection} — ${colorPart}`
          : colorPart || base.displayName;
    const productName = colorPart || base.productName;
    const id =
      asString(raw.id) ||
      stableId(["color", suffix, ci, colorPart, productName]);
    return {
      id,
      ...base,
      productName,
      displayName,
      collection,
      priceEntries: base.priceEntries.length
        ? base.priceEntries.map((p) => ({ ...p }))
        : normalizePriceEntries(raw.priceEntries ?? raw.prices, vendor === "Cosentino" ? { cosentino: true } : undefined),
      rawSourceFields: {
        ...base.rawSourceFields,
        expandedFromCollection: true,
        color: colorPart,
      },
    };
  });
}

function singleRowFromRaw(
  raw: Record<string, unknown>,
  base: ReturnType<typeof baseItemFromRaw>,
  index: number
): CatalogItem {
  const vendor = base.vendor;
  const sourceFile = base.sourceFile;
  const sku = base.sku;
  const productName = base.productName;
  const id =
    asString(raw.id) ||
    stableId([vendor, sourceFile, sku, productName, index]);

  return {
    id,
    ...base,
  };
}

function parseImportWarnings(raw: unknown): ImportWarning[] {
  if (!Array.isArray(raw)) return [];
  const out: ImportWarning[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    const message = asString(o.message ?? o.msg ?? o.text);
    if (!message) continue;
    const sev = asString(o.severity, "warning").toLowerCase();
    const severity =
      sev === "error" || sev === "warning" || sev === "info" ? sev : "warning";
    out.push({
      sourceFile: asString(o.sourceFile ?? o.file),
      severity,
      message,
      rowIndex:
        typeof o.rowIndex === "number" ? o.rowIndex : undefined,
    });
  }
  return out;
}

/**
 * Accepts multiple JSON shapes: `{ items }`, `{ catalog: { items } }`, `{ products }`, or a bare array.
 * Expands HanStone-style rows when `colors[]` is present or `expandCollectionColors` / `hanStoneStyle` is true.
 */
export function normalizeCatalogData(rawJson: unknown, defaultSource = "catalog.json"): NormalizedCatalog {
  const importWarnings: ImportWarning[] = [];
  let payload: unknown = rawJson;

  if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
    const root = rawJson as Record<string, unknown>;
    if (Array.isArray(root.importWarnings)) {
      importWarnings.push(...parseImportWarnings(root.importWarnings));
    }
    if (root.catalog && typeof root.catalog === "object") {
      const c = root.catalog as Record<string, unknown>;
      if (Array.isArray(c.importWarnings)) {
        importWarnings.push(...parseImportWarnings(c.importWarnings));
      }
      payload = c.items ?? c.products ?? c.rows ?? root.items ?? root.products;
    } else {
      payload = root.items ?? root.products ?? root.rows ?? root.data;
    }
  }

  if (!Array.isArray(payload)) {
    importWarnings.push({
      severity: "error",
      message: "Catalog JSON must contain an array of items (e.g. items, products, or a top-level array).",
      sourceFile: defaultSource,
    });
    return { items: [], importWarnings };
  }

  const items: CatalogItem[] = [];

  payload.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      importWarnings.push({
        severity: "warning",
        message: `Skipped non-object row at index ${index}.`,
        sourceFile: defaultSource,
        rowIndex: index,
      });
      return;
    }
    const raw = row as Record<string, unknown>;
    const base = baseItemFromRaw(raw, index, defaultSource);

    if (!base.productName && !base.displayName && !shouldExpandColors(raw)) {
      importWarnings.push({
        severity: "warning",
        message: "Skipped row with no product name.",
        sourceFile: base.sourceFile,
        rowIndex: index,
      });
      return;
    }

    if (shouldExpandColors(raw)) {
      const expanded = colorRowsFromRaw(raw, base, index);
      if (expanded.length === 0) {
        items.push(singleRowFromRaw(raw, base, index));
      } else {
        items.push(...expanded);
      }
    } else {
      items.push(singleRowFromRaw(raw, base, index));
    }
  });

  const expanded = items.flatMap((it) => expandCatalogItemByThickness(it));

  return { items: expanded, importWarnings };
}
