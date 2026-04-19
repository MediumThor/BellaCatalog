import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { firebaseDb } from "../firebase";
import type {
  CompanyDoc,
  CompanyMemberDoc,
  CompanyRole,
  UserDoc,
} from "./types";

/**
 * Thin Firestore helpers for the company + membership layer. These are
 * additive — they do not touch or modify existing top-level collections
 * (`customers`, `jobs`, `catalogCollections`, etc.).
 */

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function randomSuffix(length = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function parseCompany(id: string, raw: Record<string, unknown>): CompanyDoc {
  const billing = (raw.billing && typeof raw.billing === "object"
    ? (raw.billing as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const branding = (raw.branding && typeof raw.branding === "object"
    ? (raw.branding as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const settings = (raw.settings && typeof raw.settings === "object"
    ? (raw.settings as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const address = (raw.address && typeof raw.address === "object"
    ? (raw.address as Record<string, unknown>)
    : undefined) as CompanyDoc["address"] | undefined;
  const region = (raw.region && typeof raw.region === "object"
    ? (raw.region as Record<string, unknown>)
    : undefined) as CompanyDoc["region"] | undefined;

  const status = typeof billing.status === "string" ? billing.status : "none";

  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "",
    legalName: typeof raw.legalName === "string" ? raw.legalName : undefined,
    slug: typeof raw.slug === "string" ? raw.slug : id,
    branding: {
      logoUrl: (branding.logoUrl as string | null | undefined) ?? null,
      primaryColor: (branding.primaryColor as string | null | undefined) ?? null,
      accentColor: (branding.accentColor as string | null | undefined) ?? null,
      quoteHeaderText:
        (branding.quoteHeaderText as string | null | undefined) ?? null,
      quoteFooterText:
        (branding.quoteFooterText as string | null | undefined) ?? null,
    },
    address,
    region,
    billing: {
      stripeCustomerId:
        (billing.stripeCustomerId as string | null | undefined) ?? null,
      stripeSubscriptionId:
        (billing.stripeSubscriptionId as string | null | undefined) ?? null,
      status: status as CompanyDoc["billing"]["status"],
      planId: (billing.planId as string | null | undefined) ?? null,
      seatLimit: typeof billing.seatLimit === "number" ? billing.seatLimit : 1,
      bonusSeats:
        typeof billing.bonusSeats === "number" ? billing.bonusSeats : 0,
      activeSeatCount:
        typeof billing.activeSeatCount === "number"
          ? billing.activeSeatCount
          : 1,
      trialEndsAt: (billing.trialEndsAt as Timestamp | null | undefined) ?? null,
      currentPeriodEnd:
        (billing.currentPeriodEnd as Timestamp | null | undefined) ?? null,
      cancelAtPeriodEnd: Boolean(billing.cancelAtPeriodEnd),
      adminNote:
        typeof billing.adminNote === "string"
          ? (billing.adminNote as string)
          : null,
    },
    settings: {
      defaultHidePrices: Boolean(settings.defaultHidePrices),
      allowCompanyCollections: settings.allowCompanyCollections !== false,
      allowUserUploadedImages: settings.allowUserUploadedImages !== false,
      requireImportReviewBeforePublish:
        settings.requireImportReviewBeforePublish !== false,
      defaultCommissionSplit:
        settings.defaultCommissionSplit &&
        typeof settings.defaultCommissionSplit === "object"
          ? (settings.defaultCommissionSplit as CompanyDoc["settings"]["defaultCommissionSplit"])
          : null,
      defaultRequiredDepositPercent:
        typeof settings.defaultRequiredDepositPercent === "number"
          ? (settings.defaultRequiredDepositPercent as number)
          : null,
      defaultLayoutQuoteSettings:
        settings.defaultLayoutQuoteSettings &&
        typeof settings.defaultLayoutQuoteSettings === "object"
          ? (settings.defaultLayoutQuoteSettings as CompanyDoc["settings"]["defaultLayoutQuoteSettings"])
          : null,
      commissionIncludesSalesTax:
        typeof settings.commissionIncludesSalesTax === "boolean"
          ? (settings.commissionIncludesSalesTax as boolean)
          : false,
    },
    createdByUserId:
      typeof raw.createdByUserId === "string" ? raw.createdByUserId : "",
    createdAt: (raw.createdAt as Timestamp | null | undefined) ?? null,
    updatedAt: (raw.updatedAt as Timestamp | null | undefined) ?? null,
  };
}

function parseMember(
  companyId: string,
  userId: string,
  raw: Record<string, unknown>
): CompanyMemberDoc {
  const role = (typeof raw.role === "string" ? raw.role : "viewer") as CompanyRole;
  return {
    userId,
    companyId,
    email: typeof raw.email === "string" ? raw.email : "",
    displayName: typeof raw.displayName === "string" ? raw.displayName : "",
    role,
    status: (typeof raw.status === "string" ? raw.status : "active") as
      CompanyMemberDoc["status"],
    seatStatus: (typeof raw.seatStatus === "string"
      ? raw.seatStatus
      : "active") as CompanyMemberDoc["seatStatus"],
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
    commissionPercent:
      typeof raw.commissionPercent === "number"
        ? (raw.commissionPercent as number)
        : null,
    commissionSplit:
      raw.commissionSplit && typeof raw.commissionSplit === "object"
        ? (raw.commissionSplit as CompanyMemberDoc["commissionSplit"])
        : null,
  };
}

export function subscribeUserDoc(
  userId: string,
  onData: (doc: UserDoc | null) => void,
  onError?: (e: Error) => void
): () => void {
  const ref = doc(firebaseDb, "users", userId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const raw = snap.data() as Record<string, unknown>;
      onData({
        id: userId,
        email: typeof raw.email === "string" ? raw.email : "",
        displayName:
          typeof raw.displayName === "string" ? raw.displayName : "",
        photoURL: (raw.photoURL as string | null | undefined) ?? null,
        defaultCompanyId:
          (raw.defaultCompanyId as string | null | undefined) ?? null,
        activeCompanyId:
          (raw.activeCompanyId as string | null | undefined) ?? null,
        createdAt: (raw.createdAt as Timestamp | null | undefined) ?? null,
        updatedAt: (raw.updatedAt as Timestamp | null | undefined) ?? null,
        lastLoginAt:
          (raw.lastLoginAt as Timestamp | null | undefined) ?? null,
      });
    },
    (e) => onError?.(e as Error)
  );
}

export function subscribeCompanyDoc(
  companyId: string,
  onData: (doc: CompanyDoc | null) => void,
  onError?: (e: Error) => void
): () => void {
  const ref = doc(firebaseDb, "companies", companyId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(parseCompany(companyId, snap.data() as Record<string, unknown>));
    },
    (e) => onError?.(e as Error)
  );
}

export function subscribeCompanyMember(
  companyId: string,
  userId: string,
  onData: (doc: CompanyMemberDoc | null) => void,
  onError?: (e: Error) => void
): () => void {
  const ref = doc(firebaseDb, "companies", companyId, "members", userId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(
        parseMember(companyId, userId, snap.data() as Record<string, unknown>)
      );
    },
    (e) => onError?.(e as Error)
  );
}

/**
 * Find all active companies that this user belongs to. Uses a collectionGroup
 * query across `members` subcollections filtered by `userId`. Requires an
 * index declared in `firestore.indexes.json` (see repo).
 */
export async function findMembershipsForUser(
  userId: string
): Promise<CompanyMemberDoc[]> {
  try {
    const q = query(
      collectionGroup(firebaseDb, "members"),
      where("userId", "==", userId)
    );
    const snap = await getDocs(q);
    const out: CompanyMemberDoc[] = [];
    snap.forEach((entry) => {
      const segments = entry.ref.path.split("/");
      const companyId = segments[1] ?? "";
      if (!companyId) return;
      out.push(
        parseMember(companyId, userId, entry.data() as Record<string, unknown>)
      );
    });
    return out;
  } catch {
    return [];
  }
}

export interface CreateCompanyInput {
  name: string;
  createdByUserId: string;
  ownerEmail: string;
  ownerDisplayName: string;
  region?: CompanyDoc["region"];
  address?: CompanyDoc["address"];
}

/**
 * Create a new company + owner membership + update the user's defaultCompanyId.
 * All writes are additive. Existing top-level user-owned data is untouched.
 */
export async function createCompanyWithOwner(
  input: CreateCompanyInput
): Promise<{ companyId: string }> {
  const baseSlug = slugify(input.name) || "company";
  const companyId = `${baseSlug}-${randomSuffix(6)}`;

  const companyRef = doc(firebaseDb, "companies", companyId);
  const memberRef = doc(
    firebaseDb,
    "companies",
    companyId,
    "members",
    input.createdByUserId
  );
  const userRef = doc(firebaseDb, "users", input.createdByUserId);

  const companyData: Record<string, unknown> = {
    id: companyId,
    name: input.name.trim(),
    slug: baseSlug,
    branding: {
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
      quoteHeaderText: null,
      quoteFooterText: null,
    },
    billing: {
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      status: "trialing",
      planId: null,
      seatLimit: 1,
      activeSeatCount: 1,
      trialEndsAt: null,
      currentPeriodEnd: null,
    },
    settings: {
      defaultHidePrices: false,
      allowCompanyCollections: true,
      allowUserUploadedImages: true,
      requireImportReviewBeforePublish: true,
    },
    createdByUserId: input.createdByUserId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.region) companyData.region = input.region;
  if (input.address) companyData.address = input.address;

  await setDoc(companyRef, companyData, { merge: false });

  await setDoc(
    memberRef,
    {
      userId: input.createdByUserId,
      companyId,
      email: input.ownerEmail,
      displayName: input.ownerDisplayName,
      role: "owner",
      status: "active",
      seatStatus: "active",
      consumesSeat: true,
      joinedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: false }
  );

  await setDoc(
    userRef,
    {
      email: input.ownerEmail,
      displayName: input.ownerDisplayName,
      defaultCompanyId: companyId,
      activeCompanyId: companyId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return { companyId };
}

export async function setUserActiveCompany(
  userId: string,
  companyId: string
): Promise<void> {
  await updateDoc(doc(firebaseDb, "users", userId), {
    activeCompanyId: companyId,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Read the first company member doc for a given user, if present. Used only
 * for non-subscribed lookups (onboarding bootstrapping).
 */
export async function getFirstMembershipSnapshot(
  userId: string
): Promise<CompanyMemberDoc | null> {
  const members = await findMembershipsForUser(userId);
  if (!members.length) return null;
  const active = members.find((m) => m.status === "active");
  return active ?? members[0];
}

export async function getCompanySnapshot(
  companyId: string
): Promise<CompanyDoc | null> {
  const snap = await getDoc(doc(firebaseDb, "companies", companyId));
  if (!snap.exists()) return null;
  return parseCompany(companyId, snap.data() as Record<string, unknown>);
}

// Re-export for callers that want raw collection refs.
export const companiesCol = () => collection(firebaseDb, "companies");
