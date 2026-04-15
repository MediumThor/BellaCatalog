import { useEffect, useMemo, useState } from "react";
import type { JobComparisonOptionRecord } from "../../../types/compareQuote";
import { CATALOG_OVERLAY_UPDATED_EVENT } from "../../../utils/import/importStorage";
import type { LayoutSlab, SlabCloneEntry } from "../types";
import { applyRealisticSlabDimensions, slabsForOption } from "../utils/slabDimensions";

const MAX_SLABS = 20;

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
  const [imgDims, setImgDims] = useState<Record<string, { w: number; h: number }>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOverlayUpdated = () => setOverlayVersion((prev) => prev + 1);
    window.addEventListener(CATALOG_OVERLAY_UPDATED_EVENT, onOverlayUpdated);
    return () => window.removeEventListener(CATALOG_OVERLAY_UPDATED_EVENT, onOverlayUpdated);
  }, []);

  useEffect(() => {
    if (!base.length) return;
    const urls = [...new Set(base.map((s) => s.imageUrl).filter(Boolean))];
    let cancelled = false;
    for (const url of urls) {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setImgDims((prev) => ({ ...prev, [url]: { w: img.naturalWidth, h: img.naturalHeight } }));
        }
      };
      img.onerror = () => {};
      img.src = url;
    }
    return () => {
      cancelled = true;
    };
  }, [base]);

  return useMemo(() => {
    const resolved = base.map((slab) => {
      const nat = slab.imageUrl ? imgDims[slab.imageUrl] : undefined;
      return applyRealisticSlabDimensions(slab, nat ?? null);
    });
    if (!resolved.length || !slabClones?.length) return resolved;
    const primary = resolved[0];
    const extras = slabClones.slice(0, Math.max(0, MAX_SLABS - resolved.length)).map((c) => ({
      ...primary,
      id: c.id,
      label: c.label,
    }));
    return [...resolved, ...extras];
  }, [base, imgDims, slabClones]);
}
