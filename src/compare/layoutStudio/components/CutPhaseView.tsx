import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JobComparisonOptionRecord, JobRecord } from "../../../types/compareQuote";
import {
  uploadCutPhaseDxf,
  uploadCutPhaseExportArtifact,
  verifyDxfChecksum,
  type CutUploadProgress,
} from "../services/cutPhaseStorage";
import {
  createManualScannedSlab,
  externalScannedSlabLibraryStub,
  manualScannedSlabAdapter,
} from "../services/scannedSlabLibrary";
import type { CutPhaseState, CutPlacement, ScannedSlabRef } from "../types";
import {
  bboxHeight,
  bboxWidth,
  dxfUnitToInches,
  parseDxf,
  type DxfBoundingBox,
  type DxfEntity,
  type DxfUnitsLabel,
} from "../utils/dxfParser";
import { CutWorkspace } from "./CutWorkspace";

type Props = {
  job: JobRecord;
  option: JobComparisonOptionRecord;
  companyId: string;
  draft: CutPhaseState;
  onChange: (next: CutPhaseState) => void;
  onSave: (next?: CutPhaseState) => Promise<boolean>;
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** When true, the parent has switched the studio into fullscreen mode. */
  fullscreen?: boolean;
  /** Toggle fullscreen from inside the Cut workspace toolbar. */
  onToggleFullscreen?: () => void;
};

type ParsedDxfState = {
  entities: DxfEntity[];
  bbox: DxfBoundingBox | null;
  unitsLabel: DxfUnitsLabel | null;
};

/**
 * Cut phase orchestrator. Handles the empty-state flows (pick a slab + import
 * a DXF) and renders the two-pane workspace once both inputs are present.
 *
 * Key invariants:
 *   • The uploaded DXF is preserved byte-for-byte (uploaded raw + checksum
 *     verified on export). Position / rotation / mirror live in `placement`.
 *   • Scanned slab metadata is referenced by external id; we never copy slab
 *     scans into the canonical material catalog.
 */
export function CutPhaseView({
  job,
  option,
  companyId,
  draft,
  onChange,
  onSave,
  saveStatus,
  fullscreen = false,
  onToggleFullscreen,
}: Props) {
  const [parsedDxf, setParsedDxf] = useState<ParsedDxfState | null>(null);
  const [dxfFetchError, setDxfFetchError] = useState<string | null>(null);
  const [dxfUploadProgress, setDxfUploadProgress] = useState<CutUploadProgress | null>(null);
  const [slabUploadProgress, setSlabUploadProgress] = useState<CutUploadProgress | null>(null);
  const [busy, setBusy] = useState<null | "dxf" | "slab" | "export">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [slabPickerOpen, setSlabPickerOpen] = useState(false);

  const dxfFileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-parse the DXF whenever the persisted dxf reference changes.
  useEffect(() => {
    if (!draft.dxf) {
      setParsedDxf(null);
      setDxfFetchError(null);
      return;
    }
    let cancelled = false;
    setDxfFetchError(null);
    (async () => {
      try {
        const res = await fetch(draft.dxf!.fileUrl);
        if (!res.ok) throw new Error(`Failed to fetch DXF (${res.status})`);
        const text = await res.text();
        const parsed = parseDxf(text);
        if (cancelled) return;
        setParsedDxf({ entities: parsed.entities, bbox: parsed.bbox, unitsLabel: parsed.unitsLabel });
      } catch (e) {
        if (cancelled) return;
        setDxfFetchError(e instanceof Error ? e.message : "Could not load DXF");
        setParsedDxf(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draft.dxf]);

  const dxfUnitFactor = useMemo(
    () => dxfUnitToInches(parsedDxf?.unitsLabel ?? null),
    [parsedDxf?.unitsLabel],
  );

  /** Default placement = center of slab. */
  const ensureDefaultPlacement = useCallback(
    (next: CutPhaseState): CutPhaseState => {
      if (next.placement || !next.slab) return next;
      return {
        ...next,
        placement: {
          centerX: next.slab.widthIn / 2,
          centerY: next.slab.heightIn / 2,
          rotationDeg: 0,
          mirrored: false,
        },
      };
    },
    [],
  );

  const handleDxfFile = useCallback(
    async (file: File) => {
      if (!option.id) return;
      setActionError(null);
      setBusy("dxf");
      setDxfUploadProgress({ bytesTransferred: 0, totalBytes: file.size, percent: 0 });
      try {
        // Parse upfront so we can reject obviously bad files BEFORE storing them.
        const text = await file.text();
        let parsed: ParsedDxfState;
        try {
          const p = parseDxf(text);
          parsed = { entities: p.entities, bbox: p.bbox, unitsLabel: p.unitsLabel };
        } catch (e) {
          throw new Error(e instanceof Error ? e.message : "Invalid DXF");
        }
        const uploaded = await uploadCutPhaseDxf(
          companyId,
          job.customerId,
          job.id,
          option.id,
          file,
          { onProgress: (p) => setDxfUploadProgress(p) },
        );
        const next: CutPhaseState = {
          ...draft,
          dxf: {
            fileUrl: uploaded.fileUrl,
            fileStoragePath: uploaded.fileStoragePath,
            fileName: uploaded.fileName,
            byteLength: uploaded.byteLength,
            checksum: uploaded.checksum,
            uploadedAt: new Date().toISOString(),
            unitsLabel: parsed.unitsLabel,
            bbox: parsed.bbox,
          },
          // New DXF replaces any previous placement (pieces moved).
          placement: null,
          export: { status: "idle" },
        };
        const withPlacement = ensureDefaultPlacement(next);
        setParsedDxf(parsed);
        onChange(withPlacement);
        await onSave(withPlacement);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Could not import DXF");
      } finally {
        setDxfUploadProgress(null);
        setBusy(null);
      }
    },
    [companyId, draft, ensureDefaultPlacement, job.customerId, job.id, onChange, onSave, option.id],
  );

  const handleSlabUpload = useCallback(
    async (input: { file: File; label: string; widthIn: number; heightIn: number; notes?: string | null }) => {
      if (!option.id) return;
      setActionError(null);
      setBusy("slab");
      setSlabUploadProgress({ bytesTransferred: 0, totalBytes: input.file.size, percent: 0 });
      try {
        const slab = await createManualScannedSlab({
          companyId,
          customerId: job.customerId,
          jobId: job.id,
          optionId: option.id,
          ...input,
          onProgress: (p) => setSlabUploadProgress(p),
        });
        const next: CutPhaseState = ensureDefaultPlacement({
          ...draft,
          slab,
          export: { status: "idle" },
        });
        onChange(next);
        await onSave(next);
        setSlabPickerOpen(false);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Could not upload slab scan");
      } finally {
        setSlabUploadProgress(null);
        setBusy(null);
      }
    },
    [companyId, draft, ensureDefaultPlacement, job.customerId, job.id, onChange, onSave, option.id],
  );

  const handlePlacement = useCallback(
    (placement: CutPlacement) => {
      onChange({ ...draft, placement });
    },
    [draft, onChange],
  );

  const handleSavePlacement = useCallback(async () => {
    await onSave();
  }, [onSave]);

  const handleExport = useCallback(async () => {
    if (!option.id || !draft.dxf || !draft.slab || !draft.placement) return;
    setActionError(null);
    setBusy("export");
    try {
      const ok = await verifyDxfChecksum(draft.dxf.fileUrl, draft.dxf.checksum);
      if (!ok) {
        throw new Error("DXF checksum mismatch — refusing to export. Re-import the DXF and try again.");
      }
      const manifest = buildAlphacamManifest({ option, draft });
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
      const { artifactUrl, artifactStoragePath } = await uploadCutPhaseExportArtifact(
        companyId,
        job.customerId,
        job.id,
        option.id,
        blob,
        `cut-${option.id}`,
      );
      const t = new Date().toISOString();
      const next: CutPhaseState = {
        ...draft,
        export: {
          status: "ready",
          lastExportedAt: t,
          exportArtifactUrl: artifactUrl,
          exportArtifactStoragePath: artifactStoragePath,
          errorMessage: null,
        },
      };
      onChange(next);
      await onSave(next);
      setExportToast("Handoff package ready");
      window.setTimeout(() => setExportToast(null), 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setActionError(msg);
      const next: CutPhaseState = {
        ...draft,
        export: { ...draft.export, status: "error", errorMessage: msg },
      };
      onChange(next);
      await onSave(next);
    } finally {
      setBusy(null);
    }
  }, [companyId, draft, job.customerId, job.id, onChange, onSave, option]);

  const dxfReady = !!draft.dxf && !!parsedDxf;
  const slabReady = !!draft.slab;
  const workspaceReady = dxfReady && slabReady && !!draft.placement;

  const externalLibraryAvailable = externalScannedSlabLibraryStub.available;

  return (
    <div className={`ls-cut-root${fullscreen ? " ls-cut-root--fullscreen" : ""}`}>
      <input
        ref={dxfFileInputRef}
        type="file"
        accept=".dxf,application/dxf,application/octet-stream,text/plain"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleDxfFile(f);
        }}
      />

      <header className="ls-cut-header glass-panel">
        <div>
          <p className="ls-cut-kicker">Cut</p>
          <h2 className="ls-cut-title">Place DXF on real scanned slab</h2>
          <p className="ls-muted">
            Internal handoff — exports an Alphacam-ready package. The uploaded DXF is preserved byte-for-byte
            and re-verified on export.
          </p>
        </div>
        <div className="ls-cut-header-actions">
          <button
            type="button"
            className="ls-btn ls-btn-secondary"
            disabled={!!busy}
            onClick={() => setSlabPickerOpen(true)}
          >
            {slabReady ? "Change slab" : "Pick scanned slab"}
          </button>
          <button
            type="button"
            className="ls-btn ls-btn-secondary"
            disabled={!!busy}
            onClick={() => dxfFileInputRef.current?.click()}
          >
            {dxfReady ? "Replace DXF" : "Import DXF"}
          </button>
          <button
            type="button"
            className="ls-btn ls-btn-primary"
            disabled={!workspaceReady || saveStatus === "saving" || !!busy}
            onClick={() => void handleExport()}
          >
            {busy === "export" ? "Exporting…" : "Export for Alphacam"}
          </button>
          {onToggleFullscreen ? (
            <button
              type="button"
              className="ls-btn ls-btn-secondary ls-cut-fullscreen-btn"
              onClick={onToggleFullscreen}
              title={fullscreen ? "Exit full screen" : "Expand Cut workspace"}
              aria-label={fullscreen ? "Exit full screen" : "Expand Cut workspace"}
              aria-pressed={fullscreen}
            >
              {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <p className="ls-warning" role="alert">
          {actionError}
        </p>
      ) : null}
      {dxfFetchError ? (
        <p className="ls-warning" role="alert">
          {dxfFetchError}
        </p>
      ) : null}
      {exportToast ? <p className="ls-cut-success">{exportToast}</p> : null}

      {workspaceReady && parsedDxf && draft.dxf && draft.slab && draft.placement ? (
        <CutWorkspace
          slab={draft.slab}
          dxf={{
            fileName: draft.dxf.fileName,
            entities: parsedDxf.entities,
            bbox: parsedDxf.bbox,
            unitsLabel: parsedDxf.unitsLabel,
          }}
          placement={draft.placement}
          onPlacementChange={handlePlacement}
        />
      ) : (
        <div className="ls-cut-empty glass-panel">
          <CutEmptyState
            slab={draft.slab}
            dxf={draft.dxf}
            externalLibraryAvailable={externalLibraryAvailable}
            externalLibraryName={externalScannedSlabLibraryStub.sourceProject}
            manualLibraryName={manualScannedSlabAdapter.sourceProject}
            onPickSlab={() => setSlabPickerOpen(true)}
            onImportDxf={() => dxfFileInputRef.current?.click()}
            dxfUploadProgress={dxfUploadProgress}
          />
        </div>
      )}

      {workspaceReady && draft.dxf && draft.placement ? (
        <CutFooterMeta
          dxfBbox={parsedDxf?.bbox ?? null}
          dxfUnitFactor={dxfUnitFactor}
          slab={draft.slab}
          dxfChecksum={draft.dxf.checksum}
          dxfByteLength={draft.dxf.byteLength}
          exportUrl={draft.export.exportArtifactUrl ?? null}
          lastExportedAt={draft.export.lastExportedAt ?? null}
          onSave={() => void handleSavePlacement()}
          saveStatus={saveStatus}
        />
      ) : null}

      {slabPickerOpen ? (
        <SlabPickerModal
          onClose={() => setSlabPickerOpen(false)}
          onUpload={handleSlabUpload}
          uploadProgress={slabUploadProgress}
          externalLibraryAvailable={externalLibraryAvailable}
        />
      ) : null}
    </div>
  );
}

function CutEmptyState({
  slab,
  dxf,
  externalLibraryAvailable,
  externalLibraryName,
  manualLibraryName,
  onPickSlab,
  onImportDxf,
  dxfUploadProgress,
}: {
  slab: ScannedSlabRef | null;
  dxf: CutPhaseState["dxf"];
  externalLibraryAvailable: boolean;
  externalLibraryName: string;
  manualLibraryName: string;
  onPickSlab: () => void;
  onImportDxf: () => void;
  dxfUploadProgress: CutUploadProgress | null;
}) {
  return (
    <div className="ls-cut-empty-grid">
      <div className={`ls-cut-step${slab ? " is-done" : ""}`}>
        <p className="ls-cut-step-num">1</p>
        <h3>Pick a scanned slab</h3>
        <p className="ls-muted">
          Select a real slab from physical inventory. Source today: <code>{manualLibraryName}</code> (manual upload).
          External library <code>{externalLibraryName}</code> is{" "}
          {externalLibraryAvailable ? "connected" : "not connected yet"}.
        </p>
        <button type="button" className="ls-btn ls-btn-primary" onClick={onPickSlab}>
          {slab ? `Change slab (${slab.label})` : "Pick scanned slab"}
        </button>
      </div>
      <div className={`ls-cut-step${dxf ? " is-done" : ""}`}>
        <p className="ls-cut-step-num">2</p>
        <h3>Import DXF</h3>
        <p className="ls-muted">
          Bring in the DXF exported from your CAD workflow. The file is stored unchanged and re-verified on export.
        </p>
        <button type="button" className="ls-btn ls-btn-primary" onClick={onImportDxf}>
          {dxf ? `Replace DXF (${dxf.fileName})` : "Import DXF"}
        </button>
        {dxfUploadProgress ? (
          <p className="ls-muted">Uploading… {Math.round(dxfUploadProgress.percent)}%</p>
        ) : null}
      </div>
    </div>
  );
}

function CutFooterMeta({
  dxfBbox,
  dxfUnitFactor,
  slab,
  dxfChecksum,
  dxfByteLength,
  exportUrl,
  lastExportedAt,
  onSave,
  saveStatus,
}: {
  dxfBbox: DxfBoundingBox | null;
  dxfUnitFactor: number;
  slab: ScannedSlabRef | null;
  dxfChecksum: string;
  dxfByteLength: number;
  exportUrl: string | null;
  lastExportedAt: string | null;
  onSave: () => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
}) {
  return (
    <footer className="ls-cut-footer glass-panel">
      <div className="ls-cut-footer-meta">
        {dxfBbox ? (
          <span>
            DXF footprint: {(bboxWidth(dxfBbox) * dxfUnitFactor).toFixed(2)} ×{" "}
            {(bboxHeight(dxfBbox) * dxfUnitFactor).toFixed(2)} in
          </span>
        ) : null}
        {slab ? (
          <span>
            Slab: {slab.widthIn.toFixed(1)} × {slab.heightIn.toFixed(1)} in •{" "}
            <code title="External id">{slab.sourceProject}:{slab.externalId}</code>
          </span>
        ) : null}
        <span title="DXF byte fidelity">
          {(dxfByteLength / 1024).toFixed(1)} KB • SHA-256 <code>{dxfChecksum.slice(0, 12)}…</code>
        </span>
      </div>
      <div className="ls-cut-footer-actions">
        <span className={`ls-save-pill ls-save-pill--${saveStatus}`}>
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "error" && "Save failed"}
          {saveStatus === "idle" && " "}
        </span>
        <button type="button" className="ls-btn ls-btn-secondary" onClick={onSave}>
          Save placement
        </button>
        {exportUrl ? (
          <a
            className="ls-btn ls-btn-secondary"
            href={exportUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={lastExportedAt ?? undefined}
          >
            Download last export
          </a>
        ) : null}
      </div>
    </footer>
  );
}

/* ----------------------------------------------------------------------------
 * Manual slab upload modal (V1 — until external library is wired up).
 * ------------------------------------------------------------------------- */
function SlabPickerModal({
  onClose,
  onUpload,
  uploadProgress,
  externalLibraryAvailable,
}: {
  onClose: () => void;
  onUpload: (input: { file: File; label: string; widthIn: number; heightIn: number; notes?: string | null }) => void;
  uploadProgress: CutUploadProgress | null;
  externalLibraryAvailable: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [widthIn, setWidthIn] = useState("130");
  const [heightIn, setHeightIn] = useState("65");
  const [notes, setNotes] = useState("");
  const canSubmit = !!file && Number(widthIn) > 0 && Number(heightIn) > 0 && !uploadProgress;

  return (
    <div className="ls-modal-backdrop" role="dialog" aria-modal="true" aria-label="Pick scanned slab">
      <div className="ls-modal ls-cut-slab-modal glass-panel">
        <header className="ls-modal-header">
          <div>
            <p className="ls-cut-kicker">Cut · slab source</p>
            <h3>Pick a scanned slab</h3>
          </div>
          <button type="button" className="ls-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="ls-modal-body">
          {!externalLibraryAvailable ? (
            <p className="ls-muted ls-cut-external-note">
              External scanned-slab library is not connected yet. Upload a slab scan manually for now —
              the same picker will list real inventory once the external project is wired in.
            </p>
          ) : null}
          <label className="ls-field">
            <span>Slab scan image</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="ls-field">
            <span>Label (material + slab tag)</span>
            <input
              type="text"
              className="ls-input"
              placeholder="e.g. Calacatta Gold #A-2231"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <div className="ls-cut-dims-row">
            <label className="ls-field">
              <span>Width (in)</span>
              <input
                type="number"
                className="ls-input"
                min={1}
                step={0.25}
                value={widthIn}
                onChange={(e) => setWidthIn(e.target.value)}
              />
            </label>
            <label className="ls-field">
              <span>Height (in)</span>
              <input
                type="number"
                className="ls-input"
                min={1}
                step={0.25}
                value={heightIn}
                onChange={(e) => setHeightIn(e.target.value)}
              />
            </label>
          </div>
          <label className="ls-field">
            <span>Notes (optional)</span>
            <textarea
              className="ls-input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Defects, vein direction, anything the shop needs to know."
            />
          </label>
          {uploadProgress ? (
            <p className="ls-muted">Uploading slab scan… {Math.round(uploadProgress.percent)}%</p>
          ) : null}
        </div>
        <footer className="ls-modal-footer">
          <button type="button" className="ls-btn ls-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ls-btn ls-btn-primary"
            disabled={!canSubmit}
            onClick={() =>
              file &&
              onUpload({
                file,
                label,
                widthIn: Number(widthIn),
                heightIn: Number(heightIn),
                notes: notes.trim() || null,
              })
            }
          >
            Use this slab
          </button>
        </footer>
      </div>
    </div>
  );
}

function buildAlphacamManifest({
  option,
  draft,
}: {
  option: JobComparisonOptionRecord;
  draft: CutPhaseState;
}): Record<string, unknown> {
  return {
    schema: "bellacatalog.cut.alphacam-handoff/v1",
    generatedAt: new Date().toISOString(),
    option: {
      id: option.id,
      productName: option.productName,
      material: option.material,
      thickness: option.thickness,
    },
    dxf: {
      fileUrl: draft.dxf?.fileUrl ?? null,
      fileName: draft.dxf?.fileName ?? null,
      byteLength: draft.dxf?.byteLength ?? null,
      checksumSha256: draft.dxf?.checksum ?? null,
      unitsLabel: draft.dxf?.unitsLabel ?? null,
    },
    slab: draft.slab
      ? {
          externalId: draft.slab.externalId,
          sourceProject: draft.slab.sourceProject,
          label: draft.slab.label,
          widthIn: draft.slab.widthIn,
          heightIn: draft.slab.heightIn,
          imageUrl: draft.slab.imageUrl,
        }
      : null,
    placement: draft.placement,
    note:
      "Original DXF bytes are preserved. Apply `placement` (in slab inches, origin = top-left) to the unmodified DXF when generating toolpaths.",
  };
}

// Keep imports referenced even when modal is closed — silences unused warnings.
export type { ParsedDxfState };
