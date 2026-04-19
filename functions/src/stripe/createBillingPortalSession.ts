import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { STRIPE_SECRET_KEY, getStripe } from "./client";

type Payload = {
  companyId: string;
  returnUrl: string;
};

/**
 * Return a Stripe Billing Portal URL for the given company so owners/admins
 * can manage cards, invoices, and cancellation.
 */
export const createBillingPortalSession = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const data = (req.data ?? {}) as Partial<Payload>;
    if (!data.companyId || typeof data.returnUrl !== "string") {
      throw new HttpsError(
        "invalid-argument",
        "companyId and returnUrl are required."
      );
    }

    const db = getFirestore();
    const [companySnap, memberSnap] = await Promise.all([
      db.doc(`companies/${data.companyId}`).get(),
      db.doc(`companies/${data.companyId}/members/${req.auth.uid}`).get(),
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

    const customerId =
      (companySnap.data()?.billing?.stripeCustomerId as string | undefined) ??
      null;
    if (!customerId) {
      throw new HttpsError(
        "failed-precondition",
        "This company has no Stripe customer yet. Create a subscription first."
      );
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: data.returnUrl,
    });

    return { url: session.url };
  }
);
