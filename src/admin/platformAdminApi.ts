import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "../firebase";
import type { CompanyBillingStatus } from "../company/types";

/**
 * Callable wrappers for the `functions/src/admin/*` family. Every call
 * requires the signed-in user to have a `platformAdmins/{uid}` doc.
 */

export interface AdminCompanyRow {
  id: string;
  name: string;
  slug: string;
  status: CompanyBillingStatus | string;
  seatLimit: number;
  bonusSeats: number;
  activeSeatCount: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt?: unknown;
}

const listCompaniesCallable = httpsCallable<
  Record<string, never>,
  { companies: AdminCompanyRow[] }
>(firebaseFunctions, "adminListCompanies");

export async function adminListCompanies(): Promise<AdminCompanyRow[]> {
  const res = await listCompaniesCallable({});
  return res.data.companies;
}

export type AdminSetCompanyBillingPayload = {
  companyId: string;
  /**
   * Accepts any string so the admin UI can freely pass one of the
   * `BILLING_STATUSES` options. The Cloud Function validates this against
   * the allowed set and rejects unknown values.
   */
  status?: CompanyBillingStatus | string;
  bonusSeats?: number;
  note?: string | null;
  reason?: string;
};

const setCompanyBillingCallable = httpsCallable<
  AdminSetCompanyBillingPayload,
  { ok: true }
>(firebaseFunctions, "adminSetCompanyBilling");

export async function adminSetCompanyBilling(
  payload: AdminSetCompanyBillingPayload
): Promise<void> {
  await setCompanyBillingCallable(payload);
}

export type AdminSetMemberSeatStatusPayload = {
  companyId: string;
  userId: string;
  seatStatus: "active" | "exempt" | "pending" | "disabled";
  reason?: string;
};

const setMemberSeatStatusCallable = httpsCallable<
  AdminSetMemberSeatStatusPayload,
  { ok: true; activeSeatCount: number }
>(firebaseFunctions, "adminSetMemberSeatStatus");

export async function adminSetMemberSeatStatus(
  payload: AdminSetMemberSeatStatusPayload
): Promise<number> {
  const res = await setMemberSeatStatusCallable(payload);
  return res.data.activeSeatCount;
}

export type AdminTransferOwnershipPayload = {
  companyId: string;
  newOwnerUserId: string;
  currentOwnerBehavior?: "demoteToAdmin" | "keepOwner";
  reason?: string;
};

const transferOwnershipCallable = httpsCallable<
  AdminTransferOwnershipPayload,
  { ok: true }
>(firebaseFunctions, "adminTransferOwnership");

export async function adminTransferOwnership(
  payload: AdminTransferOwnershipPayload
): Promise<void> {
  await transferOwnershipCallable(payload);
}

export type AdminForceCancelPayload = {
  companyId: string;
  atPeriodEnd?: boolean;
  reason?: string;
};

const forceCancelCallable = httpsCallable<
  AdminForceCancelPayload,
  { ok: true; atPeriodEnd: boolean }
>(firebaseFunctions, "adminForceCancelSubscription");

export async function adminForceCancelSubscription(
  payload: AdminForceCancelPayload
): Promise<void> {
  await forceCancelCallable(payload);
}

export type AdminResumePayload = {
  companyId: string;
  reason?: string;
};

const resumeCallable = httpsCallable<AdminResumePayload, { ok: true }>(
  firebaseFunctions,
  "adminResumeSubscription"
);

export async function adminResumeSubscription(
  payload: AdminResumePayload
): Promise<void> {
  await resumeCallable(payload);
}
