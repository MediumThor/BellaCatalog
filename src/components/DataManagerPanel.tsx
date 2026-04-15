import { memo, useEffect, useMemo, useState } from "react";
import type { NormalizedCatalog } from "../types/catalog";
import type { ImportParserId } from "../types/imports";
import { downloadJson } from "../utils/import/downloadJson";
import {
  loadOverlayState,
  markSourceFileRemoved,
  removeImportedSource,
  saveOverlayState,
  unremoveItem,
  unremoveSourceFile,
  upsertImportedSource,
} from "../utils/import/importStorage";
import { mergeCatalogWithOverlay } from "../utils/import/mergeCatalog";
import { importPdfFile } from "../utils/import/pdfImport";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Render inline (e.g. inside Settings) without a second modal backdrop. */
  embedded?: boolean;
  baseCatalog: NormalizedCatalog | null;
  overlayVersion: number;
  onOverlayChanged: () => void;
};

const PARSERS: { id: ImportParserId; label: string }[] = [
  { id: "auto", label: "Auto-detect (recommended)" },
  { id: "msi_q_quartz", label: "MSI Q Quartz (Bronze list)" },
  { id: "stonex", label: "StoneX (Quartz or Natural)" },
  { id: "daltile_natural", label: "Daltile (Central Natural Stone)" },
  { id: "hanstone", label: "HanStone MW IL/WI sheet" },
  { id: "ugm_uquartz", label: "UGM UQuartz" },
  { id: "ugm_natural", label: "UGM Natural Stone" },
  { id: "trends_quartz", label: "Trends in Quartz (Jaeckle)" },
  { id: "viatera", label: "Viatera (project code PDF)" },
  { id: "vadara", label: "Vadara (UGM 2026)" },
  { id: "corian_hallmark", label: "Corian Quartz (Hallmark)" },
  { id: "cosentino_quickship", label: "Cosentino 2026 (Quick Ship accessories)" },
];

function DataManagerPanelInner({
  open,
  onClose,
  embedded = false,
  baseCatalog,
  overlayVersion,
  onOverlayChanged,
}: Props) {
  const [parserId, setParserId] = useState<ImportParserId>("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { sourceFile: string; count: number }>(null);

  const overlay = useMemo(() => loadOverlayState(), [overlayVersion]);

  useEffect(() => {
    if (!open || embedded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirm) setConfirm(null);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, confirm, embedded]);

  const allSourceFiles = useMemo(() => {
    const base = baseCatalog?.items ?? [];
    const set = new Map<string, { sourceFile: string; count: number; vendorHint: string }>();
    for (const it of base) {
      const key = it.sourceFile || "unknown";
      const prev = set.get(key);
      set.set(key, {
        sourceFile: key,
        count: (prev?.count ?? 0) + 1,
        vendorHint: prev?.vendorHint ?? it.vendor,
      });
    }
    for (const s of overlay.importedSources) {
      const key = s.sourceFile;
      const prev = set.get(key);
      set.set(key, {
        sourceFile: key,
        count: (prev?.count ?? 0) + s.items.length,
        vendorHint: prev?.vendorHint ?? s.vendor,
      });
    }
    return [...set.values()].sort((a, b) => a.vendorHint.localeCompare(b.vendorHint));
  }, [baseCatalog, overlay.importedSources]);

  async function onUploadPdf(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const src = await importPdfFile(file, parserId);
      const next = upsertImportedSource(src);
      saveOverlayState(next);
      onOverlayChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function requestRemove(sourceFile: string) {
    const count =
      (baseCatalog?.items.filter((i) => i.sourceFile === sourceFile).length ?? 0) +
      overlay.importedSources
        .filter((s) => s.sourceFile === sourceFile)
        .reduce((acc, s) => acc + s.items.length, 0);
    setConfirm({ sourceFile, count });
  }

  function confirmRemove() {
    if (!confirm) return;
    const next = markSourceFileRemoved(confirm.sourceFile);
    saveOverlayState(next);
    setConfirm(null);
    onOverlayChanged();
  }

  function restore(sourceFile: string) {
    const next = unremoveSourceFile(sourceFile);
    saveOverlayState(next);
    onOverlayChanged();
  }

  function removeImported(id: string) {
    const next = removeImportedSource(id);
    saveOverlayState(next);
    onOverlayChanged();
  }

  function restoreHiddenRow(itemId: string) {
    const next = unremoveItem(itemId);
    saveOverlayState(next);
    onOverlayChanged();
  }

  function downloadMerged() {
    if (!baseCatalog) return;
    const merged = mergeCatalogWithOverlay(baseCatalog, overlay);
    downloadJson("catalog.merged.json", {
      importWarnings: merged.importWarnings,
      items: merged.items,
    });
  }

  const panel = (
    <section className="filter-panel data-manager-modal__body" aria-label="Data manager">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div id="data-manager-title" style={{ fontWeight: 800, letterSpacing: "0.02em" }}>
            Data manager
          </div>
          <div className="product-sub">
            Upload supplier PDFs, remove whole source lists, hide single rows, or restore hidden entries. Everything
            here is merged through the local overlay on this computer.
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <button type="button" className="btn" onClick={downloadMerged} disabled={!baseCatalog}>
            Download merged JSON
          </button>
          {!embedded ? (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>

      {err ? (
        <div className="import-warnings" style={{ marginTop: "0.75rem" }} role="alert">
          <strong>PDF import failed.</strong> {err}
        </div>
      ) : null}

      <div className="toolbar" style={{ marginTop: "0.75rem" }}>
        <div className="toolbar-group" style={{ minWidth: "260px" }}>
          <label htmlFor="parser-select">Parser</label>
          <select
            id="parser-select"
            className="search-input"
            value={parserId}
            onChange={(e) => setParserId(e.target.value as ImportParserId)}
          >
            {PARSERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="filter-hint">If auto-detect fails, pick the vendor explicitly.</div>
        </div>
        <div className="toolbar-group" style={{ minWidth: "260px" }}>
          <label htmlFor="pdf-upload">Upload supplier PDF</label>
          <input
            id="pdf-upload"
            className="search-input"
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void onUploadPdf(f);
              e.currentTarget.value = "";
            }}
          />
          <div className="filter-hint">Parsing happens in the browser; large PDFs may take a moment.</div>
        </div>
      </div>

      <details style={{ marginTop: "0.5rem" }}>
        <summary>Imported sources (local)</summary>
        <div style={{ marginTop: "0.5rem" }}>
          {overlay.importedSources.length === 0 ? (
            <div className="product-sub">No local imports yet.</div>
          ) : (
            overlay.importedSources.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderTop: "1px solid var(--bella-border)",
                  padding: "0.5rem 0",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{s.sourceFile}</div>
                  <div className="product-sub">
                    {s.vendor} · {s.parserId === "manual" ? "manual entry" : "pdf import"} · {s.items.length} rows
                    {" · "}
                    {new Date(s.importedAtIso).toLocaleString()}
                  </div>
                </div>
                <button type="button" className="btn" onClick={() => removeImported(s.id)}>
                  Remove import
                </button>
              </div>
            ))
          )}
        </div>
      </details>

      <details style={{ marginTop: "0.5rem" }}>
        <summary>Hidden rows ({overlay.removedItemIds.length})</summary>
        <div style={{ marginTop: "0.5rem" }}>
          {overlay.removedItemIds.length === 0 ? (
            <div className="product-sub">No per-row removals yet. Use Remove on a product row in the catalog.</div>
          ) : (
            overlay.removedItemIds.map((id) => (
              <div
                key={id}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderTop: "1px solid var(--bella-border)",
                  padding: "0.5rem 0",
                }}
              >
                <div
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: "0.75rem",
                    wordBreak: "break-all",
                    paddingRight: "0.5rem",
                  }}
                >
                  {id}
                </div>
                <button type="button" className="btn" onClick={() => restoreHiddenRow(id)}>
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </details>

      <details style={{ marginTop: "0.5rem" }}>
        <summary>All source files (remove/restore)</summary>
        <div style={{ marginTop: "0.5rem" }}>
          {allSourceFiles.map((sf) => {
            const removed = overlay.removedSourceFiles.includes(sf.sourceFile);
            return (
              <div
                key={sf.sourceFile}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderTop: "1px solid var(--bella-border)",
                  padding: "0.5rem 0",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {sf.vendorHint} <span className="product-sub">— {sf.sourceFile}</span>
                  </div>
                  <div className="product-sub">{sf.count} rows</div>
                </div>
                {removed ? (
                  <button type="button" className="btn" onClick={() => restore(sf.sourceFile)}>
                    Restore
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => requestRemove(sf.sourceFile)}>
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </details>

    </section>
  );

  return (
    <>
      {open && !embedded ? (
        <div
          className="data-manager-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div
            className="data-manager-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-manager-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {panel}
          </div>
        </div>
      ) : null}
      {open && embedded ? (
        <div className="data-manager-embedded" aria-label="Data manager">
          {panel}
        </div>
      ) : null}
      <ConfirmDialog
        open={!!confirm}
        title="Remove supplier list?"
        danger
        message={
          confirm
            ? `This will hide ${confirm.count} rows from "${confirm.sourceFile}" on this computer only (localStorage). It does not delete the PDF. You can restore it later.`
            : ""
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onCancel={() => setConfirm(null)}
        onConfirm={confirmRemove}
      />
    </>
  );
}

export const DataManagerPanel = memo(DataManagerPanelInner);

