import { useMemo } from "react";
import type { FaucetEvenHoleBias, FaucetSpreadIn, PieceSinkCutout, PieceSinkTemplateKind } from "../types";
import {
  FAUCET_DECK_EXTRA_OFFSET_IN,
  FAUCET_DECK_GAP_IN,
  FAUCET_HOLE_RADIUS_IN,
  faucetHoleCentersXInches,
  sinkOutlinePathDLocal,
  sinkTemplateDims,
} from "../utils/pieceSinks";

type Props = {
  templateKind: PieceSinkTemplateKind;
  faucetHoleCount: number;
  spreadIn: FaucetSpreadIn;
  evenHoleBias: FaucetEvenHoleBias;
  /** When placing from a selected piece edge, rotate preview to match wall alignment. */
  previewRotationDeg?: number;
};

function rotatePt(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function AddSinkPreviewSvg({
  templateKind,
  faucetHoleCount,
  spreadIn,
  evenHoleBias,
  previewRotationDeg = 0,
}: Props) {
  const n = Math.max(1, Math.min(5, Math.floor(faucetHoleCount) || 1));
  const dims = sinkTemplateDims(templateKind);
  const w = dims.widthIn;
  const h = dims.depthIn;

  const previewSink = useMemo((): PieceSinkCutout => {
    return {
      id: "preview",
      name: "",
      templateKind,
      centerX: 0,
      centerY: 0,
      rotationDeg: 0,
      faucetHoleCount: n,
      spreadIn,
      evenHoleBias: n === 2 || n === 4 ? evenHoleBias : undefined,
    };
  }, [templateKind, n, spreadIn, evenHoleBias]);

  const pathD = useMemo(() => sinkOutlinePathDLocal(previewSink, 1), [previewSink]);

  const xs = useMemo(
    () => faucetHoleCentersXInches(n, spreadIn, n === 2 || n === 4 ? evenHoleBias : undefined),
    [n, spreadIn, evenHoleBias]
  );

  const yDeck =
    -h / 2 - FAUCET_HOLE_RADIUS_IN - FAUCET_DECK_GAP_IN - FAUCET_DECK_EXTRA_OFFSET_IN;
  const hr = FAUCET_HOLE_RADIUS_IN;
  const centerlineHalfLength = Math.max(
    h / 2 + 1.5,
    Math.abs(yDeck - hr) + 1.25,
    Math.abs(yDeck + hr) + 1.25,
  );

  const { minX, minY, width, height } = useMemo(() => {
    const pad = 0.75;
    const pts: { x: number; y: number }[] = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
    for (const x of xs) {
      pts.push({ x, y: yDeck - hr });
      pts.push({ x, y: yDeck + hr });
      pts.push({ x: x - hr, y: yDeck });
      pts.push({ x: x + hr, y: yDeck });
    }
    pts.push({ x: 0, y: -centerlineHalfLength });
    pts.push({ x: 0, y: centerlineHalfLength });
    let minX0 = Infinity;
    let minY0 = Infinity;
    let maxX0 = -Infinity;
    let maxY0 = -Infinity;
    for (const p of pts) {
      const q = rotatePt(p.x, p.y, previewRotationDeg);
      minX0 = Math.min(minX0, q.x);
      minY0 = Math.min(minY0, q.y);
      maxX0 = Math.max(maxX0, q.x);
      maxY0 = Math.max(maxY0, q.y);
    }
    return {
      minX: minX0 - pad,
      minY: minY0 - pad,
      width: maxX0 - minX0 + 2 * pad,
      height: maxY0 - minY0 + 2 * pad,
    };
  }, [w, h, xs, yDeck, hr, previewRotationDeg, centerlineHalfLength]);

  return (
    <div className="ls-add-sink-preview">
      <p className="ls-add-sink-preview-title">
        Preview{Math.abs(previewRotationDeg) > 0.05 ? " (rotated to selected edge)" : ""}
      </p>
      <div className="ls-add-sink-preview-svg-wrap">
        <svg
          className="ls-add-sink-preview-svg"
          viewBox={`${minX} ${minY} ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          <rect
            x={minX}
            y={minY}
            width={width}
            height={height}
            fill="rgba(12,14,18,0.5)"
            rx={0.4}
          />
          <g transform={`rotate(${previewRotationDeg})`}>
            <path
              d={pathD}
              fill="rgba(100,140,200,0.15)"
              stroke="rgba(180,210,255,0.65)"
              strokeWidth={0.12}
            />
            {xs.map((x, i) => (
              <circle
                key={i}
                cx={x}
                cy={yDeck}
                r={hr}
                fill="rgba(40,50,65,0.35)"
                stroke="rgba(232,212,139,0.75)"
                strokeWidth={0.08}
              />
            ))}
            <line
              x1={0}
              y1={-centerlineHalfLength}
              x2={0}
              y2={centerlineHalfLength}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={0.06}
              strokeDasharray="0.4 0.25"
            />
          </g>
        </svg>
      </div>
      <p className="ls-add-sink-preview-note">
        Dashed line: sink centerline (one hole always on this line).
        {n === 1
          ? " Single hole."
          : n === 2 || n === 4
            ? ` Extra holes biased ${evenHoleBias} of center · ${spreadIn}" center to center between neighbors.`
            : ` Symmetric · ${spreadIn}" center to center.`}
      </p>
    </div>
  );
}
