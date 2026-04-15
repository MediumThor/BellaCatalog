import type { LayoutArcCircle, LayoutPiece, LayoutPoint, SavedLayoutSourcePage } from "../types";

const SOURCE_PLAN_FALLBACK_PPI = 1;
const SOURCE_PLAN_PAGE_GAP_PX = 64;

export type SourcePlanEditorFrame = {
  index: number;
  originXPx: number;
  originYPx: number;
  originXIn: number;
  originYIn: number;
  widthPx: number;
  heightPx: number;
  widthIn: number;
  heightIn: number;
  ppi: number;
};

function validPpi(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function frameLookup(
  frames: readonly SourcePlanEditorFrame[],
): Map<number, SourcePlanEditorFrame> {
  return new Map(frames.map((frame) => [frame.index, frame]));
}

function defaultFrame(
  frames: readonly SourcePlanEditorFrame[],
  defaultPageIndex: number,
  fallbackPixelsPerInch: number | null,
): SourcePlanEditorFrame {
  const ppi = validPpi(fallbackPixelsPerInch) ?? SOURCE_PLAN_FALLBACK_PPI;
  return (
    frames[0] ?? {
      index: defaultPageIndex,
      originXPx: 0,
      originYPx: 0,
      originXIn: 0,
      originYIn: 0,
      widthPx: 0,
      heightPx: 0,
      widthIn: 0,
      heightIn: 0,
      ppi,
    }
  );
}

function scalePointToInches(point: LayoutPoint, frame: SourcePlanEditorFrame, ppi: number): LayoutPoint {
  return {
    x: frame.originXIn + (point.x - frame.originXPx) / ppi,
    y: frame.originYIn + (point.y - frame.originYPx) / ppi,
  };
}

function scalePointToPixels(point: LayoutPoint, frame: SourcePlanEditorFrame, ppi: number): LayoutPoint {
  return {
    x: frame.originXPx + (point.x - frame.originXIn) * ppi,
    y: frame.originYPx + (point.y - frame.originYIn) * ppi,
  };
}

function scaleCircleToInches(circle: LayoutArcCircle, frame: SourcePlanEditorFrame, ppi: number): LayoutArcCircle {
  const center = scalePointToInches({ x: circle.cx, y: circle.cy }, frame, ppi);
  return {
    cx: center.x,
    cy: center.y,
    r: circle.r / ppi,
  };
}

function scaleCircleToPixels(circle: LayoutArcCircle, frame: SourcePlanEditorFrame, ppi: number): LayoutArcCircle {
  const center = scalePointToPixels({ x: circle.cx, y: circle.cy }, frame, ppi);
  return {
    cx: center.x,
    cy: center.y,
    r: circle.r * ppi,
  };
}

function clonePlanTransform(
  planTransform: LayoutPiece["planTransform"]
): LayoutPiece["planTransform"] {
  return planTransform ? { ...planTransform } : undefined;
}

function resolvePieceSourceMeta(
  piece: LayoutPiece,
  pieces: readonly LayoutPiece[],
  framesByIndex: Map<number, SourcePlanEditorFrame>,
  fallbackFrame: SourcePlanEditorFrame,
  defaultPageIndex: number,
  fallbackPixelsPerInch: number | null,
): { sourcePageIndex: number; ppi: number; frame: SourcePlanEditorFrame } {
  const parent =
    piece.splashMeta?.parentPieceId != null
      ? pieces.find((candidate) => candidate.id === piece.splashMeta!.parentPieceId) ?? null
      : null;
  const sourcePageIndex = piece.sourcePageIndex ?? parent?.sourcePageIndex ?? defaultPageIndex;
  const frame = framesByIndex.get(sourcePageIndex) ?? fallbackFrame;
  const ppi =
    validPpi(piece.sourcePixelsPerInch) ??
    validPpi(parent?.sourcePixelsPerInch) ??
    validPpi(frame.ppi) ??
    validPpi(fallbackPixelsPerInch) ??
    SOURCE_PLAN_FALLBACK_PPI;
  return { sourcePageIndex, ppi, frame };
}

export function buildSourcePlanEditorFrames(
  pages: readonly SavedLayoutSourcePage[],
  fallbackPixelsPerInch: number | null,
): SourcePlanEditorFrame[] {
  const fallbackPpi = validPpi(fallbackPixelsPerInch) ?? SOURCE_PLAN_FALLBACK_PPI;
  let originYIn = 0;
  return pages.map((page, index) => {
    const ppi = validPpi(page.calibration?.pixelsPerInch) ?? fallbackPpi;
    const next: SourcePlanEditorFrame = {
      index: page.index ?? index,
      originXPx: page.originX ?? 0,
      originYPx: page.originY ?? 0,
      originXIn: 0,
      originYIn,
      widthPx: page.widthPx,
      heightPx: page.heightPx,
      widthIn: page.widthPx / ppi,
      heightIn: page.heightPx / ppi,
      ppi,
    };
    originYIn += next.heightIn + SOURCE_PLAN_PAGE_GAP_PX / ppi;
    return next;
  });
}

export function sourcePiecesToPlanEditorPieces(
  pieces: readonly LayoutPiece[],
  frames: readonly SourcePlanEditorFrame[],
  defaultPageIndex: number,
  fallbackPixelsPerInch: number | null,
): LayoutPiece[] {
  const framesByIndex = frameLookup(frames);
  const fallbackFrame = defaultFrame(frames, defaultPageIndex, fallbackPixelsPerInch);
  return pieces.map((piece) => {
    const { sourcePageIndex, ppi, frame } = resolvePieceSourceMeta(
      piece,
      pieces,
      framesByIndex,
      fallbackFrame,
      defaultPageIndex,
      fallbackPixelsPerInch,
    );
    return {
      ...piece,
      points: piece.points.map((point) => scalePointToInches(point, frame, ppi)),
      sinks: piece.sinks?.map((sink) => {
        const center = scalePointToInches({ x: sink.centerX, y: sink.centerY }, frame, ppi);
        return { ...sink, centerX: center.x, centerY: center.y };
      }),
      edgeArcSagittaIn: piece.edgeArcSagittaIn?.map((value) => (value == null ? null : value / ppi)),
      edgeArcCircleIn: piece.edgeArcCircleIn?.map((circle) =>
        circle ? scaleCircleToInches(circle, frame, ppi) : null,
      ),
      edgeArcRadiiIn: piece.edgeArcRadiiIn?.map((value) => (value == null ? null : value / ppi)),
      /** Preserve combined-plan offsets without rebaking them into the source PDF geometry. */
      planTransform: clonePlanTransform(piece.planTransform),
      sourcePageIndex,
      sourcePixelsPerInch: ppi,
    };
  });
}

export function planEditorPiecesToSourcePieces(
  pieces: readonly LayoutPiece[],
  frames: readonly SourcePlanEditorFrame[],
  defaultPageIndex: number,
  fallbackPixelsPerInch: number | null,
): LayoutPiece[] {
  const framesByIndex = frameLookup(frames);
  const fallbackFrame = defaultFrame(frames, defaultPageIndex, fallbackPixelsPerInch);
  return pieces.map((piece) => {
    const { sourcePageIndex, ppi, frame } = resolvePieceSourceMeta(
      piece,
      pieces,
      framesByIndex,
      fallbackFrame,
      defaultPageIndex,
      fallbackPixelsPerInch,
    );
    return {
      ...piece,
      /**
       * `planTransform` is a plan-only offset for the combined Plan/Layout views. Keep it separate
       * from the stacked PDF coordinates so Arrange/dragging on Plan does not move pieces off their
       * original trace page.
       */
      points: piece.points.map((point) => scalePointToPixels(point, frame, ppi)),
      sinks: piece.sinks?.map((sink) => {
        const center = scalePointToPixels({ x: sink.centerX, y: sink.centerY }, frame, ppi);
        return { ...sink, centerX: center.x, centerY: center.y };
      }),
      edgeArcSagittaIn: piece.edgeArcSagittaIn?.map((value) => (value == null ? null : value * ppi)),
      edgeArcCircleIn: piece.edgeArcCircleIn?.map((circle) =>
        circle ? scaleCircleToPixels(circle, frame, ppi) : null,
      ),
      edgeArcRadiiIn: piece.edgeArcRadiiIn?.map((value) => (value == null ? null : value * ppi)),
      planTransform: clonePlanTransform(piece.planTransform),
      sourcePageIndex,
      sourcePixelsPerInch: ppi,
    };
  });
}
