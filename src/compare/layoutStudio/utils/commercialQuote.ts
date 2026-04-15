import {
  DEFAULT_LAYOUT_QUOTE_SETTINGS,
  type JobComparisonOptionRecord,
  type JobRecord,
  type LayoutQuoteCustomerRowId,
  type LayoutQuoteSettings,
  type MaterialChargeMode,
} from "../../../types/compareQuote";
import type { LayoutPiece, LayoutSlab, PiecePlacement } from "../types";
import { FALLBACK_SLAB_HEIGHT_IN, FALLBACK_SLAB_WIDTH_IN } from "./slabDimensions";
import {
  fabricationForMaterialSqft,
  QUOTED_MATERIAL_MARKUP,
} from "../../../utils/quotedPrice";
import { polygonArea } from "./geometry";
import { pieceHasArcEdges, polygonAreaWithArcEdges } from "./blankPlanEdgeArc";
import { piecePixelsPerInch } from "./sourcePages";

export type CommercialQuoteBreakdown = {
  materialTotal: number;
  rawMaterialTotal: number;
  fabricationTotal: number;
  installationTotal: number;
  sinkAddOnTotal: number;
  splashAddOnTotal: number;
  profileAddOnTotal: number;
  miterAddOnTotal: number;
  grandTotal: number;
  /** Effective fabrication $/sq ft (fabricated area: pieces + splash). */
  fabricationPerSqft: number;
  /** Catalog material $/sq ft used for schedule (when applicable). */
  catalogMaterialPerSqft: number | null;
  /** Sq ft basis for material charge this run. */
  materialAreaSqFt: number;
  countertopSqFt: number;
  fabricatedSqFt: number;
  splashLinearFeet: number;
  materialChargeMode: LayoutQuoteSettings["materialChargeMode"];
};

export type SlabMaterialQuoteLine = {
  slabId: string;
  slabLabel: string;
  pieceCount: number;
  mode: MaterialChargeMode;
  usedAreaSqFt: number;
  billedAreaSqFt: number;
  slabAreaSqFt: number;
  rawMaterialTotal: number;
  materialTotal: number;
};

export type QuoteAnalyticsSummary = {
  slabCostTotal: number | null;
  slabCostPerSqft: number | null;
  sellPerSqft: number | null;
  materialMarkupProfit: number | null;
  fabricationProfit: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  slabsUsedCount: number;
  revenuePerSlab: number | null;
  utilizationPct: number | null;
};

const CUSTOMER_ROW_IDS: LayoutQuoteCustomerRowId[] = [
  "materialOption",
  "vendorManufacturer",
  "layoutArea",
  "profileEdge",
  "miterEdge",
  "slabCount",
  "sinks",
  "splashArea",
  "materialCost",
  "fabrication",
  "installation",
  "sinkCutouts",
  "splashAddOn",
  "profileAddOn",
  "miterAddOn",
  "installedEstimate",
  "perSqFt",
];

/** Full row map; `true` = exclude from customer quote. */
export function mergeCustomerExclusions(job: JobRecord): Record<LayoutQuoteCustomerRowId, boolean> {
  const out = {} as Record<LayoutQuoteCustomerRowId, boolean>;
  for (const id of CUSTOMER_ROW_IDS) out[id] = false;
  const raw = job.layoutQuoteCustomerExclusions;
  if (raw && typeof raw === "object") {
    for (const id of CUSTOMER_ROW_IDS) {
      if (raw[id] === true) out[id] = true;
    }
  }
  return out;
}

/** Customer-facing total: sum of monetary lines not excluded. */
export function customerQuoteTotalFromBreakdown(
  commercial: CommercialQuoteBreakdown,
  ex: Record<LayoutQuoteCustomerRowId, boolean>
): number {
  let t = 0;
  if (!ex.materialCost) t += commercial.materialTotal;
  if (!ex.fabrication) t += commercial.fabricationTotal;
  if (!ex.installation) t += commercial.installationTotal;
  if (!ex.sinkCutouts) t += commercial.sinkAddOnTotal;
  if (!ex.splashAddOn) t += commercial.splashAddOnTotal;
  if (!ex.profileAddOn) t += commercial.profileAddOnTotal;
  if (!ex.miterAddOn) t += commercial.miterAddOnTotal;
  return t;
}

function slabAreaSqFt(slabs: LayoutSlab[]): number {
  const s = slabs[0];
  if (!s) return (FALLBACK_SLAB_WIDTH_IN * FALLBACK_SLAB_HEIGHT_IN) / 144;
  return (s.widthIn * s.heightIn) / 144;
}

function slabAreaSqFtFromSlab(slab: LayoutSlab): number {
  return Math.max(0, (slab.widthIn * slab.heightIn) / 144);
}

function supplierSqftMaterialTotal(args: {
  catalogLinePrice: number;
  slabAreaSqFt: number;
  usedAreaSqFt: number;
}): number {
  const supplierAreaSqFt = args.slabAreaSqFt > 0 ? args.slabAreaSqFt : args.usedAreaSqFt;
  return supplierAreaSqFt * args.catalogLinePrice;
}

export function slabChargeModeKey(optionId: string, slabId: string): string {
  return `${optionId}:${slabId}`;
}

export function slabChargeModeForSettings(
  settings: LayoutQuoteSettings,
  optionId: string,
  slabId: string,
): MaterialChargeMode {
  return settings.slabChargeModes?.[slabChargeModeKey(optionId, slabId)] ?? settings.materialChargeMode;
}

function pieceAreaSqFt(piece: LayoutPiece, fallbackPixelsPerInch?: number | null): number {
  const ppi = piecePixelsPerInch(piece, fallbackPixelsPerInch);
  if (!ppi || piece.points.length < 3) return 0;
  const areaPx = pieceHasArcEdges(piece)
    ? polygonAreaWithArcEdges(piece)
    : polygonArea(piece.points);
  return areaPx / (ppi * ppi) / 144;
}

function splashLinearFeetFromPieces(pieces: LayoutPiece[], fallbackPixelsPerInch?: number | null): number {
  return pieces.reduce((sum, piece) => {
    if (piece.pieceRole !== "splash") return sum;
    const rawHeightIn = piece.splashMeta?.heightIn;
    const heightIn = typeof rawHeightIn === "number" && Number.isFinite(rawHeightIn) ? rawHeightIn : null;
    if (heightIn == null || heightIn <= 0) return sum;
    const pieceSqFt = pieceAreaSqFt(piece, fallbackPixelsPerInch);
    const linearFeet = (pieceSqFt * 144) / heightIn / 12;
    return sum + linearFeet;
  }, 0);
}

export function computeSlabMaterialQuoteLines(input: {
  option: JobComparisonOptionRecord;
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
  slabs: LayoutSlab[];
  settings: LayoutQuoteSettings;
}): SlabMaterialQuoteLine[] | null {
  const { option, pieces, placements, pixelsPerInch, slabs, settings } = input;
  const catalogLinePrice = option.selectedPriceValue;
  if (catalogLinePrice == null || !Number.isFinite(catalogLinePrice)) {
    return null;
  }
  const unit = (option.priceUnit ?? "").trim();
  if (unit !== "sqft" && unit !== "slab") {
    return null;
  }
  const markup = settings.materialMarkup > 0 ? settings.materialMarkup : QUOTED_MATERIAL_MARKUP;
  const piecesById = new Map(pieces.map((piece) => [piece.id, piece]));
  return slabs
    .map((slab) => {
      const slabPlacements = placements.filter((placement) => placement.placed && placement.slabId === slab.id);
      if (!slabPlacements.length) return null;
      const usedAreaSqFtRaw = slabPlacements.reduce((sum, placement) => {
        const piece = piecesById.get(placement.pieceId);
        return sum + (piece ? pieceAreaSqFt(piece, pixelsPerInch) : 0);
      }, 0);
      const slabArea = slabAreaSqFtFromSlab(slab);
      const usedAreaSqFt =
        slabArea > 0
          ? Math.min(Math.max(0, usedAreaSqFtRaw), slabArea)
          : Math.max(0, usedAreaSqFtRaw);
      const mode = slabChargeModeForSettings(settings, option.id, slab.id);
      const billedAreaSqFt = mode === "full_slab" ? slabArea : usedAreaSqFt;
      let rawMaterialTotal = 0;
      let materialTotal = 0;
      if (unit === "sqft") {
        // Supplier cost follows the full slab consumed, even if the customer is billed on used sqft.
        rawMaterialTotal = supplierSqftMaterialTotal({
          catalogLinePrice,
          slabAreaSqFt: slabArea,
          usedAreaSqFt,
        });
        materialTotal = billedAreaSqFt * catalogLinePrice * markup;
      } else if (slabArea > 0) {
        const ratio = mode === "full_slab" ? 1 : billedAreaSqFt / slabArea;
        rawMaterialTotal = catalogLinePrice;
        materialTotal = catalogLinePrice * ratio * markup;
      } else {
        rawMaterialTotal = catalogLinePrice;
        materialTotal = catalogLinePrice * markup;
      }
      return {
        slabId: slab.id,
        slabLabel: slab.label,
        pieceCount: slabPlacements.length,
        mode,
        usedAreaSqFt: Math.round(usedAreaSqFt * 100) / 100,
        billedAreaSqFt: Math.round(billedAreaSqFt * 100) / 100,
        slabAreaSqFt: Math.round(slabArea * 100) / 100,
        rawMaterialTotal,
        materialTotal,
      } satisfies SlabMaterialQuoteLine;
    })
    .filter((line): line is SlabMaterialQuoteLine => line != null);
}

export function mergeLayoutQuoteSettings(job: JobRecord): LayoutQuoteSettings {
  const raw = job.layoutQuoteSettings;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LAYOUT_QUOTE_SETTINGS };
  const rawRecord = raw as unknown as Record<string, unknown>;
  const materialMarkup =
    typeof raw.materialMarkup === "number" && Number.isFinite(raw.materialMarkup) && raw.materialMarkup > 0
      ? raw.materialMarkup
      : DEFAULT_LAYOUT_QUOTE_SETTINGS.materialMarkup;
  const fabricationPerSqftOverride =
    typeof raw.fabricationPerSqftOverride === "number" && Number.isFinite(raw.fabricationPerSqftOverride) && raw.fabricationPerSqftOverride >= 0
      ? raw.fabricationPerSqftOverride
      : null;
  const installationPerSqft =
    typeof raw.installationPerSqft === "number" && Number.isFinite(raw.installationPerSqft) && raw.installationPerSqft >= 0
      ? raw.installationPerSqft
      : 0;
  const sinkCutoutEach =
    typeof raw.sinkCutoutEach === "number" && Number.isFinite(raw.sinkCutoutEach) && raw.sinkCutoutEach >= 0
      ? raw.sinkCutoutEach
      : 0;
  const splashPerLf =
    typeof rawRecord.splashPerLf === "number" && Number.isFinite(rawRecord.splashPerLf) && rawRecord.splashPerLf >= 0
      ? rawRecord.splashPerLf
      : typeof rawRecord.splashPerSqft === "number" &&
          Number.isFinite(rawRecord.splashPerSqft) &&
          rawRecord.splashPerSqft >= 0
        ? rawRecord.splashPerSqft
      : 0;
  const profilePerLf =
    typeof raw.profilePerLf === "number" && Number.isFinite(raw.profilePerLf) && raw.profilePerLf >= 0
      ? raw.profilePerLf
      : 0;
  const miterPerLf =
    typeof raw.miterPerLf === "number" && Number.isFinite(raw.miterPerLf) && raw.miterPerLf >= 0
      ? raw.miterPerLf
      : 0;
  const materialChargeMode =
    raw.materialChargeMode === "full_slab" || raw.materialChargeMode === "sqft_used"
      ? raw.materialChargeMode
      : DEFAULT_LAYOUT_QUOTE_SETTINGS.materialChargeMode;
  const slabChargeModes =
    raw.slabChargeModes && typeof raw.slabChargeModes === "object"
      ? Object.entries(raw.slabChargeModes as Record<string, unknown>).reduce<Record<string, MaterialChargeMode>>(
          (acc, [key, value]) => {
            if (value === "full_slab" || value === "sqft_used") {
              acc[key] = value;
            }
            return acc;
          },
          {},
        )
      : {};
  return {
    materialMarkup,
    fabricationPerSqftOverride,
    installationPerSqft,
    sinkCutoutEach,
    splashPerLf,
    profilePerLf,
    miterPerLf,
    materialChargeMode,
    slabChargeModes,
  };
}

/**
 * Installed-style commercial breakdown for Layout Studio: material (with optional full-slab billing),
 * fabrication and installation on fabricated sq ft (pieces + splash), plus sink / splash / profile add-ons.
 */
export function computeCommercialLayoutQuote(input: {
  option: JobComparisonOptionRecord;
  jobSquareFootage: number;
  countertopSqFt: number;
  splashAreaSqFt: number;
  sinkCount: number;
  profileEdgeLf: number;
  miterEdgeLf: number;
  slabCount: number;
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
  slabs: LayoutSlab[];
  settings: LayoutQuoteSettings;
}): CommercialQuoteBreakdown | null {
  const {
    option,
    jobSquareFootage,
    countertopSqFt,
    splashAreaSqFt,
    sinkCount,
    profileEdgeLf,
    miterEdgeLf,
    slabCount,
    pieces,
    placements,
    pixelsPerInch,
    slabs,
    settings,
  } = input;

  const catalogLinePrice = option.selectedPriceValue;
  if (catalogLinePrice == null || !Number.isFinite(catalogLinePrice)) {
    return null;
  }

  const unit = (option.priceUnit ?? "").trim();
  const markup = settings.materialMarkup > 0 ? settings.materialMarkup : QUOTED_MATERIAL_MARKUP;
  const slabsN = Math.max(1, slabCount > 0 ? slabCount : 1);
  const usedSf = Number.isFinite(jobSquareFootage) && jobSquareFootage > 0 ? jobSquareFootage : 0;
  const ctSf = Math.max(0, Number.isFinite(countertopSqFt) ? countertopSqFt : 0);
  const splashSf = Math.max(0, Number.isFinite(splashAreaSqFt) ? splashAreaSqFt : 0);
  const fabricatedSf = ctSf + splashSf;
  const splashLf = splashLinearFeetFromPieces(pieces, pixelsPerInch);
  const installationPerSqft =
    Number.isFinite(settings.installationPerSqft) && settings.installationPerSqft >= 0
      ? settings.installationPerSqft
      : 0;

  let catalogMaterialPerSqft: number | null = null;

  if (unit === "sqft") {
    catalogMaterialPerSqft = catalogLinePrice;
  } else if (unit === "slab" && usedSf > 0) {
    catalogMaterialPerSqft = (catalogLinePrice * slabsN) / usedSf;
  } else if (unit === "slab") {
    catalogMaterialPerSqft = null;
  }

  const scheduleMaterial = catalogMaterialPerSqft ?? catalogLinePrice;

  const fabPerSqft =
    settings.fabricationPerSqftOverride != null && Number.isFinite(settings.fabricationPerSqftOverride)
      ? settings.fabricationPerSqftOverride
      : fabricationForMaterialSqft(scheduleMaterial);

  let materialTotal = 0;
  let rawMaterialTotal = 0;
  let materialAreaSqFt = usedSf;

  const slabQuoteLines = computeSlabMaterialQuoteLines({
    option,
    pieces,
    placements,
    pixelsPerInch,
    slabs,
    settings,
  });

  if (slabQuoteLines && slabQuoteLines.length > 0) {
    rawMaterialTotal = slabQuoteLines.reduce((sum, line) => sum + line.rawMaterialTotal, 0);
    materialTotal = slabQuoteLines.reduce((sum, line) => sum + line.materialTotal, 0);
    materialAreaSqFt = slabQuoteLines.reduce((sum, line) => sum + line.billedAreaSqFt, 0);
    if (unit === "sqft") {
      catalogMaterialPerSqft = catalogLinePrice;
    } else {
      const billedSqFt = slabQuoteLines.reduce((sum, line) => sum + line.billedAreaSqFt, 0);
      catalogMaterialPerSqft =
        billedSqFt > 0
          ? slabQuoteLines.reduce((sum, line) => {
              const baseTotal = line.materialTotal / markup;
              return sum + baseTotal;
            }, 0) / billedSqFt
          : null;
    }
  } else if (unit === "sqft") {
    const perSqftMarked = catalogLinePrice * markup;
    const oneSlabSf = slabAreaSqFt(slabs);
    const supplierMaterialAreaSqFt = slabsN * oneSlabSf;
    rawMaterialTotal = supplierSqftMaterialTotal({
      catalogLinePrice,
      slabAreaSqFt: supplierMaterialAreaSqFt,
      usedAreaSqFt: usedSf,
    });
    if (settings.materialChargeMode === "sqft_used") {
      materialAreaSqFt = usedSf;
      materialTotal = usedSf * perSqftMarked;
    } else {
      materialAreaSqFt = slabsN * oneSlabSf;
      materialTotal = materialAreaSqFt * catalogLinePrice * markup;
    }
  } else if (unit === "slab") {
    if (usedSf > 0 && catalogMaterialPerSqft != null) {
      const materialPerSqftMarked = catalogMaterialPerSqft * markup;
      if (settings.materialChargeMode === "sqft_used") {
        materialAreaSqFt = usedSf;
        rawMaterialTotal = usedSf * catalogMaterialPerSqft;
        materialTotal = usedSf * materialPerSqftMarked;
      } else {
        rawMaterialTotal = catalogLinePrice * slabsN;
        materialTotal = catalogLinePrice * slabsN * markup;
        const oneSlabSf = slabAreaSqFt(slabs);
        materialAreaSqFt = slabsN * oneSlabSf;
      }
    } else {
      rawMaterialTotal = catalogLinePrice * slabsN;
      materialTotal = catalogLinePrice * slabsN * markup;
      materialAreaSqFt = slabsN * slabAreaSqFt(slabs);
    }
  } else {
    return null;
  }

  const fabricationTotal = fabricatedSf * fabPerSqft;
  const installationTotal = fabricatedSf * installationPerSqft;
  const sinkAddOnTotal = Math.max(0, sinkCount) * settings.sinkCutoutEach;
  const splashAddOnTotal = splashLf * settings.splashPerLf;
  const profileAddOnTotal = Math.max(0, profileEdgeLf) * settings.profilePerLf;
  const miterAddOnTotal = Math.max(0, miterEdgeLf) * settings.miterPerLf;

  const grandTotal =
    materialTotal +
    fabricationTotal +
    installationTotal +
    sinkAddOnTotal +
    splashAddOnTotal +
    profileAddOnTotal +
    miterAddOnTotal;

  return {
    materialTotal,
    rawMaterialTotal,
    fabricationTotal,
    installationTotal,
    sinkAddOnTotal,
    splashAddOnTotal,
    profileAddOnTotal,
    miterAddOnTotal,
    grandTotal,
    fabricationPerSqft: fabPerSqft,
    catalogMaterialPerSqft,
    materialAreaSqFt,
    countertopSqFt: ctSf,
    fabricatedSqFt: fabricatedSf,
    splashLinearFeet: splashLf,
    materialChargeMode: settings.materialChargeMode,
  };
}

export function computeQuoteAnalytics(input: {
  commercial: CommercialQuoteBreakdown | null;
  customerTotal: number | null;
  quoteAreaSqFt: number;
  slabQuoteLines: SlabMaterialQuoteLine[];
}): QuoteAnalyticsSummary {
  const { commercial, customerTotal, quoteAreaSqFt, slabQuoteLines } = input;
  const slabCostTotal = commercial?.rawMaterialTotal ?? null;
  const slabCostPerSqft =
    slabCostTotal != null && quoteAreaSqFt > 0 ? slabCostTotal / quoteAreaSqFt : null;
  const sellPerSqft =
    customerTotal != null && quoteAreaSqFt > 0 ? customerTotal / quoteAreaSqFt : null;
  const materialMarkupProfit =
    commercial != null ? commercial.materialTotal - commercial.rawMaterialTotal : null;
  const fabricationProfit = commercial?.fabricationTotal ?? null;
  const grossProfit =
    customerTotal != null && slabCostTotal != null ? customerTotal - slabCostTotal : null;
  const grossMarginPct =
    grossProfit != null && customerTotal != null && customerTotal !== 0
      ? (grossProfit / customerTotal) * 100
      : null;
  const slabsUsedCount = slabQuoteLines.length;
  const revenuePerSlab =
    customerTotal != null && slabsUsedCount > 0 ? customerTotal / slabsUsedCount : null;
  const totalUsedSqFt = slabQuoteLines.reduce((sum, line) => sum + line.usedAreaSqFt, 0);
  const totalSlabSqFt = slabQuoteLines.reduce((sum, line) => sum + line.slabAreaSqFt, 0);
  const utilizationPct =
    totalSlabSqFt > 0 ? (totalUsedSqFt / totalSlabSqFt) * 100 : null;
  return {
    slabCostTotal,
    slabCostPerSqft,
    sellPerSqft,
    materialMarkupProfit,
    fabricationProfit,
    grossProfit,
    grossMarginPct,
    slabsUsedCount,
    revenuePerSlab,
    utilizationPct,
  };
}
