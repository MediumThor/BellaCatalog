import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { STRIPE_SECRET_KEY, getStripe } from "../stripe/client";
import {
  assertPlatformAdmin,
  bad,
  getCompany,
  writeAudit,
} from "./helpers";

/**
 * Platform-admin subscription controls — force-cancel a paying customer's
 * Stripe subscription (for example, after a chargeback or fraud), or
 * resume a subscription that was scheduled to cancel at period end.
 *
 * These wrap Stripe directly; the billing webhook will eventually mirror
 * the new state into Firestore, but we also write a best-effort patch
 * immediately so the admin UI feels snappy.
 */

type CancelPayload = {
  companyId: string;
  /** true = cancel at period end, false = cancel immediately (default). */
  atPeriodEnd?: boolean;
  reason?: string;
};

export const adminForceCancelSubscription = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    const { uid, email } = await assertPlatformAdmin(req);
    const data = (req.data ?? {}) as Partial<CancelPayload>;
    const companyId = (data.companyId ?? "").trim();
    if (!companyId) bad("invalid-argument", "companyId is required.");

    const { ref, data: company } = await getCompany(companyId);
    const billing = (company.billing ?? {}) as {
      stripeSubscriptionId?: string | null;
    };
    const subId = billing.stripeSubscriptionId;
    if (!subId) {
      bad(
        "failed-precondition",
        "This company has no Stripe subscription to cancel."
      );
    }

    const stripe = getStripe();
    const atPeriodEnd = data.atPeriodEnd ?? false;

    let patch: Record<string, unknown>;
    if (atPeriodEnd) {
      const updated = await stripe.subscriptions.update(subId, {
        cancel_at_period_end: true,
      });
      patch = {
        "billing.cancelAtPeriodEnd": true,
        "billing.status":
          updated.status === "active" ? "active" : updated.status,
        updatedAt: FieldValue.serverTimestamp(),
      };
    } else {
      await stripe.subscriptions.cancel(subId, { prorate: true });
      patch = {
        "billing.status": "canceled",
        "billing.cancelAtPeriodEnd": false,
        updatedAt: FieldValue.serverTimestamp(),
      };
    }

    await ref.update(patch);

    await writeAudit({
      action: "forceCancelSubscription",
      actorUserId: uid,
      actorEmail: email,
      targetCompanyId: companyId,
      reason: data.reason ?? null,
      before: { status: billing },
      after: { atPeriodEnd, patch },
    });

    return { ok: true, atPeriodEnd };
  }
);

type ResumePayload = {
  companyId: string;
  reason?: string;
};

export const adminResumeSubscription = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    const { uid, email } = await assertPlatformAdmin(req);
    const data = (req.data ?? {}) as Partial<ResumePayload>;
    const companyId = (data.companyId ?? "").trim();
    if (!companyId) bad("invalid-argument", "companyId is required.");

    const { ref, data: company } = await getCompany(companyId);
    const billing = (company.billing ?? {}) as {
      stripeSubscriptionId?: string | null;
      cancelAtPeriodEnd?: boolean;
    };
    const subId = billing.stripeSubscriptionId;
    if (!subId) {
      bad(
        "failed-precondition",
        "This company has no Stripe subscription to resume."
      );
    }
    if (!billing.cancelAtPeriodEnd) {
      bad(
        "failed-precondition",
        "Subscription is not scheduled to cancel. Nothing to resume."
      );
    }

    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(subId, {
      cancel_at_period_end: false,
    });

    await ref.update({
      "billing.cancelAtPeriodEnd": false,
      "billing.status": updated.status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAudit({
      action: "resumeSubscription",
      actorUserId: uid,
      actorEmail: email,
      targetCompanyId: companyId,
      reason: data.reason ?? null,
      before: { cancelAtPeriodEnd: true },
      after: { cancelAtPeriodEnd: false, status: updated.status },
    });

    return { ok: true };
  }
);
