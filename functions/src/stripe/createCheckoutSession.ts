import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  STRIPE_PRICE_ID_SEAT_MONTHLY,
  STRIPE_SECRET_KEY,
  getStripe,
} from "./client";

type Payload = {
  companyId: string;
  seats?: number;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Create a Stripe Checkout Session for a new or existing company
 * subscription. The frontend redirects the browser to the returned URL.
 *
 * Authz: caller must be an owner or admin of the target company.
 */
export const createCheckoutSession = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY, STRIPE_PRICE_ID_SEAT_MONTHLY],
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = data.companyId;
    const seats = Math.max(1, Math.floor(data.seats ?? 1));
    if (
      !companyId ||
      typeof data.successUrl !== "string" ||
      typeof data.cancelUrl !== "string"
    ) {
      throw new HttpsError(
        "invalid-argument",
        "companyId, successUrl, and cancelUrl are required."
      );
    }

    const db = getFirestore();
    const companyRef = db.doc(`companies/${companyId}`);
    const memberRef = db.doc(`companies/${companyId}/members/${req.auth.uid}`);

    const [companySnap, memberSnap] = await Promise.all([
      companyRef.get(),
      memberRef.get(),
    ]);

    if (!companySnap.exists) {
      throw new HttpsError("not-found", "Company not found.");
    }
    const member = memberSnap.data();
    if (!member || (member.role !== "owner" && member.role !== "admin")) {
      throw new HttpsError(
        "permission-denied",
        "Only owners or admins can manage billing."
      );
    }

    const company = companySnap.data() ?? {};
    const billing = (company.billing ?? {}) as {
      stripeCustomerId?: string | null;
    };

    const stripe = getStripe();

    let customerId = billing.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.auth.token.email ?? undefined,
        name: company.name ?? undefined,
        metadata: { companyId },
      });
      customerId = customer.id;
      await companyRef.update({
        "billing.stripeCustomerId": customerId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: STRIPE_PRICE_ID_SEAT_MONTHLY.value(),
          quantity: seats,
        },
      ],
      subscription_data: {
        metadata: { companyId },
        trial_period_days: 14,
      },
      metadata: { companyId, seats: String(seats) },
      success_url: data.successUrl,
      cancel_url: data.cancelUrl,
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new HttpsError("internal", "Stripe did not return a checkout URL.");
    }
    return { url: session.url, sessionId: session.id };
  }
);
