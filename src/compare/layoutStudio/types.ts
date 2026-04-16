/** Layout Studio domain types — shared job plan + option-scoped placement. */

export const LAYOUT_STUDIO_VERSION = 1;

export type LayoutSourceKind = "pdf" | "image" | "dxf" | "unknown";

export type CalibrationUnit = "in" | "ft" | "mm" | "cm";

export interface LayoutPoint {
  x: number;
  y: number;
}

export type PieceShapeKind = "rectangle" | "lShape" | "polygon";

/** Countertop vs edge strips from plan (backsplash vs miter / fold-down). */
export type PiecePlanRole = "countertop" | "splash" | "miter";

/** Rotation of the manual L-shape in plan view (degrees). */
export type LShapeOrientationDeg = 0 | 90 | 180 | 270;

export type ManualPieceDimensions =
  | { kind: "rectangle"; widthIn: number; depthIn: number }
  | {
      kind: "lShape";
      legAIn: number;
      legBIn: number;
      depthIn: number;
      orientation: LShapeOrientationDeg;
    };

/** Catalog sink templates (dimensions in inches). */
export type PieceSinkTemplateKind = "kitchen" | "vanityRound" | "vanitySquare";

/** Center-to-center spacing between adjacent faucet holes (inches). */
export type FaucetSpreadIn = 2 | 4 | 8 | 10 | 12;

/**
 * For 2 or 4 holes: extra holes relative to center (one hole is always on the sink centerline).
 * Facing the sink from the front, “left” / “right” are the customer’s left and right on the deck.
 */
export type FaucetEvenHoleBias = "left" | "right";

/**
 * A sink + faucet hole group placed on a piece (plan coordinates).
 * Positions are in the same space as `LayoutPiece.points` (inches on blank plan; source pixels when tracing).
 */
/**
 * Standard electrical outlet cutout on plan (2.25" × 4"); same coordinate frame as {@link PieceSinkCutout}.
 */
export interface PieceOutletCutout {
  id: string;
  centerX: number;
  centerY: number;
  /** Degrees: 0 = back edge toward -Y in local coordinates (matches sink convention). */
  rotationDeg: number;
}

export interface PieceSinkCutout {
  id: string;
  /** Required label for quoting. */
  name: string;
  templateKind: PieceSinkTemplateKind;
  /** Piece-local X of sink center (same units as `points`). */
  centerX: number;
  /** Piece-local Y of sink center (same units as `points`). */
  centerY: number;
  /** Degrees: 0 = back edge toward -Y in local coordinates. */
  rotationDeg: number;
  faucetHoleCount: number;
  spreadIn: FaucetSpreadIn;
  /** Required when `faucetHoleCount` is 2 or 4; ignored for 1, 3, or 5. */
  evenHoleBias?: FaucetEvenHoleBias;
}

/** Circular arc on one polygon edge (blank plan, inches). */
export interface LayoutArcCircle {
  cx: number;
  cy: number;
  r: number;
}

export interface LayoutPiece {
  id: string;
  name: string;
  /** Area material option assigned to this piece; strip pieces inherit from their parent when unset. */
  materialOptionId?: string | null;
  /**
   * Closed polygon vertices.
   * - Source-backed layouts: coordinates are in source image / PDF pixel space (after calibration, 1 inch = 1/ppi ft etc. via summary math).
   * - Blank workspace: coordinates are **inches** in plan space; calibration uses `pixelsPerInch: 1` (1 unit = 1 inch).
   */
  points: LayoutPoint[];
  /**
   * Legacy count-only field; prefer `sinks` for placed cutouts.
   * Summary uses `sinks?.length` when present, else this value.
   */
  sinkCount: number;
  /** Placed sink + faucet groups (quoting); does not change piece area. */
  sinks?: PieceSinkCutout[];
  /** Placed outlet cutouts (2.25" × 4"); quoted at same per-cut rate as sink cutouts. */
  outlets?: PieceOutletCutout[];
  /**
   * @deprecated Legacy numeric count; prefer `outlets`. Still summed for quote if present.
   */
  outletCount?: number;
  notes?: string;
  edgeTags?: {
    /** Legacy / generic finished edges when no profile tags exist. */
    finishedEdgeIndices?: number[];
    /** Profile edges for finished-edge LF (explicit quote semantics). */
    profileEdgeIndices?: number[];
    /** Parent-side record of splash strips spawned from edges. */
    splashEdges?: Array<{ edgeIndex: number; splashPieceId: string; heightIn: number }>;
    /**
     * Plan edge indices tagged as miter joints — quoted as miter LF; drawn dark blue in plan;
     * 3D preview shears those vertical faces for opposing 45° cuts.
     */
    miterEdgeIndices?: number[];
  };
  /** Blank plan: translate canonical `points` in inch space without mutating shape. */
  planTransform?: { x: number; y: number };
  pieceRole?: PiecePlanRole;
  /** Parent link for backsplash (`splash`) and miter (`miter`) strips spawned from an edge. */
  splashMeta?: {
    parentPieceId: string;
    parentEdgeIndex: number;
    heightIn: number;
    /** @deprecated Prefer `pieceRole: "miter"`; removed when layouts are re-saved. */
    waterfall?: boolean;
    /**
     * Index of the strip polygon edge that is the hinge / counter contact for 3D (plan edge i → i+1).
     * Defaults to 0 for strips spawned from a parent edge (inner contact = first rectangle edge).
     */
    bottomEdgeIndex?: number;
  };
  shapeKind?: PieceShapeKind;
  source?: "manual" | "imported" | "ai-suggested";
  /** When set, piece was created via dimension entry (blank workspace); used to regenerate `points` when dimensions change. */
  manualDimensions?: ManualPieceDimensions;
  /**
   * Blank plan only: arc on edge `i` from `points[i]` to `points[(i+1)%n]` (same length as `points`).
   * `null` = straight segment. Perpendicular offset in inches from chord midpoint to arc (three-point arc).
   * Positive = bulge toward piece interior; negative = bulge the other way. Not stored as circle radius.
   */
  edgeArcSagittaIn?: (number | null)[] | null;
  /**
   * When set for edge `i`, draw that edge as a circular arc with this center and radius (plan inches).
   * Used for corner fillets so rendering does not depend on sagitta → circumcenter (which can fall back to a straight segment).
   * If present for an edge, it takes precedence over `edgeArcSagittaIn` for that edge when building paths.
   */
  edgeArcCircleIn?: (LayoutArcCircle | null)[] | null;
  /**
   * @deprecated Legacy storage: was circle radius in inches. Migrated to `edgeArcSagittaIn` when loading.
   */
  edgeArcRadiiIn?: (number | null)[] | null;
  /** Source-backed layouts: PDF/image page index this piece was traced from. */
  sourcePageIndex?: number | null;
  /** Source-backed layouts: page-specific pixels-per-inch used when converting this piece to slab inches. */
  sourcePixelsPerInch?: number | null;
}

export interface PiecePlacement {
  id: string;
  pieceId: string;
  slabId: string | null;
  /** Position of piece centroid in slab inch space (origin top-left of slab). */
  x: number;
  y: number;
  rotation: number;
  mirrored?: boolean;
  placed: boolean;
}

export interface LayoutSummary {
  areaSqFt: number;
  finishedEdgeLf: number;
  sinkCount: number;
  /** Sum of per-piece `outletCount` (electrical outlet cutouts). */
  outletCount: number;
  /** Linear feet from edges tagged as profile (explicit quote semantics). */
  profileEdgeLf?: number;
  /** Linear feet from edges tagged as miter joints. */
  miterEdgeLf?: number;
  /** Number of backsplash strip pieces. */
  splashPieceCount?: number;
  /** Combined area of backsplash strips (est.), sq ft. */
  splashAreaSqFt?: number;
  /** Number of miter strip pieces (fold-down from edge). */
  miterPieceCount?: number;
  /** Combined area of miter strips (est.), sq ft. */
  miterAreaSqFt?: number;
  estimatedSlabCount: number;
  unplacedPieceCount: number;
}

export interface SavedLayoutCalibration {
  isCalibrated: boolean;
  pointA: LayoutPoint | null;
  pointB: LayoutPoint | null;
  realDistance: number | null;
  unit: CalibrationUnit | null;
  /** Pixels per inch in source space (after calibration). */
  pixelsPerInch: number | null;
}

export interface SavedLayoutSourcePage {
  index: number;
  pageNumber: number;
  widthPx: number;
  heightPx: number;
  /** Combined-plan origin so multi-page PDFs share one source coordinate space. */
  originX: number;
  originY: number;
  /** Optional cached preview; active page rendering can also be generated at runtime. */
  previewImageUrl?: string;
  /** Storage ref for the cached preview so we can recover when download URLs rotate. */
  previewStoragePath?: string;
  calibration?: SavedLayoutCalibration;
}

export interface SavedLayoutSource {
  kind: LayoutSourceKind;
  fileUrl: string;
  /** Storage ref for the original upload so reopen flows do not depend on a stale URL token. */
  fileStoragePath?: string;
  /** PDF uploads also persist a rendered first-page preview for tracing + calibration. */
  previewImageUrl?: string;
  /** Storage ref for the first-page preview image. */
  previewStoragePath?: string;
  fileName: string;
  uploadedAt: string;
  /** Multi-page PDFs: one entry per page with dimensions/origin/calibration. */
  pages?: SavedLayoutSourcePage[];
  sourceWidthPx?: number;
  sourceHeightPx?: number;
}

export interface SavedLayoutPreview {
  imageUrl?: string;
  generatedAt?: string;
}

/**
 * Job-level shared plan: geometry, source, calibration — same for all material options.
 * Persisted on `JobRecord.layoutStudioPlan`.
 */
export interface SavedJobLayoutPlan {
  version: number;
  /**
   * `source` — uploaded plan/image/PDF workflow.
   * `blank` — quick layout without a source file (plan coordinates = inches).
   */
  workspaceKind?: "source" | "blank";
  source: SavedLayoutSource | null;
  calibration: SavedLayoutCalibration;
  pieces: LayoutPiece[];
  updatedAt: string;
}

/** Extra slab instances for an option (same image/dims as primary); ids match `PiecePlacement.slabId`. */
export interface SlabCloneEntry {
  id: string;
  label: string;
}

/**
 * Option-specific slab placement and preview snapshot.
 * Persisted on `JobComparisonOptionRecord.layoutStudioPlacement`.
 */
export interface SavedOptionLayoutPlacement {
  version?: number;
  placements: PiecePlacement[];
  /** Duplicates of the catalog slab for multi-slab jobs (max 20 slabs total including primary). */
  slabClones?: SlabCloneEntry[];
  preview?: SavedLayoutPreview;
  updatedAt: string;
}

/**
 * Full working state in the UI (merged job plan + active option placement).
 * Legacy: also stored as a single blob on `JobComparisonOptionRecord.layoutStudio`.
 */
export interface SavedLayoutStudioState {
  version: number;
  /**
   * `source` — uploaded plan/image/PDF workflow.
   * `blank` — quick layout without a source file (plan coordinates = inches).
   * Omitted on older saves; hydrate infers from `source` / pieces.
   */
  workspaceKind?: "source" | "blank";
  source: SavedLayoutSource | null;
  calibration: SavedLayoutCalibration;
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  /** Duplicates of primary slab for this option (persisted on `layoutStudioPlacement`). */
  slabClones?: SlabCloneEntry[];
  summary: LayoutSummary;
  preview?: SavedLayoutPreview;
  updatedAt: string;
}

/** Normalized slab for placement (from option + catalog snapshot). */
export interface LayoutSlab {
  id: string;
  imageUrl: string;
  /** Ordered fallback list for slab image rendering; first loadable candidate wins. */
  imageCandidates?: string[];
  label: string;
  widthIn: number;
  heightIn: number;
  /** True when `widthIn`/`heightIn` came from the catalog size string (not image inference). */
  sizeFromSpec?: boolean;
}

export type LayoutStudioMode = "trace" | "place" | "quote";

export type TraceTool =
  | "select"
  | "rect"
  | "lShape"
  | "polygon"
  | "orthoDraw"
  | "snapLines"
  | "join"
  | "cornerRadius"
  | "chamferCorner"
  | "connectCorner";

/** Snap alignment for line-to-line snap in blank workspace. */
export type SnapAlignmentMode = "start" | "center" | "end";
