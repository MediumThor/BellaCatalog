#!/usr/bin/env node
/**
 * Run all supplier sync scripts in a sensible order (localhost / CI).
 *
 * Usage:
 *   npm run sync:all
 *   node scripts/sync-all.mjs
 *   node scripts/sync-all.mjs --only=daltile,cambria
 *   node scripts/sync-all.mjs --skip=stonex,cosentino
 *   node scripts/sync-all.mjs --fail-fast
 *   node scripts/sync-all.mjs --with-prices   # optional PDF price merges (needs configured inputs)
 *
 * Matchers (Cosentino, MSI, StoneX) read public/catalog.json — export/import your priced catalog first.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** @typedef {{ id: string, argv: string[], kind?: 'node' | 'python' }} Step */

/** Main web/API syncs — order: independent fetches first, then matchers that use catalog.json. */
const SYNC_STEPS = /** @type {Step[]} */ ([
  { id: "daltile", argv: ["scripts/suppliers/daltile/runDaltileSync.js"] },
  { id: "cambria", argv: ["scripts/suppliers/cambria/runCambriaSync.js"] },
  { id: "corian", argv: ["scripts/suppliers/corian/runCorianSync.js"] },
  { id: "hanstone", argv: ["scripts/suppliers/hanstone/runHanstoneSync.js"] },
  { id: "cosentino", argv: ["scripts/suppliers/cosentino/runCosentinoSync.js"] },
  { id: "msi", argv: ["scripts/suppliers/msi/runMsiSync.js"] },
  { id: "stonex", argv: ["scripts/suppliers/stonex/runStoneXSync.js"] },
]);

/** Optional PDF merge steps (run after main syncs when --with-prices). */
const PRICE_STEPS = /** @type {Step[]} */ ([
  { id: "corian-prices", argv: ["scripts/suppliers/corian/mergeHallmarkPdfPrices.js"], kind: "node" },
  { id: "hanstone-prices", argv: ["scripts/suppliers/hanstone/mergeHanstonePdfPrices.js"], kind: "node" },
  { id: "cambria-prices", argv: ["scripts/merge_cambria_prices.py"], kind: "python" },
]);

function parseList(s) {
  if (!s || !String(s).trim()) return [];
  return String(s)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function parseArgs(argv) {
  const out = {
    only: /** @type {string[]} */ ([]),
    skip: /** @type {string[]} */ ([]),
    failFast: false,
    withPrices: false,
    help: false,
  };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--fail-fast") out.failFast = true;
    else if (a === "--with-prices") out.withPrices = true;
    else if (a.startsWith("--only=")) out.only.push(...parseList(a.slice("--only=".length)));
    else if (a.startsWith("--skip=")) out.skip.push(...parseList(a.slice("--skip=".length)));
  }
  return out;
}

function filterSteps(steps, { only, skip }) {
  let list = steps;
  if (only.length) {
    const set = new Set(only);
    list = steps.filter((s) => set.has(s.id));
    const unknown = only.filter((id) => !steps.some((s) => s.id === id));
    if (unknown.length) {
      console.warn(`[sync-all] Unknown --only ids (ignored): ${unknown.join(", ")}`);
    }
  }
  if (skip.length) {
    const set = new Set(skip);
    list = list.filter((s) => !set.has(s.id));
  }
  return list;
}

function runStep(step, extraArgs) {
  const isPython = step.kind === "python";
  const cmd = isPython ? (process.env.PYTHON || "python") : process.execPath;
  const scriptPath = path.join(REPO_ROOT, step.argv[0]);
  const args = isPython ? [scriptPath, ...extraArgs] : [scriptPath, ...extraArgs];

  const started = Date.now();
  console.log(
    `\n${"=".repeat(72)}\n▶ ${step.id} (${isPython ? cmd : "node"} ${step.argv.join(" ")})\n${"=".repeat(72)}\n`
  );

  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });

  const ms = Date.now() - started;
  const code = res.status ?? 1;
  const ok = code === 0;
  console.log(`\n◀ ${step.id} ${ok ? "OK" : "FAILED"} (exit ${code}, ${(ms / 1000).toFixed(1)}s)\n`);
  return { step, ok, code, ms };
}

function printHelp() {
  console.log(`
Bella Catalog — sync all suppliers

${SYNC_STEPS.map((s) => `  ${s.id}`).join("\n")}

Options:
  --only=id1,id2     Run only these steps (comma-separated ids)
  --skip=id1,id2     Skip these steps
  --fail-fast        Stop after the first failure
  --with-prices      After syncs, run optional PDF price merges:
                       corian-prices, hanstone-prices, cambria-prices (Python)
  -h, --help         Show this help

Pass-through: arguments after -- are forwarded to each child script (advanced).

Note: cosentino, msi, and stonex match against public/catalog.json — keep that file
      up to date from your priced imports before running those steps.
`);
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const sep = rawArgv.indexOf("--");
  const orchestratorArgv = sep === -1 ? rawArgv : rawArgv.slice(0, sep);
  const extraFromCli = sep === -1 ? [] : rawArgv.slice(sep + 1);

  const opts = parseArgs(orchestratorArgv);
  if (opts.help) {
    printHelp();
    process.exitCode = 0;
    return;
  }

  let steps = filterSteps(SYNC_STEPS, opts);
  if (opts.withPrices) {
    steps = steps.concat(filterSteps(PRICE_STEPS, opts));
  }

  if (steps.length === 0) {
    console.error("[sync-all] No steps to run (check --only / --skip).");
    process.exitCode = 1;
    return;
  }

  console.log(`[sync-all] Repo: ${REPO_ROOT}`);
  console.log(`[sync-all] Steps (${steps.length}): ${steps.map((s) => s.id).join(", ")}`);
  if (extraFromCli.length) {
    console.log(`[sync-all] Extra args for each step: ${extraFromCli.join(" ")}`);
  }

  const results = [];
  const startedAll = Date.now();

  for (const step of steps) {
    const r = runStep(step, extraFromCli);
    results.push(r);
    if (!r.ok && opts.failFast) {
      console.error(`[sync-all] Stopping (--fail-fast).`);
      break;
    }
  }

  const failed = results.filter((r) => !r.ok);
  const totalMs = Date.now() - startedAll;

  console.log(`\n${"#".repeat(72)}`);
  console.log(`sync-all summary (${(totalMs / 1000).toFixed(1)}s total)`);
  console.log(`${"#".repeat(72)}`);
  for (const r of results) {
    console.log(`  ${r.ok ? "✔" : "✖"} ${r.step.id}  (${(r.ms / 1000).toFixed(1)}s, exit ${r.code})`);
  }
  console.log(
    failed.length
      ? `\nDone with ${failed.length} failure(s): ${failed.map((f) => f.step.id).join(", ")}`
      : "\nAll steps completed successfully."
  );

  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
