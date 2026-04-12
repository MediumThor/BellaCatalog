import { memo, useState } from "react";
import type { ImportWarning } from "../types/catalog";

type Props = {
  warnings: ImportWarning[];
  /** When true, start expanded (e.g. in Settings). */
  defaultExpanded?: boolean;
};

function ImportWarningsPanelInner({ warnings, defaultExpanded = false }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  if (!warnings.length) return null;

  const errors = warnings.filter((w) => w.severity === "error").length;

  return (
    <section className="import-warnings" aria-label="Import warnings">
      <button
        type="button"
        className="btn btn-ghost"
        style={{ width: "100%", justifyContent: "space-between", marginBottom: open ? "0.5rem" : 0 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          Import notices ({warnings.length}
          {errors ? `, ${errors} error${errors > 1 ? "s" : ""}` : ""})
        </span>
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div>
          {warnings.map((w, i) => (
            <div
              key={`${w.message}-${i}`}
              className={`warning-item${w.severity === "error" ? " warning-item--error" : ""}`}
            >
              <strong>[{w.severity}]</strong> {w.message}
              {w.sourceFile ? (
                <span className="product-sub"> — {w.sourceFile}</span>
              ) : null}
              {typeof w.rowIndex === "number" ? (
                <span className="product-sub"> (row {w.rowIndex})</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export const ImportWarningsPanel = memo(ImportWarningsPanelInner);
