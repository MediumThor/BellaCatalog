import { useState } from "react";
import { AREA_TYPE_PRESETS } from "../types/compareQuote";

export type JobFormValues = {
  name: string;
  areaType: string;
  notes: string;
  assumptions: string;
};

export const emptyJobFormValues = (): JobFormValues => ({
  name: "",
  areaType: "Kitchen",
  notes: "",
  assumptions: "",
});

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: JobFormValues) => Promise<void>;
};

export function CreateJobModal({ open, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<JobFormValues>(() => emptyJobFormValues());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const update = (patch: Partial<JobFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="job-modal-title" className="modal-title">
          New job
        </h2>
        {error ? (
          <p className="compare-warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="compare-form-grid">
          <label className="form-label compare-form-span-2">
            Job name *
            <input
              className="form-input"
              value={values.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Main kitchen"
            />
          </label>
          <label className="form-label compare-form-span-2">
            Area type
            <input
              className="form-input"
              list="area-presets"
              value={values.areaType}
              onChange={(e) => update({ areaType: e.target.value })}
            />
            <datalist id="area-presets">
              {AREA_TYPE_PRESETS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="form-label compare-form-span-2">
            Notes
            <textarea
              className="form-input form-textarea"
              rows={2}
              value={values.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </label>
          <label className="form-label compare-form-span-2">
            Assumptions (estimate scope)
            <textarea
              className="form-input form-textarea"
              rows={3}
              value={values.assumptions}
              onChange={(e) => update({ assumptions: e.target.value })}
              placeholder="e.g. Material estimate only; fabrication not included; subject to template verification…"
            />
          </label>
        </div>
        <p className="modal-sub">
          DXF / drawing attachments are planned for a later phase; URLs can be filled manually in
          Firestore if needed today.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={async () => {
              setError(null);
              if (!values.name.trim()) {
                setError("Job name is required.");
                return;
              }
              setSaving(true);
              try {
                await onSubmit(values);
                setValues(emptyJobFormValues());
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save job.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Create job"}
          </button>
        </div>
      </div>
    </div>
  );
}
