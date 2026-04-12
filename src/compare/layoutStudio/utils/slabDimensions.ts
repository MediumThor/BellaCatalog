import type { JobComparisonOptionRecord } from "../../../types/compareQuote";
import type { LayoutSlab } from "../types";

const DIM_PAIR = /(\d+(?:\.\d+)?)\s*["']?\s*[x×]\s*(\d+(?:\.\d+)?)\s*["']?/i;
const DIM_PAIR_CM = /(\d+(?:\.\d+)?)\s*cm\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/i;

/** Default slab when size string cannot be parsed (typical quartz slab, inches). */
export const FALLBACK_SLAB_WIDTH_IN = 120;
export const FALLBACK_SLAB_HEIGHT_IN = 56;

const CM_PER_IN = 2.54;

function orientLandscape(widthIn: number, heightIn: number): { widthIn: number; heightIn: number } {
  const hi = Math.max(widthIn, heightIn);
  const lo = Math.min(widthIn, heightIn);
  return { widthIn: hi, heightIn: lo };
}

/**
 * Parse "126 x 63", `126" × 63"`, `3200 cm x 1600 cm`, etc. into inches (long edge = width).
 */
export function parseSizeToInchesPair(raw: string | null | undefined): {
  widthIn: number;
  heightIn: number;
  parsed: boolean;
} {
  const s = (raw ?? "").trim();
  if (!s) {
    return { widthIn: FALLBACK_SLAB_WIDTH_IN, heightIn: FALLBACK_SLAB_HEIGHT_IN, parsed: false };
  }

  const cm = s.match(DIM_PAIR_CM);
  if (cm) {
    const n1 = parseFloat(cm[1]);
    const n2 = parseFloat(cm[2]);
    if (Number.isFinite(n1) && Number.isFinite(n2) && n1 > 0 && n2 > 0) {
      const w = n1 / CM_PER_IN;
      const h = n2 / CM_PER_IN;
      return { ...orientLandscape(w, h), parsed: true };
    }
  }

  const m = s.match(DIM_PAIR);
  if (!m) {
    return { widthIn: FALLBACK_SLAB_WIDTH_IN, heightIn: FALLBACK_SLAB_HEIGHT_IN, parsed: false };
  }
  const n1 = parseFloat(m[1]);
  const n2 = parseFloat(m[2]);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) {
    return { widthIn: FALLBACK_SLAB_WIDTH_IN, heightIn: FALLBACK_SLAB_HEIGHT_IN, parsed: false };
  }
  return { ...orientLandscape(n1, n2), parsed: true };
}

/**
 * When catalog size is missing or unknown, match the slab photo’s aspect ratio so the placement
 * rectangle matches the real slab face (long edge = nominal width fallback).
 */
export function applyRealisticSlabDimensions(
  slab: LayoutSlab,
  natural: { w: number; h: number } | null | undefined
): LayoutSlab {
  if (slab.sizeFromSpec) return slab;
  if (!natural || natural.w <= 0 || natural.h <= 0) return slab;
  const ar = natural.w / natural.h;
  const long = Math.max(FALLBACK_SLAB_WIDTH_IN, FALLBACK_SLAB_HEIGHT_IN);
  let widthIn: number;
  let heightIn: number;
  if (ar >= 1) {
    widthIn = long;
    heightIn = long / ar;
  } else {
    heightIn = long;
    widthIn = long * ar;
  }
  return { ...slab, widthIn, heightIn };
}

/**
 * Build normalized slab list for the option. V1: primary slab from option snapshot + image.
 */
export function slabsForOption(option: JobComparisonOptionRecord): LayoutSlab[] {
  const { widthIn, heightIn, parsed } = parseSizeToInchesPair(option.size);
  const imageUrl = option.imageUrl?.trim() || "";
  if (!imageUrl) {
    return [];
  }
  return [
    {
      id: `${option.id}-slab-0`,
      imageUrl,
      label: option.productName || "Slab",
      widthIn,
      heightIn,
      sizeFromSpec: parsed,
    },
  ];
}
