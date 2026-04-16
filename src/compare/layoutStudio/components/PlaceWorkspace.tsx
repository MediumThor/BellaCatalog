import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutPiece, LayoutPoint, LayoutSlab, PiecePlacement } from "../types";
import { distancePointToSegment } from "../utils/blankPlanGeometry";
import {
  horizontalSeamPreviewChord,
  seamGeometryFromAxisAlignedEdge,
  type SeamFromEdgeGeometry,
  verticalSeamPreviewChord,
} from "../utils/blankPlanPolygonOps";
import { normalizeClosedRing } from "../utils/geometry";
import { slabPlacementSpacingState } from "../utils/placementOverlap";
import { edgeStripLetterLabelByPieceId, pieceLabelByPieceId } from "../utils/pieceLabels";
import { isPlanStripPiece } from "../utils/pieceRoles";
import {
  mirrorLocalInches,
  planDisplayPointsForSlabPlacement,
  piecePolygonInches,
  transformedPieceInches,
  worldDisplayToSlabInches,
} from "../utils/pieceInches";
import { piecesHaveAnyScale } from "../utils/sourcePages";
import { PieceOutletCutoutsSvg } from "./PieceOutletCutoutsSvg";
import { PieceSinkCutoutsSvg } from "./PieceSinkCutoutsSvg";
import { IconRotateCCW, IconRotateCW } from "./PlanToolbarIcons";

/** ~6 divisions along the span; step in inches (nice numbers). */
function slabRulerStepInches(spanIn: number): number {
  if (!(spanIn > 0) || !Number.isFinite(spanIn)) return 12;
  const target = spanIn / 6;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(target, 0.01))));
  const n = target / pow;
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return f * pow;
}

function slabRulerTickValues(spanIn: number, step: number): number[] {
  const out: number[] = [];
  const eps = 1e-5;
  let v = 0;
  while (v <= spanIn + eps) {
    out.push(Math.round(v * 1000) / 1000);
    v += step;
  }
  const last = out[out.length - 1];
  if (last < spanIn - step * 0.15) {
    out.push(Math.round(spanIn * 100) / 100);
  }
  return out;
}

function formatSlabRulerInches(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 0.02) return `${Math.round(r)}"`;
  return `${r.toFixed(1)}"`;
}

type SlabMargins = { lm: number; rm: number; tm: number; bm: number; tick: number; fs: number };

type SlabSeamEdgeHit = {
  slabId: string;
  pieceId: string;
  edgeIndex: number;
  a: LayoutPoint;
  b: LayoutPoint;
};

export type PlaceSeamRequest = {
  pieceId: string;
  edgeIndex: number;
  dimA: number;
  dimB: number;
};

function formatDimInches(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000);
}

function computeSlabMargins(slab: LayoutSlab): SlabMargins {
  const w = slab.widthIn;
  const h = slab.heightIn;
  const m = Math.min(w, h);
  const tick = Math.min(0.55, Math.max(0.2, m * 0.024));
  const fs = Math.min(1.35, Math.max(0.55, m * 0.028));
  const labelSpanL = fs * 5.8;
  const lm = Math.min(18, Math.max(3.2, tick + labelSpanL, m * 0.04));
  const labelSpanR = fs * 3.5;
  const rm = Math.min(14, Math.max(2.6, tick + labelSpanR, m * 0.038));
  const tm = Math.min(7, Math.max(2, tick + fs * 1.25, m * 0.048));
  const bm = Math.min(6, Math.max(1.8, tick + fs * 1.35, m * 0.055));
  return { lm, rm, tm, bm, tick, fs };
}

type Props = {
  slabs: LayoutSlab[];
  activeSlabId: string | null;
  onActiveSlab: (id: string) => void;
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
  selectedPieceId: string | null;
  onSelectPiece: (id: string | null) => void;
  onPlacementChange: (placements: PiecePlacement[]) => void;
  /** Called once when the user begins dragging a piece (for undo snapshot). */
  onPlacementInteractionStart?: () => void;
  /** Quote phase: visual-only slab preview (no drag). */
  readOnly?: boolean;
  /** When false, slab picker is hidden (e.g. custom strip elsewhere). */
  showSlabTabs?: boolean;
  /** Piece name / splash label on slab (matches Live Layout Preview toggle). */
  showPieceLabels?: boolean;
  /** Optional second line with placed piece bounding dimensions. */
  showPieceDimensions?: boolean;
  /**
   * Multiple slabs: `tabs` shows one slab at a time; `column` stacks every slab vertically
   * (pieces filtered by `placement.slabId`).
   */
  slabViewMode?: "tabs" | "column";
  /** Primary catalog slab id — clones may show a remove control when `onRemoveSlab` is set. */
  primarySlabId?: string | null;
  /** Remove a cloned slab (not the primary). */
  onRemoveSlab?: (slabId: string) => void;
  /** Clear selected piece from its slab (Place phase only). */
  onRemoveSelectedPieceFromSlab?: () => void;
  /** Whether the selected piece can be removed from the slab. */
  canRemoveSelectedFromSlab?: boolean;
  /**
   * Place phase: rotation toolbar renders under the slab that holds the selected piece
   * (omit in quote / read-only).
   */
  onRotateSelectedPlacementOnSlab?: (deltaDeg: number) => void;
  onSelectedPlacementRotationLive?: (deg: number) => void;
  onSelectedPlacementRotationDragStart?: () => void;
  /** Place phase: duplicate primary slab — button at bottom-right of primary slab drawing. */
  onAddSlab?: () => void;
  addSlabDisabled?: boolean;
  addSlabTitle?: string;
  /**
   * When true, dragging a piece on the slab moves only horizontally or vertically (axis locks after a short drag).
   */
  orthoMove?: boolean;
  /** Place phase: edge hover + click to split the current placed piece. */
  seamMode?: boolean;
  /** Commit a seam split on the active piece and keep slab placement in sync. */
  onPlaceSeamRequest?: (request: PlaceSeamRequest) => boolean;
};

/** Pixels of pointer travel before ortho mode picks horizontal vs vertical. */
const PLACEMENT_ORTHO_LOCK_PX = 4;

export function PlaceWorkspace({
  slabs,
  activeSlabId,
  onActiveSlab,
  pieces,
  placements,
  pixelsPerInch,
  selectedPieceId,
  onSelectPiece,
  onPlacementChange,
  onPlacementInteractionStart,
  readOnly = false,
  showSlabTabs = true,
  showPieceLabels = true,
  showPieceDimensions = false,
  slabViewMode = "column",
  primarySlabId = null,
  onRemoveSlab,
  onRemoveSelectedPieceFromSlab,
  canRemoveSelectedFromSlab = false,
  onRotateSelectedPlacementOnSlab,
  onSelectedPlacementRotationLive,
  onSelectedPlacementRotationDragStart,
  onAddSlab,
  addSlabDisabled = false,
  addSlabTitle,
  orthoMove = false,
  seamMode = false,
  onPlaceSeamRequest,
}: Props) {
  const scrollShellRef = useRef<HTMLDivElement | null>(null);
  const slabItemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const svgRefs = useRef<Map<string, SVGSVGElement | null>>(new Map());
  /** Last slab used during an active drag (handles gaps between slab cards). */
  const lastDragSlabRef = useRef<string | null>(null);
  /** Ortho drag: lock pointer to screen X or Y after initial movement (matches sink drag on plan). */
  const placementOrthoAxisRef = useRef<"x" | "y" | null>(null);
  const [drag, setDrag] = useState<{
    pieceId: string;
    slabId: string;
    startClient: { x: number; y: number };
    startPlacement: PiecePlacement;
    /** Pointer position minus piece centroid in slab inch space at pointer-down. */
    grabOffset: { x: number; y: number };
  } | null>(null);
  const [hoverSeamEdge, setHoverSeamEdge] = useState<SlabSeamEdgeHit | null>(null);
  const [seamModal, setSeamModal] = useState<{
    slabId: string;
    pieceId: string;
    edgeIndex: number;
    geometry: SeamFromEdgeGeometry;
    valA: string;
    valB: string;
  } | null>(null);

  const activeSlab = slabs.find((s) => s.id === activeSlabId) ?? slabs[0] ?? null;
  const ppiReady = piecesHaveAnyScale(pieces, pixelsPerInch);

  const useTabs =
    slabViewMode === "tabs" && slabs.length > 1 && showSlabTabs;
  const useColumn =
    slabViewMode === "column" && slabs.length > 0;

  const slabsToRender = useMemo(() => {
    if (!slabs.length) return [];
    if (useTabs && activeSlab) return [activeSlab];
    return slabs;
  }, [slabs, useTabs, activeSlab]);

  const placementByPiece = useMemo(() => {
    const m = new Map<string, PiecePlacement>();
    for (const p of placements) m.set(p.pieceId, p);
    return m;
  }, [placements]);

  const seamEdgeSegmentsBySlab = useMemo(() => {
    const out = new Map<string, SlabSeamEdgeHit[]>();
    if (readOnly || !seamMode || !ppiReady) return out;
    for (const piece of pieces) {
      if (isPlanStripPiece(piece)) continue;
      const placement = placementByPiece.get(piece.id);
      if (!placement?.placed || !placement.slabId) continue;
      const world = planDisplayPointsForSlabPlacement(piece, pieces);
      const ring = normalizeClosedRing(world);
      const n = ring.length;
      if (n < 2) continue;
      const local = piecePolygonInches(piece, pixelsPerInch, pieces);
      if (local.length < 3) continue;
      const displayRing = normalizeClosedRing(
        transformedPieceInches(mirrorLocalInches(local, placement.mirrored), placement.rotation).map((point) => ({
          x: placement.x + point.x,
          y: placement.y + point.y,
        }))
      );
      if (displayRing.length !== n) continue;
      const slabId = placement.slabId;
      const slabSegs = out.get(slabId) ?? [];
      for (let edgeIndex = 0; edgeIndex < n; edgeIndex += 1) {
        if (!seamGeometryFromAxisAlignedEdge(world, edgeIndex)) continue;
        slabSegs.push({
          slabId,
          pieceId: piece.id,
          edgeIndex,
          a: displayRing[edgeIndex]!,
          b: displayRing[(edgeIndex + 1) % n]!,
        });
      }
      if (slabSegs.length > 0) out.set(slabId, slabSegs);
    }
    return out;
  }, [placementByPiece, ppiReady, pieces, pixelsPerInch, readOnly, seamMode]);

  const seamPreviewLine = useMemo(() => {
    if (!seamModal) return null;
    const piece = pieces.find((p) => p.id === seamModal.pieceId);
    const placement = placementByPiece.get(seamModal.pieceId);
    if (!piece || !placement?.placed || !placement.slabId) return null;
    const world = planDisplayPointsForSlabPlacement(piece, pieces);
    const ring = normalizeClosedRing(world);
    const n = ring.length;
    if (n < 2) return null;
    const edgeIndex = seamModal.edgeIndex % n;
    const start = ring[edgeIndex]!;
    const end = ring[(edgeIndex + 1) % n]!;
    const hintY = (start.y + end.y) / 2;
    const hintX = (start.x + end.x) / 2;
    const dimA = parseFloat(seamModal.valA);
    if (!Number.isFinite(dimA)) return null;
    if (seamModal.geometry.kind === "vertical") {
      const x = seamModal.geometry.xMin + dimA;
      const { y0, y1 } = verticalSeamPreviewChord(world, x, hintY);
      return {
        slabId: placement.slabId,
        a: worldDisplayToSlabInches(x, y0, piece, placement, pixelsPerInch, pieces),
        b: worldDisplayToSlabInches(x, y1, piece, placement, pixelsPerInch, pieces),
      };
    }
    const y = seamModal.geometry.yMin + dimA;
    const { x0, x1 } = horizontalSeamPreviewChord(world, y, hintX);
    return {
      slabId: placement.slabId,
      a: worldDisplayToSlabInches(x0, y, piece, placement, pixelsPerInch, pieces),
      b: worldDisplayToSlabInches(x1, y, piece, placement, pixelsPerInch, pieces),
    };
  }, [pieces, pixelsPerInch, placementByPiece, seamModal]);

  const dragRef = useRef(drag);
  dragRef.current = drag;
  const placementSpacing = useMemo(
    () =>
      slabPlacementSpacingState({
        pieces,
        placements,
        pixelsPerInch,
        nearDistanceIn: 1.5,
      }),
    [pieces, placements, pixelsPerInch],
  );
  const collidingPieceIds = placementSpacing.collidingPieceIds;
  const nearCollisionPieceIds = placementSpacing.nearbyPieceIds;

  const pieceLabelById = useMemo(() => pieceLabelByPieceId(pieces), [pieces]);
  const stripLetterLabelById = useMemo(() => edgeStripLetterLabelByPieceId(pieces), [pieces]);

  /** Slab placement: stable alphabetical order by piece name when drawing pieces. */
  const piecesSortedAlphabetically = useMemo(
    () =>
      [...pieces].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      ),
    [pieces]
  );

  const updatePlacement = useCallback(
    (pieceId: string, patch: Partial<PiecePlacement>) => {
      onPlacementChange(
        placements.map((p) => (p.pieceId === pieceId ? { ...p, ...patch } : p))
      );
    },
    [placements, onPlacementChange]
  );

  const clientToSlab = useCallback(
    (slabId: string, clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRefs.current.get(slabId);
      const slab = slabs.find((s) => s.id === slabId);
      if (!svg || !slab) return null;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    },
    [slabs]
  );

  /** Which slab the pointer is over (for moving pieces between slabs). */
  const resolveSlabUnderPointer = useCallback(
    (clientX: number, clientY: number): string | null => {
      const hit = document.elementFromPoint(clientX, clientY);
      if (hit) {
        const svg = hit.closest?.("svg[data-slab-id]") as SVGSVGElement | null;
        if (svg) {
          const id = svg.getAttribute("data-slab-id");
          if (id && slabs.some((s) => s.id === id)) return id;
        }
      }
      for (const s of slabs) {
        const p = clientToSlab(s.id, clientX, clientY);
        if (!p) continue;
        if (p.x >= 0 && p.x <= s.widthIn && p.y >= 0 && p.y <= s.heightIn) return s.id;
      }
      return null;
    },
    [slabs, clientToSlab]
  );

  const openSeamModal = useCallback(
    (edge: SlabSeamEdgeHit) => {
      const piece = pieces.find((p) => p.id === edge.pieceId);
      if (!piece) return;
      const world = planDisplayPointsForSlabPlacement(piece, pieces);
      const geometry = seamGeometryFromAxisAlignedEdge(world, edge.edgeIndex);
      if (!geometry) return;
      onActiveSlab(edge.slabId);
      onSelectPiece(piece.id);
      setSeamModal({
        slabId: edge.slabId,
        pieceId: piece.id,
        edgeIndex: edge.edgeIndex,
        geometry,
        valA: formatDimInches(geometry.dimA),
        valB: formatDimInches(geometry.dimB),
      });
    },
    [onActiveSlab, onSelectPiece, pieces]
  );

  const pickSeamEdge = useCallback(
    (slabId: string, clientX: number, clientY: number): SlabSeamEdgeHit | null => {
      const point = clientToSlab(slabId, clientX, clientY);
      const svg = svgRefs.current.get(slabId);
      const slab = slabs.find((s) => s.id === slabId);
      if (!point || !svg || !slab) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const hitRadiusIn = Math.max(0.18, (slab.widthIn / rect.width) * 10);
      let best: SlabSeamEdgeHit | null = null;
      let bestDistance = hitRadiusIn;
      for (const edge of seamEdgeSegmentsBySlab.get(slabId) ?? []) {
        const distance = distancePointToSegment(point, edge.a, edge.b);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = edge;
        }
      }
      return best;
    },
    [clientToSlab, seamEdgeSegmentsBySlab, slabs]
  );

  useEffect(() => {
    if (!seamMode || readOnly || !ppiReady) {
      setHoverSeamEdge(null);
      setSeamModal(null);
    }
  }, [ppiReady, readOnly, seamMode]);

  useEffect(() => {
    if (!seamModal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSeamModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seamModal]);

  const handlePointerDownPiece = (pieceId: string, slabId: string, ev: React.PointerEvent) => {
    if (readOnly) return;
    ev.stopPropagation();
    ev.preventDefault();
    const pl = placementByPiece.get(pieceId);
    const slab = slabs.find((s) => s.id === slabId);
    if (!pl || !slab) return;
    if (seamMode && ppiReady) {
      onActiveSlab(slabId);
      const hovered =
        hoverSeamEdge?.slabId === slabId && hoverSeamEdge.pieceId === pieceId
          ? hoverSeamEdge
          : pickSeamEdge(slabId, ev.clientX, ev.clientY);
      if (hovered) {
        openSeamModal(hovered);
      } else {
        onSelectPiece(pieceId);
      }
      return;
    }
    const pointerInSlab = clientToSlab(slabId, ev.clientX, ev.clientY);
    if (!pointerInSlab) return;
    onSelectPiece(pieceId);
    onPlacementInteractionStart?.();
    placementOrthoAxisRef.current = null;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    lastDragSlabRef.current = slabId;
    setDrag({
      pieceId,
      slabId,
      startClient: { x: ev.clientX, y: ev.clientY },
      startPlacement: { ...pl },
      grabOffset: { x: pointerInSlab.x - pl.x, y: pointerInSlab.y - pl.y },
    });
  };

  const handlePointerMove = useCallback(
    (ev: React.PointerEvent) => {
      if (!drag) return;
      let clientX = ev.clientX;
      let clientY = ev.clientY;
      if (orthoMove) {
        const dx = ev.clientX - drag.startClient.x;
        const dy = ev.clientY - drag.startClient.y;
        if (placementOrthoAxisRef.current === null) {
          if (Math.hypot(dx, dy) >= PLACEMENT_ORTHO_LOCK_PX) {
            placementOrthoAxisRef.current =
              Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
          }
        }
        if (placementOrthoAxisRef.current === "x") clientY = drag.startClient.y;
        else if (placementOrthoAxisRef.current === "y") clientX = drag.startClient.x;
      }
      const targetSlabId =
        resolveSlabUnderPointer(clientX, clientY) ??
        lastDragSlabRef.current ??
        drag.startPlacement.slabId;
      if (!targetSlabId) return;
      const slab = slabs.find((s) => s.id === targetSlabId);
      if (!slab) return;
      const p = clientToSlab(targetSlabId, clientX, clientY);
      if (!p) return;
      lastDragSlabRef.current = targetSlabId;
      updatePlacement(drag.pieceId, {
        x: p.x - drag.grabOffset.x,
        y: p.y - drag.grabOffset.y,
        slabId: targetSlabId,
        placed: true,
      });
    },
    [drag, orthoMove, resolveSlabUnderPointer, slabs, clientToSlab, updatePlacement]
  );

  const handleEndDrag = useCallback(() => {
    if (!dragRef.current) return;
    setDrag(null);
    lastDragSlabRef.current = null;
    placementOrthoAxisRef.current = null;
  }, []);

  useEffect(() => {
    if (!drag) return;
    const end = () => {
      handleEndDrag();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [drag, handleEndDrag]);

  const handleSeamPointerMove =
    (slabId: string) => (ev: React.PointerEvent<SVGSVGElement>) => {
      if (readOnly || !seamMode || !ppiReady || drag) return;
      const hovered = pickSeamEdge(slabId, ev.clientX, ev.clientY);
      setHoverSeamEdge((prev) => {
        if (
          prev?.slabId === hovered?.slabId &&
          prev?.pieceId === hovered?.pieceId &&
          prev?.edgeIndex === hovered?.edgeIndex
        ) {
          return prev;
        }
        return hovered;
      });
    };

  /** Clicking slab stone (not a piece) focuses this slab for “place from Live Layout Preview” and deselects pieces. */
  const handleSvgBackgroundPointerDown =
    (slabId: string) => (ev: React.PointerEvent<SVGSVGElement>) => {
      if (readOnly) return;
      const tag = (ev.target as Element | null)?.tagName?.toLowerCase();
      if (tag === "polygon") return;
      onActiveSlab(slabId);
      if (seamMode && ppiReady) {
        if (hoverSeamEdge?.slabId !== slabId) setHoverSeamEdge(null);
        onSelectPiece(null);
        return;
      }
      onSelectPiece(null);
    };

  const setSvgRef = (slabId: string) => (el: SVGSVGElement | null) => {
    if (el) svgRefs.current.set(slabId, el);
    else svgRefs.current.delete(slabId);
  };
  const setSlabItemRef = (slabId: string) => (el: HTMLDivElement | null) => {
    if (el) slabItemRefs.current.set(slabId, el);
    else slabItemRefs.current.delete(slabId);
  };

  useEffect(() => {
    if (!useColumn || slabs.length <= 1 || readOnly) return;
    const scrollShell = scrollShellRef.current;
    if (!scrollShell) return;
    const viewportRegion =
      (scrollShell.closest(".ls-place-region--slabs.ls-place-region--viewport-scroll") as HTMLDivElement | null) ??
      null;
    const viewportEl = viewportRegion ?? scrollShell;
    const scrollTargets = viewportRegion && viewportRegion !== scrollShell ? [scrollShell, viewportRegion] : [scrollShell];

    let rafId = 0;
    const updateActiveSlabFromViewport = () => {
      rafId = 0;
      const viewportRect = viewportEl.getBoundingClientRect();
      const viewportTop = viewportRect.top;
      const viewportBottom = viewportRect.bottom;
      const viewportCenter = (viewportTop + viewportBottom) / 2;
      let bestSlabId: string | null = null;
      let bestScore = -Infinity;

      for (const slab of slabs) {
        const el = slabItemRefs.current.get(slab.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const visibleTop = Math.max(rect.top, viewportTop);
        const visibleBottom = Math.min(rect.bottom, viewportBottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        if (visibleHeight <= 0) continue;
        const itemCenter = (rect.top + rect.bottom) / 2;
        const distanceFromCenter = Math.abs(itemCenter - viewportCenter);
        const score = visibleHeight - distanceFromCenter * 0.35;
        if (score > bestScore) {
          bestScore = score;
          bestSlabId = slab.id;
        }
      }

      if (bestSlabId && bestSlabId !== activeSlabId) {
        onActiveSlab(bestSlabId);
      }
    };

    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(updateActiveSlabFromViewport);
    };

    scheduleUpdate();
    for (const target of scrollTargets) {
      target.addEventListener("scroll", scheduleUpdate, { passive: true });
    }
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      for (const target of scrollTargets) {
        target.removeEventListener("scroll", scheduleUpdate);
      }
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [activeSlabId, onActiveSlab, readOnly, slabs, useColumn]);

  if (!activeSlab) {
    return (
      <div className="ls-place-empty glass-panel">
        <p className="ls-trace-empty-title">No slab image for this option</p>
        <p className="ls-muted">Add a catalog product with slab art to preview placement.</p>
      </div>
    );
  }

  const renderSlabStage = (slab: LayoutSlab) => {
    const slabMargins = computeSlabMargins(slab);
    const w = slab.widthIn;
    const h = slab.heightIn;
    const { lm, rm, tm, bm } = slabMargins;
    const viewBox = `${-lm} ${-tm} ${w + lm + rm} ${h + tm + bm}`;
    const { tick, fs } = slabMargins;
    const stepX = slabRulerStepInches(w);
    const stepY = slabRulerStepInches(h);
    const xs = slabRulerTickValues(w, stepX);
    const ys = slabRulerTickValues(h, stepY);
    const slabRulers = { w, h, lm, rm, tm, bm, tick, fs, xs, ys };

    const removable =
      onRemoveSlab && primarySlabId && slab.id !== primarySlabId;

    const selectedPl =
      selectedPieceId != null ? placementByPiece.get(selectedPieceId) : undefined;
    const showRemovePieceFromSlab =
      !readOnly &&
      !!onRemoveSelectedPieceFromSlab &&
      canRemoveSelectedFromSlab &&
      !!selectedPieceId &&
      selectedPl?.slabId === slab.id;

    const showPlacementToolbar =
      !readOnly &&
      !!onRotateSelectedPlacementOnSlab &&
      !!onSelectedPlacementRotationLive &&
      !!selectedPieceId &&
      !!selectedPl?.placed &&
      selectedPl?.slabId === slab.id;

    const primaryId = primarySlabId ?? slabs[0]?.id ?? null;
    const showAddSlabHere =
      !readOnly &&
      onAddSlab != null &&
      primaryId != null &&
      slab.id === primaryId;

    const showSlabBottomToolbar =
      showAddSlabHere || showPlacementToolbar || showRemovePieceFromSlab;

    /** Placement rotation and/or clear-from-slab control share one glass toolbar strip. */
    const hasMainSlabToolbar = showPlacementToolbar || showRemovePieceFromSlab;

    const aspectStyle = {
      aspectRatio:
        slab.heightIn > 0
          ? `${slab.widthIn + slabMargins.lm + slabMargins.rm} / ${slab.heightIn + slabMargins.tm + slabMargins.bm}`
          : undefined,
    };
    const slabImageFrameStyle = {
      left: `${(lm / (w + lm + rm)) * 100}%`,
      top: `${(tm / (h + tm + bm)) * 100}%`,
      width: `${(w / (w + lm + rm)) * 100}%`,
      height: `${(h / (h + tm + bm)) * 100}%`,
    };

    const slabStage = (
      <div className="ls-place-stage ls-place-stage--slab-aspect" style={aspectStyle}>
        <img
          className="ls-place-stage-bg-img"
          src={slab.imageUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={slabImageFrameStyle}
        />
        <svg
          ref={setSvgRef(slab.id)}
          data-slab-id={slab.id}
          className="ls-place-svg"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={readOnly || !ppiReady ? undefined : handleSvgBackgroundPointerDown(slab.id)}
          onPointerMove={readOnly || !ppiReady || !seamMode ? undefined : handleSeamPointerMove(slab.id)}
          onPointerLeave={
            readOnly || !ppiReady || !seamMode
              ? undefined
              : () =>
                  setHoverSeamEdge((prev) =>
                    prev?.slabId === slab.id ? null : prev
                  )
          }
          width="100%"
          height="100%"
        >
            <rect
              x={0}
              y={0}
              width={slab.widthIn}
              height={slab.heightIn}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={0.05}
            />
            {ppiReady
              ? piecesSortedAlphabetically.map((piece) => {
                  const pl = placementByPiece.get(piece.id);
                  if (!pl || pl.slabId !== slab.id) return null;
                  const local = piecePolygonInches(piece, pixelsPerInch!, pieces);
                  if (local.length < 3) return null;
                  const rotated = transformedPieceInches(mirrorLocalInches(local, pl.mirrored), pl.rotation);
                  const pts = rotated.map((q) => `${pl.x + q.x},${pl.y + q.y}`).join(" ");
                  const sel = piece.id === selectedPieceId;
                  const isStrip = isPlanStripPiece(piece);
                  const labelText = isStrip
                    ? (stripLetterLabelById.get(piece.id) ?? "—")
                    : (pieceLabelById.get(piece.id) ?? piece.name);
                  const xs = rotated.map((q) => q.x);
                  const ys = rotated.map((q) => q.y);
                  const bw = Math.max(...xs) - Math.min(...xs);
                  const bh = Math.max(...ys) - Math.min(...ys);
                  const shortSide = Math.min(bw, bh);
                  const baseFont = Math.min(2.2, Math.max(0.55, shortSide * 0.11));
                  const fontSize = isStrip
                    ? Math.min(3.4, Math.max(1.05, baseFont * 1.65))
                    : baseFont;
                  const longHoriz = bw >= bh;
                  const labelRot = longHoriz ? 0 : 90;
                  const dimensionText = `${bw.toFixed(1)}" x ${bh.toFixed(1)}"`;
                  const offSlab = rotated.some((q) => {
                    const x = pl.x + q.x;
                    const y = pl.y + q.y;
                    return x < -1e-4 || x > slab.widthIn + 1e-4 || y < -1e-4 || y > slab.heightIn + 1e-4;
                  });
                  const colliding = collidingPieceIds.has(piece.id);
                  const warning = colliding || offSlab;
                  const nearCollision = !warning && nearCollisionPieceIds.has(piece.id);
                  const fill = warning
                    ? "rgba(220, 45, 45, 0.36)"
                    : nearCollision
                      ? "rgba(242, 137, 30, 0.3)"
                      : "rgba(120,200,255,0.2)";
                  const labelFontSize = sel ? fontSize * 1.28 : fontSize;
                  return (
                    <g key={piece.id}>
                    <polygon
                      className="ls-place-piece-border"
                      points={pts}
                      fill={fill}
                      style={{
                        cursor: readOnly ? "default" : seamMode ? "crosshair" : "grab",
                        pointerEvents:
                          drag?.pieceId === piece.id && !readOnly ? "none" : undefined,
                      }}
                      onPointerDown={(e) => handlePointerDownPiece(piece.id, slab.id, e)}
                    />
                      {!isStrip && (piece.sinks?.length ?? 0) > 0 ? (
                        <PieceSinkCutoutsSvg
                          piece={piece}
                          allPieces={pieces}
                          coordPerInch={1}
                          slabPlacement={pl}
                          pixelsPerInchForSlab={piece.sourcePixelsPerInch ?? pixelsPerInch ?? undefined}
                          appearance="cutout"
                          interactive={false}
                        />
                      ) : null}
                      {!isStrip && (piece.outlets?.length ?? 0) > 0 ? (
                        <PieceOutletCutoutsSvg
                          piece={piece}
                          allPieces={pieces}
                          coordPerInch={1}
                          slabPlacement={pl}
                          pixelsPerInchForSlab={piece.sourcePixelsPerInch ?? pixelsPerInch ?? undefined}
                          appearance="cutout"
                          interactive={false}
                        />
                      ) : null}
                      {showPieceLabels ? (
                        <text
                          transform={`translate(${pl.x},${pl.y}) rotate(${labelRot})`}
                          fill="#d32f2f"
                          fontSize={labelFontSize}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className={`ls-place-piece-label${sel ? " ls-place-piece-label--selected" : ""}`}
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          <tspan x="0" dy={showPieceDimensions ? "-0.45em" : "0"}>
                            {labelText}
                          </tspan>
                          {showPieceDimensions ? (
                            <tspan x="0" dy="1.15em" className="ls-place-preview-piece-dimension">
                              {dimensionText}
                            </tspan>
                          ) : null}
                        </text>
                      ) : null}
                    </g>
                  );
                })
              : null}
            {ppiReady && seamMode
              ? (seamEdgeSegmentsBySlab.get(slab.id) ?? []).map((edge) => {
                  const highlighted =
                    (hoverSeamEdge?.slabId === edge.slabId &&
                      hoverSeamEdge.pieceId === edge.pieceId &&
                      hoverSeamEdge.edgeIndex === edge.edgeIndex) ||
                    (seamModal?.slabId === edge.slabId &&
                      seamModal.pieceId === edge.pieceId &&
                      seamModal.edgeIndex === edge.edgeIndex);
                  return (
                    <g key={`seam-edge-${edge.slabId}-${edge.pieceId}-${edge.edgeIndex}`}>
                      <line
                        x1={edge.a.x}
                        y1={edge.a.y}
                        x2={edge.b.x}
                        y2={edge.b.y}
                        stroke="transparent"
                        strokeWidth={1.35}
                        strokeLinecap="round"
                        style={{ cursor: "crosshair" }}
                        pointerEvents="stroke"
                        onPointerEnter={() => setHoverSeamEdge(edge)}
                        onPointerMove={() => setHoverSeamEdge(edge)}
                        onPointerLeave={() =>
                          setHoverSeamEdge((prev) =>
                            prev?.slabId === edge.slabId &&
                            prev.pieceId === edge.pieceId &&
                            prev.edgeIndex === edge.edgeIndex
                              ? null
                              : prev
                          )
                        }
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openSeamModal(edge);
                        }}
                      />
                      {highlighted ? (
                        <line
                          x1={edge.a.x}
                          y1={edge.a.y}
                          x2={edge.b.x}
                          y2={edge.b.y}
                          stroke="rgba(232, 64, 64, 0.98)"
                          strokeWidth={0.22}
                          strokeLinecap="round"
                          pointerEvents="none"
                        />
                      ) : null}
                    </g>
                  );
                })
              : null}
            {seamPreviewLine && seamPreviewLine.slabId === slab.id ? (
              <line
                x1={seamPreviewLine.a.x}
                y1={seamPreviewLine.a.y}
                x2={seamPreviewLine.b.x}
                y2={seamPreviewLine.b.y}
                stroke="rgba(232,212,139,0.95)"
                strokeWidth={0.24}
                strokeDasharray="1.1 0.55"
                pointerEvents="none"
              />
            ) : null}
            <g className="ls-place-slab-rulers" pointerEvents="none" aria-hidden>
              <rect
                x={-slabRulers.lm}
                y={slabRulers.h}
                width={slabRulers.w + slabRulers.lm + slabRulers.rm}
                height={slabRulers.bm}
                fill="rgba(8, 8, 10, 0.88)"
              />
              <rect
                x={-slabRulers.lm}
                y={-slabRulers.tm}
                width={slabRulers.lm}
                height={slabRulers.h + slabRulers.tm + slabRulers.bm}
                fill="rgba(8, 8, 10, 0.88)"
              />
              <rect
                x={slabRulers.w}
                y={-slabRulers.tm}
                width={slabRulers.rm}
                height={slabRulers.h + slabRulers.tm + slabRulers.bm}
                fill="rgba(8, 8, 10, 0.88)"
              />
              <rect
                x={-slabRulers.lm}
                y={-slabRulers.tm}
                width={slabRulers.w + slabRulers.lm + slabRulers.rm}
                height={slabRulers.tm}
                fill="rgba(8, 8, 10, 0.88)"
              />
              <line
                x1={0}
                y1={slabRulers.h}
                x2={slabRulers.w}
                y2={slabRulers.h}
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={0.08}
              />
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={slabRulers.h}
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={0.08}
              />
              {slabRulers.xs.map((xv) => (
                <g key={`rx-${slab.id}-${xv}`}>
                  <line
                    x1={xv}
                    y1={slabRulers.h}
                    x2={xv}
                    y2={slabRulers.h - slabRulers.tick}
                    stroke="rgba(255,255,255,0.75)"
                    strokeWidth={0.07}
                  />
                  <text
                    x={xv}
                    y={slabRulers.h + slabRulers.bm * 0.58}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#f4f1ea"
                    fontSize={slabRulers.fs}
                    fontFamily="inherit"
                    stroke="rgba(0,0,0,0.35)"
                    strokeWidth={slabRulers.fs * 0.06}
                    paintOrder="stroke fill"
                    style={{ userSelect: "none" }}
                  >
                    {formatSlabRulerInches(xv)}
                  </text>
                </g>
              ))}
              {slabRulers.ys.map((yv) => (
                <g key={`ry-${slab.id}-${yv}`}>
                  <line
                    x1={0}
                    y1={yv}
                    x2={-slabRulers.tick}
                    y2={yv}
                    stroke="rgba(255,255,255,0.75)"
                    strokeWidth={0.07}
                  />
                  <text
                    x={-slabRulers.tick - slabRulers.fs * 0.35}
                    y={yv}
                    dominantBaseline="middle"
                    textAnchor="end"
                    fill="#f4f1ea"
                    fontSize={slabRulers.fs}
                    fontFamily="inherit"
                    stroke="rgba(0,0,0,0.35)"
                    strokeWidth={slabRulers.fs * 0.06}
                    paintOrder="stroke fill"
                    style={{ userSelect: "none" }}
                  >
                    {formatSlabRulerInches(slabRulers.h - yv)}
                  </text>
                </g>
              ))}
            </g>
          </svg>
      </div>
    );

    return (
      <div key={slab.id} ref={setSlabItemRef(slab.id)} className="ls-place-slab-column-item">
        {useColumn && slabs.length >= 1 ? (
          <div
            className={`ls-place-slab-column-head${slab.id === activeSlabId ? " ls-place-slab-column-head--active" : ""}`}
          >
            <div className="ls-place-slab-column-head-main">
              <span
                className="ls-place-slab-column-title ls-place-slab-column-title--focus"
                role="button"
                tabIndex={0}
                title="Choose this slab for new pieces placed from Live Layout Preview"
                onClick={() => onActiveSlab(slab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onActiveSlab(slab.id);
                  }
                }}
              >
                {slab.label}
              </span>
            </div>
            {removable ? (
              <button
                type="button"
                className="ls-btn ls-btn-secondary ls-place-remove-slab-btn"
                aria-label={`Remove ${slab.label}`}
                title="Remove this slab"
                onClick={() => onRemoveSlab(slab.id)}
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
        {showSlabBottomToolbar ? (
          <div className="ls-place-slab-drawing-host ls-place-slab-drawing-host--with-bottom-toolbar">
            <div
              className={`ls-place-slab-bottom-toolbar${!hasMainSlabToolbar ? " ls-place-slab-bottom-toolbar--actions-only" : ""}`}
              role="toolbar"
              aria-label="Slab placement actions"
            >
              {hasMainSlabToolbar ? (
                <div className="ls-place-slab-bottom-toolbar__main">
                  <div
                    className="ls-place-toolbar ls-place-toolbar--slab-bottom"
                    aria-label={showPlacementToolbar ? "Placement on slab" : "Slab piece actions"}
                  >
                    <div className="ls-place-toolbar-inner-row">
                      {showPlacementToolbar ? (
                        <div className="ls-place-rotation-inline" role="group" aria-label="Placement rotation">
                          <span className="ls-place-rotation-heading">Placement</span>
                          <div className="ls-place-rotation-90" role="group" aria-label="Rotate 90° on slab">
                            <button
                              type="button"
                              className="ls-plan-toolbar-btn"
                              disabled={!selectedPl?.slabId}
                              onClick={() => onRotateSelectedPlacementOnSlab?.(-90)}
                              title="Rotate 90° counter-clockwise on slab"
                              aria-label="Rotate 90 degrees counter-clockwise on slab"
                            >
                              <IconRotateCCW />
                            </button>
                            <button
                              type="button"
                              className="ls-plan-toolbar-btn"
                              disabled={!selectedPl?.slabId}
                              onClick={() => onRotateSelectedPlacementOnSlab?.(90)}
                              title="Rotate 90° clockwise on slab"
                              aria-label="Rotate 90 degrees clockwise on slab"
                            >
                              <IconRotateCW />
                            </button>
                          </div>
                          <label className="ls-place-rotation-label">
                            <span className="ls-place-rotation-value">
                              Rotation ({Math.round(selectedPl?.rotation ?? 0)}°)
                            </span>
                            <input
                              className="ls-place-rotation-range"
                              type="range"
                              min={0}
                              max={359}
                              disabled={!selectedPl?.slabId}
                              value={Math.round(selectedPl?.rotation ?? 0)}
                              onPointerDown={() => {
                                if (selectedPl?.slabId) onSelectedPlacementRotationDragStart?.();
                              }}
                              onChange={(e) => onSelectedPlacementRotationLive?.(Number(e.target.value))}
                            />
                          </label>
                        </div>
                      ) : null}
                      {showRemovePieceFromSlab ? (
                        <button
                          type="button"
                          className="ls-btn ls-btn-secondary ls-place-remove-from-slab-btn ls-place-remove-from-slab-btn--in-toolbar"
                          disabled={!canRemoveSelectedFromSlab}
                          onClick={onRemoveSelectedPieceFromSlab}
                          title="Clear this piece from the slab (it stays on the plan)"
                          aria-label="Remove piece from slab"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {showAddSlabHere ? (
                <div className="ls-place-slab-bottom-toolbar__actions">
                  <button
                    type="button"
                    className="ls-btn ls-btn-secondary ls-place-add-slab-below-btn"
                    onClick={onAddSlab}
                    disabled={addSlabDisabled}
                    title={addSlabTitle}
                  >
                    Add slab
                  </button>
                </div>
              ) : null}
            </div>
            {slabStage}
          </div>
        ) : (
          slabStage
        )}
      </div>
    );
  };

  return (
    <>
      <div
        className={`ls-place-wrap${readOnly ? " ls-place-wrap--readonly" : ""}${drag ? " ls-place-wrap--dragging" : ""}`}
        onPointerMove={!readOnly && ppiReady && drag ? handlePointerMove : undefined}
      >
        <div ref={scrollShellRef} className="ls-place-scroll-shell">
          {useTabs ? (
            <div className="ls-place-slab-tabs-row">
              <div className="ls-slab-tabs" role="tablist">
                {slabs.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={s.id === activeSlab.id}
                    className={`ls-slab-tab ${s.id === activeSlab.id ? "is-active" : ""}`}
                    onClick={() => onActiveSlab(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!ppiReady ? (
            <p className="ls-place-ppi-hint ls-muted">
              Set scale on the Plan tab to size pieces on the slab. Slab dimensions below match the catalog (inch rulers).
            </p>
          ) : null}
          {ppiReady && seamMode ? (
            <p className="ls-place-ppi-hint ls-muted">
              Hover an eligible edge on the slab until it turns red, then click to place a seam.
            </p>
          ) : null}
          <div className="ls-place-slab-scroll-pane">
            <div
              className={
                useColumn && slabs.length > 1 ? "ls-place-slab-column" : "ls-place-slab-column ls-place-slab-column--single"
              }
            >
              {slabsToRender.map((slab) => renderSlabStage(slab))}
            </div>
          </div>
        </div>
      </div>
      {seamModal ? (
        <div
          className="ls-seam-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ls-place-seam-modal-title"
          onClick={() => setSeamModal(null)}
        >
          <div className="ls-seam-modal glass-panel" onClick={(e) => e.stopPropagation()}>
            <h2 id="ls-place-seam-modal-title" className="ls-seam-modal-title">
              Place seam
            </h2>
            <p className="ls-seam-modal-sub">
              The seam stays perpendicular to the selected plan edge. Edit one side and the other updates so both dimensions add up to that edge length.
            </p>
            <div className="ls-seam-modal-fields">
              <label className="ls-seam-modal-field">
                {seamModal.geometry.labelA} (in)
                <input
                  className="ls-input"
                  type="number"
                  min={0.125}
                  step={0.125}
                  value={seamModal.valA}
                  onChange={(e) => {
                    const v = e.target.value;
                    const g = seamModal.geometry;
                    const total =
                      g.kind === "vertical" ? g.xMax - g.xMin : g.yMax - g.yMin;
                    const n = parseFloat(v);
                    setSeamModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            valA: v,
                            valB: Number.isFinite(n) ? formatDimInches(total - n) : prev.valB,
                          }
                        : prev
                    );
                  }}
                />
              </label>
              <label className="ls-seam-modal-field">
                {seamModal.geometry.labelB} (in)
                <input
                  className="ls-input"
                  type="number"
                  min={0.125}
                  step={0.125}
                  value={seamModal.valB}
                  onChange={(e) => {
                    const v = e.target.value;
                    const g = seamModal.geometry;
                    const total =
                      g.kind === "vertical" ? g.xMax - g.xMin : g.yMax - g.yMin;
                    const n = parseFloat(v);
                    setSeamModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            valB: v,
                            valA: Number.isFinite(n) ? formatDimInches(total - n) : prev.valA,
                          }
                        : prev
                    );
                  }}
                />
              </label>
            </div>
            <div className="ls-seam-modal-actions">
              <button
                type="button"
                className="ls-btn ls-btn-secondary"
                onClick={() => setSeamModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ls-btn ls-btn-primary"
                onClick={() => {
                  const dimA = Number(seamModal.valA);
                  const dimB = Number(seamModal.valB);
                  if (!Number.isFinite(dimA) || !Number.isFinite(dimB)) return;
                  const ok = onPlaceSeamRequest?.({
                    pieceId: seamModal.pieceId,
                    edgeIndex: seamModal.edgeIndex,
                    dimA,
                    dimB,
                  });
                  if (ok === false) return;
                  setHoverSeamEdge(null);
                  setSeamModal(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
