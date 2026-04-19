import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { STRIPE_SECRET_KEY } from "../stripe/client";
import {
  assertPlatformAdmin,
  bad,
  getCompany,
  writeAudit,
} from "./helpers";

const ALLOWED_STATUSES = new Set([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
  "none",
  "internal_dev",
]);

type Payload = {
  companyId: string;
  status?: string;
  bonusSeats?: number;
  note?: string | null;
  reason?: string;
};

/**
 * Platform-admin knob for gifting seats or flipping a company onto the
 * free `internal_dev` plan. Stripe is intentionally untouched here —
 * Stripe stays the source of truth for paid seats (`seatLimit`), and
 * `bonusSeats` layers on top for promos and internal use.
 *
 * Set `status = "internal_dev"` to bypass billing entirely (the existing
 * `RequireActiveSubscription` guard already treats that as "allowed").
 */
export const adminSetCompanyBilling = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    const { uid, email } = await assertPlatformAdmin(req);
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = (data.companyId ?? "").trim();
    if (!companyId) bad("invalid-argument", "companyId is required.");

    const { ref, data: company } = await getCompany(companyId);
    const before = { billing: company.billing ?? null };

    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (typeof data.status === "string") {
      if (!ALLOWED_STATUSES.has(data.status)) {
        bad("invalid-argument", `Unknown billing status: ${data.status}`);
      }
      patch["billing.status"] = data.status;
    }

    if (typeof data.bonusSeats === "number") {
      if (!Number.isFinite(data.bonusSeats) || data.bonusSeats < 0) {
        bad("invalid-argument", "bonusSeats must be a non-negative integer.");
      }
      patch["billing.bonusSeats"] = Math.floor(data.bonusSeats);
    }

    if (data.note !== undefined) {
      patch["billing.adminNote"] = data.note?.trim() || null;
    }

    if (Object.keys(patch).length === 1) {
      bad("invalid-argument", "Nothing to update.");
    }

    await ref.update(patch);

    const afterSnap = await ref.get();
    await writeAudit({
      action: "setCompanyBilling",
      actorUserId: uid,
      actorEmail: email,
      targetCompanyId: companyId,
      reason: data.reason ?? null,
      before,
      after: { billing: afterSnap.data()?.billing ?? null },
    });

    return { ok: true };
  }
);
