import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { firebaseDb } from "../firebase";
import type {
  CatalogCollection,
  CatalogCollectionSnapshot,
  CatalogCollectionType,
  CatalogCollectionVisibility,
} from "../types/catalog";

/**
 * Company-scoped catalog collections service.
 *
 * Path: `companies/{companyId}/catalogCollections/{collectionId}`
 *
 * This service co-exists with the legacy
 * `src/services/catalogCollectionsFirestore.ts` top-level service. During
 * Phase 1 of the SaaS refactor, UI may query both and merge results so nothing
 * disappears for existing users.
 */

/** @deprecated Prefer {@link CatalogCollectionVisibility} from `types/catalog`. */
export type CollectionVisibility = CatalogCollectionVisibility;

export interface CompanyCatalogCollection extends CatalogCollection {
  companyId: string;
  visibility: CatalogCollectionVisibility;
}

function nowIso(): string {
  return new Date().toISOString();
}

function companyCollectionsCol(companyId: string) {
  return collection(firebaseDb, "companies", companyId, "catalogCollections");
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function parseSnapshot(value: unknown): CatalogCollectionSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const sortKey = raw.sortKey;
  if (
    sortKey !== "nameAsc" &&
    sortKey !== "nameDesc" &&
    sortKey !== "vendor" &&
    sortKey !== "manufacturer" &&
    sortKey !== "priceLow" &&
    sortKey !== "priceHigh" &&
    sortKey !== "tier"
  ) {
    return null;
  }
  return {
    searchQuery: typeof raw.searchQuery === "string" ? raw.searchQuery : "",
    vendor: typeof raw.vendor === "string" ? raw.vendor : "__all__",
    manufacturers: parseStringArray(raw.manufacturers),
    materials: parseStringArray(raw.materials),
    thicknesses: parseStringArray(raw.thicknesses),
    tierGroups: parseStringArray(raw.tierGroups),
    finishes: parseStringArray(raw.finishes),
    sizeClasses: parseStringArray(raw.sizeClasses),
    priceTypes: parseStringArray(raw.priceTypes),
    colorFamilies: parseStringArray(raw.colorFamilies),
    undertones: parseStringArray(raw.undertones),
    patternTags: parseStringArray(raw.patternTags),
    movementLevels: parseStringArray(raw.movementLevels),
    styleTags: parseStringArray(raw.styleTags),
    sortKey,
    hideWithoutPicture:
      typeof raw.hideWithoutPicture === "boolean" ? raw.hideWithoutPicture : false,
  };
}

function parseCompanyCatalogCollection(
  companyId: string,
  id: string,
  row: Record<string, unknown>
): CompanyCatalogCollection | null {
  const ownerUserId = typeof row.ownerUserId === "string" ? row.ownerUserId : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const type: CatalogCollectionType | null =
    row.type === "manual" ? "manual" : row.type === "smart" ? "smart" : null;
  if (!ownerUserId || !name || !type) return null;
  const smartSnapshot = parseSnapshot(row.smartSnapshot);
  if (type === "smart" && !smartSnapshot) return null;
  const visibility: CatalogCollectionVisibility =
    row.visibility === "company" ? "company" : "private";
  const now = nowIso();
  return {
    id,
    companyId,
    visibility,
    source: "company",
    ownerUserId,
    ownerDisplayName:
      typeof row.ownerDisplayName === "string" ? row.ownerDisplayName : null,
    name,
    description: typeof row.description === "string" ? row.description : "",
    type,
    itemIds: parseStringArray(row.itemIds),
    smartSnapshot: type === "smart" ? smartSnapshot : null,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
  };
}

/**
 * Subscribe to collections the current user can see in the active company:
 *   - collections they own (private OR company), plus
 *   - company-wide collections owned by anyone.
 *
 * We use two queries and merge client-side because Firestore cannot express
 * this as a single OR query across different fields.
 */
export function subscribeCompanyCatalogCollections(
  companyId: string,
  userId: string,
  onData: (rows: CompanyCatalogCollection[]) => void,
  onError?: (e: Error) => void
): () => void {
  let ownRows: CompanyCatalogCollection[] = [];
  let sharedRows: CompanyCatalogCollection[] = [];

  const emit = () => {
    const byId = new Map<string, CompanyCatalogCollection>();
    for (const r of ownRows) byId.set(r.id, r);
    for (const r of sharedRows) byId.set(r.id, r);
    const out = Array.from(byId.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    onData(out);
  };

  const qOwn = query(
    companyCollectionsCol(companyId),
    where("ownerUserId", "==", userId)
  );
  const qShared = query(
    companyCollectionsCol(companyId),
    where("visibility", "==", "company")
  );

  const unsubOwn = onSnapshot(
    qOwn,
    (snap) => {
      ownRows = snap.docs
        .map((d) =>
          parseCompanyCatalogCollection(companyId, d.id, d.data() as Record<string, unknown>)
        )
        .filter((r): r is CompanyCatalogCollection => r != null);
      emit();
    },
    (e) => onError?.(e as Error)
  );

  const unsubShared = onSnapshot(
    qShared,
    (snap) => {
      sharedRows = snap.docs
        .map((d) =>
          parseCompanyCatalogCollection(companyId, d.id, d.data() as Record<string, unknown>)
        )
        .filter((r): r is CompanyCatalogCollection => r != null);
      emit();
    },
    (e) => onError?.(e as Error)
  );

  return () => {
    unsubOwn();
    unsubShared();
  };
}

export async function createCompanyCatalogCollection(
  companyId: string,
  ownerUserId: string,
  data: {
    name: string;
    description: string;
    type: CatalogCollectionType;
    itemIds: string[];
    smartSnapshot: CatalogCollectionSnapshot | null;
    visibility: CatalogCollectionVisibility;
    ownerDisplayName?: string | null;
  }
): Promise<string> {
  const t = nowIso();
  const ref = await addDoc(companyCollectionsCol(companyId), {
    companyId,
    ownerUserId,
    ownerDisplayName: data.ownerDisplayName ?? null,
    visibility: data.visibility,
    name: data.name,
    description: data.description,
    type: data.type,
    itemIds: data.itemIds,
    smartSnapshot: data.type === "smart" ? data.smartSnapshot : null,
    createdAt: t,
    updatedAt: t,
  });
  return ref.id;
}

export async function updateCompanyCatalogCollection(
  companyId: string,
  collectionId: string,
  patch: Partial<{
    name: string;
    description: string;
    itemIds: string[];
    smartSnapshot: CatalogCollectionSnapshot | null;
    visibility: CatalogCollectionVisibility;
  }>
): Promise<void> {
  await updateDoc(
    doc(firebaseDb, "companies", companyId, "catalogCollections", collectionId),
    {
      ...patch,
      updatedAt: nowIso(),
    }
  );
}

export async function deleteCompanyCatalogCollection(
  companyId: string,
  collectionId: string
): Promise<void> {
  await deleteDoc(
    doc(firebaseDb, "companies", companyId, "catalogCollections", collectionId)
  );
}
