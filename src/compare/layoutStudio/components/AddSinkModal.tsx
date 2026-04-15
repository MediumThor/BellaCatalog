import { useEffect, useState } from "react";
import type { FaucetEvenHoleBias, FaucetSpreadIn, PieceSinkTemplateKind } from "../types";
import { AddSinkPreviewSvg } from "./AddSinkPreviewSvg";

type Props = {
  open: boolean;
  /** Rotation matching the selected piece edge (blank plan). */
  previewRotationDeg?: number;
  onClose: () => void;
  onConfirm: (input: {
    name: string;
    templateKind: PieceSinkTemplateKind;
    faucetHoleCount: number;
    spreadIn: FaucetSpreadIn;
    evenHoleBias: FaucetEvenHoleBias;
  }) => void;
};

const SPREADS: FaucetSpreadIn[] = [2, 4, 8, 10, 12];
const FAUCET_HOLE_OPTIONS = [1, 2, 3, 4, 5] as const;

export function AddSinkModal({ open, previewRotationDeg = 0, onClose, onConfirm }: Props) {
  const [name, setName] = useState("");
  const [templateKind, setTemplateKind] = useState<PieceSinkTemplateKind>("kitchen");
  const [faucetHoleCount, setFaucetHoleCount] = useState(1);
  const [spreadIn, setSpreadIn] = useState<FaucetSpreadIn>(4);
  const [evenHoleBias, setEvenHoleBias] = useState<FaucetEvenHoleBias>("right");

  useEffect(() => {
    if (open) {
      setName("");
      setTemplateKind("kitchen");
      setFaucetHoleCount(1);
      setSpreadIn(4);
      setEvenHoleBias("right");
    }
  }, [open]);

  if (!open) return null;

  const n = Math.max(1, Math.min(5, Math.floor(faucetHoleCount) || 1));
  const showSpread = n > 1;
  const showEvenBias = n === 2 || n === 4;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm({
      name: trimmed,
      templateKind,
      faucetHoleCount: n,
      spreadIn,
      evenHoleBias,
    });
    onClose();
  };

  return (
    <div
      className="ls-sheet-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="ls-sheet glass-panel ls-add-sink-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ls-add-sink-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="ls-add-sink-title" className="ls-sheet-title">
          Add sink cutout
        </h2>
        <p className="ls-muted">
          Shapes are for quoting only and do not reduce square footage.
        </p>
        <div className="ls-add-sink-modal-body">
          <div className="ls-sheet-grid ls-add-sink-modal-fields">
            <label className="ls-field ls-field-span">
              Sink name <span className="ls-req">*</span>
              <input
                className="ls-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Kitchen main"
                autoFocus
              />
            </label>
            <label className="ls-field ls-field-span">
              Sink type
              <select
                className="ls-input"
                value={templateKind}
                onChange={(e) => setTemplateKind(e.target.value as PieceSinkTemplateKind)}
              >
                <option value="kitchen">Kitchen — 30×16 in, 0.7 in corner radius</option>
                <option value="vanitySquare">Vanity square — 17×14 in, 0.7 in corner radius</option>
                <option value="vanityRound">Vanity round — oval 15×12 in</option>
              </select>
            </label>
            <label className="ls-field">
              Faucet holes
              <div className="ls-hole-count-toggle" role="group" aria-label="Faucet hole count">
                {FAUCET_HOLE_OPTIONS.map((holeCount) => (
                  <button
                    key={holeCount}
                    type="button"
                    className={`ls-hole-count-toggle-btn${n === holeCount ? " is-active" : ""}`}
                    aria-pressed={n === holeCount}
                    onClick={() => setFaucetHoleCount(holeCount)}
                  >
                    {holeCount}
                  </button>
                ))}
              </div>
            </label>
            {showSpread ? (
              <fieldset className="ls-field ls-field-span ls-faucet-spread-fieldset">
                <legend className="ls-faucet-spread-legend">Hole spread (in)</legend>
                <p className="ls-muted ls-add-sink-bias-hint">
                  Center to center: distance from the center of one hole to the center of the next adjacent
                  hole.
                </p>
                <div className="ls-hole-count-toggle" role="group" aria-label="Hole spread in inches">
                  {SPREADS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`ls-hole-count-toggle-btn${spreadIn === s ? " is-active" : ""}`}
                      aria-pressed={spreadIn === s}
                      onClick={() => setSpreadIn(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {showEvenBias ? (
              <fieldset className="ls-field ls-field-span ls-faucet-spread-fieldset">
                <legend className="ls-faucet-spread-legend">
                  Extra holes (2 or 4): which side of center?
                </legend>
                <div className="ls-radio-row">
                  <label className="ls-radio-label">
                    <input
                      type="radio"
                      name="faucet-even-bias"
                      checked={evenHoleBias === "left"}
                      onChange={() => setEvenHoleBias("left")}
                    />
                    Left of center
                  </label>
                  <label className="ls-radio-label">
                    <input
                      type="radio"
                      name="faucet-even-bias"
                      checked={evenHoleBias === "right"}
                      onChange={() => setEvenHoleBias("right")}
                    />
                    Right of center
                  </label>
                </div>
              </fieldset>
            ) : null}
          </div>
          <AddSinkPreviewSvg
            templateKind={templateKind}
            faucetHoleCount={n}
            spreadIn={spreadIn}
            evenHoleBias={evenHoleBias}
            previewRotationDeg={previewRotationDeg}
          />
        </div>
        <div className="ls-sheet-actions">
          <button type="button" className="ls-btn ls-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ls-btn ls-btn-primary"
            onClick={submit}
            disabled={!name.trim()}
          >
            Place sink
          </button>
        </div>
      </div>
    </div>
  );
}
