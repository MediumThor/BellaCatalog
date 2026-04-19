import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { createPriceImportDoc } from "../catalogImport/priceImportFirestore";
import { detectFileType, uploadPriceImportFile } from "../catalogImport/priceImportStorage";
import { useCompany } from "../company/useCompany";
import { createCompanyVendor, subscribeCompanyVendors } from "./vendorFirestore";
import type { CompanyVendorDoc } from "./vendorTypes";
import { formatBytes } from "./priceListStatus";

type WizardStep = "vendor" | "file" | "confirm" | "done";

const ACCEPTED_EXT = ".pdf,.xlsx,.xls,.csv";
const ACCEPTED_MIME =
  "application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

export function PriceListNewPage() {
  const { user } = useAuth();
  const { activeCompanyId, permissions } = useCompany();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const preselectedVendorId = searchParams.get("vendorId");

  const [step, setStep] = useState<WizardStep>("vendor");
  const [vendors, setVendors] = useState<CompanyVendorDoc[]>([]);
  const [vendorError, setVendorError] = useState<string | null>(null);

  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(
    preselectedVendorId
  );
  const [newVendorName, setNewVendorName] = useState("");
  const [creatingVendor, setCreatingVendor] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedImportId, setSubmittedImportId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!activeCompanyId) return;
    const unsub = subscribeCompanyVendors(
      activeCompanyId,
      (rows) => setVendors(rows.filter((v) => !v.archived)),
      (e) => setVendorError(e.message)
    );
    return unsub;
  }, [activeCompanyId]);

  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === selectedVendorId) ?? null,
    [vendors, selectedVendorId]
  );

  const handlePickVendor = useCallback((id: string) => {
    setSelectedVendorId(id);
    setNewVendorName("");
  }, []);

  async function handleCreateVendor() {
    if (!activeCompanyId || !user) return;
    const name = newVendorName.trim();
    if (!name) return;
    setCreatingVendor(true);
    setVendorError(null);
    try {
      const id = await createCompanyVendor(activeCompanyId, user.uid, { name });
      setSelectedVendorId(id);
      setNewVendorName("");
    } catch (e) {
      setVendorError(e instanceof Error ? e.message : "Could not add vendor.");
    } finally {
      setCreatingVendor(false);
    }
  }

  async function handleSubmit() {
    if (!activeCompanyId || !user || !file) return;
    if (!selectedVendor) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const uploaded = await uploadPriceImportFile(activeCompanyId, file);
      await createPriceImportDoc({
        companyId: activeCompanyId,
        importId: uploaded.importId,
        uploadedByUserId: user.uid,
        vendorId: selectedVendor.id,
        vendorName: selectedVendor.name,
        originalFileName: file.name,
        fileType: uploaded.fileType,
        storagePath: uploaded.storagePath,
        fileSizeBytes: uploaded.fileSizeBytes,
      });
      setSubmittedImportId(uploaded.importId);
      setStep("done");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!permissions.canManageCatalog) {
    return (
      <div className="settings-page">
        <h1 className="settings-page__title">Upload a price list</h1>
        <p className="settings-page__lede">
          You don't have permission to upload price lists. Ask an owner, admin,
          or catalog manager for access.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <p className="settings-page__eyebrow">
          <Link to="/settings/price-lists">← Back to price lists</Link>
        </p>
        <h1 className="settings-page__title">Upload a price list</h1>
        <p className="settings-page__lede">
          A quick 3-step walkthrough. Your file is stored securely in your
          company workspace and never shared with other BellaCatalog tenants.
        </p>
      </header>

      <WizardProgress step={step} />

      {step === "vendor" ? (
        <VendorStep
          vendors={vendors}
          selectedVendorId={selectedVendorId}
          onSelect={handlePickVendor}
          newVendorName={newVendorName}
          setNewVendorName={setNewVendorName}
          onCreate={handleCreateVendor}
          creating={creatingVendor}
          error={vendorError}
          onNext={() => selectedVendor && setStep("file")}
        />
      ) : null}

      {step === "file" ? (
        <FileStep
          file={file}
          setFile={setFile}
          vendor={selectedVendor}
          effectiveDate={effectiveDate}
          setEffectiveDate={setEffectiveDate}
          notes={notes}
          setNotes={setNotes}
          onBack={() => setStep("vendor")}
          onNext={() => setStep("confirm")}
        />
      ) : null}

      {step === "confirm" ? (
        <ConfirmStep
          vendor={selectedVendor}
          file={file}
          effectiveDate={effectiveDate}
          notes={notes}
          busy={busy}
          error={submitError}
          onBack={() => setStep("file")}
          onSubmit={handleSubmit}
        />
      ) : null}

      {step === "done" ? (
        <DoneStep importId={submittedImportId} onGoToList={() => navigate("/settings/price-lists")} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard progress
// ---------------------------------------------------------------------------

const STEPS: { id: WizardStep; label: string }[] = [
  { id: "vendor", label: "Vendor" },
  { id: "file", label: "File" },
  { id: "confirm", label: "Confirm" },
  { id: "done", label: "Done" },
];

function WizardProgress({ step }: { step: WizardStep }) {
  const activeIndex = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="wizard-progress" aria-label="Upload progress">
      {STEPS.map((s, idx) => (
        <li
          key={s.id}
          className={[
            "wizard-progress__step",
            idx < activeIndex ? "wizard-progress__step--done" : "",
            idx === activeIndex ? "wizard-progress__step--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="wizard-progress__num">{idx + 1}</span>
          <span className="wizard-progress__label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Vendor
// ---------------------------------------------------------------------------

function VendorStep({
  vendors,
  selectedVendorId,
  onSelect,
  newVendorName,
  setNewVendorName,
  onCreate,
  creating,
  error,
  onNext,
}: {
  vendors: CompanyVendorDoc[];
  selectedVendorId: string | null;
  onSelect: (id: string) => void;
  newVendorName: string;
  setNewVendorName: (v: string) => void;
  onCreate: () => void | Promise<void>;
  creating: boolean;
  error: string | null;
  onNext: () => void;
}) {
  const canAdvance = Boolean(selectedVendorId);

  return (
    <section className="settings-card">
      <div className="settings-card__head">
        <h2 className="settings-card__title">Which vendor is this price list from?</h2>
        <p className="settings-card__hint">
          Every price list belongs to a vendor. This is how we keep prices
          organized and how your quotes tell customers where a slab comes from.
        </p>
      </div>

      {error ? (
        <div className="settings-inline-msg settings-inline-msg--bad">{error}</div>
      ) : null}

      {vendors.length > 0 ? (
        <div className="vendor-picker">
          {vendors.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`vendor-picker__item${
                selectedVendorId === v.id ? " vendor-picker__item--active" : ""
              }`}
              onClick={() => onSelect(v.id)}
              aria-pressed={selectedVendorId === v.id}
            >
              <span className="vendor-picker__name">{v.name}</span>
              {v.aliases && v.aliases.length > 0 ? (
                <span className="vendor-picker__aliases">
                  a.k.a. {v.aliases.slice(0, 3).join(", ")}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="settings-card__hint">
          No vendors yet. Add one below and we'll remember it for next time.
        </p>
      )}

      <div className="vendor-quickadd">
        <label className="auth-field">
          <span className="auth-field__label">Add a new vendor</span>
          <div className="vendor-quickadd__row">
            <input
              className="auth-field__input"
              type="text"
              value={newVendorName}
              onChange={(e) => setNewVendorName(e.target.value)}
              placeholder="Cambria, Hallmark, MSI…"
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!newVendorName.trim() || creating}
              onClick={() => void onCreate()}
            >
              {creating ? "Adding…" : "Add vendor"}
            </button>
          </div>
        </label>
      </div>

      <div className="settings-form__actions">
        <Link to="/settings/price-lists" className="btn btn-ghost">
          Cancel
        </Link>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canAdvance}
          onClick={onNext}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — File
// ---------------------------------------------------------------------------

function FileStep({
  file,
  setFile,
  vendor,
  effectiveDate,
  setEffectiveDate,
  notes,
  setNotes,
  onBack,
  onNext,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  vendor: CompanyVendorDoc | null;
  effectiveDate: string;
  setEffectiveDate: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileType = file ? detectFileType(file) : null;
  const unsupported = fileType === "unknown";
  const canAdvance = Boolean(file && !unsupported);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  return (
    <section className="settings-card">
      <div className="settings-card__head">
        <h2 className="settings-card__title">
          Upload the price sheet from{" "}
          <strong>{vendor?.name ?? "your vendor"}</strong>
        </h2>
        <p className="settings-card__hint">
          PDF, XLSX, or CSV. One file per price update. Most vendors send
          PDFs — that's fine, our parser handles them.
        </p>
      </div>

      <div
        className={`file-drop${dragOver ? " file-drop--hover" : ""}${
          file ? " file-drop--has-file" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {file ? (
          <div className="file-drop__selected">
            <div className="file-drop__filename">{file.name}</div>
            <div className="file-drop__meta">
              {(fileType ?? "unknown").toUpperCase()} · {formatBytes(file.size)}
            </div>
            {unsupported ? (
              <div className="settings-inline-msg settings-inline-msg--bad">
                Unsupported file type. Please use PDF, XLSX, XLS, or CSV.
              </div>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFile(null)}
            >
              Choose a different file
            </button>
          </div>
        ) : (
          <label className="file-drop__empty">
            <input
              type="file"
              accept={`${ACCEPTED_EXT},${ACCEPTED_MIME}`}
              className="file-drop__input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span className="file-drop__headline">
              Drop your price sheet here
            </span>
            <span className="file-drop__hint">or click to browse</span>
            <span className="file-drop__formats">Accepts PDF, XLSX, CSV</span>
          </label>
        )}
      </div>

      <div className="settings-form__row">
        <label className="auth-field settings-form__col">
          <span className="auth-field__label">Effective date (optional)</span>
          <input
            className="auth-field__input"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
          <span className="auth-field__hint">
            When these prices start being used. Leave blank for "as soon as
            published."
          </span>
        </label>
      </div>
      <label className="auth-field">
        <span className="auth-field__label">Notes (optional)</span>
        <textarea
          className="auth-field__input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Q2 2026 update, Midwest territory"
        />
      </label>

      <div className="settings-form__actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onNext}
          disabled={!canAdvance}
        >
          Review
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Confirm
// ---------------------------------------------------------------------------

function ConfirmStep({
  vendor,
  file,
  effectiveDate,
  notes,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  vendor: CompanyVendorDoc | null;
  file: File | null;
  effectiveDate: string;
  notes: string;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const fileType = file ? detectFileType(file) : null;
  return (
    <section className="settings-card">
      <div className="settings-card__head">
        <h2 className="settings-card__title">One quick look before we upload</h2>
        <p className="settings-card__hint">
          This file will be saved privately in your company workspace. Nothing
          changes in live quotes until you publish after review.
        </p>
      </div>

      <dl className="confirm-dl">
        <div>
          <dt>Vendor</dt>
          <dd>{vendor?.name ?? "—"}</dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>
            {file ? (
              <>
                {file.name}{" "}
                <span className="settings-chip settings-chip--info">
                  {(fileType ?? "unknown").toUpperCase()}
                </span>{" "}
                <span className="settings-table__hint">
                  {formatBytes(file.size)}
                </span>
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Effective date</dt>
          <dd>{effectiveDate || "As soon as published"}</dd>
        </div>
        <div>
          <dt>Notes</dt>
          <dd>{notes.trim() || "—"}</dd>
        </div>
      </dl>

      {error ? (
        <div className="settings-inline-msg settings-inline-msg--bad" role="alert">
          {error}
        </div>
      ) : null}

      <div className="settings-form__actions">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onSubmit()}
          disabled={busy || !vendor || !file}
        >
          {busy ? "Uploading…" : "Upload price list"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Done
// ---------------------------------------------------------------------------

function DoneStep({
  importId,
  onGoToList,
}: {
  importId: string | null;
  onGoToList: () => void;
}) {
  return (
    <section className="settings-card settings-card--centered">
      <div className="done-check" aria-hidden="true">
        ✓
      </div>
      <h2 className="settings-card__title">Price list received</h2>
      <p className="settings-card__hint settings-card__hint--wide">
        We've uploaded your file and created a tracking record. BellaCatalog
        will parse the rows, match them to known materials, and surface anything
        that needs your review. You can follow along on the details page.
      </p>
      <div className="settings-form__actions settings-form__actions--center">
        <button type="button" className="btn btn-ghost" onClick={onGoToList}>
          Back to price lists
        </button>
        {importId ? (
          <Link
            to={`/settings/price-lists/${importId}`}
            className="btn btn-primary"
          >
            Open details
          </Link>
        ) : null}
      </div>
    </section>
  );
}
