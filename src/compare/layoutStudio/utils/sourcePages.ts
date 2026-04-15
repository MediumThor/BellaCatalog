import type {
  LayoutPiece,
  SavedLayoutCalibration,
  SavedLayoutSource,
  SavedLayoutSourcePage,
} from "../types";

const PDF_PAGE_GAP_PX = 64;

function emptyCalibration(): SavedLayoutCalibration {
  return {
    isCalibrated: false,
    pointA: null,
    pointB: null,
    realDistance: null,
    unit: null,
    pixelsPerInch: null,
  };
}

export function normalizeCalibration(
  calibration?: Partial<SavedLayoutCalibration> | null,
): SavedLayoutCalibration {
  return {
    ...emptyCalibration(),
    ...(calibration ?? {}),
  };
}

export function buildStackedPdfPages(
  pages: Array<{ pageNumber: number; widthPx: number; heightPx: number }>,
): { pages: SavedLayoutSourcePage[]; totalWidth: number; totalHeight: number } {
  let originY = 0;
  let totalWidth = 0;
  const out = pages.map((page, index) => {
    totalWidth = Math.max(totalWidth, page.widthPx);
    const next: SavedLayoutSourcePage = {
      index,
      pageNumber: page.pageNumber,
      widthPx: page.widthPx,
      heightPx: page.heightPx,
      originX: 0,
      originY,
      calibration: emptyCalibration(),
    };
    originY += page.heightPx + PDF_PAGE_GAP_PX;
    return next;
  });
  return {
    pages: out,
    totalWidth,
    totalHeight: Math.max(0, originY - (out.length > 0 ? PDF_PAGE_GAP_PX : 0)),
  };
}

export function normalizedSourcePages(
  source: SavedLayoutSource | null | undefined,
  fallbackCalibration?: SavedLayoutCalibration | null,
): SavedLayoutSourcePage[] {
  if (!source) return [];
  if (Array.isArray(source.pages) && source.pages.length > 0) {
    return source.pages.map((page, index) => ({
      index: page.index ?? index,
      pageNumber: page.pageNumber ?? index + 1,
      widthPx: page.widthPx,
      heightPx: page.heightPx,
      originX: page.originX ?? 0,
      originY: page.originY ?? 0,
      previewImageUrl: page.previewImageUrl,
      previewStoragePath: page.previewStoragePath,
      calibration: normalizeCalibration(page.calibration),
    }));
  }
  const widthPx = Math.max(1, Math.round(source.sourceWidthPx ?? 1));
  const heightPx = Math.max(1, Math.round(source.sourceHeightPx ?? 1));
  return [
    {
      index: 0,
      pageNumber: 1,
      widthPx,
      heightPx,
      originX: 0,
      originY: 0,
      previewImageUrl: source.previewImageUrl,
      previewStoragePath: source.previewStoragePath,
      calibration: normalizeCalibration(fallbackCalibration),
    },
  ];
}

export function sourcePlanDimensions(
  source: SavedLayoutSource | null | undefined,
  fallbackCalibration?: SavedLayoutCalibration | null,
): { widthPx: number; heightPx: number } {
  const pages = normalizedSourcePages(source, fallbackCalibration);
  let maxX = 0;
  let maxY = 0;
  for (const page of pages) {
    maxX = Math.max(maxX, page.originX + page.widthPx);
    maxY = Math.max(maxY, page.originY + page.heightPx);
  }
  return {
    widthPx: Math.max(0, maxX),
    heightPx: Math.max(0, maxY),
  };
}

export function sourcePageByIndex(
  source: SavedLayoutSource | null | undefined,
  pageIndex: number,
  fallbackCalibration?: SavedLayoutCalibration | null,
): SavedLayoutSourcePage | null {
  const pages = normalizedSourcePages(source, fallbackCalibration);
  return pages.find((page) => page.index === pageIndex) ?? pages[0] ?? null;
}

export function sourceHasAnyCalibratedPage(
  source: SavedLayoutSource | null | undefined,
  fallbackCalibration?: SavedLayoutCalibration | null,
): boolean {
  return normalizedSourcePages(source, fallbackCalibration).some(
    (page) => !!(page.calibration?.isCalibrated && (page.calibration.pixelsPerInch ?? 0) > 0),
  );
}

export function piecePixelsPerInch(
  piece: LayoutPiece,
  fallbackPixelsPerInch?: number | null,
): number | null {
  const ppi = piece.sourcePixelsPerInch ?? fallbackPixelsPerInch ?? null;
  return ppi != null && ppi > 0 ? ppi : null;
}

export function piecesHaveAnyScale(
  pieces: readonly LayoutPiece[],
  fallbackPixelsPerInch?: number | null,
): boolean {
  return pieces.some((piece) => piecePixelsPerInch(piece, fallbackPixelsPerInch) != null);
}

export function countPiecesMissingScale(
  pieces: readonly LayoutPiece[],
  fallbackPixelsPerInch?: number | null,
): number {
  return pieces.filter(
    (piece) => piece.points.length >= 3 && piecePixelsPerInch(piece, fallbackPixelsPerInch) == null,
  ).length;
}
