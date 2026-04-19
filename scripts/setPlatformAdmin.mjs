#!/usr/bin/env node
/**
 * scripts/setPlatformAdmin.mjs
 *
 * Bootstrap (or remove) BellaCatalog "platform admin" status for one or
 * more Firebase Auth users. Writes a doc at `platformAdmins/{uid}` —
 * the existence check used by `firestore.rules` and the `/admin` panel
 * gate (`src/admin/RequirePlatformAdmin.tsx`).
 *
 * The Firestore security rules forbid client writes to `platformAdmins`,
 * so promotions have to go through this script (or another server-side
 * path). Every action prints the resulting state for the audit trail.
 *
 * USAGE:
 *   # Promote by email (preferred — looks up the auth user for you).
 *   node scripts/setPlatformAdmin.mjs --email someone@example.com
 *
 *   # Promote multiple, in one shot.
 *   node scripts/setPlatformAdmin.mjs \
 *     --email a@x.com --email b@x.com --email c@x.com
 *
 *   # Promote by uid directly (skips the auth lookup).
 *   node scripts/setPlatformAdmin.mjs --uid abc123XYZ
 *
 *   # Demote / revoke admin (deletes the platformAdmins doc).
 *   node scripts/setPlatformAdmin.mjs --revoke --email someone@example.com
 *
 *   # Add a free-form note shown in the audit log / admin UI.
 *   node scripts/setPlatformAdmin.mjs \
 *     --email me@example.com --note "Bootstrap admin — initial setup"
 *
 * REQUIREMENTS (one of):
 *   - Application Default Credentials:
 *       gcloud auth application-default login
 *   - Service account file:
 *       export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   - Inline service account JSON:
 *       export FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
 *
 *   Set FIREBASE_PROJECT_ID if your credentials don't include a project.
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function parseArgs(argv) {
  const emails = [];
  const uids = [];
  let revoke = false;
  let note = null;
  let printHelp = false;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--email" && next) {
      emails.push(next.trim().toLowerCase());
      i += 1;
    } else if (arg.startsWith("--email=")) {
      emails.push(arg.slice("--email=".length).trim().toLowerCase());
    } else if (arg === "--uid" && next) {
      uids.push(next.trim());
      i += 1;
    } else if (arg.startsWith("--uid=")) {
      uids.push(arg.slice("--uid=".length).trim());
    } else if (arg === "--revoke" || arg === "--remove") {
      revoke = true;
    } else if (arg === "--note" && next) {
      note = next;
      i += 1;
    } else if (arg.startsWith("--note=")) {
      note = arg.slice("--note=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp = true;
    }
  }

  return { emails, uids, revoke, note, printHelp };
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
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC.
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

async function resolveTargets({ emails, uids }) {
  const auth = getAuth();
  const targets = [];

  for (const uid of uids) {
    try {
      const user = await auth.getUser(uid);
      targets.push({
        uid: user.uid,
        email: (user.email || "").toLowerCase(),
        displayName: user.displayName || "",
      });
    } catch (err) {
      console.error(`  [skip] uid=${uid} — ${(err && err.message) || err}`);
    }
  }

  for (const email of emails) {
    try {
      const user = await auth.getUserByEmail(email);
      targets.push({
        uid: user.uid,
        email: (user.email || email).toLowerCase(),
        displayName: user.displayName || "",
      });
    } catch (err) {
      const code = err && err.code;
      if (code === "auth/user-not-found") {
        console.error(
          `  [skip] ${email} — no Firebase Auth user with that email. ` +
            `Make sure they've signed up at least once first.`
        );
      } else {
        console.error(`  [skip] ${email} — ${(err && err.message) || err}`);
      }
    }
  }

  return targets;
}

function printHelpAndExit() {
  console.log(
    [
      "Promote / demote BellaCatalog platform admins.",
      "",
      "Examples:",
      "  node scripts/setPlatformAdmin.mjs --email me@example.com",
      "  node scripts/setPlatformAdmin.mjs --email a@x.com --email b@x.com",
      "  node scripts/setPlatformAdmin.mjs --uid abc123",
      "  node scripts/setPlatformAdmin.mjs --revoke --email me@example.com",
      "  node scripts/setPlatformAdmin.mjs --email me@example.com \\",
      "      --note 'Bootstrap admin — initial setup'",
    ].join("\n")
  );
  process.exit(0);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.printHelp || (!args.emails.length && !args.uids.length)) {
    printHelpAndExit();
  }

  initAdmin();
  const db = getFirestore();
  const targets = await resolveTargets(args);
  if (!targets.length) {
    console.error("No valid targets — nothing to do.");
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    const ref = db.doc(`platformAdmins/${t.uid}`);
    try {
      if (args.revoke) {
        const snap = await ref.get();
        if (!snap.exists) {
          console.log(
            `  [noop] ${t.email || t.uid} — was not a platform admin.`
          );
          ok += 1;
          continue;
        }
        await ref.delete();
        console.log(
          `  [revoked] ${t.email || t.uid} — platform admin removed.`
        );
        ok += 1;
      } else {
        const snap = await ref.get();
        const existed = snap.exists;
        await ref.set(
          {
            email: t.email || null,
            displayName: t.displayName || null,
            note: args.note || null,
            createdAt: existed
              ? snap.data()?.createdAt ?? FieldValue.serverTimestamp()
              : FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        console.log(
          `  [${existed ? "updated" : "added"}] ${
            t.email || t.uid
          } → uid=${t.uid}`
        );
        ok += 1;
      }
    } catch (err) {
      console.error(
        `  [fail] ${t.email || t.uid} — ${(err && err.message) || err}`
      );
      fail += 1;
    }
  }

  console.log(`\nDone. ${ok} succeeded, ${fail} failed.`);
  process.exit(fail ? 2 : 0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
