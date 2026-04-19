#!/usr/bin/env node
/**
 * scripts/migrateJobsToCanonicalStatus.mjs
 *
 * Backfills job + area documents so they conform to the new commission
 * tracker data model:
 *
 *   1. Legacy job statuses ("comparing", "selected", "quoted", "closed")
 *      are mapped to canonical ones ("draft", "quote", "complete", ...).
 *   2. Seeds new fields with safe defaults so UI code that expects them
 *      doesn't have to null-check every read:
 *        - quotedTotal: null
 *        - requiredDepositAmount: null
 *        - requiredDepositPercent: null
 *        - depositReceivedTotal: 0
 *        - paidTotal: 0
 *        - balanceDue: null
 *        - assignedUserId: null (if missing)
 *        - commissionSnapshot: null
 *        - pricingLocked: false
 *   3. On each area doc, seeds `status` to match the parent job's
 *      normalized status so the kanban + stepper UIs render correctly.
 *
 * Dry-run by default. Pass --apply to commit. Scope with --company=<id>.
 *
 * USAGE:
 *   # dry run
 *   node scripts/migrateJobsToCanonicalStatus.mjs
 *
 *   # apply
 *   node scripts/migrateJobsToCanonicalStatus.mjs --apply
 *
 *   # scope to one company
 *   node scripts/migrateJobsToCanonicalStatus.mjs --apply --company=abc123
 *
 * CREDENTIALS: same env vars as setInternalDev.mjs
 * (GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT).
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// This codebase stores `createdAt` / `updatedAt` as ISO-8601 strings (see
// nowIso() in src/services/compareQuoteFirestore.ts). The migration must
// follow that contract — writing a Firestore Timestamp here would crash
// the Jobs overview page on `updatedAt.localeCompare(...)`.
function nowIso() {
  return new Date().toISOString();
}

function toIsoString(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

const LEGACY_TO_CANONICAL = {
  comparing: "draft",
  selected: "draft",
  quoted: "quote",
  closed: "complete",
};

const CANONICAL = new Set([
  "draft",
  "quote",
  "active",
  "installed",
  "complete",
  "cancelled",
]);

function parseArgs(argv) {
  const out = { apply: false, company: null };
  for (const raw of argv.slice(2)) {
    if (raw === "--apply") out.apply = true;
    else if (raw.startsWith("--company=")) out.company = raw.slice("--company=".length);
    else if (raw === "--help" || raw === "-h") {
      console.log("See header comment in scripts/migrateJobsToCanonicalStatus.mjs for usage.");
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${raw}`);
      process.exit(1);
    }
  }
  return out;
}

function initAdmin() {
  if (getApps().length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const parsed = JSON.parse(raw);
    initializeApp({
      credential: cert(parsed),
      projectId: process.env.FIREBASE_PROJECT_ID || parsed.project_id,
    });
    return;
  }
  // Falls through to Application Default Credentials, which works with both
  // GOOGLE_APPLICATION_CREDENTIALS=<path/to/sa.json> and
  // `gcloud auth application-default login`.
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new Error(
      "No project id found. Set FIREBASE_PROJECT_ID (or run `gcloud config set project <id>`)."
    );
  }
  initializeApp({ projectId });
}

function normalizeStatus(status) {
  if (typeof status !== "string") return "draft";
  if (CANONICAL.has(status)) return status;
  return LEGACY_TO_CANONICAL[status] ?? "draft";
}

async function listJobs(db, companyId) {
  const snap = companyId
    ? await db.collectionGroup("jobs").where("companyId", "==", companyId).get()
    : await db.collectionGroup("jobs").get();
  return snap.docs;
}

async function main() {
  const { apply, company } = parseArgs(process.argv);
  initAdmin();
  const db = getFirestore();

  const jobDocs = await listJobs(db, company);
  console.log(`Scanning ${jobDocs.length} job docs${company ? ` in company ${company}` : ""}.`);

  let statusUpdates = 0;
  let fieldSeeds = 0;
  let areaUpdates = 0;

  let skippedLegacy = 0;
  let timestampRepairs = 0;
  for (const jobSnap of jobDocs) {
    const job = jobSnap.data() ?? {};
    // Legacy top-level /jobs/{id} docs (pre multi-tenant migration) don't
    // carry a companyId and aren't read by the app. Skip them so we only
    // touch canonical /companies/.../jobs/... paths.
    if (typeof job.companyId !== "string" || job.companyId.length === 0) {
      skippedLegacy += 1;
      continue;
    }
    const currentStatus = typeof job.status === "string" ? job.status : "";
    const canonical = normalizeStatus(currentStatus);
    const patch = {};

    // Repair: an earlier run of this script wrote `updatedAt` as a
    // Firestore Timestamp instead of an ISO string, which broke
    // `updatedAt.localeCompare(...)` in the Jobs overview. Convert any
    // non-string `updatedAt` (or `createdAt`, `statusChangedAt`) back to
    // ISO so the UI works again.
    for (const key of ["createdAt", "updatedAt", "statusChangedAt"]) {
      if (key in job && typeof job[key] !== "string") {
        const iso = toIsoString(job[key]);
        if (iso) {
          patch[key] = iso;
          timestampRepairs += 1;
        }
      }
    }

    if (currentStatus !== canonical) {
      patch.status = canonical;
      statusUpdates += 1;
    }

    const seedIfMissing = (key, value) => {
      if (!(key in job)) {
        patch[key] = value;
        fieldSeeds += 1;
      }
    };

    seedIfMissing("quotedTotal", null);
    seedIfMissing("requiredDepositAmount", null);
    seedIfMissing("requiredDepositPercent", null);
    seedIfMissing("depositReceivedTotal", 0);
    seedIfMissing("paidTotal", 0);
    seedIfMissing("balanceDue", null);
    seedIfMissing("assignedUserId", null);
    seedIfMissing("commissionSnapshot", null);
    seedIfMissing("pricingLocked", false);

    if (Object.keys(patch).length > 0) {
      // Only stamp updatedAt if we don't already have a string value to
      // preserve (or if we're explicitly repairing it above).
      if (!("updatedAt" in patch)) patch.updatedAt = nowIso();
      console.log(
        `  [job] ${jobSnap.ref.path} → ${Object.keys(patch).join(", ")}${apply ? "" : " (dry-run)"}`
      );
      if (apply) {
        await jobSnap.ref.set(patch, { merge: true });
      }
    }

    const areasSnap = await jobSnap.ref.collection("areas").get();
    for (const areaSnap of areasSnap.docs) {
      const area = areaSnap.data() ?? {};
      if (typeof area.status === "string" && CANONICAL.has(area.status)) continue;
      const areaPatch = {
        status: canonical,
        updatedAt: nowIso(),
      };
      areaUpdates += 1;
      console.log(
        `    [area] ${areaSnap.ref.path} → status=${canonical}${apply ? "" : " (dry-run)"}`
      );
      if (apply) {
        await areaSnap.ref.set(areaPatch, { merge: true });
      }
    }
  }

  console.log(
    `\nSummary: ${statusUpdates} status rewrites, ${fieldSeeds} field seeds, ${timestampRepairs} timestamp repairs, ${areaUpdates} area seeds, ${skippedLegacy} legacy top-level jobs skipped.`
  );
  if (!apply) {
    console.log("Dry run — re-run with --apply to commit.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
