# Bella Premium Style Tokens

## Goal

Define the visual building blocks of BellaCatalog’s premium UI language.

These are conceptual guardrails and token directions, not necessarily exact final values.

Use judgment based on implementation context.

---

## Surfaces

### Surface hierarchy

Use multiple layered surface types:

1. page background
2. glass panel
3. elevated glass panel
4. floating control surface
5. pressed / active surface
6. overlay surface

Each surface should differ through:
- blur
- transparency
- border alpha
- shadow softness
- highlight treatment

Avoid flat monotony.

---

## Glass treatment

Preferred qualities:
- soft background blur
- translucent fill
- subtle white-tinted border
- inner highlight
- faint gradient
- occasional edge sheen

Avoid:
- muddy translucency
- over-frosted unreadability
- thick “glassmorphism” clichés
- heavy rainbow gradients

---

## Border language

Borders should be:
- subtle
- low-alpha
- elegant
- often brighter at the top edge than bottom edge
- supportive, not dominant

Avoid harsh 1px dark gray enterprise borders as the primary visual language.

---

## Shadow language

Shadows should be:
- soft
- layered
- diffused
- used to separate surfaces gently

Prefer multiple subtle shadows over one heavy shadow.

Avoid:
- cartoon drop shadows
- sharp black halos
- overused box-shadow stacks without structure

---

## Radius system

Use disciplined corner radii.

Suggested approach:
- small radius for pills and chips
- medium radius for controls
- larger radius for cards and floating panels
- extra-large radius only for major hero containers

Avoid inconsistent random radii.

---

## Color system

The palette should be restrained and premium.

Base needs:
- refined light neutrals
- elegant dark neutrals if dark mode is supported
- soft accent tint
- premium success/warning/error colors

Color should be used to:
- guide focus
- reinforce state
- create atmosphere subtly

Avoid:
- loud saturation
- rainbow UI
- too many competing accent colors
- neon-heavy style

---

## Typography

Typography should feel:
- premium
- spacious
- readable
- calm
- structured

Use hierarchy intentionally:
- large elegant headings
- confident section headers
- clean body text
- restrained secondary text
- tasteful metric emphasis

Avoid:
- cramped text
- tiny low-contrast metadata everywhere
- overuse of all caps
- excessive font-weight changes

---

## Iconography

Icons should be:
- simple
- crisp
- minimal
- secondary to the content

Avoid icon overload.
Icons should support comprehension, not dominate the experience.

---

## Motion tokens

Motion should be:
- smooth
- calm
- spring-informed
- context-aware

Use differentiated motion for:
- hover
- press
- panel reveal
- selection
- save state
- mode switch
- overlays

Avoid:
- bouncy toy-like motion
- inconsistent animation speeds
- excessive movement on every element

---

## Blur and depth

Blur should help create depth, not obscure content.

Use blur carefully:
- higher blur on floating controls
- moderate blur on panels
- lower blur where readability matters most

Always maintain legibility.

---

## Touch target expectations

This is a premium customer-facing product.

Controls should generally feel:
- touch-friendly
- spacious
- precise
- comfortable on laptops and larger tablets

Avoid cramped desktop-only target sizing.