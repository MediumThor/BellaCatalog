import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LayoutPiece,
  LayoutPoint,
  LayoutSlab,
  PiecePlacement,
  SavedLayoutCalibration,
  TraceTool,
} from "../types";
import { ensureClosedRing, normalizeClosedRing, rectFromCorners, unitLShapePolygon } from "../utils/geometry";
import { tryRemoveDraftPolylinePoint } from "../utils/blankPlanGeometry";
import { renderPdfUrlFirstPageToDataUrl } from "../utils/pdfSource";
import {
  slabTextureRenderParamsTrace,
  shouldFillPieceWithSlabTexture,
} from "../utils/slabLayoutTexture";
import { defaultNonSplashPieceName } from "../utils/pieceLabels";
import { isPlanStripPiece } from "../utils/pieceRoles";

type Props = {
  displayUrl: string | null;
  isPdfSource: boolean;
  calibration: SavedLayoutCalibration;
  calibrationMode: boolean;
  onCalibrationPoint: (p: LayoutPoint) => void;
  tool: TraceTool;
  pieces: LayoutPiece[];
  selectedPieceId: string | null;
  onSelectPiece: (id: string | null) => void;
  onPiecesChange: (pieces: LayoutPiece[]) => void;
  slabs?: LayoutSlab[];
  placements?: PiecePlacement[];
};

function nextPieceName(pieces: LayoutPiece[]): string {
  const n = pieces.filter((p) => !isPlanStripPiece(p)).length;
  return defaultNonSplashPieceName(n);
}

function pointInPoly(pt: LayoutPoint, poly: LayoutPoint[]): boolean {
  const p = ensureClosedRing(normalizeClosedRing(poly));
  if (p.length < 3) return false;
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i].x;
    const yi = p[i].y;
    const xj = p[j].x;
    const yj = p[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function TraceWorkspace({
  displayUrl,
  isPdfSource,
  calibration,
  calibrationMode,
  onCalibrationPoint,
  tool,
  pieces,
  selectedPieceId,
  onSelectPiece,
  onPiecesChange,
  slabs,
  placements,
}: Props) {
  const effectiveTool: TraceTool =
    tool === "orthoDraw" ||
    tool === "snapLines" ||
    tool === "join" ||
    tool === "cornerRadius" ||
    tool === "connectCorner"
      ? "select"
      : tool;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let cancelled = false;
    if (!displayUrl) {
      setResolvedUrl(null);
      return;
    }
    if (!isPdfSource) {
      setResolvedUrl(displayUrl);
      return;
    }
    (async () => {
      try {
        const { dataUrl } = await renderPdfUrlFirstPageToDataUrl(displayUrl, 2);
        if (!cancelled) setResolvedUrl(dataUrl);
      } catch {
        if (!cancelled) setResolvedUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [displayUrl, isPdfSource]);

  const clientToImage = useCallback((clientX: number, clientY: number): LayoutPoint | null => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    const rect = img.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    return { x: nx * img.naturalWidth, y: ny * img.naturalHeight };
  }, []);

  const [dragRect, setDragRect] = useState<{ a: LayoutPoint; b: LayoutPoint } | null>(null);
  const [polyDraft, setPolyDraft] = useState<LayoutPoint[] | null>(null);
  const [vertexDrag, setVertexDrag] = useState<{ pieceId: string; index: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    const p = clientToImage(e.clientX, e.clientY);
    if (!p) return;
    if (calibrationMode) {
      onCalibrationPoint(p);
      return;
    }
    if (effectiveTool === "polygon") {
      e.preventDefault();
      if (polyDraft && polyDraft.length >= 2) {
        const next = tryRemoveDraftPolylinePoint(p, polyDraft, 12, 14);
        if (next != null) {
          if (next.length === 0) {
            setPolyDraft(null);
          } else {
            setPolyDraft(next);
          }
          return;
        }
      }
      setPolyDraft((prev) => (prev ? [...prev, p] : [p]));
      return;
    }
    if (effectiveTool === "rect" || effectiveTool === "lShape") {
      setDragRect({ a: p, b: p });
      return;
    }
    if (effectiveTool === "select") {
      for (let i = pieces.length - 1; i >= 0; i--) {
        const piece = pieces[i];
        if (pointInPoly(p, piece.points)) {
          onSelectPiece(piece.id);
          return;
        }
      }
      onSelectPiece(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (calibrationMode) return;
    const p = clientToImage(e.clientX, e.clientY);
    if (!p) return;
    if (dragRect && (effectiveTool === "rect" || effectiveTool === "lShape")) {
      setDragRect({ ...dragRect, b: p });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (calibrationMode) return;
    const p = clientToImage(e.clientX, e.clientY);
    if (dragRect && p && (effectiveTool === "rect" || effectiveTool === "lShape")) {
      const { a, b } = dragRect;
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      if (w > 8 && h > 8) {
        const corners = rectFromCorners(a, b);
        const id = crypto.randomUUID();
        const newPiece: LayoutPiece =
          effectiveTool === "rect"
            ? {
                id,
                name: nextPieceName(pieces),
                points: corners,
                sinkCount: 0,
                shapeKind: "rectangle",
                source: "manual",
              }
            : {
                id,
                name: nextPieceName(pieces),
                points: unitLShapePolygon(b.x - a.x, b.y - a.y).map((q) => ({
                  x: Math.min(a.x, b.x) + q.x,
                  y: Math.min(a.y, b.y) + q.y,
                })),
                sinkCount: 0,
                shapeKind: "lShape",
                source: "manual",
              };
        onPiecesChange([...pieces, newPiece]);
        onSelectPiece(id);
      }
    }
    setDragRect(null);
    setVertexDrag(null);
  };

  const finishPolygon = useCallback(() => {
    setPolyDraft((prev) => {
      if (!prev || prev.length < 3) return prev;
      const id = crypto.randomUUID();
      const newPiece: LayoutPiece = {
        id,
        name: nextPieceName(pieces),
        points: prev,
        sinkCount: 0,
        shapeKind: "polygon",
        source: "manual",
      };
      onPiecesChange([...pieces, newPiece]);
      onSelectPiece(id);
      return null;
    });
  }, [pieces, onPiecesChange, onSelectPiece]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && effectiveTool === "polygon" && polyDraft && polyDraft.length >= 3) {
        finishPolygon();
      }
      if (ev.key === "Escape") {
        setPolyDraft(null);
        setDragRect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [effectiveTool, polyDraft, pieces, finishPolygon]);

  useEffect(() => {
    if (!vertexDrag) return;
    const move = (ev: PointerEvent) => {
      const p = clientToImage(ev.clientX, ev.clientY);
      if (!p) return;
      onPiecesChange(
        pieces.map((pc) => {
          if (pc.id !== vertexDrag.pieceId) return pc;
          const pts = normalizeClosedRing(pc.points);
          const copy = pts.slice();
          if (vertexDrag.index >= 0 && vertexDrag.index < copy.length) {
            copy[vertexDrag.index] = { ...p };
          }
          return { ...pc, points: copy };
        })
      );
    };
    const up = () => setVertexDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [vertexDrag, clientToImage, pieces, onPiecesChange]);

  const overlaySvg = useMemo(() => {
    if (!imgNatural.w || !imgNatural.h) return null;
    const placementByPiece = new Map<string, PiecePlacement>();
    if (placements) for (const p of placements) placementByPiece.set(p.pieceId, p);
    const slabById = new Map<string, LayoutSlab>();
    if (slabs) for (const s of slabs) slabById.set(s.id, s);
    const ppi = calibration.pixelsPerInch;
    const strokeCal =
      calibration.pointA && calibration.pointB
        ? `M ${calibration.pointA.x} ${calibration.pointA.y} L ${calibration.pointB.x} ${calibration.pointB.y}`
        : "";
    return (
      <svg
        className="ls-trace-overlay"
        width={imgNatural.w}
        height={imgNatural.h}
        viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
      >
        {strokeCal ? (
          <path d={strokeCal} fill="none" stroke="rgba(232,212,139,0.95)" strokeWidth={3} />
        ) : null}
        {calibration.pointA ? <circle cx={calibration.pointA.x} cy={calibration.pointA.y} r={6} fill="var(--ls-accent)" /> : null}
        {calibration.pointB ? <circle cx={calibration.pointB.x} cy={calibration.pointB.y} r={6} fill="var(--ls-accent)" /> : null}
        {pieces.map((piece, idx) => {
          const sel = piece.id === selectedPieceId;
          const pts = ensureClosedRing(normalizeClosedRing(piece.points));
          const d = pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`).join(" ") + " Z";
          const placement = placementByPiece.get(piece.id);
          const slab =
            placement?.slabId != null ? slabById.get(placement.slabId) : undefined;
          const slabTex =
            ppi != null &&
            ppi > 0 &&
            placement &&
            slab &&
            shouldFillPieceWithSlabTexture(piece, placement, slab)
              ? slabTextureRenderParamsTrace({
                  piece,
                  placement,
                  slab,
                  pixelsPerInch: ppi,
                  allPieces: pieces,
                })
              : null;
          const fill = slabTex
            ? sel
              ? "rgba(201,162,39,0.14)"
              : "rgba(6,8,12,0.18)"
            : sel
              ? "rgba(201,162,39,0.18)"
              : `rgba(120,200,255,${0.08 + (idx % 5) * 0.04})`;
          const stroke = sel ? "rgba(232,212,139,0.95)" : "rgba(180,210,255,0.55)";
          return (
            <g key={piece.id}>
              {slabTex ? (
                <defs>
                  <clipPath id={`ls-slab-tex-clip-${piece.id}`}>
                    <path d={d} />
                  </clipPath>
                </defs>
              ) : null}
              {slabTex ? (
                <g clipPath={`url(#ls-slab-tex-clip-${piece.id})`} style={{ pointerEvents: "none" }}>
                  <image
                    href={slabTex.imageUrl}
                    x={0}
                    y={0}
                    width={slabTex.widthIn}
                    height={slabTex.heightIn}
                    preserveAspectRatio="none"
                    transform={slabTex.matrixStr}
                    opacity={0.9}
                    className="ls-slab-layout-fill-image"
                  />
                </g>
              ) : null}
              <path
                d={d}
                fill={fill}
                stroke={stroke}
                strokeWidth={sel ? 2.2 : 1.2}
                style={{ pointerEvents: "none" }}
              />
            </g>
          );
        })}
        {dragRect ? (
          <rect
            x={Math.min(dragRect.a.x, dragRect.b.x)}
            y={Math.min(dragRect.a.y, dragRect.b.y)}
            width={Math.abs(dragRect.b.x - dragRect.a.x)}
            height={Math.abs(dragRect.b.y - dragRect.a.y)}
            fill="rgba(201,162,39,0.12)"
            stroke="rgba(232,212,139,0.7)"
            strokeWidth={1.5}
          />
        ) : null}
        {polyDraft && polyDraft.length > 0 ? (
          <polyline
            points={polyDraft.map((q) => `${q.x},${q.y}`).join(" ")}
            fill="none"
            stroke="rgba(232,212,139,0.85)"
            strokeWidth={2}
          />
        ) : null}
        {effectiveTool === "select" && selectedPieceId
          ? pieces
              .filter((pc) => pc.id === selectedPieceId)
              .map((pc) =>
                normalizeClosedRing(pc.points).map((q, vi) => (
                  <circle
                    key={`${pc.id}-v-${vi}`}
                    cx={q.x}
                    cy={q.y}
                    r={7}
                    fill="rgba(15,15,15,0.55)"
                    stroke="rgba(232,212,139,0.9)"
                    strokeWidth={1.5}
                    style={{ pointerEvents: "all", cursor: "grab" }}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      ev.preventDefault();
                      (ev.target as Element).setPointerCapture(ev.pointerId);
                      setVertexDrag({ pieceId: pc.id, index: vi });
                    }}
                  />
                ))
              )
          : null}
      </svg>
    );
  }, [
    imgNatural,
    calibration,
    pieces,
    selectedPieceId,
    dragRect,
    polyDraft,
    effectiveTool,
    placements,
    slabs,
  ]);

  if (!resolvedUrl) {
    return (
      <div className="ls-trace-empty glass-panel">
        <p className="ls-trace-empty-title">Upload a plan to begin</p>
        <p className="ls-muted">PDF, PNG, JPG, or WebP — then calibrate scale.</p>
      </div>
    );
  }

  return (
    <div className="ls-trace-wrap" ref={wrapRef}>
      <div
        className="ls-trace-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setDragRect(null);
          setVertexDrag(null);
        }}
      >
        <img
          ref={imgRef}
          src={resolvedUrl}
          alt=""
          className="ls-trace-img"
          draggable={false}
          onLoad={(e) => {
            const el = e.currentTarget;
            setImgNatural({ w: el.naturalWidth, h: el.naturalHeight });
          }}
        />
        {overlaySvg}
      </div>
      {effectiveTool === "polygon" && polyDraft && polyDraft.length > 0 ? (
        <div className="ls-floating-hint">
          Press Enter to finish the shape · Esc to cancel · Click a point or line to remove it
        </div>
      ) : null}
    </div>
  );
}
