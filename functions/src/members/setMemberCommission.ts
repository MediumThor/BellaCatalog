/**
 * Admin-only callable to set a teammate's commission percent and optional
 * split override. This is the ONLY path a `commissionPercent` value reaches
 * Firestore from — client rules make the `members/*` doc read-only for
 * normal UI writes, so every commission change flows through this function.
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import {
  assertAuth,
  assertCanManageUsers,
  bad,
  getMemberDoc,
} from "./helpers";

type Payload = {
  companyId: string;
  userId: string;
  /** 0..100. Pass null to mark non-commissionable. */
  commissionPercent: number | null;
  commissionSplit?: { onDeposit: number; onFinalPayment: number } | null;
};

export const setMemberCommission = onCall(
  { region: "us-central1" },
  async (req) => {
    const { uid: callerUid } = assertAuth(req);
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = (data.companyId ?? "").trim();
    const userId = (data.userId ?? "").trim();
    if (!companyId) bad("invalid-argument", "companyId is required.");
    if (!userId) bad("invalid-argument", "userId is required.");

    const pct =
      data.commissionPercent === null || data.commissionPercent === undefined
        ? null
        : Number(data.commissionPercent);
    if (pct !== null) {
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        bad("invalid-argument", "commissionPercent must be between 0 and 100.");
      }
    }

    let split: Payload["commissionSplit"] = null;
    if (data.commissionSplit) {
      const a = Number(data.commissionSplit.onDeposit);
      const b = Number(data.commissionSplit.onFinalPayment);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) {
        bad("invalid-argument", "commissionSplit values must be >= 0.");
      }
      const sum = a + b;
      if (sum <= 0) {
        bad("invalid-argument", "commissionSplit must sum to a positive value.");
      }
      split = { onDeposit: a / sum, onFinalPayment: b / sum };
    }

    await assertCanManageUsers(companyId, callerUid);
    const { exists } = await getMemberDoc(companyId, userId);
    if (!exists) bad("not-found", "Member not found.");

    await getFirestore()
      .doc(`companies/${companyId}/members/${userId}`)
      .set(
        {
          commissionPercent: pct,
          commissionSplit: split,
          commissionChangedAt: FieldValue.serverTimestamp(),
          commissionChangedByUserId: callerUid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    return { commissionPercent: pct, commissionSplit: split };
  }
);
