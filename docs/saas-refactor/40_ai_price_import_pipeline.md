# AI Price Sheet Import Pipeline

## Goal

Allow a company user to upload a vendor price sheet and convert it into normalized BellaCatalog catalog data.

Supported file types:

- PDF
- XLSX
- CSV

The AI parser must be constrained by a strict Markdown ingestion spec and a JSON schema validator.

## Non-negotiable rules

The frontend must not call OpenAI directly.

All AI parsing must happen in trusted backend code:

```txt
React frontend
→ Firebase Storage upload
→ Cloud Function / Cloud Run parser
→ OpenAI API
→ validation
→ Firestore draft rows
→ user review
→ publish price book
```

## Required docs

Create:

```txt
docs/saas-refactor/41_price_import_spec.md
```

This spec is part of the parser contract.

The parser must obey it exactly.

## Import UI routes

Add routes:

```txt
/pricing
/pricing/imports
/pricing/imports/new
/pricing/imports/:importId
/pricing/price-books
/pricing/price-books/:priceBookId
```

## Upload flow

1. User opens `/pricing/imports/new`.
2. User selects vendor or creates vendor.
3. User uploads PDF/XLSX/CSV.
4. File uploads to:

```txt
companies/{companyId}/price-imports/{importId}/{originalFileName}
```

5. Create Firestore doc:

```txt
companies/{companyId}/priceImports/{importId}
```

6. Backend parser begins.

## Backend parser stages

Status transitions:

```txt
uploaded
→ queued
→ parsing
→ needs_review
→ ready_to_publish
→ published
```

Failure state:

```txt
failed
```

## Parser output

AI must output JSON only.

The output must be validated against a strict schema.

Recommended parser result:

```ts
interface PriceImportParseResult {
  detectedVendorName: string | null;
  detectedManufacturerNames: string[];
  currency: "USD" | string;
  rows: ParsedPriceRowOutput[];
  warnings: ImportWarning[];
}

interface ParsedPriceRowOutput {
  rowIndex: number;
  sourcePage: number | null;
  rawText: string | null;

  vendorName: string | null;
  manufacturerName: string | null;
  productName: string | null;

  material: string | null;
  category: string | null;
  collection: string | null;
  tierOrGroup: string | null;

  thickness: string | null;
  finish: string | null;
  size: string | null;

  sku: string | null;
  vendorItemNumber: string | null;
  bundleNumber: string | null;

  priceEntries: Array<{
    label: string;
    price: number | null;
    unit: "sqft" | "slab" | "bundle" | "each" | "lot" | "lf" | "unknown";
    thickness?: string | null;
    size?: string | null;
    quantityRule?: string | null;
    sourceContext?: string | null;
  }>;

  notes: string | null;
  freightInfo: string | null;
  confidence: number;
  warnings: ImportWarning[];
}
```

## Validation

After AI output, backend must validate:

- JSON parseable
- required shape
- no invented prices
- prices are numeric or null
- units are known enum values
- empty product names are rejected
- rows with no prices are allowed but warned
- every warning has severity
- source page is preserved when available

## AI must not invent

The AI must never invent:

- price
- slab size
- SKU
- manufacturer
- vendor
- availability
- image URL
- inventory quantity
- country of origin
- bundle number

If unknown, use `null` and add warning.

## Human review UI

The review page must show:

- import summary
- original file link
- rows accepted
- rows needing review
- rows rejected
- warnings
- confidence
- editable normalized fields
- raw row/source text
- publish button

Rows needing review include:

- low confidence
- missing product name
- missing price
- ambiguous unit
- possible duplicate
- uncertain manufacturer
- natural stone match attempts
- suspicious price change

## Publishing

Publishing creates:

```txt
companies/{companyId}/priceBooks/{priceBookId}
companies/{companyId}/priceBooks/{priceBookId}/lines/{lineId}
companies/{companyId}/catalogItems/{catalogItemId}
```

Publishing must be explicit.

Do not auto-publish AI output.

## Price book versioning

When publishing a new price book for the same vendor:

- archive or supersede old active price book
- preserve old price book for historical quotes
- update current company catalog items
- do not mutate old quote snapshots

## Cost control

Parser backend must track:

- file size
- page count
- token usage if available
- model used
- parser version
- companyId
- userId

Add basic abuse protections:

- max file size
- max pages
- max imports per company per day
- role requirement for imports

## Recommended models

Use current OpenAI Responses API or equivalent backend integration.

The parser should prefer:

- deterministic parsing for CSV/XLSX
- AI parsing for messy PDF text/table extraction
- hybrid extraction where backend extracts text/tables first, then AI normalizes

Do not send unnecessary images/pages to AI if text extraction works.
