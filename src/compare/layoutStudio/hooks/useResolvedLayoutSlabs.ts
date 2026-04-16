import { useEffect, useMemo, useState } from "react";
import type { JobComparisonOptionRecord } from "../../../types/compareQuote";
import { CATALOG_OVERLAY_UPDATED_EVENT } from "../../../utils/import/importStorage";
import type { LayoutSlab, SlabCloneEntry } from "../types";
import { applyRealisticSlabDimensions, slabsForOption } from "../utils/slabDimensions";

const MAX_SLABS = 20;

type ResolvedSlabImage = { url: string; w: number; h: number };

function loadImageCandidate(url: string): Promise<ResolvedSlabImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ url, w: img.naturalWidth, h: img.naturalHeight });
        return;
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function resolveFirstRenderableSlabImage(slab: LayoutSlab): Promise<ResolvedSlabImage | null> {
  const candidates = [slab.imageUrl, ...(slab.imageCandidates ?? [])].filter((value, index, arr) => {
    const trimmed = value?.trim();
    return Boolean(trimmed) && arr.findIndex((candidate) => candidate === value) === index;
  });
  for (const candidate of candidates) {
    const loaded = await loadImageCandidate(candidate);
    if (loaded) return loaded;
  }
  return null;
}

/**
 * Resolves slab width/height for placement: catalog size when parsed, otherwise photo aspect ratio.
 * Optional `slabClones` duplicates the primary slab for multi-slab placement (same image, new ids).
 */
export function useResolvedLayoutSlabs(
  option: JobComparisonOptionRecord | null,
  slabClones?: SlabCloneEntry[] | null
): LayoutSlab[] {
  const [overlayVersion, setOverlayVersion] = useState(0);
  const base = useMemo(() => (option ? slabsForOption(option) : []), [option, overlayVersion]);
  const [resolvedImages, setResolvedImages] = useState<Record<string, ResolvedSlabImage>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOverlayUpdated = () => setOverlayVersion((prev) => prev + 1);
    window.addEventListener(CATALOG_OVERLAY_UPDATED_EVENT, onOverlayUpdated);
    return () => window.removeEventListener(CATALOG_OVERLAY_UPDATED_EVENT, onOverlayUpdated);
  }, []);

  useEffect(() => {
    setResolvedImages({});
    if (!base.length) return;
    let cancelled = false;
    for (const slab of base) {
      void resolveFirstRenderableSlabImage(slab).then((resolved) => {
        if (cancelled) return;
        if (!resolved) return;
        setResolvedImages((prev) => {
          const current = prev[slab.id];
          if (
            current &&
            current.url === resolved.url &&
            current.w === resolved.w &&
            current.h === resolved.h
          ) {
            return prev;
          }
          return { ...prev, [slab.id]: resolved };
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [base]);

  return useMemo(() => {
    const resolved = base.map((slab) => {
      const resolvedImage = resolvedImages[slab.id];
      const slabWithImage = resolvedImage ? { ...slab, imageUrl: resolvedImage.url } : slab;
      const nat = resolvedImage ? { w: resolvedImage.w, h: resolvedImage.h } : null;
      return applyRealisticSlabDimensions(slabWithImage, nat);
    });
    if (!resolved.length || !slabClones?.length) return resolved;
    const primary = resolved[0];
    const extras = slabClones.slice(0, Math.max(0, MAX_SLABS - resolved.length)).map((c) => ({
      ...primary,
      id: c.id,
      label: c.label,
    }));
    return [...resolved, ...extras];
  }, [base, resolvedImages, slabClones]);
}
