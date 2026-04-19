import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CutPlacement, ScannedSlabRef } from "../types";
import {
  bboxCenter,
  bboxHeight,
  bboxWidth,
  dxfUnitToInches,
  type DxfBoundingBox,
  type DxfEntity,
  type DxfUnitsLabel,
} from "../utils/dxfParser";
import { CutDxfPreview } from "./CutDxfPreview";

type Props = {
  slab: ScannedSlabRef;
  dxf: {
    fileName: string;
    entities: DxfEntity[];
    bbox: DxfBoundingBox | null;
    unitsLabel: DxfUnitsLabel | null;
  };
  placement: CutPlacement;
  onPlacementChange: (next: CutPlacement) => void;
  /** When true, controls are hidden (used for read-only export previews). */
  readOnly?: boolean;
};

/**
 * Cut-phase two-pane workspace.
 *   Left  — Slab placement: scanned slab image with the DXF overlay drag/rotate
 *   Right — DXF: read-only reference of the imported file (unmodified)
 *
 * Hard invariant: the DXF bytes are NEVER changed. Position / rotation /
 * mirror live exclusively in `placement` (parent state, persisted as
 * metadata).
 */
export function CutWorkspace({ slab, dxf, placement, onPlacementChange, readOnly = false }: Props) {
  const slabPaneRef = useRef<HTMLDivElement | null>(null);
  const [paneSize, setPaneSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = slabPaneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setPaneSize({ width: r.width, height: r.height });
    });
    obs.observe(el);
    const r0 = el.getBoundingClientRect();
    setPaneSize({ width: r0.width, height: r0.height });
    return () => obs.disconnect();
  }, []);

  /** Inches → px scale that fits the whole slab in the available pane. */
  const slabFit = useMemo(() => {
    if (paneSize.width <= 0 || paneSize.height <= 0) {
      return { scale: 1, offsetX: 0, offsetY: 0, slabPxW: 0, slabPxH: 0 };
    }
    const padding = 24;
    const usableW = Math.max(paneSize.width - padding * 2, 1);
    const usableH = Math.max(paneSize.height - padding * 2, 1);
    const scale = Math.min(usableW / slab.widthIn, usableH / slab.heightIn);
    const slabPxW = slab.widthIn * scale;
    const slabPxH = slab.heightIn * scale;
    return {
      scale,
      offsetX: (paneSize.width - slabPxW) / 2,
      offsetY: (paneSize.height - slabPxH) / 2,
      slabPxW,
      slabPxH,
    };
  }, [paneSize, slab.heightIn, slab.widthIn]);

  /** DXF source units → inches conversion factor (best-effort). */
  const dxfUnitFactor = useMemo(() => dxfUnitToInches(dxf.unitsLabel), [dxf.unitsLabel]);

  const dxfFootprint = useMemo(() => {
    if (!dxf.bbox) return null;
    const wIn = bboxWidth(dxf.bbox) * dxfUnitFactor;
    const hIn = bboxHeight(dxf.bbox) * dxfUnitFactor;
    return { widthIn: wIn, heightIn: hIn, center: bboxCenter(dxf.bbox) };
  }, [dxf.bbox, dxfUnitFactor]);

  // Drag state
  const dragRef = useRef<{
    mode: "move" | "rotate";
    pointerId: number;
    startCenterX: number;
    startCenterY: number;
    startRotation: number;
    startPointer: { x: number; y: number };
  } | null>(null);

  const beginDrag = useCallback(
    (e: React.PointerEvent<Element>, mode: "move" | "rotate") => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        mode,
        pointerId: e.pointerId,
        startCenterX: placement.centerX,
        startCenterY: placement.centerY,
        startRotation: placement.rotationDeg,
        startPointer: { x: e.clientX, y: e.clientY },
      };
    },
    [placement.centerX, placement.centerY, placement.rotationDeg, readOnly],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.mode === "move") {
        const dxPx = e.clientX - drag.startPointer.x;
        const dyPx = e.clientY - drag.startPointer.y;
        const dxIn = dxPx / Math.max(slabFit.scale, 1e-6);
        const dyIn = dyPx / Math.max(slabFit.scale, 1e-6);
        onPlacementChange({
          ...placement,
          centerX: drag.startCenterX + dxIn,
          centerY: drag.startCenterY + dyIn,
        });
      } else {
        // Rotate around DXF center, using pointer angle relative to slab pane.
        const pane = slabPaneRef.current?.getBoundingClientRect();
        if (!pane) return;
        const cxPx = pane.left + slabFit.offsetX + placement.centerX * slabFit.scale;
        const cyPx = pane.top + slabFit.offsetY + placement.centerY * slabFit.scale;
        const startAng = Math.atan2(drag.startPointer.y - cyPx, drag.startPointer.x - cxPx);
        const nowAng = Math.atan2(e.clientY - cyPx, e.clientX - cxPx);
        const deltaDeg = ((nowAng - startAng) * 180) / Math.PI;
        let next = drag.startRotation + deltaDeg;
        if (e.shiftKey) next = Math.round(next / 15) * 15;
        onPlacementChange({ ...placement, rotationDeg: next });
      }
    },
    [onPlacementChange, placement, slabFit.offsetX, slabFit.offsetY, slabFit.scale],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }, []);

  // Keyboard nudges
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!slabPaneRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const big = e.shiftKey;
      const stepIn = big ? 1 : 0.125;
      const rotStep = big ? 15 : 1;
      switch (e.key) {
        case "ArrowLeft":
          onPlacementChange({ ...placement, centerX: placement.centerX - stepIn });
          e.preventDefault();
          break;
        case "ArrowRight":
          onPlacementChange({ ...placement, centerX: placement.centerX + stepIn });
          e.preventDefault();
          break;
        case "ArrowUp":
          onPlacementChange({ ...placement, centerY: placement.centerY - stepIn });
          e.preventDefault();
          break;
        case "ArrowDown":
          onPlacementChange({ ...placement, centerY: placement.centerY + stepIn });
          e.preventDefault();
          break;
        case "[":
          onPlacementChange({ ...placement, rotationDeg: placement.rotationDeg - rotStep });
          e.preventDefault();
          break;
        case "]":
          onPlacementChange({ ...placement, rotationDeg: placement.rotationDeg + rotStep });
          e.preventDefault();
          break;
        case "m":
        case "M":
          onPlacementChange({ ...placement, mirrored: !placement.mirrored });
          e.preventDefault();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPlacementChange, placement, readOnly]);

  const overlayStyle = useMemo<React.CSSProperties | null>(() => {
    if (!dxfFootprint) return null;
    const wPx = dxfFootprint.widthIn * slabFit.scale;
    const hPx = dxfFootprint.heightIn * slabFit.scale;
    const leftPx = slabFit.offsetX + placement.centerX * slabFit.scale - wPx / 2;
    const topPx = slabFit.offsetY + placement.centerY * slabFit.scale - hPx / 2;
    return {
      left: leftPx,
      top: topPx,
      width: wPx,
      height: hPx,
      transform: `rotate(${placement.rotationDeg}deg)`,
      transformOrigin: "center center",
    };
  }, [dxfFootprint, placement.centerX, placement.centerY, placement.rotationDeg, slabFit.offsetX, slabFit.offsetY, slabFit.scale]);

  const overlayInnerStyle = useMemo<React.CSSProperties | null>(() => {
    if (!placement.mirrored) return null;
    return { transform: "scaleX(-1)", transformOrigin: "center center" };
  }, [placement.mirrored]);

  const dxfPreviewSize = useMemo(() => {
    if (!overlayStyle) return { w: 0, h: 0 };
    return { w: Number(overlayStyle.width), h: Number(overlayStyle.height) };
  }, [overlayStyle]);

  // Out-of-bounds warning (calm, not blocking).
  const outOfBounds = useMemo(() => {
    if (!dxfFootprint) return false;
    const r = dxfFootprint.widthIn / 2;
    const b = dxfFootprint.heightIn / 2;
    if (placement.centerX - r < 0) return true;
    if (placement.centerY - b < 0) return true;
    if (placement.centerX + r > slab.widthIn) return true;
    if (placement.centerY + b > slab.heightIn) return true;
    return false;
  }, [dxfFootprint, placement.centerX, placement.centerY, slab.heightIn, slab.widthIn]);

  return (
    <div className="ls-cut-workspace">
      {/* LEFT — slab + DXF overlay */}
      <div className="ls-cut-pane ls-cut-pane--slab">
        <header className="ls-cut-pane-header">
          <div>
            <p className="ls-cut-pane-kicker">Slab placement</p>
            <h3 className="ls-cut-pane-title">{slab.label}</h3>
            <p className="ls-cut-pane-meta">
              {formatIn(slab.widthIn)} × {formatIn(slab.heightIn)} • real inventory
            </p>
          </div>
          <div className="ls-cut-pane-status" aria-live="polite">
            {outOfBounds ? <span className="ls-cut-warn">DXF extends past slab</span> : <span className="ls-cut-ok">In bounds</span>}
          </div>
        </header>
        <div
          ref={slabPaneRef}
          className="ls-cut-stage"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="ls-cut-slab"
            style={{
              left: slabFit.offsetX,
              top: slabFit.offsetY,
              width: slabFit.slabPxW,
              height: slabFit.slabPxH,
              backgroundImage: `url(${JSON.stringify(slab.imageUrl)})`,
            }}
            aria-label={`${slab.label} scan`}
          />
          {overlayStyle ? (
            <div
              className={`ls-cut-overlay${readOnly ? " is-readonly" : ""}${outOfBounds ? " is-warn" : ""}`}
              style={overlayStyle}
              onPointerDown={(e) => beginDrag(e, "move")}
              role="group"
              aria-label="DXF placement"
            >
              <div className="ls-cut-overlay-inner" style={overlayInnerStyle ?? undefined}>
                <CutDxfPreview
                  entities={dxf.entities}
                  bbox={dxf.bbox}
                  width={Math.max(dxfPreviewSize.w, 1)}
                  height={Math.max(dxfPreviewSize.h, 1)}
                  stroke="rgba(252, 244, 220, 0.95)"
                  background="rgba(20, 32, 60, 0.18)"
                />
              </div>
              {!readOnly ? (
                <button
                  type="button"
                  className="ls-cut-rotate-handle"
                  aria-label="Rotate DXF"
                  onPointerDown={(e) => beginDrag(e, "rotate")}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {!readOnly ? (
          <footer className="ls-cut-pane-footer">
            <span>
              Drag to move • drag handle to rotate • <kbd>[</kbd>/<kbd>]</kbd> rotate •{" "}
              <kbd>Shift</kbd>+arrows nudge 1″ • <kbd>M</kbd> mirror
            </span>
            <span>
              X {formatIn(placement.centerX)} • Y {formatIn(placement.centerY)} •{" "}
              {placement.rotationDeg.toFixed(1)}°{placement.mirrored ? " • mirrored" : ""}
            </span>
          </footer>
        ) : null}
      </div>

      {/* RIGHT — read-only DXF reference */}
      <div className="ls-cut-pane ls-cut-pane--dxf">
        <header className="ls-cut-pane-header">
          <div>
            <p className="ls-cut-pane-kicker">DXF (read-only)</p>
            <h3 className="ls-cut-pane-title">{dxf.fileName}</h3>
            <p className="ls-cut-pane-meta">
              {dxf.entities.length} entities •{" "}
              {dxf.bbox
                ? `${(bboxWidth(dxf.bbox) * dxfUnitFactor).toFixed(2)} × ${(bboxHeight(dxf.bbox) * dxfUnitFactor).toFixed(2)} in`
                : "no bbox"}
              {dxf.unitsLabel ? ` • units: ${dxf.unitsLabel}` : ""}
            </p>
          </div>
          <span className="ls-cut-readonly-badge" title="The uploaded DXF is never modified">
            Untouched
          </span>
        </header>
        <div className="ls-cut-dxf-canvas">
          <DxfFitPreview entities={dxf.entities} bbox={dxf.bbox} />
        </div>
      </div>
    </div>
  );
}

function DxfFitPreview({ entities, bbox }: { entities: DxfEntity[]; bbox: DxfBoundingBox | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    obs.observe(el);
    const r0 = el.getBoundingClientRect();
    setSize({ w: r0.width, h: r0.height });
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className="ls-cut-dxf-fit">
      <CutDxfPreview entities={entities} bbox={bbox} width={Math.max(size.w, 1)} height={Math.max(size.h, 1)} />
    </div>
  );
}

function formatIn(n: number): string {
  if (Math.abs(n) >= 100) return `${n.toFixed(1)}″`;
  return `${n.toFixed(2)}″`;
}
