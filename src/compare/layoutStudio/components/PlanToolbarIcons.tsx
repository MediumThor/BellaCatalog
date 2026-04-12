import type { SVGProps } from "react";

/** Inline SVG icons for blank plan toolbar — matches Layout Studio theme. */

export function IconUndo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 00-15-6.7L3 13" />
    </svg>
  );
}

export function IconRedo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0115-6.7L21 13" />
    </svg>
  );
}

/** Dimension callout style — “123” */
export function IconDimensions(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fill="currentColor"
        fontSize="11"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        style={{ letterSpacing: "-0.02em" }}
      >
        123
      </text>
    </svg>
  );
}

/** Piece labels — “T” for text */
export function IconPieceLabels(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fill="currentColor"
        fontSize="15"
        fontWeight="700"
        fontFamily="ui-serif, Georgia, serif"
        fontStyle="italic"
      >
        T
      </text>
    </svg>
  );
}

export function IconSelectCursor(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden {...props}>
      <path
        d="M5.5 3L5.5 17.2L9.8 12.8L13.4 20L16 18.8L12.4 11.5L18.5 11.5L5.5 3Z"
        fillOpacity={0.2}
      />
    </svg>
  );
}

export function IconToolRect(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="5" y="6" width="14" height="12" rx="1.75" />
    </svg>
  );
}

/** Hollow L (countertop-style) — shared by add-piece and L drag tool. */
export function IconToolLShape(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M6 6h11v5h-6v9H6V6z" />
    </svg>
  );
}

export function IconToolPolygon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M12 4l6 5-2 9H8l-2-9 6-5z" />
    </svg>
  );
}

export function IconToolOrtho(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M16.5 3.5a2.12 2.12 0 013 3L8 18l-4 1 1-4 11.5-11.5z" />
    </svg>
  );
}

export function IconToolSnapLines(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <path d="M5 8h14M5 16h14" />
      <path d="M8 5v14M16 5v14" strokeDasharray="2 2" />
    </svg>
  );
}

/** Sharp 90° corner — remove edge arcs / connect orthogonal edges. */
export function IconToolConnectCorner(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M7 7v11h11" />
    </svg>
  );
}

/** Round a 90° inside corner to a given radius. */
export function IconToolCornerRadius(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M8 16h6a3 3 0 003-3V8" />
      <path d="M8 16V8" strokeOpacity={0.35} />
    </svg>
  );
}

/** Join two snap-flush pieces into one. */
export function IconToolJoin(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="4" y="8" width="7" height="8" rx="1" />
      <rect x="13" y="8" width="7" height="8" rx="1" />
      <path d="M11 10v4M11 12h2" />
    </svg>
  );
}

export function IconAlignStart(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <path d="M5 6h14M5 12h10M5 18h14" />
    </svg>
  );
}

export function IconAlignCenter(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <path d="M5 6h14M7 12h10M5 18h14" />
    </svg>
  );
}

export function IconAlignEnd(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <path d="M5 6h14M9 12h10M5 18h14" />
    </svg>
  );
}

export function IconRotateCCW(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M3 12a9 9 0 109-9 4 4 0 00-4 4" />
      <path d="M3 4v4h4" />
    </svg>
  );
}

export function IconRotateCW(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M21 12a9 9 0 11-9-9 4 4 0 004 4" />
      <path d="M21 4v4h-4" />
    </svg>
  );
}

/** Zoom out — magnifier with minus. */
export function IconZoomOut(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M8 11h6M21 21l-4.2-4.2" />
    </svg>
  );
}

/** Zoom in — magnifier with plus. */
export function IconZoomIn(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M11 8v6M8 11h6M21 21l-4.2-4.2" />
    </svg>
  );
}

/** Marquee / box zoom region. */
export function IconZoomMarquee(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 2" aria-hidden {...props}>
      <rect x="4" y="7" width="16" height="11" rx="1.5" />
    </svg>
  );
}

/** Fit frame to selection / focus. */
export function IconZoomFitSelection(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <path d="M8 3H5v3M16 3h3v3M8 21H5v-3M16 21h3v-3" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

/** Reset / show full plan extent. */
export function IconZoomResetView(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-6 6M3 21l6-6" />
    </svg>
  );
}

/** Expand plan canvas to full screen. */
export function IconFullscreenEnter(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Exit full-screen plan canvas. */
export function IconFullscreenExit(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Auto nest / pack pieces on slab (bird silhouette). */
export function IconAutoNestBird(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 4.5c-2.5 0-4.5 1.6-5.2 3.8L4 6.5l1.2 3.5c-.1.4-.2.8-.2 1.2 0 3.3 2.7 6 6 6 1.2 0 2.3-.4 3.2-1L20 19l-2.5-4.5c.9-1 1.5-2.3 1.5-3.7 0-3-2.5-5.3-5.5-5.3h-.5zm-.3 2.8c.8 0 1.4.6 1.4 1.4s-.6 1.4-1.4 1.4-1.4-.6-1.4-1.4.6-1.4 1.4-1.4z" />
    </svg>
  );
}
