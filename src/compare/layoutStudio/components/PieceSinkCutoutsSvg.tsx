import type { LayoutPiece, PiecePlacement } from "../types";
import {
  FAUCET_HOLE_RADIUS_IN,
  localFaucetHoleCentersInches,
  sinkCenterWorldInDisplay,
  sinkLocalToSlabMatrixStr,
  sinkOutlinePathDLocal,
  sinkTemplateDims,
} from "../utils/pieceSinks";

type Props = {
  piece: LayoutPiece;
  allPieces: LayoutPiece[];
  coordPerInch: number;
  selectedSinkId?: string | null;
  interactive?: boolean;
  onSinkPointerDown?: (sinkId: string, e: React.PointerEvent) => void;
  /** Slab Placement: draw in slab inch space using placement (omit for plan / live preview plan coords). */
  slabPlacement?: PiecePlacement | null;
  /** Required with `slabPlacement` — same PPI used for {@link piecePolygonInches}. */
  pixelsPerInchForSlab?: number;
  /** Stronger fill so sinks read as cutouts on stone / tinted pieces. */
  appearance?: "default" | "cutout";
};

export function PieceSinkCutoutsSvg({
  piece,
  allPieces,
  coordPerInch,
  selectedSinkId,
  interactive,
  onSinkPointerDown,
  slabPlacement,
  pixelsPerInchForSlab,
  appearance = "default",
}: Props) {
  const sinks = piece.sinks ?? [];
  if (sinks.length === 0) return null;

  const slabMode =
    slabPlacement != null &&
    pixelsPerInchForSlab != null &&
    pixelsPerInchForSlab > 0;
  const inchForPath = slabMode ? 1 : coordPerInch;

  const fillCut =
    appearance === "cutout" ? "rgba(6, 8, 12, 0.88)" : "rgba(8, 10, 14, 0.22)";
  const strokeCut =
    appearance === "cutout" ? "rgba(255, 255, 255, 0.22)" : undefined;
  const strokeSel =
    appearance === "cutout" ? "rgba(232, 212, 139, 0.95)" : "rgba(232, 212, 139, 0.92)";
  const strokeNorm =
    appearance === "cutout" ? "rgba(200, 210, 225, 0.45)" : "rgba(140, 190, 255, 0.55)";
  const holeFill =
    appearance === "cutout" ? "rgba(0, 0, 0, 0.5)" : "rgba(0,0,0,0.2)";
  const holeStroke =
    appearance === "cutout" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.4)";

  return (
    <g className="ls-piece-sinks" style={{ pointerEvents: interactive ? "auto" : "none" }}>
      {sinks.map((sink) => {
        const pathD = sinkOutlinePathDLocal(sink, inchForPath);
        const holes = localFaucetHoleCentersInches(sink);
        const hr = FAUCET_HOLE_RADIUS_IN * inchForPath;
        const sel = sink.id === selectedSinkId;
        const dims = sinkTemplateDims(sink.templateKind);
        const wIn = dims.widthIn * inchForPath;
        const hIn = dims.depthIn * inchForPath;
        const labelName = sink.name.trim();
        const baseFont = Math.min(
          1.0 * inchForPath,
          Math.max(0.28 * inchForPath, Math.min(wIn, hIn) * 0.045),
        );
        const fitByWidth =
          labelName.length > 0
            ? (wIn * 0.82) / Math.max(labelName.length * 0.55, 1)
            : baseFont;
        const labelFontSize =
          labelName.length > 0 ? Math.min(baseFont, fitByWidth) : baseFont;
        /** 200% larger than base sizing, still capped to sink width. */
        const displayFontSize =
          labelName.length > 0 ? Math.min(labelFontSize * 2, fitByWidth) : labelFontSize;
        const insetFromFrontRim = Math.max(0.1 * inchForPath, displayFontSize * 0.42);
        /** One inch toward back (−Y) from the front rim line. */
        const labelAwayFromFrontIn = 1 * inchForPath;
        const labelY = hIn / 2 - insetFromFrontRim - labelAwayFromFrontIn;

        const transformSlab =
          slabMode && slabPlacement
            ? sinkLocalToSlabMatrixStr(sink, piece, slabPlacement, pixelsPerInchForSlab, allPieces)
            : null;
        const c = sinkCenterWorldInDisplay(sink, piece, allPieces);
        const transformPlan = `translate(${c.x},${c.y}) rotate(${sink.rotationDeg})`;

        return (
          <g key={sink.id}>
            <g
              transform={transformSlab ?? transformPlan}
              style={interactive ? { cursor: "grab" } : undefined}
              onPointerDown={
                interactive
                  ? (e) => {
                      e.stopPropagation();
                      onSinkPointerDown?.(sink.id, e);
                    }
                  : undefined
              }
            >
              <path
                d={pathD}
                fill={fillCut}
                stroke={sel ? strokeSel : strokeCut ?? strokeNorm}
                strokeWidth={sel ? 0.2 : appearance === "cutout" ? 0.1 : 0.14}
              />
              {holes.map((h, i) => (
                <circle
                  key={`h-${i}`}
                  cx={h.x}
                  cy={h.y}
                  r={hr}
                  fill={holeFill}
                  stroke={holeStroke}
                  strokeWidth={0.06}
                />
              ))}
              {labelName ? (
                <text
                  className="ls-sink-cutout-name"
                  x={0}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={displayFontSize}
                >
                  {labelName}
                </text>
              ) : null}
            </g>
          </g>
        );
      })}
    </g>
  );
}
