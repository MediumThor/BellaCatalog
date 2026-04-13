import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  LayoutPiece,
  LayoutPoint,
  LayoutSlab,
  PiecePlacement,
  SavedLayoutCalibration,
  TraceTool,
} from "../types";
import { boundsOfPoints, ensureClosedRing, normalizeClosedRing, rectFromCorners, unitLShapePolygon } from "../utils/geometry";
import { tryRemoveDraftPolylinePoint } from "../utils/blankPlanGeometry";
import {
  nearPoint,
  orthoSnapFirstPoint,
  orthoSnapPreview,
  simplifyOrthoRing,
  type OrthoSnapGuide,
} from "../utils/blankPlanOrthoDraw";
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
  fitPageToWidth?: boolean;
  viewZoom: number;
  boxZoomMode: boolean;
  resetViewSignal?: number;
  zoomToSelectedSignal?: number;
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
  onViewZoomChange: (zoom: number) => void;
  onBoxZoomModeChange: (active: boolean) => void;
};

export const TRACE_VIEW_ZOOM_MIN = 0.25;
export const TRACE_VIEW_ZOOM_MAX = 24;
const TRACE_VIEW_ZOOM_STEP = 0.5;
const TRACE_DRAFT_STROKE = "rgba(120,195,255,0.92)";
const TRACE_DRAFT_STROKE_SOFT = "rgba(120,195,255,0.82)";
const TRACE_DRAFT_FILL = "rgba(120,195,255,0.12)";
const TRACE_CALIBRATION_STROKE = "rgba(232,72,72,0.96)";
const TRACE_CALIBRATION_FILL = "rgba(244,84,84,0.98)";

export function traceViewZoomDisplayPct(viewZoom: number): number {
  return Math.round(viewZoom * 100);
}

function clampTraceViewCenter(
  center: LayoutPoint,
  imgNatural: { w: number; h: number },
  zoom: number,
): LayoutPoint {
  if (!imgNatural.w || !imgNatural.h) return center;
  const safeZoom = Math.max(zoom, TRACE_VIEW_ZOOM_MIN);
  const viewW = imgNatural.w / safeZoom;
  const viewH = imgNatural.h / safeZoom;
  const minX = viewW / 2;
  const maxX = imgNatural.w - viewW / 2;
  const minY = viewH / 2;
  const maxY = imgNatural.h - viewH / 2;
  return {
    x: minX > maxX ? imgNatural.w / 2 : Math.min(maxX, Math.max(minX, center.x)),
    y: minY > maxY ? imgNatural.h / 2 : Math.min(maxY, Math.max(minY, center.y)),
  };
}

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

function pointsAlmostEqual(a: LayoutPoint, b: LayoutPoint, epsilon = 0.5): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

function dedupeSequentialPoints(points: LayoutPoint[]): LayoutPoint[] {
  const next: LayoutPoint[] = [];
  for (const point of points) {
    const last = next[next.length - 1];
    if (!last || !pointsAlmostEqual(last, point)) next.push(point);
  }
  return next;
}

function segmentMidpoint(a: LayoutPoint, b: LayoutPoint): LayoutPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function segmentLength(a: LayoutPoint, b: LayoutPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function formatDraftSegmentLength(length: number, pixelsPerInch: number | null): string {
  if (pixelsPerInch && pixelsPerInch > 0) {
    return `${Math.max(1, Math.round(length / pixelsPerInch))}"`;
  }
  return `${Math.round(length)} px`;
}

function snapTracePointToNearestInch(p: LayoutPoint, pixelsPerInch: number | null): LayoutPoint {
  if (!pixelsPerInch || pixelsPerInch <= 0) return p;
  return {
    x: Math.round(p.x / pixelsPerInch) * pixelsPerInch,
    y: Math.round(p.y / pixelsPerInch) * pixelsPerInch,
  };
}

function collectTraceSnapTargets(
  pieces: readonly LayoutPiece[],
  draft: LayoutPoint[] | null,
  lastVertex: LayoutPoint | null,
): LayoutPoint[] {
  const out: LayoutPoint[] = [];
  for (const piece of pieces) {
    const ring = normalizeClosedRing(piece.points);
    for (const q of ring) {
      if (lastVertex && pointsAlmostEqual(q, lastVertex)) continue;
      out.push({ x: q.x, y: q.y });
    }
  }
  if (draft) {
    for (const q of draft) {
      if (lastVertex && pointsAlmostEqual(q, lastVertex)) continue;
      out.push({ x: q.x, y: q.y });
    }
  }
  return out;
}

export function TraceWorkspace({
  displayUrl,
  isPdfSource,
  fitPageToWidth = false,
  viewZoom,
  boxZoomMode,
  resetViewSignal = 0,
  zoomToSelectedSignal = 0,
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
  onViewZoomChange,
  onBoxZoomModeChange,
}: Props) {
  const effectiveTool: TraceTool =
    tool === "snapLines" || tool === "join" || tool === "cornerRadius" || tool === "connectCorner"
      ? "select"
      : tool;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCenter: LayoutPoint;
  } | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [viewCenter, setViewCenter] = useState<LayoutPoint>({ x: 0, y: 0 });
  const syncNaturalSize = useCallback((w: number, h: number) => {
    if (!w || !h) return;
    setImgNatural((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

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

  useLayoutEffect(() => {
    if (!resolvedUrl) {
      setImgNatural({ w: 0, h: 0 });
      setViewCenter({ x: 0, y: 0 });
      return;
    }
    let cancelled = false;
    const probe = new Image();
    const commitProbeSize = () => {
      if (cancelled || !probe.naturalWidth || !probe.naturalHeight) return;
      syncNaturalSize(probe.naturalWidth, probe.naturalHeight);
    };
    probe.onload = commitProbeSize;
    probe.src = resolvedUrl;
    if (probe.complete) {
      commitProbeSize();
    }
    return () => {
      cancelled = true;
    };
  }, [resolvedUrl, syncNaturalSize]);

  const clientToImage = useCallback((clientX: number, clientY: number): LayoutPoint | null => {
    const svg = svgRef.current;
    if (!svg || !imgNatural.w || !imgNatural.h) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const mapped = pt.matrixTransform(ctm.inverse());
    return {
      x: Math.min(imgNatural.w, Math.max(0, mapped.x)),
      y: Math.min(imgNatural.h, Math.max(0, mapped.y)),
    };
  }, [imgNatural.h, imgNatural.w]);

  const [dragRect, setDragRect] = useState<{ a: LayoutPoint; b: LayoutPoint } | null>(null);
  const [polyDraft, setPolyDraft] = useState<LayoutPoint[] | null>(null);
  const [polyCursor, setPolyCursor] = useState<LayoutPoint | null>(null);
  const [orthoDraft, setOrthoDraft] = useState<LayoutPoint[] | null>(null);
  const [orthoCursor, setOrthoCursor] = useState<LayoutPoint | null>(null);
  const [vertexDrag, setVertexDrag] = useState<{ pieceId: string; index: number } | null>(null);
  const [boxZoomRect, setBoxZoomRect] = useState<{ a: LayoutPoint; b: LayoutPoint } | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      setStageSize({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    onViewZoomChange(1);
    setViewCenter({
      x: imgNatural.w / 2,
      y: imgNatural.h / 2,
    });
    onBoxZoomModeChange(false);
    setBoxZoomRect(null);
  }, [imgNatural.h, imgNatural.w, onBoxZoomModeChange, onViewZoomChange, resolvedUrl]);

  const baseScale = useMemo(() => {
    if (!imgNatural.w || !imgNatural.h || !stageSize.w || !stageSize.h) return 1;
    return Math.min(stageSize.w / imgNatural.w, stageSize.h / imgNatural.h);
  }, [imgNatural.h, imgNatural.w, stageSize.h, stageSize.w]);

  const renderScale = useMemo(() => baseScale * viewZoom, [baseScale, viewZoom]);

  useEffect(() => {
    if (!imgNatural.w || !imgNatural.h) return;
    setViewCenter((prev) => clampTraceViewCenter(prev, imgNatural, viewZoom));
  }, [imgNatural, viewZoom]);

  const viewBox = useMemo(() => {
    if (!imgNatural.w || !imgNatural.h) return null;
    const clampedCenter = clampTraceViewCenter(viewCenter, imgNatural, viewZoom);
    const safeZoom = Math.max(viewZoom, TRACE_VIEW_ZOOM_MIN);
    const width = imgNatural.w / safeZoom;
    const height = imgNatural.h / safeZoom;
    return {
      minX: clampedCenter.x - width / 2,
      minY: clampedCenter.y - height / 2,
      width,
      height,
    };
  }, [imgNatural, viewCenter, viewZoom]);

  const fitBounds = useCallback(
    (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
      if (!imgNatural.w || !imgNatural.h) return;
      const bw = Math.max(24, bounds.maxX - bounds.minX);
      const bh = Math.max(24, bounds.maxY - bounds.minY);
      const nextZoom = Math.min(
        TRACE_VIEW_ZOOM_MAX,
        Math.max(TRACE_VIEW_ZOOM_MIN, Math.min(imgNatural.w / (bw * 1.15), imgNatural.h / (bh * 1.15))),
      );
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      onViewZoomChange(nextZoom);
      setViewCenter(clampTraceViewCenter({ x: cx, y: cy }, imgNatural, nextZoom));
    },
    [imgNatural, onViewZoomChange]
  );

  const resetView = useCallback(() => {
    onViewZoomChange(1);
    onBoxZoomModeChange(false);
    setBoxZoomRect(null);
    setViewCenter({
      x: imgNatural.w / 2,
      y: imgNatural.h / 2,
    });
  }, [imgNatural.h, imgNatural.w, onBoxZoomModeChange, onViewZoomChange]);

  const zoomTo = useCallback(
    (nextZoom: number, focusImage?: LayoutPoint | null, focusStage?: LayoutPoint | null) => {
      if (!imgNatural.w || !imgNatural.h) return;
      const clamped = Math.min(TRACE_VIEW_ZOOM_MAX, Math.max(TRACE_VIEW_ZOOM_MIN, nextZoom));
      let nextCenter = clampTraceViewCenter(viewCenter, imgNatural, clamped);
      if (focusImage && focusStage && baseScale > 0) {
        const nextViewW = imgNatural.w / clamped;
        const nextViewH = imgNatural.h / clamped;
        const marginX = Math.max(0, (stageSize.w - imgNatural.w * baseScale) / 2);
        const marginY = Math.max(0, (stageSize.h - imgNatural.h * baseScale) / 2);
        const nextScale = Math.max(baseScale * clamped, 1e-6);
        nextCenter = clampTraceViewCenter(
          {
            x: focusImage.x + nextViewW / 2 - (focusStage.x - marginX) / nextScale,
            y: focusImage.y + nextViewH / 2 - (focusStage.y - marginY) / nextScale,
          },
          imgNatural,
          clamped,
        );
      }
      onViewZoomChange(clamped);
      setViewCenter(nextCenter);
    },
    [baseScale, imgNatural, onViewZoomChange, stageSize.h, stageSize.w, viewCenter]
  );

  const zoomToSelected = useCallback(() => {
    if (!selectedPieceId) return;
    const piece = pieces.find((item) => item.id === selectedPieceId);
    if (!piece) return;
    const bounds = boundsOfPoints(normalizeClosedRing(piece.points));
    if (!bounds) return;
    fitBounds(bounds);
    onBoxZoomModeChange(false);
  }, [fitBounds, onBoxZoomModeChange, pieces, selectedPieceId]);

  const finishOrthoPolygon = useCallback(() => {
    setOrthoDraft((prev) => {
      const ring = simplifyOrthoRing(dedupeSequentialPoints(prev ?? []));
      if (ring.length < 3) return prev;
      const id = crypto.randomUUID();
      const newPiece: LayoutPiece = {
        id,
        name: nextPieceName(pieces),
        points: ring,
        sinkCount: 0,
        shapeKind: "polygon",
        source: "manual",
      };
      onPiecesChange([...pieces, newPiece]);
      onSelectPiece(id);
      setOrthoCursor(null);
      onBoxZoomModeChange(false);
      return null;
    });
  }, [onBoxZoomModeChange, pieces, onPiecesChange, onSelectPiece]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const p = clientToImage(e.clientX, e.clientY);
    if (!p) return;
    const backgroundHit = !pieces.some((piece) => pointInPoly(p, piece.points));
    if (
      e.button === 1 ||
      e.button === 2 ||
      (e.button === 0 &&
        viewZoom > 1 &&
        tool === "select" &&
        !boxZoomMode &&
        !calibrationMode &&
        backgroundHit)
    ) {
      e.preventDefault();
      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      panDragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCenter: viewCenter,
      };
      return;
    }
    if (calibrationMode) {
      onCalibrationPoint(p);
      return;
    }
    if (boxZoomMode) {
      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      setBoxZoomRect({ a: p, b: p });
      return;
    }
    if (effectiveTool === "polygon") {
      e.preventDefault();
      const closeRadius = Math.max(6, 18 / Math.max(renderScale, 0.0001));
      const hitRadius = Math.max(4, 12 / Math.max(renderScale, 0.0001));
      const snappedPoint = snapTracePointToNearestInch(p, calibration.pixelsPerInch);
      if (polyDraft && polyDraft.length >= 3 && nearPoint(polyDraft[0], snappedPoint, closeRadius)) {
        finishPolygon();
        return;
      }
      if (polyDraft && polyDraft.length >= 2) {
        const next = tryRemoveDraftPolylinePoint(snappedPoint, polyDraft, hitRadius, hitRadius * 1.15);
        if (next != null) {
          if (next.length === 0) {
            setPolyDraft(null);
          } else {
            setPolyDraft(next);
          }
          return;
        }
      }
      setPolyDraft((prev) => (prev ? [...prev, snappedPoint] : [snappedPoint]));
      setPolyCursor(snappedPoint);
      return;
    }
    if (effectiveTool === "orthoDraw") {
      e.preventDefault();
      setOrthoCursor(p);
      const snapTh = Math.max(4, 12 / Math.max(renderScale, 0.0001));
      const guideTh = Math.max(6, 18 / Math.max(renderScale, 0.0001));
      const hitRadius = Math.max(4, 12 / Math.max(renderScale, 0.0001));
      const snappedPoint = snapTracePointToNearestInch(p, calibration.pixelsPerInch);
      if (orthoDraft && orthoDraft.length >= 3 && nearPoint(orthoDraft[0], snappedPoint, hitRadius)) {
        finishOrthoPolygon();
        return;
      }
      if (orthoDraft && orthoDraft.length >= 2) {
        const next = tryRemoveDraftPolylinePoint(p, orthoDraft, hitRadius, hitRadius * 1.15);
        if (next != null) {
          setOrthoDraft(next.length > 0 ? next : null);
          return;
        }
      }
      if (!orthoDraft || orthoDraft.length === 0) {
        const targets = collectTraceSnapTargets(pieces, null, null);
        const first = snapTracePointToNearestInch(
          orthoSnapFirstPoint(p, targets, snapTh, guideTh).preview,
          calibration.pixelsPerInch,
        );
        setOrthoDraft([first]);
        return;
      }
      const last = orthoDraft[orthoDraft.length - 1];
      const targets = collectTraceSnapTargets(pieces, orthoDraft, last);
      const snapped = snapTracePointToNearestInch(
        orthoSnapPreview(last, p, targets, snapTh, guideTh).preview,
        calibration.pixelsPerInch,
      );
      const closeRadius = Math.max(6, 18 / Math.max(renderScale, 0.0001));
      if (orthoDraft.length >= 3 && nearPoint(orthoDraft[0], snapped, closeRadius)) {
        finishOrthoPolygon();
        return;
      }
      setOrthoDraft((prev) => {
        if (!prev || prev.length === 0) {
          const targets = collectTraceSnapTargets(pieces, null, null);
          const first = snapTracePointToNearestInch(
            orthoSnapFirstPoint(p, targets, snapTh, guideTh).preview,
            calibration.pixelsPerInch,
          );
          return [first];
        }
        const lastPrev = prev[prev.length - 1];
        if (pointsAlmostEqual(lastPrev, snapped)) return prev;
        return [...prev, snapped];
      });
      return;
    }
    if (effectiveTool === "rect" || effectiveTool === "lShape") {
      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
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
    const p = clientToImage(e.clientX, e.clientY);
    if (!p) return;
    const panDrag = panDragRef.current;
    if (panDrag && panDrag.pointerId === e.pointerId) {
      const unitsPerScreenPx = 1 / Math.max(renderScale, 1e-6);
      setViewCenter(
        clampTraceViewCenter(
          {
            x: panDrag.startCenter.x - (e.clientX - panDrag.startClientX) * unitsPerScreenPx,
            y: panDrag.startCenter.y - (e.clientY - panDrag.startClientY) * unitsPerScreenPx,
          },
          imgNatural,
          viewZoom,
        ),
      );
      return;
    }
    if (calibrationMode) return;
    if (effectiveTool === "polygon") {
      setPolyCursor(p);
    }
    if (boxZoomRect) {
      setBoxZoomRect((prev) => (prev ? { ...prev, b: p } : prev));
      return;
    }
    if (effectiveTool === "orthoDraw") {
      setOrthoCursor(p);
    }
    if (dragRect && (effectiveTool === "rect" || effectiveTool === "lShape")) {
      setDragRect({ ...dragRect, b: p });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const panDrag = panDragRef.current;
    if (panDrag && panDrag.pointerId === e.pointerId) {
      panDragRef.current = null;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      return;
    }
    if (calibrationMode) return;
    const p = clientToImage(e.clientX, e.clientY);
    if (boxZoomRect) {
      const end = p ?? boxZoomRect.b;
      const bounds = {
        minX: Math.min(boxZoomRect.a.x, end.x),
        minY: Math.min(boxZoomRect.a.y, end.y),
        maxX: Math.max(boxZoomRect.a.x, end.x),
        maxY: Math.max(boxZoomRect.a.y, end.y),
      };
      setBoxZoomRect(null);
      onBoxZoomModeChange(false);
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (bounds.maxX - bounds.minX > 10 && bounds.maxY - bounds.minY > 10) {
        fitBounds(bounds);
      }
      return;
    }
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
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    setDragRect(null);
    setVertexDrag(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!imgNatural.w || !imgNatural.h) return;
    const focus = clientToImage(e.clientX, e.clientY);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!focus) return;
    if (!rect) return;
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    zoomTo(viewZoom + direction * TRACE_VIEW_ZOOM_STEP, focus, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
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
    if (effectiveTool !== "orthoDraw") {
      setOrthoDraft(null);
      setOrthoCursor(null);
    }
  }, [effectiveTool]);

  useEffect(() => {
    if (effectiveTool !== "polygon") {
      setPolyCursor(null);
    }
  }, [effectiveTool]);

  useEffect(() => {
    if (!boxZoomMode) {
      setBoxZoomRect(null);
    }
  }, [boxZoomMode]);

  useEffect(() => {
    resetView();
  }, [resetView, resetViewSignal]);

  useEffect(() => {
    if (zoomToSelectedSignal <= 0) return;
    zoomToSelected();
  }, [zoomToSelected, zoomToSelectedSignal]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && effectiveTool === "polygon" && polyDraft && polyDraft.length >= 3) {
        finishPolygon();
      }
      if (ev.key === "Enter" && effectiveTool === "orthoDraw" && orthoDraft && orthoDraft.length >= 3) {
        finishOrthoPolygon();
      }
      if (ev.key === "Escape") {
        setPolyDraft(null);
        setPolyCursor(null);
        setOrthoDraft(null);
        setOrthoCursor(null);
        setDragRect(null);
        setBoxZoomRect(null);
        onBoxZoomModeChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [effectiveTool, polyDraft, orthoDraft, finishPolygon, finishOrthoPolygon]);

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
    const calibrationHandleRadius = 4 / Math.max(renderScale, 0.0001);
    const calibrationStrokeWidth = 2.25 / Math.max(renderScale, 0.0001);
    const snapTh = Math.max(4, 12 / Math.max(renderScale, 0.0001));
    const guideTh = Math.max(6, 18 / Math.max(renderScale, 0.0001));
    const strokeCal =
      calibration.pointA && calibration.pointB
        ? `M ${calibration.pointA.x} ${calibration.pointA.y} L ${calibration.pointB.x} ${calibration.pointB.y}`
        : "";
    let orthoDrawSnap: { preview: LayoutPoint; guides: OrthoSnapGuide[] } | null = null;
    if (effectiveTool === "orthoDraw" && orthoCursor) {
      if (!orthoDraft || orthoDraft.length === 0) {
        orthoDrawSnap = orthoSnapFirstPoint(orthoCursor, collectTraceSnapTargets(pieces, null, null), snapTh, guideTh);
      } else {
        const last = orthoDraft[orthoDraft.length - 1];
        orthoDrawSnap = orthoSnapPreview(last, orthoCursor, collectTraceSnapTargets(pieces, orthoDraft, last), snapTh, guideTh);
      }
    }
    const orthoCloseRadius = Math.max(6, 18 / Math.max(renderScale, 0.0001));
    const polygonCloseRadius = Math.max(6, 18 / Math.max(renderScale, 0.0001));
    const orthoPreviewPoint =
      orthoDrawSnap && orthoDraft && orthoDraft.length > 0
        ? snapTracePointToNearestInch(orthoDrawSnap.preview, ppi)
        : null;
    const polygonPreviewPoint =
      polyDraft && polyDraft.length > 0 && polyCursor
        ? snapTracePointToNearestInch(polyCursor, ppi)
        : null;
    const orthoDisplayPreview =
      orthoDraft &&
      orthoDraft.length >= 3 &&
      orthoPreviewPoint &&
      nearPoint(orthoDraft[0], orthoPreviewPoint, orthoCloseRadius)
        ? orthoDraft[0]
        : orthoPreviewPoint;
    const polygonDisplayPreview =
      polyDraft &&
      polyDraft.length >= 3 &&
      polygonPreviewPoint &&
      nearPoint(polyDraft[0], polygonPreviewPoint, polygonCloseRadius)
        ? polyDraft[0]
        : polygonPreviewPoint;
    const activeDraftSegment =
      effectiveTool === "orthoDraw" &&
      orthoDraft &&
      orthoDraft.length > 0 &&
      orthoDisplayPreview &&
      !nearPoint(orthoDraft[orthoDraft.length - 1], orthoDisplayPreview, 1e-6)
        ? {
            a: orthoDraft[orthoDraft.length - 1],
            b: orthoDisplayPreview,
            lengthLabel: formatDraftSegmentLength(segmentLength(orthoDraft[orthoDraft.length - 1], orthoDisplayPreview), ppi),
          }
        : effectiveTool === "polygon" &&
            polyDraft &&
            polyDraft.length > 0 &&
            polygonDisplayPreview &&
            !nearPoint(polyDraft[polyDraft.length - 1], polygonDisplayPreview, 1e-6)
          ? {
              a: polyDraft[polyDraft.length - 1],
              b: polygonDisplayPreview,
              lengthLabel: formatDraftSegmentLength(segmentLength(polyDraft[polyDraft.length - 1], polygonDisplayPreview), ppi),
            }
          : null;
    return (
      <>
        {strokeCal ? (
          <path
            d={strokeCal}
            fill="none"
            stroke={TRACE_CALIBRATION_STROKE}
            strokeWidth={calibrationStrokeWidth}
          />
        ) : null}
        {calibration.pointA ? (
          <circle
            cx={calibration.pointA.x}
            cy={calibration.pointA.y}
            r={calibrationHandleRadius}
            fill={TRACE_CALIBRATION_FILL}
          />
        ) : null}
        {calibration.pointB ? (
          <circle
            cx={calibration.pointB.x}
            cy={calibration.pointB.y}
            r={calibrationHandleRadius}
            fill={TRACE_CALIBRATION_FILL}
          />
        ) : null}
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
        {tool === "orthoDraw" && orthoDrawSnap && orthoDrawSnap.guides.length > 0
          ? orthoDrawSnap.guides.map((g, gi) =>
              g.kind === "vertical" ? (
                <line
                  key={`trace-ortho-guide-v-${gi}`}
                  x1={g.x}
                  y1={0}
                  x2={g.x}
                  y2={imgNatural.h}
                  stroke={TRACE_DRAFT_STROKE_SOFT}
                  strokeWidth={1.2}
                  strokeDasharray="7 4"
                  pointerEvents="none"
                />
              ) : (
                <line
                  key={`trace-ortho-guide-h-${gi}`}
                  x1={0}
                  y1={g.y}
                  x2={imgNatural.w}
                  y2={g.y}
                  stroke={TRACE_DRAFT_STROKE_SOFT}
                  strokeWidth={1.2}
                  strokeDasharray="7 4"
                  pointerEvents="none"
                />
              ),
            )
          : null}
        {dragRect ? (
          <rect
            x={Math.min(dragRect.a.x, dragRect.b.x)}
            y={Math.min(dragRect.a.y, dragRect.b.y)}
            width={Math.abs(dragRect.b.x - dragRect.a.x)}
            height={Math.abs(dragRect.b.y - dragRect.a.y)}
            fill={TRACE_DRAFT_FILL}
            stroke={TRACE_DRAFT_STROKE_SOFT}
            strokeWidth={1.5}
          />
        ) : null}
        {boxZoomRect ? (
          <rect
            x={Math.min(boxZoomRect.a.x, boxZoomRect.b.x)}
            y={Math.min(boxZoomRect.a.y, boxZoomRect.b.y)}
            width={Math.abs(boxZoomRect.b.x - boxZoomRect.a.x)}
            height={Math.abs(boxZoomRect.b.y - boxZoomRect.a.y)}
            fill="rgba(232,212,139,0.12)"
            stroke="rgba(232,212,139,0.92)"
            strokeWidth={1.5}
            pointerEvents="none"
          />
        ) : null}
        {polyDraft && polyDraft.length > 0 ? (
          <>
            {polyDraft.length >= 2 ? (
              <polyline
                points={polyDraft.map((q) => `${q.x},${q.y}`).join(" ")}
                fill="none"
                stroke={TRACE_DRAFT_STROKE}
                strokeWidth={2}
              />
            ) : null}
            {polygonDisplayPreview ? (
              <line
                x1={polyDraft[polyDraft.length - 1].x}
                y1={polyDraft[polyDraft.length - 1].y}
                x2={polygonDisplayPreview.x}
                y2={polygonDisplayPreview.y}
                stroke={TRACE_DRAFT_STROKE}
                strokeWidth={1.6}
                strokeDasharray="7 4"
                pointerEvents="none"
              />
            ) : null}
          </>
        ) : null}
        {orthoDraft && orthoDraft.length >= 2 ? (
          <polyline
            points={orthoDraft.map((q) => `${q.x},${q.y}`).join(" ")}
            fill="none"
            stroke={TRACE_DRAFT_STROKE}
            strokeWidth={2}
            pointerEvents="none"
          />
        ) : null}
        {orthoDraft && orthoDraft.length > 0 && orthoDisplayPreview ? (
          <line
            x1={orthoDraft[orthoDraft.length - 1].x}
            y1={orthoDraft[orthoDraft.length - 1].y}
            x2={orthoDisplayPreview.x}
            y2={orthoDisplayPreview.y}
            stroke={TRACE_DRAFT_STROKE}
            strokeWidth={1.6}
            strokeDasharray="7 4"
            pointerEvents="none"
          />
        ) : null}
        {effectiveTool === "polygon" && polyDraft && polyDraft.length >= 3 ? (
          <circle
            cx={polyDraft[0].x}
            cy={polyDraft[0].y}
            r={polygonCloseRadius}
            className="ls-draft-close-target"
            pointerEvents="none"
          />
        ) : null}
        {effectiveTool === "orthoDraw" && orthoDraft && orthoDraft.length >= 3 ? (
          <circle
            cx={orthoDraft[0].x}
            cy={orthoDraft[0].y}
            r={orthoCloseRadius}
            className="ls-draft-close-target"
            pointerEvents="none"
          />
        ) : null}
        {activeDraftSegment ? (
          <g className="ls-draft-segment-label" pointerEvents="none">
            <rect
              x={segmentMidpoint(activeDraftSegment.a, activeDraftSegment.b).x - Math.max(18, activeDraftSegment.lengthLabel.length * 5)}
              y={segmentMidpoint(activeDraftSegment.a, activeDraftSegment.b).y - 15}
              width={Math.max(36, activeDraftSegment.lengthLabel.length * 10)}
              height={22}
              rx={6}
              ry={6}
            />
            <text
              x={segmentMidpoint(activeDraftSegment.a, activeDraftSegment.b).x}
              y={segmentMidpoint(activeDraftSegment.a, activeDraftSegment.b).y}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {activeDraftSegment.lengthLabel}
            </text>
          </g>
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
      </>
    );
  }, [
    imgNatural,
    calibration,
    pieces,
    selectedPieceId,
    dragRect,
    boxZoomRect,
    polyDraft,
    polyCursor,
    orthoDraft,
    orthoCursor,
    effectiveTool,
    placements,
    slabs,
    renderScale,
    tool,
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
    <div className="ls-trace-wrap">
      <div
        ref={stageRef}
        className="ls-trace-stage"
        style={{
          ...(fitPageToWidth && imgNatural.w > 0 && imgNatural.h > 0
            ? { aspectRatio: `${imgNatural.w} / ${imgNatural.h}` }
            : {}),
          cursor:
            panDragRef.current != null
              ? "grabbing"
              : boxZoomMode
                ? "crosshair"
                : calibrationMode ||
                    tool === "polygon" ||
                    tool === "rect" ||
                    tool === "lShape" ||
                    tool === "orthoDraw"
                  ? "crosshair"
                  : tool === "select" && viewZoom > 1
                    ? "grab"
                    : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onPointerLeave={() => {
          setDragRect(null);
          setVertexDrag(null);
          setBoxZoomRect(null);
          panDragRef.current = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {viewBox ? (
          <svg
            ref={svgRef}
            className="ls-trace-svg"
            viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <image
              href={resolvedUrl}
              x={0}
              y={0}
              width={imgNatural.w}
              height={imgNatural.h}
              preserveAspectRatio="none"
              pointerEvents="none"
            />
            {overlaySvg}
          </svg>
        ) : null}
      </div>
      {effectiveTool === "polygon" && polyDraft && polyDraft.length > 0 ? (
        <div className="ls-floating-hint">
          Click the first point to close · Enter to finish · Esc to cancel · Click a point or line to remove it
        </div>
      ) : null}
      {effectiveTool === "orthoDraw" && orthoDraft && orthoDraft.length > 0 ? (
        <div className="ls-floating-hint">
          Click the first point to close · Enter to finish · Esc to cancel · Click a point or line to remove it
        </div>
      ) : null}
      {boxZoomMode && !boxZoomRect ? (
        <div className="ls-floating-hint">Zoom box: drag an area on the plan to zoom in · Esc to cancel</div>
      ) : null}
    </div>
  );
}
