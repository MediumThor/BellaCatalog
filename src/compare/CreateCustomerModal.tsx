import { useEffect, useRef, useState } from "react";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";

export type CustomerFormValues = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

export const emptyCustomerFormValues: CustomerFormValues = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: CustomerFormValues) => Promise<void>;
  /** When set, dialog opens as edit with these values (synced when the dialog opens). */
  initialValues?: CustomerFormValues | null;
};

export function CreateCustomerModal({ open, onClose, onSubmit, initialValues }: Props) {
  const [values, setValues] = useState<CustomerFormValues>(emptyCustomerFormValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevOpenRef = useRef(false);

  const isEdit = Boolean(initialValues);

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setValues(initialValues ?? emptyCustomerFormValues);
      setError(null);
    }
    prevOpenRef.current = open;
  }, [open, initialValues]);

  if (!open) return null;

  const update = (patch: Partial<CustomerFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
  };

  const title = isEdit ? "Edit customer" : "New customer";
  const submitIdleLabel = isEdit ? "Save changes" : "Create customer";

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cust-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="cust-modal-title" className="modal-title">
          {title}
        </h2>
        {error ? (
          <p className="compare-warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="compare-form-grid">
          <label className="form-label">
            First name *
            <input
              className="form-input"
              value={values.firstName}
              onChange={(e) => update({ firstName: e.target.value })}
              autoComplete="given-name"
            />
          </label>
          <label className="form-label">
            Last name *
            <input
              className="form-input"
              value={values.lastName}
              onChange={(e) => update({ lastName: e.target.value })}
              autoComplete="family-name"
            />
          </label>
          <label className="form-label">
            Phone *
            <input
              className="form-input"
              value={values.phone}
              onChange={(e) => update({ phone: e.target.value })}
              autoComplete="tel"
            />
          </label>
          <label className="form-label">
            Email *
            <input
              className="form-input"
              type="email"
              value={values.email}
              onChange={(e) => update({ email: e.target.value })}
              autoComplete="email"
            />
          </label>
          <label className="form-label compare-form-span-2">
            Address *
            <AddressAutocompleteInput
              id={isEdit ? "edit-customer-address" : "create-customer-address"}
              className="form-input"
              value={values.address}
              onChange={(address) => update({ address })}
              required
            />
          </label>
          <label className="form-label compare-form-span-2">
            Notes
            <textarea
              className="form-input form-textarea"
              rows={3}
              value={values.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </label>
        </div>
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
              if (!values.firstName.trim() || !values.lastName.trim()) {
                setError("First and last name are required.");
                return;
              }
              if (!values.phone.trim() || !values.email.trim() || !values.address.trim()) {
                setError("Phone, email, and address are required.");
                return;
              }
              setSaving(true);
              try {
                await onSubmit(values);
                if (!isEdit) {
                  setValues(emptyCustomerFormValues);
                }
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save customer.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : submitIdleLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
