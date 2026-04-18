import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  LayoutPiece,
  LayoutPoint,
  LayoutSlab,
  PieceOutletCutout,
  PiecePlacement,
  SavedLayoutCalibration,
  TraceTool,
} from "../types";
import { boundsOfPoints, ensureClosedRing, normalizeClosedRing, rectFromCorners, unitLShapePolygon } from "../utils/geometry";
import {
  hitTestEdge,
  tryRemoveDraftPolylinePoint,
} from "../utils/blankPlanGeometry";
import {
  TRACE_VIEW_ZOOM_MAX,
  TRACE_VIEW_ZOOM_MIN,
} from "../utils/viewZoom";
import {
  nearPoint,
  orthoPreviewPoint,
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
import { TRACE_PLAN_NO_TEXTURE_FILL } from "../utils/planPieceFill";
import { defaultNonSplashPieceName } from "../utils/pieceLabels";
import { isPlanStripPiece } from "../utils/pieceRoles";
import {
  assignOutletsToSplitPieces,
  clampOutletCenter,
} from "../utils/pieceOutlets";
import {
  assignSinksToSplitPieces,
  clampSinkCenter,
} from "../utils/pieceSinks";
import {
  horizontalSeamPreviewChord,
  seamGeometryFromAxisAlignedEdge,
  splitWorldRingAtHorizontalSeam,
  splitWorldRingAtVerticalSeam,
  verticalSeamPreviewChord,
  type SeamFromEdgeGeometry,
} from "../utils/blankPlanPolygonOps";
import { PieceOutletCutoutsSvg } from "./PieceOutletCutoutsSvg";
import { PieceSinkCutoutsSvg } from "./PieceSinkCutoutsSvg";

type Props = {
  displayUrl: string | null;
  isPdfSource: boolean;
  sourceBounds?: { minX: number; minY: number; width: number; height: number } | null;
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
  selectedEdge: { pieceId: string; edgeIndex: number } | null;
  showEdgeDimensions?: boolean;
  onSelectPiece: (id: string | null) => void;
  onSelectEdge: (edge: { pieceId: string; edgeIndex: number } | null) => void;
  onPiecesChange: (pieces: LayoutPiece[]) => void;
  onPiecesChangeLive?: (pieces: LayoutPiece[]) => void;
  onPieceDragStart?: () => void;
  onRequestSplashForEdge: (
    edge: { pieceId: string; edgeIndex: number },
    kind: "splash" | "miter",
  ) => void;
  onRequestAddSinkForEdge?: (edge: { pieceId: string; edgeIndex: number }) => void;
  onRequestAddOutletForEdge?: (edge: { pieceId: string; edgeIndex: number }) => void;
  onToggleProfileEdge: (edge: { pieceId: string; edgeIndex: number }) => void;
  onSetSplashBottomEdge?: (edge: { pieceId: string; edgeIndex: number }) => void;
  slabs?: LayoutSlab[];
  placements?: PiecePlacement[];
  newPieceSourceMeta?: Pick<LayoutPiece, "sourcePageIndex" | "sourcePixelsPerInch">;
  onViewZoomChange: (zoom: number) => void;
  onBoxZoomModeChange: (active: boolean) => void;
};

const TRACE_VIEW_ZOOM_STEP = 0.5;
const TRACE_DRAFT_STROKE = "rgba(120,195,255,0.92)";
const TRACE_DRAFT_STROKE_SOFT = "rgba(120,195,255,0.82)";
const TRACE_DRAFT_FILL = "rgba(120,195,255,0.12)";
const TRACE_CALIBRATION_STROKE = "rgba(232,72,72,0.96)";
const TRACE_CALIBRATION_FILL = "rgba(244,84,84,0.98)";

type EdgeSel = { pieceId: string; edgeIndex: number };

function clampTraceViewCenter(
  center: LayoutPoint,
  bounds: { minX: number; minY: number; width: number; height: number },
  zoom: number,
): LayoutPoint {
  if (!bounds.width || !bounds.height) return center;
  const safeZoom = Math.max(zoom, TRACE_VIEW_ZOOM_MIN);
  const viewW = bounds.width / safeZoom;
  const viewH = bounds.height / safeZoom;
  const minX = bounds.minX + viewW / 2;
  const maxX = bounds.minX + bounds.width - viewW / 2;
  const minY = bounds.minY + viewH / 2;
  const maxY = bounds.minY + bounds.height - viewH / 2;
  return {
    x:
      minX > maxX
        ? bounds.minX + bounds.width / 2
        : Math.min(maxX, Math.max(minX, center.x)),
    y:
      minY > maxY
        ? bounds.minY + bounds.height / 2
        : Math.min(maxY, Math.max(minY, center.y)),
  };
}

function nextPieceName(pieces: LayoutPiece[], offset = 0): string {
  const n = pieces.filter((p) => !isPlanStripPiece(p)).length;
  return defaultNonSplashPieceName(n + offset);
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

function formatSeamValue(value: number, coordPerInch: number | null): string {
  if (coordPerInch && coordPerInch > 0) {
    return String(Math.round((value / coordPerInch) * 1000) / 1000);
  }
  return String(Math.round(value * 1000) / 1000);
}

function parseSeamValue(value: string, coordPerInch: number | null): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (coordPerInch && coordPerInch > 0) return parsed * coordPerInch;
  return parsed;
}

function seamUnitLabel(coordPerInch: number | null): "in" | "px" {
  return coordPerInch && coordPerInch > 0 ? "in" : "px";
}

function seamGeometryFromTraceEdge(
  points: LayoutPoint[],
  edgeIndex: number,
  coordPerInch: number | null
): SeamFromEdgeGeometry | null {
  const strict = seamGeometryFromAxisAlignedEdge(points, edgeIndex);
  if (strict) return strict;
  const ring = normalizeClosedRing(points);
  const n = ring.length;
  if (n < 3) return null;
  const i = edgeIndex % n;
  const a = ring[i]!;
  const b = ring[(i + 1) % n]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx < 1e-6 && absDy < 1e-6) return null;

  const segmentLen = Math.hypot(dx, dy);
  const axisTol =
    coordPerInch && coordPerInch > 0
      ? Math.max(coordPerInch * 0.25, 1.5)
      : Math.max(2, Math.min(8, segmentLen * 0.03));
  const horizontalish = absDx >= absDy && absDy <= axisTol;
  const verticalish = absDy > absDx && absDx <= axisTol;
  if (!horizontalish && !verticalish) return null;

  if (horizontalish) {
    const xMin = Math.min(a.x, b.x);
    const xMax = Math.max(a.x, b.x);
    const span = xMax - xMin;
    if (span <= 1e-6) return null;
    const xSeam = (xMin + xMax) / 2;
    return {
      kind: "vertical",
      xMin,
      xMax,
      xSeam,
      dimA: xSeam - xMin,
      dimB: xMax - xSeam,
      labelA: "Left of seam",
      labelB: "Right of seam",
    };
  }

  const yMin = Math.min(a.y, b.y);
  const yMax = Math.max(a.y, b.y);
  const span = yMax - yMin;
  if (span <= 1e-6) return null;
  const ySeam = (yMin + yMax) / 2;
  return {
    kind: "horizontal",
    yMin,
    yMax,
    ySeam,
    dimA: ySeam - yMin,
    dimB: yMax - ySeam,
    labelA: "Upper side",
    labelB: "Lower side",
  };
}

function pickTraceEdgeAtPoint(
  p: LayoutPoint,
  pieces: readonly LayoutPiece[],
  maxDist: number,
): EdgeSel | null {
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i]!;
    const edgeIndex = hitTestEdge(p, piece.points, maxDist);
    if (edgeIndex != null) {
      return { pieceId: piece.id, edgeIndex };
    }
  }
  return null;
}

function formatDraftSegmentLength(length: number, pixelsPerInch: number | null): string {
  if (pixelsPerInch && pixelsPerInch > 0) {
    return `${Math.max(1, Math.round(length / pixelsPerInch))}"`;
  }
  return `${Math.round(length)} px`;
}

function formatDraftRectDimension(length: number, pixelsPerInch: number | null): string {
  if (pixelsPerInch && pixelsPerInch > 0) {
    return `${Math.max(0, Math.round(length / pixelsPerInch))}"`;
  }
  return `${Math.round(length)} px`;
}

function formatTraceEdgeDimension(length: number, pixelsPerInch: number | null): string {
  if (pixelsPerInch && pixelsPerInch > 0) {
    const inValue = length / pixelsPerInch;
    return `${inValue >= 10 ? inValue.toFixed(1) : inValue.toFixed(2)}"`;
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
  sourceBounds = null,
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
  selectedEdge,
  showEdgeDimensions = false,
  onSelectPiece,
  onSelectEdge,
  onPiecesChange,
  onPiecesChangeLive,
  onPieceDragStart,
  onRequestSplashForEdge,
  onRequestAddSinkForEdge,
  onRequestAddOutletForEdge,
  onToggleProfileEdge,
  onSetSplashBottomEdge,
  slabs,
  placements,
  newPieceSourceMeta,
  onViewZoomChange,
  onBoxZoomModeChange,
}: Props) {
  const effectiveTool: TraceTool =
    tool === "snapLines" ||
    tool === "join" ||
    tool === "cornerRadius" ||
    tool === "chamferCorner" ||
    tool === "connectCorner"
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
  const traceBounds = useMemo(
    () =>
      sourceBounds && sourceBounds.width > 0 && sourceBounds.height > 0
        ? sourceBounds
        : imgNatural.w > 0 && imgNatural.h > 0
          ? { minX: 0, minY: 0, width: imgNatural.w, height: imgNatural.h }
          : null,
    [
      imgNatural.h,
      imgNatural.w,
      sourceBounds?.minX,
      sourceBounds?.minY,
      sourceBounds?.width,
      sourceBounds?.height,
    ],
  );
  const traceBoundsKey = traceBounds
    ? `${traceBounds.minX}:${traceBounds.minY}:${traceBounds.width}:${traceBounds.height}`
    : "none";
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
    if (!svg || !traceBounds) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const mapped = pt.matrixTransform(ctm.inverse());
    return {
      x: Math.min(traceBounds.minX + traceBounds.width, Math.max(traceBounds.minX, mapped.x)),
      y: Math.min(traceBounds.minY + traceBounds.height, Math.max(traceBounds.minY, mapped.y)),
    };
  }, [traceBounds]);

  const [dragRect, setDragRect] = useState<{ a: LayoutPoint; b: LayoutPoint } | null>(null);
  const [polyDraft, setPolyDraft] = useState<LayoutPoint[] | null>(null);
  const [polyCursor, setPolyCursor] = useState<LayoutPoint | null>(null);
  const [orthoDraft, setOrthoDraft] = useState<LayoutPoint[] | null>(null);
  const [orthoCursor, setOrthoCursor] = useState<LayoutPoint | null>(null);
  const [calibrationCursor, setCalibrationCursor] = useState<LayoutPoint | null>(null);
  const [vertexDrag, setVertexDrag] = useState<{ pieceId: string; index: number } | null>(null);
  const [boxZoomRect, setBoxZoomRect] = useState<{ a: LayoutPoint; b: LayoutPoint } | null>(null);
  const [hoverEdge, setHoverEdge] = useState<EdgeSel | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null);
  const [seamModal, setSeamModal] = useState<{
    pieceId: string;
    edgeIndex: number;
    geometry: SeamFromEdgeGeometry;
    coordPerInch: number | null;
    valA: string;
    valB: string;
  } | null>(null);
  const traceSinkPieces = useMemo(
    () =>
      pieces.map((piece) =>
        piece.planTransform
          ? { ...piece, planTransform: undefined }
          : piece,
      ),
    [pieces],
  );
  const [sinkDrag, setSinkDrag] = useState<{
    pieceId: string;
    sinkId: string;
    start: LayoutPoint;
    startCx: number;
    startCy: number;
  } | null>(null);
  const [outletDrag, setOutletDrag] = useState<{
    pieceId: string;
    outletId: string;
    start: LayoutPoint;
    startCx: number;
    startCy: number;
  } | null>(null);
  const sinkDragOrthoAxisRef = useRef<"x" | "y" | null>(null);

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
    if (!traceBounds) return;
    onViewZoomChange(1);
    setViewCenter({
      x: traceBounds.minX + traceBounds.width / 2,
      y: traceBounds.minY + traceBounds.height / 2,
    });
    onBoxZoomModeChange(false);
    setBoxZoomRect(null);
  }, [onBoxZoomModeChange, onViewZoomChange, resolvedUrl, traceBoundsKey]);

  const baseScale = useMemo(() => {
    if (!traceBounds || !stageSize.w || !stageSize.h) return 1;
    return Math.min(stageSize.w / traceBounds.width, stageSize.h / traceBounds.height);
  }, [stageSize.h, stageSize.w, traceBounds]);

  const renderScale = useMemo(() => baseScale * viewZoom, [baseScale, viewZoom]);

  useEffect(() => {
    if (!traceBounds) return;
    setViewCenter((prev) => clampTraceViewCenter(prev, traceBounds, viewZoom));
  }, [traceBounds, viewZoom]);

  const viewBox = useMemo(() => {
    if (!traceBounds) return null;
    const clampedCenter = clampTraceViewCenter(viewCenter, traceBounds, viewZoom);
    const safeZoom = Math.max(viewZoom, TRACE_VIEW_ZOOM_MIN);
    const width = traceBounds.width / safeZoom;
    const height = traceBounds.height / safeZoom;
    return {
      minX: clampedCenter.x - width / 2,
      minY: clampedCenter.y - height / 2,
      width,
      height,
    };
  }, [traceBounds, viewCenter, viewZoom]);

  const fitBounds = useCallback(
    (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
      if (!traceBounds) return;
      const bw = Math.max(24, bounds.maxX - bounds.minX);
      const bh = Math.max(24, bounds.maxY - bounds.minY);
      const nextZoom = Math.min(
        TRACE_VIEW_ZOOM_MAX,
        Math.max(
          TRACE_VIEW_ZOOM_MIN,
          Math.min(traceBounds.width / (bw * 1.15), traceBounds.height / (bh * 1.15)),
        ),
      );
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      onViewZoomChange(nextZoom);
      setViewCenter(clampTraceViewCenter({ x: cx, y: cy }, traceBounds, nextZoom));
    },
    [onViewZoomChange, traceBounds]
  );

  const resetView = useCallback(() => {
    onViewZoomChange(1);
    onBoxZoomModeChange(false);
    setBoxZoomRect(null);
    if (!traceBounds) return;
    setViewCenter({
      x: traceBounds.minX + traceBounds.width / 2,
      y: traceBounds.minY + traceBounds.height / 2,
    });
  }, [onBoxZoomModeChange, onViewZoomChange, traceBounds]);

  const zoomTo = useCallback(
    (nextZoom: number, focusImage?: LayoutPoint | null, focusStage?: LayoutPoint | null) => {
      if (!traceBounds) return;
      const clamped = Math.min(TRACE_VIEW_ZOOM_MAX, Math.max(TRACE_VIEW_ZOOM_MIN, nextZoom));
      let nextCenter = clampTraceViewCenter(viewCenter, traceBounds, clamped);
      if (focusImage && focusStage && baseScale > 0) {
        const nextViewW = traceBounds.width / clamped;
        const nextViewH = traceBounds.height / clamped;
        const marginX = Math.max(0, (stageSize.w - traceBounds.width * baseScale) / 2);
        const marginY = Math.max(0, (stageSize.h - traceBounds.height * baseScale) / 2);
        const nextScale = Math.max(baseScale * clamped, 1e-6);
        nextCenter = clampTraceViewCenter(
          {
            x: focusImage.x + nextViewW / 2 - (focusStage.x - marginX) / nextScale,
            y: focusImage.y + nextViewH / 2 - (focusStage.y - marginY) / nextScale,
          },
          traceBounds,
          clamped,
        );
      }
      onViewZoomChange(clamped);
      setViewCenter(nextCenter);
    },
    [baseScale, onViewZoomChange, stageSize.h, stageSize.w, traceBounds, viewCenter]
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

  const edgePickMaxDist = useMemo(
    () => Math.max(4, 10 / Math.max(renderScale, 0.0001)),
    [renderScale],
  );

  const coordPerInchForPiece = useCallback(
    (piece: LayoutPiece | null | undefined): number | null => {
      const ppi = piece?.sourcePixelsPerInch ?? calibration.pixelsPerInch ?? null;
      return ppi && ppi > 0 ? ppi : null;
    },
    [calibration.pixelsPerInch],
  );

  const updatePopoverPosition = useCallback(() => {
    if (!selectedEdge || !svgRef.current) {
      setPopoverPos(null);
      return;
    }
    const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
    if (!piece) {
      setPopoverPos(null);
      return;
    }
    const ring = normalizeClosedRing(piece.points);
    const n = ring.length;
    if (n < 2 || selectedEdge.edgeIndex < 0 || selectedEdge.edgeIndex >= n) {
      setPopoverPos(null);
      return;
    }
    const mid = segmentMidpoint(
      ring[selectedEdge.edgeIndex]!,
      ring[(selectedEdge.edgeIndex + 1) % n]!,
    );
    const pt = svgRef.current.createSVGPoint();
    pt.x = mid.x;
    pt.y = mid.y;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const sp = pt.matrixTransform(ctm);
    setPopoverPos({ left: sp.x, top: sp.y });
  }, [pieces, selectedEdge]);

  const openSeamModalFromEdge = useCallback(() => {
    if (!selectedEdge) return;
    const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
    if (!piece || isPlanStripPiece(piece)) return;
    const coordPerInch = coordPerInchForPiece(piece);
    const geometry = seamGeometryFromTraceEdge(piece.points, selectedEdge.edgeIndex, coordPerInch);
    if (!geometry) {
      window.alert("Seams can only be added from a straight horizontal or vertical edge.");
      return;
    }
    setSeamModal({
      pieceId: piece.id,
      edgeIndex: selectedEdge.edgeIndex,
      geometry,
      coordPerInch,
      valA: formatSeamValue(geometry.dimA, coordPerInch),
      valB: formatSeamValue(geometry.dimB, coordPerInch),
    });
  }, [coordPerInchForPiece, pieces, selectedEdge]);

  const startSinkDrag = useCallback(
    (pieceId: string, sinkId: string, e: React.PointerEvent) => {
      if (tool !== "select") return;
      const p = clientToImage(e.clientX, e.clientY);
      if (!p) return;
      const piece = traceSinkPieces.find((candidate) => candidate.id === pieceId);
      const sink = piece?.sinks?.find((candidate) => candidate.id === sinkId);
      if (!piece || !sink || isPlanStripPiece(piece)) return;
      onPieceDragStart?.();
      onSelectPiece(pieceId);
      onSelectEdge(null);
      sinkDragOrthoAxisRef.current = null;
      setSinkDrag({
        pieceId,
        sinkId,
        start: { ...p },
        startCx: sink.centerX,
        startCy: sink.centerY,
      });
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      e.preventDefault();
    },
    [clientToImage, onPieceDragStart, onSelectEdge, onSelectPiece, tool, traceSinkPieces],
  );

  const startOutletDrag = useCallback(
    (pieceId: string, outletId: string, e: React.PointerEvent) => {
      if (tool !== "select") return;
      const p = clientToImage(e.clientX, e.clientY);
      if (!p) return;
      const piece = traceSinkPieces.find((candidate) => candidate.id === pieceId);
      const outlet = piece?.outlets?.find((candidate) => candidate.id === outletId);
      if (!piece || !outlet) return;
      onPieceDragStart?.();
      onSelectPiece(pieceId);
      onSelectEdge(null);
      sinkDragOrthoAxisRef.current = null;
      setOutletDrag({
        pieceId,
        outletId,
        start: { ...p },
        startCx: outlet.centerX,
        startCy: outlet.centerY,
      });
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      e.preventDefault();
    },
    [clientToImage, onPieceDragStart, onSelectEdge, onSelectPiece, tool, traceSinkPieces],
  );

  const seamPreviewLine = useMemo(() => {
    if (!seamModal) return null;
    const piece = pieces.find((p) => p.id === seamModal.pieceId);
    if (!piece) return null;
    const ring = normalizeClosedRing(piece.points);
    const n = ring.length;
    if (n < 2) return null;
    const ei = seamModal.edgeIndex % n;
    const ev0 = ring[ei]!;
    const ev1 = ring[(ei + 1) % n]!;
    const hintY = (ev0.y + ev1.y) / 2;
    const hintX = (ev0.x + ev1.x) / 2;
    const da = parseSeamValue(seamModal.valA, seamModal.coordPerInch);
    if (!da) return null;
    if (seamModal.geometry.kind === "vertical") {
      const x = seamModal.geometry.xMin + da;
      const { y0, y1 } = verticalSeamPreviewChord(piece.points, x, hintY);
      return { kind: "vertical" as const, x, y0, y1 };
    }
    const y = seamModal.geometry.yMin + da;
    const { x0, x1 } = horizontalSeamPreviewChord(piece.points, y, hintX);
    return { kind: "horizontal" as const, y, x0, x1 };
  }, [pieces, seamModal]);

  const applySeamModal = useCallback(() => {
    if (!seamModal) return;
    const targetPiece = pieces.find((p) => p.id === seamModal.pieceId);
    if (!targetPiece || isPlanStripPiece(targetPiece)) {
      setSeamModal(null);
      return;
    }
    const dimA = parseSeamValue(seamModal.valA, seamModal.coordPerInch);
    const dimB = parseSeamValue(seamModal.valB, seamModal.coordPerInch);
    if (!dimA || !dimB) return;
    const seamRing = normalizeClosedRing(targetPiece.points);
    const seamEdgeCount = seamRing.length;
    if (seamEdgeCount < 2) return;
    const seamEdgeIndex = seamModal.edgeIndex % seamEdgeCount;
    const seamStart = seamRing[seamEdgeIndex]!;
    const seamEnd = seamRing[(seamEdgeIndex + 1) % seamEdgeCount]!;
    const seamHint = {
      x: (seamStart.x + seamEnd.x) / 2,
      y: (seamStart.y + seamEnd.y) / 2,
    };
    const commit = (ringA: LayoutPoint[], ringB: LayoutPoint[]) => {
      const idA = crypto.randomUUID();
      const idB = crypto.randomUUID();
      const existingSinks = targetPiece.sinks ?? [];
      const legacyCount =
        existingSinks.length > 0
          ? 0
          : Math.max(0, Math.floor(targetPiece.sinkCount || 0));
      const { sinksA, sinksB } =
        existingSinks.length > 0
          ? assignSinksToSplitPieces(existingSinks, ringA, ringB, 0, 0)
          : {
              sinksA: [] as typeof existingSinks,
              sinksB: [] as typeof existingSinks,
            };
      const splitLegacy = legacyCount > 0;
      const sA = splitLegacy ? Math.floor(legacyCount / 2) : 0;
      const sB = splitLegacy ? legacyCount - sA : 0;
      const existingOutlets = targetPiece.outlets ?? [];
      const legacyOutletCount =
        existingOutlets.length > 0 ? 0 : Math.max(0, Math.floor(targetPiece.outletCount ?? 0));
      const { outletsA, outletsB } =
        existingOutlets.length > 0
          ? assignOutletsToSplitPieces(existingOutlets, ringA, ringB, 0, 0)
          : { outletsA: [] as PieceOutletCutout[], outletsB: [] as PieceOutletCutout[] };
      const splitOutletLegacy = legacyOutletCount > 0;
      const outletCountA = splitOutletLegacy ? Math.floor(legacyOutletCount / 2) : 0;
      const outletCountB = splitOutletLegacy ? legacyOutletCount - outletCountA : 0;
      const splitNameA = nextPieceName(pieces);
      const splitNameB = nextPieceName(pieces, 1);
      const newA: LayoutPiece = {
        ...targetPiece,
        id: idA,
        name: splitNameA,
        points: ringA,
        sinkCount: splitLegacy ? sA : 0,
        outlets: existingOutlets.length > 0 ? outletsA : undefined,
        outletCount: splitOutletLegacy ? outletCountA : undefined,
        sinks: existingSinks.length > 0 ? sinksA : undefined,
        manualDimensions: undefined,
        shapeKind: "polygon",
        edgeTags: undefined,
      };
      const newB: LayoutPiece = {
        ...targetPiece,
        id: idB,
        name: splitNameB,
        points: ringB,
        sinkCount: splitLegacy ? sB : 0,
        outlets: existingOutlets.length > 0 ? outletsB : undefined,
        outletCount: splitOutletLegacy ? outletCountB : undefined,
        sinks: existingSinks.length > 0 ? sinksB : undefined,
        manualDimensions: undefined,
        shapeKind: "polygon",
        edgeTags: undefined,
      };
      const next = pieces
        .filter((piece) => piece.id !== targetPiece.id)
        .concat([newA, newB]);
      onPiecesChange(next);
      onSelectPiece(idA);
      onSelectEdge(null);
      setSeamModal(null);
    };

    if (seamModal.geometry.kind === "vertical") {
      const total = seamModal.geometry.xMax - seamModal.geometry.xMin;
      if (Math.abs(dimA + dimB - total) > 0.08) return;
      const split = splitWorldRingAtVerticalSeam(
        targetPiece.points,
        seamModal.geometry.xMin + dimA,
        seamHint.y,
      );
      if (!split) return;
      commit(split[0], split[1]);
      return;
    }

    const total = seamModal.geometry.yMax - seamModal.geometry.yMin;
    if (Math.abs(dimA + dimB - total) > 0.08) return;
    const split = splitWorldRingAtHorizontalSeam(
      targetPiece.points,
      seamModal.geometry.yMin + dimA,
      seamHint.x,
    );
    if (!split) return;
    commit(split[0], split[1]);
  }, [onPiecesChange, onSelectEdge, onSelectPiece, pieces, seamModal]);

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
        ...newPieceSourceMeta,
      };
      onPiecesChange([...pieces, newPiece]);
      onSelectPiece(id);
      setOrthoCursor(null);
      onBoxZoomModeChange(false);
      return null;
    });
  }, [newPieceSourceMeta, onBoxZoomModeChange, pieces, onPiecesChange, onSelectPiece]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const p = clientToImage(e.clientX, e.clientY);
    if (!p) return;
    const backgroundHit = !pieces.some((piece) => pointInPoly(p, piece.points));
    const edgeClick =
      e.button === 0 &&
      tool === "select" &&
      !boxZoomMode &&
      !calibrationMode
        ? hoverEdge ?? pickTraceEdgeAtPoint(p, pieces, edgePickMaxDist)
        : null;
    if (edgeClick) {
      onSelectPiece(edgeClick.pieceId);
      onSelectEdge(edgeClick);
      setHoverEdge(edgeClick);
      return;
    }
    if (
      e.button === 0 &&
      tool === "select" &&
      !boxZoomMode &&
      !calibrationMode &&
      backgroundHit &&
      (selectedPieceId != null || selectedEdge != null)
    ) {
      onSelectPiece(null);
      onSelectEdge(null);
      setHoverEdge(null);
      return;
    }
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
      const calibrationPoint =
        calibration.pointA && !calibration.pointB ? orthoPreviewPoint(calibration.pointA, p) : p;
      setCalibrationCursor(calibrationPoint);
      onCalibrationPoint(calibrationPoint);
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
      const snapped = snapTracePointToNearestInch(p, calibration.pixelsPerInch);
      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      setDragRect({ a: snapped, b: snapped });
      return;
    }
    if (effectiveTool === "select") {
      const edgeHit = hoverEdge ?? pickTraceEdgeAtPoint(p, pieces, edgePickMaxDist);
      if (edgeHit) {
        onSelectPiece(edgeHit.pieceId);
        onSelectEdge(edgeHit);
        return;
      }
      for (let i = pieces.length - 1; i >= 0; i--) {
        const piece = pieces[i];
        if (pointInPoly(p, piece.points)) {
          onSelectPiece(piece.id);
          onSelectEdge(null);
          return;
        }
      }
      onSelectPiece(null);
      onSelectEdge(null);
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
          traceBounds ?? { minX: 0, minY: 0, width: 1, height: 1 },
          viewZoom,
        ),
      );
      return;
    }
    if (calibrationMode) {
      if (calibration.pointA && !calibration.pointB) {
        setCalibrationCursor(orthoPreviewPoint(calibration.pointA, p));
      } else {
        setCalibrationCursor(p);
      }
      return;
    }
    if (effectiveTool === "polygon") {
      setPolyCursor(p);
    }
    if (outletDrag) {
      let dx = p.x - outletDrag.start.x;
      let dy = p.y - outletDrag.start.y;
      if (dx !== 0 || dy !== 0) {
        if (sinkDragOrthoAxisRef.current == null) {
          sinkDragOrthoAxisRef.current =
            Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        }
        if (sinkDragOrthoAxisRef.current === "x") dy = 0;
        else if (sinkDragOrthoAxisRef.current === "y") dx = 0;
      }
      const piece = traceSinkPieces.find(
        (candidate) => candidate.id === outletDrag.pieceId,
      );
      if (!piece) return;
      const outlet = piece.outlets?.find((candidate) => candidate.id === outletDrag.outletId);
      if (!outlet) return;
      const coordPerInch =
        piece.sourcePixelsPerInch ??
        calibration.pixelsPerInch ??
        1;
      const nextCenter = clampOutletCenter(
        outlet,
        piece,
        traceSinkPieces,
        coordPerInch,
        outletDrag.startCx + dx,
        outletDrag.startCy + dy,
      );
      const nextPieces = pieces.map((candidate) =>
        candidate.id === outletDrag.pieceId
          ? {
              ...candidate,
              outlets: candidate.outlets?.map((item) =>
                item.id === outletDrag.outletId
                  ? {
                      ...item,
                      centerX: nextCenter.centerX,
                      centerY: nextCenter.centerY,
                    }
                  : item,
              ),
            }
          : candidate,
      );
      (onPiecesChangeLive ?? onPiecesChange)(nextPieces);
      setHoverEdge(null);
      return;
    }
    if (sinkDrag) {
      let dx = p.x - sinkDrag.start.x;
      let dy = p.y - sinkDrag.start.y;
      if (dx !== 0 || dy !== 0) {
        if (sinkDragOrthoAxisRef.current == null) {
          sinkDragOrthoAxisRef.current =
            Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        }
        if (sinkDragOrthoAxisRef.current === "x") dy = 0;
        else if (sinkDragOrthoAxisRef.current === "y") dx = 0;
      }
      const piece = traceSinkPieces.find(
        (candidate) => candidate.id === sinkDrag.pieceId,
      );
      if (!piece) return;
      const sink = piece.sinks?.find((candidate) => candidate.id === sinkDrag.sinkId);
      if (!sink) return;
      const coordPerInch =
        piece.sourcePixelsPerInch ??
        calibration.pixelsPerInch ??
        1;
      const nextCenter = clampSinkCenter(
        sink,
        piece,
        traceSinkPieces,
        coordPerInch,
        sinkDrag.startCx + dx,
        sinkDrag.startCy + dy,
      );
      const nextPieces = pieces.map((candidate) =>
        candidate.id === sinkDrag.pieceId
          ? {
              ...candidate,
              sinks: candidate.sinks?.map((item) =>
                item.id === sinkDrag.sinkId
                  ? {
                      ...item,
                      centerX: nextCenter.centerX,
                      centerY: nextCenter.centerY,
                    }
                  : item,
              ),
            }
          : candidate,
      );
      (onPiecesChangeLive ?? onPiecesChange)(nextPieces);
      setHoverEdge(null);
      return;
    }
    if (effectiveTool === "select" && !boxZoomRect && !dragRect) {
      setHoverEdge(pickTraceEdgeAtPoint(p, pieces, edgePickMaxDist));
    } else if (hoverEdge) {
      setHoverEdge(null);
    }
    if (boxZoomRect) {
      setBoxZoomRect((prev) => (prev ? { ...prev, b: p } : prev));
      return;
    }
    if (effectiveTool === "orthoDraw") {
      setOrthoCursor(p);
    }
    if (dragRect && (effectiveTool === "rect" || effectiveTool === "lShape")) {
      setDragRect((prev) =>
        prev
          ? { ...prev, b: snapTracePointToNearestInch(p, calibration.pixelsPerInch) }
          : prev,
      );
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
      const { a } = dragRect;
      const b = snapTracePointToNearestInch(p, calibration.pixelsPerInch);
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
                ...newPieceSourceMeta,
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
                ...newPieceSourceMeta,
              };
        onPiecesChange([...pieces, newPiece]);
        onSelectPiece(id);
      }
    }
    if (outletDrag) {
      sinkDragOrthoAxisRef.current = null;
      setOutletDrag(null);
    }
    if (sinkDrag) {
      sinkDragOrthoAxisRef.current = null;
      setSinkDrag(null);
    }
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    setDragRect(null);
    setVertexDrag(null);
  };

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!traceBounds) return;
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
    },
    [clientToImage, traceBounds, viewZoom, zoomTo],
  );

  /** React `onWheel` is passive — attach a non-passive listener so zoom can call `preventDefault`. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => handleWheel(e);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [handleWheel]);

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
        ...newPieceSourceMeta,
      };
      onPiecesChange([...pieces, newPiece]);
      onSelectPiece(id);
      return null;
    });
  }, [newPieceSourceMeta, pieces, onPiecesChange, onSelectPiece]);

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
    if (!calibrationMode || !calibration.pointA || calibration.pointB) {
      setCalibrationCursor(null);
    }
  }, [calibration.pointA, calibration.pointB, calibrationMode]);

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
    if (!selectedEdge) {
      setPopoverPos(null);
      return;
    }
    if (!pieces.some((piece) => piece.id === selectedEdge.pieceId)) {
      onSelectEdge(null);
      return;
    }
    updatePopoverPosition();
  }, [onSelectEdge, pieces, selectedEdge, updatePopoverPosition, viewBox]);

  useEffect(() => {
    const onResize = () => updatePopoverPosition();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updatePopoverPosition]);

  useEffect(() => {
    if (effectiveTool === "select") return;
    setHoverEdge(null);
    if (selectedEdge) onSelectEdge(null);
  }, [effectiveTool, onSelectEdge, selectedEdge]);

  useEffect(() => {
    if (!seamModal) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setSeamModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seamModal]);

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
        setSinkDrag(null);
        sinkDragOrthoAxisRef.current = null;
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
    if (!traceBounds) return null;
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
    const calibrationPreviewPoint =
      calibrationMode && calibration.pointA && !calibration.pointB ? calibrationCursor : null;
    const strokeCalPreview =
      calibration.pointA &&
      calibrationPreviewPoint &&
      !pointsAlmostEqual(calibration.pointA, calibrationPreviewPoint, 1e-6)
        ? `M ${calibration.pointA.x} ${calibration.pointA.y} L ${calibrationPreviewPoint.x} ${calibrationPreviewPoint.y}`
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
    const overlayBounds = viewBox ?? traceBounds;
    const dragRectReadout =
      dragRect &&
      (effectiveTool === "rect" || effectiveTool === "lShape") &&
      overlayBounds
        ? (() => {
            const minX = Math.min(dragRect.a.x, dragRect.b.x);
            const minY = Math.min(dragRect.a.y, dragRect.b.y);
            const maxX = Math.max(dragRect.a.x, dragRect.b.x);
            const maxY = Math.max(dragRect.a.y, dragRect.b.y);
            const width = maxX - minX;
            const height = maxY - minY;
            const widthText = `W ${formatDraftRectDimension(width, ppi)}`;
            const heightText = `H ${formatDraftRectDimension(height, ppi)}`;
            const widthBoxW = Math.max(40, widthText.length * 10);
            const heightBoxW = Math.max(40, heightText.length * 10);
            const widthY = minY - 15 < overlayBounds.minY + 8 ? maxY + 15 : minY - 15;
            const heightOffset = Math.max(24, heightBoxW / 2 + 8);
            const heightX =
              minX - heightOffset < overlayBounds.minX + 8 ? maxX + heightOffset : minX - heightOffset;
            return {
              widthText,
              heightText,
              widthBoxW,
              heightBoxW,
              widthCenterX: minX + width / 2,
              widthCenterY: widthY,
              heightCenterX: heightX,
              heightCenterY: minY + height / 2,
            };
          })()
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
        {strokeCalPreview ? (
          <path
            d={strokeCalPreview}
            fill="none"
            stroke={TRACE_CALIBRATION_STROKE}
            strokeWidth={calibrationStrokeWidth}
            strokeDasharray="7 4"
            pointerEvents="none"
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
        {calibrationPreviewPoint ? (
          <circle
            cx={calibrationPreviewPoint.x}
            cy={calibrationPreviewPoint.y}
            r={calibrationHandleRadius}
            fill={TRACE_CALIBRATION_FILL}
            opacity={0.72}
            pointerEvents="none"
          />
        ) : null}
        {seamPreviewLine ? (
          seamPreviewLine.kind === "vertical" ? (
            <line
              x1={seamPreviewLine.x}
              y1={seamPreviewLine.y0}
              x2={seamPreviewLine.x}
              y2={seamPreviewLine.y1}
              stroke="rgba(232,212,139,0.96)"
              strokeWidth={2 / Math.max(renderScale, 0.0001)}
              strokeDasharray={`${8 / Math.max(renderScale, 0.0001)} ${5 / Math.max(renderScale, 0.0001)}`}
              pointerEvents="none"
            />
          ) : (
            <line
              x1={seamPreviewLine.x0}
              y1={seamPreviewLine.y}
              x2={seamPreviewLine.x1}
              y2={seamPreviewLine.y}
              stroke="rgba(232,212,139,0.96)"
              strokeWidth={2 / Math.max(renderScale, 0.0001)}
              strokeDasharray={`${8 / Math.max(renderScale, 0.0001)} ${5 / Math.max(renderScale, 0.0001)}`}
              pointerEvents="none"
            />
          )
        ) : null}
        {pieces.map((piece) => {
          const sinkPiece =
            traceSinkPieces.find((candidate) => candidate.id === piece.id) ?? piece;
          const sel = piece.id === selectedPieceId;
          const ring = normalizeClosedRing(piece.points);
          const pts = ensureClosedRing(ring);
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
              : "rgba(6,8,12,0.24)"
            : sel
              ? "rgba(201,162,39,0.18)"
              : TRACE_PLAN_NO_TEXTURE_FILL;
          const stroke = sel ? "rgba(232,212,139,0.95)" : "rgba(74,132,212,0.86)";
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
                    xlinkHref={slabTex.imageUrl}
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
              <PieceSinkCutoutsSvg
                piece={sinkPiece}
                allPieces={traceSinkPieces}
                coordPerInch={
                  piece.sourcePixelsPerInch ??
                  ppi ??
                  1
                }
                selectedSinkId={sinkDrag?.pieceId === piece.id ? sinkDrag.sinkId : null}
                interactive={tool === "select" && selectedPieceId === piece.id}
                onSinkPointerDown={(sinkId, e) => startSinkDrag(piece.id, sinkId, e)}
                appearance="trace"
              />
              {(piece.outlets?.length ?? 0) > 0 ? (
                <PieceOutletCutoutsSvg
                  piece={sinkPiece}
                  allPieces={traceSinkPieces}
                  coordPerInch={
                    piece.sourcePixelsPerInch ??
                    ppi ??
                    1
                  }
                  selectedOutletId={
                    outletDrag?.pieceId === piece.id ? outletDrag.outletId : null
                  }
                  interactive={tool === "select" && selectedPieceId === piece.id}
                  onOutletPointerDown={(outletId, e) => startOutletDrag(piece.id, outletId, e)}
                  appearance="trace"
                />
              ) : null}
              {showEdgeDimensions
                ? ring.map((a, edgeIndex) => {
                    const b = ring[(edgeIndex + 1) % ring.length]!;
                    const length = Math.hypot(b.x - a.x, b.y - a.y);
                    const edgePpi =
                      piece.sourcePixelsPerInch ??
                      ppi ??
                      null;
                    const minLength = edgePpi && edgePpi > 0 ? edgePpi * 0.35 : 8;
                    if (length < minLength) return null;
                    const midX = (a.x + b.x) / 2;
                    const midY = (a.y + b.y) / 2;
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const segmentLengthPx = Math.max(Math.hypot(dx, dy), 1e-6);
                    const nx = -dy / segmentLengthPx;
                    const ny = dx / segmentLengthPx;
                    const offset = Math.min(length * 0.12, edgePpi && edgePpi > 0 ? edgePpi * 0.9 : 18);
                    const tx = midX + nx * offset;
                    const ty = midY + ny * offset;
                    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
                    const label = formatTraceEdgeDimension(length, edgePpi);
                    return (
                      <text
                        key={`${piece.id}-edge-dim-${edgeIndex}`}
                        transform={`translate(${tx},${ty}) rotate(${ang})`}
                        fill="rgba(211, 47, 47, 0.95)"
                        fontSize={Math.max(10 / Math.max(renderScale, 0.0001), 0.56)}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="ls-blank-dim"
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {label}
                      </text>
                    );
                  })
                : null}
              {ring.map((a, edgeIndex) => {
                const b = ring[(edgeIndex + 1) % ring.length]!;
                const isSelected =
                  selectedEdge?.pieceId === piece.id &&
                  selectedEdge.edgeIndex === edgeIndex;
                const isHovered =
                  !isSelected &&
                  hoverEdge?.pieceId === piece.id &&
                  hoverEdge.edgeIndex === edgeIndex;
                if (!isSelected && !isHovered) return null;
                return (
                  <line
                    key={`${piece.id}-edge-highlight-${edgeIndex}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={
                      isSelected
                        ? "rgba(232,212,139,0.98)"
                        : "rgba(235,65,65,0.98)"
                    }
                    strokeWidth={
                      isSelected
                        ? 3 / Math.max(renderScale, 0.0001)
                        : 2.5 / Math.max(renderScale, 0.0001)
                    }
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                );
              })}
            </g>
          );
        })}
        {tool === "orthoDraw" && orthoDrawSnap && orthoDrawSnap.guides.length > 0
          ? orthoDrawSnap.guides.map((g, gi) =>
              g.kind === "vertical" ? (
                <line
                  key={`trace-ortho-guide-v-${gi}`}
                  x1={g.x}
                  y1={traceBounds.minY}
                  x2={g.x}
                  y2={traceBounds.minY + traceBounds.height}
                  stroke={TRACE_DRAFT_STROKE_SOFT}
                  strokeWidth={1.2}
                  strokeDasharray="7 4"
                  pointerEvents="none"
                />
              ) : (
                <line
                  key={`trace-ortho-guide-h-${gi}`}
                  x1={traceBounds.minX}
                  y1={g.y}
                  x2={traceBounds.minX + traceBounds.width}
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
          <>
            <rect
              x={Math.min(dragRect.a.x, dragRect.b.x)}
              y={Math.min(dragRect.a.y, dragRect.b.y)}
              width={Math.abs(dragRect.b.x - dragRect.a.x)}
              height={Math.abs(dragRect.b.y - dragRect.a.y)}
              fill={TRACE_DRAFT_FILL}
              stroke={TRACE_DRAFT_STROKE_SOFT}
              strokeWidth={1.5}
            />
            {dragRectReadout ? (
              <>
                <g className="ls-draft-segment-label" pointerEvents="none">
                  <rect
                    x={dragRectReadout.widthCenterX - dragRectReadout.widthBoxW / 2}
                    y={dragRectReadout.widthCenterY - 15}
                    width={dragRectReadout.widthBoxW}
                    height={22}
                    rx={6}
                    ry={6}
                  />
                  <text
                    x={dragRectReadout.widthCenterX}
                    y={dragRectReadout.widthCenterY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {dragRectReadout.widthText}
                  </text>
                </g>
                <g className="ls-draft-segment-label" pointerEvents="none">
                  <rect
                    x={dragRectReadout.heightCenterX - dragRectReadout.heightBoxW / 2}
                    y={dragRectReadout.heightCenterY - 15}
                    width={dragRectReadout.heightBoxW}
                    height={22}
                    rx={6}
                    ry={6}
                  />
                  <text
                    x={dragRectReadout.heightCenterX}
                    y={dragRectReadout.heightCenterY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {dragRectReadout.heightText}
                  </text>
                </g>
              </>
            ) : null}
          </>
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
    traceBounds,
    calibration,
    calibrationCursor,
    calibrationMode,
    pieces,
    traceSinkPieces,
    selectedPieceId,
    selectedEdge,
    hoverEdge,
    sinkDrag,
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
    viewBox,
    seamPreviewLine,
    startSinkDrag,
    tool,
  ]);

  if (!resolvedUrl && !traceBounds) {
    return (
      <div className="ls-trace-empty glass-panel">
        <p className="ls-trace-empty-title">Upload a plan to begin</p>
        <p className="ls-muted">PDF, PNG, JPG, or WebP — then calibrate scale.</p>
      </div>
    );
  }

  const imageBounds = traceBounds ?? viewBox ?? { minX: 0, minY: 0, width: 1, height: 1 };

  return (
    <div className="ls-trace-wrap">
      <div
        ref={stageRef}
        className="ls-trace-stage"
        style={{
          ...(fitPageToWidth && traceBounds
            ? { aspectRatio: `${traceBounds.width} / ${traceBounds.height}` }
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
                  : tool === "select" && hoverEdge
                    ? "pointer"
                  : tool === "select" && viewZoom > 1
                    ? "grab"
                    : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setDragRect(null);
          setVertexDrag(null);
          setBoxZoomRect(null);
          setHoverEdge(null);
          panDragRef.current = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {viewBox ? (
          <svg
            ref={svgRef}
            className="ls-trace-svg"
            viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
            preserveAspectRatio="xMidYMin meet"
          >
            {resolvedUrl ? (
              <image
                href={resolvedUrl}
                x={imageBounds.minX}
                y={imageBounds.minY}
                width={imageBounds.width}
                height={imageBounds.height}
                preserveAspectRatio="none"
                pointerEvents="none"
              />
            ) : null}
            {overlaySvg}
          </svg>
        ) : null}
      </div>
      {tool === "select" && selectedEdge && popoverPos ? (
        <div
          className="ls-edge-popover-cluster"
          style={{ left: popoverPos.left, top: popoverPos.top }}
        >
          <div className="ls-edge-popover glass-panel">
            <button
              type="button"
              className="ls-edge-popover-btn"
              onClick={() => onToggleProfileEdge(selectedEdge)}
            >
              Profile
            </button>
            {(() => {
              const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
              return piece && !isPlanStripPiece(piece);
            })() ? (
              <button
                type="button"
                className="ls-edge-popover-btn"
                onClick={() => onRequestSplashForEdge(selectedEdge, "splash")}
              >
                Splash
              </button>
            ) : null}
            {(() => {
              const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
              return piece && !isPlanStripPiece(piece);
            })() ? (
              <button
                type="button"
                className="ls-edge-popover-btn"
                title="Same traced placement as splash; 3D preview folds the miter strip down from the edge"
                onClick={() => onRequestSplashForEdge(selectedEdge, "miter")}
              >
                Miter
              </button>
            ) : null}
            {onSetSplashBottomEdge &&
            (() => {
              const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
              return piece && isPlanStripPiece(piece);
            })() ? (
              <button
                type="button"
                className="ls-edge-popover-btn"
                onClick={() => {
                  onSetSplashBottomEdge(selectedEdge);
                  onSelectEdge(null);
                }}
              >
                Bottom (3D)
              </button>
            ) : null}
            {onRequestAddSinkForEdge &&
            (() => {
              const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
              return piece && !isPlanStripPiece(piece);
            })() ? (
              <button
                type="button"
                className="ls-edge-popover-btn"
                onClick={() => onRequestAddSinkForEdge(selectedEdge)}
              >
                Sink
              </button>
            ) : null}
            {onRequestAddOutletForEdge ? (
              <button
                type="button"
                className="ls-edge-popover-btn"
                title="2.25″ × 4″ outlet cutout"
                onClick={() => onRequestAddOutletForEdge(selectedEdge)}
              >
                Outlet
              </button>
            ) : null}
            {(() => {
              const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
              return (
                piece &&
                !isPlanStripPiece(piece) &&
                seamGeometryFromTraceEdge(
                  piece.points,
                  selectedEdge.edgeIndex,
                  coordPerInchForPiece(piece)
                )
              );
            })() ? (
              <button
                type="button"
                className="ls-edge-popover-btn"
                onClick={() => openSeamModalFromEdge()}
              >
                Seam
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {seamModal ? (
        <div
          className="ls-seam-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ls-trace-seam-modal-title"
          onClick={() => setSeamModal(null)}
        >
          <div
            className="ls-seam-modal glass-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="ls-trace-seam-modal-title" className="ls-seam-modal-title">
              Add seam
            </h2>
            <p className="ls-seam-modal-sub">
              Split this traced piece along a seam perpendicular to the selected
              edge. Enter the two edge spans on either side of the seam.
            </p>
            <div className="ls-seam-modal-fields">
              <label className="ls-seam-modal-field">
                {`${seamModal.geometry.labelA} (${seamUnitLabel(seamModal.coordPerInch)})`}
                <input
                  className="ls-input"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={seamModal.valA}
                  onChange={(e) =>
                    setSeamModal((prev) =>
                      prev ? { ...prev, valA: e.target.value } : prev,
                    )
                  }
                  autoFocus
                />
              </label>
              <label className="ls-seam-modal-field">
                {`${seamModal.geometry.labelB} (${seamUnitLabel(seamModal.coordPerInch)})`}
                <input
                  className="ls-input"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={seamModal.valB}
                  onChange={(e) =>
                    setSeamModal((prev) =>
                      prev ? { ...prev, valB: e.target.value } : prev,
                    )
                  }
                />
              </label>
            </div>
            <div className="ls-seam-modal-actions">
              <button
                type="button"
                className="ls-btn ls-btn-secondary"
                onClick={() => setSeamModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ls-btn ls-btn-primary"
                onClick={() => applySeamModal()}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
