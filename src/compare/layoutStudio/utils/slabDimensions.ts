import type { JobComparisonOptionRecord } from "../../../types/compareQuote";
import type { LayoutSlab } from "../types";
import { corsSafeImageUrl } from "../../../utils/renderableImageUrl";

const DIM_PAIR = /(\d+(?:\.\d+)?)\s*["']?\s*[x×]\s*(\d+(?:\.\d+)?)\s*["']?/i;
const DIM_PAIR_CM = /(\d+(?:\.\d+)?)\s*cm\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/i;
const IMAGE_STRING_KEYS = [
  "imageUrl",
  "image",
  "heroImageUrl",
  "ogImage",
  "thumbnailUrl",
  "thumbnail",
  "src",
] as const;
const IMAGE_ARRAY_KEYS = ["galleryImages", "images", "gallery", "imageUrls"] as const;

/** Default slab when size string cannot be parsed (typical quartz slab, inches). */
export const FALLBACK_SLAB_WIDTH_IN = 120;
export const FALLBACK_SLAB_HEIGHT_IN = 56;

const CM_PER_IN = 2.54;
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function pushImageCandidate(out: string[], value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) out.push(trimmed);
}

function pushImageCandidates(out: string[], value: unknown): void {
  if (typeof value === "string") {
    pushImageCandidate(out, value);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const item of value) pushImageCandidate(out, item);
}

function collectImageCandidatesFromRecord(out: string[], record: UnknownRecord | null): void {
  if (!record) return;
  for (const key of IMAGE_STRING_KEYS) pushImageCandidate(out, record[key]);
  for (const key of IMAGE_ARRAY_KEYS) pushImageCandidates(out, record[key]);
}

function resolveOptionSlabImageUrl(option: JobComparisonOptionRecord): string {
  const snapshot = asRecord(option.snapshotData);
  const rawSourceFields = asRecord(snapshot?.["rawSourceFields"]);
  const liveInventory = asRecord(snapshot?.["liveInventory"]);
  const candidates: string[] = [];
  pushImageCandidate(candidates, option.imageUrl);
  pushImageCandidate(candidates, option.sourceImageUrl);
  collectImageCandidatesFromRecord(candidates, snapshot);
  collectImageCandidatesFromRecord(candidates, liveInventory);
  collectImageCandidatesFromRecord(candidates, rawSourceFields);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = corsSafeImageUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    return normalized;
  }
  return "";
}

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
  const imageUrl = resolveOptionSlabImageUrl(option);
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
