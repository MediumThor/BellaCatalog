import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import {
  assertPlatformAdmin,
  bad,
  getMember,
  writeAudit,
} from "./helpers";

type Payload = {
  companyId: string;
  /** The member who will become owner. Must already be an active member. */
  newOwnerUserId: string;
  /**
   * What to do with the current owner(s). "demoteToAdmin" is the default
   * safest move; "keepOwner" leaves them as a co-owner.
   */
  currentOwnerBehavior?: "demoteToAdmin" | "keepOwner";
  reason?: string;
};

/**
 * Platform-admin ownership transfer. Used when a customer's owner leaves
 * the company or loses their login — avoids the support ticket where we
 * need to manually rewrite a Firestore doc to hand over the keys.
 */
export const adminTransferOwnership = onCall(
  { region: "us-central1" },
  async (req) => {
    const { uid, email } = await assertPlatformAdmin(req);
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = (data.companyId ?? "").trim();
    const newOwnerUserId = (data.newOwnerUserId ?? "").trim();
    const behavior = data.currentOwnerBehavior ?? "demoteToAdmin";
    if (!companyId) bad("invalid-argument", "companyId is required.");
    if (!newOwnerUserId) bad("invalid-argument", "newOwnerUserId is required.");

    const { ref: newRef, data: newMember } = await getMember(
      companyId,
      newOwnerUserId
    );
    if (newMember.status !== "active") {
      bad(
        "failed-precondition",
        "The target member must be active before promoting to owner."
      );
    }

    const before: Record<string, unknown> = {
      newOwner: { role: newMember.role, userId: newOwnerUserId },
    };

    await newRef.set(
      {
        role: "owner",
        roleChangedAt: FieldValue.serverTimestamp(),
        roleChangedByUserId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (behavior === "demoteToAdmin") {
      // Demote any OTHER active owner to admin. Using the admin SDK
      // bypasses the `assertNotLastOwner` guard (there's a new owner now).
      const db = (await import("firebase-admin/firestore")).getFirestore();
      const owners = await db
        .collection(`companies/${companyId}/members`)
        .where("role", "==", "owner")
        .where("status", "==", "active")
        .get();
      const demoted: string[] = [];
      const batch = db.batch();
      owners.forEach((doc) => {
        if (doc.id === newOwnerUserId) return;
        demoted.push(doc.id);
        batch.set(
          doc.ref,
          {
            role: "admin",
            roleChangedAt: FieldValue.serverTimestamp(),
            roleChangedByUserId: uid,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
      if (demoted.length > 0) await batch.commit();
      before.demotedOwners = demoted;
    }

    await writeAudit({
      action: "transferOwnership",
      actorUserId: uid,
      actorEmail: email,
      targetCompanyId: companyId,
      targetUserId: newOwnerUserId,
      reason: data.reason ?? null,
      before,
      after: {
        newOwner: { role: "owner", userId: newOwnerUserId },
        currentOwnerBehavior: behavior,
      },
    });

    return { ok: true };
  }
);
