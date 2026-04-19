/**
 * Unified collections service used by the catalog browser UI.
 *
 * The app is in the middle of a SaaS refactor: catalog collections are moving
 * from the top-level `catalogCollections/{id}` path (keyed by `ownerUserId`)
 * to the company-scoped path
 * `companies/{companyId}/catalogCollections/{id}` with an explicit
 * `visibility: "private" | "company"` field.
 *
 * Rather than force every caller to care about both paths, this module wraps:
 *
 * - {@link subscribeCatalogCollections} (legacy, top-level)
 * - {@link subscribeCompanyCatalogCollections} (new, company-scoped)
 *
 * and exposes a single {@link subscribeUnifiedCatalogCollections} that emits a
 * merged, deduped, sorted list. It also exposes `saveCatalogCollection`,
 * `renameCatalogCollection`, `updateSmartCollectionSnapshot`, and
 * `deleteCatalogCollectionAny` helpers that route writes to the right backing
 * service based on `collection.source`.
 *
 * Design rules:
 *
 * 1. New writes ALWAYS go to the company path when a company is active. This
 *    is how the legacy data set is gradually drained.
 * 2. Edits to a legacy collection stay on the legacy path until an explicit
 *    migration runs; the UI shows a small "Legacy" tag so users can see why
 *    sharing isn't available yet.
 * 3. No destructive writes. We never delete a legacy collection as a side
 *    effect of creating a company one.
 */

import type {
  CatalogCollection,
  CatalogCollectionSnapshot,
  CatalogCollectionType,
  CatalogCollectionVisibility,
} from "../types/catalog";
import {
  createCatalogCollection,
  deleteCatalogCollection,
  subscribeCatalogCollections,
  updateCatalogCollection,
} from "./catalogCollectionsFirestore";
import {
  createCompanyCatalogCollection,
  deleteCompanyCatalogCollection,
  subscribeCompanyCatalogCollections,
  updateCompanyCatalogCollection,
} from "./companyCatalogCollectionsFirestore";

/** Stable sort: shared company collections first, then owned, newest updated first within each. */
function sortUnified(rows: CatalogCollection[]): CatalogCollection[] {
  return [...rows].sort((a, b) => {
    const aShared = a.visibility === "company" ? 0 : 1;
    const bShared = b.visibility === "company" ? 0 : 1;
    if (aShared !== bShared) return aShared - bShared;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function subscribeUnifiedCatalogCollections(args: {
  userId: string;
  companyId: string | null;
  onData: (rows: CatalogCollection[]) => void;
  onError?: (e: Error) => void;
}): () => void {
  const { userId, companyId, onData, onError } = args;

  let legacyRows: CatalogCollection[] = [];
  let companyRows: CatalogCollection[] = [];
  let legacyReady = false;
  let companyReady = Boolean(!companyId);

  const emit = () => {
    if (!legacyReady || !companyReady) return;
    // De-dupe defensively on `id` (company IDs and legacy IDs are disjoint
    // today, but be safe if a future migration copies the same id).
    const byId = new Map<string, CatalogCollection>();
    for (const row of legacyRows) byId.set(row.id, row);
    for (const row of companyRows) byId.set(row.id, row);
    onData(sortUnified(Array.from(byId.values())));
  };

  const unsubLegacy = subscribeCatalogCollections(
    userId,
    (rows) => {
      legacyRows = rows;
      legacyReady = true;
      emit();
    },
    (e) => onError?.(e)
  );

  let unsubCompany: (() => void) | null = null;
  if (companyId) {
    unsubCompany = subscribeCompanyCatalogCollections(
      companyId,
      userId,
      (rows) => {
        companyRows = rows;
        companyReady = true;
        emit();
      },
      (e) => onError?.(e)
    );
  }

  return () => {
    unsubLegacy();
    unsubCompany?.();
  };
}

/** Create a new collection. When a company is active, always writes to the company path. */
export async function createUnifiedCatalogCollection(args: {
  userId: string;
  companyId: string | null;
  ownerDisplayName: string | null;
  data: {
    name: string;
    description: string;
    type: CatalogCollectionType;
    itemIds: string[];
    smartSnapshot: CatalogCollectionSnapshot | null;
    visibility: CatalogCollectionVisibility;
  };
}): Promise<string> {
  const { userId, companyId, ownerDisplayName, data } = args;
  if (companyId) {
    return createCompanyCatalogCollection(companyId, userId, {
      ...data,
      ownerDisplayName,
    });
  }
  // No company context (legacy / dev): the concept of "company" visibility
  // doesn't apply, so we fall back to the legacy per-user service.
  return createCatalogCollection(userId, {
    name: data.name,
    description: data.description,
    type: data.type,
    itemIds: data.itemIds,
    smartSnapshot: data.smartSnapshot,
  });
}

export type UnifiedCollectionPatch = Partial<{
  name: string;
  description: string;
  itemIds: string[];
  smartSnapshot: CatalogCollectionSnapshot | null;
  visibility: CatalogCollectionVisibility;
}>;

/** Route writes based on where the collection actually lives. */
export async function updateUnifiedCatalogCollection(
  collection: CatalogCollection,
  patch: UnifiedCollectionPatch
): Promise<void> {
  const isCompany = collection.source === "company" && collection.companyId;
  if (isCompany) {
    await updateCompanyCatalogCollection(collection.companyId!, collection.id, patch);
    return;
  }
  // Legacy: visibility isn't supported; silently drop it to avoid polluting
  // legacy docs with a field that the legacy rules don't know about.
  const { visibility: _ignored, ...legacyPatch } = patch;
  void _ignored;
  await updateCatalogCollection(collection.id, legacyPatch);
}

export async function deleteUnifiedCatalogCollection(
  collection: CatalogCollection
): Promise<void> {
  const isCompany = collection.source === "company" && collection.companyId;
  if (isCompany) {
    await deleteCompanyCatalogCollection(collection.companyId!, collection.id);
    return;
  }
  await deleteCatalogCollection(collection.id);
}

/**
 * Returns true if the signed-in user can edit this collection's contents
 * (items, name, description, visibility, delete).
 *
 * - Legacy (per-user) collections: only the owner.
 * - Company-private: only the owner.
 * - Company-shared: owner OR someone with owner/admin/manager role.
 */
export function canEditCollection(args: {
  collection: CatalogCollection;
  currentUserId: string;
  role: "owner" | "admin" | "manager" | "sales" | "viewer" | null;
}): boolean {
  const { collection, currentUserId, role } = args;
  if (collection.ownerUserId === currentUserId) return true;
  if (collection.source !== "company") return false;
  if (collection.visibility !== "company") return false;
  return role === "owner" || role === "admin" || role === "manager";
}

/**
 * Returns true if the signed-in user may create a company-shared collection.
 * (Private collections are always allowed for any signed-in member.)
 */
export function canShareCollection(
  role: "owner" | "admin" | "manager" | "sales" | "viewer" | null
): boolean {
  return role === "owner" || role === "admin" || role === "manager" || role === "sales";
}
