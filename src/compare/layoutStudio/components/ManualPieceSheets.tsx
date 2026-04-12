import { useEffect, useState } from "react";
import type { LayoutPiece, LShapeOrientationDeg } from "../types";
import { lShapePointsInches, rectanglePointsInches } from "../utils/manualPieces";
import { defaultNonSplashPieceName } from "../utils/pieceLabels";

type BaseProps = {
  open: boolean;
  title: string;
  onClose: () => void;
};

type RectProps = BaseProps & {
  /** Number of non-splash pieces before adding (used for default "Piece A" / "Piece B" names). */
  nonSplashPieceCount: number;
  staggerIn: number;
  onSave: (piece: LayoutPiece) => void;
};

export function ManualRectangleSheet({
  open,
  title,
  onClose,
  nonSplashPieceCount,
  staggerIn,
  onSave,
}: RectProps) {
  const [name, setName] = useState("");
  const [widthIn, setWidthIn] = useState("120");
  const [depthIn, setDepthIn] = useState("25.5");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(defaultNonSplashPieceName(nonSplashPieceCount));
    setWidthIn("120");
    setDepthIn("25.5");
    setNotes("");
  }, [open, nonSplashPieceCount]);

  if (!open) return null;

  const submit = () => {
    const w = Math.max(0.5, parseFloat(widthIn) || 0);
    const d = Math.max(0.5, parseFloat(depthIn) || 0);
    const pts = rectanglePointsInches(w, d).map((p) => ({
      x: p.x + staggerIn,
      y: p.y + staggerIn,
    }));
    const id = crypto.randomUUID();
    const piece: LayoutPiece = {
      id,
      name: name.trim() || defaultNonSplashPieceName(nonSplashPieceCount),
      points: pts,
      sinkCount: 0,
      notes: notes.trim() || undefined,
      shapeKind: "rectangle",
      source: "manual",
      manualDimensions: { kind: "rectangle", widthIn: w, depthIn: d },
      planTransform: { x: 0, y: 0 },
      pieceRole: "countertop",
    };
    onSave(piece);
    onClose();
  };

  return (
    <div className="ls-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ls-sheet glass-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ls-rect-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="ls-rect-sheet-title" className="ls-sheet-title">
          {title}
        </h2>
        <p className="ls-muted">Dimensions in inches. You can edit later in the piece list.</p>
        <div className="ls-sheet-grid">
          <label className="ls-field">
            Name
            <input className="ls-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="ls-field">
            Width
            <input
              className="ls-input"
              type="number"
              min={0.5}
              step={0.5}
              value={widthIn}
              onChange={(e) => setWidthIn(e.target.value)}
            />
          </label>
          <label className="ls-field">
            Depth
            <input
              className="ls-input"
              type="number"
              min={0.5}
              step={0.5}
              value={depthIn}
              onChange={(e) => setDepthIn(e.target.value)}
            />
          </label>
          <label className="ls-field ls-field-span">
            Notes (optional)
            <input className="ls-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <div className="ls-sheet-actions">
          <button type="button" className="ls-btn ls-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ls-btn ls-btn-primary" onClick={submit}>
            Add piece
          </button>
        </div>
      </div>
    </div>
  );
}

type LProps = BaseProps & {
  /** Number of non-splash pieces before adding (used for default "Piece A" / "Piece B" names). */
  nonSplashPieceCount: number;
  staggerIn: number;
  onSave: (piece: LayoutPiece) => void;
};

export function ManualLShapeSheet({ open, title, onClose, nonSplashPieceCount, staggerIn, onSave }: LProps) {
  const [name, setName] = useState("");
  const [legA, setLegA] = useState("96");
  const [legB, setLegB] = useState("120");
  const [depth, setDepth] = useState("25.5");
  const [orientation, setOrientation] = useState<LShapeOrientationDeg>(0);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(defaultNonSplashPieceName(nonSplashPieceCount));
    setLegA("96");
    setLegB("120");
    setDepth("25.5");
    setOrientation(0);
    setNotes("");
  }, [open, nonSplashPieceCount]);

  if (!open) return null;

  const submit = () => {
    const la = Math.max(0.5, parseFloat(legA) || 0);
    const lb = Math.max(0.5, parseFloat(legB) || 0);
    const dep = Math.max(0.5, parseFloat(depth) || 0);
    const pts = lShapePointsInches(la, lb, dep, orientation).map((p) => ({
      x: p.x + staggerIn,
      y: p.y + staggerIn,
    }));
    const id = crypto.randomUUID();
    const piece: LayoutPiece = {
      id,
      name: name.trim() || defaultNonSplashPieceName(nonSplashPieceCount),
      points: pts,
      sinkCount: 0,
      notes: notes.trim() || undefined,
      shapeKind: "lShape",
      source: "manual",
      manualDimensions: {
        kind: "lShape",
        legAIn: la,
        legBIn: lb,
        depthIn: dep,
        orientation,
      },
      planTransform: { x: 0, y: 0 },
      pieceRole: "countertop",
    };
    onSave(piece);
    onClose();
  };

  return (
    <div className="ls-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ls-sheet glass-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ls-l-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="ls-l-sheet-title" className="ls-sheet-title">
          {title}
        </h2>
        <p className="ls-muted">
          Leg A and Leg B are the two main runs; depth is the counter depth. Orientation spins the whole shape.
        </p>
        <div className="ls-sheet-grid">
          <label className="ls-field">
            Name
            <input className="ls-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="ls-field">
            Leg A
            <input className="ls-input" type="number" min={0.5} step={0.5} value={legA} onChange={(e) => setLegA(e.target.value)} />
          </label>
          <label className="ls-field">
            Leg B
            <input className="ls-input" type="number" min={0.5} step={0.5} value={legB} onChange={(e) => setLegB(e.target.value)} />
          </label>
          <label className="ls-field">
            Depth
            <input className="ls-input" type="number" min={0.5} step={0.5} value={depth} onChange={(e) => setDepth(e.target.value)} />
          </label>
          <label className="ls-field">
            Orientation
            <select
              className="ls-input"
              value={orientation}
              onChange={(e) => setOrientation(Number(e.target.value) as LShapeOrientationDeg)}
            >
              <option value={0}>0°</option>
              <option value={90}>90°</option>
              <option value={180}>180°</option>
              <option value={270}>270°</option>
            </select>
          </label>
          <label className="ls-field ls-field-span">
            Notes (optional)
            <input className="ls-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <div className="ls-sheet-actions">
          <button type="button" className="ls-btn ls-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ls-btn ls-btn-primary" onClick={submit}>
            Add piece
          </button>
        </div>
      </div>
    </div>
  );
}
