import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import {
  assertPlatformAdmin,
  bad,
  countActiveSeats,
  getMember,
  writeAudit,
} from "./helpers";

type Payload = {
  companyId: string;
  userId: string;
  /**
   * - "exempt": member stays active but does NOT burn a seat. Use this
   *   when you want to gift a single user a free seat (e.g. yourself at
   *   BellaStone, or a beta tester).
   * - "active": member is active and consumes a seat (normal state).
   * - "pending": marked as waiting for payment/reactivation.
   * - "disabled": alias for `setMemberStatus` — kept here so a platform
   *   admin can also freeze an individual member.
   */
  seatStatus: "active" | "exempt" | "pending" | "disabled";
  reason?: string;
};

/**
 * Flip a single member's seat accounting without touching their role or
 * login. This is the "gift this one person a seat" lever — set
 * `seatStatus: "exempt"` and they stop counting toward the plan limit
 * but still have full access.
 */
export const adminSetMemberSeatStatus = onCall(
  { region: "us-central1" },
  async (req) => {
    const { uid, email } = await assertPlatformAdmin(req);
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = (data.companyId ?? "").trim();
    const userId = (data.userId ?? "").trim();
    const seatStatus = data.seatStatus;
    if (!companyId) bad("invalid-argument", "companyId is required.");
    if (!userId) bad("invalid-argument", "userId is required.");
    if (
      seatStatus !== "active" &&
      seatStatus !== "exempt" &&
      seatStatus !== "pending" &&
      seatStatus !== "disabled"
    ) {
      bad("invalid-argument", "Unknown seatStatus.");
    }

    const { ref, data: member } = await getMember(companyId, userId);
    const before = {
      seatStatus: member.seatStatus ?? null,
      consumesSeat: member.consumesSeat ?? null,
      status: member.status ?? null,
    };

    const patch: Record<string, unknown> = {
      seatStatus,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (seatStatus === "active") {
      patch.consumesSeat = true;
      patch.status = "active";
    } else if (seatStatus === "exempt") {
      patch.consumesSeat = false;
      patch.status = "active"; // exempt still implies access
    } else if (seatStatus === "pending") {
      patch.consumesSeat = false;
    } else if (seatStatus === "disabled") {
      patch.consumesSeat = false;
      patch.status = "disabled";
      patch.disabledAt = FieldValue.serverTimestamp();
      patch.disabledByUserId = uid;
    }

    await ref.set(patch, { merge: true });

    // Keep company-level seat count accurate.
    const newCount = await countActiveSeats(companyId);
    const db = getFirestore();
    await db.doc(`companies/${companyId}`).update({
      "billing.activeSeatCount": newCount,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAudit({
      action: "setMemberSeatStatus",
      actorUserId: uid,
      actorEmail: email,
      targetCompanyId: companyId,
      targetUserId: userId,
      reason: data.reason ?? null,
      before,
      after: {
        seatStatus,
        consumesSeat: patch.consumesSeat,
        status: patch.status ?? member.status,
      },
    });

    return { ok: true, activeSeatCount: newCount };
  }
);
