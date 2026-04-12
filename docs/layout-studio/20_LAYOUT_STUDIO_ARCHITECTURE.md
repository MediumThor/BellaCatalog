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