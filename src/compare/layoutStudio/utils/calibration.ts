import type { LayoutPoint } from "../types";

export function pixelDistance(a: LayoutPoint, b: LayoutPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Convert real distance to inches. */
export function realDistanceToInches(value: number, unit: "in" | "ft" | "mm" | "cm"): number {
  switch (unit) {
    case "in":
      return value;
    case "ft":
      return value * 12;
    case "cm":
      return value / 2.54;
    case "mm":
      return value / 25.4;
    default:
      return value;
  }
}

/**
 * Pixels per inch in source space: pixelLength / realLengthInches.
 */
export function pixelsPerInchFromSegment(
  pointA: LayoutPoint,
  pointB: LayoutPoint,
  realDistanceRaw: number,
  unit: "in" | "ft" | "mm" | "cm"
): number | null {
  const px = pixelDistance(pointA, pointB);
  if (px < 1e-6) return null;
  const inches = realDistanceToInches(realDistanceRaw, unit);
  if (!Number.isFinite(inches) || inches <= 0) return null;
  return px / inches;
}
