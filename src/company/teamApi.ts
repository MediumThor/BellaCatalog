import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "../firebase";
import type { CompanyMembershipStatus, CompanyRole } from "./types";

/**
 * Thin callable wrappers for the `functions/src/members/*` family. All
 * authorization + seat accounting + Stripe sync happens in the backend —
 * the client just passes arguments and surfaces errors.
 */

export type InviteMemberPayload = {
  companyId: string;
  email: string;
  role?: CompanyRole;
  displayName?: string;
};

export type InviteMemberResult = {
  inviteId: string;
  token: string;
  email: string;
  role: CompanyRole;
  pendingAuthUser: boolean;
};

export type RevokeInvitePayload = {
  companyId: string;
  inviteId: string;
};

export type AcceptInvitePayload =
  | { inviteId: string; token?: string }
  | { companyId: string; token: string }
  | { token: string };

export type AcceptInviteResult = {
  companyId: string;
  role: CompanyRole;
  activeSeatCount: number;
  seatLimit: number;
};

export type SetMemberStatusPayload = {
  companyId: string;
  userId: string;
  status: Extract<CompanyMembershipStatus, "active" | "disabled" | "removed">;
  reason?: string;
};

export type SetMemberStatusResult = {
  status: SetMemberStatusPayload["status"];
  activeSeatCount: number;
  seatLimit: number;
};

export type UpdateMemberRolePayload = {
  companyId: string;
  userId: string;
  role: CompanyRole;
};

export type SetMemberCommissionPayload = {
  companyId: string;
  userId: string;
  /** 0..100. `null` = non-commissionable. */
  commissionPercent: number | null;
  commissionSplit?: { onDeposit: number; onFinalPayment: number } | null;
};

export type SetMemberCommissionResult = {
  commissionPercent: number | null;
  commissionSplit: SetMemberCommissionPayload["commissionSplit"];
};

const inviteMemberCallable = httpsCallable<
  InviteMemberPayload,
  InviteMemberResult
>(firebaseFunctions, "inviteMember");

const revokeInviteCallable = httpsCallable<
  RevokeInvitePayload,
  { ok: true; alreadyGone?: boolean }
>(firebaseFunctions, "revokeInvite");

const acceptInviteCallable = httpsCallable<
  AcceptInvitePayload,
  AcceptInviteResult
>(firebaseFunctions, "acceptInvite");

const setMemberStatusCallable = httpsCallable<
  SetMemberStatusPayload,
  SetMemberStatusResult
>(firebaseFunctions, "setMemberStatus");

const updateMemberRoleCallable = httpsCallable<
  UpdateMemberRolePayload,
  { role: CompanyRole }
>(firebaseFunctions, "updateMemberRole");

const setMemberCommissionCallable = httpsCallable<
  SetMemberCommissionPayload,
  SetMemberCommissionResult
>(firebaseFunctions, "setMemberCommission");

export async function inviteMember(
  payload: InviteMemberPayload
): Promise<InviteMemberResult> {
  const res = await inviteMemberCallable(payload);
  return res.data;
}

export async function revokeInvite(payload: RevokeInvitePayload): Promise<void> {
  await revokeInviteCallable(payload);
}

export async function acceptInvite(
  payload: AcceptInvitePayload
): Promise<AcceptInviteResult> {
  const res = await acceptInviteCallable(payload);
  return res.data;
}

export async function setMemberStatus(
  payload: SetMemberStatusPayload
): Promise<SetMemberStatusResult> {
  const res = await setMemberStatusCallable(payload);
  return res.data;
}

export async function updateMemberRole(
  payload: UpdateMemberRolePayload
): Promise<CompanyRole> {
  const res = await updateMemberRoleCallable(payload);
  return res.data.role;
}

export async function setMemberCommission(
  payload: SetMemberCommissionPayload
): Promise<SetMemberCommissionResult> {
  const res = await setMemberCommissionCallable(payload);
  return res.data;
}
