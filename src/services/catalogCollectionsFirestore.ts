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
} from "../types/catalog";

function nowIso(): string {
  return new Date().toISOString();
}

const catalogCollectionsCol = () => collection(firebaseDb, "catalogCollections");

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
    hideWithoutPicture: typeof raw.hideWithoutPicture === "boolean" ? raw.hideWithoutPicture : false,
  };
}

function parseCatalogCollection(
  id: string,
  row: Record<string, unknown>
): CatalogCollection | null {
  const ownerUserId = typeof row.ownerUserId === "string" ? row.ownerUserId : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const type: CatalogCollectionType | null =
    row.type === "manual" ? "manual" : row.type === "smart" ? "smart" : null;
  if (!ownerUserId || !name || !type) return null;
  const smartSnapshot = parseSnapshot(row.smartSnapshot);
  if (type === "smart" && !smartSnapshot) return null;
  const now = nowIso();
  return {
    id,
    ownerUserId,
    name,
    description: typeof row.description === "string" ? row.description : "",
    type,
    itemIds: parseStringArray(row.itemIds),
    smartSnapshot: type === "smart" ? smartSnapshot : null,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
  };
}

export function subscribeCatalogCollections(
  ownerUserId: string,
  onData: (rows: CatalogCollection[]) => void,
  onError?: (e: Error) => void
): () => void {
  const q = query(catalogCollectionsCol(), where("ownerUserId", "==", ownerUserId));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((entry) => parseCatalogCollection(entry.id, entry.data() as Record<string, unknown>))
        .filter((entry): entry is CatalogCollection => entry != null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      onData(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export async function createCatalogCollection(
  ownerUserId: string,
  data: {
    name: string;
    description: string;
    type: CatalogCollectionType;
    itemIds: string[];
    smartSnapshot: CatalogCollectionSnapshot | null;
  }
): Promise<string> {
  const t = nowIso();
  const ref = await addDoc(catalogCollectionsCol(), {
    ownerUserId,
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

export async function updateCatalogCollection(
  collectionId: string,
  patch: Partial<{
    name: string;
    description: string;
    itemIds: string[];
    smartSnapshot: CatalogCollectionSnapshot | null;
  }>
): Promise<void> {
  await updateDoc(doc(firebaseDb, "catalogCollections", collectionId), {
    ...patch,
    updatedAt: nowIso(),
  });
}

export async function deleteCatalogCollection(collectionId: string): Promise<void> {
  await deleteDoc(doc(firebaseDb, "catalogCollections", collectionId));
}
