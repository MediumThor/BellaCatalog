import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutPiece, LayoutSlab, PiecePlacement } from "../types";
import { pieceIdsWithSlabPlacementOverlap } from "../utils/placementOverlap";
import { pieceLetterLabelByPieceId, splashLetterLabelByPieceId } from "../utils/pieceLabels";
import {
  mirrorLocalInches,
  piecePolygonInches,
  transformedPieceInches,
} from "../utils/pieceInches";
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
};

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
}: Props) {
  const svgRefs = useRef<Map<string, SVGSVGElement | null>>(new Map());
  /** Last slab used during an active drag (handles gaps between slab cards). */
  const lastDragSlabRef = useRef<string | null>(null);
  const [drag, setDrag] = useState<{
    pieceId: string;
    slabId: string;
    startClient: { x: number; y: number };
    startPlacement: PiecePlacement;
    /** Pointer position minus piece centroid in slab inch space at pointer-down. */
    grabOffset: { x: number; y: number };
  } | null>(null);

  const activeSlab = slabs.find((s) => s.id === activeSlabId) ?? slabs[0] ?? null;

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

  const placementsRef = useRef(placements);
  placementsRef.current = placements;

  const dragRef = useRef(drag);
  dragRef.current = drag;

  const collidingPieceIds = useMemo(
    () =>
      pieceIdsWithSlabPlacementOverlap({
        pieces,
        placements,
        pixelsPerInch,
      }),
    [pieces, placements, pixelsPerInch]
  );

  const pieceLetterLabelById = useMemo(() => pieceLetterLabelByPieceId(pieces), [pieces]);
  const splashLetterLabelById = useMemo(() => splashLetterLabelByPieceId(pieces), [pieces]);

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

  const handlePointerDownPiece = (pieceId: string, slabId: string, ev: React.PointerEvent) => {
    if (readOnly) return;
    if (!pixelsPerInch || pixelsPerInch <= 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    const pl = placementByPiece.get(pieceId);
    const slab = slabs.find((s) => s.id === slabId);
    if (!pl || !slab) return;
    const pointerInSlab = clientToSlab(slabId, ev.clientX, ev.clientY);
    if (!pointerInSlab) return;
    onSelectPiece(pieceId);
    onPlacementInteractionStart?.();
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
      const targetSlabId =
        resolveSlabUnderPointer(ev.clientX, ev.clientY) ??
        lastDragSlabRef.current ??
        drag.startPlacement.slabId;
      if (!targetSlabId) return;
      const slab = slabs.find((s) => s.id === targetSlabId);
      if (!slab) return;
      const p = clientToSlab(targetSlabId, ev.clientX, ev.clientY);
      if (!p) return;
      lastDragSlabRef.current = targetSlabId;
      updatePlacement(drag.pieceId, {
        x: p.x - drag.grabOffset.x,
        y: p.y - drag.grabOffset.y,
        slabId: targetSlabId,
        placed: true,
      });
    },
    [drag, resolveSlabUnderPointer, slabs, clientToSlab, updatePlacement]
  );

  const handleEndDrag = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    if (!readOnly && pixelsPerInch && pixelsPerInch > 0) {
      const colliding = pieceIdsWithSlabPlacementOverlap({
        pieces,
        placements: placementsRef.current,
        pixelsPerInch,
      });
      if (colliding.has(d.pieceId)) {
        onPlacementChange(
          placementsRef.current.map((p) =>
            p.pieceId === d.pieceId ? { ...p, ...d.startPlacement } : p
          )
        );
      }
    }
    setDrag(null);
    lastDragSlabRef.current = null;
  }, [pieces, pixelsPerInch, onPlacementChange, readOnly]);

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

  /** Clicking slab stone (not a piece) focuses this slab for “place from Live Layout Preview” and deselects pieces. */
  const handleSvgBackgroundPointerDown =
    (slabId: string) => (ev: React.PointerEvent<SVGSVGElement>) => {
      if (readOnly) return;
      const tag = (ev.target as Element | null)?.tagName?.toLowerCase();
      if (tag === "polygon") return;
      onActiveSlab(slabId);
      onSelectPiece(null);
    };

  const setSvgRef = (slabId: string) => (el: SVGSVGElement | null) => {
    if (el) svgRefs.current.set(slabId, el);
    else svgRefs.current.delete(slabId);
  };

  if (!activeSlab) {
    return (
      <div className="ls-place-empty glass-panel">
        <p className="ls-trace-empty-title">No slab image for this option</p>
        <p className="ls-muted">Add a catalog product with slab art to preview placement.</p>
      </div>
    );
  }

  const ppiReady = !!(pixelsPerInch && pixelsPerInch > 0);

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

    const slabStage = (
      <div className="ls-place-stage ls-place-stage--slab-aspect" style={aspectStyle}>
          <svg
            ref={setSvgRef(slab.id)}
            data-slab-id={slab.id}
            className="ls-place-svg"
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={readOnly || !ppiReady ? undefined : handleSvgBackgroundPointerDown(slab.id)}
            width="100%"
            height="100%"
          >
            <image
              href={slab.imageUrl}
              x={0}
              y={0}
              width={slab.widthIn}
              height={slab.heightIn}
              preserveAspectRatio="none"
            />
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
                  const isSplash = piece.pieceRole === "splash";
                  const labelText = isSplash
                    ? (splashLetterLabelById.get(piece.id) ?? "—")
                    : (pieceLetterLabelById.get(piece.id) ?? piece.name);
                  const xs = rotated.map((q) => q.x);
                  const ys = rotated.map((q) => q.y);
                  const bw = Math.max(...xs) - Math.min(...xs);
                  const bh = Math.max(...ys) - Math.min(...ys);
                  const shortSide = Math.min(bw, bh);
                  const baseFont = Math.min(2.2, Math.max(0.55, shortSide * 0.11));
                  const fontSize = isSplash
                    ? Math.min(3.4, Math.max(1.05, baseFont * 1.65))
                    : baseFont;
                  const longHoriz = bw >= bh;
                  const labelRot = longHoriz ? 0 : 90;
                  const colliding = collidingPieceIds.has(piece.id);
                  const fill = colliding
                    ? sel
                      ? "rgba(230, 55, 55, 0.42)"
                      : "rgba(220, 45, 45, 0.36)"
                    : sel
                      ? "rgba(201,162,39,0.28)"
                      : "rgba(120,200,255,0.2)";
                  return (
                    <g key={piece.id}>
                    <polygon
                      className="ls-place-piece-border"
                      points={pts}
                      fill={fill}
                      style={{
                        cursor: readOnly ? "default" : "grab",
                        pointerEvents:
                          drag?.pieceId === piece.id && !readOnly ? "none" : undefined,
                      }}
                      onPointerDown={(e) => handlePointerDownPiece(piece.id, slab.id, e)}
                    />
                      {!isSplash && (piece.sinks?.length ?? 0) > 0 ? (
                        <PieceSinkCutoutsSvg
                          piece={piece}
                          allPieces={pieces}
                          coordPerInch={1}
                          slabPlacement={pl}
                          pixelsPerInchForSlab={pixelsPerInch!}
                          appearance="cutout"
                          interactive={false}
                        />
                      ) : null}
                      {showPieceLabels ? (
                        <text
                          transform={`translate(${pl.x},${pl.y}) rotate(${labelRot})`}
                          fill="#d32f2f"
                          fontSize={fontSize}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="ls-place-piece-label"
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {labelText}
                        </text>
                      ) : null}
                    </g>
                  );
                })
              : null}
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
      <div key={slab.id} className="ls-place-slab-column-item">
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
            {slabStage}
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
          </div>
        ) : (
          slabStage
        )}
      </div>
    );
  };

  return (
    <div
      className={`ls-place-wrap${readOnly ? " ls-place-wrap--readonly" : ""}${drag ? " ls-place-wrap--dragging" : ""}`}
      onPointerMove={!readOnly && ppiReady && drag ? handlePointerMove : undefined}
    >
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
      <div
        className={
          useColumn && slabs.length > 1 ? "ls-place-slab-column" : "ls-place-slab-column ls-place-slab-column--single"
        }
      >
        {slabsToRender.map((slab) => renderSlabStage(slab))}
      </div>
    </div>
  );
}
