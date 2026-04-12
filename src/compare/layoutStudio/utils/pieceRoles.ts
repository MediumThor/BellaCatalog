import type { LayoutPiece } from "../types";

/** Backsplash or miter strip spawned from a parent edge (shares `splashMeta` linkage). */
export function isPlanStripPiece(p: Pick<LayoutPiece, "pieceRole">): boolean {
  return p.pieceRole === "splash" || p.pieceRole === "miter";
}

export function isSplashPiece(p: Pick<LayoutPiece, "pieceRole">): boolean {
  return p.pieceRole === "splash";
}

export function isMiterStripPiece(p: Pick<LayoutPiece, "pieceRole">): boolean {
  return p.pieceRole === "miter";
}

/**
 * Place 3D: miter strips fold **down** from the hinge; backsplashes fold up.
 * Legacy saves used `splash` + `splashMeta.waterfall` — migrated by {@link normalizeLegacyStripPieces}.
 */
export function stripFoldsDownFromHinge(p: LayoutPiece): boolean {
  if (p.pieceRole === "miter") return true;
  return !!(p.pieceRole === "splash" && p.splashMeta?.waterfall);
}

/** Convert legacy `splash` + `splashMeta.waterfall` to `pieceRole: "miter"`. */
export function normalizeLegacyStripPieces(pieces: LayoutPiece[]): LayoutPiece[] {
  let changed = false;
  const next = pieces.map((p) => {
    if (p.pieceRole === "splash" && p.splashMeta?.waterfall) {
      changed = true;
      const { waterfall: _w, ...sm } = p.splashMeta;
      return { ...p, pieceRole: "miter" as const, splashMeta: sm };
    }
    return p;
  });
  return changed ? next : pieces;
}
