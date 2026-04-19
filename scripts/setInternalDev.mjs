#!/usr/bin/env node
/**
 * scripts/setInternalDev.mjs
 *
 * One-off admin script that flips one or more companies to
 * `billing.status = "internal_dev"` so BellaCatalog staff / pre-paid-launch
 * tenants bypass the paywall.
 *
 * USAGE:
 *   node scripts/setInternalDev.mjs <companyId> [<companyId> ...]
 *
 * REQUIREMENTS:
 *   1. Install firebase-admin once:
 *        npm install --no-save firebase-admin
 *   2. Provide credentials via either:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *      OR set FIREBASE_SERVICE_ACCOUNT to the raw JSON contents.
 *   3. Set FIREBASE_PROJECT_ID if your credentials don't include a project.
 *
 * EXAMPLE:
 *   node scripts/setInternalDev.mjs my-first-company my-second-company
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";

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
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    return;
  }
  console.error(
    "Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service " +
      "account JSON path, or FIREBASE_SERVICE_ACCOUNT to its contents."
  );
  process.exit(1);
}

async function main() {
  const ids = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    console.error("Usage: node scripts/setInternalDev.mjs <companyId> [...]");
    process.exit(1);
  }

  initAdmin();
  const db = getFirestore();

  let ok = 0;
  let fail = 0;

  for (const companyId of ids) {
    const ref = db.doc(`companies/${companyId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      console.error(`  [skip] ${companyId} — company does not exist`);
      fail++;
      continue;
    }
    await ref.update({
      "billing.status": "internal_dev",
      "billing.seatLimit": Math.max(
        snap.data()?.billing?.seatLimit ?? 10,
        10
      ),
      "billing.trialEndsAt": null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`  [ok]   ${companyId} → internal_dev`);
    ok++;
  }

  console.log(`\nDone. ${ok} updated, ${fail} skipped.`);
  process.exit(fail ? 2 : 0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
