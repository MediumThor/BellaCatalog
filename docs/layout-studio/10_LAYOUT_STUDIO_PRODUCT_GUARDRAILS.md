# Layout Studio Product Guardrails

## Core rule

Layout Studio is a quote-first visual layout tool.

Every implementation choice should be evaluated against this rule:
> Does this make quoting and customer-facing slab visualization better, faster, and clearer?

If not, it is likely out of scope.

---

## What Layout Studio must do

Layout Studio must:

- allow a user to upload a source drawing or image
- allow calibration using a known real-world dimension
- allow creation of approximate countertop piece shapes
- allow piece-by-piece placement on slab photos
- allow visual comparison across material options
- estimate slab count and usage at a practical quoting level
- persist state per option/material context
- produce useful downstream quote data

---

## What Layout Studio must not become

Layout Studio must not become:

- a full CAD package
- a fabrication tool
- a machining tool
- a precision nesting engine
- an engineering drafting product
- a giant geometry research project

If implementation choices push the feature toward those outcomes, pull back.

---

## Accuracy standard

The feature is intended for quoting only.

Accepted standard:
- approximate shape to roughly the nearest inch
- useful area estimate
- useful finished edge estimate
- useful slab count estimate
- sink as an entity, not detailed geometry

Not required:
- fabrication-grade corner detail
- exact sink dimensions
- exact edge profile geometry
- detailed cutout radii
- true final shop-ready seam layout

---

## User experience standard

This feature is customer-facing.

Therefore it must feel:
- premium
- calm
- polished
- fast
- visually persuasive
- easy to understand
- trustworthy

This is not back-office tooling.
Do not design it like an internal admin panel.

---

## Scope boundaries for geometry

Allowed:
- rectangles
- L-shapes
- polygons
- vertex editing
- rough edge tagging
- sink presence markers
- optional backsplash metadata

Avoid unless explicitly required:
- splines
- arc-heavy editing
- parametric constraints
- dimensional solver systems
- true CAD-style snapping complexity
- fabrication-grade topology logic

---

## Scope boundaries for slab layout

The slab layout phase is manual and artistic.

The system should assist, not dictate.

Allowed:
- drag
- rotate
- assign pieces to slabs
- visually review fit
- approximate usage summary

Avoid unless explicitly required:
- aggressive auto-placement
- auto-seam optimization
- “best layout” claims
- hidden logic that decides artistic outcomes

---

## Data modeling guardrail

DXF is not the core domain object.

The core domain object is:
- a layout tied to a specific job option/material context

The most important persisted objects are:
- uploaded source
- calibration
- layout pieces
- placements on slabs
- slab usage summary
- preview state

If an implementation starts centering around DXF instead of the quoting workflow, correct course.

---

## AI guardrail

Future AI assistance is allowed.
V1 should not depend on AI.

The architecture should support future capabilities such as:
- OCR of dimensions
- rough shape suggestions
- image-based extraction
- imported geometry suggestions

But V1 must be fully usable without them.

Human correction and review must remain central.

---

## Decision heuristic

When uncertain, optimize for:

1. maintainability
2. premium user experience
3. quote usefulness
4. speed in a live sales setting
5. future extensibility

Do not optimize for theoretical CAD completeness.