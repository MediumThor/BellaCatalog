import type { LayoutPiece } from "../types";

/**
 * View box around traced pieces (source workspace) — matches {@link PlaceLayoutPreview} cropping.
 */
export function tracePiecesViewBoxDims(
  pieces: LayoutPiece[],
  tracePlanWidth?: number | null,
  tracePlanHeight?: number | null,
): { minX: number; minY: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const piece of pieces) {
    for (const point of piece.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) {
    return {
      minX: 0,
      minY: 0,
      width: Math.max(tracePlanWidth ?? 0, 1),
      height: Math.max(tracePlanHeight ?? 0, 1),
    };
  }
  const pad = 48;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 96),
    height: Math.max(maxY - minY, 96),
  };
}
