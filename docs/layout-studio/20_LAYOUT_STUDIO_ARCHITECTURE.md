# Layout Studio Architecture

## Architectural goal

Build Layout Studio as a modular feature inside BellaCatalog, integrated into the existing customer > job > option workflow.

It must not be a separate app.
It must not fork the product experience.
It must reuse existing patterns where sensible while being allowed to introduce stronger local architecture.

---

## Placement in product flow

Layout Studio should be attached to a specific material/job option context.

This is important because:
- different slab options may have different slab sizes
- different options may produce different slab counts
- different options may need different saved visual layouts

Therefore the layout state should be associated with a specific comparison option or equivalent existing option-level record.

---

## Recommended feature structure

Suggested file organization:

```txt
src/
  compare/
    layoutStudio/
      components/
      hooks/
      services/
      types/
      utils/
      constants/
```

---

## Cut phase architecture

Cut extends Layout Studio **inside** the same product surface (`src/compare/layoutStudio/`), still scoped to a **job option** (and area, if applicable). It is **downstream of Quote**.

### Mode

`LayoutStudioMode` will grow from `"trace" | "place" | "quote"` to include a fourth mode (suggested name: `"cut"`). See [`src/compare/layoutStudio/types.ts`](../../src/compare/layoutStudio/types.ts) (`LayoutStudioMode`).

### Source category

Cut introduces a distinct source of truth from Plan’s upload:

- **Plan:** user-supplied drawing / photo / PDF for tracing and quoting.
- **Cut:** **scanned slab** imagery and metadata from the **external** scanned-slab library (real inventory), plus an **immutable** imported DXF.

### External scanned-slab library

All calls to the separate scanned-slab project go through a **thin adapter** (service module). UI and hooks must not embed transport-specific URLs, auth, or wire formats.

### DXF handling

DXF **parse** and **render** (for preview) live in a **dedicated module** with a **read-only public API**: no APIs that write or normalize geometry back into the file. Placement is **application state**, not DXF mutation.

### Persisted data

Cut output (`CutPhaseState` — see [30_LAYOUT_STUDIO_DATA_MODEL.md](./30_LAYOUT_STUDIO_DATA_MODEL.md)) is a **sibling** artifact to quote-focused `SavedLayoutStudioState`. Keeping them separate preserves clean quote data and avoids merging fabrication handoff into the core layout draft.