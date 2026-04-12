# Compare Tool Quote Workflow Spec

## Purpose

Implement an internal **Compare Tool** inside the existing React/Vite supplier catalog project. This tool is used by authenticated Bella Stone staff during in-person sales conversations to:

- create and manage customers
- create jobs under those customers
- enter required square footage for quoting
- compare multiple slab/product options side by side
- select a final material option
- generate a clean final quote summary

This implementation must fit into the **current project structure**, reuse the **existing catalog/product system**, and persist data in **Firebase**.

---

## Core Product Goal

Turn the current supplier catalog app into a guided internal quoting workflow:

**Signed-in rep -> Customer -> Job -> Compare Options -> Final Selection -> Quote Summary**

This is not ecommerce. This is an internal workflow and quoting aid.

---

## Existing Assumptions

The current project already has:

- internal auth/sign-in for company users
- protected deployment on Vercel
- supplier catalog/product records with images and metadata
- current pricing data already loaded for many suppliers
- vendor/product browsing, filters, search, cards/table views, etc.
- Firebase connected and available for persistence

The new workflow must reuse those systems rather than creating a disconnected second app inside the repo.

---

## Implementation Principles

1. **Reuse existing catalog data and UI patterns** wherever possible.
2. **Persist records in Firebase**, tied to the authenticated internal user.
3. **Store snapshot data** for selected quote options so the quote remains understandable even if supplier data later changes.
4. **Require square footage in MVP**.
5. **Do not make DXF parsing part of MVP**, but structure the model for phase 2.
6. **Keep calculations simple and explicit**.
7. **Preserve existing supplier catalog behavior**.
8. **Make it production-usable, not a prototype.**

---

## Recommended Data Model

Use Firebase-backed entities such as the following.

## Internal User

Use the existing authenticated internal user as the owner of downstream records.

Suggested shape:

```ts
{
  id: string,
  name: string,
  email: string
}
```

## Customer

```ts
{
  id: string,
  ownerUserId: string,
  firstName: string,
  lastName: string,
  phone: string,
  email: string,
  address: string,
  notes: string,
  createdAt: string,
  updatedAt: string
}
```

## Job

```ts
{
  id: string,
  customerId: string,
  ownerUserId: string,
  name: string,
  areaType: string,
  squareFootage: number,
  notes: string,
  assumptions: string,
  status: 'draft' | 'comparing' | 'selected' | 'quoted' | 'closed',
  dxfAttachmentUrl: string | null,
  drawingAttachmentUrl: string | null,
  finalOptionId: string | null,
  createdAt: string,
  updatedAt: string
}
```

## JobComparisonOption

This is the most important structural recommendation.

Each option added to a job must contain a **snapshot** of the catalog item at the time it was selected.

```ts
{
  id: string,
  jobId: string,
  ownerUserId: string,
  catalogItemId: string | null,
  vendor: string,
  manufacturer: string,
  productName: string,
  material: string | null,
  thickness: string | null,
  size: string | null,
  imageUrl: string | null,
  sourceUrl: string | null,
  selectedPriceType: string | null,
  selectedPriceLabel: string | null,
  selectedPriceValue: number | null,
  priceUnit: string | null,
  estimatedMaterialCost: number | null,
  snapshotData: Record<string, unknown>,
  notes: string,
  createdAt: string,
  updatedAt: string
}
```

### Why snapshotting matters

Supplier data can change:

- prices update
- images change
- connector results change
- product metadata may be revised

The selected option should remain understandable later even if the live catalog shifts.

---

## MVP Workflow

## 1. Signed-in internal user

The authenticated staff member is the top-level owner of the workflow.

Examples:

- Ryan
- Jerry

They should only see and manage their own customer/job records unless the existing auth model already supports broader internal visibility.

## 2. Customers

Add a **Create Customer** button.

This opens a modal with a basic customer form.

Required/initial fields:

- first name
- last name
- phone
- email
- address
- notes

The customer should be stored in Firebase under that signed-in user.

## 3. Jobs

Under a customer, allow creating one or more jobs.

Example:

- Bill Driscoll
  - Kitchen
  - Vanity
  - Laundry Room

Required job fields for MVP:

- job name
- area type
- square footage (**required**)
- notes
- assumptions
- optional DXF attachment placeholder
- optional drawing attachment placeholder
- status

### Recommended room presets

Provide quick-select area types such as:

- Kitchen
- Island
- Vanity
- Fireplace
- Bar
- Laundry
- Other

## 4. Compare Options

Inside each job, the rep should be able to browse the **existing supplier catalog** and add products/slabs into a job comparison set.

The comparison set should support:

- multiple candidate options
- side-by-side viewing
- image comparison
- vendor comparison
- thickness/size visibility
- price basis selection
- estimated material total based on square footage

## 5. Final Selection

A rep should be able to mark one comparison option as the final selected material.

The job should retain:

- all shortlisted options
- final chosen option

## 6. Quote Summary

The rep should be able to generate a clean summary that includes:

- rep info
- customer info
- job info
- square footage
- selected slab/product
- image
- vendor
- thickness
- slab size if available
- selected price basis
- estimated total
- notes / assumptions
- date

MVP can be:

- printable view
- export-ready structured summary

A print-optimized page is acceptable for phase 1.

---

## Cost Calculation Rules for MVP

Keep cost math simple and explicit.

### If price per square foot exists

```ts
estimatedMaterialCost = squareFootage * selectedPriceValue
```

### If only slab pricing exists

Support a simpler slab-based estimate path:

- show slab price clearly
- allow quantity if needed
- calculate slab-based total only if the chosen price type supports it

### Important

Do not hide or obscure the pricing basis.

The UI should explicitly show:

- entered square footage
- selected price type
- selected price value
- estimated material cost

---

## Required UI Areas

## Compare Tool landing area

A top-level area/page for the workflow that shows:

- current user’s customers
- recent jobs
- Create Customer button

## Customer Detail View

Should show:

- customer information
- jobs under that customer
- Create Job button

## Job Detail View

Should show:

- job metadata
- square footage
- notes / assumptions
- comparison options
- Add Product / Add Slab button
- side-by-side comparison view
- final selection action
- open quote summary action

## Add-to-Compare Modal / Workspace

This should reuse the existing supplier catalog browsing/search/filtering workflow.

Do **not** build a second disconnected catalog browser.

Use the current product source so reps can:

- search supplier products
- view images
- compare metadata
- add chosen items to a job

## Quote Summary View

A customer-facing clean internal summary that is printable.

---

## Firebase Persistence Recommendation

Because the app already has Firebase connected, use it as the system of record for:

- customers
- jobs
- job comparison options
- final selections

Prefer real persistence over local-only state.

### Suggested Firebase collections

Possible structure:

```text
users/{userId}
customers/{customerId}
jobs/{jobId}
jobComparisonOptions/{optionId}
```

Or, if the current Firebase structure is already opinionated, adapt to the existing pattern.

### Ownership

Each customer/job/option should include `ownerUserId`.

This supports:

- per-rep ownership
- security rules
- future team visibility decisions

### Security

Respect the existing auth model and implement Firestore rules consistent with the current project.

---

## Export / Summary Requirements

The quote summary must include:

- internal rep/user
- customer name
- contact info if needed
- job name / area type
- square footage
- shortlisted/final product context
- selected final material
- image
- vendor/manufacturer
- thickness
- slab size if available
- price basis used
- estimated total
- date
- notes / assumptions

### Recommended assumptions section

Even in MVP, support a text field or summary block for assumptions such as:

- material estimate only
- fabrication not included
- install not included
- subject to final template verification
- sink cutouts not included

This helps avoid downstream confusion.

---

## DXF / Drawing Support

DXF support is **phase 2**, but the data model should already allow:

- DXF attachment URL
- drawing attachment URL

Do not fully implement DXF parsing in MVP.

### Phase 2 goals

Later enhancements can include:

- DXF upload
- simple DXF viewer
- square footage extraction from basic closed geometry
- job layout preview
- multiple layout versions

For now, **manual square footage entry is required**.

---

## Recommended UX Improvements

These should be included or prepared for if practical.

## Job status

Support a simple status field:

- draft
- comparing
- selected
- quoted
- closed

## Shortlist vs final selection

A job should keep multiple comparison options but explicitly mark one as final.

## Transparent pricing context

Every comparison card should show:

- which price basis is being used
- the price value
- estimated total

## Print-friendly summary

A good print stylesheet may be enough for MVP.

## Snapshot-based options

This is required.

---

## Integration Constraints

Cursor must:

- inspect the current project structure first
- inspect the current auth/user flow first
- inspect the current Firebase wiring first
- inspect how current catalog records are loaded first
- inspect how current product images and price fields are structured first

Then integrate this workflow into the existing system.

Do not:

- create a disconnected second catalog
- break current supplier connectors
- break current catalog browsing
- break current sign-in behavior
- overengineer DXF
- assume price data is uniform across all vendors

---

## Suggested Implementation Sequence

1. Review current repo structure
2. Review current Firebase/auth setup
3. Identify current catalog/product data model
4. Add Firebase-backed customer model
5. Add Firebase-backed job model
6. Add Firebase-backed job comparison option model
7. Add Compare Tool landing page/route
8. Add Create Customer modal
9. Add Create Job modal
10. Reuse existing catalog browsing for Add-to-Compare
11. Implement option snapshotting
12. Implement simple quote math
13. Implement final selection logic
14. Implement printable quote summary
15. Add README/update notes

---

## Cursor Implementation Prompt

Use the following prompt after ingesting this spec.

---

# Cursor Prompt: Implement Compare Tool Quote Workflow

Review our current React/Vite supplier catalog project and implement a new internal Compare Tool workflow inside the existing app using Firebase persistence.

## Important
- Build this into the CURRENT project structure, not a greenfield app
- Reuse our current auth/user model, supplier catalog data, images, pricing, vendor filters, and existing UI patterns wherever possible
- Do not redesign the whole project unless required for clean integration
- This is an internal Bella Stone sales workflow tool used by signed-in staff
- It is deployed on Vercel and company-side protected/authenticated
- Firebase is already connected and should be used for persistence

## Goal
Add a Compare Tool workflow that lets a signed-in internal user:
1. create a customer
2. create a job under that customer
3. enter required square footage
4. choose candidate slabs/products from the existing catalog
5. compare those options side by side
6. mark one final selection
7. generate a clean final quote summary

## Scope
Implement the MVP described in the spec file.

### Required entities
Use Firebase-backed entities for:
- Customer
- Job
- JobComparisonOption

### Critical requirement
When a product is added to a job comparison, store a snapshot of the item and selected price context so the quote remains understandable even if supplier data later changes.

### Customer fields
- firstName
- lastName
- phone
- email
- address
- notes
- ownerUserId
- timestamps

### Job fields
- customerId
- ownerUserId
- name
- areaType
- squareFootage (REQUIRED)
- notes
- assumptions
- status
- dxfAttachmentUrl (placeholder)
- drawingAttachmentUrl (placeholder)
- finalOptionId
- timestamps

### JobComparisonOption fields
- jobId
- ownerUserId
- catalogItemId
- vendor
- manufacturer
- productName
- material
- thickness
- size
- imageUrl
- sourceUrl
- selectedPriceType
- selectedPriceLabel
- selectedPriceValue
- priceUnit
- estimatedMaterialCost
- snapshotData
- notes
- timestamps

## UI workflow
Build this as:
- Compare Tool landing page
- customer list
- Create Customer modal
- customer detail view
- Create Job modal
- job detail view
- Add-to-Compare flow using the EXISTING catalog browser/data
- side-by-side comparison area
- final selection action
- printable/final quote summary view

## Important implementation rules
- Reuse the existing catalog and product data flow
- Do not build a separate disconnected catalog system
- Reuse current product images and metadata
- Preserve all existing supplier catalog behavior
- Preserve all existing auth/sign-in behavior
- Do not break vendor connectors/sync flows
- Keep DXF parsing out of MVP, but structure for phase 2
- Keep the UX practical for live customer-facing guided sales

## Cost calculation
Implement simple transparent MVP quote math:
- if price per sqft exists: estimatedMaterialCost = squareFootage * selectedPriceValue
- if slab-only pricing exists: support a clear slab-based estimate path without pretending it is sqft pricing
- always show the pricing basis used

## Summary export
Implement a printable/final quote summary that includes:
- rep/user
- customer
- job
- square footage
- final selected material
- product image
- vendor/product name
- thickness
- slab size if available
- price basis used
- estimated total
- notes / assumptions
- date

## Recommended UX additions
Include if practical:
- job status: draft / comparing / selected / quoted / closed
- shortlisted options plus final chosen option
- room presets like Kitchen, Island, Vanity, Fireplace, Bar, Laundry, Other
- assumptions section on the summary

## What to do first
Inspect the current codebase and determine:
- current auth structure
- current Firebase structure
- current catalog data-loading structure
- current product display / image rendering components
- the cleanest integration path for customers/jobs/options

Then implement accordingly.

## Deliverables
I want:
1. implementation integrated into the current project
2. all necessary new files
3. all modified files
4. any route additions
5. Firebase persistence integration
6. README/update note explaining:
   - where Compare Tool lives
   - how customers/jobs work
   - how square footage affects quote comparison
   - how final quote summary works

## Output expectations
- Return complete files, not snippets
- No pseudo-code
- No partial scaffolding
- No placeholders unless absolutely necessary
- Build this in a clean, production-usable way
- Base implementation choices on the actual existing repo structure

---

## What Cursor should review before implementing

Ask Cursor to review these before writing code:

- current auth/session handling
- current Firebase client usage
- any current Firestore patterns
- current app routes/pages
- current catalog product model
- current pricing structure
- current image rendering logic
- current export/print patterns if any

---

## Future Phase 2 Suggestions

After MVP, the strongest next upgrades are:

- DXF upload and attachment
- simple DXF viewer
- square footage extraction from simple CAD geometry
- quote version history
- PDF export
- fabrication/add-on line items
- remnant support
- slab yield estimation using slab size metadata
- customer-facing shareable summary view

