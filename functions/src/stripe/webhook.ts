import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import type Stripe from "stripe";
import {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  getStripe,
} from "./client";

function toBillingStatus(
  status: Stripe.Subscription.Status
): string {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
      return "canceled";
    case "unpaid":
      return "unpaid";
    case "paused":
      return "past_due";
    default:
      return "none";
  }
}

function toTimestamp(epochSeconds: number | null | undefined): Timestamp | null {
  if (!epochSeconds) return null;
  return Timestamp.fromMillis(epochSeconds * 1000);
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  explicitCompanyId?: string
) {
  const db = getFirestore();
  const companyId =
    explicitCompanyId ??
    (subscription.metadata?.companyId as string | undefined);
  if (!companyId) {
    logger.warn("syncSubscription: missing companyId in metadata", {
      subscriptionId: subscription.id,
    });
    return;
  }

  const item = subscription.items.data[0];
  const seatLimit = item?.quantity ?? 1;
  const status = toBillingStatus(subscription.status);

  const companyUpdate: Record<string, unknown> = {
    "billing.status": status,
    "billing.seatLimit": seatLimit,
    "billing.stripeSubscriptionId": subscription.id,
    "billing.currentPeriodEnd": toTimestamp(subscription.current_period_end),
    "billing.trialEndsAt": toTimestamp(subscription.trial_end),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.doc(`companies/${companyId}`).update(companyUpdate);

  await db.doc(`stripeCustomers/${companyId}`).set(
    {
      companyId,
      stripeCustomerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
      status,
      seatLimit,
      currentPeriodEnd: toTimestamp(subscription.current_period_end),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Stripe webhook receiver. Configure the endpoint in the Stripe dashboard to
 * point at the deployed HTTPS URL and paste the signing secret into
 * `STRIPE_WEBHOOK_SECRET`.
 *
 * Handles the subscription lifecycle events we care about. Each event
 * mirrors the current subscription state into both `companies/{id}.billing`
 * (read by the frontend) and `stripeCustomers/{id}` (audit trail).
 */
export const stripeWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const stripe = getStripe();
    const signature = req.header("stripe-signature") ?? "";
    let event: Stripe.Event;
    try {
      // `rawBody` is populated on Firebase HTTPS functions.
      const raw = (req as unknown as { rawBody: Buffer }).rawBody;
      event = stripe.webhooks.constructEvent(
        raw,
        signature,
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (err) {
      logger.error("stripeWebhook signature verification failed", { err });
      res.status(400).send(`Webhook Error: ${(err as Error).message}`);
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const companyId = session.metadata?.companyId;
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            await syncSubscription(sub, companyId ?? undefined);
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
        case "customer.subscription.trial_will_end": {
          await syncSubscription(event.data.object as Stripe.Subscription);
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          const subId =
            typeof invoice.subscription === "string"
              ? invoice.subscription
              : invoice.subscription?.id;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            await syncSubscription(sub);
          }
          break;
        }
        default:
          logger.debug("stripeWebhook: ignored event", { type: event.type });
      }
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error("stripeWebhook handler failed", { err, type: event.type });
      res.status(500).send("Webhook handler failed");
    }
  }
);
