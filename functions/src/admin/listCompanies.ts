import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { assertPlatformAdmin } from "./helpers";

/**
 * Return a compact list of every company in the system for the admin
 * dashboard. This is intentionally a small, denormalized projection
 * (name, billing status, seat usage) so we don't ship thousands of full
 * company docs on every page load.
 */
export const adminListCompanies = onCall(
  { region: "us-central1" },
  async (req) => {
    await assertPlatformAdmin(req);
    const db = getFirestore();
    const snap = await db.collection("companies").get();
    const rows = snap.docs.map((doc) => {
      const d = doc.data();
      const billing = (d.billing ?? {}) as Record<string, unknown>;
      return {
        id: doc.id,
        name: typeof d.name === "string" ? d.name : doc.id,
        slug: typeof d.slug === "string" ? d.slug : doc.id,
        status:
          typeof billing.status === "string" ? billing.status : "none",
        seatLimit:
          typeof billing.seatLimit === "number" ? billing.seatLimit : 0,
        bonusSeats:
          typeof billing.bonusSeats === "number" ? billing.bonusSeats : 0,
        activeSeatCount:
          typeof billing.activeSeatCount === "number"
            ? billing.activeSeatCount
            : 0,
        stripeCustomerId:
          (billing.stripeCustomerId as string | null | undefined) ?? null,
        stripeSubscriptionId:
          (billing.stripeSubscriptionId as string | null | undefined) ??
          null,
        cancelAtPeriodEnd: Boolean(billing.cancelAtPeriodEnd),
        createdAt:
          (d.createdAt as FirebaseFirestore.Timestamp | null | undefined) ??
          null,
      };
    });

    rows.sort((a, b) =>
      (a.name || a.id).localeCompare(b.name || b.id)
    );

    return { companies: rows };
  }
);
