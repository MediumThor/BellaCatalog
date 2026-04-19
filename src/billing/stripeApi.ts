import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "../firebase";

/**
 * Thin wrappers around the Stripe-related Cloud Functions. These return URLs
 * that the browser should navigate to (Stripe-hosted Checkout / Billing
 * Portal). The backend performs all authz + Stripe API work.
 */

type CheckoutPayload = {
  companyId: string;
  seats?: number;
  successUrl: string;
  cancelUrl: string;
};

type PortalPayload = {
  companyId: string;
  returnUrl: string;
};

const checkoutCallable = httpsCallable<
  CheckoutPayload,
  { url: string; sessionId: string }
>(firebaseFunctions, "createCheckoutSession");

const portalCallable = httpsCallable<PortalPayload, { url: string }>(
  firebaseFunctions,
  "createBillingPortalSession"
);

export async function startStripeCheckout(payload: CheckoutPayload): Promise<string> {
  const res = await checkoutCallable(payload);
  const url = res.data?.url;
  if (!url) throw new Error("Stripe did not return a checkout URL.");
  return url;
}

export async function openStripeBillingPortal(
  payload: PortalPayload
): Promise<string> {
  const res = await portalCallable(payload);
  const url = res.data?.url;
  if (!url) throw new Error("Stripe did not return a billing portal URL.");
  return url;
}
