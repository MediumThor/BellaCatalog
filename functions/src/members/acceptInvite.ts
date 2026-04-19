import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { STRIPE_SECRET_KEY } from "../stripe/client";
import {
  ALL_ROLES,
  assertAuth,
  bad,
  normalizeEmail,
  syncSeatCount,
  type CompanyRole,
} from "./helpers";

/**
 * Consume a pending invite for the signed-in user. Works three ways:
 *   - by `inviteId` (the email-link flow),
 *   - by `companyId` + `token`, or
 *   - by `token` alone (the hero "Join with code" flow — we look the
 *     invite up by `(auth.email, token)`, which is unique because tokens
 *     are random per-invite and pinned to a single email).
 *
 * On success, writes an active membership for the caller and triggers a
 * seat count sync (which also updates Stripe quantity when a subscription
 * exists).
 */
export const acceptInvite = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    const { uid, email } = assertAuth(req);
    if (!email) {
      bad(
        "failed-precondition",
        "Your account must have a verified email to accept an invite."
      );
    }

    const data = (req.data ?? {}) as Partial<
      { inviteId?: string; token?: string; companyId?: string }
    >;

    const db = getFirestore();

    // Resolve the invite doc.
    let inviteRef;
    let invite: FirebaseFirestore.DocumentData | undefined;
    if (data.inviteId) {
      inviteRef = db.doc(`companyInvites/${data.inviteId.trim()}`);
      const snap = await inviteRef.get();
      if (!snap.exists) bad("not-found", "Invite not found or already used.");
      invite = snap.data();
    } else if (data.companyId && data.token) {
      const qs = await db
        .collection("companyInvites")
        .where("companyId", "==", data.companyId.trim())
        .where("email", "==", email)
        .where("token", "==", data.token.trim())
        .limit(1)
        .get();
      if (qs.empty) bad("not-found", "Invite not found or already used.");
      inviteRef = qs.docs[0].ref;
      invite = qs.docs[0].data();
    } else if (data.token) {
      // "Join with code" flow: caller only knows their email + the code.
      const qs = await db
        .collection("companyInvites")
        .where("email", "==", email)
        .where("token", "==", data.token.trim())
        .limit(1)
        .get();
      if (qs.empty) {
        bad(
          "not-found",
          "We couldn't find an invite with that code for your email. Double-check the code, or ask your admin to re-send the invite."
        );
      }
      inviteRef = qs.docs[0].ref;
      invite = qs.docs[0].data();
    } else {
      bad(
        "invalid-argument",
        "Provide inviteId, token, or companyId+token to accept an invite."
      );
    }

    if (!invite || !inviteRef) bad("not-found", "Invite not found.");

    if (invite.status !== "pending") {
      bad("failed-precondition", "This invite is no longer active.");
    }
    if (normalizeEmail(invite.email) !== email) {
      bad(
        "permission-denied",
        "This invite is addressed to a different email. Sign in with that email to accept it."
      );
    }
    if (data.token && invite.token !== data.token.trim()) {
      bad("permission-denied", "Invite token does not match.");
    }

    const expiresAt = invite.expiresAt?.toMillis?.() ?? 0;
    if (expiresAt && expiresAt < Date.now()) {
      bad("failed-precondition", "This invite has expired. Ask for a new one.");
    }

    const companyId = invite.companyId as string;
    const roleRaw = invite.role as string;
    const role: CompanyRole = (ALL_ROLES as string[]).includes(roleRaw)
      ? (roleRaw as CompanyRole)
      : "sales";

    const memberRef = db.doc(`companies/${companyId}/members/${uid}`);
    const existingMember = await memberRef.get();
    const existingData = existingMember.data();

    await memberRef.set(
      {
        userId: uid,
        companyId,
        email,
        displayName:
          invite.displayName ||
          existingData?.displayName ||
          req.auth?.token?.name ||
          email,
        role,
        status: "active",
        seatStatus: "active",
        consumesSeat: true,
        invitedByUserId: invite.invitedByUserId ?? null,
        joinedAt: FieldValue.serverTimestamp(),
        createdAt:
          existingData?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Make this the user's active workspace if they don't have one yet.
    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const userData = userSnap.data() ?? {};
    const userPatch: Record<string, unknown> = {
      email,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!userData.defaultCompanyId) userPatch.defaultCompanyId = companyId;
    if (!userData.activeCompanyId) userPatch.activeCompanyId = companyId;
    await userRef.set(userPatch, { merge: true });

    await inviteRef.set(
      {
        status: "accepted",
        acceptedAt: FieldValue.serverTimestamp(),
        acceptedByUserId: uid,
        invitedUserId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const seats = await syncSeatCount(companyId);

    return {
      companyId,
      role,
      activeSeatCount: seats.activeSeatCount,
      seatLimit: seats.seatLimit,
    };
  }
);
