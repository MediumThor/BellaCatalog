import type { LayoutPiece, LayoutPoint } from "../types";
import { planDisplayPoints } from "./blankPlanGeometry";
import { normalizeClosedRing } from "./geometry";
import { isPlanStripPiece } from "./pieceRoles";

const INV_SQRT_2 = Math.SQRT1_2;
const ORTHO_DIRECTIONS = [
  { kind: "horizontal" as const, x: 1, y: 0 },
  { kind: "diagonal" as const, x: INV_SQRT_2, y: INV_SQRT_2 },
  { kind: "vertical" as const, x: 0, y: 1 },
  { kind: "diagonal" as const, x: -INV_SQRT_2, y: INV_SQRT_2 },
  { kind: "horizontal" as const, x: -1, y: 0 },
  { kind: "diagonal" as const, x: -INV_SQRT_2, y: -INV_SQRT_2 },
  { kind: "vertical" as const, x: 0, y: -1 },
  { kind: "diagonal" as const, x: INV_SQRT_2, y: -INV_SQRT_2 },
];

function closestOrthoDirection(dx: number, dy: number) {
  let best = ORTHO_DIRECTIONS[0]!;
  let bestDot = -Infinity;
  for (const direction of ORTHO_DIRECTIONS) {
    const dot = dx * direction.x + dy * direction.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = direction;
    }
  }
  return best;
}

function projectPointAlongDirection(
  origin: LayoutPoint,
  cursor: LayoutPoint,
  direction: { x: number; y: number },
): LayoutPoint {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const distance = dx * direction.x + dy * direction.y;
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
  };
}

/** Next vertex from last point toward cursor, constrained to the nearest 45-degree direction. */
export function orthoPreviewPoint(last: LayoutPoint, cursor: LayoutPoint): LayoutPoint {
  const dx = cursor.x - last.x;
  const dy = cursor.y - last.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return last;
  return projectPointAlongDirection(last, cursor, closestOrthoDirection(dx, dy));
}

const SAME_PT_EPS = 1e-5;

function samePlanPoint(a: LayoutPoint, b: LayoutPoint): boolean {
  return Math.abs(a.x - b.x) < SAME_PT_EPS && Math.abs(a.y - b.y) < SAME_PT_EPS;
}

/**
 * Vertices from existing pieces (plan space) plus prior ortho polyline vertices, excluding
 * the current segment origin so we never snap a new vertex onto `last`.
 */
export function collectOrthoSnapTargets(
  pieces: readonly LayoutPiece[],
  orthoPoints: LayoutPoint[] | null,
  lastVertex: LayoutPoint | null,
): LayoutPoint[] {
  const out: LayoutPoint[] = [];
  for (const pc of pieces) {
    if (isPlanStripPiece(pc)) continue;
    const disp = planDisplayPoints(pc, pieces);
    const ring = normalizeClosedRing(disp);
    for (const q of ring) {
      if (lastVertex && samePlanPoint(q, lastVertex)) continue;
      out.push({ x: q.x, y: q.y });
    }
  }
  if (orthoPoints) {
    for (const q of orthoPoints) {
      if (lastVertex && samePlanPoint(q, lastVertex)) continue;
      out.push({ x: q.x, y: q.y });
    }
  }
  return out;
}

export type OrthoSnapGuide =
  | { kind: "vertical"; x: number }
  | { kind: "horizontal"; y: number };

/** First ortho vertex: snap to the nearest endpoint in 2D; guides when cursor is near an x or y. */
export function orthoSnapFirstPoint(
  cursor: LayoutPoint,
  targets: LayoutPoint[],
  snapThresh: number,
  guideThresh: number,
): { preview: LayoutPoint; guides: OrthoSnapGuide[] } {
  let preview = cursor;
  let bestD = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - cursor.x, t.y - cursor.y);
    if (d <= snapThresh && d < bestD) {
      bestD = d;
      preview = { x: t.x, y: t.y };
    }
  }
  const vx = new Set<number>();
  const hy = new Set<number>();
  for (const t of targets) {
    if (Math.abs(t.x - cursor.x) <= guideThresh) vx.add(t.x);
    if (Math.abs(t.y - cursor.y) <= guideThresh) hy.add(t.y);
  }
  const guides: OrthoSnapGuide[] = [
    ...[...vx].map((x) => ({ kind: "vertical" as const, x })),
    ...[...hy].map((y) => ({ kind: "horizontal" as const, y })),
  ];
  return { preview, guides };
}

/**
 * After axis choice from `orthoPreviewPoint`, snap along the active axis to the nearest
 * endpoint coordinate; dotted guides when near alignment on that axis.
 */
export function orthoSnapPreview(
  last: LayoutPoint,
  cursor: LayoutPoint,
  targets: LayoutPoint[],
  snapThresh: number,
  guideThresh: number,
): { preview: LayoutPoint; guides: OrthoSnapGuide[] } {
  const dx = cursor.x - last.x;
  const dy = cursor.y - last.y;
  const direction = closestOrthoDirection(dx, dy);
  const raw = projectPointAlongDirection(last, cursor, direction);

  const guides: OrthoSnapGuide[] = [];

  if (direction.kind === "horizontal") {
    let x = raw.x;
    let best: number | null = null;
    let bestD = Infinity;
    for (const t of targets) {
      const d = Math.abs(t.x - raw.x);
      if (d <= snapThresh && d < bestD) {
        bestD = d;
        best = t.x;
      }
    }
    if (best != null) x = best;
    const preview = { x, y: last.y };
    const vx = new Set<number>();
    for (const t of targets) {
      if (Math.abs(t.x - raw.x) <= guideThresh) vx.add(t.x);
    }
    for (const xv of vx) guides.push({ kind: "vertical", x: xv });
    return { preview, guides };
  }

  if (direction.kind === "vertical") {
    let y = raw.y;
    let best: number | null = null;
    let bestD = Infinity;
    for (const t of targets) {
      const d = Math.abs(t.y - raw.y);
      if (d <= snapThresh && d < bestD) {
        bestD = d;
        best = t.y;
      }
    }
    if (best != null) y = best;
    const preview = { x: last.x, y };
    const hy = new Set<number>();
    for (const t of targets) {
      if (Math.abs(t.y - raw.y) <= guideThresh) hy.add(t.y);
    }
    for (const yv of hy) guides.push({ kind: "horizontal", y: yv });
    return { preview, guides };
  }

  let preview = raw;
  let bestD = Infinity;
  for (const t of targets) {
    const relX = t.x - last.x;
    const relY = t.y - last.y;
    const projectedDistance = relX * direction.x + relY * direction.y;
    const projectedTarget = {
      x: last.x + direction.x * projectedDistance,
      y: last.y + direction.y * projectedDistance,
    };
    const lineDistance = Math.hypot(projectedTarget.x - raw.x, projectedTarget.y - raw.y);
    const perpDistance = Math.abs(relX * direction.y - relY * direction.x);
    if (perpDistance <= snapThresh && lineDistance <= snapThresh && lineDistance < bestD) {
      bestD = lineDistance;
      preview = projectedTarget;
    }
  }
  return { preview, guides };
}

/** Distance from point to point (for close detection). */
export function nearPoint(a: LayoutPoint, b: LayoutPoint, thresh: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= thresh;
}

function isAxisAlignedOrFortyFiveSegment(a: LayoutPoint, b: LayoutPoint): boolean {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx < 1e-6 && dy < 1e-6) return false;
  if (dx < 1e-6 || dy < 1e-6) return true;
  return Math.abs(dx - dy) < 1e-6;
}

/**
 * Ortho-draw keeps placed segments on axis or 45-degree diagonals. The closing edge back to
 * the origin may be slightly angled so users can close a shape without forcing an extra bend.
 */
export function isFinishableOrthoDraftRing(points: LayoutPoint[]): boolean {
  const ring = normalizeClosedRing(points);
  if (ring.length < 3) return false;
  for (let i = 0; i < ring.length - 1; i++) {
    if (!isAxisAlignedOrFortyFiveSegment(ring[i]!, ring[i + 1]!)) return false;
  }
  return !samePlanPoint(ring[ring.length - 1]!, ring[0]!);
}

/** Remove collinear vertices from orthogonal ring. */
export function simplifyOrthoRing(points: LayoutPoint[]): LayoutPoint[] {
  if (points.length < 4) return points;
  const out: LayoutPoint[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const v1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const cross = v1.x * v2.y - v1.y * v2.x;
    if (Math.abs(cross) < 1e-9) continue;
    out.push(cur);
  }
  return out.length >= 3 ? out : points;
}
