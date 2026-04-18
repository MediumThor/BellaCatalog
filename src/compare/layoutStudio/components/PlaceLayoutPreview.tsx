import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { LayoutPiece, LayoutPoint, LayoutSlab, PiecePlacement } from "../types";
import {
  getEffectiveEdgeArcCirclesIn,
  getEffectiveEdgeArcSagittasIn,
  pathDClosedRingWithArcs,
  pieceHasArcEdges,
  sampleArcEdgePointsForStroke,
} from "../utils/blankPlanEdgeArc";
import { planDisplayPoints, planWorldOffset } from "../utils/blankPlanGeometry";
import { seamGeometryFromAxisAlignedEdge, type SeamFromEdgeGeometry } from "../utils/blankPlanPolygonOps";
import { centroid, ensureClosedRing, normalizeClosedRing } from "../utils/geometry";
import {
  slabTextureRenderParams,
  slabTextureRenderParamsTrace,
  shouldFillPieceWithSlabTexture,
} from "../utils/slabLayoutTexture";
import { edgeStripLetterLabelByPieceId, pieceLabelByPieceId } from "../utils/pieceLabels";
import { isPlanStripPiece } from "../utils/pieceRoles";
import { clipEdgeStrokeSegmentsForKitchenSinks, coordPerInchForPlan } from "../utils/pieceSinks";
import { tracePiecesViewBoxDims } from "../utils/tracePiecesViewBox";
import { piecePixelsPerInch, piecesHaveAnyScale } from "../utils/sourcePages";
import { PLAN_PIECE_NO_TEXTURE_FILL } from "../utils/planPieceFill";
import { PieceOutletCutoutsSvg } from "./PieceOutletCutoutsSvg";
import { PieceSinkCutoutsSvg } from "./PieceSinkCutoutsSvg";
import type { PlaceSeamRequest } from "./PlaceWorkspace";

const BLANK_PLAN_WORLD_W_IN = 480;
const BLANK_PLAN_WORLD_H_IN = 240;
const FULLSCREEN_PREVIEW_BASE_HEIGHT_PX = 720;
const MIN_PREVIEW_ZOOM = 1;
const MAX_PREVIEW_ZOOM = 6;
const PREVIEW_ZOOM_SENSITIVITY = 0.0016;
const PREVIEW_DRAG_THRESHOLD_PX = 6;
const PREVIEW_BUTTON_ZOOM_FACTOR = 1.22;
const LIVE_PREVIEW_CLIP_OVERDRAW_PX = 4;
const LIVE_PREVIEW_PIECE_UNDERLAY_FILL = "rgb(244, 241, 234)";

type Props = {
  workspaceKind: "blank" | "source";
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  slabs: LayoutSlab[];
  pixelsPerInch: number | null;
  /** Trace/source workflow: stored plan pixel size; falls back to piece bounds. */
  tracePlanWidth?: number | null;
  tracePlanHeight?: number | null;
  showLabels: boolean;
  showDimensions?: boolean;
  selectedPieceId: string | null;
  /** When non-empty, highlights all listed pieces (Place phase multi-select). */
  selectedPieceIds?: string[];
  /** Distinct prefix when multiple previews mount (e.g. inline + modal) so SVG ids stay unique. */
  previewInstanceId?: string;
  /** `fullscreen` removes inline height caps so the preview can fill a large surface. */
  variant?: "inline" | "fullscreen";
  /** When set, clicking a piece outline places it on the active slab (Place phase). */
  onPieceActivate?: (pieceId: string) => void;
  /** Layout phase seam mode: hover eligible edges and click to open seam placement. */
  seamMode?: boolean;
  /** Commit a seam split requested from live layout preview. */
  onPlaceSeamRequest?: (request: PlaceSeamRequest) => boolean;
  /** Hide +/- controls when embedding a static preview (e.g. Quote phase). */
  showZoomControls?: boolean;
  /** Disable wheel/drag zoom/pan interactions for static previews. */
  allowViewportInteraction?: boolean;
  /** Hide sink text labels for compact embeds. */
  showSinkLabels?: boolean;
  /** Optional override for piece label color in this preview. */
  labelColor?: string;
};

function formatDimInches(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000);
}

function blankViewBoxDims(pieces: LayoutPiece[]): { minX: number; minY: number; width: number; height: number } {
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

function piecePathD(piece: LayoutPiece, workspaceKind: "blank" | "source", allPieces: LayoutPiece[]): string {
  if (workspaceKind === "source") {
    const ringOpen = normalizeClosedRing(piece.points);
    const pts = ensureClosedRing(ringOpen);
    return pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`).join(" ") + " Z";
  }
  const disp = planDisplayPoints(piece, allPieces);
  const ringOpen = normalizeClosedRing(disp);
  const ringCen = centroid(ringOpen);
  if (pieceHasArcEdges(piece)) {
    const { ox, oy } = planWorldOffset(piece, allPieces);
    return pathDClosedRingWithArcs(
      ringOpen,
      getEffectiveEdgeArcSagittasIn(piece),
      ringCen,
      getEffectiveEdgeArcCirclesIn(piece),
      { x: ox, y: oy },
    );
  }
  const pts = ensureClosedRing(ringOpen);
  return pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`).join(" ") + " Z";
}

function resolveSlabTex(
  workspaceKind: "blank" | "source",
  piece: LayoutPiece,
  placement: PiecePlacement | undefined,
  slab: LayoutSlab | undefined,
  pixelsPerInch: number | null,
  allPieces: LayoutPiece[]
): ReturnType<typeof slabTextureRenderParams> | ReturnType<typeof slabTextureRenderParamsTrace> | null {
  if (!placement || !slab) return null;
  if (!shouldFillPieceWithSlabTexture(piece, placement, slab)) return null;
  return workspaceKind === "source"
    ? slabTextureRenderParamsTrace({ piece, placement, slab, pixelsPerInch, allPieces })
    : slabTextureRenderParams({ piece, placement, slab, pixelsPerInch: pixelsPerInch ?? 1, allPieces });
}

export function PlaceLayoutPreview({
  workspaceKind,
  pieces,
  placements,
  slabs,
  pixelsPerInch,
  tracePlanWidth,
  tracePlanHeight,
  showLabels,
  showDimensions = false,
  selectedPieceId,
  selectedPieceIds,
  previewInstanceId = "inline",
  variant = "inline",
  onPieceActivate,
  seamMode = false,
  onPlaceSeamRequest,
  showZoomControls = true,
  allowViewportInteraction = true,
  showSinkLabels = true,
  labelColor = "rgba(13, 71, 161, 0.92)",
}: Props) {
  const pid = previewInstanceId;
  const isFullscreen = variant === "fullscreen";
  const shellClass = `ls-place-layout-preview-shell${isFullscreen ? " ls-place-layout-preview-shell--fullscreen" : ""}`;
  const svgClass = `ls-place-layout-preview-svg${isFullscreen ? " ls-place-layout-preview-svg--fullscreen" : ""}`;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [inlinePan, setInlinePan] = useState({ x: 0, y: 0 });
  const inlinePanRef = useRef(inlinePan);
  inlinePanRef.current = inlinePan;
  const [isDragPanning, setIsDragPanning] = useState(false);
  const dragPanRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextViewportClickRef = useRef(false);
  const pendingZoomAnchorRef = useRef<{
    viewportX: number;
    viewportY: number;
    previousZoom: number;
    nextZoom: number;
  } | null>(null);
  const autoCenterKeyRef = useRef<string | null>(null);
  const placementByPiece = useMemo(() => {
    const m = new Map<string, PiecePlacement>();
    for (const p of placements) m.set(p.pieceId, p);
    return m;
  }, [placements]);

  const slabById = useMemo(() => {
    const m = new Map<string, LayoutSlab>();
    for (const s of slabs) m.set(s.id, s);
    return m;
  }, [slabs]);

  const pieceLabelById = useMemo(() => pieceLabelByPieceId(pieces), [pieces]);
  const stripLetterLabelById = useMemo(() => edgeStripLetterLabelByPieceId(pieces), [pieces]);
  const [hoverSeamEdge, setHoverSeamEdge] = useState<{ pieceId: string; edgeIndex: number } | null>(null);
  const [seamModal, setSeamModal] = useState<{
    pieceId: string;
    edgeIndex: number;
    geometry: SeamFromEdgeGeometry;
    valA: string;
    valB: string;
    error?: string;
  } | null>(null);

  const traceDims = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    for (const pc of pieces) {
      for (const p of pc.points) {
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const w = Math.max(tracePlanWidth ?? 0, maxX, 1);
    const h = Math.max(tracePlanHeight ?? 0, maxY, 1);
    return { w, h };
  }, [pieces, tracePlanWidth, tracePlanHeight]);

  const blankVb = useMemo(() => blankViewBoxDims(pieces), [pieces]);
  const sourceVb = useMemo(
    () => tracePiecesViewBoxDims(pieces, tracePlanWidth, tracePlanHeight),
    [pieces, tracePlanHeight, tracePlanWidth],
  );

  const activeViewBox = workspaceKind === "blank" ? blankVb : sourceVb;
  const viewBoxStr = `${activeViewBox.minX} ${activeViewBox.minY} ${activeViewBox.width} ${activeViewBox.height}`;
  const viewAspectRatio = activeViewBox.width / Math.max(activeViewBox.height, 1);
  const baseFullscreenHeightPx = isFullscreen
    ? Math.max(viewportSize.height || FULLSCREEN_PREVIEW_BASE_HEIGHT_PX, 320)
    : 0;
  const fullscreenSvgWidthPx = isFullscreen
    ? Math.max(baseFullscreenHeightPx * viewAspectRatio * zoom, 240)
    : 0;
  const fullscreenSvgHeightPx = isFullscreen ? baseFullscreenHeightPx * zoom : 0;
  const stageWidthPx = isFullscreen ? Math.max(fullscreenSvgWidthPx, viewportSize.width || 0) : 0;
  const stageHeightPx = isFullscreen ? Math.max(fullscreenSvgHeightPx, viewportSize.height || 0) : 0;
  const inlinePanEnabled = allowViewportInteraction && !isFullscreen && zoom > MIN_PREVIEW_ZOOM + 0.001;
  const inlineFittedContentHeightPx =
    !isFullscreen && viewportSize.width > 0 && viewportSize.height > 0
      ? Math.min(viewportSize.height, viewportSize.width / Math.max(viewAspectRatio, 1e-6))
      : 0;
  const inlineBaseOffsetY =
    !isFullscreen ? -Math.max(viewportSize.height - inlineFittedContentHeightPx, 0) * 0.3 : 0;
  const viewportClass = `ls-place-layout-preview-viewport${isFullscreen ? " ls-place-layout-preview-viewport--fullscreen" : ""}${
    inlinePanEnabled ? " ls-place-layout-preview-viewport--inline-pan" : ""
  }${
    isDragPanning ? " is-dragging" : ""
  }`;
  const stageClass = `ls-place-layout-preview-stage${isFullscreen ? " ls-place-layout-preview-stage--fullscreen" : ""}`;
  const svgStyle = isFullscreen
    ? {
        width: `${fullscreenSvgWidthPx}px`,
        height: `${fullscreenSvgHeightPx}px`,
      }
    : {
        width: "100%",
        height: "100%",
        maxHeight: "none",
        transform: `translate3d(${inlinePan.x}px, ${inlinePan.y + inlineBaseOffsetY}px, 0) scale(${zoom})`,
        transformOrigin: "center center",
      };
  const zoomControlsClass = `ls-place-layout-preview-zoom-controls${
    isFullscreen
      ? " ls-place-layout-preview-zoom-controls--fullscreen"
      : " ls-place-layout-preview-zoom-controls--inline"
  }`;

  const coordPerInch = coordPerInchForPlan(workspaceKind, pixelsPerInch);
  const pieceActivate = seamMode ? undefined : onPieceActivate;

  /** Blank plan uses inch space; slab texture math still expects a positive PPI for catalog slabs. */
  const effectivePpi =
    workspaceKind === "blank"
      ? pixelsPerInch && pixelsPerInch > 0
        ? pixelsPerInch
        : 1
      : pixelsPerInch;

  const clampInlinePan = (x: number, y: number, zoomValue: number) => {
    if (isFullscreen || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return { x: 0, y: 0 };
    }
    const maxPanX = Math.max((viewportSize.width * zoomValue - viewportSize.width) / 2, 0);
    const maxPanY = Math.max((viewportSize.height * zoomValue - viewportSize.height) / 2, 0);
    return {
      x: Math.min(maxPanX, Math.max(-maxPanX, x)),
      y: Math.min(maxPanY, Math.max(-maxPanY, y)),
    };
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateViewportSize = () => {
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    };
    updateViewportSize();
    const resizeObserver = new ResizeObserver(updateViewportSize);
    resizeObserver.observe(viewport);
    return () => resizeObserver.disconnect();
  }, [isFullscreen]);

  useEffect(() => {
    if (seamMode) return;
    setHoverSeamEdge(null);
    setSeamModal(null);
  }, [seamMode]);

  useEffect(() => {
    if (!seamModal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSeamModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seamModal]);

  useEffect(() => {
    if (isFullscreen) return;
    setZoom(1);
    setInlinePan({ x: 0, y: 0 });
    setIsDragPanning(false);
    dragPanRef.current = null;
    suppressNextViewportClickRef.current = false;
    pendingZoomAnchorRef.current = null;
    autoCenterKeyRef.current = null;
  }, [isFullscreen]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const pendingZoomAnchor = pendingZoomAnchorRef.current;
    if (!viewport || !pendingZoomAnchor) return;
    if (!isFullscreen) {
      pendingZoomAnchorRef.current = null;
      return;
    }
    pendingZoomAnchorRef.current = null;
    const { viewportX, viewportY, previousZoom, nextZoom } = pendingZoomAnchor;
    const zoomRatio = nextZoom / previousZoom;
    viewport.scrollLeft = (viewport.scrollLeft + viewportX) * zoomRatio - viewportX;
    viewport.scrollTop = (viewport.scrollTop + viewportY) * zoomRatio - viewportY;
  }, [isFullscreen, zoom]);

  useLayoutEffect(() => {
    if (isFullscreen) return;
    if (zoom <= MIN_PREVIEW_ZOOM + 0.001) {
      if (inlinePanRef.current.x !== 0 || inlinePanRef.current.y !== 0) {
        setInlinePan({ x: 0, y: 0 });
      }
      return;
    }
    const clampedPan = clampInlinePan(inlinePanRef.current.x, inlinePanRef.current.y, zoom);
    if (clampedPan.x !== inlinePanRef.current.x || clampedPan.y !== inlinePanRef.current.y) {
      setInlinePan(clampedPan);
    }
  }, [clampInlinePan, isFullscreen, zoom]);

  useLayoutEffect(() => {
    if (!isFullscreen) return;
    const viewport = viewportRef.current;
    if (!viewport || viewportSize.width <= 0 || viewportSize.height <= 0) return;
    const autoCenterKey = [
      pid,
      workspaceKind,
      pieces.length,
      placements.length,
      activeViewBox.width.toFixed(3),
      activeViewBox.height.toFixed(3),
    ].join(":");
    if (autoCenterKeyRef.current === autoCenterKey) return;
    viewport.scrollLeft = Math.max((stageWidthPx - viewportSize.width) / 2, 0);
    viewport.scrollTop = Math.max((stageHeightPx - viewportSize.height) / 2, 0);
    autoCenterKeyRef.current = autoCenterKey;
  }, [
    activeViewBox.height,
    activeViewBox.width,
    stageHeightPx,
    stageWidthPx,
    isFullscreen,
    pieces.length,
    pid,
    placements.length,
    viewportSize.height,
    viewportSize.width,
    workspaceKind,
  ]);

  const queueZoomTo = (
    requestedZoom: number,
    anchor?: { viewportX: number; viewportY: number },
  ) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const previousZoom = zoomRef.current;
    const nextZoom = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, requestedZoom));
    if (Math.abs(nextZoom - previousZoom) < 0.001) return;
    if (!isFullscreen) {
      if (anchor && viewportSize.width > 0 && viewportSize.height > 0) {
        const zoomRatio = nextZoom / previousZoom;
        const centerX = viewportSize.width / 2;
        const centerY = viewportSize.height / 2;
        const deltaX = anchor.viewportX - centerX;
        const deltaY = anchor.viewportY - centerY;
        const totalPrevPanX = inlinePanRef.current.x;
        const totalPrevPanY = inlinePanRef.current.y + inlineBaseOffsetY;
        const totalNextPanX = deltaX - (deltaX - totalPrevPanX) * zoomRatio;
        const totalNextPanY = deltaY - (deltaY - totalPrevPanY) * zoomRatio;
        setInlinePan(
          clampInlinePan(totalNextPanX, totalNextPanY - inlineBaseOffsetY, nextZoom),
        );
      }
      setZoom(nextZoom);
      return;
    }
    pendingZoomAnchorRef.current = {
      viewportX: anchor?.viewportX ?? viewport.clientWidth / 2,
      viewportY: anchor?.viewportY ?? viewport.clientHeight / 2,
      previousZoom,
      nextZoom,
    };
    setZoom(nextZoom);
  };

  const queueZoomToRef = useRef(queueZoomTo);
  queueZoomToRef.current = queueZoomTo;

  /**
   * React `onWheel` is always passive — `preventDefault` is ignored and the console warns.
   * Attach a non-passive listener in capture phase so default scroll is cancelled before React’s
   * delegated passive handler runs.
   */
  useLayoutEffect(() => {
    if (!allowViewportInteraction) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheelOpts: AddEventListenerOptions = { passive: false, capture: true };
    const onWheelCapture = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      queueZoomToRef.current(zoomRef.current * Math.exp(-event.deltaY * PREVIEW_ZOOM_SENSITIVITY), {
        viewportX: event.clientX - rect.left,
        viewportY: event.clientY - rect.top,
      });
    };
    viewport.addEventListener("wheel", onWheelCapture, wheelOpts);
    return () => viewport.removeEventListener("wheel", onWheelCapture, wheelOpts);
  }, [allowViewportInteraction, workspaceKind, pixelsPerInch, pieces.length]);

  const endDragPan = (pointerId?: number) => {
    const viewport = viewportRef.current;
    if (viewport && pointerId != null && viewport.hasPointerCapture(pointerId)) {
      viewport.releasePointerCapture(pointerId);
    }
    if (dragPanRef.current?.moved) {
      suppressNextViewportClickRef.current = true;
    }
    dragPanRef.current = null;
    setIsDragPanning(false);
  };

  const handleViewportPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!isFullscreen && !inlinePanEnabled) return;
    dragPanRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
      startPanX: inlinePanRef.current.x,
      startPanY: inlinePanRef.current.y,
      moved: false,
    };
    viewport.setPointerCapture(event.pointerId);
  };

  const handleViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const dragPan = dragPanRef.current;
    if (!viewport || !dragPan || dragPan.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragPan.startClientX;
    const deltaY = event.clientY - dragPan.startClientY;
    if (!dragPan.moved && Math.hypot(deltaX, deltaY) >= PREVIEW_DRAG_THRESHOLD_PX) {
      dragPan.moved = true;
      setIsDragPanning(true);
    }
    if (!dragPan.moved) return;
    event.preventDefault();
    if (isFullscreen) {
      viewport.scrollLeft = dragPan.startScrollLeft - deltaX;
      viewport.scrollTop = dragPan.startScrollTop - deltaY;
      return;
    }
    setInlinePan(clampInlinePan(dragPan.startPanX + deltaX, dragPan.startPanY + deltaY, zoomRef.current));
  };

  const handleViewportPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragPan = dragPanRef.current;
    if (!dragPan || dragPan.pointerId !== event.pointerId) return;
    endDragPan(event.pointerId);
  };

  const handleViewportClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressNextViewportClickRef.current) return;
    suppressNextViewportClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  if (workspaceKind === "source" && !piecesHaveAnyScale(pieces, pixelsPerInch)) {
    return (
      <div
        className={`ls-place-layout-preview-empty glass-panel${isFullscreen ? " ls-place-layout-preview-empty--fullscreen" : ""}`}
      >
        <p className="ls-muted">Set scale on the Plan tab to preview mapped material on the layout.</p>
      </div>
    );
  }

  const gradId = `lsPlacePreviewBg-${pid}`;
  const clipId = (pieceId: string) => `ls-place-preview-clip-${pid}-${pieceId}`;

  return (
    <div className={shellClass}>
      {showZoomControls ? (
      <div className={zoomControlsClass} role="toolbar" aria-label="Live layout zoom controls">
          <button
            type="button"
            className="ls-btn ls-btn-secondary ls-place-layout-preview-zoom-btn"
            onClick={() => queueZoomTo(zoomRef.current / PREVIEW_BUTTON_ZOOM_FACTOR)}
            aria-label="Zoom out live layout preview"
            title="Zoom out"
            disabled={zoom <= MIN_PREVIEW_ZOOM + 0.001}
          >
            -
          </button>
          <button
            type="button"
            className="ls-btn ls-btn-secondary ls-place-layout-preview-zoom-btn"
            onClick={() => queueZoomTo(zoomRef.current * PREVIEW_BUTTON_ZOOM_FACTOR)}
            aria-label="Zoom in live layout preview"
            title="Zoom in"
            disabled={zoom >= MAX_PREVIEW_ZOOM - 0.001}
          >
            +
          </button>
      </div>
      ) : null}
      <div
        ref={viewportRef}
        data-place-layout-preview={previewInstanceId}
        className={viewportClass}
        onPointerDownCapture={allowViewportInteraction && (isFullscreen || inlinePanEnabled) ? handleViewportPointerDownCapture : undefined}
        onPointerMove={allowViewportInteraction && (isFullscreen || inlinePanEnabled) ? handleViewportPointerMove : undefined}
        onPointerUp={allowViewportInteraction && (isFullscreen || inlinePanEnabled) ? handleViewportPointerUp : undefined}
        onPointerCancel={allowViewportInteraction && (isFullscreen || inlinePanEnabled) ? handleViewportPointerUp : undefined}
        onLostPointerCapture={allowViewportInteraction && (isFullscreen || inlinePanEnabled) ? () => endDragPan() : undefined}
        onClickCapture={allowViewportInteraction && (isFullscreen || inlinePanEnabled) ? handleViewportClickCapture : undefined}
        title={
          allowViewportInteraction
            ? isFullscreen
              ? "Scroll to zoom and drag to pan the live layout preview."
              : "Use scroll or +/- to zoom and drag to pan the live layout preview."
            : undefined
        }
      >
        <div
          className={stageClass}
          style={
            isFullscreen
              ? {
                  width: `${stageWidthPx}px`,
                  height: `${stageHeightPx}px`,
                }
              : undefined
          }
        >
          <svg
            className={svgClass}
            viewBox={viewBoxStr}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Live layout preview with slab mapping"
            style={svgStyle}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#121418" />
                <stop offset="100%" stopColor="#0a0b0d" />
              </linearGradient>
              {pieces.map((piece) => {
                const placement = placementByPiece.get(piece.id);
                const slab =
                  placement?.slabId != null ? slabById.get(placement.slabId) : undefined;
                const slabTex =
                  placement && slab
                    ? resolveSlabTex(workspaceKind, piece, placement, slab, effectivePpi!, pieces)
                    : null;
                if (!slabTex) return null;
                return (
                  <clipPath key={`c-${piece.id}`} id={clipId(piece.id)} clipPathUnits="userSpaceOnUse">
                    <path
                      d={piecePathD(piece, workspaceKind, pieces)}
                      fill="#fff"
                      stroke="#fff"
                      strokeWidth={LIVE_PREVIEW_CLIP_OVERDRAW_PX}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </clipPath>
                );
              })}
            </defs>
            <rect
              x={workspaceKind === "blank" ? blankVb.minX : sourceVb.minX}
              y={workspaceKind === "blank" ? blankVb.minY : sourceVb.minY}
              width={workspaceKind === "blank" ? blankVb.width : sourceVb.width}
              height={workspaceKind === "blank" ? blankVb.height : sourceVb.height}
              fill={`url(#${gradId})`}
            />
            {pieces.map((piece) => {
              const sel =
                selectedPieceIds != null && selectedPieceIds.length > 0
                  ? selectedPieceIds.includes(piece.id)
                  : piece.id === selectedPieceId;
              const placement = placementByPiece.get(piece.id);
              const slab =
                placement?.slabId != null ? slabById.get(placement.slabId) : undefined;
              const isStrip = isPlanStripPiece(piece);
              const slabTex =
                placement && slab
                  ? resolveSlabTex(workspaceKind, piece, placement, slab, effectivePpi!, pieces)
                  : null;

          const d = piecePathD(piece, workspaceKind, pieces);
          const ringOpen = normalizeClosedRing(planDisplayPoints(piece, pieces));

          const placedMapped = !!slabTex;

          /** When slab texture is clipped in, avoid opaque fill — but keep a transparent fill when clickable so the hit target exists (`fill="none"` does not receive pointer events). */
          const fill = placedMapped
            ? pieceActivate
              ? "transparent"
              : "none"
            : PLAN_PIECE_NO_TEXTURE_FILL;

          const MITER_PLAN_STROKE = "#0d47a1";
          const edgeStroke = (ei: number) =>
            placedMapped
              ? "transparent"
              : piece.edgeTags?.miterEdgeIndices?.includes(ei)
                ? MITER_PLAN_STROKE
                : "rgba(190, 205, 220, 0.22)";
          const edgeStrokeW = (ei: number) =>
            placedMapped
              ? 0
              : piece.edgeTags?.miterEdgeIndices?.includes(ei)
                ? 0.025
                : 0.02;

          const xs = ringOpen.map((q) => q.x);
          const ys = ringOpen.map((q) => q.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const bw = maxX - minX;
          const bh = maxY - minY;
          const bwIn = workspaceKind === "blank" ? bw : bw / Math.max(pixelsPerInch ?? 1, 1);
          const bhIn = workspaceKind === "blank" ? bh : bh / Math.max(pixelsPerInch ?? 1, 1);
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const longHoriz = bw >= bh;
          const labelRot = longHoriz ? 0 : 90;
          const shortSide = Math.min(bw, bh);
          /** Blank plan uses inch space (~1–3 in is readable). Trace/source uses image pixels — uncapped 2.8px is invisible when scaled. */
          const fontSize =
            workspaceKind === "blank"
              ? Math.min(2.8, Math.max(1.05, shortSide * 0.09))
              : Math.max(
                  18,
                  Math.min(shortSide * 0.12, Math.min(traceDims.w, traceDims.h) * 0.045)
                );
          const labelFontSize = sel ? fontSize * 1.28 : fontSize;
          const labelText = isStrip
            ? (stripLetterLabelById.get(piece.id) ?? "—")
            : (pieceLabelById.get(piece.id) ?? piece.name);
          const dimensionText = `${bwIn.toFixed(1)}" x ${bhIn.toFixed(1)}"`;

          const ringCen = centroid(ringOpen);
          const { ox: arcOx, oy: arcOy } = planWorldOffset(piece, pieces);

          const seamableEdges =
            seamMode && !isStrip && placement?.placed && placement.slabId
              ? ringOpen.flatMap((_, ei) => {
                  const geometry = seamGeometryFromAxisAlignedEdge(ringOpen, ei);
                  if (!geometry) return [];
                  const a = ringOpen[ei];
                  const b = ringOpen[(ei + 1) % ringOpen.length];
                  if (!a || !b) return [];
                  return [{ edgeIndex: ei, geometry, a, b }];
                })
              : [];

          return (
            <g key={piece.id}>
              {placedMapped ? (
                <path
                  d={d}
                  fill={LIVE_PREVIEW_PIECE_UNDERLAY_FILL}
                  stroke="none"
                  style={{ pointerEvents: "none" }}
                />
              ) : null}
              {slabTex ? (
                <g
                  clipPath={`url(#${clipId(piece.id)})`}
                  style={{ pointerEvents: "none" }}
                >
                  <image
                    href={slabTex.imageUrl}
                    xlinkHref={slabTex.imageUrl}
                    x={0}
                    y={0}
                    width={slabTex.widthIn}
                    height={slabTex.heightIn}
                    preserveAspectRatio="none"
                    transform={slabTex.matrixStr}
                    opacity={1}
                    className="ls-slab-layout-fill-image"
                  />
                </g>
              ) : null}
              <path
                d={d}
                fill={fill}
                stroke="none"
                style={
                  pieceActivate
                    ? { cursor: "pointer", pointerEvents: "auto" }
                    : { pointerEvents: "none" }
                }
                onClick={
                  pieceActivate
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        pieceActivate(piece.id);
                      }
                    : undefined
                }
              />
              {ringOpen.map((_, ei) => {
                const arcPts = sampleArcEdgePointsForStroke(
                  piece,
                  ei,
                  ringOpen,
                  ringCen,
                  28,
                  { x: arcOx, y: arcOy },
                );
                const segsOut: { a: LayoutPoint; b: LayoutPoint }[] = [];
                for (let k = 0; k < arcPts.length - 1; k++) {
                  segsOut.push(
                    ...clipEdgeStrokeSegmentsForKitchenSinks(
                      arcPts[k]!,
                      arcPts[k + 1]!,
                      piece,
                      pieces,
                      workspaceKind === "source"
                        ? piecePixelsPerInch(piece, coordPerInch) ?? coordPerInch
                        : coordPerInch,
                    ),
                  );
                }
                return segsOut.map((s, sj) => (
                  <line
                    key={`${piece.id}-pv-${ei}-${sj}`}
                    x1={s.a.x}
                    y1={s.a.y}
                    x2={s.b.x}
                    y2={s.b.y}
                    stroke={edgeStroke(ei)}
                    strokeWidth={edgeStrokeW(ei)}
                    strokeLinecap="round"
                    style={{ pointerEvents: "none" }}
                  />
                ));
              })}
              {seamableEdges.map((edge) => {
                const highlighted =
                  (hoverSeamEdge?.pieceId === piece.id && hoverSeamEdge.edgeIndex === edge.edgeIndex) ||
                  (seamModal?.pieceId === piece.id && seamModal.edgeIndex === edge.edgeIndex);
                return (
                  <g key={`${piece.id}-seam-${edge.edgeIndex}`}>
                    <line
                      x1={edge.a.x}
                      y1={edge.a.y}
                      x2={edge.b.x}
                      y2={edge.b.y}
                      stroke="transparent"
                      strokeWidth={Math.max(edgeStrokeW(edge.edgeIndex) * 8, 10)}
                      strokeLinecap="round"
                      style={{ cursor: "crosshair" }}
                      pointerEvents="stroke"
                      onPointerEnter={() => setHoverSeamEdge({ pieceId: piece.id, edgeIndex: edge.edgeIndex })}
                      onPointerMove={() => setHoverSeamEdge({ pieceId: piece.id, edgeIndex: edge.edgeIndex })}
                      onPointerLeave={() =>
                        setHoverSeamEdge((prev) =>
                          prev?.pieceId === piece.id && prev.edgeIndex === edge.edgeIndex ? null : prev
                        )
                      }
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setHoverSeamEdge({ pieceId: piece.id, edgeIndex: edge.edgeIndex });
                        const ppi = piecePixelsPerInch(piece, pixelsPerInch);
                        const traceInches =
                          workspaceKind === "source" && ppi != null && ppi > 0;
                        setSeamModal({
                          pieceId: piece.id,
                          edgeIndex: edge.edgeIndex,
                          geometry: edge.geometry,
                          valA: formatDimInches(
                            traceInches ? edge.geometry.dimA / ppi : edge.geometry.dimA
                          ),
                          valB: formatDimInches(
                            traceInches ? edge.geometry.dimB / ppi : edge.geometry.dimB
                          ),
                        });
                      }}
                    />
                    {highlighted ? (
                      <line
                        x1={edge.a.x}
                        y1={edge.a.y}
                        x2={edge.b.x}
                        y2={edge.b.y}
                        stroke="rgba(232, 64, 64, 0.98)"
                        strokeWidth={Math.max(edgeStrokeW(edge.edgeIndex) * 2.2, 2.2)}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                    ) : null}
                  </g>
                );
              })}
              {!isPlanStripPiece(piece) ? (
                <>
                  <PieceSinkCutoutsSvg
                    piece={piece}
                    allPieces={pieces}
                    coordPerInch={coordPerInch}
                    showLabels={showSinkLabels}
                    interactive={false}
                    appearance="cutout"
                  />
                  <PieceOutletCutoutsSvg
                    piece={piece}
                    allPieces={pieces}
                    coordPerInch={coordPerInch}
                    showLabels={showSinkLabels}
                    interactive={false}
                    appearance="cutout"
                  />
                </>
              ) : null}
              {showLabels ? (
                <text
                  transform={`translate(${cx},${cy}) rotate(${labelRot})`}
                  fill={sel ? "#d32f2f" : labelColor}
                  fontSize={labelFontSize}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`ls-place-preview-piece-label${sel ? " ls-place-preview-piece-label--selected" : ""}`}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  <tspan x="0" dy={showDimensions ? "-0.45em" : "0"}>{labelText}</tspan>
                  {showDimensions ? (
                    <tspan x="0" dy="1.15em" className="ls-place-preview-piece-dimension">
                      {dimensionText}
                    </tspan>
                  ) : null}
                </text>
              ) : null}
            </g>
          );
        })}
          </svg>
        </div>
      </div>
      {seamModal ? (
        <div
          className="ls-seam-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`ls-place-preview-seam-modal-title-${pid}`}
          onClick={() => setSeamModal(null)}
        >
          <div className="ls-seam-modal glass-panel" onClick={(e) => e.stopPropagation()}>
            <h2 id={`ls-place-preview-seam-modal-title-${pid}`} className="ls-seam-modal-title">
              Place seam
            </h2>
            <p className="ls-seam-modal-sub">
              The seam stays perpendicular to the selected plan edge. Edit one side and the other updates so both
              dimensions add up to that edge length.
            </p>
            <div className="ls-seam-modal-fields">
              <label className="ls-seam-modal-field">
                {seamModal.geometry.labelA} (in)
                <input
                  className="ls-input"
                  type="number"
                  min={0.125}
                  step={0.125}
                  value={seamModal.valA}
                  onChange={(e) => {
                    const v = e.target.value;
                    const g = seamModal.geometry;
                    const totalPx =
                      g.kind === "vertical" ? g.xMax - g.xMin : g.yMax - g.yMin;
                    const modalPiece = pieces.find((p) => p.id === seamModal.pieceId);
                    const ppi = modalPiece ? piecePixelsPerInch(modalPiece, pixelsPerInch) : null;
                    const total =
                      workspaceKind === "source" && ppi != null && ppi > 0
                        ? totalPx / ppi
                        : totalPx;
                    const n = parseFloat(v);
                    setSeamModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            valA: v,
                            valB: Number.isFinite(n) ? formatDimInches(total - n) : prev.valB,
                            error: undefined,
                          }
                        : prev
                    );
                  }}
                />
              </label>
              <label className="ls-seam-modal-field">
                {seamModal.geometry.labelB} (in)
                <input
                  className="ls-input"
                  type="number"
                  min={0.125}
                  step={0.125}
                  value={seamModal.valB}
                  onChange={(e) => {
                    const v = e.target.value;
                    const g = seamModal.geometry;
                    const totalPx =
                      g.kind === "vertical" ? g.xMax - g.xMin : g.yMax - g.yMin;
                    const modalPiece = pieces.find((p) => p.id === seamModal.pieceId);
                    const ppi = modalPiece ? piecePixelsPerInch(modalPiece, pixelsPerInch) : null;
                    const total =
                      workspaceKind === "source" && ppi != null && ppi > 0
                        ? totalPx / ppi
                        : totalPx;
                    const n = parseFloat(v);
                    setSeamModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            valB: v,
                            valA: Number.isFinite(n) ? formatDimInches(total - n) : prev.valA,
                            error: undefined,
                          }
                        : prev
                    );
                  }}
                />
              </label>
            </div>
            {seamModal.error ? <p className="ls-seam-modal-inline-error">{seamModal.error}</p> : null}
            <div className="ls-seam-modal-actions">
              <button type="button" className="ls-btn ls-btn-ghost" onClick={() => setSeamModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="ls-btn ls-btn-primary"
                onClick={() => {
                  const dimA = parseFloat(seamModal.valA);
                  const dimB = parseFloat(seamModal.valB);
                  if (!Number.isFinite(dimA) || !Number.isFinite(dimB) || dimA <= 0 || dimB <= 0) {
                    setSeamModal((prev) => (prev ? { ...prev, error: "Enter valid seam dimensions greater than 0." } : prev));
                    return;
                  }
                  const ok = onPlaceSeamRequest?.({
                    pieceId: seamModal.pieceId,
                    edgeIndex: seamModal.edgeIndex,
                    dimA,
                    dimB,
                    seamDimUnits: workspaceKind === "source" ? "inches" : "plan",
                  });
                  if (!ok) {
                    setSeamModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            error: "Could not place a seam on that edge. Make sure it is a straight edge with valid dimensions.",
                          }
                        : prev
                    );
                    return;
                  }
                  setHoverSeamEdge(null);
                  setSeamModal(null);
                }}
              >
                Place seam
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
