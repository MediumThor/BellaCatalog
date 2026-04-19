import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { STRIPE_SECRET_KEY } from "../stripe/client";
import {
  ALL_ROLES,
  assertAuth,
  assertCanManageUsers,
  assertNotLastOwner,
  bad,
  getMemberDoc,
  type CompanyRole,
} from "./helpers";

type Payload = {
  companyId: string;
  userId: string;
  role: CompanyRole;
};

/**
 * Change a teammate's role. Owners can be made by promoting an existing
 * active member. Demoting the last remaining owner is rejected.
 */
export const updateMemberRole = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    const { uid: callerUid } = assertAuth(req);
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = (data.companyId ?? "").trim();
    const userId = (data.userId ?? "").trim();
    const role = data.role as CompanyRole;
    if (!companyId) bad("invalid-argument", "companyId is required.");
    if (!userId) bad("invalid-argument", "userId is required.");
    if (!ALL_ROLES.includes(role)) bad("invalid-argument", "Unknown role.");

    const { role: callerRole } = await assertCanManageUsers(
      companyId,
      callerUid
    );

    const { exists, data: member } = await getMemberDoc(companyId, userId);
    if (!exists || !member) bad("not-found", "Member not found.");

    // Only owners can mint new owners or demote/retire existing ones.
    const currentRole = member!.role as CompanyRole;
    if ((role === "owner" || currentRole === "owner") && callerRole !== "owner") {
      bad(
        "permission-denied",
        "Only an owner can promote someone to owner or change another owner's role."
      );
    }

    if (currentRole === "owner" && role !== "owner") {
      await assertNotLastOwner(companyId, userId);
    }

    const db = getFirestore();
    await db
      .doc(`companies/${companyId}/members/${userId}`)
      .set(
        {
          role,
          updatedAt: FieldValue.serverTimestamp(),
          roleChangedAt: FieldValue.serverTimestamp(),
          roleChangedByUserId: callerUid,
        },
        { merge: true }
      );

    return { role };
  }
);
