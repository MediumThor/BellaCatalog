# Layout Studio: Cut Phase

## Purpose

The **Cut** phase is the fourth Layout Studio phase, **after Quote**:

`Plan (trace)` → `Layout (place)` → `Quote` → **Cut**

Cut is a **fabrication handoff** step: it connects the quoted layout to **real physical inventory** (scanned slabs) and prepares output for **Alphacam** (external) toolpath generation. It is **not** a customer-facing sales step; it is optional and intended for internal shop use after quoting is settled.

---

## Relationship to existing phases

- Cut **does not replace** Plan, Layout, or Quote. Those phases remain quote-first and visual.
- Cut **consumes** the context of a finalized job option (geometry and decisions from earlier phases) and adds:
  - a **specific scanned slab** from real inventory (via the external scanned-slab library — see [60_CUT_PHASE_EXTERNAL_INTEGRATION.md](./60_CUT_PHASE_EXTERNAL_INTEGRATION.md))
  - an **externally sourced DXF** (e.g. exported from another CAD workflow)
  - a **placement** of that DXF on the scanned slab image at correct physical scale
- The Cut phase output is **handed off** to Alphacam; BellaCatalog does not generate toolpaths.

---

## Two-pane workspace

| Pane | Role |
|------|------|
| **Left — Slab placement** | Shows the selected **scanned slab image** (real slab from inventory, **properly sized** to physical dimensions). The user positions the DXF footprint **on** this slab (drag, rotate; optional mirror if product allows). |
| **Right — DXF** | Shows the **imported DXF as received**: read-only reference and verification. No geometry editing. |

---

## DXF fidelity (hard invariant)

**The uploaded DXF must not be changed in any way.**

This is a first-class invariant (same weight as the quote-first rule in [10_LAYOUT_STUDIO_PRODUCT_GUARDRAILS.md](./10_LAYOUT_STUDIO_PRODUCT_GUARDRAILS.md)).

- Any transformation (translation, rotation, optional mirror) is stored as **metadata** alongside the stored original file — **not** baked into the DXF bytes.
- Re-import of a DXF replaces the Cut-phase DXF record; there is no in-place edit path inside the DXF.

---

## Inputs

1. **DXF file** — from an external source (import only; byte-identical preservation enforced via checksum in persisted state — see [30_LAYOUT_STUDIO_DATA_MODEL.md](./30_LAYOUT_STUDIO_DATA_MODEL.md)).
2. **Scanned slab** — image + calibration / physical dimensions + inventory identity from the **external scanned-slab project** (separate system; details TBD — see [60_CUT_PHASE_EXTERNAL_INTEGRATION.md](./60_CUT_PHASE_EXTERNAL_INTEGRATION.md)).

---

## Interaction loop (target)

1. Pick a scanned slab from the external library (left pane context).
2. Import DXF — loads in the **right pane** (read-only view).
3. Position and rotate the DXF on the slab in the **left pane**.
4. Confirm and **export** a handoff package for Alphacam.

---

## Export and Alphacam

- **Goal:** Export a package the shop can bring **back into Alphacam** for toolpaths (external process).
- **Must include:** The **original DXF file unchanged** (same bytes as uploaded).
- **Must express:** Placement as a **transform** (e.g. translation + rotation, optional mirror) relative to the scanned slab’s **calibrated coordinate system**.
- **Open question:** Exact file layout, sidecar format, and Alphacam-side conventions — **TBD** when shop workflow and tooling access are confirmed.

---

## Empty and error states

Design for clarity, not punishment:

- No scanned slabs available in the external library (or service unreachable).
- DXF fails to parse or cannot be previewed (original file still stored if policy allows; user sees actionable error).
- **Unit / scale mismatch** between DXF and slab (warn; block export until resolved or explicitly acknowledged per product policy).
- Placement **extends beyond** slab bounds — **warn**; prefer not to block destructively unless policy requires it.

---

## Related documents

- [00_LAYOUT_STUDIO_OVERVIEW.md](./00_LAYOUT_STUDIO_OVERVIEW.md) — product overview including Cut in the core workflow
- [60_CUT_PHASE_EXTERNAL_INTEGRATION.md](./60_CUT_PHASE_EXTERNAL_INTEGRATION.md) — external scanned-slab project (placeholder)
- [30_LAYOUT_STUDIO_DATA_MODEL.md](./30_LAYOUT_STUDIO_DATA_MODEL.md) — `CutPhaseState` shape
