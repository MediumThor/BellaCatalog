export const BLANK_VIEW_ZOOM_MIN = 0.5;
export const BLANK_VIEW_ZOOM_MAX = 5;

export function blankPlanZoomDisplayPct(viewZoom: number): number {
  return Math.round(viewZoom * 50);
}

export const TRACE_VIEW_ZOOM_MIN = 0.25;
export const TRACE_VIEW_ZOOM_MAX = 24;

export function traceViewZoomDisplayPct(viewZoom: number): number {
  return Math.round(viewZoom * 100);
}
