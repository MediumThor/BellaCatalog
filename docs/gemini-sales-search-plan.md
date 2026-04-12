# Gemini Sales Search Plan

## Goal

Let a salesperson type a natural-language request in the frontend, such as:

- "Show me all brown stones"
- "Warm white quartz with soft movement"
- "Black stone that looks premium but not too busy"

Then return matching catalog items from BellaCatalog in a reliable way.

## Recommendation

Do **not** make Gemini look through all photos live on every search.

The better design is:

1. Keep a **structured catalog** as the source of truth.
2. Add **color/style metadata** to each item ahead of time.
3. Use Gemini only to **translate the salesperson's words into filters**.
4. Run the actual search against your catalog data.

In other words:

- Gemini should act like an **intent parser**
- Your catalog should act like the **database/search engine**

This will be faster, cheaper, easier to debug, and much more consistent than asking the model to visually inspect every image for every query.

## Why this is the better approach

BellaCatalog already has a normalized item model and already carries a `tags` field on each catalog item. The app also already loads merged catalog data in the frontend from `public/catalog.json` and related JSON files, so the project is already close to supporting AI-assisted search.

That means the best path is not "AI image search on demand." The best path is:

- enrich each item once
- save that enrichment
- search the saved enrichment many times

## Best Architecture

### Option A: Best next step for this repo

Use the existing catalog JSON as the searchable dataset, but enrich each item with better metadata.

Suggested new fields per item:

- `colorFamilies`: `["brown", "beige"]`
- `dominantColors`: `["espresso", "taupe", "cream"]`
- `undertones`: `["warm", "gold"]`
- `patternTags`: `["veined", "marbled", "speckled", "solid"]`
- `movement`: `"low" | "medium" | "high"`
- `styleTags`: `["modern", "classic", "dramatic", "soft"]`
- `finishLook`: `["polished", "matte", "leathered"]`
- `useTags`: `["kitchen", "bath", "commercial"]`

You can also start simpler and put much of this into the existing `tags` array, but dedicated fields will search better than one giant tag list.

### Option B: Better later if you want admin editing and scale

Move the enriched catalog into Firestore or another searchable database, then query that database from a backend endpoint.

This is better if you want:

- staff-editable tags
- approval workflow
- audit history
- incremental updates
- role-based access
- better analytics on what salespeople search for

Since this repo already uses Firebase/Firestore for the compare workflow, Firestore is the easiest upgrade path if you decide the catalog should become a true database instead of static JSON.

## What Gemini should do

Gemini should receive:

- the salesperson's search text
- a list of allowed filter fields
- a list of allowed values where possible

Gemini should return structured JSON like:

```json
{
  "searchText": "brown stone",
  "colorFamilies": ["brown", "beige"],
  "materials": ["Quartz", "Natural Stone"],
  "patternTags": [],
  "movement": null,
  "styleTags": [],
  "explanation": "User wants warm brown-toned materials."
}
```

The app should then filter the catalog using those fields and show the results.

## Example flow

For a query like:

> show me all brown stones

The flow should be:

1. Salesperson types the request.
2. Frontend sends the request to your Gemini-backed endpoint.
3. Gemini returns structured filters like `colorFamilies=["brown","beige"]` and `materials=["Natural Stone","Quartz"]`.
4. Your app queries the catalog using those filters.
5. The frontend shows matching products, images, and prices.
6. Optionally, Gemini also writes a short summary like: "I found 18 warm brown options across MSI, Cambria, and StoneX."

## What not to do

Avoid this design:

1. User types a query.
2. Gemini scans every image every time.
3. Gemini guesses which stones are brown.

Problems with that design:

- slow
- expensive
- inconsistent
- hard to test
- hard to explain why one stone matched and another did not

It is still useful to use AI on images, but do it **offline once**, not during every search.

## Best use of image analysis

Yes, having AI review the slab/product photos can be valuable, but use it as a **batch enrichment job**.

Recommended pattern:

1. Run a script over catalog items that have `imageUrl` or gallery images.
2. Ask the model to label each item with color and style metadata.
3. Save those tags back into your catalog JSON or database.
4. Let a human review edge cases when needed.

This gives you the benefit of AI vision without making live search depend on image interpretation every time.

## Suggested tagging vocabulary

Keep the vocabulary controlled so search stays clean.

### Colors

- black
- white
- brown
- beige
- cream
- gray
- gold
- blue
- green
- taupe

### Undertones

- warm
- cool
- neutral

### Pattern

- solid
- speckled
- veined
- marbled
- cloudy
- concrete-look

### Movement

- low
- medium
- high

### Style

- modern
- classic
- luxury
- bold
- soft
- dramatic
- natural

## Practical recommendation for BellaCatalog

For this repo, the best order is:

1. Keep using the current normalized catalog structure.
2. Add structured color/style metadata to catalog items.
3. Build a small backend endpoint that calls Gemini and returns parsed filters.
4. Filter the catalog using those parsed filters.
5. Later, if you want easier maintenance, move the catalog into Firestore.

This means:

- **short term:** do not migrate everything to a database first
- **short term:** do create tags/metadata first
- **medium term:** use Gemini to convert natural language into filters
- **later:** move to Firestore if you want a more editable catalog system

## Minimum version to build first

If you want the fastest usable version, start with:

- `colorFamilies`
- `patternTags`
- `movement`
- `styleTags`

Then support queries like:

- brown stones
- white quartz with gray veining
- warm beige countertops
- dramatic black slabs

That alone will get you most of the value.

## Final answer

Yes, you can absolutely let a salesperson search in plain English and have Gemini help.

But the best setup is:

- use Gemini to understand the request
- use your catalog data to find the matches
- use AI image tagging offline to enrich the catalog

So the answer is not "Gemini or database."

The best solution is:

- **database or structured catalog for search**
- **AI tagging for enrichment**
- **Gemini for natural-language interpretation**
