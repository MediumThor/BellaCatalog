import type { LayoutPiece } from "../types";

/**
 * For every miter strip, ensure the parent countertop has that edge index in
 * `edgeTags.miterEdgeIndices` (mates the strip’s inner miter edge).
 */
export function syncMiterParentEdgeTags(pieces: LayoutPiece[]): LayoutPiece[] {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const parentIndicesToAdd = new Map<string, Set<number>>();
  for (const child of pieces) {
    if (child.pieceRole !== "miter" || !child.splashMeta) continue;
    const parentId = child.splashMeta.parentPieceId;
    if (!byId.has(parentId)) continue;
    const ei = child.splashMeta.parentEdgeIndex;
    if (!Number.isFinite(ei) || ei < 0) continue;
    let set = parentIndicesToAdd.get(parentId);
    if (!set) {
      set = new Set();
      parentIndicesToAdd.set(parentId, set);
    }
    set.add(ei);
  }
  if (parentIndicesToAdd.size === 0) return pieces;
  return pieces.map((p) => {
    const add = parentIndicesToAdd.get(p.id);
    if (!add || add.size === 0) return p;
    const prev = p.edgeTags?.miterEdgeIndices ?? [];
    const merged = [...new Set([...prev, ...add])].sort((a, b) => a - b);
    return {
      ...p,
      edgeTags: {
        ...p.edgeTags,
        miterEdgeIndices: merged,
      },
    };
  });
}
