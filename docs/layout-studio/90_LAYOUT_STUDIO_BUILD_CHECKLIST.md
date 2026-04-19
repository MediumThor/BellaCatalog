# Layout Studio Build Checklist

Use this checklist before considering Layout Studio complete.

## Product fit
- [ ] The feature clearly serves quoting, not fabrication
- [ ] The workflow is attached to a specific material/job option
- [ ] The slab layout step feels like a natural part of BellaCatalog

## Core functionality
- [ ] User can open Layout Studio from an option/material context
- [ ] User can upload a source plan/image/PDF
- [ ] User can calibrate scale from a known dimension
- [ ] User can create rough piece shapes
- [ ] User can edit piece shapes
- [ ] User can mark sink presence/count
- [ ] User can place pieces on selected slabs
- [ ] User can rotate/move pieces on slab photos
- [ ] User can save the layout state
- [ ] Layout state persists correctly to the option/material context
- [ ] Quote-relevant outputs are computed

## Quote outputs
- [ ] Area is computed
- [ ] Finished edge length is computed or supported
- [ ] Sink count is tracked
- [ ] Estimated slab count is shown
- [ ] Unplaced pieces are clearly indicated

## UX quality
- [ ] Empty state feels premium
- [ ] Upload flow feels polished
- [ ] Calibration flow is clear
- [ ] Placement flow feels smooth
- [ ] Save state is obvious and trustworthy
- [ ] Warnings are calm and useful
- [ ] The screen feels customer-ready

## Visual design
- [ ] Styling follows the premium Bella style docs
- [ ] The UI feels cohesive and premium
- [ ] Motion is present but restrained
- [ ] The slab placement view is a “wow” moment
- [ ] The feature does not look like a generic admin interface

## Architecture
- [ ] Components are modular
- [ ] No giant god component owns the whole feature
- [ ] Persistence logic is abstracted
- [ ] Geometry utilities are separated from UI
- [ ] UI-only state is not mixed into persisted state
- [ ] Data model remains quote-focused

## Future-readiness
- [ ] Architecture does not block future AI assistance
- [ ] Source ingestion is modular
- [ ] DXF is not the core abstraction
- [ ] The feature can later support extraction suggestions without major rewrites
- [ ] User can start Layout Studio without uploading a source
- [ ] Empty state presents both upload and blank-canvas paths
- [ ] User can create a rectangle manually
- [ ] User can create an L-shape manually
- [ ] Manual pieces use the same placement/persistence model as traced pieces

## Cut phase (post-Quote fabrication handoff)

See [50_LAYOUT_STUDIO_CUT_PHASE.md](./50_LAYOUT_STUDIO_CUT_PHASE.md) and [60_CUT_PHASE_EXTERNAL_INTEGRATION.md](./60_CUT_PHASE_EXTERNAL_INTEGRATION.md).

- [ ] User can open the Cut phase after Quote
- [ ] User can select a scanned slab from the external library
- [ ] User can import a DXF from an external source
- [ ] DXF is never modified by Layout Studio (verified by checksum on export)
- [ ] DXF renders read-only in the right pane
- [ ] DXF can be positioned and rotated on the scanned slab in the left pane
- [ ] Scanned slab image is displayed at correct physical scale
- [ ] Out-of-bounds placement is warned, not blocked destructively
- [ ] Export produces an Alphacam-compatible handoff artifact with the original DXF unchanged
- [ ] External scanned-slab project is accessed via a replaceable service adapter (not hardcoded)
- [ ] Cut phase data persists separately from quote-focused layout state