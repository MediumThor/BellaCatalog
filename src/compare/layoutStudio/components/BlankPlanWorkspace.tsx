import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  LayoutPiece,
  LayoutPoint,
  LayoutSlab,
  PiecePlacement,
  SnapAlignmentMode,
  TraceTool,
} from "../types";
import {
  planDisplayPoints,
  planWorldOffset,
  distancePointToSegment,
  tryRemoveDraftPolylinePoint,
} from "../utils/blankPlanGeometry";
import {
  tryResizeRectangleEdgeLength,
  tryResizeLShapeManualEdgeLength,
  tryResizeOrthogonalStraightEdgeLength,
  isAxisAlignedRectangle,
  isAxisAlignedLShapeRing,
  isOrthogonalPolygonRing,
} from "../utils/blankPlanEdgeResize";
import {
  applyManualDimensionsToPiece,
  lShapePointsInches,
} from "../utils/manualPieces";
import {
  collectOrthoSnapTargets,
  isFinishableOrthoDraftRing,
  nearPoint,
  orthoSnapFirstPoint,
  orthoSnapPreview,
  simplifyOrthoRing,
  type OrthoSnapGuide,
} from "../utils/blankPlanOrthoDraw";
import {
  applyCornerChamfer,
  applyCornerFillet,
  vertexIndexFromAdjacentEdges,
} from "../utils/blankPlanCornerFillet";
import {
  findFlushSnapEdgePair,
  horizontalSeamPreviewChord,
  mergeRingsSharingReversedEdge,
  seamGeometryFromAxisAlignedEdge,
  splitWorldRingAtHorizontalSeam,
  splitWorldRingAtVerticalSeam,
  verticalSeamPreviewChord,
  type SeamFromEdgeGeometry,
} from "../utils/blankPlanPolygonOps";
import {
  movingPieceOverlapsOthers,
  anyPiecesOverlap,
  countertopOverlapsOtherCountertops,
  piecePointsOverlapOthers,
} from "../utils/blankPlanOverlap";
import {
  refineSnapPlanTransform,
  segmentsParallel,
  snapAlignmentFromNearestAnchorHandle,
  snapTranslationForLines,
  weldPlanTransformToFlushEdge,
  worldEdgeSegment,
} from "../utils/blankPlanSnap";
import {
  defaultNonSplashPieceName,
  edgeStripLetterLabelByPieceId,
  pieceLabelByPieceId,
} from "../utils/pieceLabels";
import { isPlanStripPiece } from "../utils/pieceRoles";
import {
  applyArcSagittaToEdge,
  arcBulgeArrowParams,
  clearArcOnEdge,
  clearArcRadiiAdjacentToVertex,
  clearArcsAtOrthogonalCorner,
  distancePointToArcEdge,
  distancePointToCircleArcEdge,
  edgeLengthsWithArcsInches,
  getEffectiveEdgeArcCirclesIn,
  getEffectiveEdgeArcSagittasIn,
  mergeEdgeArcCircleAfterCornerFillet,
  mergeEdgeArcSagittaAfterCornerFillet,
  pathDClosedRingWithArcs,
  removeCornerFilletAtFilletEdge,
  collectFilletEdgesInAxisAlignedRect,
  pieceHasArcEdges,
  sampleArcEdgePointsForStroke,
  svgCircularArcFragmentFromCircleCenter,
  svgCircularArcFragmentFromSagitta,
} from "../utils/blankPlanEdgeArc";
import {
  boundsOfPoints,
  centroid,
  ensureClosedRing,
  isValidPolygon,
  normalizeClosedRing,
  pointInPolygon,
} from "../utils/geometry";
import {
  slabTextureRenderParams,
  shouldFillPieceWithSlabTexture,
} from "../utils/slabLayoutTexture";
import {
  assignSinksToSplitPieces,
  clampSinkCenter,
  clipEdgeStrokeSegmentsForKitchenSinks,
  hitTestSinkAtWorld,
  mergeSinksForJoin,
} from "../utils/pieceSinks";
import { PieceSinkCutoutsSvg } from "./PieceSinkCutoutsSvg";
import {
  IconZoomFitSelection,
  IconZoomIn,
  IconZoomMarquee,
  IconZoomOut,
  IconZoomResetView,
} from "./PlanToolbarIcons";
/** Fixed drafting area in plan inches; view zoom/pan does not depend on piece positions. */
export const BLANK_PLAN_WORLD_W_IN = 480;
export const BLANK_PLAN_WORLD_H_IN = 240;
export const BLANK_VIEW_ZOOM_MIN = 0.5;
export const BLANK_VIEW_ZOOM_MAX = 5;
const VIEW_ZOOM_STEP = 0.25;

/** Plan zoom readout: raw scale % is halved (5× max → “250%”). */
export function blankPlanZoomDisplayPct(viewZoom: number): number {
  return Math.round(viewZoom * 50);
}
/** Blank plan coordinates are inches; sink templates use the same units. */
const BLANK_COORD_PER_INCH = 1;

/** Triangle path with tip at (tipX,tipY), stem length along (dirX,dirY) inward from tip. */
function bulgeArrowTriangleD(
  tipX: number,
  tipY: number,
  dirX: number,
  dirY: number,
  stemLen: number,
  headHalfW: number,
): string {
  const bx = tipX - dirX * stemLen;
  const by = tipY - dirY * stemLen;
  const px = -dirY;
  const py = dirX;
  const x1 = bx + px * headHalfW;
  const y1 = by + py * headHalfW;
  const x2 = bx - px * headHalfW;
  const y2 = by - py * headHalfW;
  return `M ${tipX} ${tipY} L ${x1} ${y1} L ${x2} ${y2} Z`;
}

function formatDimInches(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000);
}

function snapPlanPointToNearestInch(p: LayoutPoint): LayoutPoint {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function collectPlanCornerSnapTargets(pieces: readonly LayoutPiece[]): LayoutPoint[] {
  const out: LayoutPoint[] = [];
  for (const piece of pieces) {
    if (isPlanStripPiece(piece)) continue;
    const ring = normalizeClosedRing(planDisplayPoints(piece, pieces));
    for (const point of ring) {
      out.push({ x: point.x, y: point.y });
    }
  }
  return out;
}

function snapPlanPointToCornerOrNearestInch(
  p: LayoutPoint,
  pieces: readonly LayoutPiece[],
  cornerSnapRadius: number,
): LayoutPoint {
  let best: LayoutPoint | null = null;
  let bestDistance = cornerSnapRadius;
  for (const target of collectPlanCornerSnapTargets(pieces)) {
    const d = Math.hypot(target.x - p.x, target.y - p.y);
    if (d <= bestDistance) {
      bestDistance = d;
      best = target;
    }
  }
  return best ? { x: best.x, y: best.y } : snapPlanPointToNearestInch(p);
}

function segmentMidpoint(a: LayoutPoint, b: LayoutPoint): LayoutPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function segmentLength(a: LayoutPoint, b: LayoutPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function formatDraftSegmentLength(lengthIn: number): string {
  return `${Math.max(1, Math.round(lengthIn))}"`;
}

function formatDraftRectDimension(lengthIn: number): string {
  return `${Math.max(0, Math.round(lengthIn))}"`;
}

function edgeSegmentHasArc(pc: LayoutPiece, edgeIndex: number): boolean {
  const s = getEffectiveEdgeArcSagittasIn(pc)[edgeIndex];
  const c = getEffectiveEdgeArcCirclesIn(pc)[edgeIndex];
  return (
    (s != null && Math.abs(s) > 1e-9) || (c != null && c.r > 1e-9)
  );
}

function pieceHasAnyArc(pc: LayoutPiece): boolean {
  const n = normalizeClosedRing(pc.points).length;
  for (let ei = 0; ei < n; ei++) {
    if (edgeSegmentHasArc(pc, ei)) return true;
  }
  return false;
}

/**
 * Straight segment, no arc on that edge: pure rectangles (no arcs anywhere), manual L-shapes,
 * or any orthogonal (Manhattan) polygon. Pieces with corner radii elsewhere can still edit
 * straight edges; applying a new length clears all radii on that piece (see UI disclaimers).
 */
function canEditEdgeSegmentLength(pc: LayoutPiece, edgeIndex: number): boolean {
  if (isPlanStripPiece(pc)) return false;
  if (edgeSegmentHasArc(pc, edgeIndex)) return false;
  const ring = normalizeClosedRing(pc.points);
  if (isAxisAlignedRectangle(ring) && !pieceHasAnyArc(pc)) return true;
  if (
    pc.manualDimensions?.kind === "lShape" &&
    isAxisAlignedLShapeRing(ring)
  ) {
    return true;
  }
  return isOrthogonalPolygonRing(ring);
}

type EdgeSel = { pieceId: string; edgeIndex: number };

type Props = {
  tool: TraceTool;
  pieces: LayoutPiece[];
  selectedPieceId: string | null;
  selectedEdge: EdgeSel | null;
  showLabels: boolean;
  sourcePageNumberByIndex?: Record<number, number>;
  /** Edge length labels on pieces (blank workspace). */
  showEdgeDimensions: boolean;
  snapAlignmentMode: SnapAlignmentMode;
  onSelectPiece: (id: string | null) => void;
  onSelectEdge: (sel: EdgeSel | null) => void;
  onPiecesChange: (pieces: LayoutPiece[]) => void;
  /** Live updates without a new undo step (used while dragging a piece). */
  onPiecesChangeLive?: (pieces: LayoutPiece[]) => void;
  /** Snapshot undo point once when a drag begins (piece body or vertex). */
  onPieceDragStart?: () => void;
  /** Called with the currently selected edge when the user chooses Splash or Miter. */
  onRequestSplashForEdge: (edge: EdgeSel, kind: "splash" | "miter") => void;
  /** Backsplash / miter strip only: mark the selected edge as the 3D hinge / counter contact. */
  onSetSplashBottomEdge?: (edge: EdgeSel) => void;
  /** Blank plan: add a sink aligned to the selected edge (Layout Studio). */
  onRequestAddSinkForEdge?: (edge: EdgeSel) => void;
  onToggleProfileEdge: (sel: EdgeSel) => void;
  /** When set with placements + PPI, pieces placed on slabs show slab image clipped to the polygon (layout ↔ place sync). */
  slabs?: LayoutSlab[];
  placements?: PiecePlacement[];
  pixelsPerInch?: number | null;
  /** Increment when returning to Plan so the canvas zooms to show every piece (blank plan only). */
  fitAllPiecesSignal?: number;
  /** When `toolbar`, zoom controls are expected in the parent toolbar (see ref + callbacks). */
  zoomUiPlacement?: "inline" | "toolbar";
  onViewZoomChange?: (zoom: number) => void;
  /** Fired when box-zoom mode (marquee zoom) is toggled — for toolbar pressed state. */
  onBoxZoomModeChange?: (active: boolean) => void;
  /** Blank plan: switch tool (e.g. Escape from corner radius modal / pick mode). */
  onTraceToolChange?: (t: TraceTool) => void;
  /** Multi-selected corner-radius fillets (select-tool drag box). */
  selectedFilletEdges?: EdgeSel[];
  onSelectFilletEdges?: (edges: EdgeSel[]) => void;
  /** When true, widen the blank plan viewport to match the actual stage aspect on wide screens. */
  fitViewportWidth?: boolean;
  minViewZoom?: number;
};

export type BlankPlanWorkspaceHandle = {
  zoomOut: () => void;
  zoomIn: () => void;
  fitAllPiecesInView: () => void;
  zoomToSelected: () => void;
  /** Toggle drag-to-zoom box mode (marquee zoom to region). */
  toggleBoxZoom: () => void;
  /** Clear any in-progress ortho draft without changing the active tool. */
  cancelOrthoDraw: () => void;
};

function nextPieceName(pieces: LayoutPiece[], offset = 0): string {
  const n = pieces.filter((p) => !isPlanStripPiece(p)).length;
  return defaultNonSplashPieceName(n + offset);
}

function ringCentroid(ring: LayoutPoint[]): LayoutPoint {
  const r = normalizeClosedRing(ring);
  let sx = 0;
  let sy = 0;
  for (const p of r) {
    sx += p.x;
    sy += p.y;
  }
  const n = r.length || 1;
  return { x: sx / n, y: sy / n };
}

function inwardNormalTowardCentroid(
  a: LayoutPoint,
  b: LayoutPoint,
  centroid: LayoutPoint,
): { nx: number; ny: number } {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const el = Math.hypot(ex, ey) || 1;
  let nx = -ey / el;
  let ny = ex / el;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const vx = centroid.x - mid.x;
  const vy = centroid.y - mid.y;
  if (nx * vx + ny * vy < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny };
}

/** Top-most countertop piece whose interior contains p (plan space). */
function pickCountertopPieceAtPoint(
  p: LayoutPoint,
  pieces: LayoutPiece[],
): LayoutPiece | null {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const pc = pieces[i]!;
    if (isPlanStripPiece(pc)) continue;
    if (pointInPolygon(p, planDisplayPoints(pc, pieces))) return pc;
  }
  return null;
}

/**
 * ~10 screen pixels in plan inches for edge hover/pick, capped so zoomed-out views
 * do not treat an entire counter run as “on an edge” (which blocked piece drag).
 */
function planEdgePickThresholdIn(planPerPx: number): number {
  return Math.min(Math.max(1.2, planPerPx * 10), 3.5);
}

function pickNearestPlanEdge(
  p: LayoutPoint,
  pieces: LayoutPiece[],
  planPerPx: number,
  includeSplash: boolean,
): { pieceId: string; edgeIndex: number; d: number } | null {
  const thresh = planEdgePickThresholdIn(planPerPx);
  let best: { pieceId: string; edgeIndex: number; d: number } | null = null;
  for (const pc of pieces) {
    if (!includeSplash && isPlanStripPiece(pc)) continue;
    const disp = planDisplayPoints(pc, pieces);
    const ring = normalizeClosedRing(disp);
    const n = ring.length;
    const cen = centroid(ring);
    const arcs = getEffectiveEdgeArcSagittasIn(pc);
    const circles = getEffectiveEdgeArcCirclesIn(pc);
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      const c = circles[i];
      const h = arcs[i];
      const effThresh =
        c != null && c.r > 1e-9
          ? Math.min(thresh * 2.35, 5.5)
          : thresh;
      const d =
        c != null && c.r > 1e-9
          ? distancePointToCircleArcEdge(p, a, b, c, cen, ring)
          : h != null && Math.abs(h) > 1e-9
            ? distancePointToArcEdge(p, a, b, h, cen)
            : distancePointToSegment(p, a, b);
      if (d < effThresh && (!best || d < best.d)) {
        best = { pieceId: pc.id, edgeIndex: i, d };
      }
    }
  }
  return best;
}

function edgeMidpoint(pts: LayoutPoint[], edgeIndex: number): LayoutPoint {
  const ring = normalizeClosedRing(pts);
  const n = ring.length;
  const a = ring[edgeIndex];
  const b = ring[(edgeIndex + 1) % n];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** True if p hits a vertex, edge, or piece body — used for Alt+drag pan (empty canvas only). */
function planPointHitsSelectableContent(
  p: LayoutPoint,
  pieces: LayoutPiece[],
  planPerPx: number,
): boolean {
  const thresh = planEdgePickThresholdIn(planPerPx);
  for (const pc of pieces) {
    const ring = normalizeClosedRing(pc.points);
    for (let vi = 0; vi < ring.length; vi++) {
      const q = {
        x: ring[vi].x + (pc.planTransform?.x ?? 0),
        y: ring[vi].y + (pc.planTransform?.y ?? 0),
      };
      if (Math.hypot(p.x - q.x, p.y - q.y) < 2) return true;
    }
  }
  for (const pc of pieces) {
    if (isPlanStripPiece(pc)) continue;
    const disp = planDisplayPoints(pc, pieces);
    const ring = normalizeClosedRing(disp);
    const n = ring.length;
    const cen = centroid(ring);
    const arcs = getEffectiveEdgeArcSagittasIn(pc);
    const circles = getEffectiveEdgeArcCirclesIn(pc);
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      const c = circles[i];
      const h = arcs[i];
      const effThresh =
        c != null && c.r > 1e-9
          ? Math.min(thresh * 2.35, 5.5)
          : thresh;
      const d =
        c != null && c.r > 1e-9
          ? distancePointToCircleArcEdge(p, a, b, c, cen, ring)
          : h != null && Math.abs(h) > 1e-9
            ? distancePointToArcEdge(p, a, b, h, cen)
            : distancePointToSegment(p, a, b);
      if (d < effThresh) return true;
    }
  }
  for (let i = pieces.length - 1; i >= 0; i--) {
    const pc = pieces[i];
    if (pointInPolygon(p, planDisplayPoints(pc, pieces))) return true;
  }
  return false;
}

export const BlankPlanWorkspace = forwardRef<BlankPlanWorkspaceHandle, Props>(
  function BlankPlanWorkspace(
    {
      tool,
      pieces,
      selectedPieceId,
      selectedEdge,
      showLabels,
      sourcePageNumberByIndex,
      showEdgeDimensions,
      snapAlignmentMode,
      onSelectPiece,
      onSelectEdge,
      onPiecesChange,
      onPiecesChangeLive,
      onPieceDragStart,
      onRequestSplashForEdge,
      onSetSplashBottomEdge,
      onRequestAddSinkForEdge,
      onToggleProfileEdge,
      slabs,
      placements,
      pixelsPerInch,
      fitAllPiecesSignal = 0,
      zoomUiPlacement = "inline",
      onViewZoomChange,
      onBoxZoomModeChange,
      onTraceToolChange,
      selectedFilletEdges = [],
      onSelectFilletEdges = () => {},
      fitViewportWidth = false,
      minViewZoom = BLANK_VIEW_ZOOM_MIN,
    },
    ref,
  ) {
    const piecesRef = useRef(pieces);
    piecesRef.current = pieces;
    const dimEditInputRef = useRef<HTMLInputElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const [dragRect, setDragRect] = useState<{
      a: LayoutPoint;
      b: LayoutPoint;
    } | null>(null);
    /** Toggle from zoom UI: next drag on the canvas zooms to the framed rectangle. */
    const [boxZoomMode, setBoxZoomMode] = useState(false);
    const [zoomBoxDrag, setZoomBoxDrag] = useState<{
      a: LayoutPoint;
      b: LayoutPoint;
    } | null>(null);
    const [polyDraft, setPolyDraft] = useState<LayoutPoint[] | null>(null);
    /** Last plan point under cursor while drawing a polygon (rubber-band segment). */
    const [polyCursor, setPolyCursor] = useState<LayoutPoint | null>(null);
    const [vertexDrag, setVertexDrag] = useState<{
      pieceId: string;
      index: number;
    } | null>(null);
    const [pieceDrag, setPieceDrag] = useState<{
      pieceId: string;
      start: LayoutPoint;
      ox: number;
      oy: number;
    } | null>(null);
    const [sinkDrag, setSinkDrag] = useState<{
      pieceId: string;
      sinkId: string;
      start: LayoutPoint;
      startCx: number;
      startCy: number;
    } | null>(null);
    const [orthoPoints, setOrthoPoints] = useState<LayoutPoint[] | null>(null);
    const [orthoCursor, setOrthoCursor] = useState<LayoutPoint | null>(null);
    const [snapAnchor, setSnapAnchor] = useState<EdgeSel | null>(null);
    /** After two parallel edges are chosen: wait for a handle click on the anchor edge (start / center / end). */
    const [snapPair, setSnapPair] = useState<{
      anchor: EdgeSel;
      moving: EdgeSel;
    } | null>(null);
    /** Join tool: first piece selected; second click picks the other piece to merge. */
    const [joinPiece1, setJoinPiece1] = useState<string | null>(null);
    /** Join tool: countertop piece under cursor (piece hover). */
    const [joinHoverPieceId, setJoinHoverPieceId] = useState<string | null>(
      null,
    );
    /** Edge-based seam: perpendicular to selected axis-aligned edge, two editable spans (in). */
    const [seamModal, setSeamModal] = useState<{
      pieceId: string;
      edgeIndex: number;
      geometry: SeamFromEdgeGeometry;
      valA: string;
      valB: string;
    } | null>(null);
    const [cornerRadiusModal, setCornerRadiusModal] = useState<{
      radiusStr: string;
      error?: string;
    } | null>(null);
    const [cornerRadiusConfig, setCornerRadiusConfig] = useState<{
      radiusIn: number;
    } | null>(null);
    const [cornerRadiusFirstEdge, setCornerRadiusFirstEdge] =
      useState<EdgeSel | null>(null);
    const [cornerChamferModal, setCornerChamferModal] = useState<{
      sizeStr: string;
      error?: string;
    } | null>(null);
    const [cornerChamferConfig, setCornerChamferConfig] = useState<{
      sizeIn: number;
    } | null>(null);
    const [cornerChamferFirstEdge, setCornerChamferFirstEdge] =
      useState<EdgeSel | null>(null);
    /** Connect tool: first edge picked; second adjacent edge removes arcs at ~90° corner. */
    const [connectFirstEdge, setConnectFirstEdge] =
      useState<EdgeSel | null>(null);
    /** Select tool: edge under cursor for hover highlight (bold red). */
    const [hoverEdge, setHoverEdge] = useState<EdgeSel | null>(null);
    /** Select tool: drag box to collect corner-radius fillets by circle center. */
    const [selectFilletMarquee, setSelectFilletMarquee] = useState<{
      a: LayoutPoint;
      b: LayoutPoint;
    } | null>(null);
    const selectFilletMarqueeRef = useRef(selectFilletMarquee);
    selectFilletMarqueeRef.current = selectFilletMarquee;
    const [dimEdit, setDimEdit] = useState<{
      pieceId: string;
      edgeIndex: number;
      left: number;
      top: number;
      value: string;
    } | null>(null);
    /** Edge → arc: perpendicular offset from chord midpoint to arc (inches). */
    const [edgeArcModal, setEdgeArcModal] = useState<{
      sagittaStr: string;
      error?: string;
    } | null>(null);
    const [popoverPos, setPopoverPos] = useState<{
      left: number;
      top: number;
    } | null>(null);
    const vertexDragStartRef = useRef<LayoutPiece | null>(null);
    const [viewportAspect, setViewportAspect] = useState(BLANK_PLAN_WORLD_W_IN / BLANK_PLAN_WORLD_H_IN);
    const [viewZoom, setViewZoom] = useState(1);
    const [viewCenter, setViewCenter] = useState(() => ({
      x: BLANK_PLAN_WORLD_W_IN / 2,
      y: BLANK_PLAN_WORLD_H_IN / 2,
    }));
    const [spaceDown, setSpaceDown] = useState(false);
    const spaceDownRef = useRef(false);
    const [canvasPan, setCanvasPan] = useState<{
      startClientX: number;
      startClientY: number;
      startCenterX: number;
      startCenterY: number;
      pointerId: number;
    } | null>(null);
    const canvasPanRef = useRef<typeof canvasPan>(null);
    canvasPanRef.current = canvasPan;
    const zoomBoxDragRef = useRef<typeof zoomBoxDrag>(null);
    zoomBoxDragRef.current = zoomBoxDrag;
    /** Sink drag: lock to plan X or Y after first movement (orthogonal motion only). */
    const sinkDragOrthoAxisRef = useRef<"x" | "y" | null>(null);
    const seenPieceIdsRef = useRef<Set<string> | null>(null);
    const prevTraceToolRef = useRef<TraceTool | null>(null);

    useEffect(() => {
      if (!dimEdit) return;
      const input = dimEditInputRef.current;
      if (!input) return;
      requestAnimationFrame(() => {
        input.focus();
        input.select();
        input.setSelectionRange(0, input.value.length);
      });
    }, [dimEdit?.pieceId, dimEdit?.edgeIndex, dimEdit?.left, dimEdit?.top]);

    useEffect(() => {
      const prev = prevTraceToolRef.current;
      prevTraceToolRef.current = tool;
      if (tool === "cornerRadius" && prev !== "cornerRadius") {
        setCornerRadiusModal({ radiusStr: "0.5", error: undefined });
        setCornerRadiusConfig(null);
        setCornerRadiusFirstEdge(null);
      }
      if (tool === "chamferCorner" && prev !== "chamferCorner") {
        setCornerChamferModal({ sizeStr: "1", error: undefined });
        setCornerChamferConfig(null);
        setCornerChamferFirstEdge(null);
      }
    }, [tool]);

    useLayoutEffect(() => {
      if (!fitViewportWidth) return;
      const stage = stageRef.current;
      if (!stage || typeof ResizeObserver === "undefined") return;
      const updateAspect = () => {
        const rect = stage.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        setViewportAspect(rect.width / rect.height);
      };
      updateAspect();
      const observer = new ResizeObserver(() => updateAspect());
      observer.observe(stage);
      return () => observer.disconnect();
    }, [fitViewportWidth]);

    const viewportWorldWidth = useMemo(
      () =>
        fitViewportWidth
          ? Math.max(BLANK_PLAN_WORLD_W_IN, BLANK_PLAN_WORLD_H_IN * viewportAspect)
          : BLANK_PLAN_WORLD_W_IN,
      [fitViewportWidth, viewportAspect],
    );

    useEffect(() => {
      if (!fitViewportWidth || pieces.length > 0 || Math.abs(viewZoom - 1) > 1e-9) return;
      setViewCenter({ x: viewportWorldWidth / 2, y: BLANK_PLAN_WORLD_H_IN / 2 });
    }, [fitViewportWidth, pieces.length, viewportWorldWidth, viewZoom]);

    const vb = useMemo(() => {
      const w = viewportWorldWidth / viewZoom;
      const h = BLANK_PLAN_WORLD_H_IN / viewZoom;
      return {
        minX: viewCenter.x - w / 2,
        minY: viewCenter.y - h / 2,
        width: w,
        height: h,
      };
    }, [viewZoom, viewCenter.x, viewCenter.y, viewportWorldWidth]);
    const vbRef = useRef(vb);
    vbRef.current = vb;
    const viewBoxStr = `${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`;

    const planUnitsPerScreenPx = useCallback(() => {
      const el = svgRef.current;
      if (!el) return 1;
      const w = el.getBoundingClientRect().width || 1;
      return vb.width / w;
    }, [vb.width]);

    const zoomOut = useCallback(() => {
      setViewZoom((z) =>
        Math.max(
          minViewZoom,
          Math.round((z - VIEW_ZOOM_STEP) * 100) / 100,
        ),
      );
    }, [minViewZoom]);
    const zoomIn = useCallback(() => {
      setViewZoom((z) =>
        Math.min(
          BLANK_VIEW_ZOOM_MAX,
          Math.round((z + VIEW_ZOOM_STEP) * 100) / 100,
        ),
      );
    }, []);
    const zoomReset = useCallback(() => {
      setViewZoom(1);
      setViewCenter({
        x: viewportWorldWidth / 2,
        y: BLANK_PLAN_WORLD_H_IN / 2,
      });
    }, [viewportWorldWidth]);

    const fitBoundsInView = useCallback(
      (
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        padIn = 16,
        zoomScale = 1,
      ) => {
        const bw = Math.max(maxX - minX + padIn * 2, 8);
        const bh = Math.max(maxY - minY + padIn * 2, 8);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const zoomForW = viewportWorldWidth / bw;
        const zoomForH = BLANK_PLAN_WORLD_H_IN / bh;
        let z = Math.min(zoomForW, zoomForH) * zoomScale;
        z = Math.min(BLANK_VIEW_ZOOM_MAX, Math.max(minViewZoom, z));
        setViewZoom(Math.round(z * 100) / 100);
        setViewCenter({ x: cx, y: cy });
      },
      [minViewZoom, viewportWorldWidth],
    );

    const fitPieceInView = useCallback(
      (piece: LayoutPiece) => {
        const pts = planDisplayPoints(piece, pieces);
        const b = boundsOfPoints(pts);
        if (!b) return;
        fitBoundsInView(b.minX, b.minY, b.maxX, b.maxY, 16);
      },
      [fitBoundsInView, pieces],
    );

    const fitAllPiecesInView = useCallback((): boolean => {
      if (pieces.length === 0) {
        zoomReset();
        return false;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const pc of pieces) {
        const b = boundsOfPoints(planDisplayPoints(pc, pieces));
        if (!b) continue;
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
      }
      if (!Number.isFinite(minX)) {
        zoomReset();
        return false;
      }
      fitBoundsInView(minX, minY, maxX, maxY, 16);
      return true;
    }, [pieces, fitBoundsInView, zoomReset]);

    const fitAllPiecesInViewRef = useRef(fitAllPiecesInView);
    fitAllPiecesInViewRef.current = fitAllPiecesInView;

    useEffect(() => {
      if (fitAllPiecesSignal <= 0) return;
      fitAllPiecesInViewRef.current();
    }, [fitAllPiecesSignal]);

    /**
     * On first paint after load/reload (or once pieces exist after starting empty), run the same
     * framing as Reset view so geometry isn’t stuck off-screen at the default world center.
     * useLayoutEffect runs before paint (no rAF — avoids Strict Mode canceling the frame).
     * Only clear the one-shot guard after a successful fitBoundsInView (not zoomReset fallback).
     */
    const shouldAutoFitAllRef = useRef(true);
    useLayoutEffect(() => {
      if (pieces.length === 0) {
        shouldAutoFitAllRef.current = true;
        return;
      }
      if (!shouldAutoFitAllRef.current) return;
      const ok = fitAllPiecesInView();
      if (ok) shouldAutoFitAllRef.current = false;
    }, [pieces, fitAllPiecesInView]);

    useImperativeHandle(
      ref,
      () => ({
        zoomOut,
        zoomIn,
        fitAllPiecesInView,
        zoomToSelected: () => {
          const id = selectedPieceId;
          const pc = id
            ? piecesRef.current.find((x) => x.id === id)
            : undefined;
          if (pc) fitPieceInView(pc);
        },
        toggleBoxZoom: () => {
          setBoxZoomMode((v) => !v);
          setZoomBoxDrag(null);
        },
        cancelOrthoDraw: () => {
          setOrthoPoints(null);
          setOrthoCursor(null);
        },
      }),
      [zoomOut, zoomIn, fitAllPiecesInView, fitPieceInView, selectedPieceId],
    );

    useEffect(() => {
      onViewZoomChange?.(viewZoom);
    }, [viewZoom, onViewZoomChange]);

    useEffect(() => {
      onBoxZoomModeChange?.(boxZoomMode);
    }, [boxZoomMode, onBoxZoomModeChange]);

    useEffect(() => {
      const ids = new Set(pieces.map((x) => x.id));
      if (seenPieceIdsRef.current === null) {
        seenPieceIdsRef.current = ids;
        return;
      }
      const prev = seenPieceIdsRef.current;
      const added = [...ids].filter((id) => !prev.has(id));
      seenPieceIdsRef.current = ids;
      if (added.length === 1) {
        const piece = pieces.find((x) => x.id === added[0]);
        if (piece) fitPieceInView(piece);
      }
    }, [pieces, fitPieceInView]);

    useEffect(() => {
      const typing = (t: EventTarget | null) =>
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable);

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== "Space" || e.repeat) return;
        if (typing(e.target)) return;
        e.preventDefault();
        spaceDownRef.current = true;
        setSpaceDown(true);
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code !== "Space") return;
        spaceDownRef.current = false;
        setSpaceDown(false);
      };
      const onBlur = () => {
        spaceDownRef.current = false;
        setSpaceDown(false);
      };
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("keyup", onKeyUp, true);
      window.addEventListener("blur", onBlur);
      return () => {
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("keyup", onKeyUp, true);
        window.removeEventListener("blur", onBlur);
      };
    }, []);

    useEffect(() => {
      if (tool !== "snapLines") {
        setSnapAnchor(null);
        setSnapPair(null);
      }
      if (tool !== "join") {
        setJoinPiece1(null);
        setJoinHoverPieceId(null);
      }
      if (tool !== "cornerRadius") {
        setCornerRadiusModal(null);
        setCornerRadiusConfig(null);
        setCornerRadiusFirstEdge(null);
      }
      if (tool !== "chamferCorner") {
        setCornerChamferModal(null);
        setCornerChamferConfig(null);
        setCornerChamferFirstEdge(null);
      }
      if (tool !== "connectCorner") {
        setConnectFirstEdge(null);
      }
      if (tool !== "orthoDraw") {
        setOrthoPoints(null);
        setOrthoCursor(null);
      }
      if (tool !== "polygon") {
        setPolyDraft(null);
        setPolyCursor(null);
      }
    }, [tool]);

    useEffect(() => {
      if (!canvasPan) return;
      const pan = canvasPan;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pan.pointerId) return;
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const rw = rect.width || 1;
        const rh = rect.height || 1;
        const vbNow = vbRef.current;
        const dxPx = ev.clientX - pan.startClientX;
        const dyPx = ev.clientY - pan.startClientY;
        const dxPlan = (dxPx * vbNow.width) / rw;
        const dyPlan = (dyPx * vbNow.height) / rh;
        /** Subtract so the canvas moves with the pointer (grab-to-pan), not opposite. */
        setViewCenter({
          x: pan.startCenterX - dxPlan,
          y: pan.startCenterY - dyPlan,
        });
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pan.pointerId) return;
        setCanvasPan(null);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
    }, [canvasPan]);

    const clientToPlan = useCallback(
      (clientX: number, clientY: number): LayoutPoint | null => {
        const svg = svgRef.current;
        if (!svg) return null;
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        const p = pt.matrixTransform(ctm.inverse());
        return { x: p.x, y: p.y };
      },
      [],
    );

    const handleWheel = useCallback(
      (e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        const svg = svgRef.current;
        if (!svg) return;
        const focus = clientToPlan(e.clientX, e.clientY);
        if (!focus) return;
        const rect = svg.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const direction = e.deltaY < 0 ? 1 : -1;
        const nextZoom = Math.min(
          BLANK_VIEW_ZOOM_MAX,
          Math.max(
            BLANK_VIEW_ZOOM_MIN,
            Math.round((viewZoom + direction * VIEW_ZOOM_STEP) * 100) / 100,
          ),
        );
        if (Math.abs(nextZoom - viewZoom) < 1e-9) return;
        const nextWidth = viewportWorldWidth / nextZoom;
        const nextHeight = BLANK_PLAN_WORLD_H_IN / nextZoom;
        const focusRatioX = (e.clientX - rect.left) / rect.width;
        const focusRatioY = (e.clientY - rect.top) / rect.height;
        setViewCenter({
          x: focus.x - nextWidth * (focusRatioX - 0.5),
          y: focus.y - nextHeight * (focusRatioY - 0.5),
        });
        setViewZoom(nextZoom);
      },
      [clientToPlan, viewZoom, viewportWorldWidth],
    );

    const updatePopoverPosition = useCallback(() => {
      if (!selectedEdge || !svgRef.current) {
        setPopoverPos(null);
        return;
      }
      const pc = pieces.find((p) => p.id === selectedEdge.pieceId);
      if (!pc) {
        setPopoverPos(null);
        return;
      }
      const pts = planDisplayPoints(pc, pieces);
      const mid = edgeMidpoint(pts, selectedEdge.edgeIndex);
      const svg = svgRef.current;
      const pt = svg.createSVGPoint();
      pt.x = mid.x;
      pt.y = mid.y;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const sp = pt.matrixTransform(ctm);
      setPopoverPos({ left: sp.x, top: sp.y });
    }, [selectedEdge, pieces]);

    const openSeamModalFromEdge = useCallback(() => {
      if (!selectedEdge) return;
      const pc = pieces.find((p) => p.id === selectedEdge.pieceId);
      if (!pc) {
        return;
      }
      const world = planDisplayPoints(pc, pieces);
      const geom = seamGeometryFromAxisAlignedEdge(
        world,
        selectedEdge.edgeIndex,
      );
      if (!geom) {
        return;
      }
      setSeamModal({
        pieceId: pc.id,
        edgeIndex: selectedEdge.edgeIndex,
        geometry: geom,
        valA: formatDimInches(geom.dimA),
        valB: formatDimInches(geom.dimB),
      });
    }, [selectedEdge, pieces]);

    const applySeamModal = useCallback(() => {
      if (!seamModal) return;
      const targetPiece = piecesRef.current.find(
        (p) => p.id === seamModal.pieceId,
      );
      if (!targetPiece) {
        setSeamModal(null);
        return;
      }
      const g = seamModal.geometry;
      const da = Number(seamModal.valA);
      const db = Number(seamModal.valB);
      if (!Number.isFinite(da) || !Number.isFinite(db) || da <= 0 || db <= 0) {
        return;
      }
      const MIN = 0.125;
      const world = planDisplayPoints(targetPiece, piecesRef.current);
      const seamHint = edgeMidpoint(world, seamModal.edgeIndex);
      const commit = (ringA: LayoutPoint[], ringB: LayoutPoint[]) => {
        const ox = targetPiece.planTransform?.x ?? 0;
        const oy = targetPiece.planTransform?.y ?? 0;
        const localA = ringA.map((q) => ({ x: q.x - ox, y: q.y - oy }));
        const localB = ringB.map((q) => ({ x: q.x - ox, y: q.y - oy }));
        const idA = crypto.randomUUID();
        const idB = crypto.randomUUID();
        const cur = piecesRef.current;
        const existingSinks = targetPiece.sinks ?? [];
        const legacyCount =
          existingSinks.length > 0
            ? 0
            : Math.max(0, Math.floor(targetPiece.sinkCount || 0));
        const { sinksA, sinksB } =
          existingSinks.length > 0
            ? assignSinksToSplitPieces(existingSinks, ringA, ringB, ox, oy)
            : {
                sinksA: [] as typeof existingSinks,
                sinksB: [] as typeof existingSinks,
              };
        const splitLegacy = legacyCount > 0;
        const sA = splitLegacy ? Math.floor(legacyCount / 2) : 0;
        const sB = splitLegacy ? legacyCount - sA : 0;
        const splitNameA = isPlanStripPiece(targetPiece)
          ? `${targetPiece.name} A`
          : nextPieceName(cur);
        const splitNameB = isPlanStripPiece(targetPiece)
          ? `${targetPiece.name} B`
          : nextPieceName(cur, 1);
        const newA: LayoutPiece = {
          ...targetPiece,
          id: idA,
          name: splitNameA,
          points: localA,
          sinkCount: splitLegacy ? sA : 0,
          sinks: existingSinks.length > 0 ? sinksA : undefined,
          manualDimensions: undefined,
          shapeKind: "polygon",
          edgeTags: undefined,
        };
        const newB: LayoutPiece = {
          ...targetPiece,
          id: idB,
          name: splitNameB,
          points: localB,
          sinkCount: splitLegacy ? sB : 0,
          sinks: existingSinks.length > 0 ? sinksB : undefined,
          manualDimensions: undefined,
          shapeKind: "polygon",
          edgeTags: undefined,
        };
        const nextBase = cur
          .filter((x) => x.id !== targetPiece.id)
          .concat([newA, newB]);
        const next = targetPiece.splashMeta
          ? nextBase.map((piece) => {
              if (piece.id !== targetPiece.splashMeta!.parentPieceId) return piece;
              const restSplashEdges = (piece.edgeTags?.splashEdges ?? []).filter(
                (entry) => entry.splashPieceId !== targetPiece.id,
              );
              return {
                ...piece,
                edgeTags: {
                  ...piece.edgeTags,
                  splashEdges: [
                    ...restSplashEdges,
                    {
                      edgeIndex: targetPiece.splashMeta!.parentEdgeIndex,
                      splashPieceId: idA,
                      heightIn: targetPiece.splashMeta!.heightIn,
                    },
                    {
                      edgeIndex: targetPiece.splashMeta!.parentEdgeIndex,
                      splashPieceId: idB,
                      heightIn: targetPiece.splashMeta!.heightIn,
                    },
                  ],
                },
              };
            })
          : nextBase;
        /** Only countertop-vs-countertop; splash strips along edges false-positive vs counters. */
        if (
          countertopOverlapsOtherCountertops(next, idA, idB) ||
          countertopOverlapsOtherCountertops(next, idB, idA)
        ) {
          return;
        }
        onPieceDragStart?.();
        onPiecesChange(next);
        onSelectPiece(idA);
        onSelectEdge(null);
        setSeamModal(null);
      };

      if (g.kind === "vertical") {
        const W = g.xMax - g.xMin;
        if (Math.abs(da + db - W) > 0.08) {
          return;
        }
        if (da < MIN || db < MIN) {
          return;
        }
        const xSeam = g.xMin + da;
        const split = splitWorldRingAtVerticalSeam(world, xSeam, seamHint.y);
        if (!split) {
          return;
        }
        commit(split[0], split[1]);
        return;
      }

      const H = g.yMax - g.yMin;
      if (Math.abs(da + db - H) > 0.08) {
        return;
      }
      if (da < MIN || db < MIN) {
        return;
      }
      const ySeam = g.yMin + da;
      const split = splitWorldRingAtHorizontalSeam(world, ySeam, seamHint.x);
      if (!split) {
        return;
      }
      commit(split[0], split[1]);
    }, [
      seamModal,
      onPiecesChange,
      onPieceDragStart,
      onSelectPiece,
      onSelectEdge,
    ]);

    const seamPreviewLine = useMemo(() => {
      if (!seamModal) return null;
      const pc = pieces.find((p) => p.id === seamModal.pieceId);
      if (!pc) return null;
      const world = planDisplayPoints(pc, pieces);
      const ring = normalizeClosedRing(world);
      const n = ring.length;
      const ei = seamModal.edgeIndex % n;
      const ev0 = ring[ei]!;
      const ev1 = ring[(ei + 1) % n]!;
      const hintY = (ev0.y + ev1.y) / 2;
      const hintX = (ev0.x + ev1.x) / 2;
      const g = seamModal.geometry;
      const da = parseFloat(seamModal.valA);
      if (!Number.isFinite(da)) return null;
      if (g.kind === "vertical") {
        const x = g.xMin + da;
        const { y0, y1 } = verticalSeamPreviewChord(world, x, hintY);
        return { kind: "vertical" as const, x, y0, y1 };
      }
      const y = g.yMin + da;
      const { x0, x1 } = horizontalSeamPreviewChord(world, y, hintX);
      return { kind: "horizontal" as const, y, x0, x1 };
    }, [seamModal, pieces]);

    useEffect(() => {
      if (!seamModal) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setSeamModal(null);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [seamModal]);

    useEffect(() => {
      updatePopoverPosition();
    }, [updatePopoverPosition, vb]);

    useEffect(() => {
      const ro = () => updatePopoverPosition();
      window.addEventListener("resize", ro);
      return () => window.removeEventListener("resize", ro);
    }, [updatePopoverPosition]);

    const finishOrthoPolygon = useCallback(() => {
      setOrthoPoints((prev) => {
        if (!prev || prev.length < 3) return prev;
        const closed = normalizeClosedRing([...prev, prev[0]]);
        const ring = simplifyOrthoRing(closed);
        if (!isFinishableOrthoDraftRing(ring)) {
          return prev;
        }
        if (!isValidPolygon(ring)) {
          return prev;
        }
        const id = crypto.randomUUID();
        const cur = piecesRef.current;
        const newPiece: LayoutPiece = {
          id,
          name: nextPieceName(cur),
          points: ring,
          sinkCount: 0,
          shapeKind: "polygon",
          source: "manual",
          planTransform: { x: 0, y: 0 },
          pieceRole: "countertop",
        };
        if (anyPiecesOverlap([...cur, newPiece])) {
          return prev;
        }
        onPiecesChange([...cur, newPiece]);
        onSelectPiece(id);
        setOrthoCursor(null);
        return null;
      });
    }, [onPiecesChange, onSelectPiece]);

    const commitSnapAlignment = useCallback(
      (pair: { anchor: EdgeSel; moving: EdgeSel }, mode: SnapAlignmentMode) => {
        const anchorPc = piecesRef.current.find(
          (x) => x.id === pair.anchor.pieceId,
        );
        const movePc = piecesRef.current.find(
          (x) => x.id === pair.moving.pieceId,
        );
        if (!anchorPc || !movePc) {
          setSnapPair(null);
          return;
        }
        const allPc = piecesRef.current;
        const anchorSeg = worldEdgeSegment(
          anchorPc,
          pair.anchor.edgeIndex,
          allPc,
        );
        const movingSeg = worldEdgeSegment(
          movePc,
          pair.moving.edgeIndex,
          allPc,
        );
        if (!anchorSeg || !movingSeg) {
          setSnapPair(null);
          return;
        }
        const delta = snapTranslationForLines(anchorSeg, movingSeg, mode);
        if (!delta) {
          setSnapPair(null);
          return;
        }
        const ox = movePc.planTransform?.x ?? 0;
        const oy = movePc.planTransform?.y ?? 0;
        const proposedT = { x: ox + delta.dx, y: oy + delta.dy };
        const refinedT = refineSnapPlanTransform(
          anchorPc,
          pair.anchor.edgeIndex,
          movePc,
          pair.moving.edgeIndex,
          mode,
          proposedT,
          allPc,
        );
        const nextT = weldPlanTransformToFlushEdge(
          anchorPc,
          pair.anchor.edgeIndex,
          movePc,
          pair.moving.edgeIndex,
          refinedT,
          allPc,
        );
        if (movingPieceOverlapsOthers(piecesRef.current, movePc.id, nextT)) {
          setSnapPair(null);
          return;
        }
        onPieceDragStart?.();
        onPiecesChange(
          piecesRef.current.map((pc) =>
            pc.id === movePc.id ? { ...pc, planTransform: nextT } : pc,
          ),
        );
        setSnapPair(null);
        onSelectPiece(movePc.id);
        onSelectEdge({
          pieceId: pair.moving.pieceId,
          edgeIndex: pair.moving.edgeIndex,
        });
      },
      [onPiecesChange, onPieceDragStart, onSelectPiece, onSelectEdge],
    );

    const handlePointerDown = (e: React.PointerEvent) => {
      const tgt = e.target as Element | null;
      if (!tgt?.closest?.("[data-ls-dim-hit]")) {
        setDimEdit(null);
      }
      const p = clientToPlan(e.clientX, e.clientY);
      if (!p) return;

      if (e.button === 1) {
        e.preventDefault();
        setCanvasPan({
          startClientX: e.clientX,
          startClientY: e.clientY,
          startCenterX: viewCenter.x,
          startCenterY: viewCenter.y,
          pointerId: e.pointerId,
        });
        return;
      }

      if (boxZoomMode && e.button === 0) {
        e.preventDefault();
        setZoomBoxDrag({ a: p, b: p });
        try {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        return;
      }

      if (
        (tool === "select" ||
          tool === "orthoDraw" ||
          tool === "snapLines" ||
          tool === "join" ||
          tool === "cornerRadius" ||
          tool === "chamferCorner" ||
          tool === "connectCorner") &&
        e.button === 0
      ) {
        const ppu = planUnitsPerScreenPx();
        const altEmpty =
          e.altKey && !planPointHitsSelectableContent(p, pieces, ppu);
        if (spaceDownRef.current || altEmpty) {
          e.preventDefault();
          setCanvasPan({
            startClientX: e.clientX,
            startClientY: e.clientY,
            startCenterX: viewCenter.x,
            startCenterY: viewCenter.y,
            pointerId: e.pointerId,
          });
          return;
        }
      }

      if (tool === "orthoDraw" && e.button === 0) {
        e.preventDefault();
        const ppu = planUnitsPerScreenPx();
        const snapTh = Math.max(1.5, ppu * 12);
        const guideTh = Math.max(2.25, ppu * 18);
        const vertexHitR = Math.max(2.6, ppu * 18);
        /** Close the ring by clicking the start point — must run before vertex delete. */
        if (
          orthoPoints &&
          orthoPoints.length >= 3 &&
          nearPoint(orthoPoints[0], snapPlanPointToNearestInch(p), vertexHitR)
        ) {
          finishOrthoPolygon();
          return;
        }
        if (orthoPoints && orthoPoints.length >= 2) {
          const next = tryRemoveDraftPolylinePoint(
            p,
            orthoPoints,
            vertexHitR,
            Math.max(1.5, ppu * 14),
          );
          if (next != null) {
            if (next.length === 0) {
              setOrthoPoints(null);
              setOrthoCursor(null);
            } else {
              setOrthoPoints(next);
            }
            return;
          }
        }
        if (!orthoPoints || orthoPoints.length === 0) {
          const targets = collectOrthoSnapTargets(pieces, null, null);
          const first = snapPlanPointToNearestInch(
            orthoSnapFirstPoint(p, targets, snapTh, guideTh).preview,
          );
          setOrthoPoints([first]);
          return;
        }
        const last = orthoPoints[orthoPoints.length - 1];
        const targets = collectOrthoSnapTargets(pieces, orthoPoints, last);
        const snapped = snapPlanPointToNearestInch(
          orthoSnapPreview(last, p, targets, snapTh, guideTh).preview,
        );
        if (
          orthoPoints.length >= 3 &&
          (nearPoint(orthoPoints[0], snapped, snapTh) ||
            nearPoint(orthoPoints[0], p, snapTh))
        ) {
          finishOrthoPolygon();
          return;
        }
        if (nearPoint(last, snapped, 1e-6)) return;
        setOrthoPoints((prev) => (prev ? [...prev, snapped] : [snapped]));
        return;
      }

      if (tool === "snapLines" && e.button === 0) {
        e.preventDefault();
        const ppu = planUnitsPerScreenPx();

        if (snapPair) {
          const anchorPc = piecesRef.current.find(
            (x) => x.id === snapPair.anchor.pieceId,
          );
          const movePc = piecesRef.current.find(
            (x) => x.id === snapPair.moving.pieceId,
          );
          if (!anchorPc || !movePc) {
            setSnapPair(null);
            return;
          }
          const anchorSeg = worldEdgeSegment(
            anchorPc,
            snapPair.anchor.edgeIndex,
            piecesRef.current,
          );
          if (!anchorSeg) {
            setSnapPair(null);
            return;
          }
          const thresh = Math.max(2.0, ppu * 11);
          const mode = snapAlignmentFromNearestAnchorHandle(
            anchorSeg,
            p,
            thresh,
          );
          if (mode) {
            commitSnapAlignment(snapPair, mode);
            return;
          }
          return;
        }

        const hit = pickNearestPlanEdge(p, pieces, ppu, true);
        if (!hit) {
          return;
        }
        if (!snapAnchor) {
          setSnapAnchor({ pieceId: hit.pieceId, edgeIndex: hit.edgeIndex });
          onSelectPiece(hit.pieceId);
          onSelectEdge({ pieceId: hit.pieceId, edgeIndex: hit.edgeIndex });
          return;
        }
        if (
          hit.pieceId === snapAnchor.pieceId &&
          hit.edgeIndex === snapAnchor.edgeIndex
        ) {
          return;
        }
        const anchorPc = piecesRef.current.find(
          (x) => x.id === snapAnchor.pieceId,
        );
        const movePc = piecesRef.current.find((x) => x.id === hit.pieceId);
        if (!anchorPc || !movePc) {
          setSnapAnchor(null);
          return;
        }
        const anchorSeg = worldEdgeSegment(
          anchorPc,
          snapAnchor.edgeIndex,
          piecesRef.current,
        );
        const movingSeg = worldEdgeSegment(
          movePc,
          hit.edgeIndex,
          piecesRef.current,
        );
        if (!anchorSeg || !movingSeg) {
          setSnapAnchor(null);
          return;
        }
        if (!segmentsParallel(anchorSeg, movingSeg)) {
          setSnapAnchor(null);
          return;
        }
        setSnapPair({
          anchor: snapAnchor,
          moving: { pieceId: hit.pieceId, edgeIndex: hit.edgeIndex },
        });
        setSnapAnchor(null);
        onSelectPiece(movePc.id);
        onSelectEdge({ pieceId: hit.pieceId, edgeIndex: hit.edgeIndex });
        return;
      }

      if (tool === "cornerRadius" && e.button === 0) {
        e.preventDefault();
        if (!cornerRadiusConfig || cornerRadiusModal) return;
        const ppu = planUnitsPerScreenPx();
        const hit = pickNearestPlanEdge(p, piecesRef.current, ppu, false);
        if (!hit) {
          return;
        }
        const hitPc = piecesRef.current.find((x) => x.id === hit.pieceId);
        if (!hitPc || isPlanStripPiece(hitPc)) {
          return;
        }
        if (!cornerRadiusFirstEdge) {
          setCornerRadiusFirstEdge({
            pieceId: hit.pieceId,
            edgeIndex: hit.edgeIndex,
          });
          onSelectPiece(hit.pieceId);
          onSelectEdge({ pieceId: hit.pieceId, edgeIndex: hit.edgeIndex });
          return;
        }
        const e1 = cornerRadiusFirstEdge;
        if (hit.pieceId !== e1.pieceId) {
          setCornerRadiusFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        if (hit.edgeIndex === e1.edgeIndex) return;
        const ring = normalizeClosedRing(hitPc.points);
        const vn = vertexIndexFromAdjacentEdges(
          e1.edgeIndex,
          hit.edgeIndex,
          ring.length,
        );
        if (vn == null) {
          setCornerRadiusFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        const R = cornerRadiusConfig.radiusIn;
        const fillet = applyCornerFillet(ring, vn, R);
        if (!fillet.ok) {
          window.alert(fillet.reason);
          setCornerRadiusFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        const mergedArcs = mergeEdgeArcSagittaAfterCornerFillet(
          hitPc,
          vn,
          fillet.points,
          fillet.filletSagittaIn,
        );
        const mergedCircles = mergeEdgeArcCircleAfterCornerFillet(
          hitPc,
          vn,
          fillet.points,
          fillet.filletCircle,
        );
        const { edgeArcRadiiIn: _legacyR, ...hitBase } = hitPc;
        const updated: LayoutPiece = {
          ...hitBase,
          points: fillet.points,
          edgeArcSagittaIn: mergedArcs,
          edgeArcCircleIn: mergedCircles,
          shapeKind: "polygon",
          manualDimensions: undefined,
        };
        const next = piecesRef.current.map((p) =>
          p.id === hitPc.id ? updated : p,
        );
        if (anyPiecesOverlap(next)) {
          setCornerRadiusFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        onPieceDragStart?.();
        onPiecesChange(next);
        setCornerRadiusFirstEdge(null);
        onSelectPiece(hitPc.id);
        onSelectEdge(null);
        return;
      }

      if (tool === "chamferCorner" && e.button === 0) {
        e.preventDefault();
        if (!cornerChamferConfig || cornerChamferModal) return;
        const ppu = planUnitsPerScreenPx();
        const hit = pickNearestPlanEdge(p, piecesRef.current, ppu, false);
        if (!hit) {
          return;
        }
        const hitPc = piecesRef.current.find((x) => x.id === hit.pieceId);
        if (!hitPc || isPlanStripPiece(hitPc)) {
          return;
        }
        if (!cornerChamferFirstEdge) {
          setCornerChamferFirstEdge({
            pieceId: hit.pieceId,
            edgeIndex: hit.edgeIndex,
          });
          onSelectPiece(hit.pieceId);
          onSelectEdge({ pieceId: hit.pieceId, edgeIndex: hit.edgeIndex });
          return;
        }
        const e1 = cornerChamferFirstEdge;
        if (hit.pieceId !== e1.pieceId) {
          setCornerChamferFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        if (hit.edgeIndex === e1.edgeIndex) return;
        const ring = normalizeClosedRing(hitPc.points);
        const vn = vertexIndexFromAdjacentEdges(
          e1.edgeIndex,
          hit.edgeIndex,
          ring.length,
        );
        if (vn == null) {
          setCornerChamferFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        const chamfer = applyCornerChamfer(ring, vn, cornerChamferConfig.sizeIn);
        if (!chamfer.ok) {
          window.alert(chamfer.reason);
          setCornerChamferFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        const mergedArcs = mergeEdgeArcSagittaAfterCornerFillet(
          hitPc,
          vn,
          chamfer.points,
          null,
        );
        const mergedCircles = mergeEdgeArcCircleAfterCornerFillet(
          hitPc,
          vn,
          chamfer.points,
          null,
        );
        const { edgeArcRadiiIn: _legacyR, ...hitBase } = hitPc;
        const updated: LayoutPiece = {
          ...hitBase,
          points: chamfer.points,
          edgeArcSagittaIn: mergedArcs,
          edgeArcCircleIn: mergedCircles,
          shapeKind: "polygon",
          manualDimensions: undefined,
        };
        const next = piecesRef.current.map((piece) =>
          piece.id === hitPc.id ? updated : piece,
        );
        if (anyPiecesOverlap(next)) {
          setCornerChamferFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        onPieceDragStart?.();
        onPiecesChange(next);
        setCornerChamferFirstEdge(null);
        onSelectPiece(hitPc.id);
        onSelectEdge(null);
        return;
      }

      if (tool === "connectCorner" && e.button === 0) {
        e.preventDefault();
        const ppu = planUnitsPerScreenPx();
        const hit = pickNearestPlanEdge(p, piecesRef.current, ppu, false);
        if (!hit) {
          return;
        }
        const hitPc = piecesRef.current.find((x) => x.id === hit.pieceId);
        if (!hitPc || isPlanStripPiece(hitPc)) {
          return;
        }
        if (!connectFirstEdge) {
          setConnectFirstEdge({
            pieceId: hit.pieceId,
            edgeIndex: hit.edgeIndex,
          });
          onSelectPiece(hit.pieceId);
          onSelectEdge({ pieceId: hit.pieceId, edgeIndex: hit.edgeIndex });
          return;
        }
        const e1 = connectFirstEdge;
        if (hit.pieceId !== e1.pieceId) {
          setConnectFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        if (hit.edgeIndex === e1.edgeIndex) return;
        const result = clearArcsAtOrthogonalCorner(
          hitPc,
          e1.edgeIndex,
          hit.edgeIndex,
        );
        if (!result.ok) {
          window.alert(result.reason);
          setConnectFirstEdge(null);
          onSelectEdge(null);
          return;
        }
        const next = piecesRef.current.map((p) =>
          p.id === hitPc.id ? result.piece : p,
        );
        onPieceDragStart?.();
        onPiecesChange(next);
        setConnectFirstEdge(null);
        onSelectPiece(hitPc.id);
        onSelectEdge(null);
        return;
      }

      if (tool === "join" && e.button === 0) {
        e.preventDefault();
        const hitPc = pickCountertopPieceAtPoint(p, piecesRef.current);
        if (!hitPc) {
          setJoinPiece1(null);
          onSelectEdge(null);
          return;
        }
        if (!joinPiece1) {
          setJoinPiece1(hitPc.id);
          onSelectPiece(hitPc.id);
          onSelectEdge(null);
          return;
        }
        if (hitPc.id === joinPiece1) {
          return;
        }
        const anchorPc = piecesRef.current.find((x) => x.id === joinPiece1);
        const movePc = piecesRef.current.find((x) => x.id === hitPc.id);
        if (!anchorPc || !movePc) {
          setJoinPiece1(null);
          return;
        }
        const pair = findFlushSnapEdgePair(
          piecesRef.current,
          joinPiece1,
          hitPc.id,
        );
        if (!pair) {
          setJoinPiece1(null);
          return;
        }
        const worldA = planDisplayPoints(anchorPc, piecesRef.current);
        const worldB = planDisplayPoints(movePc, piecesRef.current);
        let mergedWorld = mergeRingsSharingReversedEdge(
          worldA,
          worldB,
          pair.edgeIndexA,
          pair.edgeIndexB,
        );
        if (!mergedWorld) {
          setJoinPiece1(null);
          return;
        }
        mergedWorld = simplifyOrthoRing(mergedWorld);
        const tOx = anchorPc.planTransform?.x ?? 0;
        const tOy = anchorPc.planTransform?.y ?? 0;
        const local = mergedWorld.map((q) => ({ x: q.x - tOx, y: q.y - tOy }));
        const anchorSinks = anchorPc.sinks ?? [];
        const moveSinks = movePc.sinks ?? [];
        const mergedSinks =
          anchorSinks.length > 0 || moveSinks.length > 0
            ? [
                ...anchorSinks,
                ...mergeSinksForJoin(anchorPc, movePc, moveSinks),
              ]
            : undefined;
        const legacySinks =
          (anchorPc.sinks?.length ?? 0) + (movePc.sinks?.length ?? 0) === 0
            ? anchorPc.sinkCount + movePc.sinkCount
            : 0;
        const mergedPiece: LayoutPiece = {
          ...anchorPc,
          points: local,
          shapeKind: "polygon",
          manualDimensions: undefined,
          sinkCount: mergedSinks ? 0 : legacySinks,
          sinks: mergedSinks,
          edgeTags: undefined,
          /** New ring edges do not correspond to anchor/move arc metadata — stale sagittas skew slab centroid. */
          edgeArcSagittaIn: undefined,
          edgeArcRadiiIn: undefined,
          edgeArcCircleIn: undefined,
        };
        const next = piecesRef.current
          .filter((pc) => pc.id !== movePc.id)
          .map((pc) => (pc.id === anchorPc.id ? mergedPiece : pc));
        if (anyPiecesOverlap(next)) {
          setJoinPiece1(null);
          return;
        }
        onPieceDragStart?.();
        onPiecesChange(next);
        setJoinPiece1(null);
        onSelectPiece(anchorPc.id);
        onSelectEdge(null);
        return;
      }

      if (tool === "polygon") {
        e.preventDefault();
        const ppu = planUnitsPerScreenPx();
        const vertexHitR = Math.max(2.6, ppu * 18);
        const snappedPoint = snapPlanPointToCornerOrNearestInch(
          p,
          piecesRef.current,
          Math.max(1.5, ppu * 12),
        );
        if (
          polyDraft &&
          polyDraft.length >= 3 &&
          nearPoint(polyDraft[0], snappedPoint, vertexHitR)
        ) {
          finishPolygon();
          return;
        }
        if (polyDraft && polyDraft.length >= 2) {
          const next = tryRemoveDraftPolylinePoint(
            p,
            polyDraft,
            vertexHitR,
            Math.max(1.5, ppu * 14),
          );
          if (next != null) {
            if (next.length === 0) {
              setPolyDraft(null);
            } else {
              setPolyDraft(next);
            }
            return;
          }
        }
        setPolyDraft((prev) => {
          if (!prev) return [snappedPoint];
          if (nearPoint(prev[prev.length - 1]!, snappedPoint, 1e-6)) return prev;
          return [...prev, snappedPoint];
        });
        return;
      }
      if (tool === "rect" || tool === "lShape") {
        const ppu = planUnitsPerScreenPx();
        const snapped = snapPlanPointToCornerOrNearestInch(
          p,
          piecesRef.current,
          Math.max(1.5, ppu * 12),
        );
        setDragRect({ a: snapped, b: snapped });
        return;
      }
      if (tool === "select") {
        /** Vertex handles first */
        for (const pc of pieces) {
          const ring = normalizeClosedRing(pc.points);
          for (let vi = 0; vi < ring.length; vi++) {
            const q = {
              x: ring[vi].x + (pc.planTransform?.x ?? 0),
              y: ring[vi].y + (pc.planTransform?.y ?? 0),
            };
            if (Math.hypot(p.x - q.x, p.y - q.y) < 2) {
              onPieceDragStart?.();
              setVertexDrag({ pieceId: pc.id, index: vi });
              onSelectPiece(pc.id);
              onSelectEdge(null);
              e.preventDefault();
              return;
            }
          }
        }
        /** Sink drag (selected piece only; vertices stay priority) */
        if (selectedPieceId) {
          const sp = pieces.find((x) => x.id === selectedPieceId);
          if (sp && sp.sinks?.length && !isPlanStripPiece(sp)) {
            const hit = hitTestSinkAtWorld(
              p,
              sp,
              pieces,
              BLANK_COORD_PER_INCH,
              2,
            );
            if (hit) {
              onPieceDragStart?.();
              sinkDragOrthoAxisRef.current = null;
              setSinkDrag({
                pieceId: sp.id,
                sinkId: hit.id,
                start: { ...p },
                startCx: hit.centerX,
                startCy: hit.centerY,
              });
              e.preventDefault();
              return;
            }
          }
        }
        /** Edge hit — arc-aware (corner radii), wider pick on fillet circle edges */
        const ppu = planUnitsPerScreenPx();
        const best = hoverEdge ?? pickNearestPlanEdge(p, pieces, ppu, true);
        if (best) {
          onSelectPiece(best.pieceId);
          onSelectEdge({ pieceId: best.pieceId, edgeIndex: best.edgeIndex });
          onSelectFilletEdges([]);
          return;
        }
        /** Piece body drag */
        for (let i = pieces.length - 1; i >= 0; i--) {
          const pc = pieces[i];
          const disp = planDisplayPoints(pc, pieces);
          if (pointInPolygon(p, disp)) {
            onSelectPiece(pc.id);
            onSelectEdge(null);
            onPieceDragStart?.();
            const ox = pc.planTransform?.x ?? 0;
            const oy = pc.planTransform?.y ?? 0;
            setPieceDrag({ pieceId: pc.id, start: { ...p }, ox, oy });
            return;
          }
        }
        setSelectFilletMarquee({ a: p, b: p });
        try {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        e.preventDefault();
      }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
      if (canvasPanRef.current) return;
      const p = clientToPlan(e.clientX, e.clientY);
      if (!p) return;
      if (selectFilletMarquee && tool === "select") {
        setSelectFilletMarquee((prev) => (prev ? { ...prev, b: p } : null));
        return;
      }
      if (zoomBoxDrag) {
        setZoomBoxDrag((prev) => (prev ? { ...prev, b: p } : null));
        return;
      }
      if (tool === "orthoDraw") {
        setOrthoCursor(p);
      }
      if (tool === "polygon" && polyDraft && polyDraft.length > 0) {
        setPolyCursor(p);
      } else {
        setPolyCursor(null);
      }
      if (dragRect && (tool === "rect" || tool === "lShape")) {
        setHoverEdge(null);
        setDragRect((prev) =>
          prev ? { ...prev, b: snapPlanPointToNearestInch(p) } : prev,
        );
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
        const pc = piecesRef.current.find((x) => x.id === sinkDrag.pieceId);
        if (!pc) return;
        const sink = pc.sinks?.find((s) => s.id === sinkDrag.sinkId);
        if (!sink) return;
        const nextCenter = clampSinkCenter(
          sink,
          pc,
          piecesRef.current,
          BLANK_COORD_PER_INCH,
          sinkDrag.startCx + dx,
          sinkDrag.startCy + dy,
        );
        const nextPieces = piecesRef.current.map((piece) =>
          piece.id === pc.id
            ? {
                ...piece,
                sinks: piece.sinks?.map((s) =>
                  s.id === sink.id
                    ? {
                        ...s,
                        centerX: nextCenter.centerX,
                        centerY: nextCenter.centerY,
                      }
                    : s,
                ),
              }
            : piece,
        );
        (onPiecesChangeLive ?? onPiecesChange)(nextPieces);
        setHoverEdge(null);
        return;
      }
      if (pieceDrag) {
        const dx = p.x - pieceDrag.start.x;
        const dy = p.y - pieceDrag.start.y;
        const pid = pieceDrag.pieceId;
        const ox = pieceDrag.ox + dx;
        const oy = pieceDrag.oy + dy;
        if (
          movingPieceOverlapsOthers(piecesRef.current, pid, { x: ox, y: oy })
        ) {
          setHoverEdge(null);
          return;
        }
        const next = piecesRef.current.map((pc) =>
          pc.id === pid ? { ...pc, planTransform: { x: ox, y: oy } } : pc,
        );
        (onPiecesChangeLive ?? onPiecesChange)(next);
        setHoverEdge(null);
        return;
      }
      if (
        tool === "select" &&
        !vertexDrag &&
        !dragRect &&
        !sinkDrag &&
        !selectFilletMarquee
      ) {
        for (const pc of pieces) {
          const ring = normalizeClosedRing(pc.points);
          for (let vi = 0; vi < ring.length; vi++) {
            const q = {
              x: ring[vi].x + (pc.planTransform?.x ?? 0),
              y: ring[vi].y + (pc.planTransform?.y ?? 0),
            };
            if (Math.hypot(p.x - q.x, p.y - q.y) < 2) {
              setHoverEdge(null);
              return;
            }
          }
        }
        const ppu = planUnitsPerScreenPx();
        const hit = pickNearestPlanEdge(p, pieces, ppu, true);
        setHoverEdge(
          hit ? { pieceId: hit.pieceId, edgeIndex: hit.edgeIndex } : null,
        );
      } else if (tool === "join" && !vertexDrag && !dragRect) {
        const ppu = planUnitsPerScreenPx();
        const hit = pickNearestPlanEdge(p, pieces, ppu, false);
        setHoverEdge(
          hit ? { pieceId: hit.pieceId, edgeIndex: hit.edgeIndex } : null,
        );
        let jp: string | null = null;
        for (let i = pieces.length - 1; i >= 0; i--) {
          const pc = pieces[i]!;
          if (isPlanStripPiece(pc)) continue;
          if (pointInPolygon(p, planDisplayPoints(pc, pieces))) {
            jp = pc.id;
            break;
          }
        }
        setJoinHoverPieceId(jp);
      } else if (tool === "cornerRadius" && !vertexDrag && !dragRect) {
        const ppu = planUnitsPerScreenPx();
        const hit = pickNearestPlanEdge(p, pieces, ppu, false);
        setHoverEdge(
          hit ? { pieceId: hit.pieceId, edgeIndex: hit.edgeIndex } : null,
        );
        setJoinHoverPieceId(null);
      } else if (tool === "chamferCorner" && !vertexDrag && !dragRect) {
        const ppu = planUnitsPerScreenPx();
        const hit = pickNearestPlanEdge(p, pieces, ppu, false);
        setHoverEdge(
          hit ? { pieceId: hit.pieceId, edgeIndex: hit.edgeIndex } : null,
        );
        setJoinHoverPieceId(null);
      } else if (tool === "connectCorner" && !vertexDrag && !dragRect) {
        const ppu = planUnitsPerScreenPx();
        const hit = pickNearestPlanEdge(p, pieces, ppu, false);
        setHoverEdge(
          hit ? { pieceId: hit.pieceId, edgeIndex: hit.edgeIndex } : null,
        );
        setJoinHoverPieceId(null);
      } else if (tool === "snapLines" && !vertexDrag && !dragRect) {
        const ppu = planUnitsPerScreenPx();
        const hit = pickNearestPlanEdge(p, pieces, ppu, true);
        setHoverEdge(
          hit ? { pieceId: hit.pieceId, edgeIndex: hit.edgeIndex } : null,
        );
      } else {
        setHoverEdge(null);
        setJoinHoverPieceId(null);
      }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
      if (canvasPanRef.current) return;
      const p = clientToPlan(e.clientX, e.clientY);
      const sfm = selectFilletMarqueeRef.current;
      if (sfm && tool === "select") {
        try {
          (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        const { a, b } = sfm;
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        setSelectFilletMarquee(null);
        if (p && w > 0.2 && h > 0.2) {
          const minX = Math.min(a.x, b.x);
          const minY = Math.min(a.y, b.y);
          const maxX = Math.max(a.x, b.x);
          const maxY = Math.max(a.y, b.y);
          const hits = collectFilletEdgesInAxisAlignedRect(
            piecesRef.current,
            minX,
            minY,
            maxX,
            maxY,
          );
          onSelectFilletEdges(hits);
          if (hits.length > 0) {
            onSelectEdge(null);
            onSelectPiece(null);
          }
        } else {
          onSelectFilletEdges([]);
          onSelectPiece(null);
          onSelectEdge(null);
        }
        return;
      }
      const zb = zoomBoxDragRef.current;
      if (zb) {
        try {
          (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        setZoomBoxDrag(null);
        setBoxZoomMode(false);
        if (p) {
          const { a, b } = zb;
          const w = Math.abs(b.x - a.x);
          const h = Math.abs(b.y - a.y);
          if (w > 0.35 && h > 0.35) {
            const minX = Math.min(a.x, b.x);
            const minY = Math.min(a.y, b.y);
            const maxX = Math.max(a.x, b.x);
            const maxY = Math.max(a.y, b.y);
            fitBoundsInView(minX, minY, maxX, maxY, 5, 1.22);
          } else {
          }
        }
        return;
      }
      if (dragRect && p && (tool === "rect" || tool === "lShape")) {
        const { a } = dragRect;
        const b = snapPlanPointToNearestInch(p);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        if (w > 0.25 && h > 0.25) {
          const minX = Math.min(a.x, b.x);
          const minY = Math.min(a.y, b.y);
          const id = crypto.randomUUID();
          const cur = piecesRef.current;
          const corners: LayoutPoint[] = [
            { x: minX, y: minY },
            { x: minX + w, y: minY },
            { x: minX + w, y: minY + h },
            { x: minX, y: minY + h },
          ];
          const newPiece: LayoutPiece =
            tool === "rect"
              ? {
                  id,
                  name: nextPieceName(cur),
                  points: corners,
                  sinkCount: 0,
                  shapeKind: "rectangle",
                  source: "manual",
                  manualDimensions: {
                    kind: "rectangle",
                    widthIn: w,
                    depthIn: h,
                  },
                  planTransform: { x: 0, y: 0 },
                  pieceRole: "countertop",
                }
              : (() => {
                  const dep = Math.max(0.5, Math.min(w, h) * 0.45);
                  const pts = lShapePointsInches(w, h, dep, 0).map((q) => ({
                    x: minX + q.x,
                    y: minY + q.y,
                  }));
                  return {
                    id,
                    name: nextPieceName(cur),
                    points: pts,
                    sinkCount: 0,
                    shapeKind: "lShape",
                    source: "manual",
                    manualDimensions: {
                      kind: "lShape",
                      legAIn: w,
                      legBIn: h,
                      depthIn: dep,
                      orientation: 0,
                    },
                    planTransform: { x: 0, y: 0 },
                    pieceRole: "countertop",
                  };
                })();
          if (anyPiecesOverlap([...cur, newPiece])) {
          } else {
            onPiecesChange([...cur, newPiece]);
            onSelectPiece(id);
          }
        }
      }
      setDragRect(null);
      setVertexDrag(null);
      setPieceDrag(null);
      setSinkDrag(null);
    };

    const finishPolygon = useCallback(() => {
      setPolyDraft((prev) => {
        if (!prev || prev.length < 3) return prev;
        const id = crypto.randomUUID();
        const cur = piecesRef.current;
        const newPiece: LayoutPiece = {
          id,
          name: nextPieceName(cur),
          points: prev,
          sinkCount: 0,
          shapeKind: "polygon",
          source: "manual",
          planTransform: { x: 0, y: 0 },
          pieceRole: "countertop",
        };
        if (anyPiecesOverlap([...cur, newPiece])) {
          return prev;
        }
        onPiecesChange([...cur, newPiece]);
        onSelectPiece(id);
        setPolyCursor(null);
        return null;
      });
    }, [onPiecesChange, onSelectPiece]);

    const applyDimensionLength = useCallback(
      (pieceId: string, edgeIndex: number, raw: number) => {
        if (!Number.isFinite(raw) || raw <= 0) return;
        const pc = piecesRef.current.find((p) => p.id === pieceId);
        if (!pc) return;
        const ring = normalizeClosedRing(pc.points);
        const ox = pc.planTransform?.x ?? 0;
        const oy = pc.planTransform?.y ?? 0;

        if (isAxisAlignedRectangle(ring) && !pieceHasAnyArc(pc)) {
          const nextPts = tryResizeRectangleEdgeLength(ring, edgeIndex, raw);
          if (!nextPts) {
            setDimEdit(null);
            return;
          }
          if (
            piecePointsOverlapOthers(piecesRef.current, pieceId, nextPts, {
              x: ox,
              y: oy,
            })
          ) {
            return;
          }
          const xs = nextPts.map((q) => q.x);
          const ys = nextPts.map((q) => q.y);
          const w = Math.max(...xs) - Math.min(...xs);
          const h = Math.max(...ys) - Math.min(...ys);
          onPieceDragStart?.();
          onPiecesChange(
            piecesRef.current.map((p) =>
              p.id === pieceId
                ? {
                    ...p,
                    points: nextPts,
                    manualDimensions:
                      p.shapeKind === "rectangle"
                        ? { kind: "rectangle", widthIn: w, depthIn: h }
                        : p.manualDimensions,
                  }
                : p,
            ),
          );
          setDimEdit(null);
          return;
        }

        if (
          pc.manualDimensions?.kind === "lShape" &&
          isAxisAlignedLShapeRing(ring)
        ) {
          const nextManual = tryResizeLShapeManualEdgeLength(
            pc.manualDimensions,
            ring,
            edgeIndex,
            raw,
          );
          if (!nextManual) {
            setDimEdit(null);
            return;
          }
          const updated = applyManualDimensionsToPiece(pc, nextManual);
          if (
            piecePointsOverlapOthers(piecesRef.current, pieceId, updated.points, {
              x: ox,
              y: oy,
            })
          ) {
            return;
          }
          onPieceDragStart?.();
          onPiecesChange(
            piecesRef.current.map((p) =>
              p.id === pieceId ? updated : p,
            ),
          );
          setDimEdit(null);
          return;
        }

        if (
          isOrthogonalPolygonRing(ring) &&
          !edgeSegmentHasArc(pc, edgeIndex)
        ) {
          const nextPts = tryResizeOrthogonalStraightEdgeLength(
            ring,
            edgeIndex,
            raw,
          );
          if (!nextPts) {
            setDimEdit(null);
            return;
          }
          if (
            piecePointsOverlapOthers(piecesRef.current, pieceId, nextPts, {
              x: ox,
              y: oy,
            })
          ) {
            return;
          }
          onPieceDragStart?.();
          onPiecesChange(
            piecesRef.current.map((p) =>
              p.id === pieceId
                ? {
                    ...p,
                    points: nextPts,
                    manualDimensions: undefined,
                    shapeKind: "polygon",
                    edgeArcSagittaIn: undefined,
                    edgeArcCircleIn: undefined,
                    edgeArcRadiiIn: undefined,
                  }
                : p,
            ),
          );
          setDimEdit(null);
          return;
        }

        setDimEdit(null);
      },
      [onPiecesChange, onPieceDragStart],
    );

    const openEdgeLengthEdit = useCallback(() => {
      if (!selectedEdge || !svgRef.current) return;
      const pc = pieces.find((p) => p.id === selectedEdge.pieceId);
      if (!pc || !canEditEdgeSegmentLength(pc, selectedEdge.edgeIndex)) return;
      const pts = planDisplayPoints(pc, pieces);
      const ringOpen = normalizeClosedRing(pts);
      const ei = selectedEdge.edgeIndex;
      const a = ringOpen[ei];
      const b = ringOpen[(ei + 1) % ringOpen.length];
      const lensArc = edgeLengthsWithArcsInches(pc);
      const len =
        lensArc[ei] ?? Math.hypot(b.x - a.x, b.y - a.y);
      const mid = edgeMidpoint(pts, ei);
      const svg = svgRef.current;
      const pt = svg.createSVGPoint();
      pt.x = mid.x;
      pt.y = mid.y;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const sp = pt.matrixTransform(ctm);
      const label = len >= 10 ? len.toFixed(1) : len.toFixed(2);
      setDimEdit({
        pieceId: selectedEdge.pieceId,
        edgeIndex: ei,
        left: sp.x,
        top: sp.y + 52,
        value: label,
      });
    }, [selectedEdge, pieces]);

    useEffect(() => {
      const onKey = (ev: KeyboardEvent) => {
        if (
          ev.key === "Enter" &&
          tool === "polygon" &&
          polyDraft &&
          polyDraft.length >= 3
        ) {
          finishPolygon();
        }
        if (
          ev.key === "Enter" &&
          tool === "orthoDraw" &&
          orthoPoints &&
          orthoPoints.length >= 3
        ) {
          finishOrthoPolygon();
        }
        if (ev.key === "Enter" && tool === "snapLines" && snapPair) {
          ev.preventDefault();
          commitSnapAlignment(snapPair, snapAlignmentMode);
        }
        if (ev.key === "Escape") {
          setPolyDraft(null);
          setPolyCursor(null);
          setDragRect(null);
          setOrthoPoints(null);
          setOrthoCursor(null);
          setSnapAnchor(null);
          setSnapPair(null);
          setJoinPiece1(null);
          setJoinHoverPieceId(null);
          setCornerRadiusModal(null);
          setCornerRadiusConfig(null);
          setCornerRadiusFirstEdge(null);
          setCornerChamferModal(null);
          setCornerChamferConfig(null);
          setCornerChamferFirstEdge(null);
          setConnectFirstEdge(null);
          setEdgeArcModal(null);
          setSelectFilletMarquee(null);
          onSelectFilletEdges([]);
          if (
            tool === "cornerRadius" ||
            tool === "chamferCorner" ||
            tool === "connectCorner"
          )
            onTraceToolChange?.("select");
          setBoxZoomMode(false);
          setZoomBoxDrag(null);
          setDimEdit(null);
          onSelectEdge(null);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [
      tool,
      polyDraft,
      orthoPoints,
      snapPair,
      snapAlignmentMode,
      commitSnapAlignment,
      finishPolygon,
      finishOrthoPolygon,
      onSelectEdge,
      onSelectFilletEdges,
      onTraceToolChange,
    ]);

    useEffect(() => {
      if (tool !== "select") {
        setSelectFilletMarquee(null);
      }
    }, [tool]);

    useEffect(() => {
      if (!vertexDrag) return;
      const pieceId = vertexDrag.pieceId;
      const startSnap = piecesRef.current.find((pc) => pc.id === pieceId);
      vertexDragStartRef.current = startSnap
        ? structuredClone(startSnap)
        : null;
      const move = (ev: PointerEvent) => {
        const pt = clientToPlan(ev.clientX, ev.clientY);
        if (!pt) return;
        const apply = onPiecesChangeLive ?? onPiecesChange;
        apply(
          piecesRef.current.map((pc) => {
            if (pc.id !== pieceId) return pc;
            const pts = normalizeClosedRing(pc.points);
            const copy = pts.slice();
            if (vertexDrag.index >= 0 && vertexDrag.index < copy.length) {
              const ox = pc.planTransform?.x ?? 0;
              const oy = pc.planTransform?.y ?? 0;
              copy[vertexDrag.index] = { x: pt.x - ox, y: pt.y - oy };
            }
            let updated: LayoutPiece = {
              ...pc,
              points: copy,
              manualDimensions: undefined,
            };
            updated = clearArcRadiiAdjacentToVertex(updated, vertexDrag.index);
            return updated;
          }),
        );
      };
      const up = () => {
        setVertexDrag(null);
        const snap = vertexDragStartRef.current;
        if (snap && anyPiecesOverlap(piecesRef.current)) {
          const apply = onPiecesChange ?? onPiecesChangeLive;
          apply(piecesRef.current.map((pc) => (pc.id === pieceId ? snap : pc)));
        }
        vertexDragStartRef.current = null;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
    }, [vertexDrag, clientToPlan, onPiecesChange, onPiecesChangeLive]);

    const gridLines = useMemo(() => {
      const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const step = 12;
      const gx0 = Math.floor(vb.minX / step) * step;
      const gy0 = Math.floor(vb.minY / step) * step;
      for (let x = gx0; x <= vb.minX + vb.width; x += step) {
        lines.push({ x1: x, y1: vb.minY, x2: x, y2: vb.minY + vb.height });
      }
      for (let y = gy0; y <= vb.minY + vb.height; y += step) {
        lines.push({ x1: vb.minX, y1: y, x2: vb.minX + vb.width, y2: y });
      }
      return lines;
    }, [vb]);

    const profileSet = (pc: LayoutPiece) =>
      new Set(pc.edgeTags?.profileEdgeIndices ?? []);

    const pieceLabelById = useMemo(
      () => pieceLabelByPieceId(pieces),
      [pieces],
    );
    const stripLetterLabelById = useMemo(
      () => edgeStripLetterLabelByPieceId(pieces),
      [pieces],
    );
    const multiSourcePageLabels = useMemo(() => {
      const pageIndexes = new Set<number>();
      for (const piece of pieces) {
        if (piece.sourcePageIndex != null) pageIndexes.add(piece.sourcePageIndex);
      }
      return pageIndexes.size > 1;
    }, [pieces]);

    const placementByPiece = useMemo(() => {
      const m = new Map<string, PiecePlacement>();
      if (placements) for (const p of placements) m.set(p.pieceId, p);
      return m;
    }, [placements]);

    const slabById = useMemo(() => {
      const m = new Map<string, LayoutSlab>();
      if (slabs) for (const s of slabs) m.set(s.id, s);
      return m;
    }, [slabs]);

    const pathPointer =
      tool === "select" ||
      tool === "snapLines" ||
      tool === "join" ||
      tool === "cornerRadius" ||
      tool === "chamferCorner" ||
      tool === "connectCorner"
        ? "visiblePainted"
        : "none";

    useEffect(() => {
      if (
        tool !== "select" &&
        tool !== "join" &&
        tool !== "snapLines" &&
        tool !== "cornerRadius" &&
        tool !== "chamferCorner" &&
        tool !== "connectCorner"
      )
        setHoverEdge(null);
    }, [tool]);

    useEffect(() => {
      if (vertexDrag) setHoverEdge(null);
    }, [vertexDrag]);

    /** Plan-space radius for snap-alignment handle circles on the anchor edge only (scales with zoom). */
    const snapHandleR = Math.max(1.45, planUnitsPerScreenPx() * 8);

    let orthoDrawSnap: {
      preview: LayoutPoint;
      guides: OrthoSnapGuide[];
    } | null = null;
    if (tool === "orthoDraw" && orthoCursor) {
      const ppu = planUnitsPerScreenPx();
      const snapTh = Math.max(1.5, ppu * 12);
      const guideTh = Math.max(2.25, ppu * 18);
      if (!orthoPoints || orthoPoints.length === 0) {
        const targets = collectOrthoSnapTargets(pieces, null, null);
        orthoDrawSnap = orthoSnapFirstPoint(orthoCursor, targets, snapTh, guideTh);
      } else {
        const last = orthoPoints[orthoPoints.length - 1]!;
        const targets = collectOrthoSnapTargets(pieces, orthoPoints, last);
        orthoDrawSnap = orthoSnapPreview(last, orthoCursor, targets, snapTh, guideTh);
      }
    }

    const orthoCloseRadius = Math.max(2.6, planUnitsPerScreenPx() * 18);
    const polygonCloseRadius = Math.max(2.6, planUnitsPerScreenPx() * 18);
    const orthoPreviewPoint =
      orthoDrawSnap && orthoPoints && orthoPoints.length > 0
        ? snapPlanPointToNearestInch(orthoDrawSnap.preview)
        : null;
    const polygonPreviewPoint =
      polyDraft && polyDraft.length > 0 && polyCursor
        ? snapPlanPointToNearestInch(polyCursor)
        : null;
    const orthoDisplayPreview =
      orthoPoints &&
      orthoPoints.length >= 3 &&
      orthoPreviewPoint &&
      nearPoint(orthoPoints[0], orthoPreviewPoint, orthoCloseRadius)
        ? orthoPoints[0]
        : orthoPreviewPoint;
    const polygonDisplayPreview =
      polyDraft &&
      polyDraft.length >= 3 &&
      polygonPreviewPoint &&
      nearPoint(polyDraft[0], polygonPreviewPoint, polygonCloseRadius)
        ? polyDraft[0]
        : polygonPreviewPoint;
    const activeDraftSegment =
      tool === "orthoDraw" &&
      orthoPoints &&
      orthoPoints.length > 0 &&
      orthoDisplayPreview &&
      !nearPoint(orthoPoints[orthoPoints.length - 1]!, orthoDisplayPreview, 1e-6)
        ? {
            a: orthoPoints[orthoPoints.length - 1]!,
            b: orthoDisplayPreview,
            lengthLabel: formatDraftSegmentLength(
              segmentLength(orthoPoints[orthoPoints.length - 1]!, orthoDisplayPreview),
            ),
          }
        : tool === "polygon" &&
            polyDraft &&
            polyDraft.length > 0 &&
            polygonDisplayPreview &&
            !nearPoint(polyDraft[polyDraft.length - 1]!, polygonDisplayPreview, 1e-6)
          ? {
              a: polyDraft[polyDraft.length - 1]!,
              b: polygonDisplayPreview,
              lengthLabel: formatDraftSegmentLength(
                segmentLength(polyDraft[polyDraft.length - 1]!, polygonDisplayPreview),
              ),
            }
          : null;
    const dragRectReadout =
      dragRect && (tool === "rect" || tool === "lShape")
        ? (() => {
            const minX = Math.min(dragRect.a.x, dragRect.b.x);
            const minY = Math.min(dragRect.a.y, dragRect.b.y);
            const maxX = Math.max(dragRect.a.x, dragRect.b.x);
            const maxY = Math.max(dragRect.a.y, dragRect.b.y);
            const width = maxX - minX;
            const height = maxY - minY;
            const widthLabel = formatDraftRectDimension(width);
            const heightLabel = formatDraftRectDimension(height);
            const widthBoxW = Math.max(4.5, widthLabel.length * 0.84);
            const heightBoxW = Math.max(4.5, heightLabel.length * 0.84);
            const widthY = minY - 1.9 < vb.minY + 0.8 ? maxY + 1.9 : minY - 1.9;
            const heightOffset = Math.max(2.7, heightBoxW / 2 + 0.8);
            const heightX =
              minX - heightOffset < vb.minX + 0.5 ? maxX + heightOffset : minX - heightOffset;
            return {
              width,
              height,
              widthLabel,
              heightLabel,
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
      <div className="ls-blank-wrap" ref={stageRef}>
        {zoomUiPlacement !== "toolbar" ? (
          <div className="ls-blank-chrome">
            <div
              className="ls-blank-zoom ls-plan-toolbar-group ls-plan-toolbar-group--zoom"
              role="group"
              aria-label="Zoom view"
            >
              <span className="ls-plan-toolbar-zoom-heading">Zoom</span>
              <button
                type="button"
                className="ls-plan-toolbar-btn"
                onClick={zoomOut}
                disabled={viewZoom <= minViewZoom}
                title="Zoom out"
                aria-label="Zoom out"
              >
                <IconZoomOut />
              </button>
              <span className="ls-plan-toolbar-zoom-pct" aria-live="polite">
                {blankPlanZoomDisplayPct(viewZoom)}%
              </span>
              <button
                type="button"
                className="ls-plan-toolbar-btn"
                onClick={zoomIn}
                disabled={viewZoom >= BLANK_VIEW_ZOOM_MAX}
                title="Zoom in"
                aria-label="Zoom in"
              >
                <IconZoomIn />
              </button>
              <button
                type="button"
                className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${boxZoomMode ? " is-active" : ""}`}
                aria-pressed={boxZoomMode}
                title="Drag a box on the plan to zoom to that area"
                aria-label="Zoom box — drag to frame area"
                onClick={() => {
                  setBoxZoomMode((v) => !v);
                  setZoomBoxDrag(null);
                }}
              >
                <IconZoomMarquee />
              </button>
              <button
                type="button"
                className="ls-plan-toolbar-btn"
                disabled={!selectedPieceId}
                title={
                  selectedPieceId
                    ? "Fit the selected piece in view"
                    : "Select a piece first"
                }
                aria-label="Zoom to selected piece"
                onClick={() => {
                  const pc = pieces.find((x) => x.id === selectedPieceId);
                  if (pc) fitPieceInView(pc);
                }}
              >
                <IconZoomFitSelection />
              </button>
              <button
                type="button"
                className="ls-plan-toolbar-btn"
                title="Center and zoom to show every piece on the plan"
                aria-label="Reset view — show all pieces"
                onClick={fitAllPiecesInView}
              >
                <IconZoomResetView />
              </button>
            </div>
          </div>
        ) : null}
        <div
          className={`ls-blank-stage${spaceDown ? " ls-blank-stage--space" : ""}${canvasPan ? " ls-blank-stage--panning" : ""}${boxZoomMode ? " ls-blank-stage--box-zoom" : ""}`}
          onWheel={handleWheel}
        >
          <svg
            ref={svgRef}
            className="ls-blank-svg"
            viewBox={viewBoxStr}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => {
              if (canvasPanRef.current) return;
              setHoverEdge(null);
              setDragRect(null);
              setZoomBoxDrag(null);
              setVertexDrag(null);
              setPieceDrag(null);
              setSinkDrag(null);
            }}
          >
            <rect
              x={vb.minX}
              y={vb.minY}
              width={vb.width}
              height={vb.height}
              fill="url(#lsBlankGrad)"
            />
            <defs>
              <linearGradient id="lsBlankGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#141414" />
                <stop offset="100%" stopColor="#0a0a0a" />
              </linearGradient>
            </defs>
            {gridLines.map((ln, i) => (
              <line
                key={`g-${i}`}
                x1={ln.x1}
                y1={ln.y1}
                x2={ln.x2}
                y2={ln.y2}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={0.08}
              />
            ))}
            {pieces.map((piece, idx) => {
              const sel = piece.id === selectedPieceId;
              const disp = planDisplayPoints(piece, pieces);
              const ringOpen = normalizeClosedRing(disp);
              const ringCen = centroid(ringOpen);
              const arcCenterOff = planWorldOffset(piece, pieces);
              const edgeSagittasStroke = getEffectiveEdgeArcSagittasIn(piece);
              const edgeCirclesStroke = getEffectiveEdgeArcCirclesIn(piece);
              /** Kitchen sinks clip edge strokes into segments; keep polyline there. */
              const strokeArcEdgesAsSingleSvgPath = !(piece.sinks ?? []).some(
                (s) => s.templateKind === "kitchen",
              );
              const hasArcEdge = pieceHasArcEdges(piece);
              const d = hasArcEdge
                ? pathDClosedRingWithArcs(
                    ringOpen,
                    edgeSagittasStroke,
                    ringCen,
                    edgeCirclesStroke,
                    { x: arcCenterOff.ox, y: arcCenterOff.oy },
                  )
                : ensureClosedRing(ringOpen)
                    .map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`)
                    .join(" ") + " Z";
              const isStrip = isPlanStripPiece(piece);
              const joinPieceHover =
                tool === "join" && joinHoverPieceId === piece.id && !isStrip;
              const placement = placementByPiece.get(piece.id);
              const slab =
                placement?.slabId != null
                  ? slabById.get(placement.slabId)
                  : undefined;
              const slabTex =
                pixelsPerInch != null &&
                pixelsPerInch > 0 &&
                placement &&
                slab &&
                shouldFillPieceWithSlabTexture(piece, placement, slab)
                  ? slabTextureRenderParams({
                      piece,
                      placement,
                      slab,
                      pixelsPerInch,
                      allPieces: pieces,
                    })
                  : null;
              /** When slab texture is clipped in, do not stack a fill on top — it tints the stone. */
              const fill = slabTex
                ? "none"
                : isStrip
                  ? "rgba(180,220,255,0.12)"
                  : joinPieceHover && !sel
                    ? "rgba(90, 170, 255, 0.2)"
                    : sel
                      ? "rgba(201,162,39,0.2)"
                      : `rgba(120,200,255,${0.08 + (idx % 5) * 0.03})`;
              /** Miter-tagged edges: always dark blue for quote + fabrication cue. */
              const MITER_PLAN_STROKE = "#0d47a1";
              const edgeStroke = (ei: number) =>
                piece.edgeTags?.miterEdgeIndices?.includes(ei)
                  ? MITER_PLAN_STROKE
                  : sel
                    ? "rgba(232,212,139,0.95)"
                    : "rgba(180,210,255,0.45)";
              const xs = ringOpen.map((q) => q.x);
              const ys = ringOpen.map((q) => q.y);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              const bw = maxX - minX;
              const bh = maxY - minY;
              const cx = (minX + maxX) / 2;
              const cy = (minY + maxY) / 2;
              const longHoriz = bw >= bh;
              const labelRot = longHoriz ? 0 : 90;
              const fontSize = Math.min(
                2.6,
                Math.max(1.15, Math.min(bw, bh) * 0.09),
              );
              const labelText = isStrip
                ? (stripLetterLabelById.get(piece.id) ?? "—")
                : (pieceLabelById.get(piece.id) ?? piece.name);
              const sourcePageLabel =
                multiSourcePageLabels && piece.sourcePageIndex != null
                  ? `Page ${sourcePageNumberByIndex?.[piece.sourcePageIndex] ?? piece.sourcePageIndex + 1}`
                  : null;
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
                    <g
                      clipPath={`url(#ls-slab-tex-clip-${piece.id})`}
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
                    style={{
                      pointerEvents: pathPointer,
                      cursor:
                        tool === "select"
                          ? "grab"
                          : tool === "join" ||
                              tool === "cornerRadius" ||
                              tool === "chamferCorner" ||
                              tool === "connectCorner"
                            ? "pointer"
                            : "default",
                    }}
                  />
                  {ringOpen.map((_, ei) => {
                    const a = ringOpen[ei]!;
                    const b = ringOpen[(ei + 1) % ringOpen.length]!;
                    const arcC = edgeCirclesStroke[ei];
                    const arcH = edgeSagittasStroke[ei];
                    const arcFragFromCircle =
                      strokeArcEdgesAsSingleSvgPath &&
                      arcC != null &&
                      arcC.r > 1e-9
                        ? svgCircularArcFragmentFromCircleCenter(
                            {
                              x: arcC.cx + arcCenterOff.ox,
                              y: arcC.cy + arcCenterOff.oy,
                            },
                            arcC.r,
                            a,
                            b,
                            ringCen,
                            ringOpen,
                          )
                        : null;
                    const arcFragFromSag =
                      strokeArcEdgesAsSingleSvgPath &&
                      arcH != null &&
                      Math.abs(arcH) > 1e-9
                        ? svgCircularArcFragmentFromSagitta(
                            a,
                            b,
                            arcH,
                            ringCen,
                          )
                        : null;
                    const arcFrag = arcFragFromCircle ?? arcFragFromSag;
                    if (arcFrag) {
                      return (
                        <path
                          key={`${piece.id}-str-${ei}`}
                          d={`M ${a.x} ${a.y} ${arcFrag}`}
                          fill="none"
                          stroke={edgeStroke(ei)}
                          strokeWidth={
                            piece.edgeTags?.miterEdgeIndices?.includes(ei)
                              ? 0.2
                              : sel
                                ? 0.22
                                : 0.14
                          }
                          strokeLinecap="round"
                          style={{ pointerEvents: "none" }}
                        />
                      );
                    }
                    const arcPts = sampleArcEdgePointsForStroke(
                      piece,
                      ei,
                      ringOpen,
                      ringCen,
                      28,
                      { x: arcCenterOff.ox, y: arcCenterOff.oy },
                    );
                    const segs: { a: LayoutPoint; b: LayoutPoint }[] = [];
                    for (let k = 0; k < arcPts.length - 1; k++) {
                      segs.push(
                        ...clipEdgeStrokeSegmentsForKitchenSinks(
                          arcPts[k]!,
                          arcPts[k + 1]!,
                          piece,
                          pieces,
                          BLANK_COORD_PER_INCH,
                        ),
                      );
                    }
                    return segs.map((s, sj) => (
                      <line
                        key={`${piece.id}-str-${ei}-${sj}`}
                        x1={s.a.x}
                        y1={s.a.y}
                        x2={s.b.x}
                        y2={s.b.y}
                        stroke={edgeStroke(ei)}
                        strokeWidth={
                          piece.edgeTags?.miterEdgeIndices?.includes(ei) ? 0.2 : sel ? 0.22 : 0.14
                        }
                        strokeLinecap="round"
                        style={{ pointerEvents: "none" }}
                      />
                    ));
                  })}
                  {!isPlanStripPiece(piece) ? (
                    <PieceSinkCutoutsSvg
                      piece={piece}
                      allPieces={pieces}
                      coordPerInch={BLANK_COORD_PER_INCH}
                      interactive={false}
                      appearance="cutout"
                    />
                  ) : null}
                  {showLabels ? (
                    <text
                      transform={`translate(${cx},${cy}) rotate(${labelRot})`}
                      fill="#d32f2f"
                      fontSize={fontSize}
                      textAnchor="middle"
                      className="ls-blank-piece-label"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      <tspan x={0} dy={sourcePageLabel ? "-0.25em" : "0.35em"}>
                        {labelText}
                      </tspan>
                      {sourcePageLabel ? (
                        <tspan
                          x={0}
                          dy="1.1em"
                          fontSize={Math.max(0.72, fontSize * 0.58)}
                          fill="rgba(211, 47, 47, 0.82)"
                        >
                          {sourcePageLabel}
                        </tspan>
                      ) : null}
                    </text>
                  ) : null}
                  {showEdgeDimensions
                    ? ringOpen.map((_, ei) => {
                        const a = ringOpen[ei];
                        const b = ringOpen[(ei + 1) % ringOpen.length];
                        const lensArc = edgeLengthsWithArcsInches(piece);
                        const len = lensArc[ei] ?? Math.hypot(b.x - a.x, b.y - a.y);
                        if (len < 0.35) return null;
                        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                        const cen = ringCentroid(ringOpen);
                        const { nx, ny } = inwardNormalTowardCentroid(
                          a,
                          b,
                          cen,
                        );
                        const off = Math.min(1.4, len * 0.12);
                        const tx = mid.x + nx * off;
                        const ty = mid.y + ny * off;
                        const ang =
                          (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
                        const fs = Math.max(0.55, Math.min(1.65, len * 0.065));
                        const canEdit = canEditEdgeSegmentLength(piece, ei);
                        const isDimSel =
                          dimEdit?.pieceId === piece.id &&
                          dimEdit.edgeIndex === ei;
                        const label =
                          len >= 10 ? len.toFixed(1) : len.toFixed(2);
                        return (
                          <g key={`${piece.id}-dim-${ei}`}>
                            <text
                              data-ls-dim-hit={canEdit ? "1" : undefined}
                              transform={`translate(${tx},${ty}) rotate(${ang})`}
                              fill={
                                isDimSel
                                  ? "rgba(255, 85, 85, 0.98)"
                                  : "rgba(211, 47, 47, 0.95)"
                              }
                              fontSize={fs}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              className={
                                canEdit
                                  ? "ls-blank-dim ls-blank-dim--editable"
                                  : "ls-blank-dim"
                              }
                              style={{
                                pointerEvents: canEdit ? "all" : "none",
                                cursor: canEdit ? "pointer" : "default",
                                userSelect: "none",
                              }}
                              onPointerDown={(ev) => {
                                if (!canEdit) return;
                                ev.stopPropagation();
                                const svg = svgRef.current;
                                if (!svg) return;
                                const pt = svg.createSVGPoint();
                                pt.x = tx;
                                pt.y = ty;
                                const ctm = svg.getScreenCTM();
                                if (!ctm) return;
                                const sp = pt.matrixTransform(ctm);
                                setDimEdit({
                                  pieceId: piece.id,
                                  edgeIndex: ei,
                                  left: sp.x,
                                  top: sp.y,
                                  value: label,
                                });
                                onSelectPiece(piece.id);
                                onSelectEdge({
                                  pieceId: piece.id,
                                  edgeIndex: ei,
                                });
                              }}
                            >
                              {label}
                            </text>
                          </g>
                        );
                      })
                    : null}
                </g>
              );
            })}
            {tool === "select" ||
            tool === "snapLines" ||
            tool === "join" ||
            tool === "cornerRadius" ||
            tool === "chamferCorner" ||
            tool === "connectCorner"
              ? pieces.map((piece) => {
                  /** Splash edges: selectable in select / snapLines (green); skip join/corner/connect (false-positives vs counters). */
                  if (
                    isPlanStripPiece(piece) &&
                    (tool === "join" ||
                      tool === "cornerRadius" ||
                      tool === "chamferCorner" ||
                      tool === "connectCorner")
                  )
                    return null;
                  const disp = planDisplayPoints(piece, pieces);
                  const ring = normalizeClosedRing(disp);
                  const n = ring.length;
                  const ringCen = centroid(ring);
                  const arcCenterOff = planWorldOffset(piece, pieces);
                  const edgeSagittas = getEffectiveEdgeArcSagittasIn(piece);
                  const edgeCircles = getEffectiveEdgeArcCirclesIn(piece);
                  const prof = profileSet(piece);
                  const lines: ReactNode[] = [];
                  const arcBulgeArrows: ReactNode[] = [];
                  for (let i = 0; i < n; i++) {
                    const a = ring[i];
                    const b = ring[(i + 1) % n];
                    const isProf = prof.has(i);
                    const isSelEdge =
                      selectedEdge?.pieceId === piece.id &&
                      selectedEdge.edgeIndex === i;
                    const isFilletMarqueeSel =
                      tool === "select" &&
                      selectedFilletEdges.some(
                        (s) =>
                          s.pieceId === piece.id && s.edgeIndex === i,
                      );
                    const isHoverEdge =
                      (tool === "select" ||
                        tool === "join" ||
                        tool === "snapLines" ||
                        tool === "cornerRadius" ||
                        tool === "chamferCorner" ||
                        tool === "connectCorner") &&
                      hoverEdge &&
                      hoverEdge.pieceId === piece.id &&
                      hoverEdge.edgeIndex === i;
                    const isSnapAnchor =
                      tool === "snapLines" &&
                      snapAnchor &&
                      snapAnchor.pieceId === piece.id &&
                      snapAnchor.edgeIndex === i;
                    const isSnapPairAnchor =
                      tool === "snapLines" &&
                      snapPair &&
                      snapPair.anchor.pieceId === piece.id &&
                      snapPair.anchor.edgeIndex === i;
                    const isSnapPairMoving =
                      tool === "snapLines" &&
                      snapPair &&
                      snapPair.moving.pieceId === piece.id &&
                      snapPair.moving.edgeIndex === i;
                    const isJoinFirstPieceEdge =
                      tool === "join" &&
                      joinPiece1 != null &&
                      joinPiece1 === piece.id;
                    const isCornerRadiusFirst =
                      tool === "cornerRadius" &&
                      cornerRadiusFirstEdge &&
                      cornerRadiusFirstEdge.pieceId === piece.id &&
                      cornerRadiusFirstEdge.edgeIndex === i;
                    const isChamferFirst =
                      tool === "chamferCorner" &&
                      cornerChamferFirstEdge &&
                      cornerChamferFirstEdge.pieceId === piece.id &&
                      cornerChamferFirstEdge.edgeIndex === i;
                    const isConnectFirst =
                      tool === "connectCorner" &&
                      connectFirstEdge &&
                      connectFirstEdge.pieceId === piece.id &&
                      connectFirstEdge.edgeIndex === i;
                    const subtleSnap =
                      (tool === "snapLines" ||
                        tool === "join" ||
                        tool === "cornerRadius" ||
                        tool === "chamferCorner" ||
                        tool === "connectCorner") &&
                      !isSelEdge &&
                      !isFilletMarqueeSel &&
                      !isProf &&
                      !isSnapAnchor &&
                      !isSnapPairAnchor &&
                      !isSnapPairMoving &&
                      !isJoinFirstPieceEdge &&
                      !isCornerRadiusFirst &&
                      !isChamferFirst &&
                      !isConnectFirst &&
                      !isHoverEdge;
                    const strokeCol = isHoverEdge
                      ? isPlanStripPiece(piece)
                        ? "rgba(72, 210, 140, 0.98)"
                        : tool === "snapLines"
                          ? "rgba(70, 155, 255, 0.98)"
                          : "rgba(235, 65, 65, 0.98)"
                      : isFilletMarqueeSel
                        ? "rgba(255, 210, 120, 0.98)"
                        : isSnapPairAnchor
                        ? "rgba(232,212,139,0.98)"
                        : isSnapPairMoving
                          ? "rgba(232,212,139,0.72)"
                          : isSnapAnchor
                            ? "rgba(232,212,139,0.95)"
                            : isCornerRadiusFirst ||
                                isChamferFirst ||
                                isConnectFirst
                              ? "rgba(232,212,139,0.95)"
                              : isJoinFirstPieceEdge
                                ? "rgba(232,212,139,0.95)"
                                : isSelEdge
                                  ? isPlanStripPiece(piece)
                                    ? "rgba(38, 175, 105, 0.98)"
                                    : "rgba(255,240,200,0.98)"
                                  : isProf
                                    ? "rgba(232,212,100,0.95)"
                                    : subtleSnap
                                      ? "rgba(255,255,255,0.14)"
                                      : "transparent";
                    const strokeW = isHoverEdge
                      ? 0.52
                      : isFilletMarqueeSel
                        ? 0.48
                        : isJoinFirstPieceEdge
                          ? 0.36
                          : isCornerRadiusFirst ||
                              isChamferFirst ||
                              isConnectFirst
                            ? 0.36
                            : isSnapPairAnchor || isSnapPairMoving
                              ? 0.4
                              : isSnapAnchor
                                ? 0.36
                                : isProf
                                  ? 0.42
                                  : isSelEdge
                                    ? 0.38
                                    : subtleSnap
                                      ? 0.16
                                      : 0.01;
                    const arcH = edgeSagittas[i];
                    const arcC = edgeCircles[i];
                    const arcFragFromCircle =
                      arcC != null && arcC.r > 1e-9
                        ? svgCircularArcFragmentFromCircleCenter(
                            {
                              x: arcC.cx + arcCenterOff.ox,
                              y: arcC.cy + arcCenterOff.oy,
                            },
                            arcC.r,
                            a!,
                            b!,
                            ringCen,
                            ring,
                          )
                        : null;
                    const arcFragFromSag =
                      arcH != null && Math.abs(arcH) > 1e-9
                        ? svgCircularArcFragmentFromSagitta(
                            a!,
                            b!,
                            arcH,
                            ringCen,
                          )
                        : null;
                    const arcFrag = arcFragFromCircle ?? arcFragFromSag;
                    if (arcFrag) {
                        /* Avoid double-stroking the same arc: base layer already draws the true
                         * SVG arc; subtle “snap” edges only repeat a second path on top. */
                        if (!subtleSnap) {
                          lines.push(
                            <path
                              key={`${piece.id}-e-${i}`}
                              d={`M ${a!.x} ${a!.y} ${arcFrag}`}
                              stroke={strokeCol}
                              strokeWidth={strokeW}
                              strokeLinecap="round"
                              fill="none"
                              style={{ pointerEvents: "none" }}
                            />,
                          );
                        }
                        if (
                          tool === "select" &&
                          isSelEdge &&
                          arcH != null &&
                          Math.abs(arcH) > 1e-9
                        ) {
                          const ap = arcBulgeArrowParams(
                            a!,
                            b!,
                            arcH,
                            ringCen,
                          );
                          if (ap) {
                            const chordLen = Math.hypot(
                              b!.x - a!.x,
                              b!.y - a!.y,
                            );
                            const stemVis = Math.min(
                              1.15,
                              Math.max(0.42, chordLen * 0.13),
                            );
                            const headW = Math.min(0.38, stemVis * 0.42);
                            const { midpoint: mid, towardApexUnit, towardOppositeUnit } =
                              ap;
                            const tipCurX =
                              mid.x + towardApexUnit.x * stemVis;
                            const tipCurY =
                              mid.y + towardApexUnit.y * stemVis;
                            const tipOppX =
                              mid.x + towardOppositeUnit.x * stemVis;
                            const tipOppY =
                              mid.y + towardOppositeUnit.y * stemVis;
                            const hitCx =
                              mid.x + towardOppositeUnit.x * (stemVis * 0.55);
                            const hitCy =
                              mid.y + towardOppositeUnit.y * (stemVis * 0.55);
                            arcBulgeArrows.push(
                              <g key={`${piece.id}-arc-bulge-arrows-${i}`}>
                                <path
                                  d={bulgeArrowTriangleD(
                                    tipCurX,
                                    tipCurY,
                                    towardApexUnit.x,
                                    towardApexUnit.y,
                                    stemVis * 0.72,
                                    headW,
                                  )}
                                  className="ls-arc-bulge-arrow ls-arc-bulge-arrow--current"
                                  style={{ pointerEvents: "none" }}
                                >
                                  <title>Bulge direction</title>
                                </path>
                                <g
                                  className="ls-arc-bulge-arrow-flip"
                                  onPointerDown={(ev) => {
                                    ev.stopPropagation();
                                    ev.preventDefault();
                                    const pc = piecesRef.current.find(
                                      (p) => p.id === piece.id,
                                    );
                                    if (!pc || isPlanStripPiece(pc))
                                      return;
                                    const hh =
                                      getEffectiveEdgeArcSagittasIn(pc)[i];
                                    if (
                                      hh == null ||
                                      Math.abs(hh) < 1e-9
                                    )
                                      return;
                                    const next = applyArcSagittaToEdge(
                                      pc,
                                      i,
                                      -hh,
                                    );
                                    if (!next) return;
                                    onPieceDragStart?.();
                                    onPiecesChange(
                                      piecesRef.current.map((p) =>
                                        p.id === next.id ? next : p,
                                      ),
                                    );
                                  }}
                                >
                                  <circle
                                    cx={hitCx}
                                    cy={hitCy}
                                    r={1.35}
                                    className="ls-arc-bulge-arrow-flip-hit"
                                  >
                                    <title>Flip bulge to opposite side</title>
                                  </circle>
                                  <path
                                    d={bulgeArrowTriangleD(
                                      tipOppX,
                                      tipOppY,
                                      towardOppositeUnit.x,
                                      towardOppositeUnit.y,
                                      stemVis * 0.72,
                                      headW,
                                    )}
                                    className="ls-arc-bulge-arrow ls-arc-bulge-arrow--opposite"
                                    style={{ pointerEvents: "none" }}
                                  >
                                    <title>Flip bulge to opposite side</title>
                                  </path>
                                </g>
                              </g>,
                            );
                          }
                        }
                    } else {
                      lines.push(
                        <line
                          key={`${piece.id}-e-${i}`}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={strokeCol}
                          strokeWidth={strokeW}
                          strokeLinecap="round"
                          style={{ pointerEvents: "none" }}
                        />,
                      );
                    }
                  }
                  return (
                    <g key={`edges-${piece.id}`}>
                      {lines}
                      {arcBulgeArrows}
                    </g>
                  );
                })
              : null}
            {snapPair && tool === "snapLines"
              ? (() => {
                  const aPc = pieces.find(
                    (p) => p.id === snapPair.anchor.pieceId,
                  );
                  if (!aPc) return null;
                  const aSeg = worldEdgeSegment(
                    aPc,
                    snapPair.anchor.edgeIndex,
                    pieces,
                  );
                  if (!aSeg) return null;
                  const midA = {
                    x: (aSeg.a.x + aSeg.b.x) / 2,
                    y: (aSeg.a.y + aSeg.b.y) / 2,
                  };
                  return (
                    <g
                      className="ls-snap-align-handles"
                      style={{ pointerEvents: "none" }}
                    >
                      <circle
                        cx={aSeg.a.x}
                        cy={aSeg.a.y}
                        r={snapHandleR}
                        fill="rgba(55, 145, 255, 0.35)"
                        stroke="rgba(120, 195, 255, 0.98)"
                        strokeWidth={0.12}
                      />
                      <circle
                        cx={midA.x}
                        cy={midA.y}
                        r={snapHandleR}
                        fill="rgba(55, 145, 255, 0.35)"
                        stroke="rgba(120, 195, 255, 0.98)"
                        strokeWidth={0.12}
                      />
                      <circle
                        cx={aSeg.b.x}
                        cy={aSeg.b.y}
                        r={snapHandleR}
                        fill="rgba(55, 145, 255, 0.35)"
                        stroke="rgba(120, 195, 255, 0.98)"
                        strokeWidth={0.12}
                      />
                    </g>
                  );
                })()
              : null}
            {dragRect ? (
              <>
                <rect
                  x={Math.min(dragRect.a.x, dragRect.b.x)}
                  y={Math.min(dragRect.a.y, dragRect.b.y)}
                  width={Math.abs(dragRect.b.x - dragRect.a.x)}
                  height={Math.abs(dragRect.b.y - dragRect.a.y)}
                  fill="rgba(201,162,39,0.1)"
                  stroke="rgba(232,212,139,0.55)"
                  strokeWidth={0.12}
                />
                {dragRectReadout ? (
                  <>
                    <g className="ls-draft-segment-label" pointerEvents="none">
                      <rect
                        x={dragRectReadout.widthCenterX - dragRectReadout.widthBoxW / 2}
                        y={dragRectReadout.widthCenterY - 1.9}
                        width={dragRectReadout.widthBoxW}
                        height={1.45}
                        rx={0.4}
                        ry={0.4}
                      />
                      <text
                        x={dragRectReadout.widthCenterX}
                        y={dragRectReadout.widthCenterY - 1.18}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        W {dragRectReadout.widthLabel}
                      </text>
                    </g>
                    <g className="ls-draft-segment-label" pointerEvents="none">
                      <rect
                        x={dragRectReadout.heightCenterX - dragRectReadout.heightBoxW / 2}
                        y={dragRectReadout.heightCenterY - 1.9}
                        width={dragRectReadout.heightBoxW}
                        height={1.45}
                        rx={0.4}
                        ry={0.4}
                      />
                      <text
                        x={dragRectReadout.heightCenterX}
                        y={dragRectReadout.heightCenterY - 1.18}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        H {dragRectReadout.heightLabel}
                      </text>
                    </g>
                  </>
                ) : null}
              </>
            ) : null}
            {selectFilletMarquee ? (
              <rect
                x={Math.min(selectFilletMarquee.a.x, selectFilletMarquee.b.x)}
                y={Math.min(selectFilletMarquee.a.y, selectFilletMarquee.b.y)}
                width={Math.abs(selectFilletMarquee.b.x - selectFilletMarquee.a.x)}
                height={Math.abs(selectFilletMarquee.b.y - selectFilletMarquee.a.y)}
                fill="rgba(255, 210, 120, 0.08)"
                stroke="rgba(255, 210, 120, 0.75)"
                strokeWidth={0.12}
                strokeDasharray="0.45 0.35"
                style={{ pointerEvents: "none" }}
              />
            ) : null}
            {zoomBoxDrag ? (
              <rect
                x={Math.min(zoomBoxDrag.a.x, zoomBoxDrag.b.x)}
                y={Math.min(zoomBoxDrag.a.y, zoomBoxDrag.b.y)}
                width={Math.abs(zoomBoxDrag.b.x - zoomBoxDrag.a.x)}
                height={Math.abs(zoomBoxDrag.b.y - zoomBoxDrag.a.y)}
                fill="rgba(120, 195, 255, 0.12)"
                stroke="rgba(120, 195, 255, 0.85)"
                strokeWidth={0.14}
                strokeDasharray="0.9 0.45"
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
                  stroke="rgba(232,212,139,0.95)"
                  strokeWidth={0.24}
                  strokeDasharray="1.1 0.55"
                  pointerEvents="none"
                />
              ) : (
                <line
                  x1={seamPreviewLine.x0}
                  y1={seamPreviewLine.y}
                  x2={seamPreviewLine.x1}
                  y2={seamPreviewLine.y}
                  stroke="rgba(232,212,139,0.95)"
                  strokeWidth={0.24}
                  strokeDasharray="1.1 0.55"
                  pointerEvents="none"
                />
              )
            ) : null}
            {tool === "polygon" && polyDraft && polyDraft.length > 0 ? (
              <>
                {polyDraft.length >= 2 ? (
                  <polyline
                    points={polyDraft.map((q) => `${q.x},${q.y}`).join(" ")}
                    fill="none"
                    stroke="rgba(232,212,139,0.85)"
                    strokeWidth={0.2}
                    pointerEvents="none"
                  />
                ) : null}
                {polygonDisplayPreview ? (
                  <line
                    x1={polyDraft[polyDraft.length - 1]!.x}
                    y1={polyDraft[polyDraft.length - 1]!.y}
                    x2={polygonDisplayPreview.x}
                    y2={polygonDisplayPreview.y}
                    stroke="rgba(232,212,139,0.92)"
                    strokeWidth={0.18}
                    strokeDasharray="0.9 0.45"
                    pointerEvents="none"
                  />
                ) : null}
              </>
            ) : null}
            {tool === "orthoDraw" &&
            orthoDrawSnap &&
            orthoDrawSnap.guides.length > 0
              ? orthoDrawSnap.guides.map((g, gi) =>
                  g.kind === "vertical" ? (
                    <line
                      key={`ortho-guide-v-${gi}`}
                      x1={g.x!}
                      y1={vb.minY}
                      x2={g.x!}
                      y2={vb.minY + vb.height}
                      stroke="rgba(120, 195, 255, 0.82)"
                      strokeWidth={0.14}
                      strokeDasharray="0.9 0.45"
                      pointerEvents="none"
                    />
                  ) : (
                    <line
                      key={`ortho-guide-h-${gi}`}
                      x1={vb.minX}
                      y1={g.y!}
                      x2={vb.minX + vb.width}
                      y2={g.y!}
                      stroke="rgba(120, 195, 255, 0.82)"
                      strokeWidth={0.14}
                      strokeDasharray="0.9 0.45"
                      pointerEvents="none"
                    />
                  ),
                )
              : null}
            {orthoPoints && orthoPoints.length >= 2 ? (
              <polyline
                points={orthoPoints.map((q) => `${q.x},${q.y}`).join(" ")}
                fill="none"
                stroke="rgba(232,212,139,0.92)"
                strokeWidth={0.18}
                pointerEvents="none"
              />
            ) : null}
            {orthoPoints && orthoPoints.length > 0 && orthoDisplayPreview ? (
              <line
                x1={orthoPoints[orthoPoints.length - 1]!.x}
                y1={orthoPoints[orthoPoints.length - 1]!.y}
                x2={orthoDisplayPreview.x}
                y2={orthoDisplayPreview.y}
                stroke="rgba(232,212,139,0.92)"
                strokeWidth={0.18}
                strokeDasharray="0.9 0.45"
                pointerEvents="none"
              />
            ) : null}
            {tool === "polygon" && polyDraft && polyDraft.length >= 3 ? (
              <circle
                cx={polyDraft[0]!.x}
                cy={polyDraft[0]!.y}
                r={polygonCloseRadius}
                className="ls-draft-close-target"
                pointerEvents="none"
              />
            ) : null}
            {tool === "orthoDraw" && orthoPoints && orthoPoints.length >= 3 ? (
              <circle
                cx={orthoPoints[0]!.x}
                cy={orthoPoints[0]!.y}
                r={orthoCloseRadius}
                className="ls-draft-close-target"
                pointerEvents="none"
              />
            ) : null}
            {activeDraftSegment ? (
              <g className="ls-draft-segment-label" pointerEvents="none">
                <rect
                  x={segmentMidpoint(activeDraftSegment.a, activeDraftSegment.b).x - Math.max(2.25, activeDraftSegment.lengthLabel.length * 0.42)}
                  y={segmentMidpoint(activeDraftSegment.a, activeDraftSegment.b).y - 1.9}
                  width={Math.max(4.5, activeDraftSegment.lengthLabel.length * 0.84)}
                  height={1.45}
                  rx={0.4}
                  ry={0.4}
                />
                <text
                  x={segmentMidpoint(activeDraftSegment.a, activeDraftSegment.b).x}
                  y={segmentMidpoint(activeDraftSegment.a, activeDraftSegment.b).y - 1.18}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {activeDraftSegment.lengthLabel}
                </text>
              </g>
            ) : null}
            {tool === "select" && selectedPieceId
              ? pieces
                  .filter((pc) => pc.id === selectedPieceId)
                  .map((pc) =>
                    normalizeClosedRing(planDisplayPoints(pc, pieces)).map(
                      (q, vi) => (
                        <circle
                          key={`${pc.id}-v-${vi}`}
                          cx={q.x}
                          cy={q.y}
                          r={0.9}
                          fill="rgba(15,15,15,0.65)"
                          stroke="rgba(232,212,139,0.9)"
                          strokeWidth={0.08}
                          style={{ pointerEvents: "all", cursor: "grab" }}
                          onPointerDown={(ev) => {
                            ev.stopPropagation();
                            ev.preventDefault();
                            (ev.target as Element).setPointerCapture(
                              ev.pointerId,
                            );
                            onPieceDragStart?.();
                            setVertexDrag({ pieceId: pc.id, index: vi });
                            onSelectEdge(null);
                          }}
                        />
                      ),
                    ),
                  )
              : null}
          </svg>
          {tool === "select" && selectedEdge && popoverPos && !dimEdit ? (
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
              <button
                type="button"
                className="ls-edge-popover-btn"
                onClick={() => {
                  const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
                  if (piece && isPlanStripPiece(piece)) {
                    openSeamModalFromEdge();
                    return;
                  }
                  onRequestSplashForEdge(selectedEdge, "splash");
                }}
              >
                {(() => {
                  const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
                  return piece && isPlanStripPiece(piece) ? "Seam" : "Splash";
                })()}
              </button>
              {(() => {
                const piece = pieces.find((p) => p.id === selectedEdge.pieceId);
                if (!piece || isPlanStripPiece(piece)) return null;
                return (
                  <button
                    type="button"
                    className="ls-edge-popover-btn"
                    title="Same plan placement as splash; 3D preview folds the miter strip down from the edge"
                    onClick={() => onRequestSplashForEdge(selectedEdge, "miter")}
                  >
                    Miter
                  </button>
                );
              })()}
              {onSetSplashBottomEdge &&
              (() => {
                const pe = pieces.find((p) => p.id === selectedEdge.pieceId);
                return pe && isPlanStripPiece(pe);
              })() ? (
                <button
                  type="button"
                  className="ls-edge-popover-btn"
                  title="Use this edge as the hinge / counter contact for 3D preview"
                  onClick={() => {
                    onSetSplashBottomEdge(selectedEdge);
                    onSelectEdge(null);
                  }}
                >
                  Bottom (3D)
                </button>
              ) : null}
              {(() => {
                const popPc = pieces.find((p) => p.id === selectedEdge.pieceId);
                if (
                  !popPc ||
                  !canEditEdgeSegmentLength(popPc, selectedEdge.edgeIndex)
                ) {
                  return null;
                }
                return (
                  <button
                    type="button"
                    className="ls-edge-popover-btn"
                    title={
                      pieceHasAnyArc(popPc)
                        ? "Straight edges only. Applying a length removes all corner radii on this piece."
                        : "Straight edge length (orthogonal pieces)"
                    }
                    onClick={() => openEdgeLengthEdit()}
                  >
                    Length
                  </button>
                );
              })()}
              {(() => {
                const pe = pieces.find((p) => p.id === selectedEdge.pieceId);
                return pe && !isPlanStripPiece(pe);
              })() ? (
                <button
                  type="button"
                  className="ls-edge-popover-btn"
                  onClick={() => {
                    const pc = pieces.find((p) => p.id === selectedEdge.pieceId);
                    if (!pc) return;
                    const ring = normalizeClosedRing(pc.points);
                    const n = ring.length;
                    if (n < 2) return;
                    const existing = getEffectiveEdgeArcSagittasIn(pc)[
                      selectedEdge.edgeIndex
                    ];
                    setEdgeArcModal({
                      sagittaStr:
                        existing != null && Math.abs(existing) > 1e-9
                          ? String(Math.round(existing * 1000) / 1000)
                          : "1",
                      error: undefined,
                    });
                  }}
                >
                  Arc…
                </button>
              ) : null}
              {(() => {
                const popPc = pieces.find((p) => p.id === selectedEdge.pieceId);
                if (!popPc || isPlanStripPiece(popPc)) return false;
                const c = getEffectiveEdgeArcCirclesIn(popPc)[
                  selectedEdge.edgeIndex
                ];
                return c != null && c.r > 1e-9;
              })() ? (
                <button
                  type="button"
                  className="ls-edge-popover-btn"
                  onClick={() => {
                    const pc = pieces.find((p) => p.id === selectedEdge.pieceId);
                    if (!pc) return;
                    const removed = removeCornerFilletAtFilletEdge(
                      pc,
                      selectedEdge.edgeIndex,
                    );
                    if (!removed.ok) {
                      window.alert(removed.reason);
                      return;
                    }
                    const next = piecesRef.current.map((p) =>
                      p.id === removed.piece.id ? removed.piece : p,
                    );
                    if (anyPiecesOverlap(next)) {
                      window.alert(
                        "Removing this radius would overlap another piece.",
                      );
                      return;
                    }
                    onPieceDragStart?.();
                    onPiecesChange(next);
                    onSelectEdge(null);
                  }}
                >
                  Remove radius
                </button>
              ) : null}
              {(() => {
                const popPc = pieces.find((p) => p.id === selectedEdge.pieceId);
                if (!popPc || isPlanStripPiece(popPc)) return false;
                const c = getEffectiveEdgeArcCirclesIn(popPc)[
                  selectedEdge.edgeIndex
                ];
                if (c != null && c.r > 1e-9) return false;
                const s = getEffectiveEdgeArcSagittasIn(popPc)[
                  selectedEdge.edgeIndex
                ];
                return s != null && Math.abs(s) > 1e-9;
              })() ? (
                <button
                  type="button"
                  className="ls-edge-popover-btn"
                  onClick={() => {
                    const pc = pieces.find((p) => p.id === selectedEdge.pieceId);
                    if (!pc) return;
                    const cleared = clearArcOnEdge(pc, selectedEdge.edgeIndex);
                    if (!cleared) return;
                    onPieceDragStart?.();
                    onPiecesChange(
                      pieces.map((p) => (p.id === cleared.id ? cleared : p)),
                    );
                    onSelectEdge(null);
                  }}
                >
                  Remove arc
                </button>
              ) : null}
              {onRequestAddSinkForEdge &&
              (() => {
                const pe = pieces.find((p) => p.id === selectedEdge.pieceId);
                return pe && !isPlanStripPiece(pe);
              })() ? (
                <button
                  type="button"
                  className="ls-edge-popover-btn"
                  onClick={() => onRequestAddSinkForEdge(selectedEdge)}
                >
                  Sink
                </button>
              ) : null}
              {(() => {
                const pe = pieces.find((p) => p.id === selectedEdge.pieceId);
                return pe && !isPlanStripPiece(pe);
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
              {(() => {
                const arcPc = pieces.find(
                  (p) => p.id === selectedEdge.pieceId,
                );
                if (!arcPc || !pieceHasAnyArc(arcPc)) return null;
                return (
                  <p className="ls-edge-popover-disclaimer" role="note">
                    Arc edges (corner radii) are not length-editable. Changing a
                    straight edge length removes all radii on this piece.
                  </p>
                );
              })()}
            </div>
          ) : null}
          {dimEdit ? (
            <div
              className="ls-dim-popover glass-panel"
              data-ls-dim-hit=""
              style={{ left: dimEdit.left, top: dimEdit.top }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {(() => {
                const dpc = pieces.find((p) => p.id === dimEdit.pieceId);
                if (!dpc || !pieceHasAnyArc(dpc)) return null;
                return (
                  <p className="ls-dim-popover-disclaimer" role="note">
                    Applying a length here removes all corner radii on this piece.
                  </p>
                );
              })()}
              <div className="ls-dim-popover-row">
              <label className="ls-dim-popover-label">
                Length (in)
                <input
                  ref={dimEditInputRef}
                  className="ls-input ls-dim-input"
                  type="text"
                  inputMode="decimal"
                  value={dimEdit.value}
                  onChange={(e) =>
                    setDimEdit((d) => (d ? { ...d, value: e.target.value } : d))
                  }
                  onFocus={(e) => {
                    e.currentTarget.select();
                    e.currentTarget.setSelectionRange(0, e.currentTarget.value.length);
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    e.currentTarget.select();
                    e.currentTarget.setSelectionRange(0, e.currentTarget.value.length);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      applyDimensionLength(
                        dimEdit.pieceId,
                        dimEdit.edgeIndex,
                        Number(dimEdit.value),
                      );
                    }
                    if (e.key === "Escape") setDimEdit(null);
                  }}
                  autoFocus
                />
              </label>
              <button
                type="button"
                className="ls-btn ls-btn-secondary ls-dim-apply"
                onClick={() =>
                  applyDimensionLength(
                    dimEdit.pieceId,
                    dimEdit.edgeIndex,
                    Number(dimEdit.value),
                  )
                }
              >
                Apply
              </button>
              </div>
            </div>
          ) : null}
        </div>
        {seamModal ? (
          <div
            className="ls-seam-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ls-seam-modal-title"
            onClick={() => setSeamModal(null)}
          >
            <div
              className="ls-seam-modal glass-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="ls-seam-modal-title" className="ls-seam-modal-title">
                Place seam
              </h2>
              <p className="ls-seam-modal-sub">
                The seam is perpendicular to the selected edge. Dimensions run
                along that edge only (not the full piece width or depth). Edit
                one side — the other adjusts so both add up to that edge’s
                length.
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
                      const total =
                        g.kind === "vertical"
                          ? g.xMax - g.xMin
                          : g.yMax - g.yMin;
                      const a = parseFloat(v);
                      if (!Number.isFinite(a)) {
                        setSeamModal((m) => (m ? { ...m, valA: v } : m));
                        return;
                      }
                      const b = Math.max(0, total - a);
                      setSeamModal((m) =>
                        m ? { ...m, valA: v, valB: formatDimInches(b) } : m,
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
                      const total =
                        g.kind === "vertical"
                          ? g.xMax - g.xMin
                          : g.yMax - g.yMin;
                      const b = parseFloat(v);
                      if (!Number.isFinite(b)) {
                        setSeamModal((m) => (m ? { ...m, valB: v } : m));
                        return;
                      }
                      const a = Math.max(0, total - b);
                      setSeamModal((m) =>
                        m ? { ...m, valB: v, valA: formatDimInches(a) } : m,
                      );
                    }}
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
        {cornerRadiusModal ? (
          <div
            className="ls-seam-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ls-corner-radius-modal-title"
            onClick={() => {
              setCornerRadiusModal(null);
              onTraceToolChange?.("select");
            }}
          >
            <div
              className="ls-seam-modal glass-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="ls-corner-radius-modal-title"
                className="ls-seam-modal-title"
              >
                Corner radius
              </h2>
              <p className="ls-seam-modal-sub">
                Fillet radius in inches, then click two adjacent edges at one
                corner — outside corners and inside (re-entrant) corners.
              </p>
              <p className="ls-seam-modal-sub">
                After radii exist on a piece, arc edges cannot be length-edited.
                Editing a straight edge length removes all corner radii on that
                piece (get dimensions right first, or remove radii and then add
                them again).
              </p>
              <div className="ls-seam-modal-fields">
                <label className="ls-seam-modal-field">
                  Radius (in)
                  <input
                    className="ls-input"
                    type="number"
                    min={0.125}
                    step={0.125}
                    value={cornerRadiusModal.radiusStr}
                    onChange={(e) =>
                      setCornerRadiusModal((m) =>
                        m
                          ? {
                              ...m,
                              radiusStr: e.target.value,
                              error: undefined,
                            }
                          : m,
                      )
                    }
                    autoFocus
                  />
                </label>
              </div>
              {cornerRadiusModal.error ? (
                <p className="ls-seam-modal-inline-error" role="alert">
                  {cornerRadiusModal.error}
                </p>
              ) : null}
              <div className="ls-seam-modal-actions">
                <button
                  type="button"
                  className="ls-btn ls-btn-secondary"
                  onClick={() => {
                    setCornerRadiusModal(null);
                    onTraceToolChange?.("select");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ls-btn ls-btn-primary"
                  onClick={() => {
                    const r = parseFloat(cornerRadiusModal.radiusStr);
                    if (!Number.isFinite(r) || r <= 0) {
                      setCornerRadiusModal((m) =>
                        m
                          ? {
                              ...m,
                              error: "Enter a positive radius in inches.",
                            }
                          : m,
                      );
                      return;
                    }
                    setCornerRadiusConfig({ radiusIn: r });
                    setCornerRadiusModal(null);
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {cornerChamferModal ? (
          <div
            className="ls-seam-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ls-corner-chamfer-modal-title"
            onClick={() => {
              setCornerChamferModal(null);
              onTraceToolChange?.("select");
            }}
          >
            <div
              className="ls-seam-modal glass-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="ls-corner-chamfer-modal-title"
                className="ls-seam-modal-title"
              >
                Corner chamfer
              </h2>
              <p className="ls-seam-modal-sub">
                Chamfer size in inches, then click two adjacent edges at one
                corner to cut that point off with a straight bevel.
              </p>
              <p className="ls-seam-modal-sub">
                Adding a chamfer turns manual rectangles and L-shapes into
                editable polygons. The two trimmed edges stay straight and the
                new chamfer edge has no arc metadata.
              </p>
              <div className="ls-seam-modal-fields">
                <label className="ls-seam-modal-field">
                  Chamfer size (in)
                  <input
                    className="ls-input"
                    type="number"
                    min={0.125}
                    step={0.125}
                    value={cornerChamferModal.sizeStr}
                    onChange={(e) =>
                      setCornerChamferModal((m) =>
                        m
                          ? {
                              ...m,
                              sizeStr: e.target.value,
                              error: undefined,
                            }
                          : m,
                      )
                    }
                    autoFocus
                  />
                </label>
              </div>
              {cornerChamferModal.error ? (
                <p className="ls-seam-modal-inline-error" role="alert">
                  {cornerChamferModal.error}
                </p>
              ) : null}
              <div className="ls-seam-modal-actions">
                <button
                  type="button"
                  className="ls-btn ls-btn-secondary"
                  onClick={() => {
                    setCornerChamferModal(null);
                    onTraceToolChange?.("select");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ls-btn ls-btn-primary"
                  onClick={() => {
                    const size = parseFloat(cornerChamferModal.sizeStr);
                    if (!Number.isFinite(size) || size <= 0) {
                      setCornerChamferModal((m) =>
                        m
                          ? {
                              ...m,
                              error: "Enter a positive chamfer size in inches.",
                            }
                          : m,
                      );
                      return;
                    }
                    setCornerChamferConfig({ sizeIn: size });
                    setCornerChamferModal(null);
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {edgeArcModal && selectedEdge ? (
          <div
            className="ls-seam-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ls-edge-arc-modal-title"
            onClick={() => setEdgeArcModal(null)}
          >
            <div
              className="ls-seam-modal glass-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="ls-edge-arc-modal-title" className="ls-seam-modal-title">
                Edge arc
              </h2>
              <p className="ls-seam-modal-sub">
                Offset in inches from the chord midpoint to the arc (three-point
                arc through both corners and that point). Positive bulges toward
                the piece interior; negative bulges the other way. With the edge
                selected, arrows show bulge direction; click the opposite arrow
                to flip.
              </p>
              <div className="ls-seam-modal-fields">
                <label className="ls-seam-modal-field">
                  Offset from midpoint (in)
                  <input
                    className="ls-input"
                    type="number"
                    step={0.125}
                    value={edgeArcModal.sagittaStr}
                    onChange={(e) =>
                      setEdgeArcModal((m) =>
                        m
                          ? {
                              ...m,
                              sagittaStr: e.target.value,
                              error: undefined,
                            }
                          : m,
                      )
                    }
                    autoFocus
                  />
                </label>
              </div>
              {edgeArcModal.error ? (
                <p className="ls-seam-modal-inline-error" role="alert">
                  {edgeArcModal.error}
                </p>
              ) : null}
              <div className="ls-seam-modal-actions">
                <button
                  type="button"
                  className="ls-btn ls-btn-secondary"
                  onClick={() => setEdgeArcModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ls-btn ls-btn-primary"
                  onClick={() => {
                    const h = parseFloat(edgeArcModal.sagittaStr);
                    if (!Number.isFinite(h) || Math.abs(h) < 1e-9) {
                      setEdgeArcModal((m) =>
                        m
                          ? {
                              ...m,
                              error: "Enter a non-zero offset in inches.",
                            }
                          : m,
                      );
                      return;
                    }
                    const sel = selectedEdge;
                    const pc = pieces.find((p) => p.id === sel.pieceId);
                    if (!sel || !pc) return;
                    const next = applyArcSagittaToEdge(pc, sel.edgeIndex, h);
                    if (!next) {
                      setEdgeArcModal((m) =>
                        m
                          ? {
                              ...m,
                              error: "Could not apply arc on this edge.",
                            }
                          : m,
                      );
                      return;
                    }
                    onPiecesChange(
                      pieces.map((p) => (p.id === sel.pieceId ? next : p)),
                    );
                    setEdgeArcModal(null);
                  }}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {tool === "polygon" && polyDraft && polyDraft.length > 0 ? (
          <div className="ls-floating-hint">
            Click the first point to close · Enter to finish · Esc to cancel · Click a point
            or line to remove it
          </div>
        ) : null}
        {tool === "orthoDraw" && orthoPoints && orthoPoints.length > 0 ? (
          <div className="ls-floating-hint">
            Click the first point to close · Enter to finish · Esc to cancel · Click a point
            or line to remove it
          </div>
        ) : null}
        {tool === "snapLines" ? (
          <div className="ls-floating-hint ls-floating-hint--subtle">
            {snapPair
              ? "Click a blue handle on the anchor edge (start / center / end), or press Enter for start alignment · Esc to cancel."
              : snapAnchor
                ? "Click a parallel edge on the moving piece."
                : "Click an edge to set the anchor line."}
          </div>
        ) : null}
        {tool === "join" ? (
          <div className="ls-floating-hint ls-floating-hint--subtle">
            {joinPiece1
              ? "Click the other countertop piece that shares a snap-flush edge."
              : "Click the first countertop piece to join."}
          </div>
        ) : null}
        {tool === "cornerRadius" && cornerRadiusConfig && !cornerRadiusModal ? (
          <div className="ls-floating-hint ls-floating-hint--subtle">
            {cornerRadiusFirstEdge
              ? "Click the other edge that shares this corner (next segment around the shape)."
              : "Click two adjacent edges at one corner (convex or inside / re-entrant)."}
          </div>
        ) : null}
        {tool === "chamferCorner" && cornerChamferConfig && !cornerChamferModal ? (
          <div className="ls-floating-hint ls-floating-hint--subtle">
            {cornerChamferFirstEdge
              ? "Click the other adjacent edge at this corner to create the chamfer."
              : "Click two adjacent edges at one corner to cut in a straight chamfer."}
          </div>
        ) : null}
        {tool === "connectCorner" ? (
          <div className="ls-floating-hint ls-floating-hint--subtle">
            {connectFirstEdge
              ? "Click the other edge: same corner (adjacent edges), or skip one edge for a corner cut (arms on each side of the chamfer)."
              : "Clear circular edge radii: two edges meeting at one vertex, or two edges with one edge between them (chamfered corner). Straight chamfers have no arc to clear."}
          </div>
        ) : null}
        {boxZoomMode ? (
          <div className="ls-floating-hint ls-floating-hint--subtle">
            Drag on the plan to frame an area · Esc to cancel
          </div>
        ) : null}
      </div>
    );
  },
);

BlankPlanWorkspace.displayName = "BlankPlanWorkspace";
