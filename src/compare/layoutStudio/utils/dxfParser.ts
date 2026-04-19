/**
 * Minimal READ-ONLY DXF parser.
 *
 * This module is for preview rendering ONLY. It must never write or normalize
 * geometry back into a DXF file — the Cut phase guarantees the uploaded DXF is
 * preserved byte-for-byte (see docs/layout-studio/50_LAYOUT_STUDIO_CUT_PHASE.md).
 *
 * Supported entities (sufficient for typical countertop / nesting DXFs):
 *   LINE, LWPOLYLINE, POLYLINE (+ VERTEX), CIRCLE, ARC, POINT
 *
 * The parser walks ASCII DXF group-code pairs and emits flattened polylines /
 * primitives in source units. Anything it doesn't understand is skipped — the
 * goal is "good enough preview", not full CAD fidelity.
 */

export type DxfPoint = { x: number; y: number };

export type DxfLine = { kind: "line"; a: DxfPoint; b: DxfPoint; layer?: string };
export type DxfPolyline = {
  kind: "polyline";
  points: DxfPoint[];
  closed: boolean;
  layer?: string;
};
export type DxfCircle = { kind: "circle"; center: DxfPoint; radius: number; layer?: string };
export type DxfArc = {
  kind: "arc";
  center: DxfPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  layer?: string;
};
export type DxfPointEntity = { kind: "point"; at: DxfPoint; layer?: string };

export type DxfEntity = DxfLine | DxfPolyline | DxfCircle | DxfArc | DxfPointEntity;

export type DxfBoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type DxfUnitsLabel = "mm" | "cm" | "in" | "ft" | "unitless";

export type ParsedDxf = {
  entities: DxfEntity[];
  bbox: DxfBoundingBox | null;
  unitsCode: number | null;
  unitsLabel: DxfUnitsLabel | null;
};

/** Map AutoCAD `$INSUNITS` codes to a friendly label (subset). */
function unitsLabelFor(code: number | null): DxfUnitsLabel | null {
  if (code == null) return null;
  switch (code) {
    case 0:
      return "unitless";
    case 1:
      return "in";
    case 2:
      return "ft";
    case 4:
      return "mm";
    case 5:
      return "cm";
    default:
      return null;
  }
}

/** Tokenize ASCII DXF into [code, value] pairs. Tolerant of CRLF / extra blanks. */
function tokenize(src: string): Array<[number, string]> {
  const lines = src.split(/\r\n|\r|\n/);
  const out: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeRaw = lines[i].trim();
    const value = lines[i + 1] ?? "";
    if (!codeRaw) continue;
    const code = Number.parseInt(codeRaw, 10);
    if (!Number.isFinite(code)) continue;
    out.push([code, value]);
  }
  return out;
}

function num(v: string): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function expandBbox(bbox: DxfBoundingBox | null, p: DxfPoint): DxfBoundingBox {
  if (!bbox) return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  return {
    minX: Math.min(bbox.minX, p.x),
    minY: Math.min(bbox.minY, p.y),
    maxX: Math.max(bbox.maxX, p.x),
    maxY: Math.max(bbox.maxY, p.y),
  };
}

function expandBboxCircle(bbox: DxfBoundingBox | null, c: DxfPoint, r: number): DxfBoundingBox {
  return expandBbox(
    expandBbox(
      expandBbox(expandBbox(bbox, { x: c.x - r, y: c.y - r }), { x: c.x + r, y: c.y - r }),
      { x: c.x - r, y: c.y + r },
    ),
    { x: c.x + r, y: c.y + r },
  );
}

/**
 * Parse ASCII DXF text. Throws on completely unparseable input; returns an
 * empty `entities` list with `bbox: null` if the file is structurally valid
 * but contains no supported entities.
 */
export function parseDxf(text: string): ParsedDxf {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    throw new Error("DXF file appears to be empty or non-ASCII.");
  }

  const entities: DxfEntity[] = [];
  let bbox: DxfBoundingBox | null = null;
  let unitsCode: number | null = null;

  // --- Pass 1: HEADER scan for $INSUNITS (best-effort; ignore on miss) ---
  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i][0] === 9 && tokens[i][1] === "$INSUNITS") {
      // Next group code 70 carries the integer value.
      for (let j = i + 1; j < Math.min(i + 6, tokens.length); j++) {
        if (tokens[j][0] === 70) {
          const v = Number.parseInt(tokens[j][1], 10);
          if (Number.isFinite(v)) unitsCode = v;
          break;
        }
      }
      break;
    }
  }

  // --- Pass 2: scan ENTITIES section ---
  let inEntities = false;
  let i = 0;
  while (i < tokens.length) {
    const [code, value] = tokens[i];
    if (code === 0 && value === "SECTION") {
      const nameTok = tokens[i + 1];
      if (nameTok && nameTok[0] === 2 && nameTok[1] === "ENTITIES") {
        inEntities = true;
        i += 2;
        continue;
      }
    }
    if (code === 0 && value === "ENDSEC" && inEntities) {
      inEntities = false;
      i += 1;
      continue;
    }
    if (!inEntities) {
      i += 1;
      continue;
    }
    if (code !== 0) {
      i += 1;
      continue;
    }

    // Read one entity block: collect tokens up to the next code-0 marker.
    const entityType = value;
    const block: Array<[number, string]> = [];
    i += 1;
    while (i < tokens.length && tokens[i][0] !== 0) {
      block.push(tokens[i]);
      i += 1;
    }

    const get = (c: number): string | undefined => {
      const t = block.find((p) => p[0] === c);
      return t ? t[1] : undefined;
    };
    const layer = get(8);

    switch (entityType) {
      case "LINE": {
        const a = { x: num(get(10) ?? "0"), y: num(get(20) ?? "0") };
        const b = { x: num(get(11) ?? "0"), y: num(get(21) ?? "0") };
        entities.push({ kind: "line", a, b, layer });
        bbox = expandBbox(expandBbox(bbox, a), b);
        break;
      }
      case "LWPOLYLINE": {
        const xs = block.filter((p) => p[0] === 10).map((p) => num(p[1]));
        const ys = block.filter((p) => p[0] === 20).map((p) => num(p[1]));
        const flagsRaw = get(70);
        const flags = flagsRaw ? Number.parseInt(flagsRaw, 10) : 0;
        const closed = (flags & 1) === 1;
        const points: DxfPoint[] = [];
        const n = Math.min(xs.length, ys.length);
        for (let k = 0; k < n; k++) {
          const p = { x: xs[k], y: ys[k] };
          points.push(p);
          bbox = expandBbox(bbox, p);
        }
        if (points.length >= 2) {
          entities.push({ kind: "polyline", points, closed, layer });
        }
        break;
      }
      case "POLYLINE": {
        // Vertices live in following VERTEX entities until SEQEND.
        const flagsRaw = get(70);
        const flags = flagsRaw ? Number.parseInt(flagsRaw, 10) : 0;
        const closed = (flags & 1) === 1;
        const points: DxfPoint[] = [];
        // Walk ahead through VERTEX entities.
        while (i < tokens.length && tokens[i][0] === 0 && tokens[i][1] === "VERTEX") {
          i += 1;
          const vtxBlock: Array<[number, string]> = [];
          while (i < tokens.length && tokens[i][0] !== 0) {
            vtxBlock.push(tokens[i]);
            i += 1;
          }
          const vget = (c: number): string | undefined => vtxBlock.find((p) => p[0] === c)?.[1];
          const p = { x: num(vget(10) ?? "0"), y: num(vget(20) ?? "0") };
          points.push(p);
          bbox = expandBbox(bbox, p);
        }
        // Skip SEQEND if present.
        if (i < tokens.length && tokens[i][0] === 0 && tokens[i][1] === "SEQEND") {
          i += 1;
          while (i < tokens.length && tokens[i][0] !== 0) i += 1;
        }
        if (points.length >= 2) {
          entities.push({ kind: "polyline", points, closed, layer });
        }
        // Note: do NOT advance past the next entity marker; the outer loop will read it.
        continue;
      }
      case "CIRCLE": {
        const center = { x: num(get(10) ?? "0"), y: num(get(20) ?? "0") };
        const radius = num(get(40) ?? "0");
        if (radius > 0) {
          entities.push({ kind: "circle", center, radius, layer });
          bbox = expandBboxCircle(bbox, center, radius);
        }
        break;
      }
      case "ARC": {
        const center = { x: num(get(10) ?? "0"), y: num(get(20) ?? "0") };
        const radius = num(get(40) ?? "0");
        const startAngleDeg = num(get(50) ?? "0");
        const endAngleDeg = num(get(51) ?? "0");
        if (radius > 0) {
          entities.push({ kind: "arc", center, radius, startAngleDeg, endAngleDeg, layer });
          // Conservative bbox: full circle bounds; refining requires sweep math.
          bbox = expandBboxCircle(bbox, center, radius);
        }
        break;
      }
      case "POINT": {
        const at = { x: num(get(10) ?? "0"), y: num(get(20) ?? "0") };
        entities.push({ kind: "point", at, layer });
        bbox = expandBbox(bbox, at);
        break;
      }
      default:
        // Unsupported entity — skip silently (preview-only parser).
        break;
    }
  }

  return {
    entities,
    bbox,
    unitsCode,
    unitsLabel: unitsLabelFor(unitsCode),
  };
}

/** DXF Y axis points up; preview surfaces flip to screen Y at render time. */
export function bboxWidth(bbox: DxfBoundingBox): number {
  return bbox.maxX - bbox.minX;
}
export function bboxHeight(bbox: DxfBoundingBox): number {
  return bbox.maxY - bbox.minY;
}
export function bboxCenter(bbox: DxfBoundingBox): DxfPoint {
  return { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
}

/** Convert DXF source units to inches. Returns 1 (no conversion) when unknown. */
export function dxfUnitToInches(label: DxfUnitsLabel | null): number {
  switch (label) {
    case "mm":
      return 1 / 25.4;
    case "cm":
      return 1 / 2.54;
    case "in":
      return 1;
    case "ft":
      return 12;
    case "unitless":
    case null:
    default:
      return 1;
  }
}
