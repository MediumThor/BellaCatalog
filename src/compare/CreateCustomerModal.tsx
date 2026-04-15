import { useEffect, useRef, useState } from "react";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";
import {
  CUSTOMER_TYPE_OPTIONS,
  DEFAULT_CUSTOMER_TYPE,
  type CustomerType,
} from "../types/compareQuote";
import { formatPhoneInput } from "../utils/phone";

export type CustomerFormValues = {
  customerType: CustomerType;
  businessName: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

export const emptyCustomerFormValues: CustomerFormValues = {
  customerType: DEFAULT_CUSTOMER_TYPE,
  businessName: "",
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
  onDelete?: () => Promise<void>;
};

export function CreateCustomerModal({ open, onClose, onSubmit, initialValues, onDelete }: Props) {
  const [values, setValues] = useState<CustomerFormValues>(emptyCustomerFormValues);
  const [busyAction, setBusyAction] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevOpenRef = useRef(false);

  const isEdit = Boolean(initialValues);
  const saving = busyAction !== null;

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setValues(initialValues ?? emptyCustomerFormValues);
      setError(null);
      setBusyAction(null);
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
          <div className="form-label compare-form-span-2">
            Customer type
            <div className="view-toggle form-view-toggle" role="group" aria-label="Customer type">
              {CUSTOMER_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="btn view-toggle__btn"
                  data-active={values.customerType === option.value}
                  aria-pressed={values.customerType === option.value}
                  onClick={() => update({ customerType: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className="form-label compare-form-span-2">
            Business name
            <input
              className="form-input"
              value={values.businessName}
              onChange={(e) => update({ businessName: e.target.value })}
              autoComplete="organization"
              placeholder="Optional business or company name"
            />
          </label>
          <label className="form-label">
            First name
            <input
              className="form-input"
              value={values.firstName}
              onChange={(e) => update({ firstName: e.target.value })}
              autoComplete="given-name"
            />
          </label>
          <label className="form-label">
            Last name
            <input
              className="form-input"
              value={values.lastName}
              onChange={(e) => update({ lastName: e.target.value })}
              autoComplete="family-name"
            />
          </label>
          <label className="form-label">
            Phone
            <input
              className="form-input"
              value={values.phone}
              onChange={(e) => update({ phone: formatPhoneInput(e.target.value) })}
              autoComplete="tel"
            />
          </label>
          <label className="form-label">
            Email
            <input
              className="form-input"
              type="email"
              value={values.email}
              onChange={(e) => update({ email: e.target.value })}
              autoComplete="email"
            />
          </label>
          <label className="form-label compare-form-span-2">
            Address
            <AddressAutocompleteInput
              id={isEdit ? "edit-customer-address" : "create-customer-address"}
              className="form-input"
              value={values.address}
              onChange={(address) => update({ address })}
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
          {isEdit && onDelete ? (
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={async () => {
                setError(null);
                if (
                  !window.confirm(
                    "Delete this customer? This will also remove all jobs and materials for this customer. This action cannot be undone."
                  )
                ) {
                  return;
                }
                setBusyAction("delete");
                try {
                  await onDelete();
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not delete customer.");
                } finally {
                  setBusyAction(null);
                }
              }}
            >
              {busyAction === "delete" ? "Deleting…" : "Delete customer"}
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={async () => {
              setError(null);
              const hasBusiness = Boolean(values.businessName.trim());
              const hasPersonName = Boolean(values.firstName.trim() && values.lastName.trim());
              if (!hasBusiness && !hasPersonName) {
                setError("Enter a business name, or both first and last name.");
                return;
              }
              setBusyAction("save");
              try {
                await onSubmit(values);
                if (!isEdit) {
                  setValues(emptyCustomerFormValues);
                }
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save customer.");
              } finally {
                setBusyAction(null);
              }
            }}
          >
            {busyAction === "save" ? "Saving…" : submitIdleLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
