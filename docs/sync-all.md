# Sync all suppliers (orchestrator)

Run every **supplier web sync** in one command from the repo root (localhost or CI). This does not replace PDF imports into `public/catalog.json`; it refreshes the JSON files the app loads alongside the priced catalog.

---

## Command

```bash
npm run sync:all
```

Equivalent:

```bash
node scripts/sync-all.mjs
```

Implementation: `scripts/sync-all.mjs`.

---

## Run order

Steps run **sequentially** in this order:

| # | Step id   | Script | Notes |
|---|-----------|--------|--------|
| 1 | `daltile` | `runDaltileSync.js` | Coveo API; no browser |
| 2 | `cambria` | `runCambriaSync.js` | Playwright |
| 3 | `corian` | `runCorianSync.js` | Color-tool JSON API |
| 4 | `hanstone` | `runHanstoneSync.js` | Fetch grid + PDP HTML |
| 5 | `cosentino` | `runCosentinoSync.js` | Playwright; **matches** `public/catalog.json` |
| 6 | `msi` | `runMsiSync.js` | Playwright; **matches** `public/catalog.json` |
| 7 | `stonex` | `runStoneXSync.js` | Playwright + inventory extract; **matches** `public/catalog.json` |

**Prerequisite:** Export or copy a current **`public/catalog.json`** (priced PDF imports) *before* running **cosentino**, **msi**, or **stonex**, so matchers can attach web data to the right rows.

---

## Options

| Flag | Meaning |
|------|---------|
| `--only=id1,id2` | Run only these step ids (comma-separated) |
| `--skip=id1,id2` | Skip these step ids |
| `--fail-fast` | Stop after the first failing step |
| `--with-prices` | After the main syncs, run optional PDF price merges (see below) |
| `-h`, `--help` | Print usage |

**Pass-through:** Arguments after a bare `--` are forwarded to **each** child script. Use only when you know every step accepts the same flags (e.g. testing with limits).

Examples:

```bash
npm run sync:all -- --skip=stonex,cambria
npm run sync:all -- --only=daltile,msi --fail-fast
```

---

## Optional price merges (`--with-prices`)

When `--with-prices` is set, these run **after** the seven main steps (respecting `--only` / `--skip` for these ids too):

| Step id | Command |
|---------|---------|
| `corian-prices` | `mergeHallmarkPdfPrices.js` |
| `hanstone-prices` | `mergeHanstonePdfPrices.js` |
| `cambria-prices` | `scripts/merge_cambria_prices.py` (uses `PYTHON` or `python` on `PATH`) |

Each merge expects its **PDF paths and inputs** to be configured as documented in the main README; they will fail if files are missing.

---

## Exit code and summary

- **0** — every executed step exited 0  
- **1** — at least one step failed  

The script prints a **summary** listing each step with ✔/✖, duration, and exit code.

---

## Performance and operations

- A full run can take **a long time** (many Playwright pages and network calls). Run on a machine with Playwright browsers installed (`npx playwright install chromium`).
- For development, use `--only` or per-supplier npm scripts (e.g. `npm run cambria:sync -- --limit=10`) until you are ready for a full refresh.

---

## Production / scheduling (later)

The same entry point can be used from **CI** (e.g. scheduled workflow) or a **backend job**: invoke `npm run sync:all` (or `node scripts/sync-all.mjs`) on a runner with Node + Playwright + optional Python, then upload artifacts or push to a database. Do **not** run the full orchestrator inside the browser.

---

## Related documentation

- **Adding or changing a connector:** [`supplier-connector-instructions.md`](./supplier-connector-instructions.md) — discovery, normalization, `public/*.json`, app merge patterns.
- **MSI-specific:** [`msi-quartz-connector.md`](./msi-quartz-connector.md).
- **Per-supplier commands, outputs, and caveats:** [`README.md`](../README.md) (Cambria, Corian, StoneX, Cosentino, MSI, Daltile, HanStone sections).

When **reviewing scraping** behavior, use those docs plus the scripts under `scripts/suppliers/<supplier>/` as the source of truth.
