/**
 * Trigger: `onDocumentUpdated` for every job under
 *   companies/{companyId}/customers/{customerId}/jobs/{jobId}
 *
 * Server-side validation + side effects for status changes:
 *
 * 1. Reject (by reverting) transitions that violate the allow-list matrix
 *    or any of the lifecycle content gates (quoted material, approved
 *    area, deposit recorded, paid in full). We cannot "refuse" the write
 *    like a security rule can, but we can restore the previous status +
 *    emit a warning log entry.
 * 2. On entering `active`, freeze `commissionSnapshot` + `pricingLocked`
 *    even if the deposit path wasn't used (defensive catch for admin
 *    manual transitions).
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";

type JobStatus =
  | "draft"
  | "quote"
  | "active"
  | "installed"
  | "complete"
  | "cancelled"
  | "comparing"
  | "selected"
  | "quoted"
  | "closed";

const LEGAL: Record<JobStatus, JobStatus[]> = {
  draft: ["quote", "cancelled"],
  quote: ["active", "draft", "cancelled"],
  active: ["installed", "cancelled"],
  installed: ["complete", "cancelled"],
  complete: [],
  // Cancelled jobs can be reopened back to draft (mirrors the client
  // allow-list in `JOB_STATUS_TRANSITIONS`). Reopening re-enters the
  // normal lifecycle gates rather than restoring whatever phase the
  // job was in pre-cancel, which keeps the deposit / paid-in-full
  // checks honest.
  cancelled: ["draft"],
  comparing: ["draft", "quote", "cancelled"],
  selected: ["draft", "quote", "cancelled"],
  quoted: ["quote", "active", "cancelled"],
  closed: ["complete"],
};

function normalize(status: string | undefined | null): JobStatus {
  switch (status) {
    case "comparing":
    case "selected":
      return "draft";
    case "quoted":
      return "quote";
    case "closed":
      return "complete";
    case "draft":
    case "quote":
    case "active":
    case "installed":
    case "complete":
    case "cancelled":
      return status;
    default:
      return "draft";
  }
}

interface AreaLite {
  id?: string;
  selectedOptionId?: string | null;
}

interface OptionLite {
  layoutPreviewImageUrl?: string | null;
  layoutStudioPlacement?: unknown;
  layoutAreaStates?: Record<
    string,
    {
      layoutPreviewImageUrl?: string | null;
      layoutStudioPlacement?: unknown;
    } | null
  > | null;
}

function optionIsQuoted(option: OptionLite, areaIds: string[]): boolean {
  if (option.layoutAreaStates) {
    for (const id of areaIds) {
      const state = option.layoutAreaStates[id];
      if (state?.layoutPreviewImageUrl || state?.layoutStudioPlacement) {
        return true;
      }
    }
    if (areaIds.length === 0) {
      for (const state of Object.values(option.layoutAreaStates)) {
        if (state?.layoutPreviewImageUrl || state?.layoutStudioPlacement) {
          return true;
        }
      }
    }
  }
  if (
    areaIds.length <= 1 &&
    (option.layoutPreviewImageUrl || option.layoutStudioPlacement)
  ) {
    return true;
  }
  return false;
}

async function loadJobOptions(
  db: FirebaseFirestore.Firestore,
  companyId: string,
  customerId: string,
  jobId: string
): Promise<OptionLite[]> {
  const snap = await db
    .collection(
      `companies/${companyId}/customers/${customerId}/jobs/${jobId}/options`
    )
    .get();
  return snap.docs.map((d) => d.data() as OptionLite);
}

export const onJobStatusTransition = onDocumentUpdated(
  {
    region: "us-central1",
    document: "companies/{companyId}/customers/{customerId}/jobs/{jobId}",
  },
  async (event) => {
    const before = event.data?.before?.data() ?? {};
    const after = event.data?.after?.data() ?? {};
    const prev = normalize(before.status as string);
    const next = normalize(after.status as string);
    if (prev === next) return;

    const { companyId, customerId, jobId } = event.params as {
      companyId: string;
      customerId: string;
      jobId: string;
    };

    /**
     * Admin escape hatch for data-repair scripts. The
     * `repairJobLifecycleStatuses.mjs` cleanup tool writes
     * `statusChangedByUserId: "lifecycle-repair"` so it can demote stale
     * `complete`/`installed` jobs back to a stage their data actually
     * supports. Without this bypass the cleanup write would be reverted
     * immediately by the gates below. Intentionally narrow: any other
     * actor still runs through the full validation matrix.
     */
    if (after.statusChangedByUserId === "lifecycle-repair") {
      logger.info("onJobStatusTransition: lifecycle-repair bypass", {
        companyId,
        jobId,
        prev,
        next,
      });
      return;
    }

    const db = getFirestore();
    const jobRef = db.doc(
      `companies/${companyId}/customers/${customerId}/jobs/${jobId}`
    );

    async function revert(reason: string, extra: Record<string, unknown> = {}) {
      logger.warn(`onJobStatusTransition: ${reason}, reverting`, {
        companyId,
        jobId,
        prev,
        next,
        ...extra,
      });
      await jobRef.update({
        status: prev,
        statusChangedAt: FieldValue.serverTimestamp(),
        // Stored as an ISO string to match every client-side writer; the
        // client sorts jobs with `String#localeCompare(updatedAt)` and
        // throws on raw Firestore Timestamps.
        updatedAt: new Date().toISOString(),
      });
    }

    if (!LEGAL[prev].includes(next)) {
      await revert("illegal transition");
      return;
    }

    /**
     * Lifecycle content gates — mirrored from the client helpers in
     * src/types/compareQuote.ts. Keep these in lock-step with that
     * file so the UI's "this is why the button is disabled" reason
     * matches whatever the server enforces.
     */
    const areas: AreaLite[] = Array.isArray(after.areas)
      ? (after.areas as AreaLite[])
      : [];
    const areaIds = areas
      .map((a) => (typeof a.id === "string" ? a.id : null))
      .filter((id): id is string => Boolean(id));
    const hasApprovedArea = areas.some((a) => Boolean(a.selectedOptionId));

    if (next === "quote") {
      const options = await loadJobOptions(db, companyId, customerId, jobId);
      const anyQuoted = options.some((o) => optionIsQuoted(o, areaIds));
      if (!anyQuoted) {
        await revert("→ quote blocked, no quoted material");
        return;
      }
    }

    if (next === "active") {
      if (!hasApprovedArea) {
        await revert("→ active blocked, no approved area");
        return;
      }
      const required =
        typeof after.requiredDepositAmount === "number" &&
        Number.isFinite(after.requiredDepositAmount as number)
          ? (after.requiredDepositAmount as number)
          : 0;
      const received =
        typeof after.depositReceivedTotal === "number" &&
        Number.isFinite(after.depositReceivedTotal as number)
          ? (after.depositReceivedTotal as number)
          : 0;
      const satisfied =
        required > 0 ? received >= required : received > 0;
      if (!satisfied) {
        await revert("→ active blocked, deposit unmet", {
          required,
          received,
        });
        return;
      }
    }

    if (next === "complete" && prev === "installed") {
      const quoted =
        typeof after.quotedTotal === "number" &&
        Number.isFinite(after.quotedTotal as number) &&
        (after.quotedTotal as number) > 0
          ? (after.quotedTotal as number)
          : 0;
      const paid =
        typeof after.paidTotal === "number" &&
        Number.isFinite(after.paidTotal as number)
          ? (after.paidTotal as number)
          : 0;
      const paidInFull = quoted > 0 && paid >= quoted - 0.005;
      if (!paidInFull) {
        await revert("→ complete blocked, balance not paid in full", {
          quoted,
          paid,
        });
        return;
      }
    }

    // On entering `active`, make sure pricing is locked and a commission
    // snapshot exists even if the admin hand-flipped the status without
    // recording a payment first.
    if (next === "active" && !after.pricingLocked) {
      const patch: Record<string, unknown> = {
        pricingLocked: true,
        pricingLockedAt: FieldValue.serverTimestamp(),
        // ISO string — see comment in `revert()` above.
        updatedAt: new Date().toISOString(),
      };
      if (!after.commissionSnapshot && after.assignedUserId) {
        const memberSnap = await db
          .doc(
            `companies/${companyId}/members/${String(after.assignedUserId)}`
          )
          .get();
        const m = memberSnap.data() ?? {};
        const percent =
          typeof m.commissionPercent === "number" ? m.commissionPercent : 0;
        if (percent > 0) {
          patch.commissionSnapshot = {
            userId: String(after.assignedUserId),
            displayName: String(m.displayName ?? m.email ?? ""),
            percent,
            split:
              (m.commissionSplit as {
                onDeposit: number;
                onFinalPayment: number;
              }) ?? { onDeposit: 0.5, onFinalPayment: 0.5 },
            basis: "gross",
            snapshottedAt: new Date().toISOString(),
          };
        }
      }
      await db
        .doc(`companies/${companyId}/customers/${customerId}/jobs/${jobId}`)
        .update(patch);
    }
  }
);
