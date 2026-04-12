# Layout Studio Overview

## Purpose

Layout Studio is a customer-facing visual quoting feature for BellaCatalog.

It exists to help a sales rep and customer visually evaluate how a kitchen layout would sit on selected slab options before finalizing a quote.

This is not fabrication CAD.
This is not a CNC or shop-detailing tool.
This is not a precision nesting optimizer.

It is a premium, customer-facing, quote-first visual layout tool.

---

## Core workflow

The intended user flow is:

1. Create or open a customer
2. Create or open a job
3. Attach slab/material options to the job
4. Open Layout Studio for a specific option
5. Upload a plan, sketch, photo, or PDF
6. Calibrate scale
7. Create or trace rough countertop piece shapes
8. Place those pieces on slab photos
9. Visually review fit, slab count, and overall presentation
10. Save the result to that specific job option
11. Feed the result into quoting

---

## Business intent

This feature is meant to help quote more kitchens faster.

The output only needs to be quote-accurate, not fabrication-accurate.

The feature should support:
- material comparison
- slab-count estimation
- visual sales presentation
- rough area and finished edge calculations
- customer decision-making

The feature should not try to solve:
- fabrication geometry
- corner radii precision
- sink cutout detail
- seam perfection
- optimized CNC output
- final production layouts

---

## What matters most

Priority order:

1. Premium customer-facing experience
2. Fast and intuitive workflow for a sales rep
3. Useful visual slab placement
4. Practical estimate outputs for quoting
5. Maintainable architecture that supports future AI assistance

---

## Non-goals

The following are out of scope for V1 unless explicitly requested:

- full CAD system
- fabrication-ready DXF workflows
- advanced constraint solving
- true nesting optimization
- precise sink geometry
- corner radii detail
- detailed backsplash fabrication logic
- automatic final seam decisions
- production scheduling or downstream shop tooling

---

## Product framing

Layout Studio should be treated as a new premium workflow stage inside BellaCatalog.

It should feel like a meaningful, polished part of the product, not a bolted-on utility.

The feature should be emotionally persuasive as well as functionally useful:
- it should help the customer imagine the result
- it should help the rep guide the decision
- it should make BellaCatalog feel more premium than a normal quoting tool