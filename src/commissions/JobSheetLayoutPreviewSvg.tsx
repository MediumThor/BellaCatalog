/**
 * JobSheetLayoutPreviewSvg — printer-friendly inline SVG of an area's
 * Layout Studio plan for the printed job sheet. Replaces the saved
 * raster preview (which has a dark background baked in and is
 * unreadable on a black-and-white print) with crisp piece outlines,
 * sink cutouts, and per-piece labels on a white background.
 *
 * Coordinate system mirrors the Layout Studio plan view:
 *   - Blank workspace: 1 unit = 1 inch (after `planTransform`).
 *   - Source workspace: source-image pixels (after page calibration).
 *
 * Both cases collapse to the same world-display coordinate space via
 * `planDisplayPoints`, so the same render loop works for either.
 *
 * No fills (printer-friendly), thin black strokes for piece outlines,
 * lighter gray for cutouts, and a centroid-anchored label for each
 * piece so the install crew can match the drawing back to the piece
 * names in the materials table.
 */
import type { JSX } from "react";
import type { LayoutPiece, LayoutPoint, SavedJobLayoutPlan } from "../compare/layoutStudio/types";
import { planDisplayPoints } from "../compare/layoutStudio/utils/blankPlanGeometry";
import { ensureClosedRing, normalizeClosedRing } from "../compare/layoutStudio/utils/geometry";
import {
  coordPerInchForPlan,
  sinkCenterWorldInDisplay,
  sinkOutlinePathDLocal,
  localFaucetHoleCentersInches,
  FAUCET_HOLE_RADIUS_IN,
} from "../compare/layoutStudio/utils/pieceSinks";
import { piecePixelsPerInch } from "../compare/layoutStudio/utils/sourcePages";
import { tracePiecesViewBoxDims } from "../compare/layoutStudio/utils/tracePiecesViewBox";

type Props = {
  plan: SavedJobLayoutPlan | null | undefined;
  /** Optional aria/title text — defaults to "Layout preview". */
  label?: string;
};

const BLANK_WORLD_PAD_IN = 16;

/**
 * Bounding box of all piece vertices in display coordinates. Mirrors
 * the math in `captureSimplifiedPlanPreview` so the SVG framing
 * matches the in-app preview the user sees while building the layout.
 */
function planViewBox(
  pieces: LayoutPiece[],
  workspaceKind: "blank" | "source"
): { minX: number; minY: number; width: number; height: number } | null {
  if (pieces.length === 0) return null;
  if (workspaceKind === "blank") {
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
    if (!Number.isFinite(minX)) return null;
    return {
      minX: minX - BLANK_WORLD_PAD_IN,
      minY: minY - BLANK_WORLD_PAD_IN,
      width: Math.max(maxX - minX + 2 * BLANK_WORLD_PAD_IN, 32),
      height: Math.max(maxY - minY + 2 * BLANK_WORLD_PAD_IN, 32),
    };
  }
  return tracePiecesViewBoxDims(pieces, null, null);
}

function pieceRingForRender(
  piece: LayoutPiece,
  workspaceKind: "blank" | "source",
  allPieces: LayoutPiece[]
): LayoutPoint[] {
  const open =
    workspaceKind === "blank"
      ? normalizeClosedRing(planDisplayPoints(piece, allPieces))
      : normalizeClosedRing(piece.points);
  return ensureClosedRing(open);
}

function ringToPathD(ring: LayoutPoint[]): string {
  if (ring.length < 2) return "";
  let d = `M ${ring[0].x} ${ring[0].y}`;
  for (let i = 1; i < ring.length; i++) {
    d += ` L ${ring[i].x} ${ring[i].y}`;
  }
  return `${d} Z`;
}

/**
 * Polygon centroid via the shoelace formula. Falls back to the
 * vertex-mean for degenerate (zero-area) rings so labels never
 * disappear off-canvas on near-collinear shapes.
 */
function ringCentroid(ring: LayoutPoint[]): LayoutPoint {
  const open =
    ring.length > 1 &&
    ring[0].x === ring[ring.length - 1].x &&
    ring[0].y === ring[ring.length - 1].y
      ? ring.slice(0, -1)
      : ring.slice();
  const n = open.length;
  if (n === 0) return { x: 0, y: 0 };
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = open[i];
    const b = open[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    let sx = 0;
    let sy = 0;
    for (const p of open) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/**
 * Sink + faucet hole geometry rendered in the same display frame as
 * the piece outline. The sink path is authored in sink-local inches,
 * so we wrap it in a translate/rotate that matches `localToWorldDisplay`
 * (translate to the world-display sink center, then rotate by
 * `sink.rotationDeg`). The local path is already in display units when
 * `coordPerInch` reflects the active workspace scale.
 */
function PieceSinkOverlay({
  piece,
  pieces,
  workspaceKind,
  pixelsPerInch,
  strokeWidth,
}: {
  piece: LayoutPiece;
  pieces: LayoutPiece[];
  workspaceKind: "blank" | "source";
  pixelsPerInch: number | null;
  strokeWidth: number;
}): JSX.Element | null {
  const sinks = piece.sinks ?? [];
  if (sinks.length === 0) return null;
  const coordPerInch =
    workspaceKind === "source"
      ? piecePixelsPerInch(piece, pixelsPerInch) ?? 1
      : coordPerInchForPlan(workspaceKind, pixelsPerInch);
  return (
    <g>
      {sinks.map((sink) => {
        const center = sinkCenterWorldInDisplay(sink, piece, pieces);
        const d = sinkOutlinePathDLocal(sink, coordPerInch);
        const holes = localFaucetHoleCentersInches(sink, coordPerInch);
        const holeR = FAUCET_HOLE_RADIUS_IN * coordPerInch;
        return (
          <g
            key={sink.id}
            transform={`translate(${center.x} ${center.y}) rotate(${sink.rotationDeg})`}
          >
            <path
              d={d}
              fill="none"
              stroke="#444"
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
            />
            {holes.map((h, i) => (
              <circle
                key={i}
                cx={h.x}
                cy={h.y}
                r={holeR}
                fill="none"
                stroke="#666"
                strokeWidth={strokeWidth * 0.75}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

export function JobSheetLayoutPreviewSvg({ plan, label }: Props): JSX.Element | null {
  if (!plan?.pieces?.length) return null;
  const workspaceKind: "blank" | "source" = plan.workspaceKind ?? "source";
  const pieces = plan.pieces;
  const vb = planViewBox(pieces, workspaceKind);
  if (!vb || vb.width <= 0 || vb.height <= 0) return null;

  /**
   * Pick a label size that scales with the view's smaller dimension.
   * Source-workspace coordinates are in pixels (often thousands); blank
   * workspace is in inches (often tens). Both collapse to roughly the
   * same visual size by tying font + stroke to the viewBox dimensions
   * directly and letting `vector-effect: non-scaling-stroke` keep
   * strokes crisp at print resolution.
   */
  const minDim = Math.min(vb.width, vb.height);
  const labelSize = Math.max(8, minDim * 0.04);
  const strokeWidth = Math.max(0.5, minDim * 0.004);

  const pixelsPerInch = plan.calibration?.pixelsPerInch ?? null;

  return (
    <svg
      className="job-sheet__preview-svg"
      viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`}
      role="img"
      aria-label={label ?? "Layout preview"}
      preserveAspectRatio="xMidYMid meet"
    >
      <g>
        {pieces.map((piece) => {
          const ring = pieceRingForRender(piece, workspaceKind, pieces);
          if (ring.length < 3) return null;
          const d = ringToPathD(ring);
          return (
            <path
              key={`outline-${piece.id}`}
              d={d}
              fill="none"
              stroke="#111"
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>
      <g>
        {pieces.map((piece) => (
          <PieceSinkOverlay
            key={`sinks-${piece.id}`}
            piece={piece}
            pieces={pieces}
            workspaceKind={workspaceKind}
            pixelsPerInch={pixelsPerInch}
            strokeWidth={strokeWidth}
          />
        ))}
      </g>
      <g>
        {pieces.map((piece) => {
          const ring = pieceRingForRender(piece, workspaceKind, pieces);
          if (ring.length < 3) return null;
          const text = (piece.name ?? "").trim();
          if (!text) return null;
          const c = ringCentroid(ring);
          return (
            <text
              key={`label-${piece.id}`}
              x={c.x}
              y={c.y}
              fontSize={labelSize}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fill="#111"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {text}
            </text>
          );
        })}
      </g>
    </svg>
  );
}
