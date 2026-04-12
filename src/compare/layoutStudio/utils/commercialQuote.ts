import {
  DEFAULT_LAYOUT_QUOTE_SETTINGS,
  type JobComparisonOptionRecord,
  type JobRecord,
  type LayoutQuoteCustomerRowId,
  type LayoutQuoteSettings,
} from "../../../types/compareQuote";
import type { LayoutSlab } from "../types";
import { FALLBACK_SLAB_HEIGHT_IN, FALLBACK_SLAB_WIDTH_IN } from "./slabDimensions";
import {
  fabricationForMaterialSqft,
  QUOTED_MATERIAL_MARKUP,
} from "../../../utils/quotedPrice";

export type CommercialQuoteBreakdown = {
  materialTotal: number;
  fabricationTotal: number;
  sinkAddOnTotal: number;
  splashAddOnTotal: number;
  profileAddOnTotal: number;
  miterAddOnTotal: number;
  grandTotal: number;
  /** Effective fabrication $/sq ft (countertop pieces). */
  fabricationPerSqft: number;
  /** Catalog material $/sq ft used for schedule (when applicable). */
  catalogMaterialPerSqft: number | null;
  /** Sq ft basis for material charge this run. */
  materialAreaSqFt: number;
  countertopSqFt: number;
  materialChargeMode: LayoutQuoteSettings["materialChargeMode"];
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

export function mergeLayoutQuoteSettings(job: JobRecord): LayoutQuoteSettings {
  const raw = job.layoutQuoteSettings;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LAYOUT_QUOTE_SETTINGS };
  const materialMarkup =
    typeof raw.materialMarkup === "number" && Number.isFinite(raw.materialMarkup) && raw.materialMarkup > 0
      ? raw.materialMarkup
      : DEFAULT_LAYOUT_QUOTE_SETTINGS.materialMarkup;
  const fabricationPerSqftOverride =
    typeof raw.fabricationPerSqftOverride === "number" && Number.isFinite(raw.fabricationPerSqftOverride) && raw.fabricationPerSqftOverride >= 0
      ? raw.fabricationPerSqftOverride
      : null;
  const sinkCutoutEach =
    typeof raw.sinkCutoutEach === "number" && Number.isFinite(raw.sinkCutoutEach) && raw.sinkCutoutEach >= 0
      ? raw.sinkCutoutEach
      : 0;
  const splashPerSqft =
    typeof raw.splashPerSqft === "number" && Number.isFinite(raw.splashPerSqft) && raw.splashPerSqft >= 0
      ? raw.splashPerSqft
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
  return {
    materialMarkup,
    fabricationPerSqftOverride,
    sinkCutoutEach,
    splashPerSqft,
    profilePerLf,
    miterPerLf,
    materialChargeMode,
  };
}

/**
 * Installed-style commercial breakdown for Layout Studio: material (with optional full-slab billing),
 * fabrication on countertop sq ft only, plus sink / splash / profile add-ons.
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
  let materialAreaSqFt = usedSf;

  if (unit === "sqft") {
    const perSqftMarked = catalogLinePrice * markup;
    if (settings.materialChargeMode === "sqft_used") {
      materialAreaSqFt = usedSf;
      materialTotal = usedSf * perSqftMarked;
    } else {
      const oneSlabSf = slabAreaSqFt(slabs);
      materialAreaSqFt = slabsN * oneSlabSf;
      materialTotal = materialAreaSqFt * catalogLinePrice * markup;
    }
  } else if (unit === "slab") {
    if (usedSf > 0 && catalogMaterialPerSqft != null) {
      const materialPerSqftMarked = catalogMaterialPerSqft * markup;
      if (settings.materialChargeMode === "sqft_used") {
        materialAreaSqFt = usedSf;
        materialTotal = usedSf * materialPerSqftMarked;
      } else {
        materialTotal = catalogLinePrice * slabsN * markup;
        const oneSlabSf = slabAreaSqFt(slabs);
        materialAreaSqFt = slabsN * oneSlabSf;
      }
    } else {
      materialTotal = catalogLinePrice * slabsN * markup;
      materialAreaSqFt = slabsN * slabAreaSqFt(slabs);
    }
  } else {
    return null;
  }

  const fabricationTotal = ctSf * fabPerSqft;
  const sinkAddOnTotal = Math.max(0, sinkCount) * settings.sinkCutoutEach;
  const splashAddOnTotal = splashSf * settings.splashPerSqft;
  const profileAddOnTotal = Math.max(0, profileEdgeLf) * settings.profilePerLf;
  const miterAddOnTotal = Math.max(0, miterEdgeLf) * settings.miterPerLf;

  const grandTotal =
    materialTotal +
    fabricationTotal +
    sinkAddOnTotal +
    splashAddOnTotal +
    profileAddOnTotal +
    miterAddOnTotal;

  return {
    materialTotal,
    fabricationTotal,
    sinkAddOnTotal,
    splashAddOnTotal,
    profileAddOnTotal,
    miterAddOnTotal,
    grandTotal,
    fabricationPerSqft: fabPerSqft,
    catalogMaterialPerSqft,
    materialAreaSqFt,
    countertopSqFt: ctSf,
    materialChargeMode: settings.materialChargeMode,
  };
}
