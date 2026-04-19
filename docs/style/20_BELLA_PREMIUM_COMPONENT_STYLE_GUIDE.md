# Bella Premium Component Style Guide

## Goal

Define how common UI components should look and feel under BellaCatalog’s premium visual language.

These are style guardrails for both Layout Studio and future product-wide refactors.

---

## Glass panels

Glass panels are foundational.

They should feel:
- luminous
- soft
- elevated
- calm
- premium

A strong glass panel usually includes:
- translucent background
- blur
- subtle border
- layered shadow
- restrained inner highlight
- generous padding

Use glass panels for:
- sidebars
- inspectors
- floating summaries
- hero empty states
- tool trays

---

## Toolbars

Toolbars should feel compact and premium, not mechanical.

Recommended qualities:
- semi-floating
- translucent
- segmented where appropriate
- clear active states
- elegant spacing
- subtle emphasis for primary actions

Avoid cramming too many controls into a single row if it hurts clarity.

---

## Buttons

Buttons should feel tactile and polished.

### Button categories
- primary (the single brand CTA on a screen — filled red `.btn-primary`)
- secondary (default `.btn` — soft neutral)
- ghost (`.btn-ghost`)
- success / positive intent (`.btn-success` — green outline)
- danger / negative intent (`.btn-danger` — red outline)
- icon button
- segmented toggle button

### Desired behavior
- hover feels soft and responsive
- press feels slightly compressed/tactile
- focus is visible but elegant
- active state feels premium, not default-browser harsh

Primary buttons should feel luminous and important.
Secondary buttons should feel refined, not weak.

### Intent color convention (site-wide)

Action color carries meaning. Apply consistently so reps can scan a
screen and know what each button will do without reading the label
twice.

- **Positive / constructive actions → `.btn-success` (green outline)**
  - Use for: *Approve, Approve quote, Accept, Confirm, Create, Save,
    Mark complete, Mark paid, Publish, Send, Add (when it commits a
    creation).*
  - Outline-first so multiple positive actions on one screen don't
    fight for attention.

- **Negative / destructive actions → `.btn-danger` (red outline)**
  - Use for: *Cancel, Delete, Remove, Reject, Decline, Archive,
    Discard, Clear, Revoke, Unassign.*
  - Reserve filled red (`.btn-primary`) for the single dominant brand
    CTA on a screen; do **not** use it for destructive actions or it
    will read as "do this" instead of "be careful."

- **Neutral / navigational actions → `.btn` or `.btn-ghost`**
  - Use for: *Open, View, Edit, Studio, Back, Close (without losing
    work), Filter, Sort.*

- **The single brand CTA → `.btn-primary` (filled red)**
  - One per screen, max. The "do the headline thing" button (e.g.
    *Record payment*, *Create job*).

#### Examples

```html
<!-- Approve a quoted layout as the customer's choice -->
<button class="btn btn-success btn-sm">Approve quote</button>

<!-- Remove a payment from the ledger -->
<button class="btn btn-danger btn-sm">Delete payment</button>

<!-- Open Layout Studio -->
<a class="btn btn-ghost btn-sm">Open in Studio</a>

<!-- Headline CTA for the whole screen -->
<button class="btn btn-primary">Record payment</button>
```

When in doubt, ask: *"If the rep clicks this by accident, is it
constructive or destructive?"* — that's the color.

---

## Cards

Cards should feel like curated presentation surfaces, not generic tiles.

Use cards for:
- slab thumbnails
- option previews
- saved layouts
- summary metrics
- empty state calls to action

Cards should support:
- hover elevation
- clean hierarchy
- restrained metadata
- premium spacing

---

## Inputs

Inputs should feel premium and calm.

Desired qualities:
- clean interior spacing
- soft border treatment
- elegant placeholder text
- premium focus ring
- strong readability

Avoid:
- harsh rectangular input styling
- default browser-looking forms
- overly dense control rows

---

## Segmented controls

Segmented controls are a strong fit for mode switching.

They should feel:
- smooth
- premium
- softly animated
- obvious in active state
- not oversized unless used as a major mode selector

---

## Chips and tags

Use chips and tags for:
- piece names
- material metadata
- state indicators
- placed/unplaced status
- sink counts

They should be:
- compact
- elegant
- readable
- soft-edged

Avoid loud badge styling unless conveying important status.

---

## Metric cards

Metric cards are important for premium quoting visuals.

They should present:
- value first
- label second
- optional note or change indicator third

The visual design should emphasize confidence and readability.

---

## Inspectors and side panels

Inspectors should feel:
- clean
- premium
- focused
- supportive

They should not feel like a giant form dump.

Use grouping, spacing, and small headers to keep them calm and scannable.

---

## Modals and sheets

Modals should be used carefully.

Preferred qualities:
- soft backdrop
- glass treatment
- strong hierarchy
- not too cramped
- elegant entrance/exit motion

Use sheets or floating panels where they improve flow.

Avoid modal fatigue.

---

## Empty states

Empty states must look intentionally designed.

A premium empty state should include:
- a visual focal element
- a concise explanation
- one obvious next action
- enough whitespace to feel composed

Avoid raw placeholder text.

---

## Canvas-adjacent controls

Controls near canvases should feel integrated and premium.

Examples:
- zoom controls
- mode controls
- placement controls
- rotate/nudge controls

These should float elegantly over the workspace without cluttering it.