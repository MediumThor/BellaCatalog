# Layout Studio Interaction Guide

## Goal

Define how Layout Studio should behave from a user interaction perspective.

This is a premium customer-facing feature.
The interactions should feel polished, calm, and confidence-inspiring.

---

## Primary interaction model

Layout Studio should feel like a guided premium workflow, not a technical editor.

The interaction should make it easy for a sales rep to guide a customer through:
- uploading a plan
- creating pieces
- placing them on slabs
- comparing visual outcomes

The user should always feel:
- oriented
- in control
- aware of what is saved
- aware of what is incomplete

---

## Recommended major modes

### Mode 1: Extract / Trace
The user works from a source file.

Key actions:
- upload source
- calibrate scale
- add or trace piece shapes
- edit vertices
- name pieces
- mark sink presence
- review rough metrics

### Mode 2: Place on Slabs
The user works visually with selected slabs.

Key actions:
- select slab
- drag pieces onto slab
- rotate pieces
- move pieces between slabs
- see estimated fit and usage
- save layout

These modes should be easy to switch between.

---

## UX principle: guided, not overwhelming

The feature should not present every control at once.

Prefer:
- contextual controls
- toolbars that react to selection
- focused inspectors
- progressive disclosure

Avoid:
- giant control panels
- dense CAD-like toolbars
- unexplained iconography
- requiring the user to understand geometry internals

---

## Upload interaction

The upload experience should feel elegant and reassuring.

Requirements:
- clear accepted file types
- polished drag-and-drop state
- visible file status after upload
- obvious next step after upload

Best behavior:
- after upload, guide the user into calibration
- do not leave them at a dead end

---

## Calibration interaction

Calibration should be one of the cleanest flows in the feature.

Recommended flow:
1. User enters calibration mode
2. User clicks point A
3. User clicks point B
4. App draws the calibration segment
5. User enters real-world distance
6. User selects units
7. App confirms scale

The UI should communicate:
- what the user is doing
- why it matters
- how to redo it

Calibration must feel trustworthy.

---

## Shape creation interaction

Shape creation should feel lightweight and forgiving.

Recommended tools:
- rectangle
- L-shape
- polygon

Best behavior:
- easy to start
- easy to cancel
- easy to edit after creation
- clear selected state
- clear handles

Editing should allow:
- drag vertices
- rename piece
- duplicate piece
- delete piece
- mark sink count
- optional edge tagging

---

## Selection behavior

Selected items must be visually obvious.

This includes:
- selected piece in a list
- selected piece on canvas
- selected slab
- selected tool

Selection should use premium emphasis, not harsh outlines.

Prefer:
- glow
- layered highlight
- subtle scale
- soft borders
- luminous edge treatment

Avoid:
- thick ugly outlines
- aggressive red boxes
- cheap default browser states

---

## Placement interaction

Placement is the hero interaction.

Requirements:
- smooth drag
- smooth rotation
- obvious active slab
- clear placed vs unplaced status
- visible piece identity during placement

Helpful behavior:
- nudge controls
- reset orientation
- move to another slab
- quick unplace / remove from slab

Do not over-automate placement.

---

## Warning behavior

Warnings should be informative, not punishing.

Examples:
- scale not set
- piece has invalid geometry
- not all pieces placed
- estimated fit exceeds slab bounds
- no slabs selected

Warnings should:
- explain the issue clearly
- suggest the next action
- avoid harsh alarmist tone

---

## Save interaction

Save state should feel polished and trustworthy.

Requirements:
- visible save status
- unsaved changes indication
- success confirmation
- graceful failure state
- retry path if save fails

Prefer:
- subtle inline save state
- calm confirmation pill
- non-disruptive feedback

Avoid:
- constant loud toasts
- unclear save behavior
- hidden persistence

---

## Empty states

Empty states matter because this is customer-facing.

Important empty states:
- no layout yet
- no source uploaded
- no slabs selected
- no pieces created
- no pieces placed

Each empty state should:
- look premium
- teach the next step
- not feel unfinished

---

## Microinteraction expectations

Good microinteractions include:
- hover lift on cards
- glass response on press
- spring selection transitions
- animated segmented controls
- animated save state transitions
- graceful panel reveals
- subtle canvas highlight behavior

All motion should reinforce clarity and polish.

---

## Interaction anti-patterns to avoid

Avoid:
- technical CAD jargon unless necessary
- modal overload
- accidental destructive actions without recovery
- hidden critical controls
- jittery drag behavior
- imprecise selection affordances
- overwhelming the user with options