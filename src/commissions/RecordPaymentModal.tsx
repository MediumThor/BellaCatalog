import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { recordPayment } from "../services/jobPaymentsFirestore";
import {
  PAYMENT_KIND_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  type PaymentKind,
  type PaymentMethod,
} from "../types/commission";

type Props = {
  open: boolean;
  companyId: string;
  customerId: string;
  jobId: string;
  /** Controls the default kind + the "will lock pricing" confirmation. */
  requiredDepositAmount: number | null;
  depositReceivedTotal: number;
  quotedTotal: number | null;
  paidTotal: number;
  onClose: () => void;
  onRecorded: () => void;
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function RecordPaymentModal({
  open,
  companyId,
  customerId,
  jobId,
  requiredDepositAmount,
  depositReceivedTotal,
  quotedTotal,
  paidTotal,
  onClose,
  onRecorded,
}: Props) {
  const { user, profileDisplayName } = useAuth();

  const defaultKind: PaymentKind = useMemo(() => {
    if (quotedTotal != null && paidTotal >= quotedTotal - 0.005)
      return "adjustment";
    if (requiredDepositAmount && depositReceivedTotal < requiredDepositAmount)
      return "deposit";
    if (quotedTotal && paidTotal < quotedTotal) return "final";
    return "deposit";
  }, [quotedTotal, paidTotal, requiredDepositAmount, depositReceivedTotal]);

  const defaultAmount = useMemo(() => {
    if (defaultKind === "deposit" && requiredDepositAmount) {
      return String(
        Math.max(0, requiredDepositAmount - depositReceivedTotal)
      );
    }
    if (defaultKind === "final" && quotedTotal) {
      return String(Math.max(0, quotedTotal - paidTotal));
    }
    return "";
  }, [defaultKind, requiredDepositAmount, depositReceivedTotal, quotedTotal, paidTotal]);

  const [kind, setKind] = useState<PaymentKind>(defaultKind);
  const [amount, setAmount] = useState<string>(defaultAmount);
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [receivedAt, setReceivedAt] = useState(todayIso());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const amountNum = Number(amount) || 0;
  const willCrossDepositThreshold =
    kind === "deposit" &&
    requiredDepositAmount != null &&
    depositReceivedTotal < requiredDepositAmount &&
    depositReceivedTotal + amountNum >= requiredDepositAmount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (amountNum <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordPayment(companyId, customerId, jobId, {
        kind,
        amount: amountNum,
        method,
        receivedAt,
        referenceNumber: referenceNumber || null,
        notes: notes.trim(),
        recordedByUserId: user.uid,
        recordedByDisplayName: profileDisplayName ?? user.email ?? null,
      });
      onRecorded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Record payment"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">Record payment</h2>
        <p className="modal-sub">
          {quotedTotal != null
            ? `Quoted total: $${quotedTotal.toLocaleString()} · Paid so far: $${paidTotal.toLocaleString()}`
            : "Set a quoted total on the job to see balance due."}
        </p>
        <form className="settings-form" onSubmit={handleSubmit}>
          <div className="settings-form__row">
            <label className="auth-field">
              <span className="auth-field__label">Kind</span>
              <select
                className="auth-field__input"
                value={kind}
                onChange={(e) => setKind(e.target.value as PaymentKind)}
              >
                {PAYMENT_KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span className="auth-field__label">Received</span>
              <input
                className="auth-field__input"
                type="date"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
                required
              />
            </label>
          </div>
          <div
            className="settings-form__row"
            style={{ gridTemplateColumns: "1fr 110px 1fr" }}
          >
            <label className="auth-field">
              <span className="auth-field__label">Method</span>
              <select
                className="auth-field__input"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHOD_OPTIONS.filter(
                  (o) => o.value !== "stripe"
                ).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span className="auth-field__label">Amount</span>
              <input
                className="auth-field__input"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <label className="auth-field">
              <span className="auth-field__label">
                Reference #{" "}
                <span className="auth-field__optional">· optional</span>
              </span>
              <input
                className="auth-field__input"
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Check #, last 4, etc."
              />
            </label>
          </div>
          <label className="auth-field">
            <span className="auth-field__label">
              Notes <span className="auth-field__optional">· optional</span>
            </span>
            <textarea
              className="auth-field__input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {willCrossDepositThreshold ? (
            <div
              className="settings-inline-msg settings-inline-msg--warn"
              role="alert"
            >
              This payment satisfies the required deposit. Recording it will
              lock pricing on this job and move it to <strong>Active</strong>.
            </div>
          ) : null}
          {error ? (
            <div className="settings-inline-msg settings-inline-msg--bad">
              {error}
            </div>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || amountNum <= 0}
            >
              {saving ? "Saving…" : "Record payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
