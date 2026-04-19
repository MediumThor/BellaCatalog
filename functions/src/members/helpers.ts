/**
 * Shared helpers for the team-management callable functions.
 *
 * Membership / invite writes all happen here (admin SDK, rules bypassed) so
 * that we can atomically:
 *   - enforce role-based authorization,
 *   - maintain `companies/{id}.billing.activeSeatCount`,
 *   - keep Stripe subscription quantity in sync with active seats, and
 *   - revoke Firebase Auth refresh tokens when someone is cut off.
 */
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import type Stripe from "stripe";
import { getStripe } from "../stripe/client";

export type CompanyRole = "owner" | "admin" | "manager" | "sales" | "viewer";
export const ALL_ROLES: CompanyRole[] = [
  "owner",
  "admin",
  "manager",
  "sales",
  "viewer",
];

export type CompanyMembershipStatus =
  | "invited"
  | "active"
  | "disabled"
  | "removed";

export interface MemberData {
  userId: string;
  email: string;
  displayName?: string;
  role: CompanyRole;
  status: CompanyMembershipStatus;
  seatStatus: "active" | "pending" | "disabled" | "exempt";
  consumesSeat: boolean;
}

/** Normalize an email to the casing we store/query on. */
export function normalizeEmail(input: string | undefined | null): string {
  return (input ?? "").trim().toLowerCase();
}

/** Throw a typed HttpsError the callers can rely on. */
export function bad(
  code: "unauthenticated" | "invalid-argument" | "permission-denied" | "not-found" | "failed-precondition" | "internal",
  message: string
): never {
  throw new HttpsError(code, message);
}

/** Assert the caller is signed in. Returns their uid. */
export function assertAuth(req: { auth?: { uid: string; token?: { email?: string } } | null }): {
  uid: string;
  email: string;
} {
  if (!req.auth) bad("unauthenticated", "Sign in required.");
  return {
    uid: req.auth.uid,
    email: normalizeEmail(req.auth.token?.email),
  };
}

export async function getCompanyOrThrow(companyId: string) {
  const db = getFirestore();
  const ref = db.doc(`companies/${companyId}`);
  const snap = await ref.get();
  if (!snap.exists) bad("not-found", "Company not found.");
  return { ref, data: snap.data() ?? {} };
}

export async function getMemberDoc(companyId: string, userId: string) {
  const db = getFirestore();
  const ref = db.doc(`companies/${companyId}/members/${userId}`);
  const snap = await ref.get();
  return { ref, exists: snap.exists, data: snap.data() ?? null };
}

/**
 * Assert the caller is an owner or admin (the two roles that carry
 * `canManageUsers`). Returns their member data for further checks.
 */
export async function assertCanManageUsers(
  companyId: string,
  callerUid: string
): Promise<{ role: CompanyRole }> {
  const { exists, data } = await getMemberDoc(companyId, callerUid);
  if (!exists || !data) bad("permission-denied", "You are not a member of this company.");
  const role = data!.role as CompanyRole;
  const status = data!.status as CompanyMembershipStatus;
  if (status !== "active") {
    bad("permission-denied", "Your membership is not active.");
  }
  if (role !== "owner" && role !== "admin") {
    bad("permission-denied", "Only owners or admins can manage teammates.");
  }
  return { role };
}

/**
 * Ensure we don't strand a company without any active owner after a role
 * change or disable/remove operation. Throws if `targetUid` is the last
 * remaining active owner.
 */
export async function assertNotLastOwner(
  companyId: string,
  targetUid: string
): Promise<void> {
  const db = getFirestore();
  const qs = await db
    .collection(`companies/${companyId}/members`)
    .where("role", "==", "owner")
    .where("status", "==", "active")
    .get();
  const owners = qs.docs.map((d) => d.id);
  if (owners.length <= 1 && owners.includes(targetUid)) {
    bad(
      "failed-precondition",
      "This is the last active owner. Promote another teammate to owner before disabling or demoting this one."
    );
  }
}

/** Count currently-seat-consuming members (status=active, consumesSeat=true). */
export async function recountActiveSeats(companyId: string): Promise<number> {
  const db = getFirestore();
  const qs = await db
    .collection(`companies/${companyId}/members`)
    .where("status", "==", "active")
    .get();
  let count = 0;
  qs.forEach((doc) => {
    const d = doc.data();
    if (d.consumesSeat !== false) count += 1;
  });
  return count;
}

/**
 * Write the new active-seat count onto the company doc and — if there is a
 * live Stripe subscription — adjust its quantity to match. Proration is
 * enabled so customers pay/credit for partial cycles.
 *
 * Safe to call when no subscription exists yet; it simply records the count
 * and bumps `seatLimit` to at least `activeSeatCount` so the UI stays
 * consistent.
 */
export async function syncSeatCount(companyId: string): Promise<{
  activeSeatCount: number;
  seatLimit: number;
}> {
  const db = getFirestore();
  const { ref: companyRef, data } = await getCompanyOrThrow(companyId);
  const billing = (data.billing ?? {}) as {
    stripeSubscriptionId?: string | null;
    seatLimit?: number;
  };

  const activeSeatCount = await recountActiveSeats(companyId);

  const patch: Record<string, unknown> = {
    "billing.activeSeatCount": activeSeatCount,
    updatedAt: FieldValue.serverTimestamp(),
  };

  let seatLimit = billing.seatLimit ?? activeSeatCount;

  const subId = billing.stripeSubscriptionId;
  if (subId) {
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(subId);
      const item = sub.items.data[0];
      const currentQty = item?.quantity ?? 0;
      if (item && currentQty !== activeSeatCount && activeSeatCount > 0) {
        const updated = (await stripe.subscriptions.update(subId, {
          items: [{ id: item.id, quantity: activeSeatCount }],
          proration_behavior: "create_prorations",
        })) as Stripe.Subscription;
        const newQty = updated.items.data[0]?.quantity ?? activeSeatCount;
        seatLimit = newQty;
        patch["billing.seatLimit"] = newQty;
      }
    } catch (err) {
      // Don't fail the whole callable just because Stripe is flaky; the
      // nightly reconcile (or the next webhook) will converge. We still
      // persist the internal `activeSeatCount` so rules/UI are accurate.
      logger.warn("syncSeatCount: Stripe quantity update failed", {
        companyId,
        err: (err as Error).message,
      });
    }
  } else {
    // No subscription yet — keep seatLimit >= activeSeatCount so the UI
    // doesn't misreport usage.
    if (activeSeatCount > seatLimit) {
      seatLimit = activeSeatCount;
      patch["billing.seatLimit"] = activeSeatCount;
    }
  }

  await db.runTransaction(async (tx) => {
    tx.update(companyRef, patch);
  });

  return { activeSeatCount, seatLimit };
}

/**
 * Force the target user to re-authenticate on their next token refresh
 * (within ~1 hour). Combined with the Firestore rule change that requires
 * `status == "active"`, this means a disabled teammate is effectively
 * locked out immediately for any write and within an hour for reads.
 */
export async function revokeAuthForUser(userId: string): Promise<void> {
  try {
    await getAuth().revokeRefreshTokens(userId);
  } catch (err) {
    logger.warn("revokeAuthForUser failed", {
      userId,
      err: (err as Error).message,
    });
  }
}

/** Look up an existing Firebase Auth user by email. Returns null if none. */
export async function findAuthUserByEmail(email: string) {
  try {
    return await getAuth().getUserByEmail(email);
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "auth/user-not-found") return null;
    throw err;
  }
}

/** Deterministic invite id so repeat invites don't duplicate. */
export function inviteIdFor(companyId: string, email: string): string {
  const safeEmail = normalizeEmail(email).replace(/[^a-z0-9]/g, "_");
  return `${companyId}__${safeEmail}`;
}

/** Random human-friendly token the invitee pastes to claim an invite. */
export function generateInviteToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function nowPlusDays(days: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
}
