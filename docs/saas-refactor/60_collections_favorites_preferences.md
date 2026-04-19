# Collections, Favorites, and Preferences Refactor

## Goal

Support:

1. User-private favorites
2. User-private preferences
3. User-private collections
4. Company-shared collections
5. Backward compatibility with existing user-owned collections

## Current state

Favorites and preferences are stored in localStorage.

Collections are stored in top-level Firestore collection:

```txt
catalogCollections
```

and keyed by:

```ts
ownerUserId
```

## Target collections path

New path:

```txt
companies/{companyId}/catalogCollections/{collectionId}
```

Required fields:

```ts
companyId: string;
ownerUserId: string;
visibility: "private" | "company";
name: string;
description: string;
type: "manual" | "smart";
itemIds: string[];
smartSnapshot: CatalogCollectionSnapshot | null;
createdAt: string;
updatedAt: string;
```

## Collection behavior

Private collection:

```txt
visible only to ownerUserId
```

Company collection:

```txt
visible to all active company members
editable by owner/admin/manager or collection owner depending on permissions
```

## UI changes

Collection create/edit modals need a visibility control:

```txt
[ ] Share with company
```

Or segmented control:

```txt
Private | Company-wide
```

Default:

```txt
Private
```

Only users with permission can create company-wide collections.

## Collection queries

For active company:

Load:

```txt
company collections where visibility == "company"
+
company collections where ownerUserId == current user id
```

Implementation can use two queries and merge client-side.

## Backward compatibility

Keep old service temporarily:

```txt
src/services/catalogCollectionsFirestore.ts
```

Create new service:

```txt
src/services/companyCatalogCollectionsFirestore.ts
```

During migration, load both:

1. New company-scoped collections
2. Old top-level collections for current user

Then show old collections with a small internal `source: "legacy"` marker but do not expose this in the UI.

When saving old collection edits, write to new company path if active company exists.

## Favorites

Move favorites to Firestore:

```txt
companies/{companyId}/userCatalogState/{userId}
```

Field:

```ts
favoriteItemIds: string[];
```

Keep localStorage fallback for anonymous/dev/static mode.

## Preferences

Move preferences to same doc:

```txt
companies/{companyId}/userCatalogState/{userId}
```

Field:

```ts
preferences: UiPreferences;
```

## Sync strategy

On app load:

1. Load localStorage immediately for fast UI.
2. If company context exists, subscribe to Firestore user catalog state.
3. Merge remote state over local state.
4. On changes, write to Firestore.
5. Optionally also update localStorage as cache.

## Conflict behavior

Last-write-wins is acceptable for MVP.

Preferences are user-private and low-risk.

Favorites can also be last-write-wins.

## Catalog item id stability

Collections and favorites depend on stable item IDs.

When moving from static JSON to company catalog items, preserve IDs wherever possible.

For imported price book lines, generate stable IDs based on:

```txt
companyId
vendorId
priceBookId
normalized manufacturer
normalized product name
thickness
size
unit
```

Avoid using random IDs as the only catalog item ID for imported rows.
