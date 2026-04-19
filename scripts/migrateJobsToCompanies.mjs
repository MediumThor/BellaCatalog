#!/usr/bin/env node
/**
 * scripts/migrateJobsToCompanies.mjs
 *
 * One-way migration that moves legacy, top-level Compare / Quote data
 *
 *   /customers/{customerId}
 *   /jobs/{jobId}
 *   /jobComparisonOptions/{optionId}
 *
 * into the new multi-tenant layout:
 *
 *   /companies/{companyId}/customers/{customerId}
 *   /companies/{companyId}/customers/{customerId}/jobs/{jobId}
 *   /companies/{companyId}/customers/{customerId}/jobs/{jobId}/options/{optionId}
 *
 * Behavior:
 *   - Idempotent: docs already present at their new path are left alone
 *     unless --force is passed. Running the script twice will not
 *     duplicate data.
 *   - Dry-run by default: prints everything it _would_ do. Pass --apply
 *     to perform the writes.
 *   - Source docs are NOT deleted. Legacy top-level collections remain
 *     intact so they can be inspected / snapshot-backed before cleanup.
 *   - Each destination document preserves the original legacy id.
 *   - Denormalized `companyId`, `customerId`, `jobId` fields are added
 *     / corrected on write so the new Firestore rules and collection
 *     group queries (`findJobById`) work.
 *
 * USAGE:
 *   # dry run — no writes
 *   node scripts/migrateJobsToCompanies.mjs
 *
 *   # actually write
 *   node scripts/migrateJobsToCompanies.mjs --apply
 *
 *   # overwrite existing destination docs
 *   node scripts/migrateJobsToCompanies.mjs --apply --force
 *
 *   # only migrate docs belonging to a specific company
 *   node scripts/migrateJobsToCompanies.mjs --apply --company=<companyId>
 *
 * CREDENTIALS: same as setInternalDev.mjs (service account JSON via
 * GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT).
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function parseArgs(argv) {
  const args = { apply: false, force: false, company: null };
  for (const raw of argv.slice(2)) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--force") args.force = true;
    else if (raw.startsWith("--company=")) args.company = raw.slice("--company=".length);
    else if (raw === "--help" || raw === "-h") {
      console.log("See comment header in scripts/migrateJobsToCompanies.mjs for usage.");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${raw}`);
      process.exit(1);
    }
  }
  return args;
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
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
    return;
  }
  console.error(
    "Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service " +
      "account JSON path, or FIREBASE_SERVICE_ACCOUNT to its contents."
  );
  process.exit(1);
}

const COMPANY_CACHE_BY_USER = new Map();

async function resolveCompanyForUser(db, userId) {
  if (!userId) return null;
  if (COMPANY_CACHE_BY_USER.has(userId)) return COMPANY_CACHE_BY_USER.get(userId);

  const userSnap = await db.doc(`users/${userId}`).get();
  let companyId = userSnap.exists ? (userSnap.data()?.defaultCompanyId || null) : null;

  if (!companyId) {
    const memberships = await db
      .collectionGroup("members")
      .where("userId", "==", userId)
      .limit(1)
      .get();
    if (!memberships.empty) {
      companyId = memberships.docs[0].ref.parent.parent?.id ?? null;
    }
  }

  COMPANY_CACHE_BY_USER.set(userId, companyId);
  return companyId;
}

function pickCompanyId(data) {
  const c = data?.companyId;
  if (typeof c === "string" && c.trim().length > 0) return c.trim();
  return null;
}

function authorMeta(data) {
  const createdByUserId =
    data?.createdByUserId || data?.ownerUserId || data?.uploadedByUserId || null;
  return {
    createdByUserId: createdByUserId ?? null,
    ownerUserId: data?.ownerUserId ?? createdByUserId ?? null,
    createdByDisplayName: data?.createdByDisplayName ?? null,
  };
}

async function migrateCustomers(db, args, report) {
  const snap = await db.collection("customers").get();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    let companyId = pickCompanyId(data);
    if (!companyId) {
      companyId = await resolveCompanyForUser(db, data.ownerUserId);
    }
    if (args.company && companyId !== args.company) continue;

    if (!companyId) {
      report.customers.skipped.push({ id: doc.id, reason: "no companyId resolved" });
      continue;
    }

    const destRef = db.doc(`companies/${companyId}/customers/${doc.id}`);
    const existing = await destRef.get();
    if (existing.exists && !args.force) {
      report.customers.alreadyMigrated.push({ id: doc.id, companyId });
      continue;
    }

    const meta = authorMeta(data);
    const payload = {
      ...data,
      companyId,
      ownerUserId: meta.ownerUserId,
      createdByUserId: meta.createdByUserId,
      createdByDisplayName: meta.createdByDisplayName,
      visibility: data.visibility ?? "company",
      version: typeof data.version === "number" && data.version > 0 ? data.version : 1,
      migratedAt: FieldValue.serverTimestamp(),
      migrationSource: "legacy/customers",
    };

    if (args.apply) {
      await destRef.set(payload, { merge: false });
    }
    report.customers.migrated.push({ id: doc.id, companyId });
  }
}

async function resolveCustomerCompany(db, customerId) {
  const legacy = await db.doc(`customers/${customerId}`).get();
  if (legacy.exists) {
    const cid = pickCompanyId(legacy.data() || {});
    if (cid) return cid;
    const owner = legacy.data()?.ownerUserId;
    const resolved = await resolveCompanyForUser(db, owner);
    if (resolved) return resolved;
  }
  const group = await db
    .collectionGroup("customers")
    .where("__name__", "==", customerId)
    .limit(1)
    .get();
  if (!group.empty) {
    const parent = group.docs[0].ref.parent.parent;
    if (parent) return parent.id;
  }
  return null;
}

async function migrateJobs(db, args, report) {
  const snap = await db.collection("jobs").get();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const customerId = typeof data.customerId === "string" ? data.customerId : null;
    if (!customerId) {
      report.jobs.skipped.push({ id: doc.id, reason: "no customerId" });
      continue;
    }
    let companyId = pickCompanyId(data);
    if (!companyId) companyId = await resolveCustomerCompany(db, customerId);
    if (!companyId) companyId = await resolveCompanyForUser(db, data.ownerUserId);
    if (args.company && companyId !== args.company) continue;

    if (!companyId) {
      report.jobs.skipped.push({ id: doc.id, reason: "no companyId resolved" });
      continue;
    }

    const destRef = db.doc(
      `companies/${companyId}/customers/${customerId}/jobs/${doc.id}`
    );
    const existing = await destRef.get();
    if (existing.exists && !args.force) {
      report.jobs.alreadyMigrated.push({ id: doc.id, companyId, customerId });
      continue;
    }

    const meta = authorMeta(data);
    const payload = {
      ...data,
      companyId,
      customerId,
      ownerUserId: meta.ownerUserId,
      createdByUserId: meta.createdByUserId,
      createdByDisplayName: meta.createdByDisplayName,
      visibility: data.visibility ?? "company",
      version: typeof data.version === "number" && data.version > 0 ? data.version : 1,
      migratedAt: FieldValue.serverTimestamp(),
      migrationSource: "legacy/jobs",
    };
    if (args.apply) {
      await destRef.set(payload, { merge: false });
    }
    report.jobs.migrated.push({ id: doc.id, companyId, customerId });
  }
}

async function resolveJobPath(db, jobId) {
  const legacy = await db.doc(`jobs/${jobId}`).get();
  if (legacy.exists) {
    const data = legacy.data() || {};
    const customerId = typeof data.customerId === "string" ? data.customerId : null;
    let companyId = pickCompanyId(data);
    if (!companyId && customerId) companyId = await resolveCustomerCompany(db, customerId);
    if (!companyId) companyId = await resolveCompanyForUser(db, data.ownerUserId);
    if (customerId && companyId) return { companyId, customerId };
  }
  const group = await db
    .collectionGroup("jobs")
    .where("__name__", "==", jobId)
    .limit(1)
    .get();
  if (!group.empty) {
    const ref = group.docs[0].ref;
    const customer = ref.parent.parent;
    const company = customer?.parent?.parent;
    if (customer && company) {
      return { companyId: company.id, customerId: customer.id };
    }
  }
  return null;
}

async function migrateOptions(db, args, report) {
  const snap = await db.collection("jobComparisonOptions").get();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const jobId = typeof data.jobId === "string" ? data.jobId : null;
    if (!jobId) {
      report.options.skipped.push({ id: doc.id, reason: "no jobId" });
      continue;
    }
    const path = await resolveJobPath(db, jobId);
    if (!path) {
      report.options.skipped.push({ id: doc.id, reason: `no job path for ${jobId}` });
      continue;
    }
    const { companyId, customerId } = path;
    if (args.company && companyId !== args.company) continue;

    const destRef = db.doc(
      `companies/${companyId}/customers/${customerId}/jobs/${jobId}/options/${doc.id}`
    );
    const existing = await destRef.get();
    if (existing.exists && !args.force) {
      report.options.alreadyMigrated.push({ id: doc.id, companyId, customerId, jobId });
      continue;
    }

    const meta = authorMeta(data);
    const payload = {
      ...data,
      companyId,
      customerId,
      jobId,
      ownerUserId: meta.ownerUserId,
      createdByUserId: meta.createdByUserId,
      createdByDisplayName: meta.createdByDisplayName,
      visibility: data.visibility ?? "company",
      version: typeof data.version === "number" && data.version > 0 ? data.version : 1,
      migratedAt: FieldValue.serverTimestamp(),
      migrationSource: "legacy/jobComparisonOptions",
    };
    if (args.apply) {
      await destRef.set(payload, { merge: false });
    }
    report.options.migrated.push({ id: doc.id, companyId, customerId, jobId });
  }
}

function summarize(report) {
  const lines = [];
  for (const name of ["customers", "jobs", "options"]) {
    const r = report[name];
    lines.push(
      `  ${name.padEnd(10)}  migrated=${r.migrated.length}  alreadyMigrated=${r.alreadyMigrated.length}  skipped=${r.skipped.length}`
    );
    for (const s of r.skipped) {
      lines.push(`      [skip] ${s.id} — ${s.reason}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  initAdmin();
  const db = getFirestore();

  const report = {
    customers: { migrated: [], alreadyMigrated: [], skipped: [] },
    jobs: { migrated: [], alreadyMigrated: [], skipped: [] },
    options: { migrated: [], alreadyMigrated: [], skipped: [] },
  };

  console.log(
    `[migrate] apply=${args.apply} force=${args.force}` +
      (args.company ? ` company=${args.company}` : "")
  );
  console.log("[migrate] customers...");
  await migrateCustomers(db, args, report);
  console.log("[migrate] jobs...");
  await migrateJobs(db, args, report);
  console.log("[migrate] jobComparisonOptions...");
  await migrateOptions(db, args, report);

  console.log("\n[migrate] summary:");
  console.log(summarize(report));
  if (!args.apply) {
    console.log("\nDry run — pass --apply to actually write the docs above.");
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
