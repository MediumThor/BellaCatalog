# AI Catalog Search & Visual Match — Server-Side Callable Plan

## Goal

Port the existing browser-only Gemini catalog search and image-rerank flow
(`src/services/geminiCatalogSearch.ts`, used from `src/components/CatalogBrowser.tsx`)
into two trusted Firebase **Callable** Cloud Functions so that:

1. The Gemini API key never leaves the server.
2. Each request is hard-scoped to the caller's active company. Company A's
   vendors, manufacturers, finishes, price tiers, custom tags, and image
   references can never appear in a prompt assembled for Company B.
3. The frontend UX (the **AI** button on the search bar, the explanation
   chip, the visual-rerank ordering) stays identical for the user.

This builds on:

- `docs/saas-refactor/10_target_architecture.md` — multi-tenant model
- `docs/saas-refactor/40_ai_price_import_pipeline.md` — "frontend must not
  call the LLM directly" rule
- `firestore.rules` — `companyMember()` / `hasRole()` helpers
- `src/services/geminiCatalogSearch.ts` — current browser implementation

## Non-goals (this doc)

- The full RAG / embeddings index (covered separately when usage justifies
  it; see `43_ai_chat_assistant.md` §"Phase 4").
- The price-sheet import parser (covered in `40_ai_price_import_pipeline.md`).
- Visual search by *uploaded* customer photo (Phase 3 below).

---

## 1. Threat model & isolation contract

The single property we must preserve:

> Given two companies A and B, no inference call made on behalf of a member
> of A may include any catalog item, vendor, manufacturer, custom filter
> value, image URL, or image bytes that originated in B's tenant subtree.

Enforcement layers, in order:

1. **Identity** — Callable resolves `request.auth.uid`; rejects if missing.
2. **Membership re-check** — server reads
   `companies/{companyId}/members/{uid}` with the Admin SDK and requires
   `status == "active"`. Mirrors `companyMember()` in `firestore.rules`
   lines 31–39.
3. **Path-prefixed retrieval** — every Firestore read in the Callable is
   rooted at `companies/${companyId}/...`. We never use a `collectionGroup`
   query without a `where("companyId", "==", companyId)` clause.
4. **Allow-list assembly** — filter option lists (vendors, manufacturers,
   materials, etc.) are derived **only** from the company's own catalog
   subtree. Globals (`globalManufacturers`, `globalVendors`) may be folded
   in because they're public reference data, but global rows still flow
   through the same allow-list clamp.
5. **Output clamp** — the model's response is validated against the
   allow-lists before being returned to the client. Reuses the
   `clampToAllowed()` pattern already in `src/services/geminiCatalogSearch.ts`.
6. **No cross-tenant memory** — the Callable is stateless. No prompt
   caching across companies. No few-shot examples drawn from another
   tenant. Few-shot fixtures (if used) live under
   `functions/src/ai/fixtures/` and are synthetic.

---

## 2. Callable surface

Two functions, both `onCall` (HTTPS Callable, v2):

```ts
// functions/src/ai/searchCatalog.ts
export const aiSearchCatalog = onCall<AiSearchCatalogRequest>({
  region: "us-central1",
  secrets: [GEMINI_API_KEY],
  cors: true,
  enforceAppCheck: true, // recommended once App Check is wired up
}, async (req) => { ... });

// functions/src/ai/visualMatch.ts
export const aiVisualMatch = onCall<AiVisualMatchRequest>({
  region: "us-central1",
  secrets: [GEMINI_API_KEY],
  cors: true,
  enforceAppCheck: true,
  memory: "1GiB",       // image fetch + base64 buffer
  timeoutSeconds: 60,
}, async (req) => { ... });
```

### Request / response shapes

```ts
// shared in src/types/aiCatalog.ts and re-imported by functions/

export interface AiSearchCatalogRequest {
  companyId: string;          // server re-checks membership; not trusted
  userRequest: string;        // free-text salesperson query
  // Optional client hints. Server will still re-derive allow-lists from
  // the company catalog and intersect; never trusted as-is.
  hints?: {
    activeVendor?: string | null;
    activeCollectionId?: string | null;
  };
}

export interface AiSearchCatalogResponse {
  // Same shape as today's GeminiCatalogSearchResult so the React UI does
  // not need to change.
  explanation: string;
  searchText: string;
  vendor: string;
  manufacturers: string[];
  materials: string[];
  thicknesses: string[];
  tierGroups: string[];
  finishes: string[];
  sizeClasses: string[];
  priceTypes: string[];
  colorFamilies: string[];
  undertones: string[];
  patternTags: string[];
  movementLevels: string[];
  styleTags: string[];
  // New diagnostics surfaced for the UI / billing:
  meta: {
    model: string;             // e.g. "gemini-2.5-flash"
    promptVersion: string;     // e.g. "search/v1"
    latencyMs: number;
    tokensIn?: number;
    tokensOut?: number;
  };
}

export interface AiVisualMatchRequest {
  companyId: string;
  userRequest: string;
  // Candidate catalog item ids the user can already see in the grid.
  // Server intersects with the company's catalog, fetches images server-
  // side, and discards anything that doesn't belong to the company.
  candidateItemIds: string[];   // hard cap (e.g. 16) enforced server-side
}

export interface AiVisualMatchResponse {
  explanation: string;
  orderedIds: string[];
  rejectedIds: string[];
  meta: {
    model: string;
    promptVersion: string;
    latencyMs: number;
    candidateCount: number;
    // ids that were dropped because they did not belong to the company
    // or had no resolvable image. Useful for debugging, not surfaced.
    droppedIds: string[];
  };
}
```

### Error contract

Use `HttpsError` codes:

- `unauthenticated` — no `auth`.
- `permission-denied` — caller is not an active member of `companyId`.
- `failed-precondition` — company has AI feature disabled (see §6 billing).
- `resource-exhausted` — daily/per-minute quota exceeded.
- `invalid-argument` — empty userRequest, > N candidates, etc.
- `internal` — model error after retry.

---

## 3. New file layout

```
functions/src/
  ai/
    helpers.ts               // assertActiveMember, loadFilterOptions,
                             // logUsage, clampToAllowed, redactPii
    secrets.ts               // defineSecret('GEMINI_API_KEY')
    searchCatalog.ts         // Callable: aiSearchCatalog
    visualMatch.ts           // Callable: aiVisualMatch
    prompts/
      search.v1.ts           // toPrompt() — same shape as current code
      visualMatch.v1.ts      // visualPrompt() — current code
    fixtures/                // synthetic few-shot examples (no PII)

src/
  services/
    aiCatalogClient.ts       // thin httpsCallable wrappers; no API keys
  hooks/
    useAiCatalogSearch.ts    // replaces direct calls in CatalogBrowser
```

The client adapter exposes the same function names the UI already uses:

```ts
// src/services/aiCatalogClient.ts
export async function runAiCatalogSearch(
  userRequest: string
): Promise<AiSearchCatalogResponse> {
  const fn = httpsCallable<AiSearchCatalogRequest, AiSearchCatalogResponse>(
    functions, "aiSearchCatalog"
  );
  const { data } = await fn({ companyId: useCompany().id, userRequest });
  return data;
}
```

`CatalogBrowser.tsx` swaps `runGeminiCatalogSearch` →
`runAiCatalogSearch` and `runGeminiCatalogVisualMatch` →
`runAiVisualMatch`. No prop or layout changes.

---

## 4. Server-side filter-option assembly (per company)

Today the React app builds the `GeminiCatalogFilterOptions` lists from
the in-memory catalog (which is currently global). On the server, the
same lists must be derived from the *company's* catalog so the LLM only
ever sees that company's vocabulary.

```ts
// functions/src/ai/helpers.ts (sketch)
export async function loadCompanyFilterOptions(
  companyId: string
): Promise<GeminiCatalogFilterOptions> {
  const snap = await db
    .collection(`companies/${companyId}/catalogItems`)
    .select(
      "vendor", "manufacturer", "material", "thickness", "tierGroup",
      "finish", "sizeClass", "priceEntries.label",
      "colorFamilies", "undertones", "patternTags", "movement", "styleTags"
    )
    .get();
  return distinctSorted(snap.docs);
}
```

Optimizations (in order, only when needed):

1. Cache the result in-memory per warm container, keyed by
   `(companyId, lastCatalogUpdateAt)`.
2. Persist it to `companies/{companyId}/aiCache/filterOptions` after
   any catalog write (Firestore trigger on `catalogItems`).
3. Maintain a precomputed `companies/{companyId}/aiCache/distincts` doc
   updated on publish of a price book.

---

## 5. Visual match — server-side image fetch

The current code fetches each candidate image from the browser
(`loadCandidateImage()` in `geminiCatalogSearch.ts` lines 233–250). On
the server we instead:

1. Look up each `candidateItemIds[i]` under
   `companies/{companyId}/catalogItems/{id}`. **Hard reject** ids that
   don't resolve there — this is the cross-tenant guardrail.
2. Read each item's `imageUrl` and resolve it. If the URL points at our
   own Storage bucket (`gs://.../companies/{companyId}/...`), use the
   Admin Storage SDK; else `fetch()` it server-side.
3. Resize to max edge 512px JPEG (port `blobToSizedJpeg()` to
   `sharp` on the server).
4. Cap inflight fetches (`p-limit(4)`) and total bytes per request
   (e.g. 4 MiB).
5. Discard candidates without an image (same as today) and surface them
   in `meta.droppedIds`.

PII: image URLs and bytes are sent to Gemini. They are slabs/finishes,
not customers, so this is fine. Customer-uploaded reference photos are
out of scope here (see Phase 3 below).

---

## 6. Entitlement, quotas, usage logging

Add a per-company AI plane to `CompanyBilling`
(`src/company/types.ts`):

```ts
export interface CompanyAiSettings {
  enabled: boolean;          // master kill switch (default true on paid)
  features: {
    catalogSearch: boolean;
    visualMatch: boolean;
    chatAssistant: boolean;  // for 43_ai_chat_assistant.md
    importParse: boolean;    // for 40_ai_price_import_pipeline.md
  };
  // Gifted credits (analogous to bonusSeats). Burned per call.
  bonusCreditsUsd?: number;
  // Hard rate-limits. null = use plan default.
  maxCallsPerDay?: number | null;
  maxCallsPerMinute?: number | null;
}
```

Each Callable, after membership check, calls a shared
`assertAiAllowed(companyId, "catalogSearch")` helper that:

1. Reads `companies/{companyId}/billing` and the new `aiSettings`.
2. Rejects with `failed-precondition` if disabled.
3. Reads today's usage doc at
   `companies/{companyId}/aiUsage/{yyyy-mm-dd}` and rejects with
   `resource-exhausted` if over the cap.
4. After a successful inference, writes back via `FieldValue.increment`:

```
companies/{companyId}/aiUsage/{yyyy-mm-dd}
  callCount: int
  tokensIn: int
  tokensOut: int
  costUsd: number
  byFeature.catalogSearch.callCount: int
  byFeature.catalogSearch.costUsd: number
  byFeature.visualMatch.{...}
```

Add Firestore rules:

```
match /companies/{companyId}/aiUsage/{day} {
  allow read: if hasRole(companyId, ["owner","admin"])
              || isPlatformAdmin();
  allow write: if false; // server only
}
```

The platform admin panel
(`src/admin/AdminCompanyDetailPage.tsx`) gets a new "AI" tab to flip
`features.*` and gift `bonusCreditsUsd`, mirroring the existing
seat-gifting UI.

---

## 7. Secrets & deployment

```bash
firebase functions:secrets:set GEMINI_API_KEY
# (prompted for value — never echoes)

firebase deploy --only functions:aiSearchCatalog,functions:aiVisualMatch
```

In `functions/src/ai/secrets.ts`:

```ts
import { defineSecret } from "firebase-functions/params";
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
```

Each Callable declares it via `secrets: [GEMINI_API_KEY]` so the value
is mounted only inside that function's runtime.

App Check (recommended once stable) blocks bots and prevents the
Callables from being scripted from outside the official web app:

```ts
// src/firebase.ts
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(import.meta.env.VITE_APPCHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
```

---

## 8. Migration / cutover order

1. Land the new Callables behind a feature flag
   `companies/{companyId}/aiSettings.features.catalogSearch`. Flag
   defaults to **off**; one or two pilot companies turn it on.
2. Add `src/services/aiCatalogClient.ts` and a thin hook
   `useAiCatalogSearch()`. It reads the flag from `useCompany()` and:
   - if `enabled` → call the Callable
   - else → fall back to the legacy `runGeminiCatalogSearch` so nothing
     breaks for un-migrated companies.
3. After pilot validation, flip the flag default to **on** and remove
   the fallback branch in the hook.
4. Delete `src/services/geminiCatalogSearch.ts` and remove
   `VITE_GEMINI_API_KEY` / `VITE_GEMINI_MODEL` from `.env`,
   `src/vite-env.d.ts`, and any docs.
5. **Rotate** the old `VITE_GEMINI_API_KEY` value in Google Cloud
   Console (it has been public in `dist/` — see header note in `.env`).

---

## 9. Test plan

Unit (functions, with the emulator):

- Caller is unauthenticated → `unauthenticated`.
- Caller is signed in but not a member of `companyId` → `permission-denied`.
- Caller is `disabled` member of `companyId` → `permission-denied`.
- Caller is active member, `aiSettings.enabled = false` →
  `failed-precondition`.
- Daily cap reached → `resource-exhausted`.
- Output contains a vendor not in the company's allow-list → server
  silently drops it (`clampToAllowed`).
- `visualMatch` is asked about a `candidateItemId` that belongs to
  *another* company → that id is excluded; never reaches Gemini.

Integration (manual, then Playwright):

- Two test companies (A, B). Same product name in both with different
  vendor labels. A's user runs AI search; assert no B-only vendor
  appears in `manufacturers`/`vendors` arrays.
- Re-run with B's user; assert symmetric isolation.

Load:

- 100 concurrent search calls across 5 companies; verify per-company
  daily usage doc increments correctly without lost updates (use
  `FieldValue.increment`, not read-modify-write).

---

## 10. Open questions / follow-ups

- Do we want a per-prompt audit row (separate from aggregate usage)
  for compliance, or only aggregate counts? Recommend: aggregate by
  default, opt-in detailed log for enterprise plans.
- Move from `gemini-2.5-flash` → Gemini Pro for harder visual matches?
  Surface as `aiSettings.preferredModel` per company.
- Vector search for "more like this" — defer to embeddings work in
  `43_ai_chat_assistant.md`.
