import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  CustomerRecord,
  JobComparisonOptionRecord,
  JobRecord,
  LayoutQuoteCustomerRowId,
  LayoutQuoteSettings,
} from "../../../types/compareQuote";
import { updateJob } from "../../../services/compareQuoteFirestore";
import { createDefaultLayoutState } from "../constants";
import { uploadJobLayoutSource } from "../services/layoutStorage";
import { useLayoutStudio } from "../hooks/useLayoutStudio";
import type {
  FaucetEvenHoleBias,
  LayoutPiece,
  LayoutSlab,
  LayoutStudioMode,
  LShapeOrientationDeg,
  ManualPieceDimensions,
  PiecePlacement,
  PieceSinkCutout,
  SavedLayoutStudioState,
  SlabCloneEntry,
  SnapAlignmentMode,
  TraceTool,
} from "../types";
import { layoutSourceKindFromFile, isAcceptedLayoutSourceFile } from "../utils/sourceKind";
import { renderPdfFileFirstPageToDataUrl } from "../utils/pdfSource";
import { pixelsPerInchFromSegment } from "../utils/calibration";
import { ensurePlacementsForPieces } from "../utils/placements";
import { computeSlabAutoNest } from "../utils/slabAutoNest";
import { applyManualDimensionsToPiece } from "../utils/manualPieces";
import {
  SPLASH_PLAN_OFFSET_IN,
  buildSplashRectanglePoints,
  planDisplayPoints,
  rotatePlanPieceAroundCentroid,
} from "../utils/blankPlanGeometry";
import { normalizeClosedRing } from "../utils/geometry";
import { isMiterStripPiece, isPlanStripPiece } from "../utils/pieceRoles";
import { removeCornerFilletsBatch } from "../utils/blankPlanEdgeArc";
import { anyPiecesOverlap } from "../utils/blankPlanOverlap";
import { hasFlushSnapJoinCandidate } from "../utils/blankPlanPolygonOps";
import {
  clampSinkCenter,
  isSinkFullyInsidePiece,
  sinkPlacementFromEdgeInCanonical,
  sinkRotationDegFromEdge,
} from "../utils/pieceSinks";
import { collectQuoteReadinessIssues } from "../utils/quoteReadiness";
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
import { PlaceWorkspace } from "./PlaceWorkspace";
import { DEFAULT_SLAB_THICKNESS_IN, parseThicknessToInches } from "../utils/parseThicknessInches";
import { LayoutQuoteModal } from "./LayoutQuoteModal";
import { QuotePhaseView } from "./QuotePhaseView";
import { LayoutQuoteSettingsModal } from "./LayoutQuoteSettingsModal";
import { mergeCustomerExclusions, mergeLayoutQuoteSettings } from "../utils/commercialQuote";
import { StudioEntryHub } from "./StudioEntryHub";
import { TraceWorkspace } from "./TraceWorkspace";
import {
  IconDimensions,
  IconPieceLabels,
  IconRedo,
  IconRotateCCW,
  IconRotateCW,
  IconSelectCursor,
  IconToolLShape,
  IconToolOrtho,
  IconToolPolygon,
  IconToolRect,
  IconToolConnectCorner,
  IconToolCornerRadius,
  IconToolJoin,
  IconToolSnapLines,
  IconUndo,
  IconZoomFitSelection,
  IconZoomIn,
  IconFullscreenEnter,
  IconFullscreenExit,
  IconZoomMarquee,
  IconZoomOut,
  IconZoomResetView,
  IconAutoNestBird,
} from "./PlanToolbarIcons";
import "../layoutStudio.css";

type Props = {
  job: JobRecord;
  customer: CustomerRecord | null;
  options: JobComparisonOptionRecord[];
  activeOption: JobComparisonOptionRecord | null;
  onOptionChange: (optionId: string) => void;
  ownerUserId: string;
  onBack: () => void;
};

export function LayoutStudioScreen({
  job,
  customer,
  options,
  activeOption,
  onOptionChange,
  ownerUserId,
  onBack,
}: Props) {
  const optionId = activeOption?.id;
  const { draft, updateDraft, setDraft, save, saveQuotePhase, saveStatus, saveError, layoutSlabs } =
    useLayoutStudio({
      job,
      jobId: job.id,
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
  const [distanceInput, setDistanceInput] = useState("");
  const [distanceUnit, setDistanceUnit] = useState<"in" | "ft" | "mm" | "cm">("in");
  const [uploading, setUploading] = useState(false);
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
  const [planBoxZoomActive, setPlanBoxZoomActive] = useState(false);
  /** Blank plan: overlay full-screen drawing (toolbar + canvas + inspector). */
  const [planCanvasExpanded, setPlanCanvasExpanded] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const entryUploadInputRef = useRef<HTMLInputElement | null>(null);

  const selectMaterialOption = useCallback(
    async (nextId: string) => {
      if (nextId === activeOption?.id) return;
      const ok = await save(draftRef.current);
      if (!ok) return;
      onOptionChange(nextId);
    },
    [activeOption?.id, onOptionChange, save]
  );

  const workspaceKind = useMemo((): "source" | "blank" | undefined => {
    if (draft.workspaceKind === "blank" || draft.workspaceKind === "source") return draft.workspaceKind;
    if (draft.source) return "source";
    if (draft.pieces.length > 0) return "blank";
    return undefined;
  }, [draft.workspaceKind, draft.source, draft.pieces.length]);

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

  const displayUrl = draft.source?.fileUrl ?? null;
  const isPdfSource = draft.source?.kind === "pdf";
  const isBlankWorkspace = workspaceKind === "blank";

  const startBlankLayout = () => {
    setUndoStack([]);
    setRedoStack([]);
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
    if (!isBlankWorkspace || mode !== "trace") {
      planBlankInitialFitDoneRef.current = false;
      return;
    }
    if (draft.pieces.length === 0) {
      planBlankInitialFitDoneRef.current = false;
      return;
    }
    if (planBlankInitialFitDoneRef.current) return;
    planBlankInitialFitDoneRef.current = true;
    setPlanFitAllPiecesTick((t) => t + 1);
  }, [isBlankWorkspace, mode, draft.pieces.length]);

  useEffect(() => {
    if (mode !== "place") setLayoutPreviewModalOpen(false);
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

  const executeQuoteTransition = useCallback(async () => {
    const ok = await saveQuotePhase();
    if (!ok) return;
    setMode("quote");
    setQuoteGateOpen(false);
    setQuoteGateIssues([]);
  }, [saveQuotePhase]);

  const beginQuoteTransition = useCallback(() => {
    if (showEntryHub) return;
    if (!activeOption) return;
    const issues = collectQuoteReadinessIssues({
      draft,
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
  }, [draft, executeQuoteTransition, activeOption, showEntryHub, layoutSlabs.length, workspaceKind]);

  const handleModeChange = useCallback(
    (m: LayoutStudioMode) => {
      if (m === mode) return;
      if (m === "quote") {
        beginQuoteTransition();
        return;
      }
      void (async () => {
        if (!showEntryHub) {
          const ok = await save(draftRef.current);
          if (!ok) return;
        }
        setMode(m);
        if (m === "place" && layoutSlabs.length) {
          const slab = layoutSlabs[0];
          setActiveSlabId((prev) => prev ?? slab.id);
        }
      })();
    },
    [mode, beginQuoteTransition, showEntryHub, save, layoutSlabs]
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

  const onPlacementsChange = useCallback(
    (placements: PiecePlacement[]) => {
      updateDraft((d) => ({ ...d, placements }));
    },
    [updateDraft]
  );

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
    if (!ppi || ppi <= 0) return false;
    const sid = activeSlabId ?? layoutSlabs[0]?.id ?? null;
    if (!sid) return false;
    return draft.placements.some((p) => p.placed && p.slabId === sid);
  }, [activeOption, activeSlabId, draft.calibration.pixelsPerInch, draft.placements, layoutSlabs]);

  const applySlabAutoNest = useCallback(() => {
    const ppi = draft.calibration.pixelsPerInch;
    if (!ppi || ppi <= 0) return;
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
      pieces: draft.pieces,
      placements: draft.placements,
      pixelsPerInch: ppi,
      slabId,
      slabWidthIn: slab.widthIn,
      slabHeightIn: slab.heightIn,
      minGapBetweenInches: minGap,
      edgeInsetInches: edgeInset,
    });

    updateDraftWithUndo((d) => ({
      ...d,
      placements: nextPl,
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
    draft.calibration.pixelsPerInch,
    draft.pieces,
    draft.placements,
    layoutSlabs,
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

  const joinAvailable = useMemo(
    () => hasFlushSnapJoinCandidate(draft.pieces),
    [draft.pieces]
  );

  useEffect(() => {
    if (!joinAvailable && tool === "join") setTool("select");
  }, [joinAvailable, tool]);

  const addSinkPreviewRotationDeg = useMemo(() => {
    if (!addSinkEdge) return 0;
    const pc = draft.pieces.find((p) => p.id === addSinkEdge.pieceId);
    if (!pc) return 0;
    return sinkRotationDegFromEdge(pc, addSinkEdge.edgeIndex, draft.pieces) ?? 0;
  }, [addSinkEdge, draft.pieces]);

  const updateSelectedPiece = (patch: Partial<LayoutPiece>) => {
    if (!selectedPieceId) return;
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: d.pieces.map((p) => (p.id === selectedPieceId ? { ...p, ...patch } : p)),
    }));
  };

  const removeSinkFromSelected = (sinkId: string) => {
    if (!selectedPieceId) return;
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
    if (!isBlankWorkspace || !addSinkEdge) return;
    const piece = draft.pieces.find((p) => p.id === addSinkEdge.pieceId);
    if (!piece || isPlanStripPiece(piece)) return;
    const coordPerInch = 1;
    const pl = sinkPlacementFromEdgeInCanonical(
      piece,
      addSinkEdge.edgeIndex,
      draft.pieces,
      input.templateKind
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
      draft.pieces,
      coordPerInch,
      sink.centerX,
      sink.centerY
    );
    sink = { ...sink, ...clamped };
    if (!isSinkFullyInsidePiece(sink, piece, draft.pieces, coordPerInch)) {
      window.alert(
        "That sink doesn’t fit entirely inside this piece. Enlarge the piece, choose a different edge, or pick a smaller template."
      );
      return;
    }
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: d.pieces.map((p) =>
        p.id === piece.id ? { ...p, sinks: [...(p.sinks ?? []), sink], sinkCount: 0 } : p
      ),
    }));
  };

  const duplicateSelected = () => {
    if (!selectedPiece) return;
    const nid = crypto.randomUUID();
    const offset = isBlankWorkspace ? 6 : 24;
    const copy: LayoutPiece = {
      ...selectedPiece,
      id: nid,
      name: `${selectedPiece.name} copy`,
      points: selectedPiece.points.map((q) => ({ x: q.x + offset, y: q.y + offset })),
      sinks: selectedPiece.sinks?.map((s) => ({ ...s, id: crypto.randomUUID() })),
      manualDimensions: selectedPiece.manualDimensions
        ? selectedPiece.manualDimensions.kind === "rectangle"
          ? { ...selectedPiece.manualDimensions }
          : { ...selectedPiece.manualDimensions }
        : undefined,
      splashMeta: undefined,
      pieceRole: isPlanStripPiece(selectedPiece) ? "countertop" : selectedPiece.pieceRole,
      edgeTags: selectedPiece.edgeTags
        ? (() => {
            const { miterEdgeIndices: _omitMiter, ...restEt } = selectedPiece.edgeTags;
            return { ...restEt, splashEdges: [] };
          })()
        : undefined,
    };
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
    setSelectedPieceId(nid);
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
      if (!selectedPieceId) return;
      updateDraft((d) => ({
        ...d,
        placements: d.placements.map((p) =>
          p.pieceId === selectedPieceId ? { ...p, rotation: deg } : p
        ),
      }));
    },
    [selectedPieceId, updateDraft]
  );

  const rotateSelectedPlacementOnSlabBy = useCallback(
    (deltaDeg: number) => {
      if (!selectedPieceId) return;
      updateDraftWithUndo((d) => {
        const pl = d.placements.find((p) => p.pieceId === selectedPieceId);
        if (!pl?.placed || !pl.slabId) return d;
        const r = ((pl.rotation ?? 0) + deltaDeg) % 360;
        const rotation = r < 0 ? r + 360 : r;
        return {
          ...d,
          placements: d.placements.map((p) =>
            p.pieceId === selectedPieceId ? { ...p, rotation } : p
          ),
        };
      });
    },
    [selectedPieceId, updateDraftWithUndo]
  );

  const removeSelectedPieceFromSlab = useCallback(() => {
    if (!selectedPieceId) return;
    updateDraftWithUndo((d) => {
      const pl = d.placements.find((p) => p.pieceId === selectedPieceId);
      if (!pl?.placed || !pl.slabId) return d;
      return {
        ...d,
        placements: d.placements.map((p) =>
          p.pieceId === selectedPieceId ? { ...p, placed: false, slabId: null } : p
        ),
      };
    });
  }, [selectedPieceId, updateDraftWithUndo]);

  const rotateSelectedPlanPiece = (deltaDeg: number) => {
    if (!selectedPieceId || !isBlankWorkspace) return;
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
    const parent = draft.pieces.find((p) => p.id === edge.pieceId);
    if (!parent || isPlanStripPiece(parent)) return;
    const disp = planDisplayPoints(parent);
    const pts = buildSplashRectanglePoints(disp, edge.edgeIndex, h);
    const ox = parent.planTransform?.x ?? 0;
    const oy = parent.planTransform?.y ?? 0;
    const canonical = pts.map((p) => ({ x: p.x - ox, y: p.y - oy }));
    const ring = normalizeClosedRing(disp);
    const n = ring.length;
    const a = ring[edge.edgeIndex];
    const b = ring[(edge.edgeIndex + 1) % n];
    const widthIn = Math.hypot(b.x - a.x, b.y - a.y);
    const splashId = crypto.randomUUID();
    const stripRole = edgeStripKind === "miter" ? "miter" : "splash";
    const newPiece: LayoutPiece = {
      id: splashId,
      name: edgeStripKind === "miter" ? `${parent.name} miter` : `${parent.name} splash`,
      points: canonical,
      sinkCount: 0,
      shapeKind: "rectangle",
      source: "manual",
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
    updateDraftWithUndo((d) => ({
      ...d,
      pieces: [
        ...d.pieces.map((p) => {
          if (p.id !== parent.id) return p;
          const rest = (p.edgeTags?.splashEdges ?? []).filter((e) => e.edgeIndex !== edge.edgeIndex);
          const miterMerged =
            edgeStripKind === "miter"
              ? [...new Set([...(p.edgeTags?.miterEdgeIndices ?? []), edge.edgeIndex])].sort(
                  (a, b) => a - b
                )
              : p.edgeTags?.miterEdgeIndices;
          return {
            ...p,
            edgeTags: {
              ...p.edgeTags,
              ...(miterMerged?.length ? { miterEdgeIndices: miterMerged } : {}),
              splashEdges: [
                ...rest,
                { edgeIndex: edge.edgeIndex, splashPieceId: splashId, heightIn: h },
              ],
            },
          };
        }),
        newPiece,
      ],
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
    setUploading(true);
    try {
      const kind = layoutSourceKindFromFile(file);
      const { downloadUrl } = await uploadJobLayoutSource(ownerUserId, job.id, file);
      const uploadedAt = new Date().toISOString();
      setUndoStack([]);
      setRedoStack([]);

      if (kind === "pdf") {
        const { width, height } = await renderPdfFileFirstPageToDataUrl(file, 2);
        updateDraft((d) => ({
          ...d,
          workspaceKind: "source",
          pieces: [],
          placements: [],
          slabClones: [],
          source: {
            kind: "pdf",
            fileUrl: downloadUrl,
            fileName: file.name,
            uploadedAt,
            sourceWidthPx: width,
            sourceHeightPx: height,
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
      } else {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          const o = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(o);
            updateDraft((d) => ({
              ...d,
              workspaceKind: "source",
              pieces: [],
              placements: [],
              slabClones: [],
              source: {
                kind: "image",
                fileUrl: downloadUrl,
                fileName: file.name,
                uploadedAt,
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
      setCalibrationMode(true);
      setCalibrationStep("a");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const onCalibrationPoint = (p: { x: number; y: number }) => {
    if (calibrationStep === "a") {
      updateDraftWithUndo((d) => ({
        ...d,
        calibration: { ...d.calibration, pointA: p, pointB: null },
      }));
      setCalibrationStep("b");
      return;
    }
    if (calibrationStep === "b") {
      updateDraftWithUndo((d) => ({
        ...d,
        calibration: { ...d.calibration, pointB: p },
      }));
      setCalibrationStep("idle");
      setCalibrationMode(false);
    }
  };

  const applyCalibration = () => {
    const a = draft.calibration.pointA;
    const b = draft.calibration.pointB;
    const raw = parseFloat(distanceInput);
    if (!a || !b || !Number.isFinite(raw) || raw <= 0) return;
    const ppi = pixelsPerInchFromSegment(a, b, raw, distanceUnit);
    if (ppi == null) return;
    updateDraftWithUndo((d) => ({
      ...d,
      calibration: {
        ...d.calibration,
        isCalibrated: true,
        realDistance: raw,
        unit: distanceUnit,
        pixelsPerInch: ppi,
      },
    }));
  };

  const placementForSelected = draft.placements.find((p) => p.pieceId === selectedPieceId);
  const canRotatePlacementOnSlab = !!(
    selectedPieceId &&
    placementForSelected?.placed &&
    placementForSelected?.slabId
  );
  const canRemoveSelectedFromSlab = canRotatePlacementOnSlab;

  const applyManualDimensions = (next: ManualPieceDimensions) => {
    if (!selectedPieceId) return;
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
    if (!isBlankWorkspace) {
      setSelectedEdge(null);
      setSelectedFilletEdges([]);
    }
  }, [isBlankWorkspace]);

  useEffect(() => {
    if (!isBlankWorkspace || mode !== "trace") return;
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
      const r = removeCornerFilletsBatch(draftRef.current.pieces, targets);
      if (!r.ok) {
        window.alert(r.reason);
        return;
      }
      if (anyPiecesOverlap(r.pieces)) {
        window.alert("Removing these radii would cause a piece to overlap another.");
        return;
      }
      updateDraftWithUndo((d) => ({ ...d, pieces: r.pieces }));
      setSelectedFilletEdges([]);
      setSelectedEdge(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isBlankWorkspace, mode, tool, updateDraftWithUndo]);

  useEffect(() => {
    if (mode !== "trace" || !isBlankWorkspace) {
      setPlanCanvasExpanded(false);
    }
  }, [mode, isBlankWorkspace]);

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

  const showLayoutRail = mode === "trace" && !isBlankWorkspace;

  /** Header kicker: customer name · job name (replaces “Layout Studio · …” on every phase). */
  const layoutStudioJobContextKicker = useMemo(() => {
    const jobLabel = job.name.trim() || "Job";
    if (!customer) return jobLabel;
    const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
    if (!customerName) return jobLabel;
    return `${customerName} · ${jobLabel}`;
  }, [customer, job.name]);

  const tracePieceInspectorPanel =
    selectedPiece && mode === "trace" ? (
      <div className="ls-inspector ls-inspector--beside-canvas glass-panel">
        <p className="ls-card-title">Piece details</p>
        <label className="ls-field">
          Name
          <input
            className="ls-input"
            value={selectedPiece.name}
            onChange={(e) => updateSelectedPiece({ name: e.target.value })}
          />
        </label>
        {isBlankWorkspace && !isPlanStripPiece(selectedPiece) ? (
          <div className="ls-inspector-sinks">
            <p className="ls-muted ls-sink-hint">
              To add a sink, select a <strong>line (edge)</strong> on the piece, then choose{" "}
              <strong>Sink</strong> in the edge menu. The sink aligns to that edge.
            </p>
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
    ) : null;

  return (
    <div
      className={`ls-root${layoutQuoteModalOpen && activeOption ? " ls-root--layout-quote-modal" : ""}${
        planCanvasExpanded ? " ls-root--plan-fullscreen" : ""
      }`}
    >
      <header className="ls-header glass-panel">
        <div className="ls-header-top">
          <button type="button" className="ls-back" onClick={onBack}>
            ← Back
          </button>
          <div className="ls-header-titles">
            <p className="ls-kicker">{layoutStudioJobContextKicker}</p>
            {mode === "quote" ? (
              <>
                <h1 className="ls-title">Shared kitchen plan</h1>
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
        <div className="ls-header-toolbar">
          <div className="ls-header-toolbar-material">
            {options.length > 0 ? (
              <div className="ls-option-strip" role="group" aria-label="Material options for this job">
                <span className="ls-option-strip-label">Material</span>
                <div className="ls-option-pills">
                  {options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`ls-option-pill${activeOption?.id === o.id ? " is-active" : ""}`}
                      disabled={saveStatus === "saving"}
                      onClick={() => void selectMaterialOption(o.id)}
                    >
                      {o.productName}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="ls-option-strip-hint ls-muted">
                No slab options on this job yet — add materials from the catalog or “Add product / slab” on the job.
                You can still draw the shared plan below.
              </p>
            )}
          </div>
        </div>
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
                  onClick={() => {
                    setCalibrationMode(true);
                    setCalibrationStep("a");
                    updateDraftWithUndo((d) => ({
                      ...d,
                      calibration: {
                        ...d.calibration,
                        pointA: null,
                        pointB: null,
                        isCalibrated: false,
                        pixelsPerInch: null,
                      },
                    }));
                  }}
                >
                  Set scale
                </button>
                {calibrationMode ? (
                  <p className="ls-hint">
                    {calibrationStep === "a" && "Click the first point on your plan."}
                    {calibrationStep === "b" && "Click the second point."}
                  </p>
                ) : null}
                {draft.calibration.pointA && draft.calibration.pointB && !draft.calibration.isCalibrated ? (
                  <p className="ls-hint">Enter the real-world distance for that segment.</p>
                ) : null}
                {draft.calibration.pointA && draft.calibration.pointB ? (
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
                      {draft.calibration.pointA && draft.calibration.pointB
                        ? `${Math.hypot(
                            draft.calibration.pointB.x - draft.calibration.pointA.x,
                            draft.calibration.pointB.y - draft.calibration.pointA.y
                          ).toFixed(1)} px`
                        : "—"}
                      {draft.calibration.pixelsPerInch
                        ? ` · ${draft.calibration.pixelsPerInch.toFixed(2)} px/in`
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
          {!planCanvasExpanded ? (
            <div className="ls-phase-toggle-wrap glass-panel">
              <div className="ls-segmented ls-segmented--3 ls-segmented--canvas" role="tablist" aria-label="Layout Studio phase">
                <button
                  type="button"
                  className={mode === "trace" ? "is-active" : ""}
                  disabled={saveStatus === "saving"}
                  onClick={() => handleModeChange("trace")}
                >
                  Plan
                </button>
                <button
                  type="button"
                  className={mode === "place" ? "is-active" : ""}
                  disabled={saveStatus === "saving"}
                  onClick={() => handleModeChange("place")}
                >
                  Layout
                </button>
                <button
                  type="button"
                  className={mode === "quote" ? "is-active" : ""}
                  disabled={saveStatus === "saving"}
                  onClick={() => handleModeChange("quote")}
                >
                  Quote
                </button>
              </div>
              {mode === "quote" ? (
                <div className="ls-phase-quote-actions">
                  <button
                    type="button"
                    className="ls-btn ls-btn-secondary"
                    disabled={saveStatus === "saving"}
                    onClick={() => void save(draftRef.current)}
                  >
                    {saveStatus === "saving" ? "Saving…" : "Save layout"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <section
            className={`ls-canvas-shell glass-panel${
              mode === "place" || mode === "quote" ? " ls-canvas-shell--tall" : ""
            }`}
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
          {mode === "trace" && !showEntryHub && !isBlankWorkspace ? (
            <div className="ls-trace-plan-toolbar" role="toolbar" aria-label="Plan source">
              <label
                className={`ls-plan-toolbar-btn ls-plan-toolbar-pdf${uploading ? " is-busy" : ""}`}
                htmlFor="ls-main-upload"
                title="Upload PDF or image plan"
                aria-label="Upload PDF or image plan"
              >
                <span>{uploading ? "Uploading…" : "PDF"}</span>
              </label>
            </div>
          ) : null}
          {mode === "quote" ? (
            activeOption ? (
              <>
                <QuotePhaseView
                  job={job}
                  option={activeOption}
                  draft={draft}
                  slabs={layoutSlabs}
                  activeSlabId={activeSlabId ?? layoutSlabs[0]?.id ?? null}
                  onActiveSlab={(id) => setActiveSlabId(id)}
                  showPieceLabels={showPieceLabels}
                  quoteSettings={mergedQuoteSettings}
                  onSaveQuoteSettings={saveLayoutQuoteSettings}
                  onOpenQuoteSettings={() => setLayoutQuoteSettingsOpen(true)}
                  customerExclusions={mergedCustomerExclusions}
                  onSetCustomerExclusion={setCustomerExclusion}
                />
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
            )
          ) : mode === "trace" ? (
            isBlankWorkspace ? (
              <div
                className={`ls-plan-blank-shell${planCanvasExpanded ? " ls-plan-blank-shell--fullscreen" : ""}`}
                role={planCanvasExpanded ? "dialog" : undefined}
                aria-modal={planCanvasExpanded ? true : undefined}
                aria-label={planCanvasExpanded ? "Plan canvas — full screen" : undefined}
              >
                <div className="ls-plan-toolbar" role="toolbar" aria-label="Plan canvas tools">
                  <div className="ls-plan-toolbar-group">
                    <label
                      className={`ls-plan-toolbar-btn ls-plan-toolbar-pdf${uploading ? " is-busy" : ""}`}
                      htmlFor="ls-main-upload"
                      title="Add a PDF or image (replaces blank layout)"
                      aria-label="Add a PDF or image plan"
                    >
                      <span>{uploading ? "Uploading…" : "PDF"}</span>
                    </label>
                  </div>
                  <span className="ls-plan-toolbar-divider" aria-hidden />
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
                    <button
                      type="button"
                      className="ls-plan-toolbar-btn"
                      onClick={() => setLSheetOpen(true)}
                      title="L-shape — legs & depth"
                      aria-label="Add L-shape — legs and depth"
                    >
                      <IconToolLShape />
                    </button>
                  </div>
                  <div className="ls-plan-toolbar-section" role="group" aria-label="Draw tools">
                    {(
                      [
                        ["select", IconSelectCursor, "Select"],
                        ["rect", IconToolRect, "Rectangle (drag)"],
                        ["lShape", IconToolLShape, "L-shape (drag)"],
                        ["polygon", IconToolPolygon, "Polygon"],
                        ["orthoDraw", IconToolOrtho, "Ortho draw"],
                        ["snapLines", IconToolSnapLines, "Snap lines"],
                      ] as const
                    ).map(([id, Icon, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${tool === id ? " is-active" : ""}`}
                        aria-pressed={tool === id}
                        onClick={() => setTool(id)}
                        title={label}
                        aria-label={label}
                      >
                        <Icon />
                      </button>
                    ))}
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
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${tool === "cornerRadius" ? " is-active" : ""}`}
                        aria-pressed={tool === "cornerRadius"}
                        onClick={() =>
                          setTool((t) => (t === "cornerRadius" ? "select" : "cornerRadius"))
                        }
                        title="Corner radius — choose radius, then two adjacent edges (convex or inside corners)"
                        aria-label="Corner radius"
                      >
                        <IconToolCornerRadius />
                      </button>
                      <button
                        type="button"
                        className={`ls-plan-toolbar-btn ls-plan-toolbar-btn--toggle${tool === "connectCorner" ? " is-active" : ""}`}
                        aria-pressed={tool === "connectCorner"}
                        onClick={() =>
                          setTool((t) => (t === "connectCorner" ? "select" : "connectCorner"))
                        }
                        title="Connect — remove edge arcs at a 90° corner (click one edge, then the adjacent edge)"
                        aria-label="Connect corner — remove arcs"
                      >
                        <IconToolConnectCorner />
                      </button>
                    </div>
                  </div>
                  <span className="ls-plan-toolbar-divider" aria-hidden />
                  <div className="ls-plan-toolbar-group">
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
                  />
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
                  {!planCanvasExpanded ? tracePieceInspectorPanel : null}
                </div>
              </div>
            ) : (
              <div className="ls-trace-canvas-with-inspector">
                <div className="ls-trace-canvas-main">
                  <TraceWorkspace
                    displayUrl={displayUrl}
                    isPdfSource={isPdfSource}
                    calibration={draft.calibration}
                    calibrationMode={calibrationMode}
                    onCalibrationPoint={onCalibrationPoint}
                    tool={tool}
                    pieces={draft.pieces}
                    selectedPieceId={selectedPieceId}
                    onSelectPiece={setSelectedPieceId}
                    onPiecesChange={onPiecesChange}
                    slabs={layoutSlabs}
                    placements={draft.placements}
                  />
                </div>
                {!planCanvasExpanded ? tracePieceInspectorPanel : null}
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
              <div className="ls-place-split-toolbar">
                <div
                  className="ls-metrics ls-metrics--place-toolbar glass-panel"
                  aria-label="Live summary"
                >
                  <p className="ls-metrics-place-title">Live summary</p>
                  <div className="ls-metric-grid ls-metric-grid--place-toolbar">
                    <div className="ls-metric-inline">
                      <span className="ls-metric-val">{draft.summary.areaSqFt.toFixed(1)}</span>
                      <span className="ls-metric-lbl">sq ft (est.)</span>
                    </div>
                    <div className="ls-metric-inline">
                      <span className="ls-metric-val">
                        {(draft.summary.profileEdgeLf ?? 0) > 0
                          ? (draft.summary.profileEdgeLf ?? 0).toFixed(1)
                          : "—"}
                      </span>
                      <span className="ls-metric-lbl">ft profile (est.)</span>
                    </div>
                    <div className="ls-metric-inline">
                      <span className="ls-metric-val">{draft.summary.sinkCount}</span>
                      <span className="ls-metric-lbl">sinks</span>
                    </div>
                    <div className="ls-metric-inline">
                      <span className="ls-metric-val">{draft.summary.estimatedSlabCount}</span>
                      <span className="ls-metric-lbl">slabs (est.)</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`ls-btn ls-btn-secondary ls-place-layout-toggle${placeSplitView ? " is-active" : ""}`}
                  onClick={() => setPlaceSplitView((v) => !v)}
                  title="Place slab view and live preview stacked or side by side"
                >
                  {placeSplitView ? "Stacked layout" : "Side-by-side layout"}
                </button>
              </div>
              <div className={`ls-place-dual${placeSplitView ? " ls-place-dual--side" : ""}`}>
                <div className="ls-place-region">
                  <PlaceWorkspace
                    slabs={layoutSlabs}
                    activeSlabId={activeSlabId ?? layoutSlabs[0]?.id ?? null}
                    onActiveSlab={(id) => setActiveSlabId(id)}
                    pieces={draft.pieces}
                    placements={draft.placements}
                    pixelsPerInch={draft.calibration.pixelsPerInch}
                    selectedPieceId={selectedPieceId}
                    onSelectPiece={setSelectedPieceId}
                    onPlacementChange={onPlacementsChange}
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
                  />
                </div>
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
                      workspaceKind={isBlankWorkspace ? "blank" : "source"}
                      pieces={draft.pieces}
                      placements={draft.placements}
                      slabs={layoutSlabs}
                      pixelsPerInch={draft.calibration.pixelsPerInch}
                      tracePlanWidth={draft.source?.sourceWidthPx ?? null}
                      tracePlanHeight={draft.source?.sourceHeightPx ?? null}
                      showLabels={showPieceLabels}
                      selectedPieceId={selectedPieceId}
                      onPieceActivate={placePieceFromLivePreview}
                    />
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="ls-quote-fab"
                onClick={() => void beginQuoteTransition()}
              >
                Quote
              </button>
            </div>
          )}
          {!showEntryHub &&
          mode !== "quote" &&
          !(mode === "place" && activeOption) &&
          !planCanvasExpanded ? (
            <div className="ls-canvas-footer">
              <div className="ls-metrics ls-metrics--below-canvas glass-panel" aria-label="Live summary">
                <p className="ls-metrics-below-title">Live summary</p>
                <div className="ls-metric-grid ls-metric-grid--below">
                  <div className="ls-metric-inline">
                    <span className="ls-metric-val">{draft.summary.areaSqFt.toFixed(1)}</span>
                    <span className="ls-metric-lbl">sq ft (est.)</span>
                  </div>
                  <div className="ls-metric-inline">
                    <span className="ls-metric-val">
                      {(draft.summary.profileEdgeLf ?? 0) > 0
                        ? (draft.summary.profileEdgeLf ?? 0).toFixed(1)
                        : "—"}
                    </span>
                    <span className="ls-metric-lbl">ft profile (est.)</span>
                  </div>
                  <div className="ls-metric-inline">
                    <span className="ls-metric-val">{draft.summary.sinkCount}</span>
                    <span className="ls-metric-lbl">sinks</span>
                  </div>
                  <div className="ls-metric-inline">
                    <span className="ls-metric-val">{draft.summary.estimatedSlabCount}</span>
                    <span className="ls-metric-lbl">slabs (est.)</span>
                  </div>
                </div>
              </div>
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
          draft={draft}
          layoutSlabs={layoutSlabs}
          activeSlabId={activeSlabId ?? layoutSlabs[0]?.id ?? null}
          ownerUserId={ownerUserId}
          showPieceLabels={showPieceLabels}
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
                      Drag to rotate
                    </span>
                  ) : null}
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
                  workspaceKind={isBlankWorkspace ? "blank" : "source"}
                  pieces={draft.pieces}
                  placements={draft.placements}
                  slabs={layoutSlabs}
                  pixelsPerInch={draft.calibration.pixelsPerInch}
                  tracePlanWidth={draft.source?.sourceWidthPx ?? null}
                  tracePlanHeight={draft.source?.sourceHeightPx ?? null}
                  showLabels={showPieceLabels}
                  selectedPieceId={selectedPieceId}
                  previewInstanceId="modal"
                  variant="fullscreen"
                  onPieceActivate={placePieceFromLivePreview}
                />
              ) : (
                <PlaceLayoutPreview3D
                  workspaceKind={isBlankWorkspace ? "blank" : "source"}
                  pieces={draft.pieces}
                  placements={draft.placements}
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
