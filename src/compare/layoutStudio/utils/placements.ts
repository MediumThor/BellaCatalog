import type { LayoutPiece, PiecePlacement } from "../types";

export function ensurePlacementsForPieces(
  pieces: LayoutPiece[],
  placements: PiecePlacement[]
): PiecePlacement[] {
  const byPiece = new Map(placements.map((p) => [p.pieceId, p]));
  const next: PiecePlacement[] = [];
  for (const piece of pieces) {
    const existing = byPiece.get(piece.id);
    if (existing) {
      next.push(existing);
    } else {
      next.push({
        id: crypto.randomUUID(),
        pieceId: piece.id,
        slabId: null,
        x: 0,
        y: 0,
        rotation: 0,
        placed: false,
      });
    }
  }
  return next;
}
