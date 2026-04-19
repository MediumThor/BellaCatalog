/**
 * Helpers for the BellaCatalog platform-admin callable functions.
 *
 * Every write in this namespace goes through `writeAudit()` so we always
 * know who changed what (and can surface it in the admin UI).
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export function bad(
  code:
    | "unauthenticated"
    | "invalid-argument"
    | "permission-denied"
    | "not-found"
    | "failed-precondition"
    | "internal",
  message: string
): never {
  throw new HttpsError(code, message);
}

/** Signed-in + has a `platformAdmins/{uid}` doc. Returns the caller's uid + email. */
export async function assertPlatformAdmin(req: {
  auth?: { uid: string; token?: { email?: string } } | null;
}): Promise<{ uid: string; email: string }> {
  if (!req.auth) bad("unauthenticated", "Sign in required.");
  const uid = req.auth.uid;
  const email = (req.auth.token?.email ?? "").trim().toLowerCase();
  const db = getFirestore();
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) {
    bad("permission-denied", "You are not a BellaCatalog platform admin.");
  }
  return { uid, email };
}

export interface AuditEntryInput {
  action:
    | "setCompanyBilling"
    | "setMemberSeatStatus"
    | "transferOwnership"
    | "forceCancelSubscription"
    | "resumeSubscription"
    | "setMemberStatus"
    | "other";
  actorUserId: string;
  actorEmail: string;
  targetCompanyId?: string | null;
  targetUserId?: string | null;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export async function writeAudit(entry: AuditEntryInput): Promise<void> {
  const db = getFirestore();
  await db.collection("adminAuditLog").add({
    ...entry,
    at: FieldValue.serverTimestamp(),
  });
}

export async function getCompany(companyId: string) {
  const db = getFirestore();
  const ref = db.doc(`companies/${companyId}`);
  const snap = await ref.get();
  if (!snap.exists) bad("not-found", "Company not found.");
  return { ref, data: snap.data() ?? {} };
}

export async function getMember(companyId: string, userId: string) {
  const db = getFirestore();
  const ref = db.doc(`companies/${companyId}/members/${userId}`);
  const snap = await ref.get();
  if (!snap.exists) bad("not-found", "Member not found.");
  return { ref, data: snap.data() ?? {} };
}

/** Count currently-seat-consuming members for a company. */
export async function countActiveSeats(companyId: string): Promise<number> {
  const db = getFirestore();
  const qs = await db
    .collection(`companies/${companyId}/members`)
    .where("status", "==", "active")
    .get();
  let n = 0;
  qs.forEach((doc) => {
    if (doc.data().consumesSeat !== false) n += 1;
  });
  return n;
}
