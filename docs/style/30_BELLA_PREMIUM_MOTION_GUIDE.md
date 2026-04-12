# Bella Premium Motion Guide

## Purpose

Define the motion language for BellaCatalog’s premium UI.

Motion should support clarity, hierarchy, and tactility.

It should make the product feel alive and premium without becoming flashy.

---

## Motion principles

### 1. Motion should clarify
Movement should reveal structure, selection, and state change.

### 2. Motion should feel calm
Avoid chaotic or overly playful animations.

### 3. Motion should feel tactile
Press, hover, and selection should feel physically responsive.

### 4. Motion should support premium perception
Transitions should feel deliberate and refined.

### 5. Motion should not get in the way
Fast, repeated workflows should remain efficient.

---

## Key motion types

### Hover motion
Use subtle lift, glow, or surface shift.
Keep it restrained.

### Press motion
Use slight compression or tactile depth change.
Press should feel satisfying, not mushy.

### Selection motion
Selected items may:
- gain emphasis
- brighten slightly
- elevate slightly
- animate into focus smoothly

### Panel transitions
Panels may:
- fade
- blur in
- slide slightly
- scale subtly

### Mode switches
Trace mode to placement mode should feel spatially coherent.
It should feel like moving to the next workspace, not teleporting.

### Save state transitions
Save indicators should animate calmly:
- saving
- saved
- error

---

## Motion pacing

Favor:
- quick but not abrupt
- smooth easing
- spring where appropriate for tactile controls
- softer fades for overlays

Avoid:
- robotic linear transitions
- slow ornamental transitions
- exaggerated bounce
- inconsistent timing across the UI

---

## Recommended places for motion emphasis

Good candidates:
- selected slab card
- selected piece
- segmented mode switch
- layout save state
- empty-state-to-active-state transition
- floating inspector reveal
- tool activation
- piece drag hover state

---

## Recommended places for motion restraint

Be careful with:
- metric cards
- text-heavy panels
- repeated list interactions
- form-heavy regions
- warning states

These should remain stable and readable.

---

## Drag interactions

Drag interactions must feel smooth and grounded.

Requirements:
- low perceived latency
- stable selection state
- clear active piece feedback
- no jittering rerenders
- visual confidence while moving pieces

---

## Motion anti-patterns

Avoid:
- animation on every single element
- decorative movement unrelated to state
- rubbery motion everywhere
- excessive delays
- flashy effects that break the luxury tone
- sudden harsh transitions between major modes