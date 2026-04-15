import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  customerDisplayName,
  type CustomerRecord,
  type JobComparisonOptionRecord,
  type JobRecord,
  type LayoutQuoteCustomerRowId,
  type LayoutQuoteSettings,
} from "../../../types/compareQuote";
import { updateJob } from "../../../services/compareQuoteFirestore";
import { createDefaultLayoutState } from "../constants";
import { recomputeDraftSummary } from "../services/persistLayout";
import { uploadJobLayoutSource, uploadJobLayoutSourcePreviewPng } from "../services/layoutStorage";
import { useLayoutStudio } from "../hooks/useLayoutStudio";
import type {
  FaucetEvenHoleBias,
  LayoutPiece,
  LayoutPoint,
  LayoutSlab,
  LayoutStudioMode,
  LShapeOrientationDeg,
  ManualPieceDimensions,
  PiecePlacement,
  PieceSinkCutout,
  SavedOptionLayoutPlacement,
  SavedLayoutStudioState,
  SlabCloneEntry,
  SnapAlignmentMode,
  TraceTool,
} from "../types";
import { layoutSourceKindFromFile, isAcceptedLayoutSourceFile } from "../utils/sourceKind";
import {
  inspectPdfFilePages,
  renderPdfFilePageToDataUrl,
  renderPdfFilePagesToDataUrls,
  renderPdfUrlPageToDataUrl,
} from "../utils/pdfSource";
import { pixelsPerInchFromSegment } from "../utils/calibration";
import { ensurePlacementsForPieces } from "../utils/placements";
import { computeSlabAutoNest } from "../utils/slabAutoNest";
import { applyManualDimensionsToPiece } from "../utils/manualPieces";
import {
  buildStackedPdfPages,
  normalizedSourcePages,
  piecesHaveAnyScale,
  sourcePlanDimensions,
} from "../utils/sourcePages";
import {
  SPLASH_PLAN_OFFSET_IN,
  buildSplashRectanglePoints,
  planDisplayPoints,
  rotatePlanPieceAroundCentroid,
} from "../utils/blankPlanGeometry";
import { boundsOfPoints, normalizeClosedRing } from "../utils/geometry";
import {
  piecePolygonInches,
  planCentroidForSlabPlacement,
  worldDisplayToSlabInches,
} from "../utils/pieceInches";
import { isMiterStripPiece, isPlanStripPiece } from "../utils/pieceRoles";
import { removeCornerFilletsBatch } from "../utils/blankPlanEdgeArc";
import {
  anyPiecesOverlap,
  countertopOverlapsOtherCountertops,
} from "../utils/blankPlanOverlap";
import {
  hasFlushSnapJoinCandidate,
  seamGeometryFromAxisAlignedEdge,
  splitWorldRingAtHorizontalSeam,
  splitWorldRingAtVerticalSeam,
} from "../utils/blankPlanPolygonOps";
import {
  assignSinksToSplitPieces,
  clampSinkCenter,
  isSinkFullyInsidePiece,
  sinkPlacementFromEdgeInCanonical,
  sinkRotationDegFromEdge,
} from "../utils/pieceSinks";
import { defaultNonSplashPieceName } from "../utils/pieceLabels";
import {
  buildSourcePlanEditorFrames,
  planEditorPiecesToSourcePieces,
  sourcePiecesToPlanEditorPieces,
} from "../utils/sourcePlanEditor";
import { collectQuoteReadinessIssues } from "../utils/quoteReadiness";
import { slabsForOption } from "../utils/slabDimensions";
import {
  BlankPlanWorkspace,
  BLANK_VIEW_ZOOM_MAX,
  BLANK_VIEW_ZOOM_MIN,
  blankPlanZoomDisplayPct,
  type BlankPlanWorkspaceHandle,
} from "./BlankPlanWorkspace";
import { ManualLShapeSheet, ManualRectangleSheet } from "./ManualPieceSheets";
import { AddSinkModal } from "./AddSinkModal";
import { PlaceLayoutPreview } from "./PlaceLayoutPreview";
import { PlaceLayoutPreview3D } from "./PlaceLayoutPreview3D";
import { PlaceWorkspace, type PlaceSeamRequest } from "./PlaceWorkspace";
import { DEFAULT_SLAB_THICKNESS_IN, parseThicknessToInches } from "../utils/parseThicknessInches";
import { LayoutQuoteModal } from "./LayoutQuoteModal";
import { QuotePhaseAllMaterialsView } from "./QuotePhaseAllMaterialsView";
import { QuotePhaseView } from "./QuotePhaseView";
import { LayoutQuoteSettingsModal } from "./LayoutQuoteSettingsModal";
import { mergeCustomerExclusions, mergeLayoutQuoteSettings } from "../utils/commercialQuote";
import { StudioEntryHub } from "./StudioEntryHub";
import { UploadProgressRing } from "./UploadProgressRing";
import {
  TraceWorkspace,
  TRACE_VIEW_ZOOM_MAX,
  TRACE_VIEW_ZOOM_MIN,
  traceViewZoomDisplayPct,
} from "./TraceWorkspace";
import {
  IconBack,
  IconDimensions,
  IconPieceList,
  IconPieceLabels,
  IconRedo,
  IconRotateCCW,
  IconRotateCW,
  IconSelectCursor,
  IconToolLShape,
  IconToolOrtho,
  IconToolPolygon,
  IconToolRect,
  IconToolChamfer,
  IconToolConnectCorner,
  IconToolCornerRadius,
  IconToolJoin,
  IconToolSeam,
  IconToolSnapLines,
  IconUndo,
  IconZoomFitSelection,
  IconZoomIn,
  IconFullscreenEnter,
  IconFullscreenExit,
  IconSettings,
  IconZoomMarquee,
  IconZoomOut,
  IconZoomResetView,
  IconAutoNestBird,
} from "./PlanToolbarIcons";
import "../layoutStudio.css";

function formatUploadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

const TRACE_BUTTON_ZOOM_STEP = 0.5;
const BACK_NAV_SAVE_MIN_MS = 3000;
const SOURCE_PLAN_EDITOR_VIEW_ZOOM_MIN = 0.05;
const SOURCE_PLAN_EDITOR_ARRANGE_GAP_IN = 12;
const SOURCE_PLAN_EDITOR_ARRANGE_ROW_MAX_WIDTH_IN = 180;
const CALIBRATION_POPUP_MARGIN_PX = 16;
const CALIBRATION_POPUP_MAX_WIDTH_PX = 360;
const QUOTE_ALL_USED_MATERIALS_SCOPE = "all_used";

function defaultCalibrationPopupPos() {
  if (typeof window === "undefined") {
    return { x: CALIBRATION_POPUP_MARGIN_PX, y: CALIBRATION_POPUP_MARGIN_PX };
  }
  const popupWidth = Math.min(
    CALIBRATION_POPUP_MAX_WIDTH_PX,
    Math.max(220, window.innerWidth - CALIBRATION_POPUP_MARGIN_PX * 2),
  );
  return {
    x: Math.max(
      CALIBRATION_POPUP_MARGIN_PX,
      Math.round(window.innerWidth - popupWidth - CALIBRATION_POPUP_MARGIN_PX),
    ),
    y: Math.max(CALIBRATION_POPUP_MARGIN_PX, Math.round(window.innerHeight * 0.2)),
  };
}

function nextTraceButtonZoomIn(current: number): number {
  const bucket = Math.floor(current / TRACE_BUTTON_ZOOM_STEP + 1e-6);
  return Math.min(TRACE_VIEW_ZOOM_MAX, (bucket + 1) * TRACE_BUTTON_ZOOM_STEP);
}

function nextTraceButtonZoomOut(current: number): number {
  const bucket = Math.ceil(current / TRACE_BUTTON_ZOOM_STEP - 1e-6);
  return Math.max(TRACE_VIEW_ZOOM_MIN, (bucket - 1) * TRACE_BUTTON_ZOOM_STEP);
}

function formatPieceSizeInches(value: number): string {
  return `${(Math.round(value * 10) / 10).toFixed(1)}"`;
}

type PieceSizeSummary = {
  overallLabel: string | null;
  detailLabel: string | null;
  needsScale: boolean;
};

function describePieceSize(
  piece: LayoutPiece,
  pixelsPerInch: number | null,
  allPieces: readonly LayoutPiece[],
  isBlankWorkspace: boolean,
): PieceSizeSummary {
  const localInches = piecePolygonInches(piece, pixelsPerInch, allPieces);
  const bounds = boundsOfPoints(localInches);
  if (!bounds) {
    return {
      overallLabel: null,
      detailLabel: null,
      needsScale: !isBlankWorkspace,
    };
  }
  const widthIn = bounds.maxX - bounds.minX;
  const depthIn = bounds.maxY - bounds.minY;
  let detailLabel: string | null = null;
  if (piece.manualDimensions?.kind === "rectangle") {
    detailLabel = `Rectangle ${formatPieceSizeInches(piece.manualDimensions.widthIn)} x ${formatPieceSizeInches(piece.manualDimensions.depthIn)}`;
  } else if (piece.manualDimensions?.kind === "lShape") {
    detailLabel =
      `Leg A ${formatPieceSizeInches(piece.manualDimensions.legAIn)} · ` +
      `Leg B ${formatPieceSizeInches(piece.manualDimensions.legBIn)} · ` +
      `Depth ${formatPieceSizeInches(piece.manualDimensions.depthIn)}`;
  }
  return {
    overallLabel: `${formatPieceSizeInches(widthIn)} W x ${formatPieceSizeInches(depthIn)} D`,
    detailLabel,
    needsScale: false,
  };
}

function resolvedPieceSourcePageIndex(
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
): number | null {
  if (piece.sourcePageIndex != null) return piece.sourcePageIndex;
  const seen = new Set<string>([piece.id]);
  let parentId = piece.splashMeta?.parentPieceId ?? null;
  while (parentId) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = allPieces.find((candidate) => candidate.id === parentId) ?? null;
    if (!parent) break;
    if (parent.sourcePageIndex != null) return parent.sourcePageIndex;
    parentId = parent.splashMeta?.parentPieceId ?? null;
  }
  return null;
}

function pieceBelongsToSourcePage(
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  pageIndex: number,
  singleSourcePage: boolean,
): boolean {
  const resolvedPageIndex = resolvedPieceSourcePageIndex(piece, allPieces);
  return resolvedPageIndex === pageIndex || (resolvedPageIndex == null && singleSourcePage);
}

function formatPiecePageLabel(
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  isBlankWorkspace: boolean,
  sourcePageCount: number,
  sourcePageNumberByIndex: Record<number, number>,
): string | null {
  if (isBlankWorkspace) return null;
  const resolvedPageIndex = resolvedPieceSourcePageIndex(piece, allPieces);
  if (resolvedPageIndex == null) {
    return sourcePageCount <= 1 ? "Page 1" : "Page —";
  }
  return `Page ${sourcePageNumberByIndex[resolvedPageIndex] ?? resolvedPageIndex + 1}`;
}

function resolvedPieceMaterialOptionId(
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
): string | null {
  if (piece.materialOptionId != null) return piece.materialOptionId;
  const seen = new Set<string>([piece.id]);
  let parentId = piece.splashMeta?.parentPieceId ?? null;
  while (parentId) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = allPieces.find((candidate) => candidate.id === parentId) ?? null;
    if (!parent) break;
    if (parent.materialOptionId != null) return parent.materialOptionId;
    parentId = parent.splashMeta?.parentPieceId ?? null;
  }
  return null;
}

function optionPlacementStateForArea(
  option: JobComparisonOptionRecord,
  areaId?: string | null,
): SavedOptionLayoutPlacement | null {
  return (areaId ? option.layoutAreaStates?.[areaId]?.layoutStudioPlacement ?? null : null) ?? option.layoutStudioPlacement ?? null;
}

function layoutSlabsForOptionPlacement(
  option: JobComparisonOptionRecord,
  slabClones?: readonly SlabCloneEntry[] | null,
): LayoutSlab[] {
  const base = slabsForOption(option);
  if (!base.length || !slabClones?.length) return base;
  const primary = base[0];
  return [
    ...base,
    ...slabClones.map((clone) => ({
      ...primary,
      id: clone.id,
      label: clone.label,
    })),
  ];
}

function resolvedPieceMaterialRoot(
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
): LayoutPiece {
  let current = piece;
  const seen = new Set<string>([piece.id]);
  let parentId = piece.splashMeta?.parentPieceId ?? null;
  while (parentId) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = allPieces.find((candidate) => candidate.id === parentId) ?? null;
    if (!parent) break;
    current = parent;
    parentId = parent.splashMeta?.parentPieceId ?? null;
  }
  return current;
}

function mergePlacementsForPieceIds(
  placements: readonly PiecePlacement[],
  replacements: readonly PiecePlacement[],
  pieceIds: ReadonlySet<string>,
): PiecePlacement[] {
  const replacementsByPieceId = new Map(replacements.map((placement) => [placement.pieceId, placement]));
  return placements.map((placement) =>
    pieceIds.has(placement.pieceId)
      ? replacementsByPieceId.get(placement.pieceId) ?? placement
      : placement,
  );
}

function nextPieceName(pieces: LayoutPiece[], offset = 0): string {
  const n = pieces.filter((piece) => !isPlanStripPiece(piece)).length;
  return defaultNonSplashPieceName(n + offset);
}

function edgeMidpoint(points: LayoutPoint[], edgeIndex: number): LayoutPoint {
  const ring = normalizeClosedRing(points);
  const n = ring.length;
  if (n === 0) return { x: 0, y: 0 };
  const a = ring[((edgeIndex % n) + n) % n]!;
  const b = ring[(((edgeIndex % n) + n) % n + 1) % n]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function splitPlacedPieceAtSeam(args: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
  request: PlaceSeamRequest;
}): { pieces: LayoutPiece[]; placements: PiecePlacement[]; selectedPieceId: string } | null {
  const { pieces, placements, pixelsPerInch, request } = args;
  const targetPiece = pieces.find((piece) => piece.id === request.pieceId);
  if (!targetPiece || isPlanStripPiece(targetPiece)) return null;

  const world = planDisplayPoints(targetPiece, pieces);
  const ring = normalizeClosedRing(world);
  if (ring.length < 2) return null;

  const edgeIndex = ((request.edgeIndex % ring.length) + ring.length) % ring.length;
  const geometry = seamGeometryFromAxisAlignedEdge(world, edgeIndex);
  if (!geometry) return null;

  const dimA = Number(request.dimA);
  const dimB = Number(request.dimB);
  if (!Number.isFinite(dimA) || !Number.isFinite(dimB) || dimA <= 0 || dimB <= 0) {
    return null;
  }

  const seamHint = edgeMidpoint(world, edgeIndex);
  const minDim = 0.125;

  let split: [LayoutPoint[], LayoutPoint[]] | null = null;
  if (geometry.kind === "vertical") {
    const total = geometry.xMax - geometry.xMin;
    if (Math.abs(dimA + dimB - total) > 0.08 || dimA < minDim || dimB < minDim) return null;
    split = splitWorldRingAtVerticalSeam(world, geometry.xMin + dimA, seamHint.y);
  } else {
    const total = geometry.yMax - geometry.yMin;
    if (Math.abs(dimA + dimB - total) > 0.08 || dimA < minDim || dimB < minDim) return null;
    split = splitWorldRingAtHorizontalSeam(world, geometry.yMin + dimA, seamHint.x);
  }
  if (!split) return null;

  const [ringA, ringB] = split;
  const ox = targetPiece.planTransform?.x ?? 0;
  const oy = targetPiece.planTransform?.y ?? 0;
  const localA = ringA.map((point) => ({ x: point.x - ox, y: point.y - oy }));
  const localB = ringB.map((point) => ({ x: point.x - ox, y: point.y - oy }));
  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();

  const existingSinks = targetPiece.sinks ?? [];
  const legacyCount =
    existingSinks.length > 0 ? 0 : Math.max(0, Math.floor(targetPiece.sinkCount || 0));
  const { sinksA, sinksB } =
    existingSinks.length > 0
      ? assignSinksToSplitPieces(existingSinks, ringA, ringB, ox, oy)
      : {
          sinksA: [] as typeof existingSinks,
          sinksB: [] as typeof existingSinks,
        };
  const splitLegacy = legacyCount > 0;
  const sinkCountA = splitLegacy ? Math.floor(legacyCount / 2) : 0;
  const sinkCountB = splitLegacy ? legacyCount - sinkCountA : 0;

  const newA: LayoutPiece = {
    ...targetPiece,
    id: idA,
    name: nextPieceName(pieces),
    points: localA,
    sinkCount: splitLegacy ? sinkCountA : 0,
    sinks: existingSinks.length > 0 ? sinksA : undefined,
    manualDimensions: undefined,
    shapeKind: "polygon",
    edgeTags: undefined,
  };
  const newB: LayoutPiece = {
    ...targetPiece,
    id: idB,
    name: nextPieceName(pieces, 1),
    points: localB,
    sinkCount: splitLegacy ? sinkCountB : 0,
    sinks: existingSinks.length > 0 ? sinksB : undefined,
    manualDimensions: undefined,
    shapeKind: "polygon",
    edgeTags: undefined,
  };

  const nextPieces = pieces
    .filter((piece) => piece.id !== targetPiece.id)
    .concat([newA, newB]);

  if (
    countertopOverlapsOtherCountertops(nextPieces, idA, idB) ||
    countertopOverlapsOtherCountertops(nextPieces, idB, idA)
  ) {
    return null;
  }

  const basePlacements = ensurePlacementsForPieces(pieces, placements);
  const targetPlacement = basePlacements.find((placement) => placement.pieceId === targetPiece.id);
  if (!targetPlacement) return null;

  const makePlacement = (piece: LayoutPiece): PiecePlacement => {
    const nextPlacement: PiecePlacement = {
      ...targetPlacement,
      id: crypto.randomUUID(),
      pieceId: piece.id,
    };
    if (!targetPlacement.placed || !targetPlacement.slabId) return nextPlacement;
    const centroidWorld = planCentroidForSlabPlacement(piece, nextPieces);
    const slabPoint = worldDisplayToSlabInches(
      centroidWorld.x,
      centroidWorld.y,
      targetPiece,
      targetPlacement,
      pixelsPerInch,
      pieces,
    );
    return {
      ...nextPlacement,
      x: slabPoint.x,
      y: slabPoint.y,
    };
  };

  const nextPlacements = basePlacements.flatMap((placement) =>
    placement.pieceId === targetPiece.id
      ? [makePlacement(newA), makePlacement(newB)]
      : [placement]
  );

  return { pieces: nextPieces, placements: nextPlacements, selectedPieceId: idA };
}

type Props = {
  job: JobRecord;
  customer: CustomerRecord | null;
  activeAreaId?: string | null;
  activeAreaName?: string | null;
  options: JobComparisonOptionRecord[];
  activeOption: JobComparisonOptionRecord | null;
  onOptionChange: (optionId: string) => void;
  onRemoveMaterialOption?: (optionId: string) => void;
  onOpenAddMaterials?: () => void;
  ownerUserId: string;
  onBack: () => void | Promise<void>;
  defaultPlanCanvasExpanded?: boolean;
};

export function LayoutStudioScreen({
  job,
  customer,
  activeAreaId,
  activeAreaName,
  options,
  activeOption,
  onOptionChange,
  onRemoveMaterialOption,
  onOpenAddMaterials,
  ownerUserId,
  onBack,
  defaultPlanCanvasExpanded = false,
}: Props) {
  const optionId = activeOption?.id;
  const uploadedPdfFileRef = useRef<{ uploadedAt: string; file: File } | null>(null);
  const { draft, updateDraft, setDraft, save, saveQuotePhase, saveStatus, saveError, layoutSlabs } =
    useLayoutStudio({
      job,
      jobId: job.id,
      areaId: activeAreaId ?? null,
      option: activeOption,
      optionId,
    });
  const [, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<LayoutStudioMode>(() => {
    if (typeof window === "undefined") return "trace";
    const p = new URLSearchParams(window.location.search).get("phase");
    if (p === "quote") return "quote";
    if (p === "place") return "place";
    return "trace";
  });
  const [tool, setTool] = useState<TraceTool>("select");
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [activeSlabId, setActiveSlabId] = useState<string | null>(null);

  const layoutSlabIdsKey = layoutSlabs.map((s) => s.id).join("|");
  useEffect(() => {
    if (!layoutSlabs.length) {
      setActiveSlabId(null);
      return;
    }
    setActiveSlabId((prev) =>
      prev && layoutSlabs.some((s) => s.id === prev) ? prev : layoutSlabs[0]!.id
    );
  }, [optionId, layoutSlabIdsKey, layoutSlabs]);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationStep, setCalibrationStep] = useState<"idle" | "a" | "b">("idle");
  const [calibrationPopupOpen, setCalibrationPopupOpen] = useState(false);
  const [calibrationPopupPos, setCalibrationPopupPos] = useState(() => defaultCalibrationPopupPos());
  const [distanceInput, setDistanceInput] = useState("");
  const [distanceUnit, setDistanceUnit] = useState<"in" | "ft" | "mm" | "cm">("in");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState<"uploading" | "processing">("uploading");
  const [uploadStatusText, setUploadStatusText] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rectSheetOpen, setRectSheetOpen] = useState(false);
  const [lSheetOpen, setLSheetOpen] = useState(false);
  const [showPieceLabels, setShowPieceLabels] = useState(true);
  const [showEdgeDimensions, setShowEdgeDimensions] = useState(false);
  /** Snap lines: Enter commits using this mode; blue handles on-canvas pick start/center/end per click. */
  const snapAlignmentMode: SnapAlignmentMode = "start";
  const [selectedEdge, setSelectedEdge] = useState<{ pieceId: string; edgeIndex: number } | null>(
    null
  );
  /** Select tool: marquee-selected corner-radius fillet edges (blank plan). */
  const [selectedFilletEdges, setSelectedFilletEdges] = useState<
    { pieceId: string; edgeIndex: number }[]
  >([]);
  const selectedFilletEdgesRef = useRef(selectedFilletEdges);
  selectedFilletEdgesRef.current = selectedFilletEdges;
  const [splashModalOpen, setSplashModalOpen] = useState(false);
  const [edgeStripKind, setEdgeStripKind] = useState<"splash" | "miter">("splash");
  const [splashTargetEdge, setSplashTargetEdge] = useState<{
    pieceId: string;
    edgeIndex: number;
  } | null>(null);
  const [splashHeightInput, setSplashHeightInput] = useState("4");
  type LayoutUndoSnap = { pieces: LayoutPiece[]; placements: PiecePlacement[]; slabClones: SlabCloneEntry[] };
  const [undoStack, setUndoStack] = useState<LayoutUndoSnap[]>([]);
  const [redoStack, setRedoStack] = useState<LayoutUndoSnap[]>([]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [quoteGateOpen, setQuoteGateOpen] = useState(false);
  const [quoteGateIssues, setQuoteGateIssues] = useState<{ id: string; message: string }[]>([]);
  const [layoutPreviewModalOpen, setLayoutPreviewModalOpen] = useState(false);
  /** Expanded live layout modal: 2D SVG preview vs 3D extruded view. */
  const [layoutPreviewExpandedMode, setLayoutPreviewExpandedMode] = useState<"2d" | "3d">("2d");
  const [layoutQuoteModalOpen, setLayoutQuoteModalOpen] = useState(false);
  const [layoutQuoteSettingsOpen, setLayoutQuoteSettingsOpen] = useState(false);
  const [addSinkModalOpen, setAddSinkModalOpen] = useState(false);
  /** Edge chosen in the plan before opening the sink modal (blank workspace). */
  const [addSinkEdge, setAddSinkEdge] = useState<{ pieceId: string; edgeIndex: number } | null>(null);
  /** Slab placement vs live preview: stacked (default) or side-by-side. */
  const [placeSplitView, setPlaceSplitView] = useState(true);
  /** Layout tab: constrain slab piece drags to horizontal or vertical only. */
  const [placeOrthoMove, setPlaceOrthoMove] = useState(false);
  /** Layout tab: click red slab edges to split a placed piece with a seam. */
  const [placeSeamMode, setPlaceSeamMode] = useState(false);
  /** Place phase: confirm before removing a duplicate slab instance. */
  const [removeSlabConfirmId, setRemoveSlabConfirmId] = useState<string | null>(null);
  /** Auto nest pieces on the active slab (min gap inches). */
  const [autoNestModalOpen, setAutoNestModalOpen] = useState(false);
  const [autoNestMinGapStr, setAutoNestMinGapStr] = useState("1.5");
  const [autoNestEdgeInsetStr, setAutoNestEdgeInsetStr] = useState("1.5");
  /** In-app feedback for auto nest (replaces browser `alert`). */
  const [autoNestFeedback, setAutoNestFeedback] = useState<{
    title: string;
    lines: string[];
    /** Extra help shown after nest warnings (omitted for simple validation messages). */
    footerNote?: string;
  } | null>(null);
  const blankPlanRef = useRef<BlankPlanWorkspaceHandle | null>(null);
  const [blankViewZoom, setBlankViewZoom] = useState(1);
  const onBlankViewZoomChange = useCallback((z: number) => {
    setBlankViewZoom(z);
  }, []);
  const [traceViewZoom, setTraceViewZoom] = useState(1);
  const [sourceCanvasMode, setSourceCanvasMode] = useState<"trace" | "plan">("trace");
  const [sourcePlanEditorPieces, setSourcePlanEditorPieces] = useState<LayoutPiece[]>([]);
  const skipSourcePlanEditorDraftSyncRef = useRef(false);
  const onTraceViewZoomChange = useCallback((z: number) => {
    setTraceViewZoom(z);
  }, []);
  const stepTraceZoomIn = useCallback(() => setTraceViewZoom((z) => nextTraceButtonZoomIn(z)), []);
  const stepTraceZoomOut = useCallback(() => setTraceViewZoom((z) => nextTraceButtonZoomOut(z)), []);
  const [traceResetViewTick, setTraceResetViewTick] = useState(0);
  const [traceZoomToSelectedTick, setTraceZoomToSelectedTick] = useState(0);
  const [activeSourcePageIndex, setActiveSourcePageIndex] = useState(0);
  const [activePdfPageImageUrl, setActivePdfPageImageUrl] = useState<string | null>(null);
  const [pdfPageThumbUrls, setPdfPageThumbUrls] = useState<Record<number, string>>({});
  const [pdfRenderFailedPages, setPdfRenderFailedPages] = useState<Record<number, true>>({});
  const [pdfRenderBusy, setPdfRenderBusy] = useState(false);
  const [pdfRenderStatusText, setPdfRenderStatusText] = useState<string | null>(null);
  const [backNavigationPending, setBackNavigationPending] = useState(false);
  const [backNavigationStartedAt, setBackNavigationStartedAt] = useState<number | null>(null);
  const [backNavigationProgress, setBackNavigationProgress] = useState<number | null>(null);
  const [phaseTransitionPending, setPhaseTransitionPending] = useState<LayoutStudioMode | null>(null);
  const calibrationPopupDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [inspectorPanelPos, setInspectorPanelPos] = useState({ x: 13, y: 76 });
  const inspectorPanelDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [pieceListOpen, setPieceListOpen] = useState(false);
  const [pieceListPanelPos, setPieceListPanelPos] = useState({ x: 14, y: 14 });
  const pieceListPanelDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [materialMenuOpen, setMaterialMenuOpen] = useState(false);
  const materialMenuRef = useRef<HTMLDivElement | null>(null);
  const materialMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const materialMenuPopoverRef = useRef<HTMLDivElement | null>(null);
  const [materialMenuPopoverStyle, setMaterialMenuPopoverStyle] = useState<CSSProperties | null>(null);
  const [quoteMaterialScope, setQuoteMaterialScope] = useState<"active" | "all_used">("active");
  const [planBoxZoomActive, setPlanBoxZoomActive] = useState(false);
  /** Blank plan: overlay full-screen drawing (toolbar + canvas + inspector). */
  const [planCanvasExpanded, setPlanCanvasExpanded] = useState(
    () => defaultPlanCanvasExpanded && mode === "trace"
  );
  const placeSlabRegionRef = useRef<HTMLDivElement | null>(null);
  const [placeSlabRegionViewportHeight, setPlaceSlabRegionViewportHeight] = useState<number | null>(
    null,
  );
  const placeSplitContainerRef = useRef<HTMLDivElement | null>(null);
  const [placeSplitLeftPct, setPlaceSplitLeftPct] = useState(48);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const entryUploadInputRef = useRef<HTMLInputElement | null>(null);
  const pendingDuplicateFitRef = useRef(false);

  const handleBack = useCallback(async () => {
    if (backNavigationPending) return;
    setBackNavigationPending(true);
    const startedAt = Date.now();
    setBackNavigationStartedAt(startedAt);
    setBackNavigationProgress(0);
    let navigated = false;
    try {
      const ok = await save(draftRef.current);
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = Math.max(0, BACK_NAV_SAVE_MIN_MS - elapsedMs);
      if (remainingMs > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMs));
      }
      if (!ok) return;
      setBackNavigationProgress(100);
      await onBack();
      navigated = true;
    } finally {
      if (!navigated) {
        setBackNavigationPending(false);
        setBackNavigationStartedAt(null);
        setBackNavigationProgress(null);
      }
    }
  }, [backNavigationPending, onBack, save]);

  useEffect(() => {
    if (!backNavigationPending || backNavigationStartedAt == null) {
      setBackNavigationStartedAt(null);
      setBackNavigationProgress(null);
      return;
    }
    const updateProgress = () => {
      const elapsedMs = Date.now() - backNavigationStartedAt;
      const nextProgress = Math.min(99, Math.max(0, Math.round((elapsedMs / BACK_NAV_SAVE_MIN_MS) * 100)));
      setBackNavigationProgress((prev) => (prev == null ? nextProgress : Math.max(prev, nextProgress)));
    };
    updateProgress();
    const intervalId = window.setInterval(updateProgress, 50);
    return () => window.clearInterval(intervalId);
  }, [backNavigationPending, backNavigationStartedAt]);

  const selectMaterialOption = useCallback(
    async (nextId: string) => {
      if (nextId === activeOption?.id) {
        setMaterialMenuOpen(false);
        return;
      }
      const ok = await save(draftRef.current);
      if (!ok) return;
      setMaterialMenuOpen(false);
      onOptionChange(nextId);
    },
    [activeOption?.id, onOptionChange, save],
  );

  const workspaceKind = useMemo((): "source" | "blank" => {
    if (draft.workspaceKind === "blank" || draft.workspaceKind === "source") return draft.workspaceKind;
    if (draft.source) return "source";
    return "blank";
  }, [draft.workspaceKind, draft.source]);

  const showEntryHub = workspaceKind === undefined;

  const mergedQuoteSettings = useMemo(() => mergeLayoutQuoteSettings(job), [job]);

  const saveLayoutQuoteSettings = useCallback(
    async (next: LayoutQuoteSettings) => {
      await updateJob(job.id, { layoutQuoteSettings: next });
    },
    [job.id]
  );

  const mergedCustomerExclusions = useMemo(() => mergeCustomerExclusions(job), [job]);

  const setCustomerExclusion = useCallback(
    async (rowId: LayoutQuoteCustomerRowId, excluded: boolean) => {
      await updateJob(job.id, {
        layoutQuoteCustomerExclusions: {
          ...mergedCustomerExclusions,
          [rowId]: excluded,
        },
      });
    },
    [job.id, mergedCustomerExclusions]
  );

  const sourcePages = useMemo(
    () => normalizedSourcePages(draft.source, draft.calibration),
    [draft.calibration, draft.source],
  );
  const sourcePagesKey = useMemo(
    () =>
      sourcePages
        .map(
          (page) =>
            `${page.index}:${page.pageNumber}:${page.originX}:${page.originY}:${page.previewImageUrl ?? ""}:${page.previewStoragePath ?? ""}`,
        )
        .join("|"),
    [sourcePages],
  );
  const sourcePageNumberByIndex = useMemo(
    () => Object.fromEntries(sourcePages.map((page) => [page.index, page.pageNumber])),
    [sourcePages],
  );
  const activeSourcePage = useMemo(
    () => sourcePages.find((page) => page.index === activeSourcePageIndex) ?? sourcePages[0] ?? null,
    [activeSourcePageIndex, sourcePages],
  );
  const activeCalibration = activeSourcePage?.calibration ?? draft.calibration;
  const sourceDims = useMemo(
    () => sourcePlanDimensions(draft.source, draft.calibration),
    [draft.calibration, draft.source],
  );
  const activeTraceBounds = useMemo(
    () =>
      activeSourcePage
        ? {
            minX: activeSourcePage.originX,
            minY: activeSourcePage.originY,
            width: activeSourcePage.widthPx,
            height: activeSourcePage.heightPx,
          }
        : sourceDims.widthPx > 0 && sourceDims.heightPx > 0
          ? {
              minX: 0,
              minY: 0,
              width: sourceDims.widthPx,
              height: sourceDims.heightPx,
            }
          : null,
    [activeSourcePage, sourceDims.heightPx, sourceDims.widthPx],
  );
  const displayUrl =
    draft.source?.kind === "pdf" ? activePdfPageImageUrl : draft.source?.fileUrl ?? null;
  const isPdfSource = false;
  const isBlankWorkspace = workspaceKind === "blank";
  const activeSessionPdfFile =
    draft.source?.kind === "pdf" && uploadedPdfFileRef.current?.uploadedAt === draft.source.uploadedAt
      ? uploadedPdfFileRef.current.file
      : null;
  const pdfSourceStoragePath = draft.source?.kind === "pdf" ? draft.source.fileStoragePath ?? null : null;
  const showSourceOnPlanCanvas = !isBlankWorkspace && sourceCanvasMode === "trace";
  const usesBlankPlanCanvas = isBlankWorkspace || sourceCanvasMode === "plan";
  const sourcePlanEditorActive = !isBlankWorkspace && sourceCanvasMode === "plan";
  const planCanvasDisplayUrl = showSourceOnPlanCanvas ? displayUrl : null;
  const planCanvasBounds = showSourceOnPlanCanvas
    ? activeTraceBounds
    : sourceDims.widthPx > 0 && sourceDims.heightPx > 0
      ? {
          minX: 0,
          minY: 0,
          width: sourceDims.widthPx,
          height: sourceDims.heightPx,
        }
      : activeTraceBounds;
  const sourcePlanEditorFrames = useMemo(
    () => buildSourcePlanEditorFrames(sourcePages, draft.calibration.pixelsPerInch),
    [draft.calibration.pixelsPerInch, sourcePages],
  );
  const sourcePlanEditorDefaultPageIndex = activeSourcePage?.index ?? sourcePages[0]?.index ?? 0;
  const sourcePlanEditorDisplayPieces = useMemo(
    () =>
      sourcePiecesToPlanEditorPieces(
        draft.pieces,
        sourcePlanEditorFrames,
        sourcePlanEditorDefaultPageIndex,
        draft.calibration.pixelsPerInch,
      ),
    [
      draft.calibration.pixelsPerInch,
      draft.pieces,
      sourcePlanEditorDefaultPageIndex,
      sourcePlanEditorFrames,
    ],
  );
  const traceSourcePageIndex = activeSourcePage?.index ?? sourcePages[0]?.index ?? 0;
  const tracePagePieces = useMemo(() => {
    if (isBlankWorkspace) return draft.pieces;
    const singleSourcePage = sourcePages.length <= 1;
    return draft.pieces.filter((piece) =>
      pieceBelongsToSourcePage(piece, draft.pieces, traceSourcePageIndex, singleSourcePage),
    );
  }, [draft.pieces, isBlankWorkspace, sourcePages.length, traceSourcePageIndex]);
  const pieceCountBySourcePageIndex = useMemo(() => {
    const counts = new Map<number, number>();
    const singleSourcePage = sourcePages.length <= 1;
    for (const page of sourcePages) {
      counts.set(
        page.index,
        draft.pieces.filter((piece) =>
          pieceBelongsToSourcePage(piece, draft.pieces, page.index, singleSourcePage),
        ).length,
      );
    }
    return counts;
  }, [draft.pieces, sourcePages]);
  const traceSelectedPieceId = tracePagePieces.some((piece) => piece.id === selectedPieceId) ? selectedPieceId : null;
  const planCanvasPieces = sourcePlanEditorActive
    ? sourcePlanEditorPieces.length > 0 || draft.pieces.length === 0
      ? sourcePlanEditorPieces
      : sourcePlanEditorDisplayPieces
    : draft.pieces;
  const activeMaterialPieceIds = useMemo(() => {
    if (!activeOption?.id) {
      return new Set(draft.pieces.map((piece) => piece.id));
    }
    return new Set(
      draft.pieces
        .filter((piece) => resolvedPieceMaterialOptionId(piece, draft.pieces) === activeOption.id)
        .map((piece) => piece.id),
    );
  }, [activeOption?.id, draft.pieces]);
  const materialPieceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const option of options) counts.set(option.id, 0);
    for (const piece of draft.pieces) {
      const optionId = resolvedPieceMaterialOptionId(piece, draft.pieces);
      if (!optionId) continue;
      counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
    }
    return counts;
  }, [draft.pieces, options]);
  const usedMaterialOptions = useMemo(
    () => options.filter((option) => (materialPieceCounts.get(option.id) ?? 0) > 0),
    [materialPieceCounts, options],
  );
  const canQuoteAllUsedMaterials = usedMaterialOptions.length > 1;
  const totalUsedMaterialPieceCount = useMemo(
    () => usedMaterialOptions.reduce((sum, option) => sum + (materialPieceCounts.get(option.id) ?? 0), 0),
    [materialPieceCounts, usedMaterialOptions],
  );
  const quoteShowingAllUsedMaterials = mode === "quote" && quoteMaterialScope === QUOTE_ALL_USED_MATERIALS_SCOPE;
  const activeMaterialPlacements = useMemo(
    () => draft.placements.filter((placement) => activeMaterialPieceIds.has(placement.pieceId)),
    [activeMaterialPieceIds, draft.placements],
  );
  const placeVisiblePieces = useMemo(
    () => draft.pieces.filter((piece) => activeMaterialPieceIds.has(piece.id)),
    [activeMaterialPieceIds, draft.pieces],
  );
  const placeSelectedPieceId =
    selectedPieceId != null && activeMaterialPieceIds.has(selectedPieceId) ? selectedPieceId : null;
  const layoutPreviewUsesPlanSpace =
    isBlankWorkspace || piecesHaveAnyScale(placeVisiblePieces, draft.calibration.pixelsPerInch);
  const layoutPreviewWorkspaceKind: "blank" | "source" = layoutPreviewUsesPlanSpace ? "blank" : "source";
  const layoutPreviewPieces = layoutPreviewUsesPlanSpace
    ? isBlankWorkspace
      ? draft.pieces
      : sourcePlanEditorDisplayPieces
    : draft.pieces;
  const layoutPreviewVisiblePieces = useMemo(
    () => layoutPreviewPieces.filter((piece) => activeMaterialPieceIds.has(piece.id)),
    [activeMaterialPieceIds, layoutPreviewPieces],
  );
  const quoteAllMaterialsSections = useMemo(
    () =>
      usedMaterialOptions
        .map((option) => {
          const pieces = draft.pieces.filter((piece) => resolvedPieceMaterialOptionId(piece, draft.pieces) === option.id);
          if (!pieces.length) return null;
          const pieceIds = new Set(pieces.map((piece) => piece.id));
          const previewUsesPlanSpace =
            isBlankWorkspace || piecesHaveAnyScale(pieces, draft.calibration.pixelsPerInch);
          const previewWorkspaceKind: "blank" | "source" = previewUsesPlanSpace ? "blank" : "source";
          const previewSourcePieces = previewUsesPlanSpace
            ? isBlankWorkspace
              ? draft.pieces
              : sourcePlanEditorDisplayPieces
            : draft.pieces;
          const placementState =
            option.id === activeOption?.id
              ? {
                  placements: draft.placements,
                  slabClones: draft.slabClones,
                  preview: draft.preview,
                  updatedAt: draft.updatedAt,
                }
              : optionPlacementStateForArea(option, activeAreaId);
          const slabs =
            option.id === activeOption?.id
              ? layoutSlabs
              : layoutSlabsForOptionPlacement(option, placementState?.slabClones ?? null);
          const filteredPlacements = (placementState?.placements ?? []).filter((placement) => pieceIds.has(placement.pieceId));
          const sectionDraft = recomputeDraftSummary(
            {
              ...draft,
              pieces,
              placements: filteredPlacements,
              slabClones: placementState?.slabClones ?? [],
              preview: placementState?.preview ?? {},
            },
            option,
            slabs,
          );
          return {
            option,
            draft: sectionDraft,
            pieces: sectionDraft.pieces,
            placements: sectionDraft.placements,
            slabs,
            previewWorkspaceKind,
            previewPieces: previewSourcePieces.filter((piece) => pieceIds.has(piece.id)),
          };
        })
        .filter((section): section is NonNullable<typeof section> => section != null),
    [activeAreaId, activeOption?.id, draft, isBlankWorkspace, layoutSlabs, sourcePlanEditorDisplayPieces, usedMaterialOptions],
  );

  useEffect(() => {
    if (quoteMaterialScope === QUOTE_ALL_USED_MATERIALS_SCOPE && !canQuoteAllUsedMaterials) {
      setQuoteMaterialScope("active");
    }
  }, [canQuoteAllUsedMaterials, quoteMaterialScope]);
  const onActiveMaterialPlacementsChange = useCallback(
    (nextPlacements: PiecePlacement[]) => {
      updateDraft((d) => ({
        ...d,
        placements: mergePlacementsForPieceIds(d.placements, nextPlacements, activeMaterialPieceIds),
      }));
    },
    [activeMaterialPieceIds, updateDraft],
  );

  useEffect(() => {
    setActiveSourcePageIndex((prev) =>
      sourcePages.some((page) => page.index === prev) ? prev : (sourcePages[0]?.index ?? 0),
    );
  }, [sourcePagesKey, sourcePages]);

  useEffect(() => {
    if (!sourcePlanEditorActive) {
      setSourcePlanEditorPieces([]);
      skipSourcePlanEditorDraftSyncRef.current = false;
      return;
    }
    if (skipSourcePlanEditorDraftSyncRef.current) {
      skipSourcePlanEditorDraftSyncRef.current = false;
      return;
    }
    setSourcePlanEditorPieces(sourcePlanEditorDisplayPieces);
  }, [
    draft.calibration.pixelsPerInch,
    draft.pieces,
    sourcePlanEditorDisplayPieces,
    sourcePlanEditorActive,
    sourcePlanEditorDefaultPageIndex,
    sourcePlanEditorFrames,
  ]);

  useEffect(() => {
    setPdfRenderFailedPages({});
  }, [draft.source?.fileUrl, draft.source?.uploadedAt, pdfSourceStoragePath]);

  useEffect(() => {
    if (draft.source?.kind !== "pdf" || !activeSourcePage) {
      setActivePdfPageImageUrl(null);
      setPdfRenderBusy(false);
      setPdfRenderStatusText(null);
      return;
    }
    let cancelled = false;
    const persistedPreviewUrl =
      activeSourcePage.previewImageUrl ??
      (activeSourcePage.index === 0 ? draft.source.previewImageUrl ?? null : null);
    if (persistedPreviewUrl) {
      setActivePdfPageImageUrl(persistedPreviewUrl);
      setPdfRenderBusy(false);
      setPdfRenderStatusText(null);
      return () => {
        cancelled = true;
      };
    }
    if (!draft.source.fileUrl) {
      setActivePdfPageImageUrl(null);
      setPdfRenderBusy(false);
      setPdfRenderStatusText(null);
      return () => {
        cancelled = true;
      };
    }
    const cachedPageImage = pdfPageThumbUrls[activeSourcePage.index];
    if (cachedPageImage) {
      setActivePdfPageImageUrl(cachedPageImage);
      setPdfRenderBusy(false);
      setPdfRenderStatusText(null);
      return () => {
        cancelled = true;
      };
    }
    if (pdfRenderFailedPages[activeSourcePage.index]) {
      setActivePdfPageImageUrl(null);
      setPdfRenderBusy(false);
      setPdfRenderStatusText(null);
      return () => {
        cancelled = true;
      };
    }
    setPdfRenderBusy(true);
    setPdfRenderStatusText(`Rendering page ${activeSourcePage.pageNumber}...`);
    setActivePdfPageImageUrl(null);
    const renderPromise = activeSessionPdfFile
      ? renderPdfFilePageToDataUrl(activeSessionPdfFile, activeSourcePage.pageNumber, 2).then(
          ({ dataUrl, width, height }) => ({ dataUrl, width, height }),
        )
      : renderPdfUrlPageToDataUrl(draft.source.fileUrl, activeSourcePage.pageNumber, 2, {
          storagePath: pdfSourceStoragePath,
        });
    void renderPromise
      .then(({ dataUrl }) => {
        if (!cancelled) {
          setActivePdfPageImageUrl(dataUrl);
          setPdfPageThumbUrls((prev) =>
            prev[activeSourcePage.index] ? prev : { ...prev, [activeSourcePage.index]: dataUrl },
          );
          setPdfRenderBusy(false);
          setPdfRenderStatusText(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setActivePdfPageImageUrl(null);
          setPdfRenderBusy(false);
          setPdfRenderStatusText(null);
          setPdfRenderFailedPages((prev) =>
            prev[activeSourcePage.index] ? prev : { ...prev, [activeSourcePage.index]: true },
          );
          setUploadError(
            err instanceof Error
              ? `Could not render PDF page ${activeSourcePage.pageNumber}: ${err.message}. If this page was saved without a preview image, re-upload the PDF once to regenerate it.`
              : `Could not render PDF page ${activeSourcePage.pageNumber}. If this page was saved without a preview image, re-upload the PDF once to regenerate it.`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeSessionPdfFile,
    activeSourcePage,
    draft.source?.fileUrl,
    draft.source?.kind,
    draft.source?.previewImageUrl,
    pdfRenderFailedPages,
    pdfPageThumbUrls,
    pdfSourceStoragePath,
  ]);

  useEffect(() => {
    const pdfFileUrl = draft.source?.kind === "pdf" ? draft.source.fileUrl : null;
    if ((!pdfFileUrl && !activeSessionPdfFile) || sourcePages.length <= 1) {
      setPdfPageThumbUrls((prev) => (Object.keys(prev).length > 0 ? {} : prev));
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const page of sourcePages) {
        if (cancelled) return;
        const persistedPreviewUrl =
          page.previewImageUrl ?? (page.index === 0 ? draft.source?.previewImageUrl ?? null : null);
        if (persistedPreviewUrl) {
          setPdfPageThumbUrls((prev) =>
            prev[page.index] ? prev : { ...prev, [page.index]: persistedPreviewUrl },
          );
          continue;
        }
        if (pdfRenderFailedPages[page.index]) continue;
        if (pdfPageThumbUrls[page.index]) continue;
        try {
          const { dataUrl } = activeSessionPdfFile
            ? await renderPdfFilePageToDataUrl(activeSessionPdfFile, page.pageNumber, 0.4)
            : await renderPdfUrlPageToDataUrl(pdfFileUrl!, page.pageNumber, 0.4, {
                storagePath: pdfSourceStoragePath,
              });
          if (cancelled) return;
          setPdfPageThumbUrls((prev) =>
            prev[page.index] ? prev : { ...prev, [page.index]: dataUrl },
          );
        } catch {
          if (cancelled) return;
          setPdfRenderFailedPages((prev) => (prev[page.index] ? prev : { ...prev, [page.index]: true }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeSessionPdfFile,
    draft.source?.fileUrl,
    draft.source?.kind,
    draft.source?.previewImageUrl,
    pdfRenderFailedPages,
    pdfPageThumbUrls,
    pdfSourceStoragePath,
    sourcePages,
    sourcePagesKey,
  ]);

  const goToSourcePage = useCallback(
    (pageIndex: number) => {
      const nextPage = sourcePages.find((page) => page.index === pageIndex);
      if (!nextPage || nextPage.index === activeSourcePage?.index) return;
      const selectedPiece =
        selectedPieceId != null
          ? draft.pieces.find((piece) => piece.id === selectedPieceId)
          : null;
      const selectedPiecePageIndex =
        selectedPiece != null ? resolvedPieceSourcePageIndex(selectedPiece, draft.pieces) : null;
      if (
        selectedPiece &&
        selectedPiecePageIndex != null &&
        selectedPiecePageIndex !== nextPage.index
      ) {
        setSelectedPieceId(null);
      }
      setActiveSourcePageIndex(nextPage.index);
      setTraceViewZoom(1);
      setPlanBoxZoomActive(false);
      setTraceResetViewTick((t) => t + 1);
    },
    [activeSourcePage?.index, draft.pieces, selectedPieceId, sourcePages],
  );
  const switchSourceCanvasMode = useCallback((nextMode: "trace" | "plan") => {
    setSourceCanvasMode(nextMode);
    setPlanBoxZoomActive(false);
    if (nextMode === "trace") {
      setTraceViewZoom(1);
      setTraceResetViewTick((t) => t + 1);
      return;
    }
    setPlanFitAllPiecesTick((t) => t + 1);
  }, []);

  const activeSourcePagePos = useMemo(
    () => sourcePages.findIndex((page) => page.index === activeSourcePage?.index),
    [activeSourcePage?.index, sourcePages],
  );

  const startBlankLayout = () => {
    setUndoStack([]);
    setRedoStack([]);
    uploadedPdfFileRef.current = null;
    setActiveSourcePageIndex(0);
    setActivePdfPageImageUrl(null);
    setPdfPageThumbUrls({});
    setPdfRenderBusy(false);
    setPdfRenderStatusText(null);
    setSourcePlanEditorPieces([]);
    skipSourcePlanEditorDraftSyncRef.current = false;
    setSourceCanvasMode("trace");
    setTraceViewZoom(1);
    setTraceResetViewTick((t) => t + 1);
    setTraceZoomToSelectedTick(0);
    setPlanBoxZoomActive(false);
    setSelectedEdge(null);
    setSelectedFilletEdges([]);
    updateDraft(() => ({
      ...createDefaultLayoutState(),
      workspaceKind: "blank",
      calibration: {
        isCalibrated: true,
        unit: "in",
        pointA: null,
        pointB: null,
        realDistance: null,
        pixelsPerInch: 1,
      },
    }));
    setTool("select");
  };

  const updateDraftWithUndo = useCallback(
    (fn: (d: SavedLayoutStudioState) => SavedLayoutStudioState) => {
      updateDraft((d) => {
        setRedoStack([]);
        setUndoStack((prev) => [
          ...prev.slice(-49),
          {
            pieces: structuredClone(d.pieces),
            placements: structuredClone(d.placements),
            slabClones: structuredClone(d.slabClones ?? []),
          },
        ]);
        return fn(d);
      });
    },
    [updateDraft]
  );

  const patchActiveSourcePage = useCallback(
    (
      d: SavedLayoutStudioState,
      updater: (
        page: NonNullable<ReturnType<typeof normalizedSourcePages>[number]>,
      ) => NonNullable<ReturnType<typeof normalizedSourcePages>[number]>,
    ): SavedLayoutStudioState => {
      if (!d.source) return d;
      const pages = normalizedSourcePages(d.source, d.calibration);
      if (pages.length === 0) return d;
      const targetIndex =
        pages.find((page) => page.index === activeSourcePageIndex)?.index ?? pages[0]!.index;
      const nextPages = pages.map((page) =>
        page.index === targetIndex ? updater(page) : page,
      );
      const dims = sourcePlanDimensions({ ...d.source, pages: nextPages }, d.calibration);
      const nextCalibration =
        nextPages.find((page) => page.index === targetIndex)?.calibration ?? d.calibration;
      return {
        ...d,
        source: {
          ...d.source,
          pages: nextPages,
          sourceWidthPx: dims.widthPx,
          sourceHeightPx: dims.heightPx,
        },
        calibration: nextCalibration,
      };
    },
    [activeSourcePageIndex],
  );

  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const snap = s[s.length - 1];
      const cur = draftRef.current;
      setRedoStack((r) => [
        ...r.slice(-49),
        {
          pieces: structuredClone(cur.pieces),
          placements: structuredClone(cur.placements),
          slabClones: structuredClone(cur.slabClones ?? []),
        },
      ]);
      setDraft({
        ...cur,
        pieces: snap.pieces,
        placements: snap.placements,
        slabClones: snap.slabClones ?? [],
      });
      return s.slice(0, -1);
    });
  }, [setDraft]);

  const redo = useCallback(() => {
    setRedoStack((s) => {
      if (s.length === 0) return s;
      const snap = s[s.length - 1];
      const cur = draftRef.current;
      setUndoStack((u) => [
        ...u.slice(-49),
        {
          pieces: structuredClone(cur.pieces),
          placements: structuredClone(cur.placements),
          slabClones: structuredClone(cur.slabClones ?? []),
        },
      ]);
      setDraft({
        ...cur,
        pieces: snap.pieces,
        placements: snap.placements,
        slabClones: snap.slabClones ?? [],
      });
      return s.slice(0, -1);
    });
  }, [setDraft]);

  /** One undo snapshot before a continuous drag (piece / vertex); live moves skip the undo stack. */
  const pushUndoSnapshot = useCallback(() => {
    setRedoStack([]);
    setUndoStack((prev) => [
      ...prev.slice(-49),
      {
        pieces: structuredClone(draftRef.current.pieces),
        placements: structuredClone(draftRef.current.placements),
        slabClones: structuredClone(draftRef.current.slabClones ?? []),
      },
    ]);
  }, []);

  const onPiecesChangeLive = useCallback(
    (pieces: LayoutPiece[]) => {
      updateDraft((d) => ({ ...d, pieces }));
    },
    [updateDraft]
  );

  const commitNewPiece = (piece: LayoutPiece) => {
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: [...d.pieces, piece],
      placements: [
        ...d.placements,
        {
          id: crypto.randomUUID(),
          pieceId: piece.id,
          slabId: null,
          x: 0,
          y: 0,
          rotation: 0,
          placed: false,
        },
      ],
    }));
    setSelectedPieceId(piece.id);
    setTool("select");
  };

  const pieceStaggerIn = draft.pieces.length * 6;

  useEffect(() => {
    const map: Record<LayoutStudioMode, string> = { trace: "plan", place: "place", quote: "quote" };
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("phase", map[mode]);
      return next;
    }, { replace: true });
  }, [mode, setSearchParams]);

  const prevModeForPlanFitRef = useRef<LayoutStudioMode | null>(null);
  const [planFitAllPiecesTick, setPlanFitAllPiecesTick] = useState(0);
  /** One bump when blank Plan first shows with pieces (mirrors Reset view path via fitAllPiecesSignal). */
  const planBlankInitialFitDoneRef = useRef(false);

  useEffect(() => {
    const prev = prevModeForPlanFitRef.current;
    prevModeForPlanFitRef.current = mode;
    if (prev !== null && mode === "trace" && prev !== "trace") {
      setPlanFitAllPiecesTick((t) => t + 1);
    }
  }, [mode]);

  useLayoutEffect(() => {
    if (!usesBlankPlanCanvas || mode !== "trace") {
      planBlankInitialFitDoneRef.current = false;
      return;
    }
    if (planCanvasPieces.length === 0) {
      planBlankInitialFitDoneRef.current = false;
      return;
    }
    if (planBlankInitialFitDoneRef.current) return;
    planBlankInitialFitDoneRef.current = true;
    setPlanFitAllPiecesTick((t) => t + 1);
  }, [mode, planCanvasPieces.length, usesBlankPlanCanvas]);

  useLayoutEffect(() => {
    if (!pendingDuplicateFitRef.current) return;
    if (!usesBlankPlanCanvas || mode !== "trace") {
      pendingDuplicateFitRef.current = false;
      return;
    }
    pendingDuplicateFitRef.current = false;
    blankPlanRef.current?.fitAllPiecesInView();
  }, [mode, planCanvasPieces.length, usesBlankPlanCanvas]);

  useEffect(() => {
    if (mode !== "place") setLayoutPreviewModalOpen(false);
  }, [mode]);

  useEffect(() => {
    if (mode !== "place") setPlaceSeamMode(false);
  }, [mode]);

  useEffect(() => {
    if (!layoutPreviewModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayoutPreviewModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [layoutPreviewModalOpen]);

  useEffect(() => {
    if (!layoutPreviewModalOpen) setLayoutPreviewExpandedMode("2d");
  }, [layoutPreviewModalOpen]);

  const slabThicknessInForPreview = useMemo(
    () => parseThicknessToInches(activeOption?.thickness) ?? DEFAULT_SLAB_THICKNESS_IN,
    [activeOption?.thickness]
  );

  const activeMaterialQuoteDraft = useMemo(
    () =>
      recomputeDraftSummary(
        {
          ...draft,
          pieces: placeVisiblePieces,
          placements: activeMaterialPlacements,
        },
        activeOption,
        layoutSlabs,
      ),
    [activeMaterialPlacements, activeOption, draft, layoutSlabs, placeVisiblePieces],
  );

  const executeQuoteTransition = useCallback(async () => {
    setPhaseTransitionPending("quote");
    try {
      const ok = await saveQuotePhase();
      if (!ok) return;
      setMode("quote");
      setQuoteGateOpen(false);
      setQuoteGateIssues([]);
    } finally {
      setPhaseTransitionPending(null);
    }
  }, [saveQuotePhase]);

  const beginQuoteTransition = useCallback(() => {
    if (showEntryHub) return;
    if (!activeOption) return;
    const issues = collectQuoteReadinessIssues({
      draft: activeMaterialQuoteDraft,
      workspaceKind,
      slabsLength: layoutSlabs.length,
      option: activeOption,
    });
    if (issues.length > 0) {
      setQuoteGateIssues(issues);
      setQuoteGateOpen(true);
      return;
    }
    void executeQuoteTransition().catch(() => {});
  }, [
    activeMaterialQuoteDraft,
    executeQuoteTransition,
    activeOption,
    showEntryHub,
    layoutSlabs.length,
    workspaceKind,
  ]);

  const handleModeChange = useCallback(
    (m: LayoutStudioMode) => {
      if (m === mode || phaseTransitionPending) return;
      if (m === "quote") {
        beginQuoteTransition();
        return;
      }
      void (async () => {
        setPhaseTransitionPending(m);
        try {
          if (!showEntryHub) {
            const ok = await save(draftRef.current);
            if (!ok) return;
          }
          setMode(m);
          if (m === "place" && layoutSlabs.length) {
            const slab = layoutSlabs[0];
            setActiveSlabId((prev) => prev ?? slab.id);
          }
        } finally {
          setPhaseTransitionPending(null);
        }
      })();
    },
    [mode, phaseTransitionPending, beginQuoteTransition, showEntryHub, save, layoutSlabs]
  );

  /** Default slab centroid position (stagger) — matches prior auto-place spacing. */
  const defaultSlabPlacementCoords = useCallback(
    (slab: { widthIn: number; heightIn: number }, pieceIndex: number) => ({
      x: slab.widthIn * (0.28 + (pieceIndex % 5) * 0.06),
      y: slab.heightIn * (0.28 + Math.floor(pieceIndex / 5) * 0.06),
    }),
    []
  );

  const placePieceFromLivePreview = useCallback(
    (pieceId: string) => {
      if (!layoutSlabs.length) return;

      /** Primary slab id is per material option (`${option.id}-slab-0`); stale UI state can reference another option’s id. */
      const resolveTargetSlab = (candidateId: string | null | undefined): LayoutSlab | null => {
        if (candidateId && layoutSlabs.some((s) => s.id === candidateId)) {
          return layoutSlabs.find((s) => s.id === candidateId) ?? null;
        }
        return layoutSlabs[0] ?? null;
      };

      const slab = resolveTargetSlab(activeSlabId);
      if (!slab) return;
      const slabId = slab.id;

      const cur = draftRef.current;
      const placements = ensurePlacementsForPieces(cur.pieces, cur.placements);
      const pl = placements.find((p) => p.pieceId === pieceId);

      /** Only short-circuit when this piece is already on a slab that exists for the current option. */
      if (
        pl?.placed &&
        pl.slabId &&
        layoutSlabs.some((s) => s.id === pl.slabId)
      ) {
        setSelectedPieceId(pieceId);
        setActiveSlabId(pl.slabId);
        return;
      }

      const pieceIndex = cur.pieces.findIndex((p) => p.id === pieceId);
      const i = pieceIndex >= 0 ? pieceIndex : 0;
      const { x, y } = defaultSlabPlacementCoords(slab, i);
      updateDraftWithUndo((d) => ({
        ...d,
        placements: ensurePlacementsForPieces(d.pieces, d.placements).map((p) =>
          p.pieceId === pieceId ? { ...p, slabId, x, y, placed: true } : p
        ),
      }));
      setSelectedPieceId(pieceId);
      setActiveSlabId(slabId);
    },
    [activeSlabId, defaultSlabPlacementCoords, layoutSlabs, updateDraftWithUndo]
  );

  const onPiecesChange = useCallback(
    (pieces: LayoutPiece[]) => {
      updateDraftWithUndo((d) => ({ ...d, pieces }));
    },
    [updateDraftWithUndo]
  );

  const mergeTracePagePieces = useCallback(
    (d: SavedLayoutStudioState, nextPagePieces: LayoutPiece[]): LayoutPiece[] => {
      if (isBlankWorkspace) return nextPagePieces;
      const pages = normalizedSourcePages(d.source, d.calibration);
      const singleSourcePage = pages.length <= 1;
      const activePageIndex =
        pages.find((page) => page.index === traceSourcePageIndex)?.index ?? pages[0]?.index ?? traceSourcePageIndex;
      const remainingPieces = d.pieces.filter(
        (piece) => !pieceBelongsToSourcePage(piece, d.pieces, activePageIndex, singleSourcePage),
      );
      return [
        ...remainingPieces,
        ...nextPagePieces.map((piece) =>
          piece.sourcePageIndex == null && !singleSourcePage ? { ...piece, sourcePageIndex: activePageIndex } : piece,
        ),
      ];
    },
    [isBlankWorkspace, traceSourcePageIndex],
  );

  const onTracePiecesChange = useCallback(
    (pieces: LayoutPiece[]) => {
      updateDraftWithUndo((d) => ({ ...d, pieces: mergeTracePagePieces(d, pieces) }));
    },
    [mergeTracePagePieces, updateDraftWithUndo],
  );

  const onTracePiecesChangeLive = useCallback(
    (pieces: LayoutPiece[]) => {
      updateDraft((d) => ({ ...d, pieces: mergeTracePagePieces(d, pieces) }));
    },
    [mergeTracePagePieces, updateDraft],
  );

  const syncSourcePlanEditorPiecesToDraft = useCallback(
    (pieces: LayoutPiece[], withUndo: boolean) => {
      skipSourcePlanEditorDraftSyncRef.current = true;
      setSourcePlanEditorPieces(pieces);
      const nextSourcePieces = planEditorPiecesToSourcePieces(
        pieces,
        sourcePlanEditorFrames,
        sourcePlanEditorDefaultPageIndex,
        draft.calibration.pixelsPerInch,
      );
      if (withUndo) {
        updateDraftWithUndo((d) => ({ ...d, pieces: nextSourcePieces }));
      } else {
        updateDraft((d) => ({ ...d, pieces: nextSourcePieces }));
      }
    },
    [
      draft.calibration.pixelsPerInch,
      sourcePlanEditorDefaultPageIndex,
      sourcePlanEditorFrames,
      updateDraft,
      updateDraftWithUndo,
    ],
  );

  const commitSourcePlanEditorPiecesWithUndo = useCallback(
    (
      pieces: LayoutPiece[],
      patch: (d: SavedLayoutStudioState, nextSourcePieces: LayoutPiece[]) => SavedLayoutStudioState,
    ) => {
      skipSourcePlanEditorDraftSyncRef.current = true;
      setSourcePlanEditorPieces(pieces);
      const nextSourcePieces = planEditorPiecesToSourcePieces(
        pieces,
        sourcePlanEditorFrames,
        sourcePlanEditorDefaultPageIndex,
        draft.calibration.pixelsPerInch,
      );
      updateDraftWithUndo((d) => patch(d, nextSourcePieces));
    },
    [
      draft.calibration.pixelsPerInch,
      sourcePlanEditorDefaultPageIndex,
      sourcePlanEditorFrames,
      updateDraftWithUndo,
    ],
  );

  const onPlanCanvasPiecesChangeLive = useCallback(
    (pieces: LayoutPiece[]) => {
      if (sourcePlanEditorActive) {
        syncSourcePlanEditorPiecesToDraft(pieces, false);
        return;
      }
      onPiecesChangeLive(pieces);
    },
    [onPiecesChangeLive, sourcePlanEditorActive, syncSourcePlanEditorPiecesToDraft],
  );

  const onPlanCanvasPiecesChange = useCallback(
    (pieces: LayoutPiece[]) => {
      if (sourcePlanEditorActive) {
        syncSourcePlanEditorPiecesToDraft(pieces, true);
        return;
      }
      onPiecesChange(pieces);
    },
    [onPiecesChange, sourcePlanEditorActive, syncSourcePlanEditorPiecesToDraft],
  );

  const arrangeSourcePlanEditorPieces = useCallback(() => {
    if (!sourcePlanEditorActive || planCanvasPieces.length === 0) return;
    const piecesById = new Map(planCanvasPieces.map((piece) => [piece.id, piece]));
    const childIdsByParent = new Map<string, string[]>();
    for (const piece of planCanvasPieces) {
      const parentId = piece.splashMeta?.parentPieceId;
      if (!parentId || !piecesById.has(parentId)) continue;
      const list = childIdsByParent.get(parentId);
      if (list) list.push(piece.id);
      else childIdsByParent.set(parentId, [piece.id]);
    }
    const collectGroupIds = (rootId: string): string[] => {
      const out: string[] = [rootId];
      const stack = [rootId];
      while (stack.length > 0) {
        const currentId = stack.pop()!;
        const childIds = childIdsByParent.get(currentId) ?? [];
        for (const childId of childIds) {
          out.push(childId);
          stack.push(childId);
        }
      }
      return out;
    };
    const rootPieces = planCanvasPieces.filter((piece) => {
      const parentId = piece.splashMeta?.parentPieceId;
      return !parentId || !piecesById.has(parentId);
    });
    if (rootPieces.length === 0) return;
    /**
     * Arrange whole traced pages as a single unit so page-specific layouts keep their
     * internal relationships. Splash/miter strips already move with their parent root,
     * so grouping root pieces by source page keeps the entire page intact.
     */
    const pageGroups: LayoutPiece[][] = [];
    const pageGroupIndexByKey = new Map<string, number>();
    for (const rootPiece of rootPieces) {
      const resolvedPageIndex = resolvedPieceSourcePageIndex(rootPiece, planCanvasPieces);
      const pageKey = resolvedPageIndex == null ? "__unassigned__" : `page:${resolvedPageIndex}`;
      const existingIndex = pageGroupIndexByKey.get(pageKey);
      if (existingIndex != null) {
        pageGroups[existingIndex]!.push(rootPiece);
        continue;
      }
      pageGroupIndexByKey.set(pageKey, pageGroups.length);
      pageGroups.push([rootPiece]);
    }
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;
    const nextRootTransforms = new Map<string, { x: number; y: number }>();
    for (const pageGroup of pageGroups) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const rootPiece of pageGroup) {
        const groupPieces = collectGroupIds(rootPiece.id)
          .map((id) => piecesById.get(id))
          .filter((piece): piece is LayoutPiece => piece != null);
        for (const groupPiece of groupPieces) {
          const bounds = boundsOfPoints(planDisplayPoints(groupPiece, planCanvasPieces));
          if (!bounds) continue;
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
          maxX = Math.max(maxX, bounds.maxX);
          maxY = Math.max(maxY, bounds.maxY);
        }
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        continue;
      }
      const groupWidth = Math.max(1, maxX - minX);
      const groupHeight = Math.max(1, maxY - minY);
      if (cursorX > 0 && cursorX + groupWidth > SOURCE_PLAN_EDITOR_ARRANGE_ROW_MAX_WIDTH_IN) {
        cursorX = 0;
        cursorY += rowHeight + SOURCE_PLAN_EDITOR_ARRANGE_GAP_IN;
        rowHeight = 0;
      }
      const dx = cursorX - minX;
      const dy = cursorY - minY;
      for (const rootPiece of pageGroup) {
        nextRootTransforms.set(rootPiece.id, {
          x: (rootPiece.planTransform?.x ?? 0) + dx,
          y: (rootPiece.planTransform?.y ?? 0) + dy,
        });
      }
      cursorX += groupWidth + SOURCE_PLAN_EDITOR_ARRANGE_GAP_IN;
      rowHeight = Math.max(rowHeight, groupHeight);
    }
    if (nextRootTransforms.size === 0) return;
    onPlanCanvasPiecesChange(
      planCanvasPieces.map((piece) =>
        nextRootTransforms.has(piece.id)
          ? { ...piece, planTransform: nextRootTransforms.get(piece.id)! }
          : piece,
      ),
    );
    setPlanFitAllPiecesTick((t) => t + 1);
  }, [onPlanCanvasPiecesChange, planCanvasPieces, sourcePlanEditorActive]);

  const beginCalibration = useCallback(() => {
    if (!isBlankWorkspace) {
      setSourceCanvasMode("trace");
      setTraceViewZoom(1);
      setPlanBoxZoomActive(false);
      setTraceResetViewTick((t) => t + 1);
    }
    setCalibrationPopupOpen(true);
    setCalibrationMode(true);
    setCalibrationStep("a");
    updateDraftWithUndo((d) =>
      patchActiveSourcePage(d, (page) => ({
        ...page,
        calibration: {
          ...(page.calibration ?? d.calibration),
          pointA: null,
          pointB: null,
          isCalibrated: false,
          pixelsPerInch: null,
          realDistance: null,
          unit: null,
        },
      })),
    );
  }, [isBlankWorkspace, patchActiveSourcePage, updateDraftWithUndo]);

  const MAX_LAYOUT_SLABS = 20;
  const primarySlabIdForPlace = layoutSlabs[0]?.id ?? null;

  const addSlabClone = useCallback(() => {
    if (!activeOption || !layoutSlabs[0]) return;
    if (layoutSlabs.length >= MAX_LAYOUT_SLABS) return;
    const nextIndex = layoutSlabs.length + 1;
    updateDraftWithUndo((d) => ({
      ...d,
      slabClones: [
        ...(d.slabClones ?? []),
        { id: crypto.randomUUID(), label: `Slab ${nextIndex}` },
      ],
    }));
  }, [activeOption, layoutSlabs.length, updateDraftWithUndo]);

  const removeSlabClone = useCallback(
    (slabId: string) => {
      if (!primarySlabIdForPlace || slabId === primarySlabIdForPlace) return;
      const primary = layoutSlabs[0];
      if (!primary) return;
      updateDraftWithUndo((d) => ({
        ...d,
        slabClones: (d.slabClones ?? []).filter((c) => c.id !== slabId),
        placements: d.placements.map((p) =>
          p.slabId === slabId
            ? {
                ...p,
                slabId: primary.id,
                x: Math.min(Math.max(p.x, 0), primary.widthIn * 0.5),
                y: Math.min(Math.max(p.y, 0), primary.heightIn * 0.5),
              }
            : p
        ),
      }));
    },
    [primarySlabIdForPlace, layoutSlabs, updateDraftWithUndo]
  );

  const requestRemoveSlabClone = useCallback((slabId: string) => {
    setRemoveSlabConfirmId(slabId);
  }, []);

  const removeSlabPendingLabel = useMemo(() => {
    if (!removeSlabConfirmId) return "";
    return layoutSlabs.find((s) => s.id === removeSlabConfirmId)?.label ?? "this slab";
  }, [removeSlabConfirmId, layoutSlabs]);

  const confirmRemoveSlabClone = useCallback(() => {
    if (!removeSlabConfirmId) return;
    removeSlabClone(removeSlabConfirmId);
    setRemoveSlabConfirmId(null);
  }, [removeSlabConfirmId, removeSlabClone]);

  useEffect(() => {
    if (!removeSlabConfirmId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRemoveSlabConfirmId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removeSlabConfirmId]);

  const canAutoNestPlace = useMemo(() => {
    if (!activeOption || layoutSlabs.length === 0) return false;
    const ppi = draft.calibration.pixelsPerInch;
    if (!piecesHaveAnyScale(placeVisiblePieces, ppi)) return false;
    const sid = activeSlabId ?? layoutSlabs[0]?.id ?? null;
    if (!sid) return false;
    return activeMaterialPlacements.some((p) => p.placed && p.slabId === sid);
  }, [
    activeOption,
    activeMaterialPlacements,
    activeSlabId,
    draft.calibration.pixelsPerInch,
    layoutSlabs,
    placeVisiblePieces,
  ]);

  const applySlabAutoNest = useCallback(() => {
    const ppi = draft.calibration.pixelsPerInch;
    if (!piecesHaveAnyScale(placeVisiblePieces, ppi)) return;
    const slabId = activeSlabId ?? layoutSlabs[0]?.id ?? null;
    if (!slabId) return;
    const slab = layoutSlabs.find((s) => s.id === slabId);
    if (!slab) return;
    const minGap = parseFloat(autoNestMinGapStr.replace(/,/g, "."));
    const edgeInset = parseFloat(autoNestEdgeInsetStr.replace(/,/g, "."));
    if (!Number.isFinite(minGap) || minGap < 0) {
      setAutoNestFeedback({
        title: "Check spacing",
        lines: ["Enter a valid minimum distance between pieces (inches), for example 1.5."],
      });
      return;
    }
    if (!Number.isFinite(edgeInset) || edgeInset < 0) {
      setAutoNestFeedback({
        title: "Check spacing",
        lines: ["Enter a valid distance from the slab edge (inches), for example 1.5."],
      });
      return;
    }

    const { placements: nextPl, warnings } = computeSlabAutoNest({
      pieces: placeVisiblePieces,
      placements: activeMaterialPlacements,
      pixelsPerInch: ppi,
      slabId,
      slabWidthIn: slab.widthIn,
      slabHeightIn: slab.heightIn,
      minGapBetweenInches: minGap,
      edgeInsetInches: edgeInset,
    });

    updateDraftWithUndo((d) => ({
      ...d,
      placements: mergePlacementsForPieceIds(d.placements, nextPl, activeMaterialPieceIds),
    }));
    setAutoNestModalOpen(false);
    if (warnings.length) {
      setAutoNestFeedback({
        title: "Couldn’t place every piece",
        lines: warnings,
        footerNote:
          "Unplaced pieces keep their last position. Try a larger slab, smaller spacing, or move pieces manually.",
      });
    }
  }, [
    activeSlabId,
    autoNestMinGapStr,
    autoNestEdgeInsetStr,
    activeMaterialPieceIds,
    activeMaterialPlacements,
    draft.calibration.pixelsPerInch,
    layoutSlabs,
    placeVisiblePieces,
    updateDraftWithUndo,
  ]);

  useEffect(() => {
    if (!autoNestModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAutoNestModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoNestModalOpen]);

  useEffect(() => {
    if (!autoNestFeedback) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAutoNestFeedback(null);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [autoNestFeedback]);

  const selectedPiece = draft.pieces.find((p) => p.id === selectedPieceId) ?? null;
  const selectedPieceSize = useMemo(() => {
    if (!selectedPiece) return null;
    return describePieceSize(selectedPiece, draft.calibration.pixelsPerInch, draft.pieces, isBlankWorkspace);
  }, [draft.calibration.pixelsPerInch, draft.pieces, isBlankWorkspace, selectedPiece]);
  const materialOptionsById = useMemo(
    () => new Map(options.map((option) => [option.id, option])),
    [options],
  );
  const pieceListSourcePieces = sourcePlanEditorActive ? planCanvasPieces : draft.pieces;
  const inspectorSelectedPiece = useMemo(
    () =>
      selectedPiece ? pieceListSourcePieces.find((piece) => piece.id === selectedPiece.id) ?? selectedPiece : null,
    [pieceListSourcePieces, selectedPiece],
  );
  const selectedPieceMaterialRoot = useMemo(
    () =>
      inspectorSelectedPiece
        ? resolvedPieceMaterialRoot(inspectorSelectedPiece, pieceListSourcePieces)
        : null,
    [inspectorSelectedPiece, pieceListSourcePieces],
  );
  const selectedPieceMaterialOptionId = useMemo(
    () =>
      inspectorSelectedPiece
        ? resolvedPieceMaterialOptionId(inspectorSelectedPiece, pieceListSourcePieces)
        : null,
    [inspectorSelectedPiece, pieceListSourcePieces],
  );
  const selectedPieceMaterialOption = selectedPieceMaterialOptionId
    ? materialOptionsById.get(selectedPieceMaterialOptionId) ?? null
    : null;
  const selectedPieceHasLinkedChildren = useMemo(
    () =>
      inspectorSelectedPiece != null &&
      pieceListSourcePieces.some((piece) => piece.splashMeta?.parentPieceId === inspectorSelectedPiece.id),
    [inspectorSelectedPiece, pieceListSourcePieces],
  );
  const pieceListEntries = useMemo(
    () => {
      const piecesById = new Map(pieceListSourcePieces.map((piece) => [piece.id, piece]));
      const childPiecesByParent = new Map<string, LayoutPiece[]>();
      for (const piece of pieceListSourcePieces) {
        const parentId = piece.splashMeta?.parentPieceId;
        if (!parentId || !piecesById.has(parentId)) continue;
        const list = childPiecesByParent.get(parentId);
        if (list) list.push(piece);
        else childPiecesByParent.set(parentId, [piece]);
      }
      return pieceListSourcePieces
        .filter((piece) => {
          const parentId = piece.splashMeta?.parentPieceId;
          return !parentId || !piecesById.has(parentId);
        })
        .map((piece, index) => {
        const size = describePieceSize(piece, draft.calibration.pixelsPerInch, pieceListSourcePieces, isBlankWorkspace);
        const trimmedName = piece.name.trim();
        const trimmedNotes = piece.notes?.trim() ?? "";
          const sinkNames = (piece.sinks ?? [])
            .map((sink) => sink.name.trim())
            .filter((name) => name.length > 0);
          const stripChildren = childPiecesByParent.get(piece.id) ?? [];
          const splashNames = stripChildren
            .filter((child) => child.pieceRole === "splash")
            .map((child, splashIndex) => child.name.trim() || `Splash ${splashIndex + 1}`);
          const miterNames = stripChildren
            .filter((child) => child.pieceRole === "miter")
            .map((child, miterIndex) => child.name.trim() || `Miter ${miterIndex + 1}`);
          const materialOptionId = resolvedPieceMaterialOptionId(piece, pieceListSourcePieces);
          const materialOption = materialOptionId ? materialOptionsById.get(materialOptionId) ?? null : null;
          return {
            id: piece.id,
            name: trimmedName || `Piece ${index + 1}`,
            sizeLabel: size.overallLabel ?? (size.needsScale ? "Set scale to view size" : "Size unavailable"),
            sizeDetail: size.detailLabel,
            notes: trimmedNotes || "No notes",
            sinkNames,
            splashNames,
            miterNames,
            materialLabel: materialOption?.productName ?? (options.length > 0 ? "Unassigned" : "No materials added"),
            materialAssigned: materialOption != null,
            pageLabel: formatPiecePageLabel(
              piece,
              pieceListSourcePieces,
              isBlankWorkspace,
              sourcePages.length,
              sourcePageNumberByIndex,
            ),
          };
        });
    },
    [
      draft.calibration.pixelsPerInch,
      isBlankWorkspace,
      materialOptionsById,
      options.length,
      pieceListSourcePieces,
      sourcePageNumberByIndex,
      sourcePages.length,
    ],
  );
  const assignMaterialToPieceGroup = useCallback(
    (rootPieceId: string, materialOptionId: string | null) => {
      const applyAssignment = (pieces: readonly LayoutPiece[]): LayoutPiece[] => {
        const affectedIds = new Set<string>();
        const stack = [rootPieceId];
        while (stack.length > 0) {
          const currentId = stack.pop()!;
          if (affectedIds.has(currentId)) continue;
          affectedIds.add(currentId);
          for (const piece of pieces) {
            if (piece.splashMeta?.parentPieceId === currentId) {
              stack.push(piece.id);
            }
          }
        }
        return pieces.map((piece) =>
          affectedIds.has(piece.id) ? { ...piece, materialOptionId } : piece,
        );
      };
      if (sourcePlanEditorActive) {
        const nextPlanPieces = applyAssignment(planCanvasPieces);
        commitSourcePlanEditorPiecesWithUndo(nextPlanPieces, (d, nextSourcePieces) => ({
          ...d,
          pieces: nextSourcePieces,
        }));
        return;
      }
      updateDraftWithUndo((d) => ({
        ...d,
        pieces: applyAssignment(d.pieces),
      }));
    },
    [commitSourcePlanEditorPiecesWithUndo, planCanvasPieces, sourcePlanEditorActive, updateDraftWithUndo],
  );

  const joinAvailable = useMemo(
    () => hasFlushSnapJoinCandidate(usesBlankPlanCanvas ? planCanvasPieces : draft.pieces),
    [draft.pieces, planCanvasPieces, usesBlankPlanCanvas]
  );

  useEffect(() => {
    if (!joinAvailable && tool === "join") setTool("select");
  }, [joinAvailable, tool]);

  const coordPerInchForPiece = useCallback(
    (piece: LayoutPiece | null | undefined): number | null => {
      if (!piece) return null;
      if (usesBlankPlanCanvas) return 1;
      const ppi =
        piece.sourcePixelsPerInch ??
        activeCalibration.pixelsPerInch ??
        draft.calibration.pixelsPerInch ??
        null;
      return ppi && ppi > 0 ? ppi : null;
    },
    [activeCalibration.pixelsPerInch, draft.calibration.pixelsPerInch, usesBlankPlanCanvas],
  );

  const addSinkWorkingPieces = sourcePlanEditorActive ? planCanvasPieces : draft.pieces;

  const addSinkPreviewRotationDeg = useMemo(() => {
    if (!addSinkEdge) return 0;
    const pc = addSinkWorkingPieces.find((p) => p.id === addSinkEdge.pieceId);
    if (!pc) return 0;
    return sinkRotationDegFromEdge(pc, addSinkEdge.edgeIndex, addSinkWorkingPieces) ?? 0;
  }, [addSinkEdge, addSinkWorkingPieces]);

  const updateSelectedPiece = (patch: Partial<LayoutPiece>) => {
    if (!selectedPieceId) return;
    if (sourcePlanEditorActive) {
      onPlanCanvasPiecesChange(planCanvasPieces.map((p) => (p.id === selectedPieceId ? { ...p, ...patch } : p)));
      return;
    }
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: d.pieces.map((p) => (p.id === selectedPieceId ? { ...p, ...patch } : p)),
    }));
  };

  const removeSinkFromSelected = (sinkId: string) => {
    if (!selectedPieceId) return;
    if (sourcePlanEditorActive) {
      onPlanCanvasPiecesChange(
        planCanvasPieces.map((p) =>
          p.id === selectedPieceId ? { ...p, sinks: (p.sinks ?? []).filter((s) => s.id !== sinkId) } : p,
        ),
      );
      return;
    }
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: d.pieces.map((p) =>
        p.id === selectedPieceId
          ? { ...p, sinks: (p.sinks ?? []).filter((s) => s.id !== sinkId) }
          : p
      ),
    }));
  };

  const confirmAddSink = (input: {
    name: string;
    templateKind: PieceSinkCutout["templateKind"];
    faucetHoleCount: number;
    spreadIn: PieceSinkCutout["spreadIn"];
    evenHoleBias: FaucetEvenHoleBias;
  }) => {
    if (!addSinkEdge) return;
    const workingPieces = sourcePlanEditorActive ? planCanvasPieces : draft.pieces;
    const piece = workingPieces.find((p) => p.id === addSinkEdge.pieceId);
    if (!piece || isPlanStripPiece(piece)) return;
    const coordPerInch = coordPerInchForPiece(piece);
    if (!coordPerInch || coordPerInch <= 0) {
      window.alert("Set scale on this page before adding sinks in trace mode.");
      return;
    }
    const pl = sinkPlacementFromEdgeInCanonical(
      piece,
      addSinkEdge.edgeIndex,
      workingPieces,
      input.templateKind,
      coordPerInch,
    );
    if (!pl) {
      window.alert("Could not align the sink to that edge.");
      return;
    }
    const n = input.faucetHoleCount;
    let sink: PieceSinkCutout = {
      id: crypto.randomUUID(),
      name: input.name,
      templateKind: input.templateKind,
      centerX: pl.centerX,
      centerY: pl.centerY,
      rotationDeg: pl.rotationDeg,
      faucetHoleCount: n,
      spreadIn: input.spreadIn,
      evenHoleBias: n === 2 || n === 4 ? input.evenHoleBias : undefined,
    };
    const clamped = clampSinkCenter(
      sink,
      piece,
      workingPieces,
      coordPerInch,
      sink.centerX,
      sink.centerY
    );
    sink = { ...sink, ...clamped };
    if (!isSinkFullyInsidePiece(sink, piece, workingPieces, coordPerInch)) {
      window.alert(
        "That sink doesn’t fit entirely inside this piece. Enlarge the piece, choose a different edge, or pick a smaller template."
      );
      return;
    }
    const nextPieces = workingPieces.map((p) =>
      p.id === piece.id ? { ...p, sinks: [...(p.sinks ?? []), sink], sinkCount: 0 } : p,
    );
    if (sourcePlanEditorActive) {
      onPlanCanvasPiecesChange(nextPieces);
      return;
    }
    updateDraftWithUndo((d) => ({ ...d, pieces: nextPieces }));
  };

  const duplicateSelected = () => {
    const workingPieces = sourcePlanEditorActive ? planCanvasPieces : draft.pieces;
    const pieceToDuplicate =
      sourcePlanEditorActive
        ? workingPieces.find((p) => p.id === selectedPieceId) ?? null
        : selectedPiece;
    if (!pieceToDuplicate) return;
    const nid = crypto.randomUUID();
    const offsetStep = usesBlankPlanCanvas ? 6 : 24;
    const baseTransform = pieceToDuplicate.planTransform ?? { x: 0, y: 0 };
    const baseCopy: LayoutPiece = {
      ...pieceToDuplicate,
      id: nid,
      name: `${pieceToDuplicate.name} copy`,
      materialOptionId: resolvedPieceMaterialOptionId(pieceToDuplicate, workingPieces),
      points: pieceToDuplicate.points.map((q) => ({ ...q })),
      sinks: pieceToDuplicate.sinks?.map((s) => ({ ...s, id: crypto.randomUUID() })),
      manualDimensions: pieceToDuplicate.manualDimensions
        ? pieceToDuplicate.manualDimensions.kind === "rectangle"
          ? { ...pieceToDuplicate.manualDimensions }
          : { ...pieceToDuplicate.manualDimensions }
        : undefined,
      splashMeta: undefined,
      pieceRole: isPlanStripPiece(pieceToDuplicate) ? "countertop" : pieceToDuplicate.pieceRole,
      edgeTags: pieceToDuplicate.edgeTags
        ? (() => {
            const { miterEdgeIndices: _omitMiter, ...restEt } = pieceToDuplicate.edgeTags;
            return { ...restEt, splashEdges: [] };
          })()
        : undefined,
      planTransform: { ...baseTransform },
    };
    let copy = baseCopy;
    for (let step = 1; step <= 24; step += 1) {
      const candidate: LayoutPiece = {
        ...baseCopy,
        planTransform: {
          x: baseTransform.x + offsetStep * step,
          y: baseTransform.y + offsetStep * step,
        },
      };
      if (!anyPiecesOverlap([...workingPieces, candidate])) {
        copy = candidate;
        break;
      }
      copy = candidate;
    }
    if (sourcePlanEditorActive) {
      commitSourcePlanEditorPiecesWithUndo([...workingPieces, copy], (d, nextSourcePieces) => ({
        ...d,
        pieces: nextSourcePieces,
        placements: [
          ...d.placements,
          {
            id: crypto.randomUUID(),
            pieceId: nid,
            slabId: null,
            x: 0,
            y: 0,
            rotation: 0,
            placed: false,
          },
        ],
      }));
    } else {
      updateDraftWithUndo((d) => ({
        ...d,
        pieces: [...d.pieces, copy],
        placements: [
          ...d.placements,
          {
            id: crypto.randomUUID(),
            pieceId: nid,
            slabId: null,
            x: 0,
            y: 0,
            rotation: 0,
            placed: false,
          },
        ],
      }));
    }
    setSelectedPieceId(nid);
    if (usesBlankPlanCanvas) {
      pendingDuplicateFitRef.current = true;
      setPlanFitAllPiecesTick((t) => t + 1);
    }
  };

  const deleteSelected = () => {
    if (!selectedPieceId) return;
    const pid = selectedPieceId;
    const piece = draft.pieces.find((p) => p.id === pid);
    updateDraftWithUndo((d) => {
      const splashChildren = new Set(
        d.pieces.filter((p) => p.splashMeta?.parentPieceId === pid).map((p) => p.id)
      );
      let pieces = d.pieces.filter((p) => p.id !== pid && !splashChildren.has(p.id));
      if (piece?.splashMeta) {
        const parId = piece.splashMeta.parentPieceId;
        const pei = piece.splashMeta.parentEdgeIndex;
        pieces = pieces.map((p) => {
          if (p.id !== parId) return p;
          const se = (p.edgeTags?.splashEdges ?? []).filter((e) => e.splashPieceId !== pid);
          let edgeTags: LayoutPiece["edgeTags"] = { ...p.edgeTags, splashEdges: se };
          if (isMiterStripPiece(piece) || piece.splashMeta?.waterfall) {
            const restM = (p.edgeTags?.miterEdgeIndices ?? []).filter((x) => x !== pei);
            edgeTags = { ...edgeTags, miterEdgeIndices: restM.length ? restM : undefined };
          }
          return { ...p, edgeTags };
        });
      }
      const removeIds = new Set([pid, ...splashChildren]);
      return {
        ...d,
        pieces,
        placements: d.placements.filter((pl) => !removeIds.has(pl.pieceId)),
      };
    });
    setSelectedPieceId(null);
    setSelectedEdge(null);
  };

  const updatePlacementRotationLive = useCallback(
    (deg: number) => {
      if (!placeSelectedPieceId) return;
      updateDraft((d) => ({
        ...d,
        placements: d.placements.map((p) =>
          p.pieceId === placeSelectedPieceId ? { ...p, rotation: deg } : p
        ),
      }));
    },
    [placeSelectedPieceId, updateDraft]
  );

  const rotateSelectedPlacementOnSlabBy = useCallback(
    (deltaDeg: number) => {
      if (!placeSelectedPieceId) return;
      updateDraftWithUndo((d) => {
        const pl = d.placements.find((p) => p.pieceId === placeSelectedPieceId);
        if (!pl?.placed || !pl.slabId) return d;
        const r = ((pl.rotation ?? 0) + deltaDeg) % 360;
        const rotation = r < 0 ? r + 360 : r;
        return {
          ...d,
          placements: d.placements.map((p) =>
            p.pieceId === placeSelectedPieceId ? { ...p, rotation } : p
          ),
        };
      });
    },
    [placeSelectedPieceId, updateDraftWithUndo]
  );

  const removeSelectedPieceFromSlab = useCallback(() => {
    if (!placeSelectedPieceId) return;
    updateDraftWithUndo((d) => {
      const pl = d.placements.find((p) => p.pieceId === placeSelectedPieceId);
      if (!pl?.placed || !pl.slabId) return d;
      return {
        ...d,
        placements: d.placements.map((p) =>
          p.pieceId === placeSelectedPieceId ? { ...p, placed: false, slabId: null } : p
        ),
      };
    });
  }, [placeSelectedPieceId, updateDraftWithUndo]);

  const placeSeamOnSlab = useCallback(
    (request: PlaceSeamRequest): boolean => {
      const split = splitPlacedPieceAtSeam({
        pieces: draftRef.current.pieces,
        placements: draftRef.current.placements,
        pixelsPerInch: draftRef.current.calibration.pixelsPerInch,
        request,
      });
      if (!split) return false;
      updateDraftWithUndo((d) => ({
        ...d,
        pieces: split.pieces,
        placements: split.placements,
      }));
      setSelectedPieceId(split.selectedPieceId);
      setSelectedEdge(null);
      return true;
    },
    [updateDraftWithUndo]
  );

  const rotateSelectedPlanPiece = (deltaDeg: number) => {
    if (!selectedPieceId) return;
    const id = selectedPieceId;
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: d.pieces.map((p) => (p.id === id ? rotatePlanPieceAroundCentroid(p, deltaDeg) : p)),
    }));
  };

  const toggleProfileEdge = (sel: { pieceId: string; edgeIndex: number }) => {
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: d.pieces.map((p) => {
        if (p.id !== sel.pieceId) return p;
        const prof = new Set(p.edgeTags?.profileEdgeIndices ?? []);
        if (prof.has(sel.edgeIndex)) prof.delete(sel.edgeIndex);
        else prof.add(sel.edgeIndex);
        return {
          ...p,
          edgeTags: { ...p.edgeTags, profileEdgeIndices: [...prof].sort((a, b) => a - b) },
        };
      }),
    }));
  };

  /** Splash only: tag which plan edge is the 3D hinge / counter contact (Place 3D preview). */
  const setSplashBottomEdge = (sel: { pieceId: string; edgeIndex: number }) => {
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: d.pieces.map((p) => {
        if (p.id !== sel.pieceId || !isPlanStripPiece(p) || !p.splashMeta) return p;
        return {
          ...p,
          splashMeta: { ...p.splashMeta, bottomEdgeIndex: sel.edgeIndex },
        };
      }),
    }));
  };

  const confirmSplashForEdge = () => {
    const edge = splashTargetEdge;
    if (!edge) return;
    const h = parseFloat(splashHeightInput);
    if (!Number.isFinite(h) || h <= 0) return;
    const workingPieces = usesBlankPlanCanvas ? planCanvasPieces : draft.pieces;
    const parent = workingPieces.find((p) => p.id === edge.pieceId);
    if (!parent || isPlanStripPiece(parent)) return;
    const coordPerInch = coordPerInchForPiece(parent);
    if (!coordPerInch || coordPerInch <= 0) {
      window.alert("Set scale on this page before adding splash or miter pieces in trace mode.");
      return;
    }
    const disp = planDisplayPoints(parent, workingPieces);
    const pts = buildSplashRectanglePoints(disp, edge.edgeIndex, h, coordPerInch);
    const ox = parent.planTransform?.x ?? 0;
    const oy = parent.planTransform?.y ?? 0;
    const canonical = pts.map((p) => ({ x: p.x - ox, y: p.y - oy }));
    const ring = normalizeClosedRing(disp);
    const n = ring.length;
    const a = ring[edge.edgeIndex];
    const b = ring[(edge.edgeIndex + 1) % n];
    const widthIn = Math.hypot(b.x - a.x, b.y - a.y) / coordPerInch;
    const splashId = crypto.randomUUID();
    const stripRole = edgeStripKind === "miter" ? "miter" : "splash";
    const newPiece: LayoutPiece = {
      id: splashId,
      name: edgeStripKind === "miter" ? `${parent.name} miter` : `${parent.name} splash`,
      materialOptionId: resolvedPieceMaterialOptionId(parent, workingPieces),
      points: canonical,
      sinkCount: 0,
      shapeKind: "rectangle",
      source: "manual",
      sourcePageIndex: parent.sourcePageIndex,
      sourcePixelsPerInch: parent.sourcePixelsPerInch,
      pieceRole: stripRole,
      splashMeta: {
        parentPieceId: parent.id,
        parentEdgeIndex: edge.edgeIndex,
        heightIn: h,
        bottomEdgeIndex: 0,
      },
      manualDimensions: { kind: "rectangle", widthIn, depthIn: h },
      planTransform: { x: 0, y: 0 },
      edgeTags:
        edgeStripKind === "miter"
          ? {
              /** Inner contact edge with parent (mates with parent miter tag). */
              miterEdgeIndices: [0],
            }
          : undefined,
    };
    const nextPieces = [
      ...workingPieces.map((p) => {
        if (p.id !== parent.id) return p;
        const rest = (p.edgeTags?.splashEdges ?? []).filter((e) => e.edgeIndex !== edge.edgeIndex);
        const miterMerged =
          edgeStripKind === "miter"
            ? [...new Set([...(p.edgeTags?.miterEdgeIndices ?? []), edge.edgeIndex])].sort(
                (a, b) => a - b,
              )
            : p.edgeTags?.miterEdgeIndices;
        return {
          ...p,
          edgeTags: {
            ...p.edgeTags,
            ...(miterMerged?.length ? { miterEdgeIndices: miterMerged } : {}),
            splashEdges: [...rest, { edgeIndex: edge.edgeIndex, splashPieceId: splashId, heightIn: h }],
          },
        };
      }),
      newPiece,
    ];
    if (sourcePlanEditorActive) {
      commitSourcePlanEditorPiecesWithUndo(nextPieces, (d, nextSourcePieces) => ({
        ...d,
        pieces: nextSourcePieces,
        placements: [
          ...d.placements,
          {
            id: crypto.randomUUID(),
            pieceId: splashId,
            slabId: null,
            x: 0,
            y: 0,
            rotation: 0,
            placed: false,
          },
        ],
      }));
    } else {
      updateDraftWithUndo((d) => ({
        ...d,
        pieces: nextPieces,
        placements: [
          ...d.placements,
          {
            id: crypto.randomUUID(),
            pieceId: splashId,
            slabId: null,
            x: 0,
            y: 0,
            rotation: 0,
            placed: false,
          },
        ],
      }));
    }
    setSplashModalOpen(false);
    setSplashTargetEdge(null);
    setEdgeStripKind("splash");
    setSelectedPieceId(splashId);
  };

  const handleUpload = async (file: File) => {
    setUploadError(null);
    if (!isAcceptedLayoutSourceFile(file)) {
      setUploadError("Use PDF, PNG, JPG, or WebP.");
      return;
    }
    if (workspaceKind === "blank" && draft.pieces.length > 0) {
      const ok = window.confirm(
        "Adding a plan replaces the blank layout and clears pieces for this job’s shared plan. Continue?"
      );
      if (!ok) return;
    }
    /**
     * Reset source-canvas UI before swapping workspaces so importing from Blank starts
     * from the same trace-state as a fresh source-backed session.
     */
    setSourcePlanEditorPieces([]);
    skipSourcePlanEditorDraftSyncRef.current = false;
    setSourceCanvasMode("trace");
    setTraceViewZoom(1);
    setTraceResetViewTick((t) => t + 1);
    setTraceZoomToSelectedTick(0);
    setPlanBoxZoomActive(false);
    setSelectedEdge(null);
    setSelectedFilletEdges([]);
    setTool("select");
    const kind = layoutSourceKindFromFile(file);
    setUploading(true);
    setUploadStage("uploading");
    setUploadProgress(0);
    setUploadStatusText(`Starting upload • ${formatUploadSize(file.size)}`);
    setPdfRenderBusy(false);
    setPdfRenderStatusText(null);
    setPdfRenderFailedPages({});
    uploadedPdfFileRef.current = null;
    try {
      const { downloadUrl, storagePath } = await uploadJobLayoutSource(ownerUserId, job.id, file, {
        onProgress: ({ percent }) => {
          setUploadStage("uploading");
          setUploadProgress(percent);
          setUploadStatusText(
            percent >= 99
              ? "Finalizing secure upload..."
              : `${Math.round(percent)}% of ${formatUploadSize(file.size)} uploaded`,
          );
        },
      });
      setUploadStage("processing");
      setUploadProgress(100);
      setUploadStatusText(kind === "pdf" ? "Reading PDF pages and building frames..." : "Preparing image...");
      const uploadedAt = new Date().toISOString();
      setUndoStack([]);
      setRedoStack([]);
      setSelectedPieceId(null);
      setActivePdfPageImageUrl(null);
      setPdfPageThumbUrls({});
      setSourceCanvasMode("trace");

      if (kind === "pdf") {
        uploadedPdfFileRef.current = { uploadedAt, file };
        setUploadStatusText("Inspecting PDF pages...");
        const pageManifest = await inspectPdfFilePages(file);
        setUploadStatusText(`Building ${pageManifest.length} page ${pageManifest.length === 1 ? "frame" : "frames"}...`);
        const stacked = buildStackedPdfPages(
          pageManifest.map((page) => ({
            pageNumber: page.pageNumber,
            widthPx: page.width,
            heightPx: page.height,
          })),
        );
        setActiveSourcePageIndex(stacked.pages[0]?.index ?? 0);
        try {
          const renderedPages = await renderPdfFilePagesToDataUrls(
            file,
            stacked.pages.map((page) => page.pageNumber),
            1.5,
            ({ pageNumber, renderedCount, totalCount }) => {
              setUploadProgress((renderedCount / Math.max(totalCount, 1)) * 100);
              setUploadStatusText(`Rendering page ${pageNumber} of ${totalCount}...`);
            },
          );
          const pageMap = new Map(renderedPages.map((page) => [page.pageNumber, page.dataUrl]));
          const thumbMap = Object.fromEntries(
            stacked.pages
              .map((page) => {
                const dataUrl = pageMap.get(page.pageNumber);
                return dataUrl ? [page.index, dataUrl] : null;
              })
              .filter((entry): entry is [number, string] => entry != null),
          );
          let persistedPreviews = new Map<number, { downloadUrl: string; storagePath: string }>();
          setUploadStatusText(
            `Saving ${renderedPages.length} page ${renderedPages.length === 1 ? "preview" : "previews"}...`,
          );
          const persistedPreviewResults = await Promise.allSettled(
            renderedPages.map(async (page) => {
              const uploadedPreview = await uploadJobLayoutSourcePreviewPng(ownerUserId, job.id, page.pngBlob, {
                nameHint: `pdf-page-${page.pageNumber}`,
              });
              return [page.pageNumber, uploadedPreview] as const;
            }),
          );
          persistedPreviews = new Map(
            persistedPreviewResults.flatMap((result) =>
              result.status === "fulfilled" ? [[result.value[0], result.value[1]]] : [],
            ),
          );
          const previewFailureCount = persistedPreviewResults.filter(
            (result) => result.status === "rejected",
          ).length;
          if (previewFailureCount > 0) {
            setUploadError(
              `${previewFailureCount} PDF page ${
                previewFailureCount === 1 ? "preview" : "previews"
              } could not be saved. Re-upload the plan if a page later reopens without its cached preview.`,
            );
          }
          const persistedPages = stacked.pages.map((page) => ({
            ...page,
            previewImageUrl: persistedPreviews.get(page.pageNumber)?.downloadUrl,
            previewStoragePath: persistedPreviews.get(page.pageNumber)?.storagePath,
          }));
          setPdfPageThumbUrls(thumbMap);
          if (stacked.pages[0]) {
            setActivePdfPageImageUrl(thumbMap[stacked.pages[0].index] ?? null);
          }
          setUploadStatusText("Building plan workspace...");
          updateDraft((d) => ({
            ...d,
            workspaceKind: "source",
            pieces: [],
            placements: [],
            slabClones: [],
            source: {
              kind: "pdf",
              fileUrl: downloadUrl,
              fileStoragePath: storagePath,
              previewImageUrl: persistedPages[0]?.previewImageUrl,
              previewStoragePath: persistedPages[0]?.previewStoragePath,
              fileName: file.name,
              uploadedAt,
              pages: persistedPages,
              sourceWidthPx: stacked.totalWidth,
              sourceHeightPx: stacked.totalHeight,
            },
            calibration: {
              ...d.calibration,
              isCalibrated: false,
              pointA: null,
              pointB: null,
              realDistance: null,
              unit: null,
              pixelsPerInch: null,
            },
          }));
        } catch (err) {
          setActivePdfPageImageUrl(null);
          setPdfPageThumbUrls({});
          setUploadError(
            err instanceof Error
              ? `PDF uploaded, but the page previews could not be rendered: ${err.message}`
              : "PDF uploaded, but the page previews could not be rendered.",
          );
          updateDraft((d) => ({
            ...d,
            workspaceKind: "source",
            pieces: [],
            placements: [],
            slabClones: [],
            source: {
              kind: "pdf",
              fileUrl: downloadUrl,
              fileStoragePath: storagePath,
              fileName: file.name,
              uploadedAt,
              pages: stacked.pages,
              sourceWidthPx: stacked.totalWidth,
              sourceHeightPx: stacked.totalHeight,
            },
            calibration: {
              ...d.calibration,
              isCalibrated: false,
              pointA: null,
              pointB: null,
              realDistance: null,
              unit: null,
              pixelsPerInch: null,
            },
          }));
        }
      } else {
        uploadedPdfFileRef.current = null;
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          const o = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(o);
            setUploadStatusText("Preparing plan canvas...");
            updateDraft((d) => ({
              ...d,
              workspaceKind: "source",
              pieces: [],
              placements: [],
              slabClones: [],
              source: {
                kind: "image",
                fileUrl: downloadUrl,
                fileStoragePath: storagePath,
                fileName: file.name,
                uploadedAt,
                pages: [
                  {
                    index: 0,
                    pageNumber: 1,
                    widthPx: img.naturalWidth,
                    heightPx: img.naturalHeight,
                    originX: 0,
                    originY: 0,
                    calibration: {
                      ...d.calibration,
                      isCalibrated: false,
                      pointA: null,
                      pointB: null,
                      realDistance: null,
                      unit: null,
                      pixelsPerInch: null,
                    },
                  },
                ],
                sourceWidthPx: img.naturalWidth,
                sourceHeightPx: img.naturalHeight,
              },
              calibration: {
                ...d.calibration,
                isCalibrated: false,
                pointA: null,
                pointB: null,
                realDistance: null,
                unit: null,
                pixelsPerInch: null,
              },
            }));
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(o);
            reject(new Error("Could not read image"));
          };
          img.src = o;
        });
      }
      setCalibrationPopupOpen(true);
      setCalibrationMode(true);
      setCalibrationStep("a");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setUploadStage("uploading");
      setUploadStatusText(null);
    }
  };

  const onCalibrationPoint = (p: { x: number; y: number }) => {
    if (calibrationStep === "a") {
      updateDraftWithUndo((d) =>
        patchActiveSourcePage(d, (page) => ({
          ...page,
          calibration: { ...(page.calibration ?? d.calibration), pointA: p, pointB: null },
        })),
      );
      setCalibrationStep("b");
      return;
    }
    if (calibrationStep === "b") {
      updateDraftWithUndo((d) =>
        patchActiveSourcePage(d, (page) => ({
          ...page,
          calibration: { ...(page.calibration ?? d.calibration), pointB: p },
        })),
      );
      setCalibrationStep("idle");
      setCalibrationMode(false);
    }
  };

  const applyCalibration = () => {
    const a = activeCalibration.pointA;
    const b = activeCalibration.pointB;
    const raw = parseFloat(distanceInput);
    if (!a || !b || !Number.isFinite(raw) || raw <= 0) return;
    const ppi = pixelsPerInchFromSegment(a, b, raw, distanceUnit);
    if (ppi == null) return;
    updateDraftWithUndo((d) => {
      const singleSourcePage = normalizedSourcePages(d.source, d.calibration).length === 1;
      return {
        ...patchActiveSourcePage(d, (page) => ({
        ...page,
        calibration: {
          ...(page.calibration ?? d.calibration),
          isCalibrated: true,
          realDistance: raw,
          unit: distanceUnit,
          pixelsPerInch: ppi,
        },
      })),
        pieces: d.pieces.map((piece) =>
          pieceBelongsToSourcePage(piece, d.pieces, activeSourcePageIndex, singleSourcePage)
            ? {
                ...piece,
                sourcePageIndex: activeSourcePageIndex,
                sourcePixelsPerInch: ppi,
              }
            : piece,
        ),
      };
    });
    setCalibrationPopupOpen(false);
    setCalibrationMode(false);
    setCalibrationStep("idle");
  };

  const closeCalibrationPopup = useCallback(() => {
    setCalibrationPopupOpen(false);
    setCalibrationMode(false);
    setCalibrationStep("idle");
  }, []);

  useEffect(() => {
    if (!calibrationPopupOpen) return;
    setCalibrationPopupPos(defaultCalibrationPopupPos());
  }, [calibrationPopupOpen, planCanvasExpanded]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = calibrationPopupDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      setCalibrationPopupPos({
        x: Math.max(8, drag.originX + (e.clientX - drag.startX)),
        y: Math.max(8, drag.originY + (e.clientY - drag.startY)),
      });
    };
    const onPointerUp = (e: PointerEvent) => {
      const drag = calibrationPopupDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      calibrationPopupDragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = inspectorPanelDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      setInspectorPanelPos({
        x: Math.max(8, drag.originX - (e.clientX - drag.startX)),
        y: Math.max(56, drag.originY + (e.clientY - drag.startY)),
      });
    };
    const onPointerUp = (e: PointerEvent) => {
      const drag = inspectorPanelDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      inspectorPanelDragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = pieceListPanelDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      setPieceListPanelPos({
        x: Math.max(8, drag.originX - (e.clientX - drag.startX)),
        y: Math.max(8, drag.originY - (e.clientY - drag.startY)),
      });
    };
    const onPointerUp = (e: PointerEvent) => {
      const drag = pieceListPanelDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      pieceListPanelDragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    if (!materialMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && materialMenuRef.current?.contains(target)) return;
      if (target && materialMenuPopoverRef.current?.contains(target)) return;
      setMaterialMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaterialMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [materialMenuOpen]);

  useLayoutEffect(() => {
    if (!materialMenuOpen) {
      setMaterialMenuPopoverStyle(null);
      return;
    }
    if (typeof window === "undefined") return;

    const updatePopoverPosition = () => {
      const trigger = materialMenuTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const availableWidth = Math.max(220, window.innerWidth - viewportPadding * 2);
      const preferredWidth = Math.max(rect.width, 390);
      const popoverWidth = Math.min(preferredWidth, availableWidth);
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, window.innerWidth - popoverWidth - viewportPadding),
      );
      const top = rect.bottom + 8;
      const maxHeight = Math.max(220, window.innerHeight - top - viewportPadding);
      setMaterialMenuPopoverStyle({
        position: "fixed",
        top,
        left,
        width: popoverWidth,
        maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
        maxHeight,
        overflowY: "auto",
      });
    };

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [materialMenuOpen]);

  const renderMaterialMenuPopover = useCallback(
    (children: ReactNode, ariaLabel = "Area materials") => {
      if (!materialMenuOpen || typeof document === "undefined") return null;
      return createPortal(
        <div
          ref={materialMenuPopoverRef}
          className="ls-material-menu-popover glass-panel"
          role="dialog"
          aria-label={ariaLabel}
          style={materialMenuPopoverStyle ?? undefined}
        >
          {children}
        </div>,
        document.body,
      );
    },
    [materialMenuOpen, materialMenuPopoverStyle],
  );

  const beginCalibrationPopupDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    calibrationPopupDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: calibrationPopupPos.x,
      originY: calibrationPopupPos.y,
    };
  }, [calibrationPopupPos.x, calibrationPopupPos.y]);

  const beginInspectorPanelDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    inspectorPanelDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: inspectorPanelPos.x,
      originY: inspectorPanelPos.y,
    };
  }, [inspectorPanelPos.x, inspectorPanelPos.y]);

  const beginPieceListPanelDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pieceListPanelDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pieceListPanelPos.x,
      originY: pieceListPanelPos.y,
    };
  }, [pieceListPanelPos.x, pieceListPanelPos.y]);

  const placementForSelected = activeMaterialPlacements.find((p) => p.pieceId === placeSelectedPieceId);
  const canRotatePlacementOnSlab = !!(
    placeSelectedPieceId &&
    placementForSelected?.placed &&
    placementForSelected?.slabId
  );
  const canRemoveSelectedFromSlab = canRotatePlacementOnSlab;

  const applyManualDimensions = (next: ManualPieceDimensions) => {
    if (!selectedPieceId) return;
    if (sourcePlanEditorActive) {
      const piece = planCanvasPieces.find((p) => p.id === selectedPieceId);
      if (!piece) return;
      const anchor = piece.planTransform ?? piece.points[0] ?? { x: 0, y: 0 };
      const localized: LayoutPiece = {
        ...piece,
        points: piece.points.map((point) => ({ x: point.x - anchor.x, y: point.y - anchor.y })),
        sinks: piece.sinks?.map((sink) => ({
          ...sink,
          centerX: sink.centerX - anchor.x,
          centerY: sink.centerY - anchor.y,
        })),
        edgeArcCircleIn: piece.edgeArcCircleIn?.map((circle) =>
          circle
            ? {
                ...circle,
                cx: circle.cx - anchor.x,
                cy: circle.cy - anchor.y,
              }
            : null,
        ),
        planTransform: { x: anchor.x, y: anchor.y },
      };
      const nextPiece = applyManualDimensionsToPiece(localized, next);
      onPlanCanvasPiecesChange(
        planCanvasPieces.map((p) => (p.id === selectedPieceId ? nextPiece : p)),
      );
      return;
    }
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: d.pieces.map((p) =>
        p.id === selectedPieceId ? applyManualDimensionsToPiece(p, next) : p
      ),
    }));
  };

  useEffect(() => {
    setSelectedEdge(null);
    setSelectedFilletEdges([]);
  }, [tool]);

  useEffect(() => {
    if (!usesBlankPlanCanvas) {
      setSelectedEdge(null);
      setSelectedFilletEdges([]);
    }
  }, [usesBlankPlanCanvas]);

  useEffect(() => {
    if (!usesBlankPlanCanvas || mode !== "trace") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (tool !== "select") return;
      const targets = selectedFilletEdgesRef.current;
      if (targets.length === 0) return;
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) {
        return;
      }
      e.preventDefault();
      const workingPieces = sourcePlanEditorActive ? planCanvasPieces : draftRef.current.pieces;
      const r = removeCornerFilletsBatch(workingPieces, targets);
      if (!r.ok) {
        window.alert(r.reason);
        return;
      }
      if (anyPiecesOverlap(r.pieces)) {
        window.alert("Removing these radii would cause a piece to overlap another.");
        return;
      }
      if (sourcePlanEditorActive) {
        onPlanCanvasPiecesChange(r.pieces);
      } else {
        updateDraftWithUndo((d) => ({ ...d, pieces: r.pieces }));
      }
      setSelectedFilletEdges([]);
      setSelectedEdge(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onPlanCanvasPiecesChange, planCanvasPieces, sourcePlanEditorActive, tool, updateDraftWithUndo, usesBlankPlanCanvas]);

  useEffect(() => {
    if (!planCanvasExpanded) {
      document.body.classList.remove("layout-studio-plan-fullscreen");
      return;
    }
    document.body.classList.add("layout-studio-plan-fullscreen");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.classList.remove("layout-studio-plan-fullscreen");
      document.body.style.overflow = prevOverflow;
    };
  }, [planCanvasExpanded]);

  useEffect(() => {
    if (!planCanvasExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      setPlanCanvasExpanded(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [planCanvasExpanded]);

  useLayoutEffect(() => {
    if (mode !== "place" || !planCanvasExpanded || !placeSplitView) {
      setPlaceSlabRegionViewportHeight(null);
      return;
    }

    let frameId = 0;
    const measure = () => {
      const region = placeSlabRegionRef.current;
      if (!region) return;
      const rect = region.getBoundingClientRect();
      const nextHeight = Math.max(180, Math.floor(window.innerHeight - rect.top - 8));
      setPlaceSlabRegionViewportHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => scheduleMeasure()) : null;
    const region = placeSlabRegionRef.current;
    if (resizeObserver && region) {
      resizeObserver.observe(region);
      if (region.parentElement) resizeObserver.observe(region.parentElement);
    }
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [mode, planCanvasExpanded, placeSplitView, layoutSlabs.length]);

  const clampPlaceSplitLeftPct = useCallback((value: number) => {
    return Math.min(72, Math.max(28, value));
  }, []);

  const updatePlaceSplitLeftPctFromClientX = useCallback(
    (clientX: number) => {
      const rect = placeSplitContainerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const next = ((clientX - rect.left) / rect.width) * 100;
      setPlaceSplitLeftPct(clampPlaceSplitLeftPct(next));
    },
    [clampPlaceSplitLeftPct],
  );

  const handlePlaceSplitResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!placeSplitView) return;
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      updatePlaceSplitLeftPctFromClientX(e.clientX);
      const onPointerMove = (event: PointerEvent) => {
        updatePlaceSplitLeftPctFromClientX(event.clientX);
      };
      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [placeSplitView, updatePlaceSplitLeftPctFromClientX],
  );

  const handlePlaceSplitResizeKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!placeSplitView) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaceSplitLeftPct((prev) => clampPlaceSplitLeftPct(prev - 2));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaceSplitLeftPct((prev) => clampPlaceSplitLeftPct(prev + 2));
      } else if (e.key === "Home") {
        e.preventDefault();
        setPlaceSplitLeftPct(28);
      } else if (e.key === "End") {
        e.preventDefault();
        setPlaceSplitLeftPct(72);
      }
    },
    [clampPlaceSplitLeftPct, placeSplitView],
  );

  const showLayoutRail = false;

  /** Header kicker: customer name · job name (replaces “Layout Studio · …” on every phase). */
  const layoutStudioJobContextKicker = useMemo(() => {
    const jobLabel = job.name.trim() || "Job";
    if (!customer) return jobLabel;
    const customerName = customerDisplayName(customer);
    if (!customerName) return jobLabel;
    return `${customerName} · ${jobLabel}`;
  }, [customer, job.name]);

  const tracePieceInspectorPanel =
    selectedPiece && mode === "trace" ? (
      <div
        className="ls-inspector ls-inspector--overlay-canvas glass-panel"
        style={{ right: inspectorPanelPos.x, top: inspectorPanelPos.y }}
      >
        <div className="ls-inspector-head">
          <div
            className="ls-inspector-handle"
            onPointerDown={beginInspectorPanelDrag}
            title="Drag piece details panel"
          >
            <p className="ls-card-title">Piece details</p>
            <p className="ls-muted ls-inspector-sub">Drag to reposition.</p>
          </div>
        </div>
        <div className="ls-inspector-scroll">
        <label className="ls-field">
          Name
          <input
            className="ls-input"
            value={selectedPiece.name}
            onChange={(e) => updateSelectedPiece({ name: e.target.value })}
          />
        </label>
        <label className="ls-field">
          Notes
          <textarea
            className="ls-input ls-input--multiline"
            value={selectedPiece.notes ?? ""}
            onChange={(e) => updateSelectedPiece({ notes: e.target.value })}
            placeholder="Add piece notes for fabrication, layout, or install."
            rows={4}
          />
        </label>
        <div className="ls-piece-material">
          <p className="ls-card-title">Material</p>
          <p className={`ls-piece-material-value${selectedPieceMaterialOption ? "" : " is-unassigned"}`}>
            {selectedPieceMaterialOption?.productName ?? (options.length > 0 ? "Unassigned" : "No materials added")}
          </p>
          {options.length > 0 ? (
            <label className="ls-field">
              Assign material
              <select
                className="ls-input"
                value={selectedPieceMaterialOptionId ?? ""}
                onChange={(e) =>
                  selectedPieceMaterialRoot
                    ? assignMaterialToPieceGroup(
                        selectedPieceMaterialRoot.id,
                        e.target.value.trim() ? e.target.value : null,
                      )
                    : undefined
                }
              >
                <option value="">Unassigned</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.productName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="ls-muted ls-piece-size-line">Add materials to this area to assign one here.</p>
          )}
          {selectedPieceMaterialRoot && selectedPieceMaterialRoot.id !== selectedPiece.id ? (
            <p className="ls-muted ls-piece-size-line">
              This strip inherits from its parent piece. Changes here apply to the whole linked group.
            </p>
          ) : selectedPieceHasLinkedChildren ? (
            <p className="ls-muted ls-piece-size-line">
              Changes here also update linked splashes and miters for this piece.
            </p>
          ) : null}
        </div>
        <div className="ls-piece-size">
          <p className="ls-card-title">Size</p>
          {selectedPieceSize?.overallLabel ? (
            <p className="ls-muted ls-piece-size-line">Overall {selectedPieceSize.overallLabel}</p>
          ) : selectedPieceSize?.needsScale ? (
            <p className="ls-muted ls-piece-size-line">Set scale to view this piece size in inches.</p>
          ) : (
            <p className="ls-muted ls-piece-size-line">Size unavailable.</p>
          )}
          {selectedPieceSize?.detailLabel ? (
            <p className="ls-muted ls-piece-size-line">{selectedPieceSize.detailLabel}</p>
          ) : null}
        </div>
        {usesBlankPlanCanvas && !isPlanStripPiece(selectedPiece) ? (
          <div className="ls-inspector-sinks">
            {(selectedPiece.sinks?.length ?? 0) > 0 ? (
              <ul className="ls-sink-list">
                {selectedPiece.sinks!.map((s) => (
                  <li key={s.id} className="ls-sink-list-item">
                    <span className="ls-sink-list-name">{s.name}</span>
                    <button
                      type="button"
                      className="ls-btn ls-btn-ghost ls-sink-remove"
                      onClick={() => removeSinkFromSelected(s.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {selectedPiece.splashMeta ? (
          <p className="ls-muted">
            {isMiterStripPiece(selectedPiece) ? "Miter" : "Splash"} from parent piece (linked).
            Height {selectedPiece.splashMeta.heightIn.toFixed(2)}
            &quot; · parent edge {selectedPiece.splashMeta.parentEdgeIndex + 1}. 3D bottom (hinge): edge{" "}
            {(selectedPiece.splashMeta.bottomEdgeIndex ?? 0) + 1} — select an edge on the strip and
            choose <strong>Bottom (3D)</strong> in the edge menu to change it.
          </p>
        ) : null}
        {selectedPiece.manualDimensions?.kind === "rectangle" ? (
          <div className="ls-manual-dim">
            <p className="ls-card-title">Dimensions (in)</p>
            <label className="ls-field">
              Width
              <input
                className="ls-input"
                type="number"
                min={0.5}
                step={0.5}
                value={selectedPiece.manualDimensions.widthIn}
                onChange={(e) => {
                  const md = selectedPiece.manualDimensions;
                  if (md?.kind !== "rectangle") return;
                  applyManualDimensions({
                    kind: "rectangle",
                    widthIn: Math.max(0.5, parseFloat(e.target.value) || 0),
                    depthIn: md.depthIn,
                  });
                }}
              />
            </label>
            <label className="ls-field">
              Depth
              <input
                className="ls-input"
                type="number"
                min={0.5}
                step={0.5}
                value={selectedPiece.manualDimensions.depthIn}
                onChange={(e) => {
                  const md = selectedPiece.manualDimensions;
                  if (md?.kind !== "rectangle") return;
                  applyManualDimensions({
                    kind: "rectangle",
                    widthIn: md.widthIn,
                    depthIn: Math.max(0.5, parseFloat(e.target.value) || 0),
                  });
                }}
              />
            </label>
          </div>
        ) : null}
        {selectedPiece.manualDimensions?.kind === "lShape" ? (
          <div className="ls-manual-dim">
            <p className="ls-card-title">Dimensions (in)</p>
            <label className="ls-field">
              Leg A
              <input
                className="ls-input"
                type="number"
                min={0.5}
                step={0.5}
                value={selectedPiece.manualDimensions.legAIn}
                onChange={(e) => {
                  const md = selectedPiece.manualDimensions;
                  if (md?.kind !== "lShape") return;
                  applyManualDimensions({
                    ...md,
                    legAIn: Math.max(0.5, parseFloat(e.target.value) || 0),
                  });
                }}
              />
            </label>
            <label className="ls-field">
              Leg B
              <input
                className="ls-input"
                type="number"
                min={0.5}
                step={0.5}
                value={selectedPiece.manualDimensions.legBIn}
                onChange={(e) => {
                  const md = selectedPiece.manualDimensions;
                  if (md?.kind !== "lShape") return;
                  applyManualDimensions({
                    ...md,
                    legBIn: Math.max(0.5, parseFloat(e.target.value) || 0),
                  });
                }}
              />
            </label>
            <label className="ls-field">
              Depth
              <input
                className="ls-input"
                type="number"
                min={0.5}
                step={0.5}
                value={selectedPiece.manualDimensions.depthIn}
                onChange={(e) => {
                  const md = selectedPiece.manualDimensions;
                  if (md?.kind !== "lShape") return;
                  applyManualDimensions({
                    ...md,
                    depthIn: Math.max(0.5, parseFloat(e.target.value) || 0),
                  });
                }}
              />
            </label>
            <label className="ls-field">
              Orientation
              <select
                className="ls-input"
                value={selectedPiece.manualDimensions.orientation}
                onChange={(e) => {
                  const md = selectedPiece.manualDimensions;
                  if (md?.kind !== "lShape") return;
                  applyManualDimensions({
                    ...md,
                    orientation: Number(e.target.value) as LShapeOrientationDeg,
                  });
                }}
              >
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </label>
          </div>
        ) : null}
        <div className="ls-inspector-actions">
          <button
            type="button"
            className="ls-btn ls-btn-secondary"
            onClick={duplicateSelected}
            disabled={isPlanStripPiece(selectedPiece)}
          >
            Duplicate
          </button>
          <button type="button" className="ls-btn ls-btn-danger" onClick={deleteSelected}>
            Delete
          </button>
        </div>
        </div>
      </div>
    ) : null;

  const tracePieceListPanel =
    pieceListOpen && mode === "trace" ? (
      <div
        className="ls-piece-list-panel glass-panel"
        role="dialog"
        aria-label="Piece list"
        style={{ right: pieceListPanelPos.x, bottom: pieceListPanelPos.y }}
      >
        <div className="ls-piece-list-panel-head">
          <div
            className="ls-piece-list-panel-handle"
            onPointerDown={beginPieceListPanelDrag}
            title="Drag piece list panel"
          >
            <p className="ls-card-title">Piece list</p>
            <p className="ls-muted ls-piece-list-panel-sub">
              {pieceListEntries.length} {pieceListEntries.length === 1 ? "piece" : "pieces"}
            </p>
          </div>
          <button type="button" className="ls-btn ls-btn-ghost" onClick={() => setPieceListOpen(false)}>
            Close
          </button>
        </div>
        <div className="ls-piece-list-panel-scroll">
          {pieceListEntries.length === 0 ? (
            <p className="ls-muted ls-piece-list-empty">Add pieces on the canvas to populate this list.</p>
          ) : (
            <ul className="ls-piece-list">
              {pieceListEntries.map((entry) => (
                <li key={entry.id} className="ls-piece-list-item">
                  <div className="ls-piece-list-item-head">
                    <p className="ls-piece-list-name">{entry.name}</p>
                    {entry.pageLabel ? <span className="ls-piece-list-page">{entry.pageLabel}</span> : null}
                  </div>
                  <p className="ls-piece-list-size">{entry.sizeLabel}</p>
                  {entry.sizeDetail ? <p className="ls-piece-list-detail">{entry.sizeDetail}</p> : null}
                  <p className={`ls-piece-list-material${entry.materialAssigned ? "" : " is-unassigned"}`}>
                    Material: {entry.materialLabel}
                  </p>
                  {entry.sinkNames.length > 0 ? (
                    <p className="ls-piece-list-sinks">
                      {entry.sinkNames.map((sinkName, index) => (
                        <span key={`${entry.id}-sink-${sinkName}-${index}`} className="ls-piece-list-sink-name">
                          {index > 0 ? " • " : ""}
                          {sinkName}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {entry.splashNames.length > 0 ? (
                    <p className="ls-piece-list-children">
                      Splash: {entry.splashNames.join(" • ")}
                    </p>
                  ) : null}
                  {entry.miterNames.length > 0 ? (
                    <p className="ls-piece-list-children">
                      Miter: {entry.miterNames.join(" • ")}
                    </p>
                  ) : null}
                  <p className="ls-piece-list-notes">{entry.notes}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    ) : null;

  const traceCalibrationPopup =
    mode === "trace" && !isBlankWorkspace && calibrationPopupOpen ? (
      <div
        className="ls-calibration-popup glass-panel"
        role="dialog"
        aria-label="Set plan scale"
        style={{ left: calibrationPopupPos.x, top: calibrationPopupPos.y }}
      >
        <div className="ls-calibration-popup-head">
          <div
            className="ls-calibration-popup-handle"
            onPointerDown={beginCalibrationPopupDrag}
            title="Drag scale popup"
          >
            <p className="ls-card-title">Set scale</p>
            <p className="ls-muted ls-calibration-popup-sub">
              Pick two points on the plan, then enter the real-world distance for that segment.
            </p>
          </div>
          <button type="button" className="ls-btn ls-btn-ghost" onClick={closeCalibrationPopup}>
            Close
          </button>
        </div>
        {calibrationMode ? (
          <p className="ls-hint">
            {calibrationStep === "a" && "Click the first point on your plan."}
            {calibrationStep === "b" && "Click the second point on your plan."}
          </p>
        ) : null}
        {activeCalibration.pointA && activeCalibration.pointB && !activeCalibration.isCalibrated ? (
          <p className="ls-hint">Enter the real-world distance for that segment.</p>
        ) : null}
        {activeCalibration.pointA && activeCalibration.pointB ? (
          <div className="ls-calibration-popup-fields">
            <label className="ls-field">
              Distance
              <input
                className="ls-input"
                type="number"
                min={0.01}
                step={0.01}
                value={distanceInput}
                onChange={(e) => setDistanceInput(e.target.value)}
              />
            </label>
            <label className="ls-field">
              Unit
              <select
                className="ls-input"
                value={distanceUnit}
                onChange={(e) => setDistanceUnit(e.target.value as "in" | "ft" | "mm" | "cm")}
              >
                <option value="in">in</option>
                <option value="ft">ft</option>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
              </select>
            </label>
            <div className="ls-calibration-popup-actions">
              <button type="button" className="ls-btn ls-btn-secondary" onClick={beginCalibration}>
                Pick points again
              </button>
              <button type="button" className="ls-btn ls-btn-primary" onClick={applyCalibration}>
                Apply scale
              </button>
            </div>
            <p className="ls-muted ls-calibration-popup-metrics">
              Segment length:{" "}
              {`${Math.hypot(
                activeCalibration.pointB.x - activeCalibration.pointA.x,
                activeCalibration.pointB.y - activeCalibration.pointA.y
              ).toFixed(1)} px`}
              {activeCalibration.pixelsPerInch
                ? ` · ${activeCalibration.pixelsPerInch.toFixed(2)} px/in`
                : ""}
            </p>
          </div>
        ) : (
          <div className="ls-calibration-popup-actions">
            <button type="button" className="ls-btn ls-btn-secondary" onClick={beginCalibration}>
              Start picking points
            </button>
          </div>
        )}
      </div>
    ) : null;

  const renderPhaseToolbar = (className = "ls-phase-toggle-wrap glass-panel") => (
    <div className={className}>
      <div className="ls-segmented ls-segmented--3 ls-segmented--canvas" role="tablist" aria-label="Layout Studio phase">
        <button
          type="button"
          className={mode === "trace" ? "is-active" : ""}
          disabled={saveStatus === "saving" || phaseTransitionPending != null}
          onClick={() => handleModeChange("trace")}
        >
          Plan
        </button>
        <button
          type="button"
          className={mode === "place" ? "is-active" : ""}
          disabled={saveStatus === "saving" || phaseTransitionPending != null}
          onClick={() => handleModeChange("place")}
        >
          Layout
        </button>
        <button
          type="button"
          className={mode === "quote" ? "is-active" : ""}
          disabled={saveStatus === "saving" || phaseTransitionPending != null}
          onClick={() => handleModeChange("quote")}
        >
          Quote
        </button>
      </div>
    </div>
  );

  const renderLiveSummary = (className: string) => (
    <div className={className} aria-label="Live summary">
      <span className="ls-live-summary__label">Live summary</span>
      <span className="ls-live-summary__item">{draft.summary.areaSqFt.toFixed(1)} sq ft (est.)</span>
      <span className="ls-live-summary__sep" aria-hidden>
        •
      </span>
      <span className="ls-live-summary__item">
        {(draft.summary.profileEdgeLf ?? 0) > 0 ? (draft.summary.profileEdgeLf ?? 0).toFixed(1) : "—"} ft profile
        (est.)
      </span>
      <span className="ls-live-summary__sep" aria-hidden>
        •
      </span>
      <span className="ls-live-summary__item">{draft.summary.sinkCount} sinks</span>
      <span className="ls-live-summary__sep" aria-hidden>
        •
      </span>
      <span className="ls-live-summary__item">{draft.summary.estimatedSlabCount} slabs (est.)</span>
    </div>
  );

  const fullScreenPhaseToolbar = planCanvasExpanded
    ? renderPhaseToolbar("ls-phase-toggle-wrap glass-panel ls-phase-toggle-wrap--fullscreen")
    : null;
  const planCanvasLiveSummary =
    !showEntryHub && mode === "trace" && planCanvasExpanded
      ? renderLiveSummary("ls-live-summary ls-live-summary--overlay-canvas")
      : null;
  const placeMaterialMenu =
    options.length > 0 ? (
      <div className="ls-material-menu" ref={materialMenuRef}>
        <button
          ref={materialMenuTriggerRef}
          type="button"
          className={`ls-btn ls-btn-secondary ls-material-menu-trigger${materialMenuOpen ? " is-open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={materialMenuOpen}
          onClick={() => setMaterialMenuOpen((open) => !open)}
        >
          <span className="ls-material-menu-trigger-label">Materials</span>
          <span className="ls-material-menu-trigger-value">
            {quoteShowingAllUsedMaterials ? "All used materials" : activeOption?.productName ?? "Select material"}
          </span>
          <span className="ls-material-menu-trigger-caret" aria-hidden>
            {materialMenuOpen ? "▴" : "▾"}
          </span>
        </button>
        {renderMaterialMenuPopover(
          <>
            <div className="ls-material-menu-list">
              {mode === "quote" && canQuoteAllUsedMaterials ? (
                <div
                  className={`ls-material-menu-item ls-material-menu-item--selectable${
                    quoteShowingAllUsedMaterials ? " is-active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="ls-material-menu-select"
                    disabled={saveStatus === "saving"}
                    onClick={() => {
                      setQuoteMaterialScope(QUOTE_ALL_USED_MATERIALS_SCOPE);
                      setMaterialMenuOpen(false);
                    }}
                  >
                    <span className="ls-material-menu-copy">
                      <span className="ls-material-menu-name">All used materials</span>
                      <span className="ls-material-menu-count">
                        {totalUsedMaterialPieceCount} {totalUsedMaterialPieceCount === 1 ? "piece" : "pieces"}
                      </span>
                      {quoteShowingAllUsedMaterials ? (
                        <span className="ls-material-menu-badge">Current</span>
                      ) : null}
                    </span>
                  </button>
                </div>
              ) : null}
              {options.map((option) => (
                <div
                  key={option.id}
                  className={`ls-material-menu-item ls-material-menu-item--selectable${
                    !quoteShowingAllUsedMaterials && activeOption?.id === option.id ? " is-active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="ls-material-menu-select"
                    disabled={saveStatus === "saving"}
                    onClick={() => {
                      if (mode === "quote") setQuoteMaterialScope("active");
                      void selectMaterialOption(option.id);
                    }}
                  >
                    <span className="ls-material-menu-copy">
                      <span className="ls-material-menu-name">{option.productName}</span>
                      <span className="ls-material-menu-count">
                        {materialPieceCounts.get(option.id) ?? 0}{" "}
                        {(materialPieceCounts.get(option.id) ?? 0) === 1 ? "piece" : "pieces"}
                      </span>
                      {!quoteShowingAllUsedMaterials && activeOption?.id === option.id ? (
                        <span className="ls-material-menu-badge">Current</span>
                      ) : null}
                    </span>
                  </button>
                  {onRemoveMaterialOption ? (
                    <button
                      type="button"
                      className="ls-material-menu-remove"
                      aria-label={`Remove ${option.productName}`}
                      title={`Remove ${option.productName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveMaterialOption(option.id);
                      }}
                    >
                      x
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {onOpenAddMaterials ? (
              <button
                type="button"
                className="ls-material-menu-add"
                role="menuitem"
                onClick={() => {
                  setMaterialMenuOpen(false);
                  onOpenAddMaterials();
                }}
              >
                + Add material
              </button>
            ) : null}
          </>,
        )}
      </div>
    ) : (
      <p className="ls-option-strip-hint ls-muted">
        No slab options on this job yet — add materials from the catalog or “Add product / slab” on the job.
      </p>
    );
  const quoteToolbar = mode === "quote" ? (
    <div className="ls-plan-toolbar ls-place-toolbar ls-quote-toolbar" role="toolbar" aria-label="Quote toolbar">
      <div className="ls-plan-toolbar-group">
        <button
          type="button"
          className="ls-plan-toolbar-btn"
          onClick={() => void handleBack()}
          disabled={saveStatus === "saving" || backNavigationPending}
          title="Back to comparison"
          aria-label="Back to comparison"
        >
          <IconBack />
        </button>
      </div>
      <span className="ls-plan-toolbar-divider" aria-hidden />
      <div className="ls-plan-toolbar-group ls-place-toolbar-group-material">
        {placeMaterialMenu}
      </div>
      <span className="ls-plan-toolbar-spacer" aria-hidden />
      <div className="ls-plan-toolbar-group ls-place-toolbar-group-actions ls-quote-toolbar-group-actions">
        <button
          type="button"
          className="ls-plan-toolbar-btn"
          onClick={() => setLayoutQuoteSettingsOpen(true)}
          title="Quote options"
          aria-label="Quote options"
          disabled={!activeOption}
        >
          <IconSettings />
        </button>
        <button
          type="button"
          className="ls-plan-toolbar-btn"
          onClick={() => setPlanCanvasExpanded((v) => !v)}
          title={planCanvasExpanded ? "Exit full screen" : "Expand quote workspace"}
          aria-label={planCanvasExpanded ? "Exit full screen" : "Expand quote workspace"}
        >
          {planCanvasExpanded ? <IconFullscreenExit /> : <IconFullscreenEnter />}
        </button>
      </div>
    </div>
  ) : null;

  const busyOverlayPhaseTransition =
    phaseTransitionPending != null && !backNavigationPending && !uploading && !pdfRenderBusy;
  const busyOverlayVisible =
    backNavigationPending || busyOverlayPhaseTransition || uploading || pdfRenderBusy;
  const busyOverlaySaving = backNavigationPending && !uploading && !pdfRenderBusy;
  const backNavigationProgressLabel = Math.round(backNavigationProgress ?? 0);
  const phaseTransitionLabel =
    phaseTransitionPending === "trace"
      ? "Plan"
      : phaseTransitionPending === "place"
        ? "Layout"
        : phaseTransitionPending === "quote"
          ? "Quote"
          : "Layout";

  return (
    <div
      className={`ls-root${layoutQuoteModalOpen && activeOption ? " ls-root--layout-quote-modal" : ""}${
        planCanvasExpanded ? " ls-root--plan-fullscreen" : ""
      }`}
    >
      <header className="ls-header glass-panel">
        <div className="ls-header-top">
          <button
            type="button"
            className={mode === "place" ? "ls-plan-toolbar-btn" : "ls-back"}
            onClick={() => void handleBack()}
            disabled={saveStatus === "saving" || backNavigationPending}
            title={mode === "place" ? "Back to comparison" : undefined}
            aria-label={mode === "place" ? "Back to comparison" : undefined}
          >
            {mode === "place" ? <IconBack /> : "← Back"}
          </button>
          <div className="ls-header-titles">
            <p className="ls-kicker">{layoutStudioJobContextKicker}</p>
            {mode === "quote" ? (
              <>
                <h1 className="ls-title">{activeAreaName ? `${activeAreaName} layout` : "Shared kitchen plan"}</h1>
                <p className="ls-sub">
                  {activeOption ? (
                    <>
                      Comparing on <strong>{activeOption.productName}</strong>
                    </>
                  ) : (
                    <>Draw the plan first — add slab options from the catalog when you are ready.</>
                  )}
                </p>
              </>
            ) : null}
          </div>
          <div className="ls-save-cluster">
            <span className={`ls-save-pill ls-save-pill--${saveStatus}`}>
              {saveStatus === "saving" && "Saving…"}
              {saveStatus === "saved" && "Layout saved"}
              {saveStatus === "error" && "Save failed"}
              {saveStatus === "idle" && " "}
            </span>
            {mode !== "quote" ? (
              <button
                type="button"
                className="ls-btn ls-btn-primary"
                disabled={showEntryHub}
                onClick={() => void save(draftRef.current)}
              >
                Save layout
              </button>
            ) : null}
          </div>
        </div>
        {saveError ? (
          <p className="ls-warning" role="alert">
            {saveError}
          </p>
        ) : null}
        {uploadError ? (
          <p className="ls-warning" role="alert">
            {uploadError}
          </p>
        ) : null}
      </header>

      <input
        ref={entryUploadInputRef}
        type="file"
        className="sr-only"
        accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleUpload(f);
        }}
      />

      {showEntryHub ? (
        <div className="ls-entry-only">
          <StudioEntryHub
            kicker={layoutStudioJobContextKicker}
            onChooseUpload={() => entryUploadInputRef.current?.click()}
            onChooseBlank={startBlankLayout}
            uploading={uploading}
          />
        </div>
      ) : (
        <div
          className={`ls-body${
            mode === "place" || mode === "quote" ? " ls-body--place-or-quote" : ""
          }${mode === "trace" ? " ls-body--trace" : ""}${
            !showLayoutRail && mode !== "trace" ? " ls-body--no-rail" : ""
          }`}
        >
        {showLayoutRail ? (
        <aside className="ls-rail glass-panel">
          {mode === "trace" && !isBlankWorkspace ? (
            <div className="ls-stack">
              <div className="ls-tool-grid">
                {(
                  [
                    ["select", "Select"],
                    ["rect", "Rectangle"],
                    ["lShape", "L-shape"],
                    ["polygon", "Polygon"],
                    ["orthoDraw", "Ortho draw"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`ls-tool ${tool === id ? "is-active" : ""}`}
                    onClick={() => setTool(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="ls-calibration-card">
                <p className="ls-card-title">Scale</p>
                <p className="ls-muted">
                  Calibrate one known dimension to size your pieces accurately.
                </p>
                <button
                  type="button"
                  className="ls-btn ls-btn-secondary"
                  onClick={beginCalibration}
                >
                  Set scale
                </button>
                {calibrationMode ? (
                  <p className="ls-hint">
                    {calibrationStep === "a" && "Click the first point on your plan."}
                    {calibrationStep === "b" && "Click the second point."}
                  </p>
                ) : null}
                {activeCalibration.pointA && activeCalibration.pointB && !activeCalibration.isCalibrated ? (
                  <p className="ls-hint">Enter the real-world distance for that segment.</p>
                ) : null}
                {activeCalibration.pointA && activeCalibration.pointB ? (
                  <div className="ls-calibration-form">
                    <label className="ls-field">
                      Distance
                      <input
                        className="ls-input"
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={distanceInput}
                        onChange={(e) => setDistanceInput(e.target.value)}
                      />
                    </label>
                    <label className="ls-field">
                      Unit
                      <select
                        className="ls-input"
                        value={distanceUnit}
                        onChange={(e) => setDistanceUnit(e.target.value as "in" | "ft" | "mm" | "cm")}
                      >
                        <option value="in">in</option>
                        <option value="ft">ft</option>
                        <option value="mm">mm</option>
                        <option value="cm">cm</option>
                      </select>
                    </label>
                    <button type="button" className="ls-btn ls-btn-primary" onClick={applyCalibration}>
                      Apply scale
                    </button>
                    <p className="ls-muted">
                      Segment length:{" "}
                      {activeCalibration.pointA && activeCalibration.pointB
                        ? `${Math.hypot(
                            activeCalibration.pointB.x - activeCalibration.pointA.x,
                            activeCalibration.pointB.y - activeCalibration.pointA.y
                          ).toFixed(1)} px`
                        : "—"}
                      {activeCalibration.pixelsPerInch
                        ? ` · ${activeCalibration.pixelsPerInch.toFixed(2)} px/in`
                        : ""}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </aside>
        ) : null}

        <div className="ls-canvas-column">
          {!planCanvasExpanded ? renderPhaseToolbar() : null}
          <section
            className={`ls-canvas-shell glass-panel${mode === "trace" ? " ls-canvas-shell--trace" : ""}${
              mode === "place" || mode === "quote" ? " ls-canvas-shell--tall" : ""
            }${mode === "quote" ? " ls-canvas-shell--quote" : ""}`}
          >
          {mode === "trace" && !showEntryHub ? (
            <input
              id="ls-main-upload"
              ref={uploadInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleUpload(f);
              }}
            />
          ) : null}
          {mode === "quote" ? (
            activeOption ? (
              <>
                {planCanvasExpanded ? fullScreenPhaseToolbar : null}
                {quoteToolbar}
                {quoteShowingAllUsedMaterials ? (
                  <QuotePhaseAllMaterialsView
                    job={job}
                    materials={quoteAllMaterialsSections}
                    pixelsPerInch={draft.calibration.pixelsPerInch}
                    tracePlanWidth={draft.source?.sourceWidthPx ?? null}
                    tracePlanHeight={draft.source?.sourceHeightPx ?? null}
                    showPieceLabels={showPieceLabels}
                    quoteSettings={mergedQuoteSettings}
                    onSaveQuoteSettings={saveLayoutQuoteSettings}
                    onOpenQuoteSettings={() => setLayoutQuoteSettingsOpen(true)}
                    customerExclusions={mergedCustomerExclusions}
                    onSetCustomerExclusion={setCustomerExclusion}
                  />
                ) : (
                  <QuotePhaseView
                    job={job}
                    option={activeOption}
                    draft={activeMaterialQuoteDraft}
                    pieces={placeVisiblePieces}
                    placements={activeMaterialPlacements}
                    previewPieces={layoutPreviewVisiblePieces}
                    previewWorkspaceKind={layoutPreviewWorkspaceKind}
                    slabs={layoutSlabs}
                    activeSlabId={activeSlabId ?? layoutSlabs[0]?.id ?? null}
                    onActiveSlab={(id) => setActiveSlabId(id)}
                    showPieceLabels={showPieceLabels}
                    fullscreen={planCanvasExpanded}
                    quoteSettings={mergedQuoteSettings}
                    onSaveQuoteSettings={saveLayoutQuoteSettings}
                    onOpenQuoteSettings={() => setLayoutQuoteSettingsOpen(true)}
                    customerExclusions={mergedCustomerExclusions}
                    onSetCustomerExclusion={setCustomerExclusion}
                  />
                )}
                <div className="ls-canvas-footer ls-quote-export-footer">
                  <button
                    type="button"
                    className="ls-btn ls-btn-primary"
                    disabled={saveStatus === "saving"}
                    onClick={() => setLayoutQuoteModalOpen(true)}
                  >
                    Export quote
                  </button>
                </div>
              </>
            ) : (
              <>
                {planCanvasExpanded ? fullScreenPhaseToolbar : null}
                {quoteToolbar}
                <div className="ls-phase-empty ls-phase-empty--quote glass-panel">
                  <p className="ls-phase-empty-kicker">Quote</p>
                  <h2 className="ls-phase-empty-title">Select a material option</h2>
                  <p className="ls-muted">
                    Add a slab or product to this job from the catalog, then return here to review option-specific
                    pricing and placement. Your shared plan is already saved on the job.
                  </p>
                  <Link className="ls-btn ls-btn-primary" to={`/compare/jobs/${job.id}/add`}>
                    Add product / slab
                  </Link>
                </div>
              </>
            )
          ) : mode === "trace" ? (
            isBlankWorkspace ? (
              <div
                className={`ls-plan-blank-shell${planCanvasExpanded ? " ls-plan-blank-shell--fullscreen" : ""}`}
                role={planCanvasExpanded ? "dialog" : undefined}
                aria-modal={planCanvasExpanded ? true : undefined}
                aria-label={planCanvasExpanded ? "Plan canvas — full screen" : undefined}
              >
                {fullScreenPhaseToolbar}
                <div className="ls-plan-toolbar" role="toolbar" aria-label="Plan canvas tools">
                  <div className="ls-plan-toolbar-group">
                    {planCanvasExpanded ? (
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        onClick={() => void handleBack()}
                        disabled={saveStatus === "saving" || backNavigationPending}
                        title="Back to comparison"
                        aria-label="Back to comparison"
                      >
                        <IconBack />
                      </button>
                    ) : null}
                    <label
                      className={`ls-plan-toolbar-btn ls-plan-toolbar-pdf${uploading ? " is-busy" : ""}`}
                      htmlFor="ls-main-upload"
                      title="Add a PDF or image (replaces blank layout)"
                      aria-label="Add a PDF or image plan"
                    >
                      <span>PDF</span>
                    </label>
                  </div>
                  <span className="ls-plan-toolbar-divider" aria-hidden />
                  <div className="ls-plan-toolbar-group" role="group" aria-label="Pointer tool">
                    <button
                      type="button"
                      className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${tool === "select" ? " is-active" : ""}`}
                      aria-pressed={tool === "select"}
                      onClick={() => setTool("select")}
                      title="Select"
                      aria-label="Select"
                    >
                      <IconSelectCursor />
                    </button>
                  </div>
                  <div className="ls-plan-toolbar-group" role="group" aria-label="Undo and redo">
                    <button
                      type="button"
                      className="ls-plan-toolbar-btn"
                      disabled={undoStack.length === 0}
                      onClick={() => undo()}
                      title="Undo"
                      aria-label="Undo"
                    >
                      <IconUndo />
                    </button>
                    <button
                      type="button"
                      className="ls-plan-toolbar-btn"
                      disabled={redoStack.length === 0}
                      onClick={() => redo()}
                      title="Redo"
                      aria-label="Redo"
                    >
                      <IconRedo />
                    </button>
                  </div>
                  <div className="ls-plan-toolbar-group" role="group" aria-label="Add piece">
                    <button
                      type="button"
                      className="ls-plan-toolbar-btn"
                      onClick={() => setRectSheetOpen(true)}
                      title="Rectangle — width & depth"
                      aria-label="Add rectangle — width and depth"
                    >
                      <IconToolRect />
                    </button>
                  </div>
                  <div className="ls-plan-toolbar-section" role="group" aria-label="Draw tools">
                    <div className="ls-segmented ls-segmented--tool-tabs ls-plan-toolbar-tool-tabs" role="tablist" aria-label="Shape drawing tools">
                      {(
                        [
                          ["rect", IconToolRect, "Rectangle (drag)"],
                          ["polygon", IconToolPolygon, "Polygon"],
                          ["orthoDraw", IconToolOrtho, "Ortho draw"],
                        ] as const
                      ).map(([id, Icon, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={tool === id ? "is-active" : ""}
                          aria-pressed={tool === id}
                          onClick={() => {
                            if (id === "orthoDraw" && tool === "orthoDraw") {
                              blankPlanRef.current?.cancelOrthoDraw();
                              return;
                            }
                            setTool(id);
                          }}
                          title={label}
                          aria-label={label}
                        >
                          <Icon />
                        </button>
                      ))}
                      <button
                        type="button"
                        className="ls-plan-toolbar-tool-tab-action"
                        onClick={() => setLSheetOpen(true)}
                        title="L-shape — legs & depth"
                        aria-label="Add L-shape — legs and depth"
                      >
                        <IconToolLShape />
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${tool === "snapLines" ? " is-active" : ""}`}
                      aria-pressed={tool === "snapLines"}
                      onClick={() => setTool("snapLines")}
                      title="Snap lines"
                      aria-label="Snap lines"
                    >
                      <IconToolSnapLines />
                    </button>
                    <div className="ls-plan-toolbar-group ls-plan-toolbar-group--seam-join">
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${tool === "join" ? " is-active" : ""}`}
                        aria-pressed={tool === "join"}
                        disabled={!joinAvailable}
                        onClick={() => {
                          if (!joinAvailable) return;
                          setTool((t) => (t === "join" ? "select" : "join"));
                        }}
                        title={
                          joinAvailable
                            ? "Join — merge along one flush edge (full or L-shape; click piece 1, then piece 2)"
                            : "Join — snap two pieces flush with Snap lines first"
                        }
                        aria-label="Join pieces"
                      >
                        <IconToolJoin />
                      </button>
                      <div
                        className="ls-segmented ls-segmented--tool-tabs ls-plan-toolbar-tool-tabs"
                        role="tablist"
                        aria-label="Corner tools"
                      >
                        {(
                          [
                            [
                              "cornerRadius",
                              IconToolCornerRadius,
                              "Corner radius — choose radius, then two adjacent edges (convex or inside corners)",
                            ],
                            [
                              "connectCorner",
                              IconToolConnectCorner,
                              "Connect — remove edge arcs at a 90° corner (click one edge, then the adjacent edge)",
                            ],
                            [
                              "chamferCorner",
                              IconToolChamfer,
                              "Chamfer — choose size, then two adjacent edges to cut the corner",
                            ],
                          ] as const
                        ).map(([id, Icon, label]) => (
                          <button
                            key={id}
                            type="button"
                            className={tool === id ? "is-active" : ""}
                            aria-pressed={tool === id}
                            onClick={() => setTool((t) => (t === id ? "select" : id))}
                            title={label}
                            aria-label={label}
                          >
                            <Icon />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <span className="ls-plan-toolbar-divider" aria-hidden />
                  <div className="ls-plan-toolbar-group">
                    <button
                      type="button"
                      className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${showEdgeDimensions ? " is-active" : ""}`}
                      aria-pressed={showEdgeDimensions}
                      onClick={() => setShowEdgeDimensions((v) => !v)}
                      title="Edge dimensions (123)"
                      aria-label="Edge dimensions"
                    >
                      <IconDimensions />
                    </button>
                    <button
                      type="button"
                      className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${showPieceLabels ? " is-active" : ""}`}
                      aria-pressed={showPieceLabels}
                      onClick={() => setShowPieceLabels((v) => !v)}
                      title="Piece labels (text)"
                      aria-label="Piece labels"
                    >
                      <IconPieceLabels />
                    </button>
                    <button
                      type="button"
                      className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${pieceListOpen ? " is-active" : ""}`}
                      aria-pressed={pieceListOpen}
                      onClick={() => setPieceListOpen((open) => !open)}
                      title="Piece list"
                      aria-label="Piece list"
                    >
                      <IconPieceList />
                    </button>
                  </div>
                  {selectedPieceId ? (
                    <div className="ls-plan-toolbar-group" role="group" aria-label="Rotate selected piece">
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        onClick={() => rotateSelectedPlanPiece(-90)}
                        title="Rotate 90° counter-clockwise"
                        aria-label="Rotate 90 degrees counter-clockwise"
                      >
                        <IconRotateCCW />
                      </button>
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        onClick={() => rotateSelectedPlanPiece(90)}
                        title="Rotate 90° clockwise"
                        aria-label="Rotate 90 degrees clockwise"
                      >
                        <IconRotateCW />
                      </button>
                    </div>
                  ) : null}
                  <span className="ls-plan-toolbar-spacer" aria-hidden />
                  <div
                    className="ls-plan-toolbar-group ls-plan-toolbar-group--zoom"
                    role="group"
                    aria-label="Zoom view"
                  >
                    <span className="ls-plan-toolbar-zoom-heading">Zoom</span>
                    <button
                      type="button"
                      className="ls-plan-toolbar-btn"
                      onClick={() => blankPlanRef.current?.zoomOut()}
                      disabled={blankViewZoom <= BLANK_VIEW_ZOOM_MIN}
                      title="Zoom out"
                      aria-label="Zoom out"
                    >
                      <IconZoomOut />
                    </button>
                    <span className="ls-plan-toolbar-zoom-pct" aria-live="polite">
                      {blankPlanZoomDisplayPct(blankViewZoom)}%
                    </span>
                    <button
                      type="button"
                      className="ls-plan-toolbar-btn"
                      onClick={() => blankPlanRef.current?.zoomIn()}
                      disabled={blankViewZoom >= BLANK_VIEW_ZOOM_MAX}
                      title="Zoom in"
                      aria-label="Zoom in"
                    >
                      <IconZoomIn />
                    </button>
                    <button
                      type="button"
                      className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${planBoxZoomActive ? " is-active" : ""}`}
                      aria-pressed={planBoxZoomActive}
                      title="Drag a box on the plan to zoom to that area"
                      aria-label="Zoom box — drag to frame area"
                      onClick={() => blankPlanRef.current?.toggleBoxZoom()}
                    >
                      <IconZoomMarquee />
                    </button>
                    <button
                      type="button"
                      className="ls-plan-toolbar-btn"
                      disabled={!selectedPieceId}
                      title={selectedPieceId ? "Fit the selected piece in view" : "Select a piece first"}
                      aria-label="Zoom to selected piece"
                      onClick={() => blankPlanRef.current?.zoomToSelected()}
                    >
                      <IconZoomFitSelection />
                    </button>
                    <button
                      type="button"
                      className="ls-plan-toolbar-btn"
                      title="Center and zoom to show every piece on the plan"
                      aria-label="Reset view — show all pieces"
                      onClick={() => blankPlanRef.current?.fitAllPiecesInView()}
                    >
                      <IconZoomResetView />
                    </button>
                  </div>
                </div>
                <div className="ls-trace-canvas-with-inspector">
                  <div className="ls-trace-canvas-main ls-trace-canvas-main--plan-host">
                    <div className="ls-plan-canvas-stage">
                      <BlankPlanWorkspace
                      ref={blankPlanRef}
                      zoomUiPlacement="toolbar"
                      onViewZoomChange={onBlankViewZoomChange}
                      onBoxZoomModeChange={setPlanBoxZoomActive}
                      tool={tool}
                      pieces={draft.pieces}
                      selectedPieceId={selectedPieceId}
                      selectedEdge={selectedEdge}
                      selectedFilletEdges={selectedFilletEdges}
                      showLabels={showPieceLabels}
                      sourcePageNumberByIndex={sourcePageNumberByIndex}
                      showEdgeDimensions={showEdgeDimensions}
                      snapAlignmentMode={snapAlignmentMode}
                      onSelectPiece={(id) => {
                        setSelectedPieceId(id);
                        setSelectedFilletEdges([]);
                      }}
                      onSelectEdge={(sel) => {
                        setSelectedEdge(sel);
                        if (sel) setSelectedFilletEdges([]);
                      }}
                      onSelectFilletEdges={setSelectedFilletEdges}
                      onPiecesChange={onPiecesChange}
                      onRequestSplashForEdge={(sel, kind) => {
                        setSplashTargetEdge(sel);
                        setEdgeStripKind(kind);
                        setSplashHeightInput("4");
                        setSplashModalOpen(true);
                      }}
                      onRequestAddSinkForEdge={(sel) => {
                        setSelectedPieceId(sel.pieceId);
                        setAddSinkEdge(sel);
                        setAddSinkModalOpen(true);
                      }}
                      onToggleProfileEdge={toggleProfileEdge}
                      onSetSplashBottomEdge={setSplashBottomEdge}
                      onPiecesChangeLive={onPiecesChangeLive}
                      onPieceDragStart={pushUndoSnapshot}
                      slabs={layoutSlabs}
                      placements={draft.placements}
                      pixelsPerInch={draft.calibration.pixelsPerInch}
                      fitAllPiecesSignal={planFitAllPiecesTick}
                      onTraceToolChange={setTool}
                      fitViewportWidth={planCanvasExpanded}
                    />
                    {planCanvasLiveSummary}
                    <button
                      type="button"
                      className="ls-plan-canvas-expand-fab"
                      onClick={() => setPlanCanvasExpanded((v) => !v)}
                      title={planCanvasExpanded ? "Exit full screen" : "Expand plan canvas"}
                      aria-label={planCanvasExpanded ? "Exit full screen" : "Expand plan canvas"}
                    >
                      {planCanvasExpanded ? <IconFullscreenExit /> : <IconFullscreenEnter />}
                    </button>
                    </div>
                    {tracePieceInspectorPanel}
                    {tracePieceListPanel}
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={`ls-plan-blank-shell${planCanvasExpanded ? " ls-plan-blank-shell--fullscreen" : ""}`}
                role={planCanvasExpanded ? "dialog" : undefined}
                aria-modal={planCanvasExpanded ? true : undefined}
                aria-label={planCanvasExpanded ? "Plan canvas — full screen" : undefined}
              >
              {fullScreenPhaseToolbar}
              <div className="ls-trace-canvas-with-inspector">
                <div className="ls-trace-canvas-main ls-trace-canvas-main--plan-host">
                  <div className="ls-plan-toolbar" role="toolbar" aria-label="Plan canvas tools">
                    <div className="ls-plan-toolbar-group">
                    {planCanvasExpanded ? (
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        onClick={() => void handleBack()}
                        disabled={saveStatus === "saving" || backNavigationPending}
                        title="Back to comparison"
                        aria-label="Back to comparison"
                      >
                        <IconBack />
                      </button>
                    ) : null}
                      <label
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-pdf${uploading ? " is-busy" : ""}`}
                        htmlFor="ls-main-upload"
                        title="Upload PDF or image plan"
                        aria-label="Upload PDF or image plan"
                      >
                        <span>PDF</span>
                      </label>
                    </div>
                    <span className="ls-plan-toolbar-divider" aria-hidden />
                    <div className="ls-plan-toolbar-group" role="group" aria-label="Pointer tool">
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${tool === "select" ? " is-active" : ""}`}
                        aria-pressed={tool === "select"}
                        onClick={() => setTool("select")}
                        title="Select"
                        aria-label="Select"
                      >
                        <IconSelectCursor />
                      </button>
                    </div>
                    <div className="ls-plan-toolbar-group" role="group" aria-label="Undo and redo">
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        disabled={undoStack.length === 0}
                        onClick={() => undo()}
                        title="Undo"
                        aria-label="Undo"
                      >
                        <IconUndo />
                      </button>
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        disabled={redoStack.length === 0}
                        onClick={() => redo()}
                        title="Redo"
                        aria-label="Redo"
                      >
                        <IconRedo />
                      </button>
                    </div>
                    <div className="ls-plan-toolbar-group" role="group" aria-label="Add piece">
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        onClick={() => {
                          if (sourcePlanEditorActive) {
                            setRectSheetOpen(true);
                            return;
                          }
                          setTool("rect");
                        }}
                        title="Rectangle — width & depth"
                        aria-label="Add rectangle — width and depth"
                      >
                        <IconToolRect />
                      </button>
                    </div>
                    <div className="ls-plan-toolbar-section" role="group" aria-label="Trace tools">
                      <div className="ls-segmented ls-segmented--tool-tabs ls-plan-toolbar-tool-tabs" role="tablist" aria-label="Shape drawing tools">
                        {(
                          [
                            ["rect", IconToolRect, "Rectangle (drag)"],
                            ["polygon", IconToolPolygon, "Polygon"],
                            ["orthoDraw", IconToolOrtho, "Ortho draw"],
                          ] as const
                        ).map(([id, Icon, label]) => (
                          <button
                            key={id}
                            type="button"
                            className={tool === id ? "is-active" : ""}
                            aria-pressed={tool === id}
                            onClick={() => {
                              if (id === "orthoDraw" && tool === "orthoDraw") {
                                if (sourcePlanEditorActive) {
                                  blankPlanRef.current?.cancelOrthoDraw();
                                } else {
                                  setTool("select");
                                }
                                return;
                              }
                              setTool(id);
                            }}
                            title={label}
                            aria-label={label}
                          >
                            <Icon />
                          </button>
                        ))}
                        <button
                          type="button"
                          className="ls-plan-toolbar-tool-tab-action"
                          onClick={() => setLSheetOpen(true)}
                          title="L-shape — legs & depth"
                          aria-label="Add L-shape — legs and depth"
                        >
                          <IconToolLShape />
                        </button>
                      </div>
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${tool === "snapLines" ? " is-active" : ""}`}
                        aria-pressed={tool === "snapLines"}
                        onClick={() => setTool("snapLines")}
                        title="Snap lines"
                        aria-label="Snap lines"
                      >
                        <IconToolSnapLines />
                      </button>
                      <div className="ls-plan-toolbar-group ls-plan-toolbar-group--seam-join">
                        <button
                          type="button"
                          className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${tool === "join" ? " is-active" : ""}`}
                          aria-pressed={tool === "join"}
                          disabled={!joinAvailable}
                          onClick={() => {
                            if (!joinAvailable) return;
                            setTool((t) => (t === "join" ? "select" : "join"));
                          }}
                          title={
                            joinAvailable
                              ? "Join — merge along one flush edge (full or L-shape; click piece 1, then piece 2)"
                              : "Join — snap two pieces flush with Snap lines first"
                          }
                          aria-label="Join pieces"
                        >
                          <IconToolJoin />
                        </button>
                        <div
                          className="ls-segmented ls-segmented--tool-tabs ls-plan-toolbar-tool-tabs"
                          role="tablist"
                          aria-label="Corner tools"
                        >
                          {(
                            [
                              [
                                "cornerRadius",
                                IconToolCornerRadius,
                                "Corner radius — choose radius, then two adjacent edges (convex or inside corners)",
                              ],
                              [
                                "connectCorner",
                                IconToolConnectCorner,
                                "Connect — remove edge arcs at a 90° corner (click one edge, then the adjacent edge)",
                              ],
                              [
                                "chamferCorner",
                                IconToolChamfer,
                                "Chamfer — choose size, then two adjacent edges to cut the corner",
                              ],
                            ] as const
                          ).map(([id, Icon, label]) => (
                            <button
                              key={id}
                              type="button"
                              className={tool === id ? "is-active" : ""}
                              aria-pressed={tool === id}
                              onClick={() => setTool((t) => (t === id ? "select" : id))}
                              title={label}
                              aria-label={label}
                            >
                              <Icon />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <span className="ls-plan-toolbar-divider" aria-hidden />
                    <div className="ls-plan-toolbar-group">
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${showEdgeDimensions ? " is-active" : ""}`}
                        aria-pressed={showEdgeDimensions}
                        onClick={() => setShowEdgeDimensions((v) => !v)}
                        title="Edge dimensions (123)"
                        aria-label="Edge dimensions"
                      >
                        <IconDimensions />
                      </button>
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${showPieceLabels ? " is-active" : ""}`}
                        aria-pressed={showPieceLabels}
                        onClick={() => setShowPieceLabels((v) => !v)}
                        title="Piece labels (text)"
                        aria-label="Piece labels"
                      >
                        <IconPieceLabels />
                      </button>
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${pieceListOpen ? " is-active" : ""}`}
                        aria-pressed={pieceListOpen}
                        onClick={() => setPieceListOpen((open) => !open)}
                        title="Piece list"
                        aria-label="Piece list"
                      >
                        <IconPieceList />
                      </button>
                    </div>
                    {selectedPieceId ? (
                      <div className="ls-plan-toolbar-group" role="group" aria-label="Rotate selected piece">
                        <button
                          type="button"
                          className="ls-plan-toolbar-btn"
                          onClick={() => rotateSelectedPlanPiece(-90)}
                          title="Rotate 90° counter-clockwise"
                          aria-label="Rotate 90 degrees counter-clockwise"
                        >
                          <IconRotateCCW />
                        </button>
                        <button
                          type="button"
                          className="ls-plan-toolbar-btn"
                          onClick={() => rotateSelectedPlanPiece(90)}
                          title="Rotate 90° clockwise"
                          aria-label="Rotate 90 degrees clockwise"
                        >
                          <IconRotateCW />
                        </button>
                      </div>
                    ) : null}
                    {!isBlankWorkspace ? (
                      <div className="ls-plan-toolbar-group" role="group" aria-label="Source visibility mode">
                        <div className="ls-segmented ls-segmented--2 ls-segmented--canvas" role="tablist" aria-label="Trace or plan mode">
                        <button
                          type="button"
                          className={sourceCanvasMode === "trace" ? "is-active" : ""}
                          aria-pressed={sourceCanvasMode === "trace"}
                          onClick={() => switchSourceCanvasMode("trace")}
                          title="Trace mode — show the source PDF or image"
                          aria-label="Trace mode — show the source PDF or image"
                        >
                          Trace
                        </button>
                        <button
                          type="button"
                          className={sourceCanvasMode === "plan" ? "is-active" : ""}
                          aria-pressed={sourceCanvasMode === "plan"}
                          onClick={() => switchSourceCanvasMode("plan")}
                          title="Plan mode — hide the source PDF or image"
                          aria-label="Plan mode — hide the source PDF or image"
                        >
                          Plan
                        </button>
                        </div>
                      </div>
                    ) : null}
                    {!isBlankWorkspace ? (
                      <div className="ls-plan-toolbar-group" role="group" aria-label="Area materials">
                        <div className="ls-material-menu" ref={materialMenuRef}>
                          <button
                            ref={materialMenuTriggerRef}
                            type="button"
                            className={`ls-btn ls-btn-secondary ls-material-menu-trigger${materialMenuOpen ? " is-open" : ""}`}
                            aria-haspopup="menu"
                            aria-expanded={materialMenuOpen}
                            onClick={() => setMaterialMenuOpen((open) => !open)}
                          >
                            <span className="ls-material-menu-trigger-label">Materials</span>
                            <span className="ls-material-menu-trigger-caret" aria-hidden>
                              {materialMenuOpen ? "▴" : "▾"}
                            </span>
                          </button>
                          {renderMaterialMenuPopover(
                            <>
                              <div className="ls-material-menu-list">
                                {options.length > 0 ? (
                                  options.map((option) => (
                                    <div
                                      key={option.id}
                                      className={`ls-material-menu-item${activeOption?.id === option.id ? " is-active" : ""}`}
                                    >
                                      <div className="ls-material-menu-copy">
                                        <span className="ls-material-menu-name">{option.productName}</span>
                                        {activeOption?.id === option.id ? (
                                          <span className="ls-material-menu-badge">Current</span>
                                        ) : null}
                                      </div>
                                      {onRemoveMaterialOption ? (
                                        <button
                                          type="button"
                                          className="ls-material-menu-remove"
                                          aria-label={`Remove ${option.productName}`}
                                          title={`Remove ${option.productName}`}
                                          onClick={() => onRemoveMaterialOption(option.id)}
                                        >
                                          x
                                        </button>
                                      ) : null}
                                    </div>
                                  ))
                                ) : (
                                  <p className="ls-material-menu-empty">No materials added to this area yet.</p>
                                )}
                              </div>
                              {onOpenAddMaterials ? (
                                <button
                                  type="button"
                                  className="ls-material-menu-add"
                                  role="menuitem"
                                  onClick={() => {
                                    setMaterialMenuOpen(false);
                                    onOpenAddMaterials();
                                  }}
                                >
                                  + Add material
                                </button>
                              ) : null}
                            </>,
                          )}
                        </div>
                      </div>
                    ) : null}
                    {sourcePlanEditorActive ? (
                      <div className="ls-plan-toolbar-group" role="group" aria-label="Plan arrangement">
                        <button
                          type="button"
                          className="ls-btn ls-btn-secondary"
                          onClick={arrangeSourcePlanEditorPieces}
                          title='Arrange pieces close together with about 12" spacing'
                        >
                          Arrange
                        </button>
                      </div>
                    ) : null}
                    <span className="ls-plan-toolbar-spacer" aria-hidden />
                    <div className="ls-plan-toolbar-group ls-plan-toolbar-group--zoom" role="group" aria-label="Zoom view">
                      <span className="ls-plan-toolbar-zoom-heading">Zoom</span>
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        onClick={sourcePlanEditorActive ? () => blankPlanRef.current?.zoomOut() : stepTraceZoomOut}
                        disabled={
                          sourcePlanEditorActive
                            ? blankViewZoom <= SOURCE_PLAN_EDITOR_VIEW_ZOOM_MIN
                            : traceViewZoom <= TRACE_VIEW_ZOOM_MIN
                        }
                        title="Zoom out"
                        aria-label="Zoom out"
                      >
                        <IconZoomOut />
                      </button>
                      <span className="ls-plan-toolbar-zoom-pct" aria-live="polite">
                        {sourcePlanEditorActive
                          ? `${blankPlanZoomDisplayPct(blankViewZoom)}%`
                          : `${traceViewZoomDisplayPct(traceViewZoom)}%`}
                      </span>
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        onClick={sourcePlanEditorActive ? () => blankPlanRef.current?.zoomIn() : stepTraceZoomIn}
                        disabled={
                          sourcePlanEditorActive
                            ? blankViewZoom >= BLANK_VIEW_ZOOM_MAX
                            : traceViewZoom >= TRACE_VIEW_ZOOM_MAX
                        }
                        title="Zoom in"
                        aria-label="Zoom in"
                      >
                        <IconZoomIn />
                      </button>
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${planBoxZoomActive ? " is-active" : ""}`}
                        aria-pressed={planBoxZoomActive}
                        title="Drag a box on the plan to zoom to that area"
                        aria-label="Zoom box — drag to frame area"
                        onClick={() => {
                          if (sourcePlanEditorActive) {
                            blankPlanRef.current?.toggleBoxZoom();
                          } else {
                            setPlanBoxZoomActive((v) => !v);
                          }
                        }}
                      >
                        <IconZoomMarquee />
                      </button>
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        disabled={!selectedPieceId}
                        title={selectedPieceId ? "Fit the selected piece in view" : "Select a piece first"}
                        aria-label="Zoom to selected piece"
                        onClick={() => {
                          if (sourcePlanEditorActive) {
                            blankPlanRef.current?.zoomToSelected();
                          } else {
                            setTraceZoomToSelectedTick((t) => t + 1);
                          }
                        }}
                      >
                        <IconZoomFitSelection />
                      </button>
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        title={sourcePlanEditorActive ? "Center and zoom to show every piece on the plan" : "Reset view — show the full plan"}
                        aria-label={sourcePlanEditorActive ? "Reset view — show all pieces" : "Reset view — show full plan"}
                        onClick={() => {
                          if (sourcePlanEditorActive) {
                            blankPlanRef.current?.fitAllPiecesInView();
                          } else {
                            setTraceViewZoom(1);
                            setPlanBoxZoomActive(false);
                            setTraceResetViewTick((t) => t + 1);
                          }
                        }}
                      >
                        <IconZoomResetView />
                      </button>
                    </div>
                    <span className="ls-plan-toolbar-divider" aria-hidden />
                    <span className="ls-plan-toolbar-zoom-heading" aria-live="polite">
                      {activeCalibration.isCalibrated ? "Scale set" : "Scale needed"}
                    </span>
                    <button type="button" className="ls-btn ls-btn-secondary" onClick={beginCalibration}>
                      Set scale
                    </button>
                  </div>
                  <div
                    className={`ls-trace-stage-shell${
                      draft.source?.kind === "pdf" && sourcePages.length > 1 && showSourceOnPlanCanvas
                        ? " ls-trace-stage-shell--with-pages"
                        : ""
                    }`}
                  >
                    {draft.source?.kind === "pdf" && sourcePages.length > 1 && showSourceOnPlanCanvas ? (
                      <aside className="ls-trace-page-strip" aria-label="Plan pages">
                        {sourcePages.map((page) => {
                          const thumbUrl =
                            pdfPageThumbUrls[page.index] ??
                            page.previewImageUrl ??
                            (page.index === 0 ? draft.source?.previewImageUrl ?? null : null);
                          const pageScale = page.calibration?.pixelsPerInch ?? null;
                          const pagePieceCount = pieceCountBySourcePageIndex.get(page.index) ?? 0;
                          const selected = page.index === activeSourcePage?.index;
                          return (
                            <button
                              key={page.index}
                              type="button"
                              className={`ls-trace-page-card${selected ? " is-active" : ""}`}
                              onClick={() => goToSourcePage(page.index)}
                            >
                              <span className="ls-trace-page-card-label">
                                <span>Page {page.pageNumber}</span>
                                {pagePieceCount > 0 ? (
                                  <span className="ls-trace-page-card-count">{pagePieceCount}</span>
                                ) : null}
                              </span>
                              <span
                                className="ls-trace-page-card-frame"
                                style={{ aspectRatio: `${Math.max(page.widthPx, 1)} / ${Math.max(page.heightPx, 1)}` }}
                              >
                                {thumbUrl ? (
                                  <img
                                    className="ls-trace-page-card-thumb"
                                    src={thumbUrl}
                                    alt={`Page ${page.pageNumber} thumbnail`}
                                  />
                                ) : (
                                  <span className="ls-trace-page-card-placeholder">
                                    <UploadProgressRing progress={null} compact stage="processing" />
                                    <span>Rendering</span>
                                  </span>
                                )}
                              </span>
                              <span className="ls-trace-page-card-meta">
                                {pageScale ? `${pageScale.toFixed(2)} px/in` : "Scale needed"}
                              </span>
                            </button>
                          );
                        })}
                      </aside>
                    ) : null}
                    <div className="ls-trace-page-stage">
                      {draft.source?.kind === "pdf" &&
                      sourcePages.length > 1 &&
                      showSourceOnPlanCanvas &&
                      activeSourcePage ? (
                        <div className="ls-trace-page-pager" role="group" aria-label="PDF page navigation">
                          <button
                            type="button"
                            className="ls-trace-page-pager-btn"
                            onClick={() => goToSourcePage(sourcePages[Math.max(0, activeSourcePagePos - 1)]!.index)}
                            disabled={activeSourcePagePos <= 0}
                            aria-label="Previous PDF page"
                            title="Previous page"
                          >
                            Prev
                          </button>
                          <span className="ls-trace-page-pager-label">
                            Page {activeSourcePage.pageNumber} of {sourcePages.length}
                          </span>
                          <button
                            type="button"
                            className="ls-trace-page-pager-btn"
                            onClick={() =>
                              goToSourcePage(
                                sourcePages[Math.min(sourcePages.length - 1, activeSourcePagePos + 1)]!.index,
                              )
                            }
                            disabled={activeSourcePagePos < 0 || activeSourcePagePos >= sourcePages.length - 1}
                            aria-label="Next PDF page"
                            title="Next page"
                          >
                            Next
                          </button>
                        </div>
                      ) : null}
                      {draft.source?.kind === "pdf" && showSourceOnPlanCanvas && !planCanvasDisplayUrl ? (
                        <div className="ls-trace-empty glass-panel">
                          <div className="ls-trace-empty-spinner">
                            <UploadProgressRing progress={null} stage="processing" />
                          </div>
                          <p className="ls-trace-empty-title">Rendering page…</p>
                          <p className="ls-muted">
                            {pdfRenderStatusText ??
                              (activeSourcePage ? `Loading page ${activeSourcePage.pageNumber}.` : "Loading PDF.")}
                          </p>
                        </div>
                      ) : sourcePlanEditorActive ? (
                        <BlankPlanWorkspace
                          ref={blankPlanRef}
                          zoomUiPlacement="toolbar"
                          onViewZoomChange={onBlankViewZoomChange}
                          onBoxZoomModeChange={setPlanBoxZoomActive}
                          tool={tool}
                          pieces={planCanvasPieces}
                          selectedPieceId={selectedPieceId}
                          selectedEdge={selectedEdge}
                          selectedFilletEdges={selectedFilletEdges}
                          showLabels={showPieceLabels}
                          sourcePageNumberByIndex={sourcePageNumberByIndex}
                          showEdgeDimensions={showEdgeDimensions}
                          snapAlignmentMode={snapAlignmentMode}
                          onSelectPiece={(id) => {
                            setSelectedPieceId(id);
                            setSelectedFilletEdges([]);
                          }}
                          onSelectEdge={(sel) => {
                            setSelectedEdge(sel);
                            if (sel) setSelectedFilletEdges([]);
                          }}
                          onSelectFilletEdges={setSelectedFilletEdges}
                          onPiecesChange={onPlanCanvasPiecesChange}
                          onRequestSplashForEdge={(sel, kind) => {
                            setSplashTargetEdge(sel);
                            setEdgeStripKind(kind);
                            setSplashHeightInput("4");
                            setSplashModalOpen(true);
                          }}
                          onRequestAddSinkForEdge={(sel) => {
                            setSelectedPieceId(sel.pieceId);
                            setAddSinkEdge(sel);
                            setAddSinkModalOpen(true);
                          }}
                          onToggleProfileEdge={toggleProfileEdge}
                          onSetSplashBottomEdge={setSplashBottomEdge}
                          onPiecesChangeLive={onPlanCanvasPiecesChangeLive}
                          onPieceDragStart={pushUndoSnapshot}
                          slabs={layoutSlabs}
                          placements={draft.placements}
                          pixelsPerInch={1}
                          fitAllPiecesSignal={planFitAllPiecesTick}
                          onTraceToolChange={setTool}
                          fitViewportWidth={planCanvasExpanded}
                          minViewZoom={SOURCE_PLAN_EDITOR_VIEW_ZOOM_MIN}
                        />
                      ) : (
                        <TraceWorkspace
                          displayUrl={planCanvasDisplayUrl}
                          isPdfSource={isPdfSource}
                          sourceBounds={planCanvasBounds}
                          fitPageToWidth={!planCanvasExpanded}
                          viewZoom={traceViewZoom}
                          boxZoomMode={planBoxZoomActive}
                          resetViewSignal={traceResetViewTick}
                          zoomToSelectedSignal={traceZoomToSelectedTick}
                          calibration={activeCalibration}
                          calibrationMode={calibrationMode}
                          onCalibrationPoint={onCalibrationPoint}
                          tool={tool}
                          pieces={tracePagePieces}
                          selectedPieceId={traceSelectedPieceId}
                          selectedEdge={selectedEdge}
                          onSelectPiece={setSelectedPieceId}
                          onSelectEdge={setSelectedEdge}
                          onPiecesChange={onTracePiecesChange}
                          onPiecesChangeLive={onTracePiecesChangeLive}
                          onPieceDragStart={pushUndoSnapshot}
                          onRequestSplashForEdge={(sel, kind) => {
                            setSplashTargetEdge(sel);
                            setEdgeStripKind(kind);
                            setSplashHeightInput("4");
                            setSplashModalOpen(true);
                          }}
                          onRequestAddSinkForEdge={(sel) => {
                            setSelectedPieceId(sel.pieceId);
                            setAddSinkEdge(sel);
                            setAddSinkModalOpen(true);
                          }}
                          onToggleProfileEdge={toggleProfileEdge}
                          onSetSplashBottomEdge={setSplashBottomEdge}
                          slabs={layoutSlabs}
                          placements={draft.placements}
                          newPieceSourceMeta={{
                            sourcePageIndex: activeSourcePage?.index ?? 0,
                            sourcePixelsPerInch: activeCalibration.pixelsPerInch,
                          }}
                          onViewZoomChange={onTraceViewZoomChange}
                          onBoxZoomModeChange={setPlanBoxZoomActive}
                        />
                      )}
                      {planCanvasLiveSummary}
                      <button
                        type="button"
                        className="ls-plan-canvas-expand-fab"
                        onClick={() => setPlanCanvasExpanded((v) => !v)}
                        title={planCanvasExpanded ? "Exit full screen" : "Expand plan canvas"}
                        aria-label={planCanvasExpanded ? "Exit full screen" : "Expand plan canvas"}
                      >
                        {planCanvasExpanded ? <IconFullscreenExit /> : <IconFullscreenEnter />}
                      </button>
                    </div>
                  </div>
                  {traceCalibrationPopup}
                  {tracePieceInspectorPanel}
                  {tracePieceListPanel}
                </div>
              </div>
              </div>
            )
          ) : !activeOption ? (
            <div className="ls-phase-empty ls-phase-empty--place glass-panel">
              <p className="ls-phase-empty-kicker">Layout</p>
              <h2 className="ls-phase-empty-title">No slab options yet</h2>
              <p className="ls-muted">
                The kitchen plan you draw on the Plan tab is shared for this job. When you add slab or material
                options from the catalog (or “Add product / slab” on the job), you can place the same plan on each
                stone here — without redrawing.
              </p>
              <Link className="ls-btn ls-btn-primary" to={`/compare/jobs/${job.id}/add`}>
                Add product / slab
              </Link>
            </div>
          ) : (
            <div className="ls-place-canvas-host">
              {fullScreenPhaseToolbar}
              <div className="ls-plan-toolbar ls-place-toolbar" role="toolbar" aria-label="Layout toolbar">
                <div className="ls-plan-toolbar-group">
                  <button
                    type="button"
                    className="ls-plan-toolbar-btn"
                    onClick={() => void handleBack()}
                    disabled={saveStatus === "saving" || backNavigationPending}
                    title="Back to comparison"
                    aria-label="Back to comparison"
                  >
                    <IconBack />
                  </button>
                </div>
                <span className="ls-plan-toolbar-divider" aria-hidden />
                <div className="ls-plan-toolbar-group ls-place-toolbar-group-summary">
                  {renderLiveSummary("ls-live-summary ls-live-summary--toolbar")}
                </div>
                <span className="ls-plan-toolbar-divider" aria-hidden />
                <div className="ls-plan-toolbar-group ls-place-toolbar-group-material">
                  {placeMaterialMenu}
                </div>
                <span className="ls-plan-toolbar-spacer" aria-hidden />
                <div className="ls-plan-toolbar-group ls-place-toolbar-group-actions">
                  <button
                    type="button"
                    className="ls-plan-toolbar-btn"
                    onClick={() => setPlanCanvasExpanded((v) => !v)}
                    title={planCanvasExpanded ? "Exit full screen" : "Expand layout workspace"}
                    aria-label={planCanvasExpanded ? "Exit full screen" : "Expand layout workspace"}
                  >
                    {planCanvasExpanded ? <IconFullscreenExit /> : <IconFullscreenEnter />}
                  </button>
                  <button
                    type="button"
                    className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${placeSeamMode ? " is-active" : ""}`}
                    aria-pressed={placeSeamMode}
                    disabled={!piecesHaveAnyScale(placeVisiblePieces, draft.calibration.pixelsPerInch)}
                    onClick={() => setPlaceSeamMode((v) => !v)}
                    title="Seam — hover a slab edge to split the placed piece"
                    aria-label="Seam tool"
                  >
                    <IconToolSeam />
                  </button>
                  <button
                    type="button"
                    className={`ls-btn ls-btn-secondary ls-place-layout-toggle${placeOrthoMove ? " is-active" : ""}`}
                    aria-pressed={placeOrthoMove}
                    onClick={() => setPlaceOrthoMove((v) => !v)}
                    title="Ortho — drag pieces only horizontally or vertically on the slab"
                  >
                    Ortho
                  </button>
                  <button
                    type="button"
                    className={`ls-btn ls-btn-secondary ls-place-layout-toggle${placeSplitView ? " is-active" : ""}`}
                    onClick={() => setPlaceSplitView((v) => !v)}
                    title="Place slab view and live preview stacked or side by side"
                  >
                    {placeSplitView ? "Stacked layout" : "Side-by-side layout"}
                  </button>
                </div>
              </div>
              <div
                ref={placeSplitContainerRef}
                className={`ls-place-dual${placeSplitView ? " ls-place-dual--side" : ""}`}
                style={
                  placeSplitView
                    ? ({
                        ["--ls-place-side-left" as any]: `${placeSplitLeftPct}%`,
                        ["--ls-place-side-right" as any]: `${100 - placeSplitLeftPct}%`,
                      } as CSSProperties)
                    : undefined
                }
              >
                <div
                  ref={placeSlabRegionRef}
                  className={`ls-place-region ls-place-region--slabs${
                    planCanvasExpanded && placeSplitView ? " ls-place-region--viewport-scroll" : ""
                  }`}
                  style={
                    planCanvasExpanded && placeSplitView && placeSlabRegionViewportHeight != null
                      ? {
                          height: `${placeSlabRegionViewportHeight}px`,
                          maxHeight: `${placeSlabRegionViewportHeight}px`,
                        }
                      : undefined
                  }
                >
                  <PlaceWorkspace
                    slabs={layoutSlabs}
                    activeSlabId={activeSlabId ?? layoutSlabs[0]?.id ?? null}
                    onActiveSlab={(id) => setActiveSlabId(id)}
                    pieces={placeVisiblePieces}
                    placements={activeMaterialPlacements}
                    pixelsPerInch={draft.calibration.pixelsPerInch}
                    selectedPieceId={placeSelectedPieceId}
                    onSelectPiece={setSelectedPieceId}
                    onPlacementChange={onActiveMaterialPlacementsChange}
                    onPlacementInteractionStart={pushUndoSnapshot}
                    showPieceLabels={showPieceLabels}
                    slabViewMode="column"
                    showSlabTabs={layoutSlabs.length > 1}
                    primarySlabId={primarySlabIdForPlace}
                    onRemoveSlab={requestRemoveSlabClone}
                    onRemoveSelectedPieceFromSlab={removeSelectedPieceFromSlab}
                    canRemoveSelectedFromSlab={canRemoveSelectedFromSlab}
                    onRotateSelectedPlacementOnSlab={rotateSelectedPlacementOnSlabBy}
                    onSelectedPlacementRotationLive={updatePlacementRotationLive}
                    onSelectedPlacementRotationDragStart={() => {
                      if (canRotatePlacementOnSlab) pushUndoSnapshot();
                    }}
                    onAddSlab={addSlabClone}
                    addSlabDisabled={layoutSlabs.length >= MAX_LAYOUT_SLABS}
                    addSlabTitle={`Duplicate slab material (${layoutSlabs.length}/${MAX_LAYOUT_SLABS})`}
                    orthoMove={placeOrthoMove}
                    seamMode={placeSeamMode}
                    onPlaceSeamRequest={placeSeamOnSlab}
                  />
                </div>
                {placeSplitView ? (
                  <div
                    className="ls-place-panel-resizer"
                    role="separator"
                    aria-label="Resize layout panels"
                    aria-orientation="vertical"
                    aria-valuemin={28}
                    aria-valuemax={72}
                    aria-valuenow={Math.round(placeSplitLeftPct)}
                    tabIndex={0}
                    onPointerDown={handlePlaceSplitResizePointerDown}
                    onKeyDown={handlePlaceSplitResizeKeyDown}
                  />
                ) : null}
                <div className="ls-place-region ls-place-region--preview">
                  <div className="ls-place-live-preview-frame">
                    <div
                      className="ls-place-live-preview-chrome ls-place-live-preview-chrome--tl"
                      role="presentation"
                    >
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${
                          showPieceLabels ? " is-active" : ""
                        }`}
                        aria-pressed={showPieceLabels}
                        onClick={() => setShowPieceLabels((v) => !v)}
                        title="Piece labels (layout preview)"
                        aria-label="Piece labels (layout preview)"
                      >
                        <IconPieceLabels />
                      </button>
                      <button
                        type="button"
                        className="ls-plan-toolbar-btn"
                        disabled={!canAutoNestPlace}
                        onClick={() => setAutoNestModalOpen(true)}
                        title="Auto nest pieces on the active slab"
                        aria-label="Auto nest pieces on the active slab"
                      >
                        <IconAutoNestBird />
                      </button>
                    </div>
                    <div className="ls-place-live-preview-chrome ls-place-live-preview-chrome--tr">
                      <button
                        type="button"
                        className="ls-btn ls-btn-secondary ls-place-expand-preview-btn"
                        onClick={() => setLayoutPreviewModalOpen(true)}
                      >
                        Expand
                      </button>
                    </div>
                    <PlaceLayoutPreview
                      workspaceKind={layoutPreviewWorkspaceKind}
                      pieces={layoutPreviewVisiblePieces}
                      placements={activeMaterialPlacements}
                      slabs={layoutSlabs}
                      pixelsPerInch={draft.calibration.pixelsPerInch}
                      tracePlanWidth={draft.source?.sourceWidthPx ?? null}
                      tracePlanHeight={draft.source?.sourceHeightPx ?? null}
                      showLabels={showPieceLabels}
                      selectedPieceId={placeSelectedPieceId}
                      onPieceActivate={placePieceFromLivePreview}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          {!showEntryHub &&
          mode !== "quote" &&
          !(mode === "place" && activeOption) &&
          !planCanvasExpanded ? (
            <div className="ls-canvas-footer">
              {renderLiveSummary("ls-live-summary ls-live-summary--below-canvas")}
            </div>
          ) : null}
          </section>
        </div>
      </div>
      )}

      <ManualRectangleSheet
        open={rectSheetOpen}
        title="New rectangle"
        nonSplashPieceCount={draft.pieces.filter((p) => !isPlanStripPiece(p)).length}
        staggerIn={pieceStaggerIn}
        onClose={() => setRectSheetOpen(false)}
        onSave={(piece) => commitNewPiece(piece)}
      />
      <ManualLShapeSheet
        open={lSheetOpen}
        title="New L-shape"
        nonSplashPieceCount={draft.pieces.filter((p) => !isPlanStripPiece(p)).length}
        staggerIn={pieceStaggerIn}
        onClose={() => setLSheetOpen(false)}
        onSave={(piece) => commitNewPiece(piece)}
      />
      <AddSinkModal
        open={addSinkModalOpen}
        previewRotationDeg={addSinkPreviewRotationDeg}
        onClose={() => {
          setAddSinkModalOpen(false);
          setAddSinkEdge(null);
        }}
        onConfirm={confirmAddSink}
      />

      {splashModalOpen ? (
        <div
          className="ls-modal-backdrop"
          role="presentation"
          onClick={() => {
            setSplashModalOpen(false);
            setSplashTargetEdge(null);
            setEdgeStripKind("splash");
          }}
        >
          <div
            className="ls-modal glass-panel"
            role="dialog"
            aria-labelledby="ls-splash-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="ls-splash-title" className="ls-card-title">
              {edgeStripKind === "miter" ? "Miter strip height" : "Splash height"}
            </p>
            <p className="ls-muted">
              Enter height in inches. A rectangle matching the selected edge length will be placed{" "}
              {SPLASH_PLAN_OFFSET_IN}&quot; away from that edge (perpendicular offset in plan view).
              {edgeStripKind === "miter" ? (
                <>
                  {" "}
                  In the live 3D preview, this miter strip folds <strong>down</strong> from the hinge instead
                  of up like a backsplash.
                </>
              ) : null}
            </p>
            <label className="ls-field">
              Height (in)
              <input
                className="ls-input"
                type="number"
                min={0.25}
                step={0.25}
                value={splashHeightInput}
                onChange={(e) => setSplashHeightInput(e.target.value)}
              />
            </label>
            <div className="ls-modal-actions">
              <button
                type="button"
                className="ls-btn ls-btn-secondary"
                onClick={() => {
                  setSplashModalOpen(false);
                  setSplashTargetEdge(null);
                  setEdgeStripKind("splash");
                }}
              >
                Cancel
              </button>
              <button type="button" className="ls-btn ls-btn-primary" onClick={() => confirmSplashForEdge()}>
                {edgeStripKind === "miter" ? "Add miter" : "Add splash"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {autoNestModalOpen ? (
        <div
          className="ls-modal-backdrop"
          role="presentation"
          onClick={() => setAutoNestModalOpen(false)}
        >
          <div
            className="ls-modal glass-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ls-auto-nest-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="ls-auto-nest-title" className="ls-card-title">
              Auto nest on active slab
            </p>
            <p className="ls-muted">
              Moves pieces on the active slab only — rotation, mirror, and shape are unchanged. Spacing controls
              minimum gap between piece outlines and inset from the slab edge (e.g. saw kerf / handling).
            </p>
            <label className="ls-field">
              Minimum distance between pieces (inches)
              <input
                className="ls-input"
                type="number"
                min={0}
                step={0.125}
                value={autoNestMinGapStr}
                onChange={(e) => setAutoNestMinGapStr(e.target.value)}
              />
            </label>
            <label className="ls-field">
              Distance from slab edge (inches)
              <input
                className="ls-input"
                type="number"
                min={0}
                step={0.125}
                value={autoNestEdgeInsetStr}
                onChange={(e) => setAutoNestEdgeInsetStr(e.target.value)}
              />
            </label>
            <div className="ls-modal-actions">
              <button
                type="button"
                className="ls-btn ls-btn-secondary"
                onClick={() => setAutoNestModalOpen(false)}
              >
                Cancel
              </button>
              <button type="button" className="ls-btn ls-btn-primary" onClick={applySlabAutoNest}>
                Nest pieces
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {autoNestFeedback ? (
        <div
          className="ls-modal-backdrop ls-modal-backdrop--auto-nest-feedback"
          role="presentation"
          onClick={() => setAutoNestFeedback(null)}
        >
          <div
            className="ls-modal glass-panel ls-modal--auto-nest-feedback"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ls-auto-nest-feedback-title"
            aria-describedby="ls-auto-nest-feedback-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="ls-auto-nest-feedback-title" className="ls-card-title">
              {autoNestFeedback.title}
            </p>
            <div id="ls-auto-nest-feedback-desc">
              <ul className="ls-auto-nest-feedback-list">
                {autoNestFeedback.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {autoNestFeedback.footerNote ? (
                <p className="ls-muted ls-auto-nest-feedback-note">{autoNestFeedback.footerNote}</p>
              ) : null}
            </div>
            <div className="ls-modal-actions">
              <button
                type="button"
                className="ls-btn ls-btn-primary"
                onClick={() => setAutoNestFeedback(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {removeSlabConfirmId ? (
        <div
          className="ls-modal-backdrop"
          role="presentation"
          onClick={() => setRemoveSlabConfirmId(null)}
        >
          <div
            className="ls-modal glass-panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ls-remove-slab-title"
            aria-describedby="ls-remove-slab-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="ls-remove-slab-title" className="ls-card-title">
              Remove slab?
            </p>
            <p id="ls-remove-slab-desc" className="ls-muted">
              Remove <strong>{removeSlabPendingLabel}</strong>? Any pieces on this slab will stay placed and
              move to the primary slab (positions adjust to fit).
            </p>
            <div className="ls-modal-actions">
              <button
                type="button"
                className="ls-btn ls-btn-secondary"
                onClick={() => setRemoveSlabConfirmId(null)}
              >
                Cancel
              </button>
              <button type="button" className="ls-btn ls-btn-primary" onClick={confirmRemoveSlabClone}>
                Remove slab
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quoteGateOpen ? (
        <div
          className="ls-modal-backdrop"
          role="presentation"
          onClick={() => setQuoteGateOpen(false)}
        >
          <div
            className="ls-modal glass-panel ls-modal--quote-gate"
            role="dialog"
            aria-labelledby="ls-quote-gate-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="ls-quote-gate-title" className="ls-card-title">
              Before you quote
            </p>
            <p className="ls-muted">
              A few items are worth reviewing. You can return to placement, or continue with full awareness
              that this pass may be incomplete.
            </p>
            <ul className="ls-quote-gate-list">
              {quoteGateIssues.map((i) => (
                <li key={i.id}>{i.message}</li>
              ))}
            </ul>
            <div className="ls-modal-actions">
              <button type="button" className="ls-btn ls-btn-secondary" onClick={() => setQuoteGateOpen(false)}>
                Go back
              </button>
              <button
                type="button"
                className="ls-btn ls-btn-primary"
                onClick={() => void executeQuoteTransition().catch(() => {})}
              >
                Continue to quote
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {layoutQuoteModalOpen && activeOption ? (
        <LayoutQuoteModal
          open={layoutQuoteModalOpen}
          onClose={() => setLayoutQuoteModalOpen(false)}
          customer={customer}
          job={job}
          option={activeOption}
          draft={quoteShowingAllUsedMaterials ? draft : activeMaterialQuoteDraft}
          previewPieces={quoteShowingAllUsedMaterials ? draft.pieces : layoutPreviewVisiblePieces}
          previewWorkspaceKind={quoteShowingAllUsedMaterials ? (draft.workspaceKind === "blank" ? "blank" : "source") : layoutPreviewWorkspaceKind}
          layoutSlabs={layoutSlabs}
          activeSlabId={activeSlabId ?? layoutSlabs[0]?.id ?? null}
          ownerUserId={ownerUserId}
          showPieceLabels={showPieceLabels}
          quoteSettings={mergedQuoteSettings}
          customerExclusions={mergedCustomerExclusions}
          allMaterialsSections={quoteShowingAllUsedMaterials ? quoteAllMaterialsSections : null}
        />
      ) : null}

      {layoutQuoteSettingsOpen && activeOption ? (
        <LayoutQuoteSettingsModal
          open={layoutQuoteSettingsOpen}
          onClose={() => setLayoutQuoteSettingsOpen(false)}
          initial={mergedQuoteSettings}
          onSave={saveLayoutQuoteSettings}
        />
      ) : null}

      {busyOverlayVisible ? (
        <div
          className={`ls-upload-overlay${busyOverlaySaving ? " ls-upload-overlay--saving" : ""}`}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="ls-upload-overlay__backdrop" />
          <div className="ls-upload-overlay__panel glass-panel">
            <UploadProgressRing
              progress={backNavigationPending ? backNavigationProgress : uploading ? uploadProgress : null}
              stage={backNavigationPending ? "uploading" : uploading ? uploadStage : "processing"}
              tone={busyOverlaySaving ? "success" : "default"}
              label={busyOverlayPhaseTransition ? "Loading" : undefined}
            />
            <p className="ls-upload-overlay__eyebrow">
              {backNavigationPending
                ? "Saving layout"
                : busyOverlayPhaseTransition
                  ? "Switching views"
                : uploading
                ? uploadStage === "processing"
                  ? "Preparing plan"
                  : "Uploading plan"
                : "Rendering page"}
            </p>
            <h2 className="ls-upload-overlay__title">
              {backNavigationPending
                ? `${backNavigationProgressLabel}% saved`
                : busyOverlayPhaseTransition
                  ? `Opening ${phaseTransitionLabel}...`
                : uploading
                ? uploadStage === "processing"
                  ? "Almost there..."
                  : `${Math.round(uploadProgress ?? 0)}% uploaded`
                : "Rendering PDF preview..."}
            </h2>
            <p className="ls-upload-overlay__body">
              {backNavigationPending
                ? "Storing your latest plan changes before returning."
                : busyOverlayPhaseTransition
                  ? "Saving your latest changes and loading the selected workspace."
                : uploading
                ? uploadStatusText ??
                  (uploadStage === "processing"
                    ? "Reading the file and building your plan workspace."
                    : "Sending your plan to secure storage.")
                : pdfRenderStatusText ?? "Turning the selected PDF page into a plan image."}
            </p>
          </div>
        </div>
      ) : null}

      {layoutPreviewModalOpen && mode === "place" ? (
        <div
          className="ls-modal-backdrop ls-modal-backdrop--layout-preview"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ls-layout-preview-modal-title"
          onClick={() => setLayoutPreviewModalOpen(false)}
        >
          <div
            className="ls-modal glass-panel ls-modal--layout-preview-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ls-modal-layout-preview-head">
              <h2 id="ls-layout-preview-modal-title" className="sr-only">
                Layout preview
              </h2>
              <div className="ls-modal-layout-preview-toolbar">
                <div
                  className="ls-layout-preview-mode-toggle"
                  role="group"
                  aria-label="Live layout display mode"
                >
                  <button
                    type="button"
                    className={`ls-layout-preview-mode-btn${layoutPreviewExpandedMode === "2d" ? " is-active" : ""}`}
                    aria-pressed={layoutPreviewExpandedMode === "2d"}
                    onClick={() => setLayoutPreviewExpandedMode("2d")}
                  >
                    2D
                  </button>
                  <button
                    type="button"
                    className={`ls-layout-preview-mode-btn${layoutPreviewExpandedMode === "3d" ? " is-active" : ""}`}
                    aria-pressed={layoutPreviewExpandedMode === "3d"}
                    onClick={() => setLayoutPreviewExpandedMode("3d")}
                  >
                    3D
                  </button>
                </div>
                <div className="ls-modal-layout-preview-toolbar-right">
                  {layoutPreviewExpandedMode === "3d" ? (
                    <span className="ls-layout-preview-3d-hint" aria-hidden>
                      Wheel to zoom, drag to rotate
                    </span>
                  ) : (
                    <span className="ls-layout-preview-3d-hint" aria-hidden>
                      Wheel or +/- to zoom, drag to pan
                    </span>
                  )}
                  <button
                    type="button"
                    className="ls-btn ls-btn-secondary"
                    aria-label="Close expanded layout preview"
                    onClick={() => setLayoutPreviewModalOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
            <div className="ls-modal-layout-preview-body">
              {layoutPreviewExpandedMode === "2d" ? (
                <PlaceLayoutPreview
                  workspaceKind={layoutPreviewWorkspaceKind}
                  pieces={layoutPreviewVisiblePieces}
                  placements={activeMaterialPlacements}
                  slabs={layoutSlabs}
                  pixelsPerInch={draft.calibration.pixelsPerInch}
                  tracePlanWidth={draft.source?.sourceWidthPx ?? null}
                  tracePlanHeight={draft.source?.sourceHeightPx ?? null}
                  showLabels={showPieceLabels}
                  selectedPieceId={placeSelectedPieceId}
                  previewInstanceId="modal"
                  variant="fullscreen"
                  onPieceActivate={placePieceFromLivePreview}
                />
              ) : (
                <PlaceLayoutPreview3D
                  workspaceKind={layoutPreviewWorkspaceKind}
                  pieces={layoutPreviewVisiblePieces}
                  placements={activeMaterialPlacements}
                  slabs={layoutSlabs}
                  pixelsPerInch={draft.calibration.pixelsPerInch ?? 0}
                  slabThicknessInches={slabThicknessInForPreview}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
