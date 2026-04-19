# BellaCatalog Price Import Spec

## Purpose

This file defines the binding rules for converting vendor price sheets into BellaCatalog normalized catalog rows.

The AI parser, deterministic parsers, and human review UI must follow this spec.

## Core principle

Extract what is present. Do not invent missing data.

If a field is not clearly present, use `null`, empty string, or warning depending on schema.

## Supported material domains

The parser is for countertop/fabrication material pricing, including:

- quartz
- natural stone
- granite
- quartzite
- marble
- dolomite
- porcelain
- solid surface
- laminate
- sinks/accessories where present
- slabs
- remnants if included

## Required row identity fields

Every accepted row should have:

```ts
vendorName: string | null;
manufacturerName: string | null;
productName: string;
priceEntries: PriceEntry[];
```

If productName cannot be determined, reject or mark `needs_review`.

## Price units

Allowed units:

```ts
"sqft"
"slab"
"bundle"
"each"
"lot"
"lf"
"unknown"
```

Normalize examples:

```txt
$/SF, /SF, per square foot, sq ft -> sqft
slab, per slab -> slab
bundle, per bundle -> bundle
each, ea -> each
linear foot, LF -> lf
lot -> lot
```

If ambiguous, use `unknown` and add warning.

## Prices

Prices must be numbers or null.

Valid:

```json
{ "price": 42.5 }
{ "price": 0 }
{ "price": null }
```

Invalid:

```json
{ "price": "$42.50" }
{ "price": "Call for pricing" }
```

For "Call for pricing", "CFA", "N/A", or blank:

```json
{ "price": null }
```

Add warning.

## Thickness

Normalize common thickness values:

```txt
1 cm -> 1cm
2 cm -> 2cm
3 cm -> 3cm
12 mm -> 12mm
20 mm -> 20mm
30 mm -> 30mm
```

Preserve original ambiguous values in `sourceContext` or warning.

## Slab size

Use readable inches when clear.

Examples:

```txt
126 x 63
127x64
136" x 80"
Jumbo 136 x 80
```

Normalize display:

```txt
126" x 63"
136" x 80"
```

If only "Jumbo" is shown and exact dimensions are absent:

```txt
size: "Jumbo"
```

Do not infer exact dimensions.

## Manufacturer vs vendor

Vendor/distributor is the company providing the price list.

Manufacturer is the brand/product maker.

Examples:

```txt
Vendor: Hallmark
Manufacturer: Corian Quartz

Vendor: StoneX
Manufacturer: Cambria

Vendor: MSI
Manufacturer: MSI
```

If the same company is both vendor and manufacturer, use same name for both.

## Branded/manufactured product identity

For branded materials, canonical product matching may be suggested.

Examples:

- Cambria
- Corian Quartz
- Wilsonart
- Silestone
- Dekton
- HanStone
- Viatera
- Vadara
- Daltile One Quartz
- MSI Q Quartz

Allowed match type:

```txt
canonical_product
```

## Natural stone identity

Natural stone must not be treated as the same product by name alone.

Examples:

- Taj Mahal
- Fantasy Brown
- Cristallo
- Mont Blanc
- White Macaubas
- Perla Venata

Allowed match types:

```txt
supplier_listing
comparable_group
none
```

Never auto-merge natural stone rows across vendors by name alone.

## Image URLs

Do not invent image URLs.

If an image URL exists in the source file, extract it.

Otherwise leave image fields empty.

Image linking is handled by a separate media matching process.

See `05_ownership_clarification.md` for the image precedence rule.

## Output behavior

Each parsed row must include warnings when:

- price is missing
- unit is unknown
- manufacturer is unclear
- product name is partial
- natural stone match is uncertain
- row appears duplicated
- table structure is ambiguous
- source page is unknown

## Confidence

Confidence range:

```ts
0.0 to 1.0
```

Recommended:

- `0.95+` clear CSV/XLSX row with headers
- `0.85+` clean PDF table row
- `0.70-0.84` readable but ambiguous table row
- `<0.70` needs review

Rows below `0.80` should default to `needs_review`.
