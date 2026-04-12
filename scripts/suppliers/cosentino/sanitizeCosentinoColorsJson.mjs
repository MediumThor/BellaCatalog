/**
 * Strip bogus URL fragments from public/cosentino-colors.json (legacy scrapes).
 * Usage: node scripts/suppliers/cosentino/sanitizeCosentinoColorsJson.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeCosentinoScrapedSpecs } from "./cosentinoSpecHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const TARGETS = [
  path.join(REPO, "public", "cosentino-colors.json"),
  path.join(REPO, "data", "generated", "cosentino-colors.json"),
];

async function sanitizeFile(TARGET) {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(TARGET, "utf8"));
  } catch {
    return false;
  }
  const items = raw?.catalog?.items;
  const records = raw?.records;
  if (Array.isArray(items)) {
    const next = items.map((it) => finalizeCosentinoScrapedSpecs(it));
    await fs.writeFile(
      TARGET,
      JSON.stringify({ ...raw, catalog: { ...raw.catalog, items: next } }, null, 2) + "\n",
      "utf8"
    );
    process.stdout.write(`Sanitized ${next.length} items in ${path.relative(REPO, TARGET)}\n`);
    return true;
  }
  if (Array.isArray(records)) {
    const next = records.map((it) => finalizeCosentinoScrapedSpecs(it));
    await fs.writeFile(
      TARGET,
      JSON.stringify({ ...raw, records: next }, null, 2) + "\n",
      "utf8"
    );
    process.stdout.write(`Sanitized ${next.length} records in ${path.relative(REPO, TARGET)}\n`);
    return true;
  }
  process.stderr.write(`${TARGET}: no catalog.items or records array\n`);
  return false;
}

async function main() {
  let ok = false;
  for (const t of TARGETS) {
    try {
      await fs.access(t);
    } catch {
      continue;
    }
    if (await sanitizeFile(t)) ok = true;
  }
  if (!ok) {
    process.stderr.write("No cosentino-colors.json files found to sanitize.\n");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
