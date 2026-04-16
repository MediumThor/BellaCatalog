import type { LayoutPiece } from "../types";
import { planDisplayPoints } from "./blankPlanGeometry";
import { ensureClosedRing, normalizeClosedRing } from "./geometry";
import { tracePiecesViewBoxDims } from "./tracePiecesViewBox";

const BLANK_PLAN_WORLD_W_IN = 480;
const BLANK_PLAN_WORLD_H_IN = 240;

function blankViewBoxDims(pieces: LayoutPiece[]): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pc of pieces) {
    for (const p of planDisplayPoints(pc, pieces)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, width: BLANK_PLAN_WORLD_W_IN, height: BLANK_PLAN_WORLD_H_IN };
  }
  const pad = 22;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const width = Math.max(maxX - minX, 48);
  const height = Math.max(maxY - minY, 48);
  return { minX, minY, width, height };
}

function pieceRingOpen(piece: LayoutPiece, workspaceKind: "blank" | "source", allPieces: LayoutPiece[]) {
  const ringOpen =
    workspaceKind === "blank"
      ? normalizeClosedRing(planDisplayPoints(piece, allPieces))
      : normalizeClosedRing(piece.points);
  return ensureClosedRing(ringOpen);
}

/**
 * Rasterizes a simplified plan preview (no slab texture fills) for share/PDF snapshots.
 */
export async function captureSimplifiedPlanPreview(args: {
  workspaceKind: "blank" | "source";
  pieces: LayoutPiece[];
  tracePlanWidth: number | null;
  tracePlanHeight: number | null;
}): Promise<Blob | null> {
  const { workspaceKind, pieces, tracePlanWidth, tracePlanHeight } = args;
  if (pieces.length === 0) return null;

  let minX = 0;
  let minY = 0;
  let vbW = 1;
  let vbH = 1;

  if (workspaceKind === "blank") {
    const vb = blankViewBoxDims(pieces);
    minX = vb.minX;
    minY = vb.minY;
    vbW = vb.width;
    vbH = vb.height;
  } else {
    const vb = tracePiecesViewBoxDims(pieces, tracePlanWidth, tracePlanHeight);
    minX = vb.minX;
    minY = vb.minY;
    vbW = vb.width;
    vbH = vb.height;
  }

  const maxCanvas = 920;
  const scale = Math.min(maxCanvas / vbW, maxCanvas / vbH, 2);
  const cw = Math.max(320, Math.round(vbW * scale));
  const ch = Math.max(200, Math.round(vbH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const grd = ctx.createLinearGradient(0, 0, cw, ch);
  grd.addColorStop(0, "#121418");
  grd.addColorStop(1, "#0a0b0d");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, cw, ch);

  ctx.save();
  ctx.scale(cw / vbW, ch / vbH);
  ctx.translate(-minX, -minY);

  ctx.lineJoin = "round";
  pieces.forEach((piece, idx) => {
    const ring = pieceRingOpen(piece, workspaceKind, pieces);
    if (ring.length < 3) return;
    ctx.beginPath();
    ring.forEach((q, i) => {
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.fillStyle = `rgba(120, 200, 255, ${0.07 + (idx % 5) * 0.02})`;
    ctx.strokeStyle = "rgba(190, 205, 220, 0.5)";
    ctx.lineWidth = 0.22;
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png", 0.92);
  });
}
