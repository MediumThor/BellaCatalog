import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { STRIPE_SECRET_KEY } from "../stripe/client";
import {
  assertAuth,
  assertCanManageUsers,
  assertNotLastOwner,
  bad,
  getMemberDoc,
  revokeAuthForUser,
  syncSeatCount,
} from "./helpers";

type Payload = {
  companyId: string;
  userId: string;
  /**
   * Target status. "removed" is a hard offboard; "disabled" is a soft
   * pause that preserves history but blocks access. "active" re-enables a
   * previously-disabled teammate (subject to the seat limit on the plan).
   */
  status: "active" | "disabled" | "removed";
  reason?: string;
};

/**
 * Flip a teammate's membership status. Called by owners/admins from the
 * Team page when someone joins/leaves the company.
 *
 * Side effects:
 *   - Disabling or removing revokes the target's Firebase Auth refresh
 *     tokens so they're logged out across devices within the next token
 *     refresh (~1h).
 *   - Seat count is recomputed and Stripe subscription quantity is
 *     updated to match.
 */
export const setMemberStatus = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    const { uid: callerUid } = assertAuth(req);
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = (data.companyId ?? "").trim();
    const userId = (data.userId ?? "").trim();
    const status = data.status;
    if (!companyId) bad("invalid-argument", "companyId is required.");
    if (!userId) bad("invalid-argument", "userId is required.");
    if (status !== "active" && status !== "disabled" && status !== "removed") {
      bad("invalid-argument", "status must be active, disabled, or removed.");
    }

    if (userId === callerUid && status !== "active") {
      bad(
        "failed-precondition",
        "You can't disable or remove your own membership. Ask another owner/admin to do it."
      );
    }

    await assertCanManageUsers(companyId, callerUid);

    const { exists, data: member } = await getMemberDoc(companyId, userId);
    if (!exists || !member) bad("not-found", "Member not found.");

    if (status !== "active") {
      await assertNotLastOwner(companyId, userId);
    }

    const db = getFirestore();
    const memberRef = db.doc(`companies/${companyId}/members/${userId}`);

    const patch: Record<string, unknown> = {
      status,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (status === "active") {
      patch.seatStatus = "active";
      patch.consumesSeat = true;
      patch.disabledAt = null;
      patch.disabledReason = null;
    } else {
      patch.seatStatus = "disabled";
      patch.consumesSeat = false;
      patch.disabledAt = FieldValue.serverTimestamp();
      patch.disabledByUserId = callerUid;
      if (data.reason) patch.disabledReason = data.reason;
    }

    await memberRef.set(patch, { merge: true });

    if (status !== "active") {
      await revokeAuthForUser(userId);

      // Clean up stale pending invites tied to this user so the same email
      // doesn't resurrect the membership on next sign-in.
      const invites = await db
        .collection("companyInvites")
        .where("companyId", "==", companyId)
        .where("invitedUserId", "==", userId)
        .where("status", "==", "pending")
        .get();
      const batch = db.batch();
      invites.forEach((inv) => {
        batch.set(
          inv.ref,
          {
            status: "revoked",
            revokedAt: FieldValue.serverTimestamp(),
            revokedByUserId: callerUid,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
      if (!invites.empty) await batch.commit();
    }

    const seats = await syncSeatCount(companyId);
    return {
      status,
      activeSeatCount: seats.activeSeatCount,
      seatLimit: seats.seatLimit,
    };
  }
);
