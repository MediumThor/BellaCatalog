import { useEffect, useMemo, useState } from "react";
import type {
  BuiltinSinkKind,
  BuiltinSinkOverride,
  CustomSinkTemplate,
} from "../../../company/types";
import type {
  FaucetEvenHoleBias,
  FaucetSpreadIn,
  PieceSinkCustomTemplateSnapshot,
  PieceSinkTemplateKind,
} from "../types";
import { sinkTemplateDims } from "../utils/pieceSinks";
import { AddSinkPreviewSvg } from "./AddSinkPreviewSvg";

/**
 * `confirmAddSink` payload. `customTemplate` is set when:
 *   • a company-defined `"custom"` template is selected, or
 *   • a built-in template is selected and the company has overridden its
 *     dims/price (the snapshot freezes the override on the placed cutout).
 * In both cases the snapshot drives geometry and pricing for that placement
 * and stays intact even if the company library later changes.
 */
export type AddSinkModalConfirmInput = {
  name: string;
  templateKind: PieceSinkTemplateKind | "custom";
  customTemplate?: PieceSinkCustomTemplateSnapshot;
  faucetHoleCount: number;
  spreadIn: FaucetSpreadIn;
  evenHoleBias: FaucetEvenHoleBias;
};

/** Editable subset of a company sink template (everything except identity / audit fields). */
export type CustomSinkTemplateInput = Omit<
  CustomSinkTemplate,
  "id" | "createdAt" | "createdByUserId"
>;

/** Editable subset of a built-in sink override (audit fields are server-set). */
export type BuiltinSinkOverrideInput = Omit<
  BuiltinSinkOverride,
  "updatedAt" | "updatedByUserId"
>;

type Props = {
  open: boolean;
  /** Rotation matching the selected piece edge (blank plan). */
  previewRotationDeg?: number;
  /** Company-defined sink templates appended to the dropdown / shown in the left list. */
  customTemplates?: readonly CustomSinkTemplate[] | null;
  /** Per-company overrides of the three built-in sink templates. */
  builtinOverrides?: Partial<Record<BuiltinSinkKind, BuiltinSinkOverride>> | null;
  /** Whether the active member can save / edit / delete templates in the company library. */
  canManageCustomTemplates?: boolean;
  /**
   * Persists a brand-new custom template to the company library and resolves
   * with the saved record (so the modal can auto-select it). May throw to
   * surface validation/permission errors as a banner.
   */
  onCreateCustomTemplate?: (input: CustomSinkTemplateInput) => Promise<CustomSinkTemplate>;
  /** Persists edits to an existing template (returns the updated record). */
  onUpdateCustomTemplate?: (
    id: string,
    patch: CustomSinkTemplateInput,
  ) => Promise<CustomSinkTemplate>;
  /** Removes a template from the company library. Already-placed sinks keep their snapshot. */
  onDeleteCustomTemplate?: (id: string) => Promise<void>;
  /** Saves / updates the per-company override for a built-in sink template. */
  onUpsertBuiltinOverride?: (
    kind: BuiltinSinkKind,
    patch: BuiltinSinkOverrideInput,
  ) => Promise<BuiltinSinkOverride>;
  /** Removes the per-company override for a built-in sink (restores defaults). */
  onResetBuiltinOverride?: (kind: BuiltinSinkKind) => Promise<void>;
  onClose: () => void;
  onConfirm: (input: AddSinkModalConfirmInput) => void;
};

const SPREADS: FaucetSpreadIn[] = [2, 4, 8, 10, 12];
const FAUCET_HOLE_OPTIONS = [1, 2, 3, 4, 5] as const;

/** Order matches what the user expects to see in the sidebar / dropdown. */
const BUILTIN_KINDS: readonly BuiltinSinkKind[] = ["kitchen", "vanitySquare", "vanityRound"];

/**
 * Display name for a built-in template (kept in sync with the dropdown
 * labels — these are the names users have always seen).
 */
function builtinDisplayName(kind: BuiltinSinkKind): string {
  switch (kind) {
    case "kitchen":
      return "Kitchen";
    case "vanitySquare":
      return "Vanity square";
    case "vanityRound":
      return "Vanity round";
  }
}

/**
 * Selected option in the dropdown. Built-ins are identified by their
 * `PieceSinkTemplateKind`; company customs by `custom:<id>`.
 */
type DropdownValue = PieceSinkTemplateKind | `custom:${string}`;

/**
 * Modal mode: pick + place a sink, create a new custom template, edit
 * an existing custom template, or edit one of the three built-ins.
 */
type Mode =
  | { kind: "place" }
  | { kind: "create" }
  | { kind: "edit-custom"; templateId: string }
  | { kind: "edit-builtin"; builtinKind: BuiltinSinkKind };

/**
 * Unified row for the sidebar list and the dropdown — either one of the
 * three built-ins (with override applied if any) or a company custom
 * template. `priceUsd === null` means "use the company-wide
 * `Cutout each` rate" (only possible for un-overridden built-ins).
 */
type SinkRow =
  | {
      source: "builtin";
      kind: BuiltinSinkKind;
      name: string;
      shape: "rectangle" | "oval";
      widthIn: number;
      depthIn: number;
      cornerRadiusIn: number;
      priceUsd: number | null;
      hasOverride: boolean;
      dropdownValue: DropdownValue;
    }
  | {
      source: "custom";
      template: CustomSinkTemplate;
      shape: "rectangle" | "oval";
      widthIn: number;
      depthIn: number;
      cornerRadiusIn: number;
      priceUsd: number;
      dropdownValue: DropdownValue;
    };

export function AddSinkModal({
  open,
  previewRotationDeg = 0,
  customTemplates,
  builtinOverrides,
  canManageCustomTemplates = true,
  onCreateCustomTemplate,
  onUpdateCustomTemplate,
  onDeleteCustomTemplate,
  onUpsertBuiltinOverride,
  onResetBuiltinOverride,
  onClose,
  onConfirm,
}: Props) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<DropdownValue>("kitchen");
  const [faucetHoleCount, setFaucetHoleCount] = useState(1);
  const [spreadIn, setSpreadIn] = useState<FaucetSpreadIn>(4);
  const [evenHoleBias, setEvenHoleBias] = useState<FaucetEvenHoleBias>("right");

  const [mode, setMode] = useState<Mode>({ kind: "place" });

  const [formName, setFormName] = useState("");
  const [formShape, setFormShape] = useState<"rectangle" | "oval">("rectangle");
  const [formWidth, setFormWidth] = useState("30");
  const [formDepth, setFormDepth] = useState("16");
  const [formCornerRadius, setFormCornerRadius] = useState("0.7");
  const [formPrice, setFormPrice] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingResetKind, setPendingResetKind] = useState<BuiltinSinkKind | null>(null);
  const [resettingKind, setResettingKind] = useState<BuiltinSinkKind | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setSelected("kitchen");
      setFaucetHoleCount(1);
      setSpreadIn(4);
      setEvenHoleBias("right");
      setMode({ kind: "place" });
      resetFormFields();
      setPendingDeleteId(null);
      setDeletingId(null);
      setPendingResetKind(null);
      setResettingKind(null);
    }
  }, [open]);

  /**
   * Combined sidebar / dropdown rows: the three built-ins (overridden
   * dims/price applied when present) followed by all company custom
   * templates. Single source of truth for both the left list and the
   * "Sink type" dropdown so they can never drift apart.
   */
  const rows = useMemo<SinkRow[]>(() => {
    const list: SinkRow[] = [];
    for (const kind of BUILTIN_KINDS) {
      const defaults = sinkTemplateDims(kind);
      const ov = builtinOverrides?.[kind] ?? null;
      list.push({
        source: "builtin",
        kind,
        name: builtinDisplayName(kind),
        shape: defaults.shape,
        widthIn: ov ? ov.widthIn : defaults.widthIn,
        depthIn: ov ? ov.depthIn : defaults.depthIn,
        cornerRadiusIn:
          defaults.shape === "oval"
            ? 0
            : ov
              ? ov.cornerRadiusIn
              : defaults.cornerRadiusIn,
        priceUsd: ov ? ov.priceUsd : null,
        hasOverride: Boolean(ov),
        dropdownValue: kind,
      });
    }
    for (const t of customTemplates ?? []) {
      list.push({
        source: "custom",
        template: t,
        shape: t.shape,
        widthIn: t.widthIn,
        depthIn: t.depthIn,
        cornerRadiusIn: t.shape === "oval" ? 0 : t.cornerRadiusIn,
        priceUsd: t.priceUsd,
        dropdownValue: `custom:${t.id}`,
      });
    }
    return list;
  }, [builtinOverrides, customTemplates]);

  const customRows = useMemo(
    () => rows.filter((r): r is Extract<SinkRow, { source: "custom" }> => r.source === "custom"),
    [rows],
  );
  const builtinRows = useMemo(
    () => rows.filter((r): r is Extract<SinkRow, { source: "builtin" }> => r.source === "builtin"),
    [rows],
  );

  const selectedRow: SinkRow | null = useMemo(() => {
    return rows.find((r) => r.dropdownValue === selected) ?? null;
  }, [rows, selected]);

  /**
   * If a previously-selected custom template was deleted from the company
   * library while this modal was open, reset the dropdown back to "kitchen"
   * so the preview / placement does not reference a stale id.
   */
  useEffect(() => {
    if (selected.startsWith("custom:") && !selectedRow) {
      setSelected("kitchen");
    }
  }, [selected, selectedRow]);

  /** Cancel any pending delete/reset confirmation when the underlying entity disappears. */
  useEffect(() => {
    if (pendingDeleteId && !customRows.some((r) => r.template.id === pendingDeleteId)) {
      setPendingDeleteId(null);
    }
  }, [pendingDeleteId, customRows]);
  useEffect(() => {
    if (pendingResetKind && !builtinRows.find((r) => r.kind === pendingResetKind)?.hasOverride) {
      setPendingResetKind(null);
    }
  }, [pendingResetKind, builtinRows]);

  if (!open) return null;

  const n = Math.max(1, Math.min(5, Math.floor(faucetHoleCount) || 1));
  const showSpread = n > 1;
  const showEvenBias = n === 2 || n === 4;

  const previewSnapshot: PieceSinkCustomTemplateSnapshot | null = selectedRow
    ? rowToSnapshot(selectedRow)
    : null;
  const previewKind: PieceSinkTemplateKind | "custom" =
    selectedRow?.source === "custom"
      ? "custom"
      : (selected as PieceSinkTemplateKind);
  /**
   * Built-ins WITHOUT an override don't need a snapshot — `AddSinkPreviewSvg`
   * will fall back to the catalog defaults via `sinkTemplateDims`. Built-ins
   * WITH an override snapshot the override so the preview reflects it.
   */
  const previewSnapshotForSvg: PieceSinkCustomTemplateSnapshot | null =
    selectedRow?.source === "custom"
      ? previewSnapshot
      : selectedRow?.source === "builtin" && selectedRow.hasOverride
        ? previewSnapshot
        : null;

  function resetFormFields() {
    setFormName("");
    setFormShape("rectangle");
    setFormWidth("30");
    setFormDepth("16");
    setFormCornerRadius("0.7");
    setFormPrice("");
    setFormSaving(false);
    setFormError(null);
  }

  function loadFormFromCustom(t: CustomSinkTemplate) {
    setFormName(t.name);
    setFormShape(t.shape);
    setFormWidth(String(t.widthIn));
    setFormDepth(String(t.depthIn));
    setFormCornerRadius(String(t.cornerRadiusIn ?? 0));
    setFormPrice(String(t.priceUsd ?? 0));
    setFormSaving(false);
    setFormError(null);
  }

  function loadFormFromBuiltin(row: Extract<SinkRow, { source: "builtin" }>) {
    setFormName(row.name);
    setFormShape(row.shape);
    setFormWidth(String(row.widthIn));
    setFormDepth(String(row.depthIn));
    setFormCornerRadius(String(row.cornerRadiusIn ?? 0));
    setFormPrice(row.priceUsd != null ? String(row.priceUsd) : "");
    setFormSaving(false);
    setFormError(null);
  }

  const startCreate = () => {
    resetFormFields();
    setMode({ kind: "create" });
  };

  const startEditCustom = (t: CustomSinkTemplate) => {
    loadFormFromCustom(t);
    setMode({ kind: "edit-custom", templateId: t.id });
  };

  const startEditBuiltin = (row: Extract<SinkRow, { source: "builtin" }>) => {
    loadFormFromBuiltin(row);
    setMode({ kind: "edit-builtin", builtinKind: row.kind });
  };

  const cancelForm = () => {
    setMode({ kind: "place" });
    resetFormFields();
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!selectedRow) return;
    if (selectedRow.source === "custom") {
      onConfirm({
        name: trimmed,
        templateKind: "custom",
        customTemplate: rowToSnapshot(selectedRow),
        faucetHoleCount: n,
        spreadIn,
        evenHoleBias,
      });
    } else {
      /**
       * Built-in placements only carry a snapshot when the company has
       * overridden defaults — that locks the override onto the placed
       * cutout for both rendering and pricing. Without an override the
       * built-in resolves via `sinkTemplateDims` and bills at the
       * company-wide `Cutout each` rate.
       */
      onConfirm({
        name: trimmed,
        templateKind: selectedRow.kind,
        customTemplate: selectedRow.hasOverride
          ? rowToSnapshot(selectedRow)
          : undefined,
        faucetHoleCount: n,
        spreadIn,
        evenHoleBias,
      });
    }
    onClose();
  };

  const handleSaveTemplate = async () => {
    setFormError(null);
    const widthIn = parsePositive(formWidth);
    const depthIn = parsePositive(formDepth);
    const cornerRadiusIn =
      formShape === "oval" ? 0 : parseNonNeg(formCornerRadius);
    const priceUsd = parseNonNeg(formPrice);
    if (widthIn == null) {
      setFormError("Width must be a positive number.");
      return;
    }
    if (depthIn == null) {
      setFormError("Depth must be a positive number.");
      return;
    }
    if (formShape === "rectangle" && cornerRadiusIn == null) {
      setFormError("Corner radius can be 0 but must be a number.");
      return;
    }
    if (priceUsd == null) {
      setFormError("Price must be a number (use 0 for free).");
      return;
    }
    setFormSaving(true);
    try {
      if (mode.kind === "create" || mode.kind === "edit-custom") {
        const trimmedName = formName.trim();
        if (!trimmedName) {
          setFormError("Give the sink a name.");
          setFormSaving(false);
          return;
        }
        const payload: CustomSinkTemplateInput = {
          name: trimmedName,
          shape: formShape,
          widthIn,
          depthIn,
          cornerRadiusIn: cornerRadiusIn ?? 0,
          priceUsd,
        };
        if (mode.kind === "create") {
          if (!onCreateCustomTemplate) throw new Error("Saving company sinks is not configured.");
          const saved = await onCreateCustomTemplate(payload);
          setSelected(`custom:${saved.id}`);
          if (!name.trim()) setName(trimmedName);
        } else {
          if (!onUpdateCustomTemplate) throw new Error("Editing company sinks is not configured.");
          const saved = await onUpdateCustomTemplate(mode.templateId, payload);
          setSelected(`custom:${saved.id}`);
        }
      } else if (mode.kind === "edit-builtin") {
        if (!onUpsertBuiltinOverride) throw new Error("Editing built-in sinks is not configured.");
        const payload: BuiltinSinkOverrideInput = {
          widthIn,
          depthIn,
          cornerRadiusIn:
            mode.builtinKind === "vanityRound" ? 0 : cornerRadiusIn ?? 0,
          priceUsd,
        };
        await onUpsertBuiltinOverride(mode.builtinKind, payload);
        setSelected(mode.builtinKind);
      }
      setMode({ kind: "place" });
      resetFormFields();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not save the sink template.",
      );
    } finally {
      setFormSaving(false);
    }
  };

  const requestDelete = (id: string) => setPendingDeleteId(id);

  const confirmDelete = async (id: string) => {
    if (!onDeleteCustomTemplate) return;
    setDeletingId(id);
    try {
      await onDeleteCustomTemplate(id);
      setPendingDeleteId(null);
      if (selected === `custom:${id}`) setSelected("kitchen");
      if (mode.kind === "edit-custom" && mode.templateId === id) {
        setMode({ kind: "place" });
        resetFormFields();
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not delete that sink template.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const requestReset = (kind: BuiltinSinkKind) => setPendingResetKind(kind);

  const confirmReset = async (kind: BuiltinSinkKind) => {
    if (!onResetBuiltinOverride) return;
    setResettingKind(kind);
    try {
      await onResetBuiltinOverride(kind);
      setPendingResetKind(null);
      if (mode.kind === "edit-builtin" && mode.builtinKind === kind) {
        setMode({ kind: "place" });
        resetFormFields();
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not restore the built-in sink defaults.",
      );
    } finally {
      setResettingKind(null);
    }
  };

  const formActive = mode.kind !== "place";

  const canManageBuiltins =
    canManageCustomTemplates && Boolean(onUpsertBuiltinOverride);
  const canResetBuiltins =
    canManageCustomTemplates && Boolean(onResetBuiltinOverride);

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
        <div className="ls-add-sink-modal-header">
          <h2 id="ls-add-sink-title" className="ls-sheet-title">
            Add sink cutout
          </h2>
          {canManageCustomTemplates && onCreateCustomTemplate ? (
            <button
              type="button"
              className="ls-add-sink-create-btn"
              onClick={mode.kind === "create" ? cancelForm : startCreate}
              aria-pressed={mode.kind === "create"}
              aria-label={
                mode.kind === "create"
                  ? "Cancel new company sink template"
                  : "Create new company sink template"
              }
              title={
                mode.kind === "create"
                  ? "Cancel new company sink template"
                  : "Create a custom sink template under your company"
              }
            >
              {mode.kind === "create" ? "×" : "+"}
            </button>
          ) : null}
        </div>
        <p className="ls-muted">
          Shapes are for quoting only and do not reduce square footage.
        </p>
        <div className="ls-add-sink-modal-grid">
          <SinkTemplatesSidebar
            builtinRows={builtinRows}
            customRows={customRows}
            canManageBuiltins={canManageBuiltins}
            canResetBuiltins={canResetBuiltins}
            canManageCustom={canManageCustomTemplates && Boolean(onUpdateCustomTemplate)}
            canDeleteCustom={canManageCustomTemplates && Boolean(onDeleteCustomTemplate)}
            activeDropdownValue={
              mode.kind === "edit-custom"
                ? `custom:${mode.templateId}`
                : mode.kind === "edit-builtin"
                  ? mode.builtinKind
                  : selected
            }
            pendingDeleteId={pendingDeleteId}
            deletingId={deletingId}
            pendingResetKind={pendingResetKind}
            resettingKind={resettingKind}
            onSelect={(value) => {
              setSelected(value);
              if (mode.kind !== "place") {
                setMode({ kind: "place" });
                resetFormFields();
              }
            }}
            onEditCustom={startEditCustom}
            onEditBuiltin={startEditBuiltin}
            onRequestDelete={requestDelete}
            onConfirmDelete={confirmDelete}
            onCancelDelete={() => setPendingDeleteId(null)}
            onRequestReset={requestReset}
            onConfirmReset={confirmReset}
            onCancelReset={() => setPendingResetKind(null)}
            onCreate={onCreateCustomTemplate ? startCreate : undefined}
          />
          <div className="ls-add-sink-modal-main">
            {formActive ? (
              <SinkTemplateForm
                mode={mode}
                name={formName}
                shape={formShape}
                widthIn={formWidth}
                depthIn={formDepth}
                cornerRadiusIn={formCornerRadius}
                priceUsd={formPrice}
                saving={formSaving}
                error={formError}
                onCancel={cancelForm}
                onSave={handleSaveTemplate}
                onChangeName={setFormName}
                onChangeShape={setFormShape}
                onChangeWidth={setFormWidth}
                onChangeDepth={setFormDepth}
                onChangeCornerRadius={setFormCornerRadius}
                onChangePrice={setFormPrice}
              />
            ) : (
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
                      value={selected}
                      onChange={(e) => setSelected(e.target.value as DropdownValue)}
                    >
                      <optgroup label="Built-in">
                        {builtinRows.map((row) => (
                          <option key={row.kind} value={row.kind}>
                            {builtinOptionLabel(row)}
                          </option>
                        ))}
                      </optgroup>
                      {customRows.length > 0 ? (
                        <optgroup label="Company sinks">
                          {customRows.map((row) => (
                            <option key={row.template.id} value={row.dropdownValue}>
                              {customOptionLabel(row.template)}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                    {selectedRow ? (
                      <SelectedPriceHint row={selectedRow} />
                    ) : null}
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
                  templateKind={previewKind}
                  customTemplate={previewSnapshotForSvg}
                  faucetHoleCount={n}
                  spreadIn={spreadIn}
                  evenHoleBias={evenHoleBias}
                  previewRotationDeg={previewRotationDeg}
                />
              </div>
            )}
          </div>
        </div>
        {formActive ? null : (
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
        )}
      </div>
    </div>
  );
}

function SelectedPriceHint({ row }: { row: SinkRow }) {
  if (row.source === "custom") {
    return (
      <span className="ls-muted ls-add-sink-custom-price">
        Cutout price: {formatUsd(row.priceUsd)} (overrides company "Cutout each")
      </span>
    );
  }
  if (row.priceUsd == null) {
    return (
      <span className="ls-muted ls-add-sink-custom-price">
        Cutout price: company "Cutout each" rate
      </span>
    );
  }
  return (
    <span className="ls-muted ls-add-sink-custom-price">
      Cutout price: {formatUsd(row.priceUsd)} (company override on built-in)
    </span>
  );
}

function SinkTemplatesSidebar({
  builtinRows,
  customRows,
  canManageBuiltins,
  canResetBuiltins,
  canManageCustom,
  canDeleteCustom,
  activeDropdownValue,
  pendingDeleteId,
  deletingId,
  pendingResetKind,
  resettingKind,
  onSelect,
  onEditCustom,
  onEditBuiltin,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onRequestReset,
  onConfirmReset,
  onCancelReset,
  onCreate,
}: {
  builtinRows: Extract<SinkRow, { source: "builtin" }>[];
  customRows: Extract<SinkRow, { source: "custom" }>[];
  canManageBuiltins: boolean;
  canResetBuiltins: boolean;
  canManageCustom: boolean;
  canDeleteCustom: boolean;
  activeDropdownValue: DropdownValue;
  pendingDeleteId: string | null;
  deletingId: string | null;
  pendingResetKind: BuiltinSinkKind | null;
  resettingKind: BuiltinSinkKind | null;
  onSelect: (value: DropdownValue) => void;
  onEditCustom: (template: CustomSinkTemplate) => void;
  onEditBuiltin: (row: Extract<SinkRow, { source: "builtin" }>) => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  onRequestReset: (kind: BuiltinSinkKind) => void;
  onConfirmReset: (kind: BuiltinSinkKind) => void;
  onCancelReset: () => void;
  onCreate?: () => void;
}) {
  return (
    <aside className="ls-add-sink-templates" aria-label="Sink templates">
      <section className="ls-add-sink-templates-section">
        <header className="ls-add-sink-templates-header">
          <span className="ls-add-sink-templates-title">Built-in</span>
          <span className="ls-add-sink-templates-count">{builtinRows.length}</span>
        </header>
        <ul className="ls-add-sink-templates-list">
          {builtinRows.map((row) => {
            const isActive = activeDropdownValue === row.dropdownValue;
            const isPendingReset = pendingResetKind === row.kind;
            const isResetting = resettingKind === row.kind;
            return (
              <li
                key={row.kind}
                className={`ls-add-sink-templates-item${isActive ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="ls-add-sink-templates-row"
                  onClick={() => onSelect(row.dropdownValue)}
                  aria-pressed={isActive}
                >
                  <span className="ls-add-sink-templates-row-name">
                    {row.name}
                    {row.hasOverride ? (
                      <span className="ls-add-sink-templates-badge" title="Company override applied">
                        edited
                      </span>
                    ) : null}
                  </span>
                  <span className="ls-add-sink-templates-row-meta">
                    {dimsMetaLabel(row)}
                  </span>
                  <span className="ls-add-sink-templates-row-price">
                    {row.priceUsd == null ? "Default rate" : `${formatUsd(row.priceUsd)} / cut`}
                  </span>
                </button>
                {canManageBuiltins || canResetBuiltins ? (
                  <div className="ls-add-sink-templates-row-actions">
                    {canManageBuiltins ? (
                      <button
                        type="button"
                        className="ls-add-sink-templates-action"
                        onClick={() => onEditBuiltin(row)}
                        title="Edit dimensions and per-cut price for this company"
                      >
                        Edit
                      </button>
                    ) : null}
                    {canResetBuiltins && row.hasOverride ? (
                      isPendingReset ? (
                        <span className="ls-add-sink-templates-confirm">
                          <span className="ls-add-sink-templates-confirm-label">Reset?</span>
                          <button
                            type="button"
                            className="ls-add-sink-templates-action ls-add-sink-templates-action--danger"
                            disabled={isResetting}
                            onClick={() => onConfirmReset(row.kind)}
                          >
                            {isResetting ? "…" : "Yes"}
                          </button>
                          <button
                            type="button"
                            className="ls-add-sink-templates-action"
                            disabled={isResetting}
                            onClick={onCancelReset}
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="ls-add-sink-templates-action"
                          onClick={() => onRequestReset(row.kind)}
                          title="Restore the built-in defaults (does not affect placed sinks)"
                        >
                          Reset
                        </button>
                      )
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="ls-add-sink-templates-section">
        <header className="ls-add-sink-templates-header">
          <span className="ls-add-sink-templates-title">Company sinks</span>
          <span className="ls-add-sink-templates-count">{customRows.length}</span>
        </header>
        {customRows.length === 0 ? (
          <p className="ls-add-sink-templates-empty">
            No company sinks yet.
            {onCreate ? (
              <>
                {" "}
                <button
                  type="button"
                  className="ls-add-sink-templates-empty-link"
                  onClick={onCreate}
                >
                  Create one
                </button>{" "}
                to reuse it across jobs with its own cutout price.
              </>
            ) : null}
          </p>
        ) : (
          <ul className="ls-add-sink-templates-list">
            {customRows.map((row) => {
              const isActive = activeDropdownValue === row.dropdownValue;
              const isPendingDelete = pendingDeleteId === row.template.id;
              const isDeleting = deletingId === row.template.id;
              return (
                <li
                  key={row.template.id}
                  className={`ls-add-sink-templates-item${isActive ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="ls-add-sink-templates-row"
                    onClick={() => onSelect(row.dropdownValue)}
                    aria-pressed={isActive}
                  >
                    <span className="ls-add-sink-templates-row-name">{row.template.name}</span>
                    <span className="ls-add-sink-templates-row-meta">
                      {dimsMetaLabel(row)}
                    </span>
                    <span className="ls-add-sink-templates-row-price">
                      {formatUsd(row.priceUsd)} / cut
                    </span>
                  </button>
                  {canManageCustom || canDeleteCustom ? (
                    <div className="ls-add-sink-templates-row-actions">
                      {canManageCustom ? (
                        <button
                          type="button"
                          className="ls-add-sink-templates-action"
                          onClick={() => onEditCustom(row.template)}
                          title="Edit this sink template"
                        >
                          Edit
                        </button>
                      ) : null}
                      {canDeleteCustom ? (
                        isPendingDelete ? (
                          <span className="ls-add-sink-templates-confirm">
                            <span className="ls-add-sink-templates-confirm-label">Delete?</span>
                            <button
                              type="button"
                              className="ls-add-sink-templates-action ls-add-sink-templates-action--danger"
                              disabled={isDeleting}
                              onClick={() => onConfirmDelete(row.template.id)}
                            >
                              {isDeleting ? "…" : "Yes"}
                            </button>
                            <button
                              type="button"
                              className="ls-add-sink-templates-action"
                              disabled={isDeleting}
                              onClick={onCancelDelete}
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="ls-add-sink-templates-action ls-add-sink-templates-action--danger"
                            onClick={() => onRequestDelete(row.template.id)}
                            title="Remove from company library (does not affect placed sinks)"
                          >
                            Delete
                          </button>
                        )
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}

function SinkTemplateForm({
  mode,
  name,
  shape,
  widthIn,
  depthIn,
  cornerRadiusIn,
  priceUsd,
  saving,
  error,
  onSave,
  onCancel,
  onChangeName,
  onChangeShape,
  onChangeWidth,
  onChangeDepth,
  onChangeCornerRadius,
  onChangePrice,
}: {
  mode: Mode;
  name: string;
  shape: "rectangle" | "oval";
  widthIn: string;
  depthIn: string;
  cornerRadiusIn: string;
  priceUsd: string;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  onChangeName: (next: string) => void;
  onChangeShape: (next: "rectangle" | "oval") => void;
  onChangeWidth: (next: string) => void;
  onChangeDepth: (next: string) => void;
  onChangeCornerRadius: (next: string) => void;
  onChangePrice: (next: string) => void;
}) {
  /**
   * Built-ins have a fixed name and shape (the catalog defines them) — we
   * lock those inputs in edit mode so users only tweak dims and price.
   * Custom templates remain fully editable, and create-mode lets users
   * pick any shape.
   */
  const isBuiltin = mode.kind === "edit-builtin";
  const titleId = `ls-add-sink-form-title`;
  const title =
    mode.kind === "create"
      ? "New company sink template"
      : mode.kind === "edit-custom"
        ? "Edit company sink template"
        : "Edit built-in sink for this company";
  const lede =
    mode.kind === "create"
      ? "Saved to your company so anyone on your team can pick it from the dropdown. The price below is added to the quote each time this sink is cut."
      : mode.kind === "edit-custom"
        ? "Edits update the company library only. Sinks already placed on jobs keep their original price and dimensions to protect existing quotes."
        : "Override this built-in's dimensions and per-cut price for your company. Other companies still see the catalog defaults, and sinks already placed on jobs keep their original snapshot.";
  return (
    <div className="ls-add-sink-create-form" role="region" aria-labelledby={titleId}>
      <h3 id={titleId} className="ls-add-sink-create-title">
        {title}
      </h3>
      <p className="ls-add-sink-create-lede">{lede}</p>
      <div className="ls-sheet-grid">
        <label className="ls-field ls-field-span">
          Template name {isBuiltin ? null : <span className="ls-req">*</span>}
          <input
            className="ls-input"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="e.g. 36×18 farmhouse sink"
            disabled={isBuiltin}
            autoFocus={!isBuiltin}
          />
          {isBuiltin ? (
            <span className="ls-muted ls-add-sink-custom-price">
              Built-in name is fixed across the catalog.
            </span>
          ) : null}
        </label>
        <fieldset className="ls-field ls-field-span ls-add-sink-form-shape-fieldset">
          <legend className="ls-add-sink-form-shape-legend">Shape</legend>
          <div
            className="ls-hole-count-toggle"
            role="group"
            aria-label="Sink shape"
          >
            <button
              type="button"
              className={`ls-hole-count-toggle-btn${shape === "rectangle" ? " is-active" : ""}`}
              aria-pressed={shape === "rectangle"}
              disabled={isBuiltin}
              onClick={() => onChangeShape("rectangle")}
            >
              Rectangle (with corner radius)
            </button>
            <button
              type="button"
              className={`ls-hole-count-toggle-btn${shape === "oval" ? " is-active" : ""}`}
              aria-pressed={shape === "oval"}
              disabled={isBuiltin}
              onClick={() => onChangeShape("oval")}
            >
              Oval
            </button>
          </div>
        </fieldset>
        <label className="ls-field">
          Width (in) <span className="ls-req">*</span>
          <input
            className="ls-input"
            type="number"
            min={0.1}
            step={0.125}
            value={widthIn}
            onChange={(e) => onChangeWidth(e.target.value)}
            autoFocus={isBuiltin}
          />
        </label>
        <label className="ls-field">
          Depth (in) <span className="ls-req">*</span>
          <input
            className="ls-input"
            type="number"
            min={0.1}
            step={0.125}
            value={depthIn}
            onChange={(e) => onChangeDepth(e.target.value)}
          />
        </label>
        {shape === "rectangle" ? (
          <label className="ls-field">
            Corner radius (in)
            <input
              className="ls-input"
              type="number"
              min={0}
              step={0.05}
              value={cornerRadiusIn}
              onChange={(e) => onChangeCornerRadius(e.target.value)}
            />
          </label>
        ) : null}
        <label className="ls-field">
          Cutout price ($) <span className="ls-req">*</span>
          <input
            className="ls-input"
            type="number"
            min={0}
            step={1}
            value={priceUsd}
            onChange={(e) => onChangePrice(e.target.value)}
            placeholder="e.g. 95"
          />
        </label>
      </div>
      {error ? (
        <p className="compare-warning ls-add-sink-create-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ls-sheet-actions">
        <button
          type="button"
          className="ls-btn ls-btn-secondary"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="ls-btn ls-btn-primary"
          onClick={onSave}
          disabled={saving}
        >
          {saving
            ? "Saving…"
            : mode.kind === "create"
              ? "Save sink template"
              : "Save changes"}
        </button>
      </div>
    </div>
  );
}

/**
 * Snapshot a row into the placement-time format used by
 * `PieceSinkCutout.customTemplate`. For built-ins we synthesize a
 * stable id (`builtin:<kind>`) so the snapshot is traceable back to
 * the override that produced it.
 */
function rowToSnapshot(row: SinkRow): PieceSinkCustomTemplateSnapshot {
  if (row.source === "custom") {
    const t = row.template;
    return {
      id: t.id,
      name: t.name,
      shape: t.shape,
      widthIn: t.widthIn,
      depthIn: t.depthIn,
      cornerRadiusIn: t.shape === "oval" ? 0 : t.cornerRadiusIn,
      priceUsd:
        Number.isFinite(t.priceUsd) && t.priceUsd >= 0 ? t.priceUsd : 0,
    };
  }
  return {
    id: `builtin:${row.kind}`,
    name: row.name,
    shape: row.shape,
    widthIn: row.widthIn,
    depthIn: row.depthIn,
    cornerRadiusIn: row.shape === "oval" ? 0 : row.cornerRadiusIn,
    priceUsd:
      row.priceUsd != null && Number.isFinite(row.priceUsd) && row.priceUsd >= 0
        ? row.priceUsd
        : 0,
  };
}

function dimsMetaLabel(row: SinkRow): string {
  if (row.shape === "oval") {
    return `oval ${formatDim(row.widthIn)}×${formatDim(row.depthIn)} in`;
  }
  return `${formatDim(row.widthIn)}×${formatDim(row.depthIn)} in · r ${formatDim(row.cornerRadiusIn)}`;
}

function builtinOptionLabel(row: Extract<SinkRow, { source: "builtin" }>): string {
  const dims =
    row.shape === "oval"
      ? `oval ${formatDim(row.widthIn)}×${formatDim(row.depthIn)} in`
      : `${formatDim(row.widthIn)}×${formatDim(row.depthIn)} in, ${formatDim(row.cornerRadiusIn)} in corner radius`;
  const priceTag =
    row.priceUsd == null ? "" : ` · ${formatUsd(row.priceUsd)}/cut`;
  return `${row.name} — ${dims}${priceTag}`;
}

function customOptionLabel(t: CustomSinkTemplate): string {
  const dims =
    t.shape === "oval"
      ? `oval ${formatDim(t.widthIn)}×${formatDim(t.depthIn)} in`
      : `${formatDim(t.widthIn)}×${formatDim(t.depthIn)} in, ${formatDim(t.cornerRadiusIn)} in radius`;
  const price = formatUsd(t.priceUsd);
  return `${t.name} — ${dims} · ${price}/cut`;
}

function formatDim(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function parsePositive(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseNonNeg(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
