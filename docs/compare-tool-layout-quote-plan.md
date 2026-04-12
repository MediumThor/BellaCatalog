# Compare Tool Layout + Real Quote Plan

## Status

This document is a **future design plan** for extending the current Compare Tool from a rough-quote workflow into a real slab layout and quoting workflow.

This is **not implemented yet**.

The current Compare Tool already supports:

- customer creation
- job creation
- rough square footage entry
- adding slab/product options from the catalog
- selecting a final option
- generating a quote summary

The goal of this document is to capture the recommended path for the next major phase.

---

## Current System Summary

The current Compare Tool is built as a quoting workflow inside the existing React/Vite app.

### Current route flow

- `/compare` -> landing page
- `/compare/customers/:customerId` -> customer detail
- `/compare/jobs/:jobId` -> job detail
- `/compare/jobs/:jobId/add` -> add catalog items to compare
- `/compare/jobs/:jobId/quote` -> printable quote summary

### Current persistence model

The Compare Tool currently persists three main entities in Firestore:

- `CustomerRecord`
- `JobRecord`
- `JobComparisonOptionRecord`

The key limitation today is that quote math is still driven by a single manual `squareFootage` value on the job.

That works for rough quoting, but it does **not** support:

- slab yield
- waste-aware pricing
- real slab placement
- customer piece layout
- quoting by true material usage vs. simple sqft assumption

---

## Problem To Solve

Today, a rep can:

1. create a customer
2. create a job like `Kitchen`
3. estimate square footage
4. compare material options
5. generate a rough quote

What we want next is:

1. define the actual countertop pieces
2. place those pieces on the slab in real space
3. account for waste and slab yield
4. calculate whether the quote should use partial slab usage, used area, or full slab count
5. move the job into a real `Quote` state based on layout-backed numbers rather than rough sqft only

This means the Compare Tool needs to become a **layout-aware quote workflow**, not just a product comparison tool.

---

## Product Goal

Turn the current process:

`Customer -> Job -> Rough sqft -> Compare -> Quote`

into:

`Customer -> Job -> Geometry -> Material Option -> Slab Layout -> Yield / Waste -> Final Quote`

The most important product shift is:

- the quote should be based on **what is actually used**
- not just what the customer receives
- and not just rough manual square footage

That includes:

- slab yield
- waste
- full slab usage when applicable
- final billable area or billable slab count

---

## Recommended Architecture

The cleanest design is to separate:

1. **job geometry**
2. **material option snapshot**
3. **option-specific slab layout result**

This keeps the current Compare Tool structure intact while adding the missing layer.

### Keep existing entities

- `CustomerRecord`
- `JobRecord`
- `JobComparisonOptionRecord`

### Add new concepts

- `JobGeometry`
- `JobOptionLayout`

This avoids overloading `snapshotData` with large mutable layout state.

---

## Why Separate Geometry From Layout

The job geometry and the slab layout are not the same thing.

### Job geometry

This describes what is being fabricated:

- countertops
- island tops
- splashes
- vanity pieces
- rectangular parts to start

This geometry belongs to the **job**, not to one slab option.

### Option layout

This describes how that geometry fits on a **specific selected slab option**:

- slab size
- slab image
- slab count
- piece placement
- yield
- waste
- billable quantity

This belongs to the **material option**, because different slabs have different sizes and usable layouts.

This is the most important modeling decision in the whole phase.

---

## Recommended Data Model

## 1. JobGeometry

Suggested collection:

- `jobGeometries/{jobId}`

Suggested shape:

```ts
{
  jobId: string,
  ownerUserId: string,
  sourceType: "manual" | "dxf",
  units: "in",
  parts: Array<{
    id: string,
    label: string,
    kind: "counter" | "island" | "splash" | "other",
    widthIn: number,
    heightIn: number,
    xIn: number,
    yIn: number,
    rotationDeg: 0 | 90 | 180 | 270
  }>,
  pieceAreaSqFt: number,
  sourceFileUrl: string | null,
  version: number,
  createdAt: string,
  updatedAt: string
}
```

### Notes

- Use **inches** as the canonical internal unit.
- Start with **rectangles only**.
- Restrict rotation to **90-degree increments** in the first version.
- This gives a practical fabrication-style layout tool without overengineering CAD.

---

## 2. JobOptionLayout

Suggested collection:

- `jobOptionLayouts/{optionId}`

Suggested shape:

```ts
{
  optionId: string,
  jobId: string,
  ownerUserId: string,
  slabWidthIn: number | null,
  slabHeightIn: number | null,
  slabImageUrl: string | null,
  placements: Array<{
    slabIndex: number,
    partId: string,
    xIn: number,
    yIn: number,
    widthIn: number,
    heightIn: number,
    rotationDeg: 0 | 90 | 180 | 270
  }>,
  pieceAreaSqFt: number,
  billableAreaSqFt: number | null,
  wasteAreaSqFt: number | null,
  utilizationPct: number | null,
  requiredSlabCount: number | null,
  quoteMode: "used_area" | "whole_slab",
  quotedUnitPrice: number | null,
  quotedTotal: number | null,
  status: "draft" | "approved",
  createdAt: string,
  updatedAt: string
}
```

### Why this matters

This record becomes the source of truth for:

- final slab usage
- billable sqft
- waste
- slab count
- final quoted amount

Once a layout is approved, the quote summary should read from this record instead of relying on rough job sqft alone.

---

## Recommended UI Flow

## Existing flow that should stay

- create customer
- create job
- add product / slab options from existing catalog
- compare shortlisted options
- mark final option

## New future flow

### Step 1. Define job geometry

After job creation, the rep should be able to define countertop pieces.

Initial version:

- add rectangles manually
- set width and height in inches
- name the piece
- rotate by 90 degrees
- move pieces in a simple editor

### Step 2. Create layout per option

For each selected compare option:

- open a slab layout screen
- use slab size from catalog data if available
- use slab image as a visual underlay
- place the job rectangles on the slab
- support one or more slabs

### Step 3. Approve option layout

Each option should have a layout status:

- not started
- draft
- approved

### Step 4. Move to quote

A job should move to a real quote state only when:

- geometry exists
- at least one option has a valid layout
- a final option is selected
- the final option layout is approved

---

## Recommended New Route

Add a dedicated layout editor route instead of overloading the quote page.

Recommended options:

- `/compare/jobs/:jobId/layout`
- `/compare/jobs/:jobId/options/:optionId/layout`

The second route is cleaner because layout is naturally tied to a specific material option.

Recommended route:

- `/compare/jobs/:jobId/options/:optionId/layout`

This avoids confusion between shared job geometry and per-option slab layout.

---

## Recommended Editor Technology

Use **SVG** first.

### Why SVG is the best fit here

- native in browser
- easy to overlay geometry on a slab image
- easy to map inches into a shared coordinate system
- easy to label pieces
- easier than a full CAD stack for the first version
- simpler to keep type-safe in React/TypeScript

### What not to do first

Do **not** start with:

- a heavy CAD framework
- free-angle rotation
- arbitrary polygon drawing
- full DXF parsing and editing

The repo currently does not have a geometry or CAD dependency. SVG is the most practical first step.

---

## Coordinate System Recommendation

Use **real-world inches** as internal layout coordinates.

### Slab space

- slab origin: top-left or bottom-left, but choose one consistently
- slab width: `slabWidthIn`
- slab height: `slabHeightIn`

### Part space

Each rectangle part stores:

- width in inches
- height in inches
- x position in inches
- y position in inches
- 90-degree rotation

### Rendering

The SVG `viewBox` should map directly to slab dimensions:

```ts
viewBox={`0 0 ${slabWidthIn} ${slabHeightIn}`}
```

The slab image should be rendered as a background layer, scaled into the same coordinate system.

This gives a real-space editor without depending on image pixels for geometry.

---

## Rectangle-Only First Version

The first real quoting version should support:

- rectangles only
- drag
- move
- rotate 90 degrees
- multi-slab layout

This is enough to unlock:

- kitchen sections
- island tops
- vanity tops
- splash pieces
- basic yield estimation

Later phases can expand to:

- L-shapes
- polygonal parts
- sink cutout-aware geometry
- seam markers
- edge annotations

But rectangles are the right first milestone.

---

## DXF Strategy

DXF should be phase 2, not phase 1 of this layout system.

### Why

The repo already planned DXF support as a later phase.

The current codebase has:

- `dxfAttachmentUrl`
- `drawingAttachmentUrl`

but no DXF parser, viewer, or upload workflow yet.

### Better rollout

#### First

- manual geometry editor
- real slab placement
- quote based on layout

#### Then

- Firebase Storage upload
- DXF file persistence
- DXF parsing for simple shapes
- manual cleanup after import

This sequence gives business value faster and avoids blocking the entire phase on CAD import complexity.

---

## Quote Calculation Recommendation

Once layout exists, `job.squareFootage` should become a **fallback rough quote input**, not the primary source of truth.

### Today

Quote math is based on:

- manual `squareFootage`
- selected pricing line
- slab quantity if needed

### Future

Quote math should be based on:

- layout-derived billable area
- layout-derived slab count
- waste-aware usage

### Two quote modes to support

#### 1. `used_area`

Use when the quote is based on actual billable area:

```ts
quotedTotal = billableAreaSqFt * quotedPerSqFt
```

#### 2. `whole_slab`

Use when the quote should be based on full slab usage:

```ts
quotedTotal = requiredSlabCount * quotedSlabPrice
```

This is important because many real-world quotes are not based only on net part sqft.

They are based on:

- slab usage
- unusable waste
- remaining remnant value assumptions
- whether the job effectively consumes the slab

---

## What The Layout Summary Should Show

For each option layout, show:

- piece area
- billable area
- waste area
- utilization %
- slab count required
- slab dimensions
- quote mode
- quoted total
- layout status

This lets reps compare not just material appearance, but also:

- yield efficiency
- slab consumption
- true quote impact

That is where this becomes a real sales tool.

---

## Integration With Existing Compare Tool

The current compare workflow should remain the backbone.

### `CustomerDetailPage`

No major change needed.

### `JobDetailPage`

This should become the control center for:

- geometry status
- option layout status
- final layout approval state
- move to quote

Each option card should eventually show:

- `Open layout`
- `Layout status`
- `Required slabs`
- `Billable sqft`
- `Quoted total`

### `AddToComparePage`

Should stay focused on:

- selecting material options from the catalog
- choosing quoted pricing basis

It should **not** become the layout editor.

### `QuoteSummaryPage`

Should remain the printable / clean quote output.

But once layout exists, it should read:

- layout-derived billable area
- slab count
- waste-aware quote total

instead of relying only on job-level rough sqft.

---

## Firebase / Persistence Notes

### Current gap

The Firebase app config includes a storage bucket, but the app currently does not appear to be using Firebase Storage in the UI layer yet.

That means the future layout phase should explicitly include:

- file upload flow
- DXF upload persistence
- drawing/image attachment persistence

### Recommendation

Use Firestore for:

- metadata
- geometry records
- layout records
- quote summaries

Use Firebase Storage for:

- DXF files
- uploaded drawings
- generated layout exports if needed later

---

## Recommended Build Order

## Phase 1: Foundations

1. add `JobGeometry` persistence
2. add `JobOptionLayout` persistence
3. add service layer functions in `compareQuoteFirestore.ts` or a new compare layout service
4. add new route(s) for layout editing
5. show layout status in job detail

## Phase 2: Manual geometry editor

1. build SVG slab canvas
2. support manual rectangle creation
3. allow drag / move / rotate
4. support multiple slab sheets
5. compute area, waste, utilization, slab count

## Phase 3: Quote integration

1. update quote summary to prefer approved layout data
2. keep rough sqft as fallback only
3. gate `Quote` state on approved layout + final option

## Phase 4: Uploads

1. add Firebase Storage upload support
2. allow drawing upload
3. allow DXF upload placeholder
4. persist URLs into job records

## Phase 5: DXF import

1. parse simple DXF geometry
2. map closed simple entities into rectangles or editable parts
3. allow manual cleanup after import

---

## Important Constraints

This feature should be implemented in a way that:

- reuses the existing Compare Tool workflow
- does not replace the current catalog browser
- does not invent a disconnected second app
- does not make DXF parsing a blocker for real quoting
- keeps the first layout editor practical and fabrication-oriented

The priority should be:

1. real quoting value
2. practical sales workflow
3. simple reliable geometry model
4. future DXF extensibility

not CAD completeness.

---

## Recommended First Milestone

If this work is resumed later, the best first milestone is:

### Milestone: Manual Layout MVP

Build a per-option layout editor that supports:

- manual rectangle parts
- slab dimensions
- slab image underlay
- drag / move / rotate parts
- multi-slab placement
- layout-derived billable area
- slab count
- waste
- quoted total

This gives immediate business value and can later accept DXF-imported geometry.

---

## Open Product Questions To Resolve Before Implementation

1. Should first version support **rectangles only**, or do we need basic L-shapes immediately?
2. Should rotation be limited to **90-degree increments** initially?
3. For sqft-priced materials, should billing use:
   - exact used area
   - used area plus waste margin
   - manual approved billable area override
4. For slab-priced materials, should billing always round to full slabs?
5. Should one job have one shared geometry definition for all options?
   - recommended answer: **yes**
6. Should quote state be blocked until the final option has an **approved layout**?
   - recommended answer: **yes**

---

## Bottom Line

The Compare Tool already has the right high-level workflow:

- customer
- job
- options
- final selection
- quote summary

What it needs next is a **layout layer** between option selection and final quote.

The recommended direction is:

- shared job geometry
- per-option slab layouts
- SVG-based manual layout editor first
- layout-driven quote totals
- DXF import later

That path fits the current codebase, extends the current Firestore model cleanly, and gets the product from rough quoting to real slab-based quoting without overengineering the first implementation.
