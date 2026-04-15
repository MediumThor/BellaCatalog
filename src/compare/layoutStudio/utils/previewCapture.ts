import type { LayoutPiece, LayoutSlab, PiecePlacement } from "../types";
import { mirrorLocalInches, piecePolygonInches, transformedPieceInches } from "./pieceInches";
import { piecesHaveAnyScale } from "./sourcePages";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = url;
  });
}

/** Rasterize slab + placed pieces for customer-facing preview (derived output). */
export async function captureLayoutPreview(input: {
  slab: LayoutSlab;
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
}): Promise<Blob | null> {
  const { slab, pieces, placements, pixelsPerInch } = input;
  if (!piecesHaveAnyScale(pieces, pixelsPerInch)) return null;

  const scale = 4;
  const w = Math.max(320, Math.round(slab.widthIn * scale));
  const h = Math.max(180, Math.round(slab.heightIn * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#0f0f0f";
  ctx.fillRect(0, 0, w, h);

  try {
    const img = await loadImage(slab.imageUrl);
    ctx.drawImage(img, 0, 0, w, h);
  } catch {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(244,241,234,0.45)";
    ctx.font = "14px system-ui";
    ctx.fillText("Slab preview unavailable (image blocked).", 16, 28);
  }

  const sx = w / slab.widthIn;
  const sy = h / slab.heightIn;

  const byPiece = new Map(placements.map((p) => [p.pieceId, p]));

  ctx.lineJoin = "round";
  for (const piece of pieces) {
    const pl = byPiece.get(piece.id);
    if (!pl || pl.slabId !== slab.id) continue;
    const local = piecePolygonInches(piece, pixelsPerInch, pieces);
    if (local.length < 3) continue;
    const rotated = transformedPieceInches(mirrorLocalInches(local, pl.mirrored), pl.rotation);
    ctx.beginPath();
    rotated.forEach((q, i) => {
      const px = (pl.x + q.x) * sx;
      const py = (pl.y + q.y) * sy;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(201,162,39,0.22)";
    ctx.strokeStyle = "rgba(232,212,139,0.85)";
    ctx.lineWidth = Math.max(1.2, 2 * Math.min(sx, sy) * 0.04);
    ctx.fill();
    ctx.stroke();
  }

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png", 0.92);
  });
}
