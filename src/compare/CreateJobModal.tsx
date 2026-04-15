import { useEffect, useRef, useState } from "react";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";

export type JobFormValues = {
  name: string;
  contactName: string;
  contactPhone: string;
  siteAddress: string;
  areaType: string;
  notes: string;
  assumptions: string;
};

export const emptyJobFormValues = (): JobFormValues => ({
  name: "",
  contactName: "",
  contactPhone: "",
  siteAddress: "",
  areaType: "Kitchen",
  notes: "",
  assumptions: "",
});

type Props = {
  open: boolean;
  onClose: () => void;
  initialValues?: JobFormValues | null;
  onSubmit: (values: JobFormValues) => Promise<void>;
};

export function CreateJobModal({ open, onClose, initialValues, onSubmit }: Props) {
  const [values, setValues] = useState<JobFormValues>(() => initialValues ?? emptyJobFormValues());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevOpenRef = useRef(false);
  const isEdit = Boolean(initialValues);

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setValues(initialValues ?? emptyJobFormValues());
      setError(null);
    }
    prevOpenRef.current = open;
  }, [open, initialValues]);

  if (!open) return null;

  const title = isEdit ? "Edit job details" : "New job";
  const submitLabel = isEdit ? "Save details" : "Create job";

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
          {title}
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
          <label className="form-label">
            Contact name
            <input
              className="form-input"
              value={values.contactName}
              onChange={(e) => update({ contactName: e.target.value })}
              placeholder="e.g. Jane Smith"
            />
          </label>
          <label className="form-label">
            Contact phone
            <input
              className="form-input"
              value={values.contactPhone}
              onChange={(e) => update({ contactPhone: e.target.value })}
              placeholder="e.g. 555-123-4567"
            />
          </label>
          <label className="form-label compare-form-span-2">
            Address
            <AddressAutocompleteInput
              id={isEdit ? "edit-job-address" : "create-job-address"}
              className="form-input"
              value={values.siteAddress}
              onChange={(siteAddress) => update({ siteAddress })}
            />
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
        <p className="modal-sub">The first area will be created from the job name. Add more areas later if needed.</p>
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
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
