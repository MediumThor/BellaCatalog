import { useMemo } from "react";
import type { LayoutPiece, LayoutPoint, LayoutSlab, PiecePlacement } from "../types";
import {
  getEffectiveEdgeArcCirclesIn,
  getEffectiveEdgeArcSagittasIn,
  pathDClosedRingWithArcs,
  pieceHasArcEdges,
  sampleArcEdgePointsForStroke,
} from "../utils/blankPlanEdgeArc";
import { planDisplayPoints, planWorldOffset } from "../utils/blankPlanGeometry";
import { centroid, ensureClosedRing, normalizeClosedRing } from "../utils/geometry";
import {
  slabTextureRenderParams,
  slabTextureRenderParamsTrace,
  shouldFillPieceWithSlabTexture,
} from "../utils/slabLayoutTexture";
import { edgeStripLetterLabelByPieceId, pieceLetterLabelByPieceId } from "../utils/pieceLabels";
import { isPlanStripPiece } from "../utils/pieceRoles";
import { clipEdgeStrokeSegmentsForKitchenSinks, coordPerInchForPlan } from "../utils/pieceSinks";
import { PieceSinkCutoutsSvg } from "./PieceSinkCutoutsSvg";

const BLANK_PLAN_WORLD_W_IN = 480;
const BLANK_PLAN_WORLD_H_IN = 240;

type Props = {
  workspaceKind: "blank" | "source";
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  slabs: LayoutSlab[];
  pixelsPerInch: number | null;
  /** Trace/source workflow: stored plan pixel size; falls back to piece bounds. */
  tracePlanWidth?: number | null;
  tracePlanHeight?: number | null;
  showLabels: boolean;
  showDimensions?: boolean;
  selectedPieceId: string | null;
  /** Distinct prefix when multiple previews mount (e.g. inline + modal) so SVG ids stay unique. */
  previewInstanceId?: string;
  /** `fullscreen` removes inline height caps so the preview can fill a large surface. */
  variant?: "inline" | "fullscreen";
  /** When set, clicking a piece outline places it on the active slab (Place phase). */
  onPieceActivate?: (pieceId: string) => void;
};

function blankViewBoxDims(pieces: LayoutPiece[]): { minX: number; minY: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pc of pieces) {
    for (const p of planDisplayPoints(pc, pieces)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, width: BLANK_PLAN_WORLD_W_IN, height: BLANK_PLAN_WORLD_H_IN };
  }
  const pad = 22;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const width = Math.max(maxX - minX, 48);
  const height = Math.max(maxY - minY, 48);
  return { minX, minY, width, height };
}

function piecePathD(piece: LayoutPiece, workspaceKind: "blank" | "source", allPieces: LayoutPiece[]): string {
  if (workspaceKind === "source") {
    const ringOpen = normalizeClosedRing(piece.points);
    const pts = ensureClosedRing(ringOpen);
    return pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`).join(" ") + " Z";
  }
  const disp = planDisplayPoints(piece, allPieces);
  const ringOpen = normalizeClosedRing(disp);
  const ringCen = centroid(ringOpen);
  if (pieceHasArcEdges(piece)) {
    const { ox, oy } = planWorldOffset(piece, allPieces);
    return pathDClosedRingWithArcs(
      ringOpen,
      getEffectiveEdgeArcSagittasIn(piece),
      ringCen,
      getEffectiveEdgeArcCirclesIn(piece),
      { x: ox, y: oy },
    );
  }
  const pts = ensureClosedRing(ringOpen);
  return pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`).join(" ") + " Z";
}

function resolveSlabTex(
  workspaceKind: "blank" | "source",
  piece: LayoutPiece,
  placement: PiecePlacement | undefined,
  slab: LayoutSlab | undefined,
  pixelsPerInch: number,
  allPieces: LayoutPiece[]
): ReturnType<typeof slabTextureRenderParams> | ReturnType<typeof slabTextureRenderParamsTrace> | null {
  if (!placement || !slab) return null;
  if (!shouldFillPieceWithSlabTexture(piece, placement, slab)) return null;
  return workspaceKind === "source"
    ? slabTextureRenderParamsTrace({ piece, placement, slab, pixelsPerInch, allPieces })
    : slabTextureRenderParams({ piece, placement, slab, pixelsPerInch, allPieces });
}

export function PlaceLayoutPreview({
  workspaceKind,
  pieces,
  placements,
  slabs,
  pixelsPerInch,
  tracePlanWidth,
  tracePlanHeight,
  showLabels,
  showDimensions = false,
  selectedPieceId,
  previewInstanceId = "inline",
  variant = "inline",
  onPieceActivate,
}: Props) {
  const pid = previewInstanceId;
  const isFullscreen = variant === "fullscreen";
  const shellClass = `ls-place-layout-preview-shell${isFullscreen ? " ls-place-layout-preview-shell--fullscreen" : ""}`;
  const svgClass = `ls-place-layout-preview-svg${isFullscreen ? " ls-place-layout-preview-svg--fullscreen" : ""}`;
  const placementByPiece = useMemo(() => {
    const m = new Map<string, PiecePlacement>();
    for (const p of placements) m.set(p.pieceId, p);
    return m;
  }, [placements]);

  const slabById = useMemo(() => {
    const m = new Map<string, LayoutSlab>();
    for (const s of slabs) m.set(s.id, s);
    return m;
  }, [slabs]);

  const pieceLetterLabelById = useMemo(() => pieceLetterLabelByPieceId(pieces), [pieces]);
  const stripLetterLabelById = useMemo(() => edgeStripLetterLabelByPieceId(pieces), [pieces]);

  const traceDims = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    for (const pc of pieces) {
      for (const p of pc.points) {
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const w = Math.max(tracePlanWidth ?? 0, maxX, 1);
    const h = Math.max(tracePlanHeight ?? 0, maxY, 1);
    return { w, h };
  }, [pieces, tracePlanWidth, tracePlanHeight]);

  const blankVb = useMemo(() => blankViewBoxDims(pieces), [pieces]);

  const viewBoxStr =
    workspaceKind === "blank"
      ? `${blankVb.minX} ${blankVb.minY} ${blankVb.width} ${blankVb.height}`
      : `0 0 ${traceDims.w} ${traceDims.h}`;

  const coordPerInch = coordPerInchForPlan(workspaceKind, pixelsPerInch);

  /** Blank plan uses inch space; slab texture math still expects a positive PPI for catalog slabs. */
  const effectivePpi =
    workspaceKind === "blank"
      ? pixelsPerInch && pixelsPerInch > 0
        ? pixelsPerInch
        : 1
      : pixelsPerInch;

  if (workspaceKind === "source" && (!pixelsPerInch || pixelsPerInch <= 0)) {
    return (
      <div
        className={`ls-place-layout-preview-empty glass-panel${isFullscreen ? " ls-place-layout-preview-empty--fullscreen" : ""}`}
      >
        <p className="ls-muted">Set scale on the Plan tab to preview mapped material on the layout.</p>
      </div>
    );
  }

  const gradId = `lsPlacePreviewBg-${pid}`;
  const clipId = (pieceId: string) => `ls-place-preview-clip-${pid}-${pieceId}`;

  return (
    <div className={shellClass}>
      <svg
        className={svgClass}
        viewBox={viewBoxStr}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Live layout preview with slab mapping"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#121418" />
            <stop offset="100%" stopColor="#0a0b0d" />
          </linearGradient>
          {pieces.map((piece) => {
            const placement = placementByPiece.get(piece.id);
            const slab =
              placement?.slabId != null ? slabById.get(placement.slabId) : undefined;
            const slabTex =
              placement && slab
                ? resolveSlabTex(workspaceKind, piece, placement, slab, effectivePpi!, pieces)
                : null;
            if (!slabTex) return null;
            return (
              <clipPath key={`c-${piece.id}`} id={clipId(piece.id)}>
                <path d={piecePathD(piece, workspaceKind, pieces)} />
              </clipPath>
            );
          })}
        </defs>
        <rect
          x={workspaceKind === "blank" ? blankVb.minX : 0}
          y={workspaceKind === "blank" ? blankVb.minY : 0}
          width={workspaceKind === "blank" ? blankVb.width : traceDims.w}
          height={workspaceKind === "blank" ? blankVb.height : traceDims.h}
          fill={`url(#${gradId})`}
        />
        {pieces.map((piece, idx) => {
          const sel = piece.id === selectedPieceId;
          const placement = placementByPiece.get(piece.id);
          const slab =
            placement?.slabId != null ? slabById.get(placement.slabId) : undefined;
          const isStrip = isPlanStripPiece(piece);
          const slabTex =
            placement && slab
              ? resolveSlabTex(workspaceKind, piece, placement, slab, effectivePpi!, pieces)
              : null;

          const d = piecePathD(piece, workspaceKind, pieces);
          const ringOpen =
            workspaceKind === "blank"
              ? normalizeClosedRing(planDisplayPoints(piece, pieces))
              : normalizeClosedRing(piece.points);

          const placedMapped = !!slabTex;
          const unplacedNeutral =
            !isStrip && (!placement || !placement.placed || !placement.slabId || !slabTex);

          /** When slab texture is clipped in, avoid opaque fill — but keep a transparent fill when clickable so the hit target exists (`fill="none"` does not receive pointer events). */
          const fill = placedMapped
            ? onPieceActivate
              ? "transparent"
              : "none"
            : isStrip
              ? "rgba(150, 185, 220, 0.14)"
              : unplacedNeutral
                ? "rgba(72, 80, 92, 0.42)"
                : `rgba(120, 200, 255, ${0.07 + (idx % 5) * 0.02})`;

          const MITER_PLAN_STROKE = "#0d47a1";
          const edgeStroke = (ei: number) =>
            piece.edgeTags?.miterEdgeIndices?.includes(ei)
              ? MITER_PLAN_STROKE
              : sel
                ? "rgba(90, 175, 255, 0.98)"
                : placedMapped
                  ? "rgba(200, 210, 225, 0.5)"
                  : "rgba(190, 205, 220, 0.42)";
          const edgeStrokeW = (ei: number) =>
            piece.edgeTags?.miterEdgeIndices?.includes(ei)
              ? 0.2
              : sel
                ? 0.38
                : placedMapped
                  ? 0.22
                  : 0.16;

          const xs = ringOpen.map((q) => q.x);
          const ys = ringOpen.map((q) => q.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const bw = maxX - minX;
          const bh = maxY - minY;
          const bwIn = workspaceKind === "blank" ? bw : bw / Math.max(pixelsPerInch ?? 1, 1);
          const bhIn = workspaceKind === "blank" ? bh : bh / Math.max(pixelsPerInch ?? 1, 1);
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const longHoriz = bw >= bh;
          const labelRot = longHoriz ? 0 : 90;
          const shortSide = Math.min(bw, bh);
          /** Blank plan uses inch space (~1–3 in is readable). Trace/source uses image pixels — uncapped 2.8px is invisible when scaled. */
          const fontSize =
            workspaceKind === "blank"
              ? Math.min(2.8, Math.max(1.05, shortSide * 0.09))
              : Math.max(
                  18,
                  Math.min(shortSide * 0.12, Math.min(traceDims.w, traceDims.h) * 0.045)
                );
          const labelText = isStrip
            ? (stripLetterLabelById.get(piece.id) ?? "—")
            : (pieceLetterLabelById.get(piece.id) ?? piece.name);
          const dimensionText = `${bwIn.toFixed(1)}" x ${bhIn.toFixed(1)}"`;

          const ringCen = centroid(ringOpen);
          const { ox: arcOx, oy: arcOy } = planWorldOffset(piece, pieces);

          return (
            <g key={piece.id}>
              {slabTex ? (
                <g
                  clipPath={`url(#${clipId(piece.id)})`}
                  style={{ pointerEvents: "none" }}
                >
                  <image
                    href={slabTex.imageUrl}
                    x={0}
                    y={0}
                    width={slabTex.widthIn}
                    height={slabTex.heightIn}
                    preserveAspectRatio="none"
                    transform={slabTex.matrixStr}
                    opacity={1}
                    className="ls-slab-layout-fill-image"
                  />
                </g>
              ) : null}
              {sel && placedMapped ? (
                <path
                  d={d}
                  fill="rgba(64, 156, 255, 0.24)"
                  stroke="none"
                  style={{ pointerEvents: "none" }}
                />
              ) : null}
              <path
                d={d}
                fill={fill}
                stroke="none"
                style={
                  onPieceActivate
                    ? { cursor: "pointer", pointerEvents: "auto" }
                    : { pointerEvents: "none" }
                }
                onPointerDown={
                  onPieceActivate
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onPieceActivate(piece.id);
                      }
                    : undefined
                }
              />
              {ringOpen.map((_, ei) => {
                const arcPts = sampleArcEdgePointsForStroke(
                  piece,
                  ei,
                  ringOpen,
                  ringCen,
                  28,
                  { x: arcOx, y: arcOy },
                );
                const segsOut: { a: LayoutPoint; b: LayoutPoint }[] = [];
                for (let k = 0; k < arcPts.length - 1; k++) {
                  segsOut.push(
                    ...clipEdgeStrokeSegmentsForKitchenSinks(
                      arcPts[k]!,
                      arcPts[k + 1]!,
                      piece,
                      pieces,
                      coordPerInch,
                    ),
                  );
                }
                return segsOut.map((s, sj) => (
                  <line
                    key={`${piece.id}-pv-${ei}-${sj}`}
                    x1={s.a.x}
                    y1={s.a.y}
                    x2={s.b.x}
                    y2={s.b.y}
                    stroke={edgeStroke(ei)}
                    strokeWidth={edgeStrokeW(ei)}
                    strokeLinecap="round"
                    style={{ pointerEvents: "none" }}
                  />
                ));
              })}
              {!isPlanStripPiece(piece) ? (
                <PieceSinkCutoutsSvg
                  piece={piece}
                  allPieces={pieces}
                  coordPerInch={coordPerInch}
                  interactive={false}
                  appearance="cutout"
                />
              ) : null}
              {showLabels ? (
                <text
                  transform={`translate(${cx},${cy}) rotate(${labelRot})`}
                  fill={sel ? "rgba(130, 210, 255, 0.95)" : "rgba(244, 241, 234, 0.78)"}
                  fontSize={fontSize}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`ls-place-preview-piece-label${sel ? " ls-place-preview-piece-label--selected" : ""}`}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  <tspan x="0" dy={showDimensions ? "-0.45em" : "0"}>{labelText}</tspan>
                  {showDimensions ? (
                    <tspan x="0" dy="1.15em" className="ls-place-preview-piece-dimension">
                      {dimensionText}
                    </tspan>
                  ) : null}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
