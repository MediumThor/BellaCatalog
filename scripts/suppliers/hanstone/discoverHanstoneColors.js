import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso, writeJson } from "./hanstoneHelpers.js";
import { fetchHanstoneGridHtml, parseGridRecords } from "./fetchHanstoneColorSearch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "out");

async function run() {
  const startedAt = nowIso();
  const { html } = await fetchHanstoneGridHtml();
  const rows = parseGridRecords(html);
  await writeJson(path.join(OUT_DIR, "hanstone-discovered.json"), {
    startedAt,
    count: rows.length,
    slugs: rows.map((r) => r.slug),
    rows,
  });
  process.stdout.write(`discovered ${rows.length} HanStone Quartz colors (grid only)\n`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
