import type { LayoutPoint, ManualPieceDimensions } from "../types";
import { ensureClosedRing, normalizeClosedRing, polygonArea } from "./geometry";
import { lShapePointsInches } from "./manualPieces";

/** Every edge is axis-aligned (Manhattan); no diagonal segments. */
export function isOrthogonalPolygonRing(ring: LayoutPoint[]): boolean {
  const r = normalizeClosedRing(ring);
  if (r.length < 3) return false;
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % n]!;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx > 1e-6 && dy > 1e-6) return false;
    if (dx < 1e-6 && dy < 1e-6) return false;
  }
  return true;
}

/**
 * Change one straight edge length on an orthogonal ring by fixing vertex `edgeIndex` and
 * propagating axis-aligned offsets around the ring (same closure as a rectangle resize).
 * Fails if the topology does not close back to the anchor vertex (non‑rectilinear “spiral” cases).
 */
export function tryResizeOrthogonalStraightEdgeLength(
  points: LayoutPoint[],
  edgeIndex: number,
  newLength: number,
  minLen = 0.5,
): LayoutPoint[] | null {
  const r = normalizeClosedRing(points);
  const n = r.length;
  if (n < 3 || newLength < minLen) return null;
  if (!isOrthogonalPolygonRing(r)) return null;
  const i = ((edgeIndex % n) + n) % n;
  const A = r[i]!;
  const B = r[(i + 1) % n]!;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const oldLen = Math.hypot(dx, dy);
  if (oldLen < 1e-9) return null;
  const ux = dx / oldLen;
  const uy = dy / oldLen;
  const Bnew = { x: A.x + ux * newLength, y: A.y + uy * newLength };

  const orientH: boolean[] = [];
  for (let k = 0; k < n; k++) {
    const p = r[k]!;
    const q = r[(k + 1) % n]!;
    orientH.push(Math.abs(q.y - p.y) < 1e-6);
  }

  const out: LayoutPoint[] = r.map((p) => ({ x: p.x, y: p.y }));
  out[(i + 1) % n] = Bnew;

  for (let m = 1; m < n; m++) {
    const k = (i + m) % n;
    const kNext = (k + 1) % n;
    const ak = out[k]!;
    if (orientH[k]) {
      out[kNext] = { x: r[kNext].x, y: ak.y };
    } else {
      out[kNext] = { x: ak.x, y: r[kNext].y };
    }
  }

  const tol = Math.max(0.08, oldLen * 1e-9);
  if (Math.hypot(out[i]!.x - r[i]!.x, out[i]!.y - r[i]!.y) > tol) {
    return null;
  }
  out[i] = { ...r[i]! };

  const closed = ensureClosedRing(out);
  if (polygonArea(closed) < 1e-4) return null;
  return normalizeClosedRing(out);
}

/** True if ring is exactly 4 vertices and every edge is axis-aligned. */
export function isAxisAlignedRectangle(ring: LayoutPoint[]): boolean {
  const r = normalizeClosedRing(ring);
  if (r.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = r[i];
    const b = r[(i + 1) % 4];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx > 1e-6 && dy > 1e-6) return false;
  }
  return true;
}

/**
 * Rebuild CCW rectangle from bounds (canonical order).
 */
export function rectangleFromBounds(minX: number, minY: number, maxX: number, maxY: number): LayoutPoint[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/**
 * Resize axis-aligned rectangle by setting one edge's length.
 * Horizontal edges control width; vertical edges control height.
 */
export function tryResizeRectangleEdgeLength(
  points: LayoutPoint[],
  edgeIndex: number,
  newLength: number,
  minLen = 0.5
): LayoutPoint[] | null {
  const r = normalizeClosedRing(points);
  if (r.length !== 4 || newLength < minLen) return null;
  if (!isAxisAlignedRectangle(r)) return null;
  const e = edgeIndex % 4;
  const a = r[e];
  const b = r[(e + 1) % 4];
  const horiz = Math.abs(b.y - a.y) < 1e-6;
  const xs = r.map((p) => p.x);
  const ys = r.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  if (horiz) {
    const newW = newLength;
    if (newW < minLen) return null;
    return rectangleFromBounds(minX, minY, minX + newW, minY + h);
  }
  const newH = newLength;
  if (newH < minLen) return null;
  return rectangleFromBounds(minX, minY, minX + w, minY + newH);
}

type EdgeSig = { len: number; horiz: boolean };

function ringEdgeSignatures(ring: LayoutPoint[]): EdgeSig[] {
  const r = normalizeClosedRing(ring);
  const out: EdgeSig[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    const dy = b.y - a.y;
    const len = Math.hypot(b.x - a.x, dy);
    const horiz = Math.abs(dy) < 1e-6;
    out.push({ len, horiz });
  }
  return out;
}

/** True if ring has 6 vertices and every edge is horizontal or vertical. */
export function isAxisAlignedLShapeRing(ring: LayoutPoint[]): boolean {
  const r = normalizeClosedRing(ring);
  if (r.length !== 6) return false;
  for (let i = 0; i < 6; i++) {
    const a = r[i];
    const b = r[(i + 1) % 6];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx > 1e-6 && dy > 1e-6) return false;
    if (dx < 1e-6 && dy < 1e-6) return false;
  }
  return true;
}

function edgeMatch(a: EdgeSig, b: EdgeSig, eps: number): boolean {
  return Math.abs(a.len - b.len) < eps && a.horiz === b.horiz;
}

function findRotationIndex(sig: EdgeSig[], canon: EdgeSig[], eps: number): number | null {
  for (let k = 0; k < 6; k++) {
    let ok = true;
    for (let j = 0; j < 6; j++) {
      if (!edgeMatch(sig[(j + k) % 6]!, canon[j]!, eps)) {
        ok = false;
        break;
      }
    }
    if (ok) return k;
  }
  for (let k = 0; k < 6; k++) {
    let ok = true;
    for (let j = 0; j < 6; j++) {
      if (Math.abs(sig[(j + k) % 6]!.len - canon[j]!.len) >= eps) {
        ok = false;
        break;
      }
    }
    if (ok) return k;
  }
  return null;
}

/** Edge order when walking the ring with the opposite winding (same undirected lengths). */
function reverseEdgeSignature(sig: EdgeSig[]): EdgeSig[] {
  return [sig[5]!, sig[4]!, sig[3]!, sig[2]!, sig[1]!, sig[0]!];
}

/**
 * Map ring edge index to canonical L-shape edge index (0..5) for the standard orthogonal L
 * with legs la, lb and strip depth t. Returns null if the ring does not match that shape.
 */
function canonicalEdgeIndexForRingEdge(
  sig: EdgeSig[],
  canon: EdgeSig[],
  eps: number,
  edgeIndex: number,
): number | null {
  const ei = edgeIndex % 6;
  const k = findRotationIndex(sig, canon, eps);
  if (k != null) return (ei - k + 6) % 6;
  const rev = reverseEdgeSignature(sig);
  const k2 = findRotationIndex(rev, canon, eps);
  if (k2 == null) return null;
  const posInRev = (5 - ei + 6) % 6;
  return (posInRev - k2 + 6) % 6;
}

function applyCanonicalLResize(
  la: number,
  lb: number,
  t: number,
  canonIdx: number,
  newL: number,
  minLen: number,
): { la: number; lb: number; t: number } | null {
  let la2 = la;
  let lb2 = lb;
  let t2 = t;
  switch (canonIdx) {
    case 0:
      la2 = newL;
      break;
    case 1:
    case 4:
      t2 = newL;
      break;
    case 2:
      la2 = newL + t2;
      break;
    case 3:
      lb2 = newL + t2;
      break;
    case 5:
      lb2 = newL;
      break;
    default:
      return null;
  }
  t2 = Math.max(minLen, Math.min(t2, la2, lb2));
  if (la2 < minLen || lb2 < minLen) return null;
  if (la2 - t2 < minLen - 1e-9) return null;
  if (lb2 - t2 < minLen - 1e-9) return null;
  return { la: la2, lb: lb2, t: t2 };
}

/**
 * Update manual L-shape parameters when the user sets one displayed edge length (same UX as rectangle).
 * Ring must match the canonical orthogonal L for the current manual dimensions (within tolerance).
 */
export function tryResizeLShapeManualEdgeLength(
  manual: Extract<ManualPieceDimensions, { kind: "lShape" }>,
  ring: LayoutPoint[],
  edgeIndex: number,
  newLength: number,
  minLen = 0.5,
): Extract<ManualPieceDimensions, { kind: "lShape" }> | null {
  if (!Number.isFinite(newLength) || newLength < minLen) return null;
  const r = normalizeClosedRing(ring);
  if (r.length !== 6 || !isAxisAlignedLShapeRing(r)) return null;
  const la0 = manual.legAIn;
  const lb0 = manual.legBIn;
  const t0 = Math.max(minLen, Math.min(manual.depthIn, la0, lb0));
  /** Must use the same ring as `lShapePointsInches` (including orientation) so horiz flags match the canvas. */
  const refRing = lShapePointsInches(la0, lb0, t0, manual.orientation);
  const canon = ringEdgeSignatures(refRing);
  const sig = ringEdgeSignatures(r);
  const eps = 0.12;
  const canonIdx = canonicalEdgeIndexForRingEdge(sig, canon, eps, edgeIndex);
  if (canonIdx == null) return null;
  const next = applyCanonicalLResize(la0, lb0, t0, canonIdx, newLength, minLen);
  if (!next) return null;
  return {
    kind: "lShape",
    legAIn: next.la,
    legBIn: next.lb,
    depthIn: next.t,
    orientation: manual.orientation,
  };
}
