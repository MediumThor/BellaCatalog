import { useMemo } from "react";
import {
  bboxCenter,
  bboxHeight,
  bboxWidth,
  type DxfBoundingBox,
  type DxfEntity,
} from "../utils/dxfParser";

type Props = {
  entities: DxfEntity[];
  bbox: DxfBoundingBox | null;
  /** Width of the SVG viewport in pixels. */
  width: number;
  /** Height of the SVG viewport in pixels. */
  height: number;
  /** Stroke colour for geometry. */
  stroke?: string;
  /** Fractional padding around bbox (0..1). */
  padding?: number;
  /** Background hint colour for the surface (rendered behind geometry). */
  background?: string;
  className?: string;
};

/**
 * Read-only SVG renderer for parsed DXF geometry.
 *
 * The component never modifies the underlying DXF — it consumes the parsed
 * preview structure and draws it. Geometry is auto-fit to the viewport via
 * the supplied bounding box; DXF Y axis is flipped to screen Y.
 */
export function CutDxfPreview({
  entities,
  bbox,
  width,
  height,
  stroke = "rgba(20, 32, 60, 0.92)",
  padding = 0.06,
  background,
  className,
}: Props) {
  const view = useMemo(() => {
    if (!bbox) return null;
    const w = Math.max(bboxWidth(bbox), 1e-6);
    const h = Math.max(bboxHeight(bbox), 1e-6);
    const center = bboxCenter(bbox);
    const usableW = width * (1 - padding * 2);
    const usableH = height * (1 - padding * 2);
    const scale = Math.min(usableW / w, usableH / h);
    const tx = width / 2 - center.x * scale;
    const ty = height / 2 + center.y * scale; // flip Y
    return { scale, tx, ty };
  }, [bbox, height, padding, width]);

  const strokeWidthPx = view ? Math.max(0.6, 1.1 / view.scale) : 1;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="DXF preview"
    >
      {background ? <rect x={0} y={0} width={width} height={height} fill={background} /> : null}
      {view ? (
        <g
          transform={`translate(${view.tx} ${view.ty}) scale(${view.scale} ${-view.scale})`}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidthPx}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {entities.map((ent, i) => renderEntity(ent, i))}
        </g>
      ) : (
        <g>
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(80, 95, 130, 0.75)"
            fontSize={13}
          >
            No previewable geometry
          </text>
        </g>
      )}
    </svg>
  );
}

function renderEntity(ent: DxfEntity, key: number) {
  switch (ent.kind) {
    case "line":
      return <line key={key} x1={ent.a.x} y1={ent.a.y} x2={ent.b.x} y2={ent.b.y} />;
    case "polyline": {
      const d =
        ent.points
          .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ") + (ent.closed ? " Z" : "");
      return <path key={key} d={d} />;
    }
    case "circle":
      return <circle key={key} cx={ent.center.x} cy={ent.center.y} r={ent.radius} />;
    case "arc":
      return <path key={key} d={arcPath(ent.center.x, ent.center.y, ent.radius, ent.startAngleDeg, ent.endAngleDeg)} />;
    case "point":
      return <circle key={key} cx={ent.at.x} cy={ent.at.y} r={0.5} />;
    default:
      return null;
  }
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  // DXF arcs sweep counter-clockwise from startDeg to endDeg.
  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const sweep = end - start;
  const normSweep = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const largeArc = normSweep > Math.PI ? 1 : 0;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}
