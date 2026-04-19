# Commission Tracker + Job Lifecycle + Payments Plan

Last updated: 2026-04-18

This document is the source of truth for the commission tracker / job lifecycle
/ payments feature. It is organized as a **staged build plan** so each chunk
can ship behind a flag and be reverted without tearing out later chunks.

---

## 1. Goals

1. **Commission tracking per rep.** Every job has a rep and a commission %
   snapshotted at sale time. Reps can see *their own* totals; owners/admins
   see everyone's. Sales reps cannot manipulate their own numbers.
2. **Customizable base pricing** already exists via Layout Studio
   (`layoutQuoteSettings` on `JobRecord`). We keep that, add a
   **required deposit amount** and **quoted total** to the job, and **lock**
   pricing once a deposit is received.
3. **Required deposit + total on every job.** An admin (or rep, depending on
   role) sets: `quotedTotal`, `requiredDepositAmount` (absolute $ or % of
   total). The UI shows the outstanding balance at every step.
4. **Job lifecycle state machine:**
   `draft → quote → active → installed → complete` (plus `cancelled`).
   Areas within a job carry their own status for multi-scope jobs.
5. **Deposit tracking** that later exports cleanly to QuickBooks (CSV first;
   QuickBooks Online API in phase 2).
6. **Team management UI**: add/remove members, set commission %, deactivate
   without losing history.
7. **Dashboard visuals** so the owner/admin can see totals at a glance:
   pipeline by stage, sales + commissions per rep, monthly trend.
8. **Future: Stripe for real customer payments** — collect deposits and final
   payments on card/ACH, auto-log the payment records, auto-trigger the
   lifecycle transitions.

## 2. User answers driving this plan

These were locked in by the user:

| Question                           | Answer                                             |
| ---------------------------------- | -------------------------------------------------- |
| Commission scheme                  | **Flat %** per rep (set on member profile)         |
| Commission basis                   | **Gross sale total**                               |
| Earned timing                      | **Split** — half on deposit, half on final payment |
| Visibility                         | **Self + admin** (reps see own; admin sees all)    |
| Deposit lock scope                 | **Entire job + selected option** (no swapping)     |
| QuickBooks export                  | **CSV now, real API later**                        |
| Deposit/payment tracking           | **Manual entry only** (MVP)                        |

## 3. Existing foundations we're reusing

- Multi-tenant SaaS already done. Company doc at `companies/{companyId}` with
  `members/{userId}` subcollection, roles `owner | admin | manager | sales |
  viewer`, resolved permissions at `src/company/types.ts:138`.
- Jobs at `companies/{companyId}/customers/{customerId}/jobs/{jobId}` with
  price knobs (`layoutQuoteSettings`) and `finalOptionId`. Types in
  `src/types/compareQuote.ts`.
- Security rules gate every read/write by company membership + role and
  enforce optimistic concurrency via `version`.
  See `firestore.rules:75–227`.
- Team callables (invite / revoke / accept / setStatus / updateRole) in
  `functions/src/members/*` — we extend these rather than re-write.
- Stripe SaaS seat billing already wired in `functions/src/stripe/*`. We will
  add a **separate** Stripe integration for *customer payments* in phase 2.

## 4. Data model

### 4.1 Job (extensions to `JobRecord`)

```ts
// src/types/compareQuote.ts additions
export type JobStatus =
  | "draft"
  | "quote"
  | "active"      // deposit received, pricing + option locked
  | "installed"   // work done, final payment outstanding
  | "complete"    // paid in full
  | "cancelled";

interface JobRecord {
  // ...existing...

  // Deposit + total
  quotedTotal: number | null;             // authoritative final price shown to customer
  requiredDepositAmount: number | null;   // absolute $ required to flip to "active"
  requiredDepositPercent: number | null;  // optional % of quotedTotal (mirrors amount)
  depositReceivedTotal: number;           // derived sum of deposit-kind payments
  balanceDue: number | null;              // derived: quotedTotal - sum(all payments)

  // Lifecycle
  status: JobStatus;                       // expanded enum
  statusChangedAt: string | null;
  statusChangedByUserId: string | null;

  // Price lock
  pricingLocked: boolean;
  pricingLockedAt: string | null;
  pricingLockedByUserId: string | null;

  // Assignment + commission
  assignedUserId: string | null;           // primary rep (future: assignments[])
  commissionSnapshot: JobCommissionSnapshot | null;
}

export interface JobCommissionSnapshot {
  userId: string;
  displayName: string;
  percent: number;                         // 0..100, e.g. 5 = 5%
  split: { onDeposit: number; onFinalPayment: number }; // sums to 1
  basis: "gross";                          // future-proofed
  snapshottedAt: string;
}
```

Areas also get a `status: JobStatus` so a kitchen can be `active` while an
add-on fireplace is still `quote`. The job's top-level status is the
*furthest-along* of its areas by default, but an admin can override.

### 4.2 Company member (extensions to `CompanyMemberDoc`)

```ts
interface CompanyMemberDoc {
  // ...existing...
  commissionPercent: number | null;
  commissionSplit?: { onDeposit: number; onFinalPayment: number } | null;
}
```

`commissionPercent` is writable **only** by `owner` / `admin` (enforced in
rules — the member themselves cannot self-edit it).

### 4.3 Company settings

```ts
interface CompanySettings {
  // ...existing...
  defaultCommissionSplit: { onDeposit: number; onFinalPayment: number };
  defaultRequiredDepositPercent: number;   // e.g. 0.5 for 50%
  commissionIncludesSalesTax: boolean;     // most shops: false
}
```

### 4.4 Payments subcollection (new)

Path: `companies/{companyId}/customers/{customerId}/jobs/{jobId}/payments/{paymentId}`

```ts
export type PaymentKind =
  | "deposit"
  | "progress"
  | "final"
  | "refund"
  | "adjustment";

export type PaymentMethod =
  | "check"
  | "cash"
  | "ach"
  | "card"
  | "wire"
  | "other"
  | "stripe";                              // phase 2

export interface JobPaymentRecord {
  id: string;
  companyId: string;
  customerId: string;
  jobId: string;
  kind: PaymentKind;
  amount: number;                          // refunds: negative
  method: PaymentMethod;
  referenceNumber?: string | null;         // check #, stripe PI id, etc.
  receivedAt: string;                      // ISO date
  notes?: string;
  recordedByUserId: string;
  recordedByDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  // QB export tracking
  exportedToQuickBooks?: boolean;
  quickBooksExportId?: string | null;
  // Stripe (phase 2)
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  stripeStatus?: string | null;
}
```

Who can write: `owner`, `admin`, `manager`. Sales and viewers can only read.

### 4.5 Commission ledger (new, server-written only)

Path: `companies/{companyId}/commissionLedger/{entryId}`

```ts
export interface CommissionLedgerEntry {
  id: string;
  companyId: string;
  userId: string;                          // who earned it
  customerId: string;
  jobId: string;
  paymentId: string;                       // what caused it
  kind: "deposit_portion" | "final_portion" | "adjustment";
  amount: number;                          // $ earned (signed)
  jobTotalAtSnapshot: number;
  percent: number;
  split: { onDeposit: number; onFinalPayment: number };
  periodYearMonth: string;                 // "2026-04" for fast rollups
  createdAt: FirestoreTimestamp;
}
```

Rules: `read: self-or-admin`, `write: server only`.
Append-only: we never mutate an entry. Corrections are new entries with
`kind: "adjustment"`.

### 4.6 QuickBooks exports (new, server-written only)

Path: `companies/{companyId}/quickBooksExports/{exportId}`

```ts
interface QuickBooksExport {
  id: string;
  companyId: string;
  requestedByUserId: string;
  periodStart: string;                     // ISO date
  periodEnd: string;
  paymentCount: number;
  totalDepositAmount: number;
  totalFinalAmount: number;
  totalCommissionAmount: number;
  downloadUrl: string;                     // signed Storage URL
  fileName: string;
  createdAt: FirestoreTimestamp;
}
```

## 5. Security rules changes

Full diff will land in `firestore.rules`. Key additions:

1. Block sales/manager self-edits of `commissionPercent`. Only
   `owner/admin` can change it. (`members/{userId}` update rule.)
2. Once `pricingLocked == true` on a job, only `owner/admin` can edit pricing
   fields (`layoutQuoteSettings`, `finalOptionId`, `quotedTotal`,
   `commissionSnapshot`, `assignedUserId`).
3. New `payments/{paymentId}` subcollection: read = any member;
   create/update/delete = `owner/admin/manager`.
4. New `commissionLedger` and `quickBooksExports` collections:
   - Ledger: read = self or admin; write = denied (server only).
   - Exports: read = admin only; write = denied (server only).

## 6. Cloud Functions

All new functions live under `functions/src/commissions/` and
`functions/src/quickbooks/`.

### 6.1 `commissions/onPaymentWrite.ts`

Trigger: `onDocumentWritten(
  "companies/{companyId}/customers/{customerId}/jobs/{jobId}/payments/{paymentId}"
)`

Responsibilities (in one transaction where possible):

1. Read parent job to get `commissionSnapshot`, `quotedTotal`,
   `requiredDepositAmount`.
2. On **first deposit payment** (cumulative deposits cross the required
   threshold): set job `pricingLocked: true`, `status: "active"`,
   freeze `commissionSnapshot` if not yet frozen.
3. Recompute `depositReceivedTotal` and `balanceDue` on the job.
4. Write one or two `commissionLedger` entries:
   - For `kind: "deposit"` payments → `deposit_portion = amount * percent *
     split.onDeposit / quotedTotal`.
   - For `kind: "final"` or `"progress"` that satisfies full balance →
     `final_portion = amount * percent * split.onFinalPayment / quotedTotal`.
5. On payment **delete** or amount change → emit compensating
   `adjustment` ledger entry so the ledger stays append-only.
6. On cumulative payments ≥ `quotedTotal` → set job `status: "complete"`
   (unless already `cancelled`).

### 6.2 `commissions/onJobStatusTransition.ts`

Trigger: `onDocumentUpdated(
  "companies/{companyId}/customers/{customerId}/jobs/{jobId}"
)`

- Enforce valid transitions server-side (defense in depth; the client also
  validates). Legal matrix:

  ```
  draft    → quote | cancelled
  quote    → active | cancelled | draft (if no deposit yet)
  active   → installed | cancelled (admin only)
  installed→ complete | cancelled (admin only)
  complete → (terminal, admin-only reopen)
  cancelled→ (terminal, admin-only reopen)
  ```

- When entering `active`: if `commissionSnapshot` is still null (edge case
  where pricingLocked was flipped without a payment), snapshot the current
  assigned rep's commission %.

- When entering `complete`: fire a ledger sweep to ensure `final_portion`
  entries exist for all `final`/`progress` payments up to `quotedTotal`.

### 6.3 `quickbooks/exportCommissionsCsv.ts` (callable)

Input:
```ts
{ companyId, periodStart, periodEnd, includeExportedPayments?: boolean }
```

Output:
```ts
{ exportId, downloadUrl, paymentCount, totalCommissionAmount }
```

Pseudocode:

1. Assert caller is `owner` or `admin` of company.
2. Query all `payments` with `receivedAt` in range via a collectionGroup
   query filtered by `companyId`.
3. Join each payment with its parent `job` + `customer` (batched).
4. Build two CSVs — `payments_<period>.csv` and `commissions_<period>.csv`.
   See §7 for columns.
5. Upload to Cloud Storage at
   `gs://{bucket}/quickbooksExports/{companyId}/{exportId}/...` with a
   24-hour signed URL.
6. Write the `quickBooksExports/{exportId}` doc. Mark each included payment
   `exportedToQuickBooks: true, quickBooksExportId: {exportId}` (unless
   caller asked to re-include previously-exported rows).

### 6.4 `quickbooks/markPaymentsExported.ts` (callable, optional admin tool)

Lets admins undo an export's "already exported" flag if a file is re-run.

## 7. CSV formats (phase 1)

### 7.1 `payments_<YYYY-MM>.csv`

```
Date, Customer, JobName, InvoiceRef, Kind, Method, Amount, Reference#, RecordedBy, Notes
```

One row per payment. Intended for QuickBooks "Bank deposit" or "Receive
payment" import.

### 7.2 `commissions_<YYYY-MM>.csv`

```
EarnedDate, Rep, Customer, JobName, PaymentId, Portion, JobTotal, Rate%, CommissionAmount
```

One row per ledger entry. Intended for a QuickBooks journal entry
(debit Commission Expense / credit Commission Payable) or payroll import.

## 8. UI

### 8.1 Routes (add to `src/main.tsx`)

```
/jobs                                              → JobsOverviewPage
/jobs/:jobId/payments                              → redirect to existing job detail w/ payments tab open
/commissions                                       → CommissionsPage (self or admin)
/settings/team                                     → SettingsTeamPage (rebuild)
/settings/quickbooks-exports                       → QuickBooksExportsPage
```

### 8.2 Components

- **`JobsOverviewPage`**: two views, kanban + table, filter by status/
  assigned rep/date range.
- **`JobDetailPage` additions**:
  - Status stepper header.
  - "Quoted total" + "Required deposit" inputs, admin-editable until lock.
  - `JobPaymentsPanel` tab with `RecordPaymentModal`.
  - Assigned rep dropdown (admin only).
  - Lock icon on the Quote tab once `pricingLocked`.
- **`RecordPaymentModal`**: amount, method, date, reference, notes. On a
  deposit that satisfies the required amount, shows "This will lock pricing
  for this job" confirmation.
- **`CommissionsPage`** (admin or self):
  - KPI cards: MTD sales, MTD commission, pipeline $ by stage, paid-in-full
    YTD.
  - Recharts stacked bar per rep per month (admin only).
  - Leaderboard table.
  - Period picker: This month / Last month / QTD / YTD / custom.
- **`SettingsTeamPage`** (rebuild):
  - Member table: name, email, role, commission %, active/disabled toggle,
    remove button. Inline-edit commission % (admin only).
  - "Invite member" modal → reuses `inviteMember` callable.
- **`QuickBooksExportsPage`**:
  - "Generate new export" period-picker modal → `exportCommissionsCsv`
    callable → browser download.
  - History table of past exports with re-download links.

### 8.3 Nav changes (`src/settings/SettingsShell.tsx`)

Add:
- "Commissions" top-level nav (new sidebar entry in main app shell).
- "QuickBooks exports" under Settings, admin-only.
- "Team" page rebuilt (currently a stub).

## 9. Migration

Script: `scripts/migrateJobsForCommissions.mjs`

For every existing job doc:
- Map legacy status → new enum:
  - `"closed"` → `"complete"`
  - `"quoted"` → `"quote"`
  - `"selected" | "comparing"` → `"draft"`
  - `"draft"` → `"draft"`
- Seed defaults: `pricingLocked: false`, `depositReceivedTotal: 0`,
  `quotedTotal: null`, `requiredDepositAmount: null`,
  `assignedUserId: createdByUserId`, `commissionSnapshot: null`.
- Ensure each `area` has `status = <parent status>`.
- Write only when changes are needed; idempotent.

Per-company settings: add
`defaultCommissionSplit = { onDeposit: 0.5, onFinalPayment: 0.5 }` and
`defaultRequiredDepositPercent = 0.5`, `commissionIncludesSalesTax = false`.

Member docs: add `commissionPercent: null` if missing.

## 10. Roll-out order (checklist)

- [ ] 10.1 Plan doc committed (this file).
- [ ] 10.2 Types: `src/types/commission.ts`, extend
  `src/types/compareQuote.ts` and `src/company/types.ts`.
- [ ] 10.3 Firestore rules + indexes updated.
- [ ] 10.4 Firestore service modules:
  - `src/services/jobPaymentsFirestore.ts`
  - `src/services/commissionLedgerFirestore.ts`
  - `src/services/quickbooksExportsFirestore.ts`
  - Extend `src/services/compareQuoteFirestore.ts` with
    `transitionJobStatus`, `setJobQuoteTotal`, `setJobRequiredDeposit`,
    `assignRep`, `unlockPricing`.
- [ ] 10.5 Cloud Functions: `onPaymentWrite`,
  `onJobStatusTransition`, `exportCommissionsCsv`.
- [ ] 10.6 Rebuild `SettingsTeamPage` with member mgmt + commission %.
- [ ] 10.7 JobDetailPage additions: deposit/total fields, status stepper,
  payments panel, record payment modal, price-lock UI.
- [ ] 10.8 JobsOverviewPage (kanban + table).
- [ ] 10.9 CommissionsPage (charts + leaderboard + period picker).
- [ ] 10.10 QuickBooksExportsPage.
- [ ] 10.11 Data migration script, run in dev/prod (gated by env flag).
- [ ] 10.12 Manual QA checklist (see §11).

## 11. Manual QA checklist

1. **Invite flow**: owner invites new rep w/ commissionPercent 5; rep signs
   in and sees dashboard with zero totals.
2. **Job creation**: rep creates job; sets quoted total $12,000, required
   deposit $6,000.
3. **Deposit recorded**: admin records $6,000 deposit check. Job flips to
   `active`; pricing locked; ledger gains a `deposit_portion` entry
   `12000 * 0.05 * 0.5 = $300` for the rep.
4. **Price edit attempt by rep**: blocked by UI and by rules. Attempt to
   call Firestore directly also blocked.
5. **Installed → paid**: admin marks installed, then records final
   $6,000. Ledger gains second `final_portion` entry for $300. Job flips to
   `complete`.
6. **QB export**: admin exports the month. CSVs download; payments are
   tagged `exportedToQuickBooks: true`; export doc exists.
7. **Dashboard**: rep sees $600 commission YTD; admin sees same per rep.
8. **Refund**: admin records a $-1,000 refund on the final payment. Ledger
   writes compensating `adjustment` entry `-1000 * 0.05 * 0.5 / 12000 ≈
   -$2.08` to keep the rep's total correct. Balance due recalculated.

## 12. Stripe integration (phase 2) — plan

> Shipped as a separate epic once phase 1 is stable. Nothing below is built
> in phase 1; it is documented here so phase-1 schemas are forward-compatible.

### 12.1 Goals

- Owner/admin can enable **"Accept customer payments"** on the company.
- Each job gets two "pay buttons" the shop can send to their customer:
  - **Pay deposit** ($ = `requiredDepositAmount`)
  - **Pay balance** ($ = `balanceDue`)
- Successful Stripe payments automatically create `JobPaymentRecord`s,
  triggering the existing lifecycle + commission logic.
- Fees/disbursement are visible in the dashboard.

### 12.2 Model: Stripe Connect (Standard accounts)

- Each company becomes a **Connect Standard account**. The shop is the
  merchant of record; BellaCatalog takes no cut (for now).
- On the company doc, add `billing.stripeConnectAccountId` and
  `billing.stripeConnectOnboarded: boolean`.
- Customer payments flow to **the company's own** Stripe account, not the
  platform. This also keeps the existing platform Stripe subscription
  (seat billing) completely separate.

### 12.3 New Cloud Functions (phase 2)

1. `stripe/createConnectAccountLink` (callable): starts/refreshes the
   Connect onboarding link for the company.
2. `stripe/createJobPaymentSession` (callable): takes
   `{ companyId, jobId, kind: "deposit"|"final" }`, returns a Checkout
   session URL (or hosted invoice link). Uses the company's Connect account
   via `Stripe.accounts` idempotency.
3. `stripe/customerPaymentWebhook` (separate endpoint from the existing seat
   webhook). Listens for `payment_intent.succeeded` and `charge.refunded`
   on Connect accounts. On success:
   - Create the matching `JobPaymentRecord` (`method: "stripe"`,
     `stripePaymentIntentId`, etc.).
   - Ledger + lifecycle kick in automatically via the existing
     `onPaymentWrite` trigger.
   - On refund → write a compensating `refund`-kind payment record.

### 12.4 Rules additions (phase 2)

- `companies/{id}.billing.stripeConnectAccountId` is server-written only.
- Webhook-created payment records must set `method == "stripe"` and
  include a non-empty `stripePaymentIntentId`. Existing `payments/*` rules
  stay restrictive to Admin SDK (webhook) writes for Stripe-sourced rows.

### 12.5 UI additions (phase 2)

- Company onboarding step: "Connect Stripe".
- Job detail → "Send payment link" button (generates deposit or final URL).
- Branded hosted pay page (uses company colors / logo from
  `CompanyBranding`).
- Dashboard: gross vs. net Stripe fees card.

### 12.6 Why schema is already phase-2-ready

- `PaymentMethod` already lists `"stripe"`.
- `JobPaymentRecord` already has `stripePaymentIntentId`,
  `stripeChargeId`, `stripeStatus`.
- `onPaymentWrite` is the single point of truth for commission + status
  side-effects, so Stripe-sourced rows feed through the same logic with no
  new math.

## 13. Open questions (future work)

- **Multi-rep split**: currently single `assignedUserId`. When needed, move
  to `assignments: { userId, sharePercent }[]` and sum ledger rows.
- **Sales tax on commission**: toggle exists
  (`commissionIncludesSalesTax`) — wire into ledger math when a tax field
  appears on `JobRecord`.
- **QuickBooks Online API** (replace CSV step): same callable name, swap
  internals to the QBO REST API with OAuth tokens stored on the company doc
  (admin-only).
- **Xero / FreshBooks adapter**: if needed, abstract the export step behind
  an `AccountingAdapter` interface; phase-1 CSV becomes the default adapter.
