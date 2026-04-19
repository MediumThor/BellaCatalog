/**
 * BellaCatalog Cloud Functions (Gen 2).
 *
 * Add price-import parsing, Stripe webhooks, and other trusted backend work
 * here.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

if (!getApps().length) {
  initializeApp();
}

export const apiHealth = onRequest(
  {
    region: "us-central1",
    cors: true,
    invoker: "public",
  },
  (req, res) => {
    logger.info("apiHealth", { method: req.method });
    res.set("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      service: "bellacatalog-functions",
      ts: new Date().toISOString(),
    });
  }
);

// Stripe billing
export { createCheckoutSession } from "./stripe/createCheckoutSession";
export { createBillingPortalSession } from "./stripe/createBillingPortalSession";
export { stripeWebhook } from "./stripe/webhook";

// Team / membership management
export { inviteMember } from "./members/inviteMember";
export { revokeInvite } from "./members/revokeInvite";
export { acceptInvite } from "./members/acceptInvite";
export { setMemberStatus } from "./members/setMemberStatus";
export { updateMemberRole } from "./members/updateMemberRole";

// Platform admin (BellaCatalog staff) controls
export { adminListCompanies } from "./admin/listCompanies";
export { adminSetCompanyBilling } from "./admin/setCompanyBilling";
export { adminSetMemberSeatStatus } from "./admin/setMemberSeatStatus";
export { adminTransferOwnership } from "./admin/transferOwnership";
export {
  adminForceCancelSubscription,
  adminResumeSubscription,
} from "./admin/subscriptionControls";
export { setMemberCommission } from "./members/setMemberCommission";

// Commission tracker: payment-driven lifecycle + ledger triggers
export { onPaymentWrite } from "./commissions/onPaymentWrite";
export { onJobStatusTransition } from "./commissions/onJobStatusTransition";

// QuickBooks CSV export
export { exportCommissionsCsv } from "./quickbooks/exportCommissionsCsv";
