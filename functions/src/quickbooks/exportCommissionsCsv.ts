/**
 * Callable: `exportCommissionsCsv({ companyId, periodStart, periodEnd })`.
 *
 * Admin-only. Gathers all payments in the range via a collectionGroup
 * query, joins them with their parent customer/job, generates two CSVs
 * (`payments_<period>.csv`, `commissions_<period>.csv`), uploads them to
 * Cloud Storage, and returns a signed download URL. Also writes a
 * `companies/{companyId}/quickBooksExports/{exportId}` receipt.
 *
 * Phase 1 is CSV only. Phase 2 swaps the generation internals for the
 * QuickBooks Online REST API while keeping this callable's contract
 * identical (see `docs/commission-tracker-plan.md` §12).
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { assertAuth, bad, getMemberDoc } from "../members/helpers";

type Payload = {
  companyId: string;
  periodStart: string;
  periodEnd: string;
  includeExportedPayments?: boolean;
};

interface PaymentData {
  id: string;
  companyId: string;
  customerId: string;
  jobId: string;
  kind: string;
  amount: number;
  method: string;
  referenceNumber: string | null;
  receivedAt: string;
  notes: string;
  recordedByDisplayName: string | null;
  exportedToQuickBooks?: boolean;
}

interface LedgerEntry {
  id: string;
  userId: string;
  jobId: string;
  customerId: string;
  paymentId: string;
  kind: string;
  amount: number;
  jobTotalAtSnapshot: number;
  percent: number;
  paymentReceivedAt: string;
}

export const exportCommissionsCsv = onCall(
  { region: "us-central1" },
  async (req) => {
    const { uid } = assertAuth(req);
    const data = (req.data ?? {}) as Partial<Payload>;
    const companyId = (data.companyId ?? "").trim();
    const periodStart = (data.periodStart ?? "").trim();
    const periodEnd = (data.periodEnd ?? "").trim();
    const includeExported = Boolean(data.includeExportedPayments);

    if (!companyId) bad("invalid-argument", "companyId is required.");
    if (!periodStart || !periodEnd) {
      bad("invalid-argument", "periodStart and periodEnd are required.");
    }
    if (periodStart > periodEnd) {
      bad("invalid-argument", "periodStart must be <= periodEnd.");
    }

    const { exists, data: member } = await getMemberDoc(companyId, uid);
    if (!exists || !member) bad("permission-denied", "Not a member.");
    const role = member!.role as string;
    if (role !== "owner" && role !== "admin") {
      bad("permission-denied", "Only owners/admins can export.");
    }

    const db = getFirestore();

    // Collect payments in range
    let payQuery = db
      .collectionGroup("payments")
      .where("companyId", "==", companyId)
      .where("receivedAt", ">=", periodStart)
      .where("receivedAt", "<=", periodEnd);
    if (!includeExported) {
      payQuery = payQuery.where("exportedToQuickBooks", "==", false);
    }
    const paySnap = await payQuery.get();
    const payments: PaymentData[] = paySnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<PaymentData, "id">),
    }));

    // Collect ledger entries in range (by paymentReceivedAt to match)
    const ledgerSnap = await db
      .collection(`companies/${companyId}/commissionLedger`)
      .where("paymentReceivedAt", ">=", periodStart)
      .where("paymentReceivedAt", "<=", periodEnd)
      .get();
    const ledger: LedgerEntry[] = ledgerSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<LedgerEntry, "id">),
    }));

    // Join for customer + job + rep names (batched reads)
    const custIds = Array.from(new Set(payments.map((p) => p.customerId)));
    const jobIds = Array.from(new Set(payments.map((p) => `${p.customerId}/${p.jobId}`)));
    const userIds = Array.from(new Set(ledger.map((l) => l.userId)));

    const [custDocs, jobDocs, userDocs] = await Promise.all([
      Promise.all(
        custIds.map((id) =>
          db.doc(`companies/${companyId}/customers/${id}`).get()
        )
      ),
      Promise.all(
        jobIds.map((pair) => {
          const [cid, jid] = pair.split("/");
          return db
            .doc(`companies/${companyId}/customers/${cid}/jobs/${jid}`)
            .get();
        })
      ),
      Promise.all(
        userIds.map((uid2) =>
          db.doc(`companies/${companyId}/members/${uid2}`).get()
        )
      ),
    ]);

    const custName: Record<string, string> = {};
    custDocs.forEach((s) => {
      const d = s.data() ?? {};
      custName[s.id] =
        (d.businessName as string) ||
        [d.firstName, d.lastName].filter(Boolean).join(" ") ||
        s.id;
    });
    const jobName: Record<string, string> = {};
    jobDocs.forEach((s) => {
      const d = s.data() ?? {};
      const key = `${d.customerId ?? ""}/${s.id}`;
      jobName[key] = (d.name as string) || s.id;
    });
    const repName: Record<string, string> = {};
    userDocs.forEach((s) => {
      const d = s.data() ?? {};
      repName[s.id] = (d.displayName as string) || (d.email as string) || s.id;
    });

    // Build CSVs
    const paymentsCsv = toCsv([
      [
        "Date",
        "Customer",
        "JobName",
        "InvoiceRef",
        "Kind",
        "Method",
        "Amount",
        "Reference#",
        "RecordedBy",
        "Notes",
      ],
      ...payments.map((p) => [
        p.receivedAt,
        custName[p.customerId] ?? p.customerId,
        jobName[`${p.customerId}/${p.jobId}`] ?? p.jobId,
        p.id,
        p.kind,
        p.method,
        String(p.amount),
        p.referenceNumber ?? "",
        p.recordedByDisplayName ?? "",
        p.notes ?? "",
      ]),
    ]);

    const commissionsCsv = toCsv([
      [
        "EarnedDate",
        "Rep",
        "Customer",
        "JobName",
        "PaymentId",
        "Portion",
        "JobTotal",
        "Rate%",
        "CommissionAmount",
      ],
      ...ledger.map((l) => [
        l.paymentReceivedAt,
        repName[l.userId] ?? l.userId,
        custName[l.customerId] ?? l.customerId,
        jobName[`${l.customerId}/${l.jobId}`] ?? l.jobId,
        l.paymentId,
        l.kind,
        String(l.jobTotalAtSnapshot),
        String(l.percent),
        String(l.amount),
      ]),
    ]);

    // Totals for receipt doc
    const totals = payments.reduce(
      (acc, p) => {
        if (p.kind === "deposit") acc.deposit += Number(p.amount) || 0;
        if (p.kind === "progress") acc.progress += Number(p.amount) || 0;
        if (p.kind === "final") acc.final += Number(p.amount) || 0;
        if (p.kind === "refund") acc.refund += Number(p.amount) || 0;
        return acc;
      },
      { deposit: 0, progress: 0, final: 0, refund: 0 }
    );
    const totalCommissionAmount = ledger.reduce(
      (a, l) => a + (Number(l.amount) || 0),
      0
    );

    // Upload to Storage
    const exportId = `${periodStart}_${periodEnd}_${Date.now().toString(36)}`;
    const bucket = getStorage().bucket();
    const paymentsFileName = `payments_${periodStart}_to_${periodEnd}.csv`;
    const commissionsFileName = `commissions_${periodStart}_to_${periodEnd}.csv`;
    const base = `quickbooksExports/${companyId}/${exportId}`;

    const paymentsObj = bucket.file(`${base}/${paymentsFileName}`);
    const commissionsObj = bucket.file(`${base}/${commissionsFileName}`);
    await Promise.all([
      paymentsObj.save(Buffer.from(paymentsCsv, "utf8"), {
        contentType: "text/csv",
      }),
      commissionsObj.save(Buffer.from(commissionsCsv, "utf8"), {
        contentType: "text/csv",
      }),
    ]);
    const [paymentsUrl] = await paymentsObj.getSignedUrl({
      action: "read",
      expires: Date.now() + 24 * 60 * 60 * 1000,
    });
    const [commissionsUrl] = await commissionsObj.getSignedUrl({
      action: "read",
      expires: Date.now() + 24 * 60 * 60 * 1000,
    });

    // Write receipt
    await db
      .doc(`companies/${companyId}/quickBooksExports/${exportId}`)
      .set({
        id: exportId,
        companyId,
        requestedByUserId: uid,
        requestedByDisplayName: (member!.displayName as string) ?? null,
        periodStart,
        periodEnd,
        paymentCount: payments.length,
        totalDepositAmount: totals.deposit,
        totalProgressAmount: totals.progress,
        totalFinalAmount: totals.final,
        totalRefundAmount: totals.refund,
        totalCommissionAmount,
        downloadUrl: commissionsUrl,
        paymentsDownloadUrl: paymentsUrl,
        paymentsFileName,
        commissionsFileName,
        createdAt: FieldValue.serverTimestamp(),
      });

    // Mark payments as exported so they don't double-roll next month
    if (!includeExported && payments.length > 0) {
      const batch = db.batch();
      for (const p of payments) {
        batch.update(
          db.doc(
            `companies/${companyId}/customers/${p.customerId}/jobs/${p.jobId}/payments/${p.id}`
          ),
          {
            exportedToQuickBooks: true,
            quickBooksExportId: exportId,
            updatedAt: FieldValue.serverTimestamp(),
          }
        );
      }
      await batch.commit();
    }

    logger.info("exportCommissionsCsv complete", {
      companyId,
      exportId,
      paymentCount: payments.length,
      totalCommissionAmount,
    });

    return {
      exportId,
      downloadUrl: commissionsUrl,
      paymentsDownloadUrl: paymentsUrl,
      paymentsFileName,
      commissionsFileName,
      paymentCount: payments.length,
      totalCommissionAmount,
    };
  }
);

/** Minimal RFC-4180 CSV escape (quote if contains comma/quote/newline). */
function toCsv(rows: Array<Array<string>>): string {
  return rows
    .map((row) => row.map(csvField).join(","))
    .join("\r\n");
}

function csvField(v: string): string {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
