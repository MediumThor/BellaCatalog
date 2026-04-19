import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { firebaseDb } from "../firebase";
import type { AdminAuditEntry } from "../company/types";

/**
 * Firestore subscriptions used by the platform-admin panel. These are
 * read-only — every mutation flows through the callable API.
 */

/** Is the signed-in user a BellaCatalog platform admin? */
export function subscribeIsPlatformAdmin(
  userId: string,
  onData: (isAdmin: boolean) => void,
  onError?: (err: Error) => void
): () => void {
  const ref = doc(firebaseDb, "platformAdmins", userId);
  return onSnapshot(
    ref,
    (snap) => onData(snap.exists()),
    (e) => onError?.(e as Error)
  );
}

export function subscribeRecentAuditEntries(
  onData: (rows: AdminAuditEntry[]) => void,
  onError?: (err: Error) => void,
  take = 100
): () => void {
  const q = query(
    collection(firebaseDb, "adminAuditLog"),
    orderBy("at", "desc"),
    limit(take)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows: AdminAuditEntry[] = [];
      snap.forEach((doc) => {
        const raw = doc.data() as Record<string, unknown>;
        rows.push({
          id: doc.id,
          actorUserId:
            typeof raw.actorUserId === "string" ? raw.actorUserId : "",
          actorEmail:
            typeof raw.actorEmail === "string" ? raw.actorEmail : "",
          action: (typeof raw.action === "string"
            ? raw.action
            : "other") as AdminAuditEntry["action"],
          targetCompanyId:
            (raw.targetCompanyId as string | null | undefined) ?? null,
          targetUserId:
            (raw.targetUserId as string | null | undefined) ?? null,
          reason: (raw.reason as string | null | undefined) ?? null,
          before:
            (raw.before as Record<string, unknown> | null | undefined) ??
            null,
          after:
            (raw.after as Record<string, unknown> | null | undefined) ??
            null,
          at: (raw.at as Timestamp | null | undefined) ?? null,
        });
      });
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}
