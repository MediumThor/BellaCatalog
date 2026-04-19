# Cut Phase: External Scanned-Slab Library (Integration Placeholder)

## Status

**Separate project.** Repository access and API details **will be provided later**. This document is a **placeholder** to be expanded once that project is available and its contract is known.

The scanned-slab system is expected to run **on a separate computer** on the company network and to expose a **library of real slabs** that have been physically scanned — each entry tied to **actual inventory**.

---

## What it is (current understanding)

- A **standalone application or service** (not part of the BellaCatalog deploy).
- Maintains **scanned images** of real slabs in physical inventory.
- Each record represents a **concrete slab** (not a generic catalog swatch).

---

## What Layout Studio needs from it (contract — to be confirmed)

When integration is implemented, BellaCatalog will likely need:

- **List / search** scanned slabs (e.g. by material, dimensions, date, tags, inventory id).
- **Retrieve** a specific slab scan: **image** + **calibration / scale** + **physical dimensions** + **stable inventory / external id**.
- Optionally: **reserve** or **mark** a slab as in use for a cut job (TBD).

---

## What Layout Studio may send back (TBD)

Examples to decide with the external project owners:

- Registration of **which job/option** used which **inventory id**.
- Association of **export artifact** or **placement metadata** with that inventory record.
- Whether **writes** to the external library are supported at all.

---

## Integration boundary

- **Off-box:** not bundled with BellaCatalog; accessed over the network (or agreed IPC — TBD).
- **Auth:** mechanism TBD (API keys, mTLS, VPN-only, etc.).
- **Replaceable adapter:** BellaCatalog should call the external system only through a **thin service layer** so local development can use **mocks** without the external project running.
- **No tight coupling:** transport details (HTTP, gRPC, file drop, etc.) stay inside the adapter.

---

## Open questions (resolve when access is granted)

- Transport and endpoint(s).
- Authentication and authorization.
- Image format, resolution, and color space.
- Calibration metadata format (pixels per unit, origin, rotation).
- Coordinate system convention (corner vs center origin).
- Whether BellaCatalog **pushes** state back to the library or is **read-mostly**.
- Error handling and offline / degraded behavior.

---

## Related documents

- [50_LAYOUT_STUDIO_CUT_PHASE.md](./50_LAYOUT_STUDIO_CUT_PHASE.md) — Cut phase product behavior
- [30_LAYOUT_STUDIO_DATA_MODEL.md](./30_LAYOUT_STUDIO_DATA_MODEL.md) — `slabScan` external reference fields
