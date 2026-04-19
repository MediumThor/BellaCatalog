import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { firebaseDb } from "../firebase";
import type {
  CompanyMemberDoc,
  CompanyMembershipStatus,
  CompanyRole,
  CompanySeatStatus,
} from "./types";

/**
 * Team-management specific Firestore helpers — member list subscriptions
 * and pending-invite lookups. See `companyFirestore.ts` for the single
 * self-membership subscription that backs the main `CompanyProvider`.
 */

export interface CompanyInviteDoc {
  id: string;
  companyId: string;
  companyName?: string | null;
  email: string;
  role: CompanyRole;
  displayName?: string | null;
  token?: string;
  status: "pending" | "accepted" | "revoked";
  invitedByUserId?: string | null;
  invitedUserId?: string | null;
  expiresAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

function parseMember(
  companyId: string,
  userId: string,
  raw: Record<string, unknown>
): CompanyMemberDoc {
  return {
    userId,
    companyId,
    email: typeof raw.email === "string" ? raw.email : "",
    displayName: typeof raw.displayName === "string" ? raw.displayName : "",
    role: (typeof raw.role === "string" ? raw.role : "viewer") as CompanyRole,
    status: (typeof raw.status === "string"
      ? raw.status
      : "active") as CompanyMembershipStatus,
    seatStatus: (typeof raw.seatStatus === "string"
      ? raw.seatStatus
      : "active") as CompanySeatStatus,
    consumesSeat: raw.consumesSeat !== false,
    permissions:
      raw.permissions && typeof raw.permissions === "object"
        ? (raw.permissions as CompanyMemberDoc["permissions"])
        : undefined,
    invitedByUserId:
      (raw.invitedByUserId as string | null | undefined) ?? null,
    joinedAt: (raw.joinedAt as Timestamp | null | undefined) ?? null,
    createdAt: (raw.createdAt as Timestamp | null | undefined) ?? null,
    updatedAt: (raw.updatedAt as Timestamp | null | undefined) ?? null,
  };
}

function parseInvite(id: string, raw: Record<string, unknown>): CompanyInviteDoc {
  return {
    id,
    companyId: typeof raw.companyId === "string" ? raw.companyId : "",
    companyName:
      typeof raw.companyName === "string" ? raw.companyName : null,
    email: typeof raw.email === "string" ? raw.email : "",
    role: (typeof raw.role === "string" ? raw.role : "sales") as CompanyRole,
    displayName:
      typeof raw.displayName === "string" ? raw.displayName : null,
    token: typeof raw.token === "string" ? raw.token : undefined,
    status: (typeof raw.status === "string"
      ? raw.status
      : "pending") as CompanyInviteDoc["status"],
    invitedByUserId:
      (raw.invitedByUserId as string | null | undefined) ?? null,
    invitedUserId: (raw.invitedUserId as string | null | undefined) ?? null,
    expiresAt: (raw.expiresAt as Timestamp | null | undefined) ?? null,
    createdAt: (raw.createdAt as Timestamp | null | undefined) ?? null,
    updatedAt: (raw.updatedAt as Timestamp | null | undefined) ?? null,
  };
}

export function subscribeCompanyMembers(
  companyId: string,
  onData: (rows: CompanyMemberDoc[]) => void,
  onError?: (err: Error) => void
): () => void {
  const ref = collection(firebaseDb, "companies", companyId, "members");
  return onSnapshot(
    ref,
    (snap) => {
      const rows: CompanyMemberDoc[] = [];
      snap.forEach((doc) => {
        rows.push(
          parseMember(
            companyId,
            doc.id,
            doc.data() as Record<string, unknown>
          )
        );
      });
      rows.sort((a, b) => {
        // Active first, then invited, then disabled/removed.
        const order = (status: CompanyMembershipStatus) => {
          if (status === "active") return 0;
          if (status === "invited") return 1;
          if (status === "disabled") return 2;
          return 3;
        };
        const diff = order(a.status) - order(b.status);
        if (diff !== 0) return diff;
        return (a.displayName || a.email).localeCompare(
          b.displayName || b.email
        );
      });
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export function subscribeCompanyInvites(
  companyId: string,
  onData: (rows: CompanyInviteDoc[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(firebaseDb, "companyInvites"),
    where("companyId", "==", companyId),
    where("status", "==", "pending")
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows: CompanyInviteDoc[] = [];
      snap.forEach((doc) => {
        rows.push(parseInvite(doc.id, doc.data() as Record<string, unknown>));
      });
      rows.sort((a, b) => a.email.localeCompare(b.email));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

/**
 * One-shot lookup of pending invites addressed to a given email, across
 * all companies. Used on the onboarding screen so a newly signed-up user
 * can accept an invite instead of creating a brand new workspace.
 */
export async function findPendingInvitesForEmail(
  email: string
): Promise<CompanyInviteDoc[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];
  try {
    const qs = await getDocs(
      query(
        collection(firebaseDb, "companyInvites"),
        where("email", "==", normalized),
        where("status", "==", "pending")
      )
    );
    const rows: CompanyInviteDoc[] = [];
    qs.forEach((doc) => {
      rows.push(parseInvite(doc.id, doc.data() as Record<string, unknown>));
    });
    return rows;
  } catch {
    return [];
  }
}
