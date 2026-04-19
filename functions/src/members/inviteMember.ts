import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { STRIPE_SECRET_KEY } from "../stripe/client";
import {
  ALL_ROLES,
  assertAuth,
  assertCanManageUsers,
  bad,
  findAuthUserByEmail,
  generateInviteToken,
  getCompanyOrThrow,
  getMemberDoc,
  inviteIdFor,
  normalizeEmail,
  nowPlusDays,
  type CompanyRole,
} from "./helpers";

type Payload = {
  companyId: string;
  email: string;
  role?: CompanyRole;
  displayName?: string;
};

/**
 * Create (or refresh) a pending invite for a teammate.
 *
 * Flow:
 *   1. Caller must be an owner/admin of the company.
 *   2. We upsert `companyInvites/{companyId__email}` with a short-lived
 *      token + target role.
 *   3. If the invitee already has a Firebase Auth account, we also write a
 *      placeholder member doc with `status: "invited"`. That lets the app
 *      show a pending row in the Team page and lets the invitee see their
 *      upcoming seat on their own onboarding screen.
 *
 * The invitee completes the flow by signing in with the same email and
 * calling `acceptInvite`.
 */
export const inviteMember = onCall(
  {
    region: "us-central1",
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req) => {
    const { uid } = assertAuth(req);
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = (data.companyId ?? "").trim();
    const email = normalizeEmail(data.email);
    const role = (data.role ?? "sales") as CompanyRole;
    const displayName = (data.displayName ?? "").trim();

    if (!companyId) bad("invalid-argument", "companyId is required.");
    if (!email || !email.includes("@")) {
      bad("invalid-argument", "A valid email is required.");
    }
    if (!ALL_ROLES.includes(role)) {
      bad("invalid-argument", "Unknown role.");
    }
    if (role === "owner") {
      bad(
        "invalid-argument",
        "Owners must be promoted from an existing teammate after they join."
      );
    }

    await assertCanManageUsers(companyId, uid);
    const { data: companyData } = await getCompanyOrThrow(companyId);
    const companyName =
      typeof companyData.name === "string" ? companyData.name : "";

    const db = getFirestore();
    const inviteId = inviteIdFor(companyId, email);
    const inviteRef = db.doc(`companyInvites/${inviteId}`);

    const existingInvite = await inviteRef.get();
    const existingToken = existingInvite.exists
      ? (existingInvite.data()?.token as string | undefined)
      : undefined;
    const token = existingToken ?? generateInviteToken();

    const authUser = await findAuthUserByEmail(email);

    await inviteRef.set(
      {
        id: inviteId,
        companyId,
        companyName,
        email,
        role,
        displayName: displayName || null,
        token,
        status: "pending",
        invitedByUserId: uid,
        invitedUserId: authUser?.uid ?? null,
        expiresAt: nowPlusDays(14),
        createdAt: existingInvite.exists
          ? existingInvite.data()?.createdAt ?? FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );

    // If we can resolve the user now, stash a placeholder membership so the
    // Team page can render the pending row and so the user sees their
    // invite on first sign-in. Skip when they already have an active /
    // disabled membership (we don't want to clobber it).
    if (authUser) {
      const { exists, data: existingMember } = await getMemberDoc(
        companyId,
        authUser.uid
      );
      const currentStatus = existingMember?.status as string | undefined;
      const safeToUpsert =
        !exists || currentStatus === "invited" || currentStatus === "removed";
      if (safeToUpsert) {
        await db
          .doc(`companies/${companyId}/members/${authUser.uid}`)
          .set(
            {
              userId: authUser.uid,
              companyId,
              email,
              displayName:
                displayName || authUser.displayName || email,
              role,
              status: "invited",
              seatStatus: "pending",
              consumesSeat: false,
              invitedByUserId: uid,
              joinedAt: null,
              createdAt: exists
                ? existingMember?.createdAt ??
                  FieldValue.serverTimestamp()
                : FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: false }
          );
      }
    }

    return {
      inviteId,
      token,
      email,
      role,
      pendingAuthUser: Boolean(authUser),
    };
  }
);
