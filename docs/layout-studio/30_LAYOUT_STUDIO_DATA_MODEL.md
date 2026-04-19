# Layout Studio Data Model

## Goal

Define the data model for Layout Studio in a way that:
- fits BellaCatalog’s existing data structure
- persists per material/job option
- remains simple and quote-focused
- supports future refinement without requiring a schema rewrite

---

## Core modeling principle

The saved layout must belong to the specific option/material context, not just the job.

Reason:
- slab sizes differ by option
- selected slab inventory differs by option
- slab count may differ by option
- visual presentation may differ by option

Therefore layout data should be saved on or under the option-level record.

---

## Persisted entities

The persisted Layout Studio state should contain:

1. source
2. calibration
3. pieces
4. placements
5. summaries
6. preview metadata
7. audit metadata

---

## Recommended shape

This is an example model, not a mandatory exact schema.

```ts
type SavedLayoutStudioState = {
  version: number
  source: {
    kind: 'pdf' | 'image' | 'dxf' | 'unknown'
    fileUrl: string
    fileName: string
    uploadedAt: string
  } | null
  calibration: {
    isCalibrated: boolean
    pointA: { x: number; y: number } | null
    pointB: { x: number; y: number } | null
    realDistance: number | null
    unit: 'in' | 'ft' | 'mm' | 'cm' | null
    pixelsPerUnit: number | null
  }
  pieces: Array<{
    id: string
    name: string
    points: Array<{ x: number; y: number }>
    sinkCount: number
    hasBacksplash?: boolean
    notes?: string
    edgeTags?: {
      finishedEdgeIndices?: number[]
      backsplashEdgeIndices?: number[]
    }
    source?: 'manual' | 'imported' | 'ai-suggested'
  }>
  placements: Array<{
    id: string
    pieceId: string
    slabId: string | null
    x: number
    y: number
    rotation: number
    mirrored?: boolean
    placed: boolean
  }>summary: {
    areaSqFt: number
    finishedEdgeLf: number
    sinkCount: number
    backsplashLf?: number
    estimatedSlabCount: number
    unplacedPieceCount: number
  }
  preview?: {
    imageUrl?: string
    generatedAt?: string
  }
  updatedAt: string
  updatedBy?: string
}
Data simplification rules

Keep data quote-focused.

Do not store:

true CAD constraint graphs
dense drawing event logs
detailed sink cutout paths
corner radii models
fabrication-layer edge profile geometry
heavy derived calculations that can be recomputed cheaply

Prefer:

simple normalized polygons
simple placement transforms
simple summary values
Versioning

Include a version field in saved layout state.

Reason:

future AI extraction may add fields
future export modes may add metadata
future preview generation may change shape

A simple integer version is sufficient.

Source model

Source should capture enough metadata to:

render the original source again
support future re-extraction
preserve traceability

Minimum:

kind
url
file name
upload timestamp

Optional in future:

dimensions
page number
original image size
OCR metadata
extraction provenance
Piece model

Each piece is an approximate quoted countertop piece.

A piece should contain:

a unique id
a name
polygon points
sink count
optional notes
optional backsplash metadata
optional finished edge tagging

This is enough for V1.

Placement model

Placement should be simple and visual.

Each placement should contain:

piece id
slab id
x/y position
rotation
mirrored flag if supported
placed flag

Avoid storing more than is necessary.

Summary model

Summary values are quote-facing convenience outputs.

These can be stored for convenience, but should be recomputable.

Recommended values:

area square feet
finished edge linear feet
sink count
backsplash linear feet
estimated slab count
unplaced piece count
Storage location guidance

Best preference:

store layout data at the option/material-selection layer

Fallback acceptable:

store in a layout subcollection referenced from the option

Avoid:

storing only on the job root if multiple material options exist
storing layout separately with weak linkage
creating ad hoc duplicate state in several locations
Preview image

If a preview snapshot is generated, treat it as optional derived output.

The layout should still be fully reconstructable without the preview image.

Store preview metadata separately from the core geometry state.

---

## Cut phase data

Cut is **not** merged into `SavedLayoutStudioState`. Persist a **sibling** record (conceptually `CutPhaseState`) per option/area as implementation allows, so quote layout data stays clean.

**Rules:**

- The **DXF file referenced here is immutable.** Any re-import **replaces** the Cut-phase DXF record end-to-end; there is no in-place edit path.
- **Scanned slab images** are **not** copied into BellaCatalog’s canonical material catalog. Reference the external library by **external id** (and URLs only as returned by that system).

Example shape (illustrative):

```ts
type CutPhaseState = {
  version: number
  dxf: {
    fileUrl: string
    fileName: string
    uploadedAt: string
    /** e.g. SHA-256 of original bytes — export must verify match */
    checksum: string
  } | null
  slabScan: {
    externalId: string
    sourceProject: string
    imageUrl: string
    widthIn: number
    heightIn: number
    pixelsPerInch?: number
    fetchedAt: string
  } | null
  placement: {
    x: number
    y: number
    rotation: number
    mirrored?: boolean
  } | null
  export: {
    status: 'idle' | 'pending' | 'ready' | 'error'
    lastExportedAt?: string
    exportArtifactUrl?: string
  }
  updatedAt: string
  updatedBy?: string
}
```

See also [50_LAYOUT_STUDIO_CUT_PHASE.md](./50_LAYOUT_STUDIO_CUT_PHASE.md) and [60_CUT_PHASE_EXTERNAL_INTEGRATION.md](./60_CUT_PHASE_EXTERNAL_INTEGRATION.md).

Data anti-patterns to avoid

Avoid:

storing both raw and normalized geometry without clear ownership
mixing UI-only state into persisted data
keeping inconsistent units across objects
storing slab objects duplicated from canonical records unless intentional
overloading the model with fabrication semantics