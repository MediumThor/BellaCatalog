import Stripe from "stripe";
import { defineSecret } from "firebase-functions/params";

/**
 * Secrets for the Stripe integration.
 *
 * Set these once per environment:
 *   firebase functions:secrets:set STRIPE_SECRET_KEY
 *   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 *   firebase functions:secrets:set STRIPE_PRICE_ID_SEAT_MONTHLY
 */
export const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
export const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
export const STRIPE_PRICE_ID_SEAT_MONTHLY = defineSecret(
  "STRIPE_PRICE_ID_SEAT_MONTHLY"
);

let cachedClient: Stripe | null = null;

export function getStripe(): Stripe {
  const key = STRIPE_SECRET_KEY.value();
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Set it via `firebase functions:secrets:set STRIPE_SECRET_KEY`."
    );
  }
  if (cachedClient) return cachedClient;
  cachedClient = new Stripe(key, {
    apiVersion: "2025-03-31.basil" as Stripe.LatestApiVersion,
    appInfo: { name: "BellaCatalog" },
  });
  return cachedClient;
}
