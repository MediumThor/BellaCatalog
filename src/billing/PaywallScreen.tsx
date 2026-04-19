import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import type { CompanyBillingStatus } from "../company/types";

type Props = {
  companyName: string | null;
  billingStatus: CompanyBillingStatus | null;
  hasSeat: boolean;
  canManageBilling: boolean;
};

function statusCopy(
  status: CompanyBillingStatus | null,
  hasSeat: boolean
): { title: string; body: string } {
  if (!hasSeat) {
    return {
      title: "No active seat",
      body: "Your membership to this company doesn't have an active seat yet. An owner or admin can assign you one from the Team page.",
    };
  }
  switch (status) {
    case "trialing":
      return {
        title: "Trial expired",
        body: "The trial for this workspace has ended. An owner needs to add a payment method to continue.",
      };
    case "past_due":
      return {
        title: "Payment past due",
        body: "The last payment for this workspace failed. Access is limited until billing is updated.",
      };
    case "canceled":
      return {
        title: "Subscription canceled",
        body: "This workspace's subscription was canceled. An owner can reactivate it from the billing page.",
      };
    case "incomplete":
    case "unpaid":
      return {
        title: "Payment required",
        body: "This workspace's subscription is incomplete. An owner needs to finish payment setup.",
      };
    case "none":
    case null:
      return {
        title: "No subscription",
        body: "This workspace doesn't have a subscription yet. An owner can pick a plan from the billing page.",
      };
    default:
      return {
        title: "Access restricted",
        body: "This workspace isn't currently allowed to access BellaCatalog. An owner can resolve this from the billing page.",
      };
  }
}

export function PaywallScreen({
  companyName,
  billingStatus,
  hasSeat,
  canManageBilling,
}: Props) {
  const { signOut } = useAuth();
  const { title, body } = statusCopy(billingStatus, hasSeat);

  return (
    <div className="paywall">
      <div className="paywall__card" role="region" aria-labelledby="paywall-title">
        <div className="paywall__eyebrow">BellaCatalog</div>
        <h1 id="paywall-title" className="paywall__title">
          {title}
        </h1>
        <p className="paywall__body">
          {companyName ? (
            <>
              <strong>{companyName}</strong> —{" "}
            </>
          ) : null}
          {body}
        </p>
        <div className="paywall__actions">
          {canManageBilling ? (
            <Link to="/settings/billing" className="btn btn-primary">
              Open billing
            </Link>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
        {!canManageBilling ? (
          <p className="paywall__hint">
            Not an owner? Ask your company owner to resolve billing.
          </p>
        ) : null}
      </div>
    </div>
  );
}
