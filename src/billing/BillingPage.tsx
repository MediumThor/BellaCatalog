import { useState } from "react";
import { Link } from "react-router-dom";
import { useCompany } from "../company/useCompany";
import type { CompanyBillingStatus } from "../company/types";
import { openStripeBillingPortal, startStripeCheckout } from "./stripeApi";

function formatStatus(status: CompanyBillingStatus | undefined): {
  label: string;
  tone: "good" | "warn" | "bad" | "info";
} {
  switch (status) {
    case "active":
      return { label: "Active", tone: "good" };
    case "trialing":
      return { label: "Trial", tone: "info" };
    case "internal_dev":
      return { label: "Internal / Dev", tone: "good" };
    case "past_due":
      return { label: "Past due", tone: "warn" };
    case "incomplete":
    case "unpaid":
      return { label: "Payment required", tone: "warn" };
    case "canceled":
      return { label: "Canceled", tone: "bad" };
    case "none":
    case undefined:
      return { label: "No subscription", tone: "bad" };
    default:
      return { label: String(status), tone: "info" };
  }
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return "—";
  if (
    typeof ts === "object" &&
    ts !== null &&
    "toDate" in ts &&
    typeof (ts as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      return (ts as { toDate: () => Date })
        .toDate()
        .toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
    } catch {
      return "—";
    }
  }
  return "—";
}

function daysUntil(ts: unknown): number | null {
  if (
    !ts ||
    typeof ts !== "object" ||
    ts === null ||
    !("toDate" in ts) ||
    typeof (ts as { toDate: () => Date }).toDate !== "function"
  ) {
    return null;
  }
  try {
    const date = (ts as { toDate: () => Date }).toDate();
    const ms = date.getTime() - Date.now();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

export function BillingPage() {
  const {
    activeCompany,
    permissions,
    activeCompanyId,
  } = useCompany();

  const billing = activeCompany?.billing;
  const status = formatStatus(billing?.status);
  const trialDays = daysUntil(billing?.trialEndsAt);
  const canManage = permissions.canManageBilling;

  const paidSeats = billing?.seatLimit ?? 1;
  const bonusSeats = billing?.bonusSeats ?? 0;
  const seatLimit = paidSeats + bonusSeats;
  const activeSeats = billing?.activeSeatCount ?? 1;

  const [busy, setBusy] = useState<null | "checkout" | "portal">(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasSubscription = Boolean(billing?.stripeSubscriptionId);

  const handleCheckout = async (seats: number) => {
    if (!activeCompanyId) return;
    setBusy("checkout");
    setActionError(null);
    try {
      const url = await startStripeCheckout({
        companyId: activeCompanyId,
        seats,
        successUrl: `${window.location.origin}/settings/billing?checkout=success`,
        cancelUrl: `${window.location.origin}/settings/billing?checkout=cancel`,
      });
      window.location.href = url;
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Could not start Stripe checkout. Check Stripe keys on the server."
      );
      setBusy(null);
    }
  };

  const handleManage = async () => {
    if (!activeCompanyId) return;
    setBusy("portal");
    setActionError(null);
    try {
      const url = await openStripeBillingPortal({
        companyId: activeCompanyId,
        returnUrl: `${window.location.origin}/settings/billing`,
      });
      window.location.href = url;
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Could not open billing portal. Check Stripe keys on the server."
      );
      setBusy(null);
    }
  };

  return (
    <div className="settings-page">
      <div className="billing-page">
        <header className="billing-header">
          <div>
            <h1 className="settings-page__title">Billing</h1>
            <p className="settings-page__lede">
              {activeCompany?.name ?? "Your company"} — Plan &amp; seat usage.
            </p>
          </div>
          <span
            className={`billing-status billing-status--${status.tone}`}
            aria-label={`Status: ${status.label}`}
          >
            {status.label}
          </span>
        </header>

        <section className="billing-grid">
          <article className="billing-card">
            <h2 className="billing-card__title">Subscription</h2>
            <dl className="billing-dl">
              <div>
                <dt>Status</dt>
                <dd>{status.label}</dd>
              </div>
              <div>
                <dt>Plan</dt>
                <dd>{billing?.planId ?? "—"}</dd>
              </div>
              <div>
                <dt>Current period ends</dt>
                <dd>{formatTimestamp(billing?.currentPeriodEnd)}</dd>
              </div>
              {billing?.status === "trialing" ? (
                <div>
                  <dt>Trial ends</dt>
                  <dd>
                    {formatTimestamp(billing?.trialEndsAt)}
                    {trialDays !== null ? (
                      <span className="billing-dl__hint">
                        {" "}
                        ({trialDays > 0
                          ? `${trialDays} day${trialDays === 1 ? "" : "s"} left`
                          : "expired"})
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
            </dl>
            {actionError ? (
              <div className="auth-error" role="alert">
                {actionError}
              </div>
            ) : null}
            <div className="billing-actions">
              {hasSubscription ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canManage || busy !== null}
                  onClick={() => void handleManage()}
                >
                  {busy === "portal" ? "Opening…" : "Manage billing"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canManage || busy !== null}
                  onClick={() => void handleCheckout(paidSeats || 1)}
                >
                  {busy === "checkout"
                    ? "Redirecting to Stripe…"
                    : "Start subscription"}
                </button>
              )}
            </div>
            {!canManage ? (
              <p className="billing-hint">
                Only owners and admins can change billing.
              </p>
            ) : billing?.status === "internal_dev" ? (
              <p className="billing-hint">
                This workspace is on an internal/dev plan and bypasses billing.
              </p>
            ) : null}
          </article>

          <article className="billing-card">
            <h2 className="billing-card__title">Seats</h2>
            <div className="billing-seats">
              <div className="billing-seats__number">
                <span className="billing-seats__count">{activeSeats}</span>
                <span className="billing-seats__of"> / {seatLimit}</span>
              </div>
              <div
                className="billing-seats__bar"
                role="progressbar"
                aria-valuenow={activeSeats}
                aria-valuemin={0}
                aria-valuemax={seatLimit}
              >
                <div
                  className="billing-seats__fill"
                  style={{
                    width: `${Math.min(100, (activeSeats / Math.max(1, seatLimit)) * 100)}%`,
                  }}
                />
              </div>
              {bonusSeats > 0 ? (
                <p className="billing-hint">
                  {paidSeats} paid + <strong>{bonusSeats} gifted</strong> by
                  BellaCatalog ={" "}
                  <strong>{seatLimit}</strong> total.
                  {billing?.adminNote ? ` — ${billing.adminNote}` : ""}
                </p>
              ) : (
                <p className="billing-hint">
                  Each teammate with an active membership uses one seat.
                  Manage your team from the{" "}
                  <Link to="/settings/team">Team page</Link>.
                </p>
              )}
            </div>
            <div className="billing-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canManage || busy !== null}
                onClick={() => void handleCheckout(paidSeats + 1)}
              >
                {busy === "checkout" ? "Redirecting…" : "Add a seat"}
              </button>
            </div>
          </article>

          <article className="billing-card billing-card--meta">
            <h2 className="billing-card__title">Company</h2>
            <dl className="billing-dl">
              <div>
                <dt>Company ID</dt>
                <dd>
                  <code>{activeCompanyId ?? "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Stripe customer</dt>
                <dd>
                  <code>{billing?.stripeCustomerId ?? "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Stripe subscription</dt>
                <dd>
                  <code>{billing?.stripeSubscriptionId ?? "—"}</code>
                </dd>
              </div>
            </dl>
          </article>
        </section>
      </div>
    </div>
  );
}
