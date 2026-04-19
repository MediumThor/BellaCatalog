import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { STRIPE_SECRET_KEY } from "../stripe/client";
import {
  assertAuth,
  assertCanManageUsers,
  bad,
  syncSeatCount,
} from "./helpers";

type Payload = {
  companyId: string;
  inviteId: string;
};

/**
 * Cancel a pending invite. Also clears any placeholder `invited` member
 * doc so the Team page no longer shows them as pending.
 */
export const revokeInvite = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    const { uid } = assertAuth(req);
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = (data.companyId ?? "").trim();
    const inviteId = (data.inviteId ?? "").trim();
    if (!companyId) bad("invalid-argument", "companyId is required.");
    if (!inviteId) bad("invalid-argument", "inviteId is required.");

    await assertCanManageUsers(companyId, uid);

    const db = getFirestore();
    const inviteRef = db.doc(`companyInvites/${inviteId}`);
    const snap = await inviteRef.get();
    if (!snap.exists) return { ok: true, alreadyGone: true };
    const invite = snap.data() as { companyId?: string; invitedUserId?: string | null };
    if (invite.companyId !== companyId) {
      bad("permission-denied", "Invite does not belong to this company.");
    }

    await inviteRef.set(
      {
        status: "revoked",
        revokedAt: FieldValue.serverTimestamp(),
        revokedByUserId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (invite.invitedUserId) {
      const memberRef = db.doc(
        `companies/${companyId}/members/${invite.invitedUserId}`
      );
      const memberSnap = await memberRef.get();
      const memberStatus = memberSnap.data()?.status as string | undefined;
      // Only clean up if the member was in the pre-activation state. If
      // they've already accepted, a plain invite revoke shouldn't disable
      // them — admins should use `setMemberStatus` / `removeMember`.
      if (memberStatus === "invited") {
        await memberRef.set(
          {
            status: "removed",
            seatStatus: "disabled",
            consumesSeat: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    await syncSeatCount(companyId);
    return { ok: true };
  }
);
