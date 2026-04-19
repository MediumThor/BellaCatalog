#!/usr/bin/env node
/**
 * scripts/repairJobLifecycleStatuses.mjs
 *
 * Backfills job statuses so they conform to the strict lifecycle gates
 * introduced alongside the Cloud Function `onJobStatusTransition`
 * tightening:
 *
 *   draft   → no quoted material yet
 *   quote   → at least one option has a saved Layout Studio plan/preview
 *   active  → at least one area has `selectedOptionId`
 *             AND deposit threshold satisfied
 *   installed → manual-only (we never demote *into* installed)
 *   complete  → manual-only AND `paidTotal >= quotedTotal`
 *   cancelled → terminal, never touched
 *
 * For every non-cancelled job we compute the highest stage justified by
 * its data and demote the stored status if it's farther along than that.
 * `installed` jobs that already have payments-in-full stay where they
 * are (we never auto-promote, only demote stale states).
 *
 * Why: prior to the gate tightening it was possible for a job to be
 * tagged Complete with no quoted material, or Active without an
 * approved area + deposit. This script puts those misclassified jobs
 * back where they belong so the Jobs board, commission ledger, and
 * QuickBooks export all agree on lifecycle truth.
 *
 * Dry-run by default. Pass --apply to commit. Scope with --company=<id>
 * or --job=<companyId>/<customerId>/<jobId> to target a single record
 * (e.g. one rep's Gina Freitag job).
 *
 * USAGE:
 *   # dry run, all companies
 *   node scripts/repairJobLifecycleStatuses.mjs
 *
 *   # apply to one company
 *   node scripts/repairJobLifecycleStatuses.mjs --apply --company=abc123
 *
 *   # repair a single job
 *   node scripts/repairJobLifecycleStatuses.mjs --apply \
 *     --job=abc123/cust456/job789
 *
 * CREDENTIALS: same env vars as setInternalDev.mjs
 * (GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT).
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function nowIso() {
  return new Date().toISOString();
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

/**
 * Lifecycle stages in order. The "true" status of a job is the highest
 * stage justified by the data. We never auto-promote to `installed` or
 * `complete` because both are documented as manual transitions; if the
 * stored status is one of those we leave it alone unless the data
 * actively contradicts it (e.g. `complete` with $0 paid).
 */
const STAGE_ORDER = ["draft", "quote", "active", "installed", "complete"];

function parseArgs(argv) {
  const out = { apply: false, company: null, job: null };
  for (const raw of argv.slice(2)) {
    if (raw === "--apply") out.apply = true;
    else if (raw.startsWith("--company=")) out.company = raw.slice("--company=".length);
    else if (raw.startsWith("--job=")) out.job = raw.slice("--job=".length);
    else if (raw === "--help" || raw === "-h") {
      console.log(
        "See header comment in scripts/repairJobLifecycleStatuses.mjs for usage."
      );
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

function optionIsQuoted(option, areaIds) {
  const states = option.layoutAreaStates;
  if (states && typeof states === "object") {
    if (areaIds.length > 0) {
      for (const id of areaIds) {
        const s = states[id];
        if (s?.layoutPreviewImageUrl || s?.layoutStudioPlacement) return true;
      }
    } else {
      for (const s of Object.values(states)) {
        if (s?.layoutPreviewImageUrl || s?.layoutStudioPlacement) return true;
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

async function loadJobOptions(jobRef) {
  const snap = await jobRef.collection("options").get();
  return snap.docs.map((d) => d.data() ?? {});
}

/**
 * Returns the highest *automatically inferable* stage for the job. We
 * cap at `active` because Installed and Complete are manual-only — the
 * caller decides whether to keep a stored Installed/Complete based on
 * whether the data still supports it.
 */
function inferAutoStage(job, options) {
  const areas = Array.isArray(job.areas) ? job.areas : [];
  const areaIds = areas
    .map((a) => (typeof a?.id === "string" ? a.id : null))
    .filter(Boolean);
  const hasQuotedMaterial = options.some((o) => optionIsQuoted(o, areaIds));
  const hasApprovedArea = areas.some((a) => Boolean(a?.selectedOptionId));
  const requiredDeposit =
    typeof job.requiredDepositAmount === "number" &&
    Number.isFinite(job.requiredDepositAmount)
      ? job.requiredDepositAmount
      : 0;
  const depositReceived =
    typeof job.depositReceivedTotal === "number" &&
    Number.isFinite(job.depositReceivedTotal)
      ? job.depositReceivedTotal
      : 0;
  const depositSatisfied =
    requiredDeposit > 0
      ? depositReceived >= requiredDeposit
      : depositReceived > 0;

  if (hasApprovedArea && depositSatisfied) return "active";
  if (hasQuotedMaterial) return "quote";
  return "draft";
}

function isPaidInFull(job) {
  const quoted =
    typeof job.quotedTotal === "number" &&
    Number.isFinite(job.quotedTotal) &&
    job.quotedTotal > 0
      ? job.quotedTotal
      : 0;
  if (quoted <= 0) return false;
  const paid =
    typeof job.paidTotal === "number" && Number.isFinite(job.paidTotal)
      ? job.paidTotal
      : 0;
  return paid >= quoted - 0.005;
}

function chooseRepairTarget(currentCanonical, job, options) {
  const auto = inferAutoStage(job, options);
  const autoIndex = STAGE_ORDER.indexOf(auto);
  const currentIndex = STAGE_ORDER.indexOf(currentCanonical);

  // Cancelled is terminal — never rewrite.
  if (currentCanonical === "cancelled") return null;

  // Manual-only stages: keep them if the data still supports them,
  // otherwise demote to the highest auto-inferable stage.
  if (currentCanonical === "complete") {
    if (isPaidInFull(job)) return null;
    return auto;
  }
  if (currentCanonical === "installed") {
    // Installed requires that the job at least made it to Active.
    if (autoIndex >= STAGE_ORDER.indexOf("active")) return null;
    return auto;
  }

  // Auto stages: snap to whatever the data supports.
  if (currentIndex !== autoIndex) return auto;
  return null;
}

async function listJobs(db, opts) {
  if (opts.job) {
    const parts = opts.job.split("/").filter(Boolean);
    if (parts.length !== 3) {
      throw new Error("--job must be <companyId>/<customerId>/<jobId>");
    }
    const [c, cu, j] = parts;
    const ref = db.doc(`companies/${c}/customers/${cu}/jobs/${j}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new Error(`Job not found: ${opts.job}`);
    }
    return [snap];
  }
  const q = opts.company
    ? db.collectionGroup("jobs").where("companyId", "==", opts.company)
    : db.collectionGroup("jobs");
  const snap = await q.get();
  return snap.docs;
}

async function main() {
  const opts = parseArgs(process.argv);
  initAdmin();
  const db = getFirestore();

  const jobDocs = await listJobs(db, opts);
  console.log(
    `Scanning ${jobDocs.length} job docs${opts.company ? ` in company ${opts.company}` : ""}${opts.job ? ` (single job)` : ""}.`
  );

  let demotions = 0;
  let alreadyClean = 0;
  let skippedLegacy = 0;
  let skippedCancelled = 0;
  const summary = [];

  for (const jobSnap of jobDocs) {
    const job = jobSnap.data() ?? {};
    if (typeof job.companyId !== "string" || job.companyId.length === 0) {
      skippedLegacy += 1;
      continue;
    }
    const currentCanonical = normalizeStatus(job.status);
    if (currentCanonical === "cancelled") {
      skippedCancelled += 1;
      continue;
    }
    const options = await loadJobOptions(jobSnap.ref);
    const target = chooseRepairTarget(currentCanonical, job, options);
    if (!target || target === currentCanonical) {
      alreadyClean += 1;
      continue;
    }

    demotions += 1;
    summary.push({
      path: jobSnap.ref.path,
      from: currentCanonical,
      to: target,
      quotedTotal: job.quotedTotal ?? null,
      paidTotal: job.paidTotal ?? 0,
      depositReceived: job.depositReceivedTotal ?? 0,
      requiredDeposit: job.requiredDepositAmount ?? 0,
    });
    console.log(
      `  [demote] ${jobSnap.ref.path}: ${currentCanonical} → ${target}` +
        (opts.apply ? "" : " (dry-run)")
    );

    if (opts.apply) {
      // `statusChangedByUserId: "lifecycle-repair"` is the documented
      // bypass marker honored by the `onJobStatusTransition` Cloud
      // Function — without it the trigger would immediately revert
      // demotions out of `complete`/`installed` (those rows have an
      // empty allow-list by design).
      await jobSnap.ref.set(
        {
          status: target,
          statusChangedAt: nowIso(),
          statusChangedByUserId: "lifecycle-repair",
          updatedAt: nowIso(),
        },
        { merge: true }
      );
    }
  }

  console.log(
    `\nSummary: ${demotions} demotions, ${alreadyClean} already-clean, ${skippedLegacy} legacy top-level jobs skipped, ${skippedCancelled} cancelled jobs skipped.`
  );
  if (summary.length > 0) {
    console.log("\nDemoted jobs:");
    for (const row of summary) {
      console.log(
        `  ${row.path}\n    ${row.from} → ${row.to}` +
          ` | quoted=${row.quotedTotal ?? "—"} paid=${row.paidTotal} deposit=${row.depositReceived}/${row.requiredDeposit}`
      );
    }
  }
  if (!opts.apply) {
    console.log("\nDry run — re-run with --apply to commit.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
