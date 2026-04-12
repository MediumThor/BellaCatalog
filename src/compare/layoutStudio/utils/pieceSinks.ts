import type {
  FaucetEvenHoleBias,
  LayoutPiece,
  LayoutPoint,
  PiecePlacement,
  PieceSinkCutout,
  PieceSinkTemplateKind,
} from "../types";
import { outwardNormalForEdge, planDisplayPoints } from "./blankPlanGeometry";
import { ensureClosedRing, normalizeClosedRing, pointInPolygon } from "./geometry";
import { worldDisplayToSlabInches } from "./pieceInches";

/** Standard drill for widespread / single-hole faucet drilling on deck. */
export const FAUCET_HOLE_DIAMETER_IN = 1.375;
export const FAUCET_HOLE_RADIUS_IN = FAUCET_HOLE_DIAMETER_IN / 2;
/**
 * Clearance from the sink cutout’s back rim (y = −depth/2) to the faucet hole’s rim that faces the bowl,
 * so holes sit on deck material outside the cutout.
 */
export const FAUCET_DECK_GAP_IN = 0.125;
/** Additional setback of faucet centers from the cutout (inches), beyond rim + hole radius + gap. */
export const FAUCET_DECK_EXTRA_OFFSET_IN = 1;
/** Perpendicular distance from the selected piece edge to the sink’s front rim / oval front (inches). */
export const SINK_FRONT_SETBACK_FROM_EDGE_IN = 4;

export interface SinkTemplateDims {
  widthIn: number;
  depthIn: number;
  cornerRadiusIn: number;
  shape: "rectangle" | "oval";
}

/**
 * Base rotation (degrees) from edge geometry; combined with +180° so local +Y (bowl / front rim toward the
 * room) aligns with the edge **outward** normal, and local −Y (faucet deck) is toward the piece interior.
 */
function sinkRotationDegFromEdgeBase(
  piece: LayoutPiece,
  edgeIndex: number,
  allPieces: readonly LayoutPiece[]
): number | null {
  const display = planDisplayPoints(piece, allPieces);
  const ring = normalizeClosedRing(display);
  const n = ring.length;
  if (n < 3 || edgeIndex < 0 || edgeIndex >= n) return null;
  const outward = outwardNormalForEdge(display, edgeIndex);
  return (Math.atan2(outward.x, -outward.y) * 180) / Math.PI;
}

/**
 * Rotation (degrees) for preview and placement: bowl opens into the piece; faucet deck faces the selected
 * wall edge (180° from the raw edge normal mapping so holes sit on the physical back deck).
 */
export function sinkRotationDegFromEdge(
  piece: LayoutPiece,
  edgeIndex: number,
  allPieces: readonly LayoutPiece[]
): number | null {
  const base = sinkRotationDegFromEdgeBase(piece, edgeIndex, allPieces);
  if (base == null) return null;
  return base + 180;
}

/**
 * Canonical center + rotation: **front** rim (or oval front) lies {@link SINK_FRONT_SETBACK_FROM_EDGE_IN}
 * inward from the edge (into the piece). With {@link sinkRotationDegFromEdge}, local +Y is along the edge
 * outward normal, so the front rim is at center + outward×(depth/2); solving for center gives inward×(setback + depth/2).
 */
export function sinkPlacementFromEdgeInCanonical(
  piece: LayoutPiece,
  edgeIndex: number,
  allPieces: readonly LayoutPiece[],
  templateKind: PieceSinkTemplateKind
): { centerX: number; centerY: number; rotationDeg: number } | null {
  const display = planDisplayPoints(piece, allPieces);
  const ring = normalizeClosedRing(display);
  const n = ring.length;
  if (n < 3 || edgeIndex < 0 || edgeIndex >= n) return null;
  const outward = outwardNormalForEdge(display, edgeIndex);
  const inward = { x: -outward.x, y: -outward.y };
  const a = ring[edgeIndex]!;
  const b = ring[(edgeIndex + 1) % n]!;
  const M = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dims = sinkTemplateDims(templateKind);
  const depth = dims.depthIn;
  const along = SINK_FRONT_SETBACK_FROM_EDGE_IN + depth / 2;
  const Cworld = {
    x: M.x + inward.x * along,
    y: M.y + inward.y * along,
  };
  const ox = piece.planTransform?.x ?? 0;
  const oy = piece.planTransform?.y ?? 0;
  const rot = sinkRotationDegFromEdge(piece, edgeIndex, allPieces);
  if (rot == null) return null;
  return {
    centerX: Cworld.x - ox,
    centerY: Cworld.y - oy,
    rotationDeg: rot,
  };
}

export function sinkTemplateDims(kind: PieceSinkTemplateKind): SinkTemplateDims {
  switch (kind) {
    case "kitchen":
      return { widthIn: 30, depthIn: 16, cornerRadiusIn: 0.7, shape: "rectangle" };
    case "vanitySquare":
      return { widthIn: 17, depthIn: 14, cornerRadiusIn: 0.7, shape: "rectangle" };
    case "vanityRound":
      return { widthIn: 15, depthIn: 12, cornerRadiusIn: 0, shape: "oval" };
    default:
      return { widthIn: 30, depthIn: 16, cornerRadiusIn: 0.7, shape: "rectangle" };
  }
}

/** Blank plan: 1 plan unit = 1 inch. Trace: multiply inches by PPI. */
export function coordPerInchForPlan(
  workspaceKind: "blank" | "source",
  pixelsPerInch: number | null
): number {
  if (workspaceKind === "blank") return 1;
  const p = pixelsPerInch && pixelsPerInch > 0 ? pixelsPerInch : 1;
  return p;
}

function rotate2d(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function sinkCenterWorldInDisplay(
  sink: PieceSinkCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[]
): LayoutPoint {
  const ox = piece.planTransform?.x ?? 0;
  const oy = piece.planTransform?.y ?? 0;
  if (piece.splashMeta?.parentPieceId) {
    const parent = allPieces.find((p) => p.id === piece.splashMeta!.parentPieceId);
    if (parent) {
      return {
        x: sink.centerX + ox + (parent.planTransform?.x ?? 0),
        y: sink.centerY + oy + (parent.planTransform?.y ?? 0),
      };
    }
  }
  return { x: sink.centerX + ox, y: sink.centerY + oy };
}

/**
 * X positions (inches, sink-local) for faucet hole centers. One hole is always at x = 0 (sink centerline).
 * For 2 or 4 holes, `bias` places the extra holes on the customer’s left or right side of center.
 */
export function faucetHoleCentersXInches(
  n: number,
  spread: number,
  bias: FaucetEvenHoleBias | undefined
): number[] {
  const ni = Math.max(1, Math.min(5, Math.floor(n) || 1));
  if (ni === 1) return [0];
  if (ni === 3) return [-spread, 0, spread];
  if (ni === 5) return [-2 * spread, -spread, 0, spread, 2 * spread];
  const b = bias ?? "right";
  if (ni === 2) {
    return b === "right" ? [0, spread] : [-spread, 0];
  }
  if (ni === 4) {
    return b === "right"
      ? [-spread, 0, spread, 2 * spread]
      : [-2 * spread, -spread, 0, spread];
  }
  return [0];
}

/**
 * Local sink frame: +X along width, +Y toward front; back rim of cutout at y = −depth/2.
 * Faucet hole centers sit on the deck **outside** the cutout (y more negative than the back rim).
 */
export function localFaucetHoleCentersInches(sink: PieceSinkCutout): LayoutPoint[] {
  const dims = sinkTemplateDims(sink.templateKind);
  const n = Math.max(1, Math.min(5, Math.floor(sink.faucetHoleCount) || 1));
  const spread = sink.spreadIn;
  const yDeck =
    -dims.depthIn / 2 -
    FAUCET_HOLE_RADIUS_IN -
    FAUCET_DECK_GAP_IN -
    FAUCET_DECK_EXTRA_OFFSET_IN;
  const xs = faucetHoleCentersXInches(n, spread, sink.evenHoleBias);
  return xs.map((x) => ({ x, y: yDeck }));
}

export function localToWorldDisplay(
  lx: number,
  ly: number,
  sink: PieceSinkCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[]
): LayoutPoint {
  const { x: rx, y: ry } = rotate2d(lx, ly, sink.rotationDeg);
  const c = sinkCenterWorldInDisplay(sink, piece, allPieces);
  return { x: c.x + rx, y: c.y + ry };
}

/**
 * SVG `transform` matrix mapping sink-local inches (same frame as {@link sinkOutlinePathDLocal} with
 * `coordPerInch === 1`) into slab inch space for the given placement.
 */
export function sinkLocalToSlabMatrixStr(
  sink: PieceSinkCutout,
  piece: LayoutPiece,
  placement: PiecePlacement,
  pixelsPerInch: number,
  allPieces: readonly LayoutPiece[]
): string {
  const o = localToWorldDisplay(0, 0, sink, piece, allPieces);
  const ex = localToWorldDisplay(1, 0, sink, piece, allPieces);
  const ey = localToWorldDisplay(0, 1, sink, piece, allPieces);
  const ox = worldDisplayToSlabInches(o.x, o.y, piece, placement, pixelsPerInch, allPieces);
  const exs = worldDisplayToSlabInches(ex.x, ex.y, piece, placement, pixelsPerInch, allPieces);
  const eys = worldDisplayToSlabInches(ey.x, ey.y, piece, placement, pixelsPerInch, allPieces);
  const a = exs.x - ox.x;
  const b = exs.y - ox.y;
  const c = eys.x - ox.x;
  const d = eys.y - ox.y;
  return `matrix(${a} ${b} ${c} ${d} ${ox.x} ${ox.y})`;
}

export function worldDisplayToLocal(
  wx: number,
  wy: number,
  sink: PieceSinkCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[]
): LayoutPoint {
  const c = sinkCenterWorldInDisplay(sink, piece, allPieces);
  const dx = wx - c.x;
  const dy = wy - c.y;
  const r = (-sink.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/**
 * Plan-space closed rings for the sink bowl and each faucet hole (same frame as live preview).
 * Used for 3D extrusion holes; `coordPerInch` from {@link coordPerInchForPlan}.
 */
export function sinkCutoutRingsPlanWorld(
  sink: PieceSinkCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number
): { x: number; y: number }[][] {
  const hull = sampleSinkHullInLocal(sink, coordPerInch);
  const main = hull.map((p) => localToWorldDisplay(p.x, p.y, sink, piece, allPieces));
  const rings: { x: number; y: number }[][] = [main];
  const holeR = FAUCET_HOLE_RADIUS_IN * coordPerInch;
  const centers = localFaucetHoleCentersInches(sink);
  const steps = 20;
  for (const c of centers) {
    const ring: { x: number; y: number }[] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      ring.push(
        localToWorldDisplay(
          c.x + holeR * Math.cos(t),
          c.y + holeR * Math.sin(t),
          sink,
          piece,
          allPieces
        )
      );
    }
    rings.push(ring);
  }
  return rings;
}

/** All sink + faucet hole rings for a piece (empty if no sinks). */
export function allSinkCutoutRingsPlanWorld(
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number
): { x: number; y: number }[][] {
  const sinks = piece.sinks ?? [];
  const out: { x: number; y: number }[][] = [];
  for (const sink of sinks) {
    out.push(...sinkCutoutRingsPlanWorld(sink, piece, allPieces, coordPerInch));
  }
  return out;
}

/**
 * Rounded-rect outline in sink-local coords — must match {@link sinkOutlinePathDLocal} (straight edges + convex corners).
 * Previous version only sampled arcs with wrong sweep sign and omitted edge segments, which produced pinched corners in 3D.
 */
function sampleSinkHullInLocal(sink: PieceSinkCutout, coordPerInch: number): LayoutPoint[] {
  const dims = sinkTemplateDims(sink.templateKind);
  const w = dims.widthIn * coordPerInch;
  const h = dims.depthIn * coordPerInch;
  const cr = dims.cornerRadiusIn * coordPerInch;
  const r = Math.min(cr, w / 2 - 1e-6, h / 2 - 1e-6);
  const pts: LayoutPoint[] = [];
  if (dims.shape === "oval") {
    const rx = w / 2;
    const ry = h / 2;
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      pts.push({ x: rx * Math.cos(t), y: ry * Math.sin(t) });
    }
    return pts;
  }
  if (r < 1e-6) {
    return [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
  }
  const x0 = -w / 2;
  const y0 = -h / 2;
  const x1 = w / 2;
  const y1 = h / 2;
  const arcSeg = 8;
  const pushArc = (cx: number, cy: number, a0: number, a1: number, includeFirst: boolean) => {
    const n = arcSeg;
    const start = includeFirst ? 0 : 1;
    for (let i = start; i <= n; i++) {
      const t = i / n;
      const a = a0 + (a1 - a0) * t;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  const pushLine = (xA: number, yA: number, xB: number, yB: number, includeFirst: boolean) => {
    const n = Math.max(2, arcSeg);
    const start = includeFirst ? 0 : 1;
    for (let i = start; i <= n; i++) {
      const t = i / n;
      pts.push({
        x: xA + (xB - xA) * t,
        y: yA + (yB - yA) * t,
      });
    }
  };
  // Same path order as sinkOutlinePathDLocal: M → L → A → L → A → L → A → L → A → Z
  pts.push({ x: x0 + r, y: y0 });
  pushLine(x0 + r, y0, x1 - r, y0, false);
  // Top-right: center (x1-r, y0+r), arc from (-π/2) to 0 (convex, CCW in standard trig / matches SVG A … 0 0 1)
  pushArc(x1 - r, y0 + r, -Math.PI / 2, 0, false);
  pushLine(x1, y0 + r, x1, y1 - r, false);
  pushArc(x1 - r, y1 - r, 0, Math.PI / 2, false);
  pushLine(x1 - r, y1, x0 + r, y1, false);
  pushArc(x0 + r, y1 - r, Math.PI / 2, Math.PI, false);
  pushLine(x0, y1 - r, x0, y0 + r, false);
  pushArc(x0 + r, y0 + r, Math.PI, (3 * Math.PI) / 2, false);
  return pts;
}

function sampleFaucetHullInLocal(sink: PieceSinkCutout, coordPerInch: number): LayoutPoint[] {
  const holeR = FAUCET_HOLE_RADIUS_IN * coordPerInch;
  const centers = localFaucetHoleCentersInches(sink);
  const pts: LayoutPoint[] = [];
  const steps = 12;
  for (const c of centers) {
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      pts.push({ x: c.x + holeR * Math.cos(t), y: c.y + holeR * Math.sin(t) });
    }
  }
  return pts;
}

/** All sink + faucet samples in world display coordinates. */
export function sinkEntitySamplesWorld(
  sink: PieceSinkCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number
): LayoutPoint[] {
  const hull = sampleSinkHullInLocal(sink, coordPerInch);
  const holes = sampleFaucetHullInLocal(sink, coordPerInch);
  const out: LayoutPoint[] = [];
  for (const p of hull) {
    const w = localToWorldDisplay(p.x, p.y, sink, piece, allPieces);
    out.push(w);
  }
  for (const p of holes) {
    const w = localToWorldDisplay(p.x, p.y, sink, piece, allPieces);
    out.push(w);
  }
  return out;
}

export function isSinkFullyInsidePiece(
  sink: PieceSinkCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number
): boolean {
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  const closed = ensureClosedRing(ring);
  const pts = sinkEntitySamplesWorld(sink, piece, allPieces, coordPerInch);
  for (const p of pts) {
    if (!pointInPolygon(p, closed)) return false;
  }
  return true;
}

export function clampSinkCenter(
  sink: PieceSinkCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number,
  nextCenterX: number,
  nextCenterY: number
): { centerX: number; centerY: number } {
  const test = { ...sink, centerX: nextCenterX, centerY: nextCenterY };
  if (isSinkFullyInsidePiece(test, piece, allPieces, coordPerInch)) {
    return { centerX: nextCenterX, centerY: nextCenterY };
  }
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const ox = piece.planTransform?.x ?? 0;
  const oy = piece.planTransform?.y ?? 0;
  let sx = nextCenterX;
  let sy = nextCenterY;
  let wx = sx + ox;
  let wy = sy + oy;
  for (let step = 0; step < 32; step++) {
    const t = step / 31;
    const tx = wx + (cx - wx) * t;
    const ty = wy + (cy - wy) * t;
    const lx = tx - ox;
    const ly = ty - oy;
    const cand = { ...sink, centerX: lx, centerY: ly };
    if (isSinkFullyInsidePiece(cand, piece, allPieces, coordPerInch)) {
      return { centerX: lx, centerY: ly };
    }
  }
  return { centerX: sink.centerX, centerY: sink.centerY };
}

export function defaultSinkCenterInPieceCanonical(
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[]
): LayoutPoint {
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const ox = piece.planTransform?.x ?? 0;
  const oy = piece.planTransform?.y ?? 0;
  return { x: cx - ox, y: cy - oy };
}

/** Axis-aligned kitchen footprint in world display (for edge stroke clipping). */
/** SVG path in local coords (center 0,0), plan units. */
export function sinkOutlinePathDLocal(sink: PieceSinkCutout, coordPerInch: number): string {
  const dims = sinkTemplateDims(sink.templateKind);
  const w = dims.widthIn * coordPerInch;
  const h = dims.depthIn * coordPerInch;
  const rRaw = dims.cornerRadiusIn * coordPerInch;
  if (dims.shape === "oval") {
    const rx = w / 2;
    const ry = h / 2;
    return `M ${-rx} 0 A ${rx} ${ry} 0 1 0 ${rx} 0 A ${rx} ${ry} 0 1 0 ${-rx} 0 Z`;
  }
  const r = Math.min(rRaw, w / 2 - 1e-6, h / 2 - 1e-6);
  const x0 = -w / 2;
  const y0 = -h / 2;
  const x1 = w / 2;
  const y1 = h / 2;
  if (r < 1e-6) {
    return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`;
  }
  return [
    `M ${x0 + r} ${y0}`,
    `L ${x1 - r} ${y0}`,
    `A ${r} ${r} 0 0 1 ${x1} ${y0 + r}`,
    `L ${x1} ${y1 - r}`,
    `A ${r} ${r} 0 0 1 ${x1 - r} ${y1}`,
    `L ${x0 + r} ${y1}`,
    `A ${r} ${r} 0 0 1 ${x0} ${y1 - r}`,
    `L ${x0} ${y0 + r}`,
    `A ${r} ${r} 0 0 1 ${x0 + r} ${y0}`,
    "Z",
  ].join(" ");
}

export function kitchenSinkRectWorldDisplay(
  sink: PieceSinkCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (sink.templateKind !== "kitchen") return null;
  const dims = sinkTemplateDims(sink.templateKind);
  const w = dims.widthIn * coordPerInch;
  const h = dims.depthIn * coordPerInch;
  const corners = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const wpt = localToWorldDisplay(c.x, c.y, sink, piece, allPieces);
    minX = Math.min(minX, wpt.x);
    minY = Math.min(minY, wpt.y);
    maxX = Math.max(maxX, wpt.x);
    maxY = Math.max(maxY, wpt.y);
  }
  return { minX, maxX, minY, maxY };
}

/** Returns sub-segments of AB that lie outside the closed axis-aligned rectangle (if any). */
export function subtractAxisRectFromSegment(
  a: LayoutPoint,
  b: LayoutPoint,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): { a: LayoutPoint; b: LayoutPoint }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return [];

  const eps = 1e-9;
  const inside = (p: LayoutPoint) =>
    p.x >= minX - eps && p.x <= maxX + eps && p.y >= minY - eps && p.y <= maxY + eps;

  const intersectLineVertical = (x: number): number | null => {
    if (Math.abs(dx) < 1e-12) return null;
    const t = (x - a.x) / dx;
    if (t < 0 || t > 1) return null;
    return t;
  };
  const intersectLineHorizontal = (y: number): number | null => {
    if (Math.abs(dy) < 1e-12) return null;
    const t = (y - a.y) / dy;
    if (t < 0 || t > 1) return null;
    return t;
  };

  const ts = new Set<number>();
  ts.add(0);
  ts.add(1);
  for (const x of [minX, maxX]) {
    const t = intersectLineVertical(x);
    if (t != null) ts.add(t);
  }
  for (const y of [minY, maxY]) {
    const t = intersectLineHorizontal(y);
    if (t != null) ts.add(t);
  }

  const sorted = [...ts].filter((t) => t >= 0 && t <= 1).sort((u, v) => u - v);

  const out: { a: LayoutPoint; b: LayoutPoint }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i]!;
    const t1 = sorted[i + 1]!;
    if (t1 - t0 < 1e-10) continue;
    const midT = (t0 + t1) / 2;
    const mx = a.x + dx * midT;
    const my = a.y + dy * midT;
    if (!inside({ x: mx, y: my })) {
      out.push({
        a: { x: a.x + dx * t0, y: a.y + dy * t0 },
        b: { x: a.x + dx * t1, y: a.y + dy * t1 },
      });
    }
  }
  return out;
}

export function clipEdgeStrokeSegmentsForKitchenSinks(
  a: LayoutPoint,
  b: LayoutPoint,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number
): { a: LayoutPoint; b: LayoutPoint }[] {
  const sinks = piece.sinks ?? [];
  let segs: { a: LayoutPoint; b: LayoutPoint }[] = [{ a, b }];
  for (const sink of sinks) {
    if (sink.templateKind !== "kitchen") continue;
    const rect = kitchenSinkRectWorldDisplay(sink, piece, allPieces, coordPerInch);
    if (!rect) continue;
    const next: { a: LayoutPoint; b: LayoutPoint }[] = [];
    for (const s of segs) {
      next.push(
        ...subtractAxisRectFromSegment(s.a, s.b, rect.minX, rect.maxX, rect.minY, rect.maxY)
      );
    }
    segs = next;
  }
  return segs;
}

export function hitTestSinkAtWorld(
  p: LayoutPoint,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number,
  _maxDist: number
): PieceSinkCutout | null {
  const sinks = piece.sinks ?? [];
  for (let i = sinks.length - 1; i >= 0; i--) {
    const sink = sinks[i]!;
    const lp = worldDisplayToLocal(p.x, p.y, sink, piece, allPieces);
    const hull = sampleSinkHullInLocal(sink, coordPerInch);
    if (hull.length > 0) {
      const closed = ensureClosedRing([...hull, hull[0]!]);
      if (pointInPolygon(lp, closed)) return sink;
    }
    const holeR = FAUCET_HOLE_RADIUS_IN * coordPerInch;
    for (const fc of localFaucetHoleCentersInches(sink)) {
      const dx = lp.x - fc.x;
      const dy = lp.y - fc.y;
      if (dx * dx + dy * dy <= holeR * holeR * 1.44) return sink;
    }
  }
  return null;
}

function ringCentroid2(ring: LayoutPoint[]): LayoutPoint {
  const r = normalizeClosedRing(ring);
  let sx = 0;
  let sy = 0;
  for (const p of r) {
    sx += p.x;
    sy += p.y;
  }
  const n = r.length || 1;
  return { x: sx / n, y: sy / n };
}

/** After a seam split: assign each sink using the sink center in world space vs each ring. */
export function assignSinksToSplitPieces(
  sinks: PieceSinkCutout[],
  worldRingA: LayoutPoint[],
  worldRingB: LayoutPoint[],
  planOx: number,
  planOy: number
): { sinksA: PieceSinkCutout[]; sinksB: PieceSinkCutout[] } {
  const closedA = ensureClosedRing(normalizeClosedRing(worldRingA));
  const closedB = ensureClosedRing(normalizeClosedRing(worldRingB));
  const cA = ringCentroid2(worldRingA);
  const cB = ringCentroid2(worldRingB);
  const sinksA: PieceSinkCutout[] = [];
  const sinksB: PieceSinkCutout[] = [];
  for (const sink of sinks) {
    const wp = { x: sink.centerX + planOx, y: sink.centerY + planOy };
    const inA = pointInPolygon(wp, closedA);
    const inB = pointInPolygon(wp, closedB);
    if (inA && !inB) {
      sinksA.push({ ...sink });
    } else if (inB && !inA) {
      sinksB.push({ ...sink });
    } else if (inA && inB) {
      sinksA.push({ ...sink });
    } else {
      const dA = Math.hypot(wp.x - cA.x, wp.y - cA.y);
      const dB = Math.hypot(wp.x - cB.x, wp.y - cB.y);
      if (dA <= dB) sinksA.push({ ...sink });
      else sinksB.push({ ...sink });
    }
  }
  return { sinksA, sinksB };
}

/** Re-home sinks from the joined piece into anchor canonical coordinates. */
export function mergeSinksForJoin(
  anchorPiece: LayoutPiece,
  movePiece: LayoutPiece,
  moveSinks: PieceSinkCutout[]
): PieceSinkCutout[] {
  const oxA = anchorPiece.planTransform?.x ?? 0;
  const oyA = anchorPiece.planTransform?.y ?? 0;
  const oxM = movePiece.planTransform?.x ?? 0;
  const oyM = movePiece.planTransform?.y ?? 0;
  return moveSinks.map((sink) => {
    const wx = sink.centerX + oxM;
    const wy = sink.centerY + oyM;
    return {
      ...sink,
      centerX: wx - oxA,
      centerY: wy - oyA,
    };
  });
}
