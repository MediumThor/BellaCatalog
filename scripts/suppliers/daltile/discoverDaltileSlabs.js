import { fileURLToPath } from "node:url";
import { fetchDaltileCoveoPage, AQ_SLAB_PRODUCTS } from "./fetchDaltileCoveoSlabs.js";

/**
 * Lightweight discovery: one Coveo request to report total slab-product count
 * (same filter as the public Search URL).
 */
async function run() {
  const j = await fetchDaltileCoveoPage({ firstResult: 0, numberOfResults: 1 });
  process.stdout.write("Daltile Coveo (slab + product facet)\n");
  process.stdout.write(`- advancedQuery: ${AQ_SLAB_PRODUCTS}\n`);
  process.stdout.write(`- totalCount: ${j.totalCount ?? "?"}\n`);
  process.stdout.write(`- sampleTitle: ${j.results?.[0]?.title ?? "(none)"}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
