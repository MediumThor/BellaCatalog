import type { LayoutPiece, PiecePlacement } from "../types";
import {
  OUTLET_CUTOUT_HEIGHT_IN,
  OUTLET_CUTOUT_WIDTH_IN,
  outletCenterWorldInDisplay,
  outletLocalToSlabMatrixStr,
  outletOutlinePathDLocal,
} from "../utils/pieceOutlets";

type Props = {
  piece: LayoutPiece;
  allPieces: LayoutPiece[];
  coordPerInch: number;
  selectedOutletId?: string | null;
  showLabels?: boolean;
  interactive?: boolean;
  onOutletPointerDown?: (outletId: string, e: React.PointerEvent) => void;
  /** Slab placement: draw in slab inch space (omit for plan / ortho editor). */
  slabPlacement?: PiecePlacement | null;
  /** Required with `slabPlacement` — same PPI used for piece polygons on the slab. */
  pixelsPerInchForSlab?: number;
  appearance?: "default" | "cutout" | "trace";
};

export function PieceOutletCutoutsSvg({
  piece,
  allPieces,
  coordPerInch,
  selectedOutletId,
  showLabels = true,
  interactive,
  onOutletPointerDown,
  slabPlacement,
  pixelsPerInchForSlab,
  appearance = "default",
}: Props) {
  const outlets = piece.outlets ?? [];
  if (outlets.length === 0) return null;

  const slabMode =
    slabPlacement != null &&
    pixelsPerInchForSlab != null &&
    pixelsPerInchForSlab > 0;
  const inchForPath = slabMode ? 1 : coordPerInch;
  const pathD = outletOutlinePathDLocal(inchForPath);

  const fillCut =
    appearance === "cutout"
      ? "rgba(6, 8, 12, 0.88)"
      : appearance === "trace"
        ? "rgba(10, 16, 26, 0.58)"
        : "rgba(8, 10, 14, 0.22)";
  const strokeCut =
    appearance === "cutout"
      ? "rgba(255, 255, 255, 0.22)"
      : appearance === "trace"
        ? "rgba(255, 244, 204, 0.96)"
        : undefined;
  const strokeSel =
    appearance === "cutout" || appearance === "trace"
      ? "rgba(232, 212, 139, 0.98)"
      : "rgba(232, 212, 139, 0.92)";
  const strokeNorm =
    appearance === "cutout"
      ? "rgba(200, 210, 225, 0.45)"
      : appearance === "trace"
        ? "rgba(255, 244, 204, 0.88)"
        : "rgba(140, 190, 255, 0.55)";

  const wIn = OUTLET_CUTOUT_WIDTH_IN * inchForPath;
  const hIn = OUTLET_CUTOUT_HEIGHT_IN * inchForPath;
  const labelFont = Math.min(
    1.0 * inchForPath,
    Math.max(0.22 * inchForPath, Math.min(wIn, hIn) * 0.08),
  );
  const labelY = hIn / 2 - Math.max(0.12 * inchForPath, labelFont * 0.35);

  return (
    <g className="ls-piece-outlets" style={{ pointerEvents: interactive ? "auto" : "none" }}>
      {outlets.map((outlet) => {
        const sel = outlet.id === selectedOutletId;
        const strokeW = sel
          ? Math.max(0.16, inchForPath * 0.01)
          : appearance === "trace"
            ? Math.max(0.12, inchForPath * 0.007)
            : appearance === "cutout"
              ? 0.09
              : 0.12;
        const transformSlab =
          slabMode && slabPlacement != null && pixelsPerInchForSlab != null
            ? outletLocalToSlabMatrixStr(
                outlet,
                piece,
                slabPlacement,
                pixelsPerInchForSlab,
                allPieces,
              )
            : null;
        const c = outletCenterWorldInDisplay(outlet, piece, allPieces);
        const transformPlan = `translate(${c.x},${c.y}) rotate(${outlet.rotationDeg})`;

        return (
          <g key={outlet.id}>
            <g
              transform={transformSlab ?? transformPlan}
              style={interactive ? { cursor: "grab" } : undefined}
              onPointerDown={
                interactive
                  ? (e) => {
                      e.stopPropagation();
                      onOutletPointerDown?.(outlet.id, e);
                    }
                  : undefined
              }
            >
              <path
                d={pathD}
                fill={fillCut}
                stroke={sel ? strokeSel : strokeCut ?? strokeNorm}
                strokeWidth={strokeW}
              />
              {showLabels ? (
                <text
                  className="ls-outlet-cutout-label"
                  x={0}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={labelFont}
                  fill={appearance === "trace" ? "rgba(255, 244, 204, 0.92)" : "rgba(220, 225, 235, 0.92)"}
                >
                  Outlet
                </text>
              ) : null}
            </g>
          </g>
        );
      })}
    </g>
  );
}
